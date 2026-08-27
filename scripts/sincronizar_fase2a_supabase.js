#!/usr/bin/env node
/* Publica somente cadastros mestres/regras/fotografias da Fase 2A. */
require('dotenv').config();
const cobertura = require('../src/services/coberturaDiagnostico');

async function main() {
  const empresaId = Number(process.argv[2] || 1);
  const popular = cobertura.popularCadastrosMestre();
  const primeira = await cobertura.sincronizarMestresCompartilhados(empresaId);
  const segunda = await cobertura.sincronizarMestresCompartilhados(empresaId);
  // A segunda execução deve ser idempotente: os mesmos registros são upsertados
  // pelas chaves estáveis, sem inserir novas fotografias lógicas.
  console.log(JSON.stringify({ empresa_id: empresaId, popular, primeira, segunda, mestres: cobertura.mestres() }, null, 2));
}
main().catch((erro) => { console.error(`Sincronização Fase 2A: ${erro.message}`); process.exit(1); });
