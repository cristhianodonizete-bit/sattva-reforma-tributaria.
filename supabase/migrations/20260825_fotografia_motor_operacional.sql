-- Fotografia oficial do motor, compartilhada entre instâncias do Render.
-- Evita que uma publicação/reinício refaça a carteira inteira apenas porque o
-- disco local é efêmero. Cada nova execução substitui a fotografia da empresa.
create table if not exists public.motor_execucoes_operacionais (
  id bigint primary key,
  empresa_id bigint not null,
  dados jsonb not null
);

create index if not exists ix_motor_execucoes_operacionais_empresa
  on public.motor_execucoes_operacionais (empresa_id);
create index if not exists ix_motor_resultados_operacionais_empresa
  on public.motor_resultados_operacionais (empresa_id);

alter table public.motor_execucoes_operacionais enable row level security;
alter table public.motor_resultados_operacionais enable row level security;
