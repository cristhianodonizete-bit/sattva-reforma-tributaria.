#!/usr/bin/env node
/* Baixa a fotografia seletiva já concluída e registra a medição pós-teste. */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const operacao = require('../src/services/operacaoCompartilhada');
const cobertura = require('../src/services/coberturaDiagnostico');
const excecoes = require('../src/services/excecoesMotor');
const oficial = require('../src/services/consolidacaoOficial');
const EMPRESA_ID = 1;
async function main() {
  // Os movimentos/cadastros já foram sincronizados antes deste fechamento;
  // aqui substituímos somente a fotografia, após sua validação de integridade.
  const baixado = await operacao.baixarResultadosMotor();
  const ex = oficial.ultimaExecucao(EMPRESA_ID, { executarSeAusente: false });
  if (!ex) throw new Error('Fotografia ativa não foi encontrada após a baixa do Supabase.');
  excecoes.sincronizar(EMPRESA_ID, ex.id);
  const foto = cobertura.registrarFotografia(EMPRESA_ID, 'FASE_2A_REGRA_SIMPLES_POS');
  const sync = await cobertura.sincronizarMestresCompartilhados(EMPRESA_ID);
  const linhas = oficial.linhas(EMPRESA_ID, { executarSeAusente: false }).linhas;
  const simples = linhas.filter((x) => x.sentido === 'entrada' && x.regime_cbs_emitente === 'SIMPLES_DAS' && x.regime_cbs_adquirente === 'REGULAR');
  const detalhe = simples.map((x) => ({ movimento_id: x.movimento_id, valor: x.preco_atual, credito_cbs: x.credito_cbs, status: x.status_credito_determinacao || x.status_credito, regra: x.detalhe?.credito?.elegibilidadeLegal || null, origem: x.detalhe?.credito?.origem || null, natureza: x.detalhe?.credito?.natureza || null }));
  const saida = { baixado, execucao: ex, foto, sync, dependentes: detalhe, criado_em: new Date().toISOString() };
  const arquivo = path.join(__dirname, '..', 'auditorias', 'fase2a-regra-simples-pos.json');
  fs.writeFileSync(arquivo, JSON.stringify(saida, null, 2));
  console.log(JSON.stringify({ baixado, execucao: ex.id, dependentes: { quantidade: detalhe.length, valor: detalhe.reduce((s, x) => s + Number(x.valor || 0), 0), credito: detalhe.reduce((s, x) => s + Number(x.credito_cbs || 0), 0), por_status: detalhe.reduce((m, x) => { m[x.status] = (m[x.status] || 0) + 1; return m; }, {}) }, cobertura: foto.fotografia.cobertura, excecoes: foto.excecoes.resumo, arquivo }, null, 2));
}
main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
