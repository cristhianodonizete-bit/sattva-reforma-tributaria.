alter table public.movimentos add column if not exists valor_produto numeric;
update public.movimentos
set valor_produto = valor,
    valor = coalesce(valor,0) + coalesce(frete,0) + coalesce(seguro,0) + coalesce(outras,0) - coalesce(desconto,0)
where origem = 'xml' and valor_produto is null;
