-- Fotografia oficial do motor: preserva execuções históricas e identifica
-- explicitamente qual conjunto de resultados está vigente por empresa.
-- A Execução 1 é a baseline homologada da empresa 1 antes da correção da
-- precedência de PIS/COFINS; nada é excluído nesta migração.

alter table public.motor_resultados_operacionais
  add column if not exists execucao_id bigint,
  add column if not exists ativo boolean not null default false;

-- Resultados antigos já carregavam o identificador dentro de dados (jsonb).
update public.motor_resultados_operacionais
set execucao_id = nullif(dados ->> 'execucao_id', '')::bigint
where execucao_id is null
  and coalesce(dados ->> 'execucao_id', '') ~ '^[0-9]+$';

-- A fotografia homologada anterior permanece íntegra e é a única ativa até
-- que a Execução 2 completa seja gravada e ativada de modo transacional.
update public.motor_resultados_operacionais
set ativo = false
where empresa_id = 1;

update public.motor_resultados_operacionais
set ativo = true
where empresa_id = 1
  and execucao_id = 1;

create index if not exists ix_motor_resultados_operacionais_fotografia_ativa
  on public.motor_resultados_operacionais (empresa_id, ativo, execucao_id);

-- Garante uma única linha vigente por movimento, mas permite o histórico
-- completo em execuções anteriores.
create unique index if not exists ux_motor_resultados_operacionais_ativo_movimento
  on public.motor_resultados_operacionais (empresa_id, movimento_id)
  where ativo = true;
