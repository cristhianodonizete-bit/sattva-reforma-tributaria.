-- Defesa no banco: mesmo um caminho futuro que tente ativar linhas fora da
-- RPC não pode deixar duas execuções visíveis para a mesma empresa.
create or replace function public.bloquear_fotografia_ativa_mista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.ativo then
    if exists (
      select 1
        from public.motor_resultados_operacionais atual
       where atual.empresa_id = new.empresa_id
         and atual.ativo = true
         and atual.execucao_id <> new.execucao_id
         and atual.id <> new.id
    ) then
      raise exception 'Fotografia ativa mista bloqueada para a empresa %: execuções % e %',
        new.empresa_id, new.execucao_id,
        (select atual.execucao_id from public.motor_resultados_operacionais atual
          where atual.empresa_id = new.empresa_id and atual.ativo = true
            and atual.execucao_id <> new.execucao_id and atual.id <> new.id limit 1);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bloquear_fotografia_ativa_mista on public.motor_resultados_operacionais;
create trigger trg_bloquear_fotografia_ativa_mista
before insert or update of ativo, execucao_id on public.motor_resultados_operacionais
for each row execute function public.bloquear_fotografia_ativa_mista();
