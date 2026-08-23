-- A carga original foi feita a partir de três arquivos informados pelo
-- consultor. O leiaute dos CSVs não trouxe uma coluna uniforme de regime,
-- portanto a origem do arquivo é a evidência correta para a classificação.
update public.base_regime set regime = 'lucro_real'
where fonte = 'Lucro Real.csv' and ano = 2024;

update public.base_regime set regime = 'imune_isento'
where fonte = 'imunes-e-isentas-2023-2024.csv' and ano = 2024;

delete from public.base_regime_importacoes
where arquivo = 'Base RFB 2024 — carga compartilhada'
   or arquivo in ('Lucro Real.csv', 'Lucro Presumido 2024.csv', 'imunes-e-isentas-2023-2024.csv');

insert into public.base_regime_importacoes (arquivo, regime, ano, linhas, importados, invalidos, duplicados, segundos)
select fonte, max(regime), ano, count(*)::int, count(*)::int, 0, 0, null
from public.base_regime
where ano = 2024
  and fonte in ('Lucro Real.csv', 'Lucro Presumido 2024.csv', 'imunes-e-isentas-2023-2024.csv')
group by fonte, ano;
