alter table public.motor_resultados_operacionais add column if not exists tipo_credito text;
alter table public.motor_resultados_operacionais add column if not exists modalidade_credito text;
alter table public.motor_resultados_operacionais add column if not exists status_credito_determinacao text;
alter table public.motor_resultados_operacionais add column if not exists regime_cbs_emitente text;
alter table public.motor_resultados_operacionais add column if not exists regime_cbs_adquirente text;
