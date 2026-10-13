-- Fila incremental idempotente. A restrição parcial continua impedindo dois
-- jobs ativos, mas a segunda solicitação passa a incorporar seu delta ao job
-- existente em vez de devolver erro de chave única à interface.
create or replace function public.enfileirar_job_carteira(
  p_id uuid,
  p_processamento_id bigint,
  p_grupo_id uuid,
  p_empresa_id bigint,
  p_competencia text,
  p_tipo_job text,
  p_prioridade integer,
  p_payload jsonb,
  p_criado_em timestamptz default now()
)
returns public.jobs_carteira
language plpgsql
security definer
set search_path = public
as $$
declare v_job public.jobs_carteira%rowtype;
begin
  insert into public.jobs_carteira
    (id,processamento_id,grupo_id,empresa_id,competencia,tipo_job,prioridade,status,payload,criado_em)
  values
    (p_id,p_processamento_id,p_grupo_id,p_empresa_id,p_competencia,p_tipo_job,p_prioridade,'PENDENTE',coalesce(p_payload,'{}'::jsonb),coalesce(p_criado_em,now()))
  on conflict (empresa_id,competencia,tipo_job) where status in ('PENDENTE','PROCESSANDO') do update
  set payload = case when excluded.tipo_job='MOTOR_INCREMENTAL' then
      jsonb_set(
        jsonb_set(coalesce(jobs_carteira.payload,'{}'::jsonb),'{movimento_ids}',
          (select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from (
            select value::bigint id from jsonb_array_elements_text(coalesce(jobs_carteira.payload->'movimento_ids','[]'::jsonb))
            union
            select value::bigint id from jsonb_array_elements_text(coalesce(excluded.payload->'movimento_ids','[]'::jsonb))
          ) ids),true),
        '{identidade_movimento}','"SUPABASE_CANONICA_V1"'::jsonb,true)
    else jobs_carteira.payload end
  returning * into v_job;
  return v_job;
end;
$$;

revoke all on function public.enfileirar_job_carteira(uuid,bigint,uuid,bigint,text,text,integer,jsonb,timestamptz) from public, anon, authenticated;
grant execute on function public.enfileirar_job_carteira(uuid,bigint,uuid,bigint,text,text,integer,jsonb,timestamptz) to service_role;
