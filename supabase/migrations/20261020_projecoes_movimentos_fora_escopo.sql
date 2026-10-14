-- Saídas para clientes não participam da fotografia de PIS/Cofins de
-- fornecedores. O estado explícito evita que ausência deliberada de cálculo
-- seja apresentada como pendência fiscal.
alter table public.projecoes_movimentos_estado
  drop constraint if exists projecoes_movimentos_estado_situacao_check;

alter table public.projecoes_movimentos_estado
  add constraint projecoes_movimentos_estado_situacao_check
  check (situacao in ('ATUAL','ATUALIZACAO_PENDENTE','FALHOU','PENDENCIA_REAL','FORA_ESCOPO'));
