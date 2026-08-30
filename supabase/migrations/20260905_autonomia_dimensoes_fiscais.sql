-- Etapa 3D: dimensões aditivas de autonomia; não altera valores fiscais.
alter table public.motor_resultados_operacionais
  add column if not exists autonomia_calculo_cbs_propria boolean,
  add column if not exists autonomia_credito_entrada boolean,
  add column if not exists autonomia_credito_cliente boolean,
  add column if not exists autonomia_classificatoria text,
  add column if not exists autonomia_diagnostico_completo boolean,
  add column if not exists memoria_autonomia_dimensoes jsonb;

alter table public.telemetria_autonomia_execucoes
  add column if not exists taxa_autonomia_calculo_cbs_propria numeric,
  add column if not exists taxa_autonomia_credito_entrada numeric,
  add column if not exists taxa_autonomia_credito_cliente numeric,
  add column if not exists taxa_autonomia_classificatoria numeric,
  add column if not exists taxa_autonomia_diagnostico_completo numeric,
  add column if not exists dimensoes_json jsonb not null default '{}'::jsonb;

create index if not exists ix_motor_autonomia_dimensoes
  on public.motor_resultados_operacionais(empresa_id,execucao_id,autonomia_calculo_cbs_propria,autonomia_diagnostico_completo);
