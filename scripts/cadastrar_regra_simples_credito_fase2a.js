#!/usr/bin/env node
/* Regra legal de elegibilidade. Não define percentual de crédito. */
require('dotenv').config();
const db = require('../src/db');
const cobertura = require('../src/services/coberturaDiagnostico');
const resolvedor = require('../src/services/resolvedorRegra');

const REGRA = {
  id: 'LC214_SIMPLES_CREDITO_ADQUIRENTE_REGULAR_V1', familia: 'CREDITO_CBS', subfamilia: 'SIMPLES_NACIONAL',
  tipo_operacao: 'AQUISICAO', direcao: 'ENTRADA', perfil_fornecedor: 'SIMPLES', perfil_adquirente: 'REGULAR',
  regime_fornecedor: 'SIMPLES_DAS', regime_adquirente: 'REGULAR', ncm: null, nbs: null, cclasstrib: null, cst: null, cfop: null,
  papel_cadeia: null, unidade: null,
  condicoes_obrigatorias: JSON.stringify(['operacao_entrada','fornecedor_simples','adquirente_regular','aquisicao_abrangida','documento_fiscal']),
  condicoes_excludentes: JSON.stringify(['fornecedor_mei','adquirente_simples']),
  tratamento_resultante: 'ELEGIVEL_A_CREDITO_SIMPLES', formula_id: null,
  fundamento_legal: 'Lei Complementar nº 214/2025, art. 28, § 10, II',
  vigencia_inicio: '2027-01-01', vigencia_fim: null, prioridade: 90, versao: 1, status: 'ATIVA',
  fonte: 'Planalto — Lei Complementar nº 214/2025',
  evidencia: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm#art28',
};
const COLUNAS = Object.keys(REGRA);
async function main() {
  const sql = `INSERT INTO regras_enquadramento (${COLUNAS.join(',')}) VALUES (${COLUNAS.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${COLUNAS.filter((x) => !['id','versao'].includes(x)).map((x) => `${x}=excluded.${x}`).join(',')}`;
  db.prepare(sql).run(...COLUNAS.map((x) => REGRA[x]));
  const ok = resolvedor.resolver({ tipo_operacao: 'AQUISICAO', direcao: 'ENTRADA', data: '2027-01-01', fornecedor: { regime: 'simples_nacional' }, adquirente: { regime: 'regime_regular' }, operacao_entrada: true, fornecedor_simples: true, adquirente_regular: true, aquisicao_abrangida: true, documento_fiscal: true });
  const pendente = resolvedor.resolver({ tipo_operacao: 'AQUISICAO', direcao: 'ENTRADA', data: '2027-01-01', fornecedor: { regime: 'simples_nacional' }, adquirente: { regime: 'regime_regular' }, operacao_entrada: true, fornecedor_simples: true, adquirente_regular: true, aquisicao_abrangida: true });
  const mei = resolvedor.resolver({ tipo_operacao: 'AQUISICAO', direcao: 'ENTRADA', data: '2027-01-01', fornecedor: { regime: 'mei' }, adquirente: { regime: 'regime_regular' }, operacao_entrada: true, fornecedor_simples: true, adquirente_regular: true, aquisicao_abrangida: true, documento_fiscal: true, fornecedor_mei: true });
  if (ok.regra?.id !== REGRA.id || pendente.status !== 'SUJEITO_VALIDACAO' || mei.regra) throw new Error('Regra legal não passou nos testes de elegibilidade, condição pendente e exclusão MEI.');
  const sync = await cobertura.sincronizarMestresCompartilhados(1);
  console.log(JSON.stringify({ regra: REGRA, homologacao: { elegivel: ok.status, condicao_ausente: pendente.status, mei: mei.status }, sync }, null, 2));
}
main().catch((erro) => { console.error(`Regra Simples Fase 2A: ${erro.message}`); process.exit(1); });
