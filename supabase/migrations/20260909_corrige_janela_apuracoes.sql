-- A tabela já existia em instalações anteriores; estes campos completam a
-- configuração da janela de apurações sem recriar políticas de acesso.
alter table public.empresa_periodo_analisado
  add column if not exists apuracao_meses integer not null default 12
  check (apuracao_meses >= 12);

alter table public.empresa_periodo_analisado
  add column if not exists apuracao_inclui_exercicio boolean not null default true;
