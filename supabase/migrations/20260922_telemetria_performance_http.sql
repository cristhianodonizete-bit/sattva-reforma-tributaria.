-- Telemetria técnica agregada: sem payload, documento, CNPJ ou identificador de usuário.
create table if not exists public.telemetria_performance_http (
  id bigint generated always as identity primary key,
  janela_inicio timestamptz not null,
  janela_fim timestamptz not null,
  rota text not null,
  requisicoes integer not null,
  erros integer not null default 0,
  lentas_acima_1s integer not null default 0,
  media_ms numeric not null,
  p50_ms numeric not null,
  p95_ms numeric not null,
  max_ms numeric not null,
  heap_ultimo_mb numeric,
  rss_ultimo_mb numeric,
  criado_em timestamptz not null default now()
);
create index if not exists ix_telemetria_performance_http_criado_em on public.telemetria_performance_http(criado_em desc);
alter table public.telemetria_performance_http enable row level security;
-- Retenção explícita: 30 dias. A execução pode ser agendada pelo operador.
create or replace function public.limpar_telemetria_performance_http()
returns integer language plpgsql security definer as $$
declare removidas integer;
begin
  delete from public.telemetria_performance_http where criado_em < now() - interval '30 days';
  get diagnostics removidas = row_count;
  return removidas;
end $$;
