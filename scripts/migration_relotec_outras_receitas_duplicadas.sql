-- Correção auditável: mantém a primeira importação de cada lançamento REC da
-- Relotec e sinaliza a segunda cópia exata. Nada é apagado; as cópias deixam
-- de participar de perfil, comparativos e cálculo do motor.
UPDATE public.receitas_sem_dfe
SET status_validacao = 'POSSIVEL_DUPLICIDADE',
    status_comparabilidade = 'DUPLICIDADE_QUESTOR_IDENTIFICADA',
    atualizado_em = NOW()
WHERE id IN (16, 18, 20, 22, 24, 26, 28)
  AND empresa_id = (SELECT id FROM public.empresas WHERE razao_social = 'RELOTEC COMÉRCIO LTDA' LIMIT 1)
  AND especie_questor = 'REC';
