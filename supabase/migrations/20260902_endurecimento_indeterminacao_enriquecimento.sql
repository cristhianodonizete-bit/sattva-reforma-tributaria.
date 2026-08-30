-- Etapa 2Q — endurecimento de futuras execuções e fila de evidências.
-- Não altera motor_resultados_operacionais nem a execução histórica ativa.

create table if not exists public.decisoes_memoria_contexto (
  id bigint generated always as identity primary key,
  decisao_id bigint not null unique references public.decisoes_memoria(id) on delete restrict,
  motivo_indeterminacao text,
  evidencia_necessaria jsonb not null default '[]'::jsonb,
  regra_tentada text,
  candidatos_existentes jsonb not null default '[]'::jsonb,
  dado_resolvedor text,
  status_historico text check (status_historico in ('LEGADO_NAO_REPRODUZIVEL')),
  criado_em timestamptz not null default now(),
  check (motivo_indeterminacao is null or motivo_indeterminacao in
    ('SEM_CATALOGO','SEM_EVIDENCIA','MULTIPLOS_CANDIDATOS','SEM_BASE_PIS_COFINS','SEM_NBS','SEM_REGRA_APLICAVEL','REGRA_INCONCLUSIVA'))
);

create table if not exists public.enriquecimento_servicos_evidencias (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  movimento_id bigint not null references public.movimentos(id) on delete restrict,
  ctribnac_original text,
  lc116_canonico text,
  nbs_original text,
  indop text,
  onerosa text,
  exterior text,
  local_incidencia text,
  descricao_estruturada text,
  cclasstrib text,
  origem_evidencia text not null,
  status_validacao text not null default 'PENDENTE' check (status_validacao in ('PENDENTE','VALIDADA','REJEITADA')),
  criado_em timestamptz not null default now(),
  unique (empresa_id, movimento_id, origem_evidencia)
);

create table if not exists public.enriquecimento_pis_cofins_evidencias (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  movimento_id bigint not null references public.movimentos(id) on delete restrict,
  pis_documentado numeric,
  cofins_documentada numeric,
  cst_pis text,
  cst_cofins text,
  regime_incidencia text,
  sped_referencia text,
  referencia_fiscal_empresa_item text,
  tratamento_especifico text,
  vigencia_inicio date,
  vigencia_fim date,
  origem_evidencia text not null,
  status_validacao text not null default 'PENDENTE' check (status_validacao in ('PENDENTE','VALIDADA','REJEITADA')),
  criado_em timestamptz not null default now(),
  unique (empresa_id, movimento_id, origem_evidencia)
);

create table if not exists public.pendencias_enriquecimento_fiscal (
  id bigint generated always as identity primary key,
  empresa_id bigint not null references public.empresas(id) on delete restrict,
  movimento_id bigint not null references public.movimentos(id) on delete restrict,
  resultado_id bigint references public.motor_resultados_operacionais(id) on delete restrict,
  tipo_pendencia text not null check (tipo_pendencia in
    ('SEM_CATALOGO','SEM_EVIDENCIA','MULTIPLOS_CANDIDATOS','SEM_BASE_PIS_COFINS','SEM_NBS','SEM_REGRA_APLICAVEL','REGRA_INCONCLUSIVA')),
  evidencia_necessaria jsonb not null,
  prioridade text not null default 'MEDIA' check (prioridade in ('ALTA','MEDIA','BAIXA')),
  status text not null default 'ABERTA' check (status in ('ABERTA','EM_COLETA','RESOLVIDA','CANCELADA')),
  origem text not null default 'MOTOR_FISCAL',
  detalhe jsonb not null default '{}'::jsonb,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  unique nulls not distinct (empresa_id, movimento_id, resultado_id, tipo_pendencia, status)
);

create index if not exists ix_pendencias_enriquecimento_abertas
  on public.pendencias_enriquecimento_fiscal(empresa_id, status, prioridade, criado_em);
create index if not exists ix_enriquecimento_servicos_movimento
  on public.enriquecimento_servicos_evidencias(empresa_id, movimento_id, status_validacao);
create index if not exists ix_enriquecimento_pis_movimento
  on public.enriquecimento_pis_cofins_evidencias(empresa_id, movimento_id, status_validacao);

-- Somente memória adicional: o resultado histórico preserva seus números e
-- classificações. As 17 decisões identificadas na Etapa 2P ficam explícitas
-- como legado não reproduzível pelas próximas execuções.
insert into public.decisoes_memoria_contexto
  (decisao_id, motivo_indeterminacao, evidencia_necessaria, regra_tentada, candidatos_existentes, dado_resolvedor, status_historico)
select dm.id,
  'REGRA_INCONCLUSIVA',
  '["CATALOGO_OFICIAL","REGRA_VERSIONADA_APLICAVEL"]'::jsonb,
  dm.dados_memoria->>'metodo_pis_cofins', '[]'::jsonb,
  'Etapa 2P: fallback técnico histórico sem fundamento reproduzível',
  'LEGADO_NAO_REPRODUZIVEL'
from public.decisoes_memoria dm
where dm.empresa_id=1 and dm.execucao_id=14
  and dm.tipo_decisao='RECONSTRUCAO_PIS_COFINS'
  and upper(coalesce(dm.origem_historica,'')) = 'FALLBACK_TECNICO'
on conflict (decisao_id) do nothing;

-- A fila aponta o que falta; não reclassifica e não atualiza o resultado.
insert into public.pendencias_enriquecimento_fiscal
  (empresa_id,movimento_id,resultado_id,tipo_pendencia,evidencia_necessaria,prioridade,status,origem,detalhe)
select r.empresa_id,r.movimento_id,r.id,'SEM_NBS',
  '["NBS_ORIGINAL","INDOP","CADASTRO_SERVICO_VALIDADO"]'::jsonb,'ALTA','ABERTA','ETAPA_2Q',
  jsonb_build_object('execucao_id',r.execucao_id,'motivo','LC116 recuperado, mas múltiplos NBS sem condicionante de desempate')
from public.motor_resultados_operacionais r join public.movimentos m on m.id=r.movimento_id
where r.empresa_id=1 and r.execucao_id=14 and r.ativo=true
  and upper(coalesce(r.dados->>'status_classificacao',''))='REQUER_VALIDACAO'
  and nullif(trim(coalesce(m.nbs,'')),'') is null
  and coalesce(m.cst,'') in ('010501','010701','140101','170201')
on conflict do nothing;

insert into public.pendencias_enriquecimento_fiscal
  (empresa_id,movimento_id,resultado_id,tipo_pendencia,evidencia_necessaria,prioridade,status,origem,detalhe)
select r.empresa_id,r.movimento_id,r.id,'SEM_BASE_PIS_COFINS',
  '["PIS_DOCUMENTADO","COFINS_DOCUMENTADA","SPED_OU_REFERENCIA_FISCAL_VALIDADA"]'::jsonb,'ALTA','ABERTA','ETAPA_2Q',
  jsonb_build_object('execucao_id',r.execucao_id,'motivo','Base econômica depende de evidência documental ou cadastral complementar')
from public.motor_resultados_operacionais r
where r.empresa_id=1 and r.execucao_id=14 and r.ativo=true
  and upper(coalesce(r.codigo_causa,r.dados->>'codigo_causa',''))='EVIDENCIA_BASE_INSUFICIENTE'
on conflict do nothing;

insert into public.pendencias_enriquecimento_fiscal
  (empresa_id,movimento_id,resultado_id,tipo_pendencia,evidencia_necessaria,prioridade,status,origem,detalhe)
select dm.empresa_id,dm.movimento_id,dm.resultado_id,'REGRA_INCONCLUSIVA',
  '["CATALOGO_OFICIAL","REGRA_VERSIONADA_APLICAVEL"]'::jsonb,'MEDIA','ABERTA','ETAPA_2Q',
  jsonb_build_object('execucao_id',dm.execucao_id,'status_historico','LEGADO_NAO_REPRODUZIVEL')
from public.decisoes_memoria dm
where dm.empresa_id=1 and dm.execucao_id=14 and dm.tipo_decisao='RECONSTRUCAO_PIS_COFINS'
  and upper(coalesce(dm.origem_historica,''))='FALLBACK_TECNICO'
on conflict do nothing;
