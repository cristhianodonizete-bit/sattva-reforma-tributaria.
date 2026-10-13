-- Fonte canônica e validade persistida das projeções fiscais.
-- Migração somente aditiva: não altera fatos, resultados nem eventos existentes.

alter table public.parceiros
  add column if not exists regime_origem text,
  add column if not exists regime_versao bigint not null default 1,
  add column if not exists regime_confirmado_em timestamptz;

alter table public.movimentos
  add column if not exists regime_fonte text,
  add column if not exists regime_parceiro_versao bigint,
  add column if not exists regime_confirmado_em timestamptz;

alter table public.motor_resultados_operacionais
  add column if not exists assinatura_origem text,
  add column if not exists versao_origem bigint;

create table if not exists public.projecoes_movimentos_estado (
  empresa_id bigint not null,
  movimento_id bigint not null,
  assinatura_origem text not null,
  versao_origem bigint not null default 1,
  assinatura_calculada text,
  versao_calculada bigint,
  situacao text not null check (situacao in ('ATUAL','ATUALIZACAO_PENDENTE','FALHOU','PENDENCIA_REAL')),
  motivo text,
  job_id uuid,
  atualizado_em timestamptz not null default clock_timestamp(),
  primary key (empresa_id,movimento_id)
);

create index if not exists ix_projecoes_movimentos_estado_empresa_situacao
  on public.projecoes_movimentos_estado(empresa_id,situacao,atualizado_em desc);

comment on table public.projecoes_movimentos_estado is
  'Estado canônico de validade da projeção por movimento. Resultado ativo só é vigente quando assinatura_origem=assinatura_calculada e situacao=ATUAL.';

-- Exceções por movimento são raras e explícitas. Elas não reutilizam JSON de
-- evidência como fonte de verdade e sempre carregam versão e precedência.
create table if not exists public.movimento_decisoes_fiscais (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  movimento_id bigint not null references public.movimentos(id) on delete restrict,
  campo text not null check (campo in ('REGIME_FORNECEDOR','CLASSIFICACAO_FISCAL')),
  valor text not null,
  origem text not null,
  versao bigint not null default 1,
  confirmado_em timestamptz not null default clock_timestamp(),
  revogado_em timestamptz,
  unique (empresa_id,movimento_id,campo,versao)
);
create unique index if not exists ux_movimento_decisoes_fiscais_vigente
  on public.movimento_decisoes_fiscais(empresa_id,movimento_id,campo)
  where revogado_em is null;

comment on table public.movimento_decisoes_fiscais is
  'Exceções versionadas que prevalecem sobre parceiros. movimentos.regime é histórico e não é fonte canônica atual.';

-- Uma queda de processo não alcança o catch do worker. A própria fila
-- compartilhada é a autoridade para transformar a projeção pendente em falha
-- quando as tentativas se esgotam, preservando a decisão canônica na leitura.
create or replace function public.marcar_projecao_falha_por_job()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.tipo_job='MOTOR_INCREMENTAL' and new.status='FALHOU'
    and coalesce(old.status,'') is distinct from 'FALHOU' then
    update public.projecoes_movimentos_estado
       set situacao='FALHOU',
           motivo=coalesce(new.erro,'Atualização incremental falhou.'),
           job_id=new.id,
           atualizado_em=clock_timestamp()
     where empresa_id=new.empresa_id
       and movimento_id in (
         select value::bigint from jsonb_array_elements_text(coalesce(new.payload->'movimento_ids','[]'::jsonb))
       );
  end if;
  return new;
end $$;
drop trigger if exists trg_jobs_carteira_projecao_falha on public.jobs_carteira;
create trigger trg_jobs_carteira_projecao_falha
after update of status on public.jobs_carteira
for each row execute function public.marcar_projecao_falha_por_job();
