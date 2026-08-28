-- Governança aditiva de catálogos. Não altera motor, resultados, carteira ou regras.
create table if not exists public.catalogo_publicacoes (
  id bigint generated always as identity primary key,
  referencia text not null unique,
  publicado_em date,
  descricao text,
  criado_em timestamptz not null default now()
);

create table if not exists public.catalogo_versoes (
  id bigint generated always as identity primary key,
  catalogo_publicacao_id bigint references public.catalogo_publicacoes(id) on delete restrict,
  dominio text not null check (dominio in ('NCM','NBS','GOVERNO','CST_IBS_CBS','CCLASSTRIB_IBS_CBS')),
  versao text not null, origem text not null, arquivo_nome text not null,
  arquivo_hash_sha256 char(64) not null, publicado_em date, importado_em timestamptz not null default now(),
  vigencia_inicio date, vigencia_fim date,
  status_versao text not null check (status_versao in ('RASCUNHO','VALIDADA','ATIVA','SUBSTITUIDA','ARQUIVADA','REJEITADA')),
  observacao text, criado_em timestamptz not null default now(),
  unique (dominio, versao, arquivo_hash_sha256), unique (id, dominio)
);

create table if not exists public.catalogo_linhas_versoes (
  id bigint generated always as identity primary key,
  catalogo_versao_id bigint not null references public.catalogo_versoes(id) on delete restrict,
  pagina_origem integer not null default 0,
  linha_origem integer not null,
  hash_linha_sha256 char(64) not null,
  dados_oficiais jsonb not null, campos_origem jsonb not null,
  criado_em timestamptz not null default now(),
  unique (catalogo_versao_id, pagina_origem, linha_origem), unique (id, catalogo_versao_id)
);

create table if not exists public.catalogo_cst (
  id bigint generated always as identity primary key,
  catalogo_versao_id bigint not null, dominio text not null default 'CST_IBS_CBS' check (dominio='CST_IBS_CBS'),
  catalogo_linha_id bigint not null, codigo char(3) not null, descricao text not null,
  ind_gibs_cbs boolean not null, ind_gibs_cbs_mono boolean not null, ind_gred boolean not null, ind_gdif boolean not null,
  ind_gtransf_cred boolean not null, ind_gcred_pres_ibs_zfm boolean not null, ind_gajuste_compet boolean not null, ind_redutor_bc boolean not null,
  campos_origem jsonb not null, criado_em timestamptz not null default now(),
  foreign key (catalogo_versao_id, dominio) references public.catalogo_versoes(id, dominio) on delete restrict,
  foreign key (catalogo_linha_id, catalogo_versao_id) references public.catalogo_linhas_versoes(id, catalogo_versao_id) on delete restrict,
  unique (catalogo_versao_id, codigo), unique (catalogo_linha_id), unique (id, catalogo_versao_id)
);

create table if not exists public.catalogo_cclasstrib (
  id bigint generated always as identity primary key,
  catalogo_versao_id bigint not null, dominio text not null default 'CCLASSTRIB_IBS_CBS' check (dominio='CCLASSTRIB_IBS_CBS'),
  catalogo_linha_id bigint not null, codigo char(6) not null, cst_codigo_origem char(3) not null, cst_descricao_origem text,
  nome text not null, descricao text, lc_redacao text, lc_214_25 text, regulamento_cbs text, regulamento_ibs text,
  tipo_aliquota text, pred_ibs numeric(9,4), pred_cbs numeric(9,4),
  ind_gtrib_regular boolean not null, ind_gcred_pres_op boolean not null, ind_gmono_padrao boolean not null, ind_gmono_reten boolean not null,
  ind_gmono_ret boolean not null, ind_gmono_dif boolean not null, ind_gp_bio_diferente boolean not null, ind_gestorno_cred boolean not null,
  tp_rbsn text, vigencia_inicio date, vigencia_fim date, data_atualizacao date,
  ind_nfe_abi boolean not null, ind_nfe boolean not null, ind_nfce boolean not null, ind_cte boolean not null, ind_cte_os boolean not null,
  ind_bpe boolean not null, ind_bpe_ta boolean not null, ind_bpe_tm boolean not null, ind_nf3e boolean not null, ind_nfse boolean not null,
  ind_nfse_via boolean not null, ind_nfcom boolean not null, ind_nfag boolean not null, ind_nfgas boolean not null, ind_dere boolean not null,
  ind_dir boolean not null, ind_duimp boolean not null, anexo text, link_fonte text, campos_origem jsonb not null,
  criado_em timestamptz not null default now(),
  foreign key (catalogo_versao_id, dominio) references public.catalogo_versoes(id, dominio) on delete restrict,
  foreign key (catalogo_linha_id, catalogo_versao_id) references public.catalogo_linhas_versoes(id, catalogo_versao_id) on delete restrict,
  unique (catalogo_versao_id, codigo), unique (catalogo_linha_id), unique (id, catalogo_versao_id)
);

create table if not exists public.catalogo_cst_cclasstrib (
  id bigint generated always as identity primary key,
  catalogo_linha_id bigint not null,
  catalogo_cst_id bigint not null, cst_catalogo_versao_id bigint not null,
  catalogo_cclasstrib_id bigint not null, cclasstrib_catalogo_versao_id bigint not null,
  catalogo_publicacao_id bigint not null references public.catalogo_publicacoes(id) on delete restrict,
  criado_em timestamptz not null default now(),
  foreign key (catalogo_cst_id, cst_catalogo_versao_id) references public.catalogo_cst(id, catalogo_versao_id) on delete restrict,
  foreign key (catalogo_cclasstrib_id, cclasstrib_catalogo_versao_id) references public.catalogo_cclasstrib(id, catalogo_versao_id) on delete restrict,
  foreign key (catalogo_linha_id, cclasstrib_catalogo_versao_id) references public.catalogo_linhas_versoes(id, catalogo_versao_id) on delete restrict,
  unique (catalogo_cst_id, catalogo_cclasstrib_id, cst_catalogo_versao_id, cclasstrib_catalogo_versao_id)
);

create or replace function public.validar_publicacao_relacao_cst_cclasstrib() returns trigger language plpgsql as $$
declare pub_cst bigint; pub_cclass bigint;
begin
  select catalogo_publicacao_id into pub_cst from public.catalogo_versoes where id=new.cst_catalogo_versao_id;
  select catalogo_publicacao_id into pub_cclass from public.catalogo_versoes where id=new.cclasstrib_catalogo_versao_id;
  if pub_cst is distinct from new.catalogo_publicacao_id or pub_cclass is distinct from new.catalogo_publicacao_id then
    raise exception 'Relação CST × cClassTrib exige versões da mesma publicação oficial';
  end if;
  return new;
end $$;
drop trigger if exists tg_publicacao_relacao_cst_cclasstrib on public.catalogo_cst_cclasstrib;
create trigger tg_publicacao_relacao_cst_cclasstrib before insert or update on public.catalogo_cst_cclasstrib
for each row execute function public.validar_publicacao_relacao_cst_cclasstrib();

create table if not exists public.motor_execucao_catalogos (
  motor_execucao_id bigint not null references public.motor_execucoes_operacionais(id) on delete restrict,
  dominio text not null check (dominio in ('NCM','NBS','GOVERNO','CST_IBS_CBS','CCLASSTRIB_IBS_CBS')),
  catalogo_versao_id bigint not null, registrado_em timestamptz not null default now(),
  primary key (motor_execucao_id, dominio),
  foreign key (catalogo_versao_id, dominio) references public.catalogo_versoes(id, dominio) on delete restrict
);

create table if not exists public.regime_origens (
  origem_evidencia text primary key, prioridade smallint not null unique, descricao text not null,
  permite_evidencia boolean not null default true, ativo boolean not null default true
);
insert into public.regime_origens (origem_evidencia,prioridade,descricao,permite_evidencia) values
  ('API_SIMPLES',1,'Consulta oficial de opção pelo Simples/MEI',true),
  ('RFB_2024',2,'Base RFB ano-calendário 2024',true),
  ('MANUAL',3,'Definição manual com evidência',true),
  ('INDETERMINADO',99,'Ausência de evidência suficiente',false)
on conflict (origem_evidencia) do update set prioridade=excluded.prioridade, descricao=excluded.descricao, permite_evidencia=excluded.permite_evidencia;

create table if not exists public.regime_evidencias_cnpj (
  id bigint generated always as identity primary key,
  cnpj text not null check (cnpj ~ '^[0-9]{14}$'), regime_resolvido text not null, regime_cbs text,
  origem_evidencia text not null references public.regime_origens(origem_evidencia) on delete restrict,
  fonte text not null, referencia_fonte text, evidencia jsonb not null, hash_evidencia_sha256 char(64) not null,
  consultado_em timestamptz not null default now(), vigencia_inicio date, vigencia_fim date, criado_em timestamptz not null default now(),
  check (origem_evidencia <> 'INDETERMINADO')
);

alter table public.cadastros_cnpj add column if not exists regime_resolvido_origem text;
alter table public.cadastros_cnpj add column if not exists regime_resolvido_em timestamptz;
alter table public.cadastros_cnpj add column if not exists regime_resolvido_evidencia_id bigint references public.regime_evidencias_cnpj(id) on delete restrict;

alter table public.motor_resultados_operacionais add column if not exists catalogo_cst_resolvido_id bigint references public.catalogo_cst(id) on delete restrict;
alter table public.motor_resultados_operacionais add column if not exists catalogo_cclasstrib_resolvido_id bigint references public.catalogo_cclasstrib(id) on delete restrict;

alter table public.base_ncm add column if not exists catalogo_versao_id bigint;
alter table public.base_ncm add column if not exists catalogo_linha_id bigint;
alter table public.base_ncm add column if not exists chave_variante_origem text;
alter table public.base_ncm add column if not exists dados_origem jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='fk_base_ncm_catalogo_linha') then
    alter table public.base_ncm add constraint fk_base_ncm_catalogo_linha foreign key (catalogo_linha_id,catalogo_versao_id) references public.catalogo_linhas_versoes(id,catalogo_versao_id) on delete restrict;
  end if;
end $$;

alter table public.base_servicos add column if not exists catalogo_versao_id bigint;
alter table public.base_servicos add column if not exists catalogo_linha_id bigint;
alter table public.base_servicos add column if not exists chave_variante_origem text;
alter table public.base_servicos add column if not exists dados_origem jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='fk_base_servicos_catalogo_linha') then
    alter table public.base_servicos add constraint fk_base_servicos_catalogo_linha foreign key (catalogo_linha_id,catalogo_versao_id) references public.catalogo_linhas_versoes(id,catalogo_versao_id) on delete restrict;
  end if;
end $$;

alter table public.regras_governo add column if not exists catalogo_versao_id bigint;
alter table public.regras_governo add column if not exists catalogo_linha_id bigint;
alter table public.regras_governo add column if not exists chave_variante_origem text;
alter table public.regras_governo add column if not exists dados_origem jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname='fk_regras_governo_catalogo_linha') then
    alter table public.regras_governo add constraint fk_regras_governo_catalogo_linha foreign key (catalogo_linha_id,catalogo_versao_id) references public.catalogo_linhas_versoes(id,catalogo_versao_id) on delete restrict;
  end if;
end $$;

create or replace function public.validar_dominio_catalogo_operacional() returns trigger language plpgsql as $$
declare esperado text;
begin
  esperado := case tg_table_name when 'base_ncm' then 'NCM' when 'base_servicos' then 'NBS' when 'regras_governo' then 'GOVERNO' end;
  if new.catalogo_versao_id is not null and not exists (select 1 from public.catalogo_versoes where id=new.catalogo_versao_id and dominio=esperado) then
    raise exception 'Domínio de catálogo inválido para %: esperado %', tg_table_name, esperado;
  end if;
  return new;
end $$;
drop trigger if exists tg_base_ncm_dominio_catalogo on public.base_ncm;
create trigger tg_base_ncm_dominio_catalogo before insert or update of catalogo_versao_id on public.base_ncm for each row execute function public.validar_dominio_catalogo_operacional();
drop trigger if exists tg_base_servicos_dominio_catalogo on public.base_servicos;
create trigger tg_base_servicos_dominio_catalogo before insert or update of catalogo_versao_id on public.base_servicos for each row execute function public.validar_dominio_catalogo_operacional();
drop trigger if exists tg_regras_governo_dominio_catalogo on public.regras_governo;
create trigger tg_regras_governo_dominio_catalogo before insert or update of catalogo_versao_id on public.regras_governo for each row execute function public.validar_dominio_catalogo_operacional();

create index if not exists ix_catalogo_linhas_versao on public.catalogo_linhas_versoes(catalogo_versao_id);
create index if not exists ix_motor_execucao_catalogos_versao on public.motor_execucao_catalogos(catalogo_versao_id);
create index if not exists ix_regime_evidencias_cnpj_resolucao on public.regime_evidencias_cnpj(cnpj,origem_evidencia,consultado_em desc);
create index if not exists ix_base_ncm_catalogo_linha on public.base_ncm(catalogo_linha_id);
create index if not exists ix_base_servicos_catalogo_linha on public.base_servicos(catalogo_linha_id);
create index if not exists ix_regras_governo_catalogo_linha on public.regras_governo(catalogo_linha_id);
