#!/usr/bin/env node
/* Primeira regra legal: somente enquadramento, sem fórmula econômica. */
require('dotenv').config();
const db = require('../src/db');
const cobertura = require('../src/services/coberturaDiagnostico');
const regra = require('../src/services/resolvedorRegra');

const REGRA = {
  id: 'LC214_ART4_OPERACAO_ONEROSA_V1', familia: 'OPERACAO_GERAL', subfamilia: 'OPERACAO_ONEROSA',
  tipo_operacao: 'FORNECIMENTO_ONEROSO', direcao: null, perfil_fornecedor: null, perfil_adquirente: null,
  regime_fornecedor: null, regime_adquirente: null, ncm: null, nbs: null, cclasstrib: null, cst: null, cfop: null,
  papel_cadeia: null, unidade: null, condicoes_obrigatorias: JSON.stringify(['contraprestacao']),
  condicoes_excludentes: JSON.stringify(['operacao_nao_onerosa']), tratamento_resultante: 'INCIDENCIA_OPERACAO_ONEROSA',
  formula_id: null, fundamento_legal: 'Lei Complementar nº 214/2025, art. 4º, caput',
  vigencia_inicio: '2027-01-01', vigencia_fim: null, prioridade: 50, versao: 1, status: 'ATIVA',
  fonte: 'Planalto — Lei Complementar nº 214/2025',
  evidencia: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art4',
};
const COLUNAS = Object.keys(REGRA);

async function main() {
  const sql = `INSERT INTO regras_enquadramento (${COLUNAS.join(',')}) VALUES (${COLUNAS.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${COLUNAS.filter((x) => x !== 'id' && x !== 'versao').map((x) => `${x}=excluded.${x}`).join(',')}`;
  db.prepare(sql).run(...COLUNAS.map((c) => REGRA[c]));
  const sync = await cobertura.sincronizarMestresCompartilhados();
  const ok = await regra.resolverCompartilhado({ tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2027-01-01' });
  const pendente = await regra.resolverCompartilhado({ tipo_operacao: 'FORNECIMENTO_ONEROSO', data: '2027-01-01' });
  const anterior = await regra.resolverCompartilhado({ tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2026-12-31' });
  if (ok.regra?.id !== REGRA.id || pendente.status !== 'SUJEITO_VALIDACAO' || anterior.status !== 'INDETERMINADO') throw new Error('Homologação da regra legal não produziu os estados esperados.');
  console.log(JSON.stringify({ regra: { id: REGRA.id, fundamento: REGRA.fundamento_legal, vigencia_inicio: REGRA.vigencia_inicio, formula_id: REGRA.formula_id }, sync,
    homologacao: { condicao_atendida: { status: ok.status, origem: ok.origem, regra: ok.regra?.id }, condicao_ausente: { status: pendente.status, pendencias: pendente.pendencias }, anterior_vigencia: { status: anterior.status } } }, null, 2));
}
main().catch((erro) => { console.error(`Primeira regra Fase 2A: ${erro.message}`); process.exit(1); });
