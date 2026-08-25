-- Complemento operacional da fila: retry com espera, resultado e
-- deduplicação de jobs ainda ativos por empresa/competência/tipo.
alter table public.jobs_carteira add column if not exists proxima_tentativa_em timestamptz;
alter table public.jobs_carteira add column if not exists resultado jsonb;

create unique index if not exists ux_jobs_carteira_ativo
  on public.jobs_carteira (empresa_id, competencia, tipo_job)
  where status in ('PENDENTE','PROCESSANDO');

create or replace function public.claim_job_carteira(p_worker_id text)
returns setof public.jobs_carteira
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  select id into v_id from public.jobs_carteira
    where status='PENDENTE'
      and (proxima_tentativa_em is null or proxima_tentativa_em <= now())
    order by prioridade desc, criado_em
    for update skip locked limit 1;
  if v_id is null then return; end if;
  update public.jobs_carteira set status='PROCESSANDO', worker_id=p_worker_id,
    tentativas=tentativas+1, iniciado_em=coalesce(iniciado_em,now()),
    heartbeat=now(), erro=null, proxima_tentativa_em=null
    where id=v_id;
  return query select * from public.jobs_carteira where id=v_id;
end $$;
