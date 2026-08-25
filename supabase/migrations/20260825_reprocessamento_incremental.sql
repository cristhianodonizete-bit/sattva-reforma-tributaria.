-- Dependências que explicam por que uma operação foi calculada.
-- Permitem invalidar somente a parcela afetada da carteira.
alter table public.motor_resultados_operacionais add column if not exists movimento_hash text;
alter table public.motor_resultados_operacionais add column if not exists regra_version text;
alter table public.motor_resultados_operacionais add column if not exists catalogo_version text;
alter table public.motor_resultados_operacionais add column if not exists parceiro_version text;
alter table public.motor_resultados_operacionais add column if not exists parametro_version text;
alter table public.motor_resultados_operacionais add column if not exists motor_version text;
create index if not exists ix_motor_resultados_operacionais_dependencias
  on public.motor_resultados_operacionais (empresa_id, movimento_id);
