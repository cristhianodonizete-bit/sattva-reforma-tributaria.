-- Fila durável de processamento em carteira. O servidor usa a chave secreta;
-- RLS permanece habilitado para impedir uso direto por clientes.
create table if not exists public.jobs_carteira (
  id uuid primary key default gen_random_uuid(),
  processamento_id bigint,
  empresa_id bigint not null,
  competencia text,
  tipo_job text not null default 'RECALCULO_INCREMENTAL',
  prioridade integer default 0,
  status text not null default 'PENDENTE' check (status in ('PENDENTE','PROCESSANDO','CONCLUIDO','FALHOU','CANCELADO')),
  tentativas integer not null default 0,
  max_tentativas integer not null default 3,
  payload jsonb default '{}'::jsonb,
  worker_id text,
  heartbeat timestamptz,
  erro text,
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  finalizado_em timestamptz,
  unique (processamento_id, empresa_id, competencia, tipo_job)
);
create index if not exists ix_jobs_carteira_claim on public.jobs_carteira(status, prioridade desc, criado_em);
alter table public.jobs_carteira enable row level security;

create or replace function public.claim_job_carteira(p_worker_id text)
returns setof public.jobs_carteira
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from public.jobs_carteira
    where status='PENDENTE'
    order by prioridade desc, criado_em
    for update skip locked limit 1;
  if v_id is null then return; end if;
  update public.jobs_carteira set status='PROCESSANDO', worker_id=p_worker_id,
    tentativas=tentativas+1, iniciado_em=coalesce(iniciado_em,now()), heartbeat=now(), erro=null
    where id=v_id;
  return query select * from public.jobs_carteira where id=v_id;
end $$;

create or replace function public.recuperar_jobs_carteira_abandonados(p_minutos integer default 10)
returns integer language plpgsql security definer set search_path = public as $$
declare v_total integer;
begin
  update public.jobs_carteira set status='PENDENTE', worker_id=null, heartbeat=null,
    erro=coalesce(erro || E'\n','') || 'Worker sem heartbeat; job retomado automaticamente.'
  where status='PROCESSANDO' and heartbeat < now() - make_interval(mins => p_minutos)
    and tentativas < max_tentativas;
  get diagnostics v_total = row_count;
  update public.jobs_carteira set status='FALHOU', finalizado_em=now(),
    erro=coalesce(erro || E'\n','') || 'Número máximo de tentativas alcançado.'
  where status='PROCESSANDO' and heartbeat < now() - make_interval(mins => p_minutos)
    and tentativas >= max_tentativas;
  return v_total;
end $$;
