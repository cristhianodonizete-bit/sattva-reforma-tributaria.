-- Matriz aprovada para o comparador de regimes. Não altera o motor CBS nem
-- resultados fiscais oficiais. Percentuais são decimais (15% = 0.15).
alter table public.param_irpj_csll_versionados
  add column if not exists limite_receita_anual numeric,
  add column if not exists acrescimo_percentual_base_excedente numeric,
  add column if not exists aplicacao_excedente text;

insert into public.param_irpj_csll_versionados
  (tributo, regime, natureza_receita, tipo_base, percentual_base, aliquota, adicional, limite_adicional,
   limite_receita_anual, acrescimo_percentual_base_excedente, aplicacao_excedente,
   vigencia_inicio, vigencia_fim, fonte, fundamento, versao, status)
values
  ('IRPJ','lucro_real','GERAL','MARGEM_OPERACIONAL',null,0.15,0.10,20000,null,null,null,'2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017','4D.2-2026','ATIVO'),
  ('CSLL','lucro_real','GERAL','MARGEM_OPERACIONAL',null,0.09,null,null,null,null,null,'2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017','4D.2-2026','ATIVO'),
  ('IRPJ','lucro_presumido','COMERCIO_INDUSTRIA','BASE_PRESUNCAO',0.08,0.15,0.10,20000,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('CSLL','lucro_presumido','COMERCIO_INDUSTRIA','BASE_PRESUNCAO',0.12,0.09,null,null,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('IRPJ','lucro_presumido','SERVICOS_GERAIS','BASE_PRESUNCAO',0.32,0.15,0.10,20000,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('CSLL','lucro_presumido','SERVICOS_GERAIS','BASE_PRESUNCAO',0.32,0.09,null,null,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('IRPJ','lucro_presumido','INTERMEDIACAO','BASE_PRESUNCAO',0.32,0.15,0.10,20000,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('CSLL','lucro_presumido','INTERMEDIACAO','BASE_PRESUNCAO',0.32,0.09,null,null,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('IRPJ','lucro_presumido','LOCACAO_CESSAO_BENS_DIREITOS','BASE_PRESUNCAO',0.32,0.15,0.10,20000,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('CSLL','lucro_presumido','LOCACAO_CESSAO_BENS_DIREITOS','BASE_PRESUNCAO',0.32,0.09,null,null,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('IRPJ','lucro_presumido','TRANSPORTE_CARGA','BASE_PRESUNCAO',0.08,0.15,0.10,20000,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('CSLL','lucro_presumido','TRANSPORTE_CARGA','BASE_PRESUNCAO',0.12,0.09,null,null,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('IRPJ','lucro_presumido','SERVICO_HOSPITALAR_QUALIFICADO','BASE_PRESUNCAO',0.08,0.15,0.10,20000,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 9.249/1995, arts. 3º e 15; Lei 9.430/1996; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO'),
  ('CSLL','lucro_presumido','SERVICO_HOSPITALAR_QUALIFICADO','BASE_PRESUNCAO',0.12,0.09,null,null,5000000,0.10,'PROPORCIONAL_ATIVIDADE','2026-01-01',null,'MATRIZ_JURIDICA_APROVADA_4D2','Lei 7.689/1988; Lei 9.249/1995, art. 20; IN RFB 1.700/2017; LC 224/2025; Decreto 12.808/2025','4D.2-2026','ATIVO')
on conflict (tributo, regime, natureza_receita, versao, vigencia_inicio) do update set
  tipo_base = excluded.tipo_base, percentual_base = excluded.percentual_base, aliquota = excluded.aliquota,
  adicional = excluded.adicional, limite_adicional = excluded.limite_adicional, limite_receita_anual = excluded.limite_receita_anual,
  acrescimo_percentual_base_excedente = excluded.acrescimo_percentual_base_excedente, aplicacao_excedente = excluded.aplicacao_excedente,
  vigencia_fim = excluded.vigencia_fim, fonte = excluded.fonte, fundamento = excluded.fundamento, status = excluded.status,
  atualizado_em = now();
