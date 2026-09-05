-- Infraestrutura de fatos materiais empresa + produto.
-- Não importa regras, não contém CST/alíquota e não altera movimentos ou motor.
create table if not exists public.produtos_empresa (
  id bigint generated always as identity primary key, empresa_id bigint not null,
  codigo_produto_atual text, ncm_atual text, descricao_atual text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(empresa_id,codigo_produto_atual)
);
create table if not exists public.produto_aliases (
  id bigint generated always as identity primary key, produto_empresa_id bigint not null references public.produtos_empresa(id) on delete cascade,
  empresa_id bigint not null, tipo_origem text not null check(tipo_origem in ('XML_CPROD','SPED_COD_ITEM','CADASTRO','PLANILHA','OUTRO')),
  codigo_origem text not null, vigencia_inicio date, vigencia_fim date, created_at timestamptz not null default now(),
  check(vigencia_fim is null or vigencia_inicio is null or vigencia_inicio<=vigencia_fim), unique(empresa_id,tipo_origem,codigo_origem,vigencia_inicio)
);
create index if not exists ix_produto_aliases_resolver on public.produto_aliases(empresa_id,tipo_origem,codigo_origem,vigencia_inicio,vigencia_fim);
alter table public.movimentos add column if not exists produto_empresa_id bigint references public.produtos_empresa(id) on delete set null;
create index if not exists ix_movimentos_produto_empresa on public.movimentos(empresa_id,produto_empresa_id);
create table if not exists public.empresa_produto_fiscal (
  id bigint generated always as identity primary key,
  empresa_id bigint not null, produto_empresa_id bigint references public.produtos_empresa(id) on delete restrict,
  codigo_produto text,
  produto_id bigint, chave_produto text, ncm text,
  papel_padrao text not null default 'INDETERMINADO' check (papel_padrao in ('INDETERMINADO','FABRICANTE','PRODUTOR','IMPORTADOR','REVENDEDOR','ATACADISTA','DISTRIBUIDOR','VAREJISTA')),
  fabricacao_propria boolean, importador boolean, revendedor boolean,
  defensivo_agropecuario boolean, fertilizante boolean, uso_veterinario boolean,
  corretivo_solo boolean, origem_mineral boolean, fatos_extras_json jsonb not null default '{}'::jsonb,
  fonte_dado text not null default 'USUARIO', origem_evidencia text, observacao text,
  validado_por uuid references auth.users(id), validado_em timestamptz,
  vigencia_inicio date, vigencia_fim date, ativo boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_inicio is null or vigencia_inicio <= vigencia_fim),
  -- A identidade interna prevalece; código externo é mantido somente para legado/exibição.
  check (produto_empresa_id is not null or nullif(btrim(codigo_produto), '') is not null)
);
create index if not exists ix_empresa_produto_fiscal_busca on public.empresa_produto_fiscal(empresa_id,codigo_produto,ativo,vigencia_inicio,vigencia_fim);
create index if not exists ix_empresa_produto_fiscal_produto_empresa on public.empresa_produto_fiscal(empresa_id,produto_empresa_id,ativo,vigencia_inicio,vigencia_fim);
create unique index if not exists ux_empresa_produto_fiscal_identidade_vigencia on public.empresa_produto_fiscal(empresa_id,produto_empresa_id,vigencia_inicio) where produto_empresa_id is not null;
create unique index if not exists ux_empresa_produto_fiscal_legado_vigencia on public.empresa_produto_fiscal(empresa_id,codigo_produto,vigencia_inicio) where produto_empresa_id is null;

create table if not exists public.empresa_produto_fiscal_historico (
  id bigint generated always as identity primary key, cadastro_id bigint not null references public.empresa_produto_fiscal(id) on delete cascade,
  empresa_id bigint not null, produto_empresa_id bigint references public.produtos_empresa(id) on delete restrict, codigo_produto text, fato text not null, valor_anterior text, valor_novo text,
  fonte text, observacao text, usuario_id uuid references auth.users(id), criado_em timestamptz not null default now()
);
create index if not exists ix_empresa_produto_fiscal_historico_produto_empresa on public.empresa_produto_fiscal_historico(empresa_id,produto_empresa_id,criado_em desc);
create table if not exists public.pendencias_fiscais_produtos (
  id bigint generated always as identity primary key, empresa_id bigint not null,
  produto_empresa_id bigint references public.produtos_empresa(id) on delete restrict, codigo_produto text,
  produto_descricao text, ncm text, regra_id text, familia_regra text, regra_candidata text, fato_faltante text not null,
  pergunta text not null, origem_dados_existentes text, status text not null default 'PENDENTE', movimento_id bigint,
  respondida_por uuid references auth.users(id), respondida_em timestamptz, resolvida_em timestamptz, observacao text,
  criado_em timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (produto_empresa_id is not null or nullif(btrim(codigo_produto), '') is not null)
);
create index if not exists ix_pendencias_fiscais_produtos_fila on public.pendencias_fiscais_produtos(empresa_id,status,fato_faltante,codigo_produto,criado_em desc);
create index if not exists ix_pendencias_fiscais_produtos_produto_empresa on public.pendencias_fiscais_produtos(empresa_id,produto_empresa_id,status,fato_faltante,criado_em desc);
create unique index if not exists ux_pendencias_fiscais_produtos_abertas_identidade on public.pendencias_fiscais_produtos(empresa_id,produto_empresa_id,fato_faltante,coalesce(regra_id,coalesce(regra_candidata,'')),coalesce(familia_regra,'')) where produto_empresa_id is not null and status='PENDENTE';
create unique index if not exists ux_pendencias_fiscais_produtos_abertas_legado on public.pendencias_fiscais_produtos(empresa_id,codigo_produto,fato_faltante,coalesce(regra_id,coalesce(regra_candidata,'')),coalesce(familia_regra,'')) where produto_empresa_id is null and status='PENDENTE';
create table if not exists public.conflitos_fatos_fiscais (
  id bigint generated always as identity primary key, empresa_id bigint not null, codigo_produto text, movimento_id bigint,
  fato text not null, valor_precedente text, origem_precedente text, valor_menor_precedencia text,
  origem_menor_precedencia text, status text not null default 'ABERTO', criado_em timestamptz not null default now()
);
create table if not exists public.motor_condicional_sombra (
  id bigint generated always as identity primary key, movimento_id bigint, empresa_id bigint not null, produto_empresa_id bigint,
  ncm text, regra_candidata text, regra_selecionada text, familia_regra text, condicoes jsonb, fatos_resolvidos jsonb,
  status_avaliacao text, resultado_oficial jsonb, resultado_sombra jsonb, diferenca jsonb, motivo text, criado_em timestamptz not null default now()
);

alter table public.empresa_produto_fiscal enable row level security;
alter table public.produtos_empresa enable row level security;
alter table public.produto_aliases enable row level security;
alter table public.empresa_produto_fiscal_historico enable row level security;
alter table public.pendencias_fiscais_produtos enable row level security;
alter table public.conflitos_fatos_fiscais enable row level security;
create policy "fatos empresa visiveis" on public.empresa_produto_fiscal for select using (public.tem_acesso_empresa(empresa_id));
create policy "produtos empresa visiveis" on public.produtos_empresa for select using (public.tem_acesso_empresa(empresa_id));
create policy "aliases produto visiveis" on public.produto_aliases for select using (public.tem_acesso_empresa(empresa_id));
create policy "historico fatos empresa visivel" on public.empresa_produto_fiscal_historico for select using (public.tem_acesso_empresa(empresa_id));
create policy "pendencias fatos empresa visiveis" on public.pendencias_fiscais_produtos for select using (public.tem_acesso_empresa(empresa_id));
create policy "conflitos fatos empresa visiveis" on public.conflitos_fatos_fiscais for select using (public.tem_acesso_empresa(empresa_id));

-- Histórico é somente inclusão: não há política UPDATE/DELETE.
create or replace function public.atualizar_updated_at_empresa_produto_fiscal()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
create trigger empresa_produto_fiscal_updated_at before update on public.empresa_produto_fiscal for each row execute function public.atualizar_updated_at_empresa_produto_fiscal();
create trigger pendencias_fiscais_produtos_updated_at before update on public.pendencias_fiscais_produtos for each row execute function public.atualizar_updated_at_empresa_produto_fiscal();

-- Um mesmo fato não pode possuir vigências ativas sobrepostas para a mesma empresa e produto.
create or replace function public.validar_sobreposicao_fato_empresa_produto()
returns trigger language plpgsql as $$
declare f text; inicio date := coalesce(new.vigencia_inicio, '-infinity'::date); fim date := coalesce(new.vigencia_fim, 'infinity'::date); existe boolean;
begin
  foreach f in array array['fabricacao_propria','importador','revendedor','defensivo_agropecuario','fertilizante','uso_veterinario','corretivo_solo','origem_mineral'] loop
    if (to_jsonb(new)->>f) is not null then
      execute 'select exists (select 1 from public.empresa_produto_fiscal x where x.empresa_id=$1 and (($2 is not null and x.produto_empresa_id=$2) or ($2 is null and x.produto_empresa_id is null and x.codigo_produto=$3)) and x.ativo and x.id<>$4 and (to_jsonb(x)->>$5) is not null and coalesce(x.vigencia_inicio,''-infinity''::date) <= $6 and coalesce(x.vigencia_fim,''infinity''::date) >= $7)' into existe using new.empresa_id,new.produto_empresa_id,new.codigo_produto,new.id,f,fim,inicio;
      if existe then raise exception 'Vigência sobreposta para empresa, produto e fato %', f; end if;
    end if;
  end loop; return new;
end $$;
create trigger empresa_produto_fiscal_sem_sobreposicao before insert or update on public.empresa_produto_fiscal for each row execute function public.validar_sobreposicao_fato_empresa_produto();
