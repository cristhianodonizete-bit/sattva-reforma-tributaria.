-- Contrato PIS/Cofins V2: percentuais persistidos em pontos percentuais.
-- Esta migration deve rodar exclusivamente em manutenção, com workers fiscais
-- parados e com a confirmação explícita do contrato V1 na mesma transação:
--   SET LOCAL app.pis_cofins_percentual_legacy_verified = 'FATOR_DECIMAL_V1';
-- Não altera movimentos nem fotografias históricas do motor.

DO $$
DECLARE
  contrato jsonb;
  confirmado text := current_setting('app.pis_cofins_percentual_legacy_verified', true);
BEGIN
  -- A tabela já existe desde a migration operacional. A versão é uma prova
  -- explícita de escala, nunca uma inferência baseada no tamanho do número.
  SELECT dados INTO contrato
    FROM public.parametros_operacionais
   WHERE tabela = 'contrato_tecnico' AND chave = 'pis_cofins_percentual';

  IF contrato IS NOT NULL AND contrato->>'versao' = '2' THEN
    RAISE EXCEPTION 'Contrato PIS/Cofins já está na versão 2; conversão dupla bloqueada.';
  END IF;
  IF contrato IS NOT NULL AND contrato->>'versao' <> '1' THEN
    RAISE EXCEPTION 'Contrato PIS/Cofins desconhecido: %', contrato;
  END IF;
  IF confirmado IS DISTINCT FROM 'FATOR_DECIMAL_V1' THEN
    RAISE EXCEPTION 'Conversão bloqueada: confirme explicitamente o contrato legado FATOR_DECIMAL_V1 nesta transação.';
  END IF;

  -- A ausência do marcador só é admitida após a confirmação explícita acima.
  -- Ele registra que todas as colunas listadas usavam fator decimal no V1.
  IF contrato IS NULL THEN
    INSERT INTO public.parametros_operacionais (tabela, chave, dados)
    VALUES ('contrato_tecnico', 'pis_cofins_percentual',
      '{"versao": "1", "escala": "FATOR_DECIMAL", "confirmado_por_migration": true}'::jsonb);
  END IF;

  -- O Supabase publica param_regimes como fotografia JSON; este é o campo
  -- efetivamente consumido pelas instâncias recém-iniciadas.
  UPDATE public.parametros_operacionais p
     SET dados = (
       SELECT jsonb_agg(CASE
         WHEN jsonb_typeof(linha->'pis_cofins') = 'number'
           THEN jsonb_set(linha, '{pis_cofins}', to_jsonb((linha->>'pis_cofins')::numeric * 100))
         ELSE linha END)
       FROM jsonb_array_elements(p.dados) AS linha)
   WHERE p.tabela = 'configuracao' AND p.chave = 'param_regimes'
     AND jsonb_typeof(p.dados) = 'array';

  -- Cada coluna abaixo foi auditada como fator decimal no contrato V1. As
  -- tabelas podem não existir em instalações antigas, portanto são dinâmicas.
  IF to_regclass('public.param_regimes') IS NOT NULL THEN
    EXECUTE 'UPDATE public.param_regimes SET pis_cofins=pis_cofins*100 WHERE pis_cofins IS NOT NULL';
  END IF;
  IF to_regclass('public.base_ncm') IS NOT NULL THEN
    EXECUTE 'UPDATE public.base_ncm SET pis_percentual=pis_percentual*100, cofins_percentual=cofins_percentual*100, percentual_reconstrucao_sugerido=percentual_reconstrucao_sugerido*100';
  END IF;
  IF to_regclass('public.base_servicos') IS NOT NULL THEN
    EXECUTE 'UPDATE public.base_servicos SET pis_percentual=pis_percentual*100, cofins_percentual=cofins_percentual*100, pis_cumulativo_percentual=pis_cumulativo_percentual*100, cofins_cumulativo_percentual=cofins_cumulativo_percentual*100, total_cumulativo_percentual=total_cumulativo_percentual*100, percentual_reconstrucao_sugerido=percentual_reconstrucao_sugerido*100';
  END IF;
  IF to_regclass('public.empresa_servicos_fiscais') IS NOT NULL THEN
    EXECUTE 'UPDATE public.empresa_servicos_fiscais SET pis_cofins=pis_cofins*100 WHERE pis_cofins IS NOT NULL';
  END IF;
  IF to_regclass('public.enriquecimento_pis_cofins_evidencias') IS NOT NULL THEN
    EXECUTE 'UPDATE public.enriquecimento_pis_cofins_evidencias SET aliquota_pis=aliquota_pis*100, aliquota_cofins=aliquota_cofins*100';
  END IF;

  INSERT INTO public.parametros_operacionais (tabela, chave, dados)
  VALUES ('contrato_tecnico', 'pis_cofins_percentual',
    '{"versao": "2", "escala": "PONTOS_PERCENTUAIS", "migrado_de": "FATOR_DECIMAL_V1"}'::jsonb)
  ON CONFLICT (tabela, chave) DO UPDATE SET dados = excluded.dados;
END $$;
