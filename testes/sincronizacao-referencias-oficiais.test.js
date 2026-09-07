const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-referencias-remotas-'));
const db = require('../src/db');
const refs = require('../src/services/referenciasFiscaisOficiais');
const matriz = require('../src/services/matrizRegrasFiscaisVersionada');

const resposta = (texto) => ({ ok: true, arrayBuffer: async () => Buffer.from(texto) });
const ncm = JSON.stringify({ Data_Ultima_Atualizacao_NCM: '2026-09-07', Ato: 'Teste', Nomenclaturas: [
  { Codigo: '01.02.90.00', Descricao: 'NCM completa', Data_Inicio: '01/01/2026', Data_Fim: '31/12/9999' },
] });
const nbs = Buffer.from('NBS 2.0;DESCRIÇÃO\r\n1.1501.30.00;Serviço completo\r\n', 'latin1');

(async () => {
  const carga = await refs.sincronizarReferenciasOficiaisVigentes({ banco: db, fetcher: async (url) => resposta(url.includes('portalunico.siscomex.gov.br') ? ncm : nbs) });
  assert.equal(carga.ncm_lidos, 1);
  assert.equal(carga.nbs_lidos, 1);
  assert.equal(carga.inseridos, 2);
  const cobertura = matriz.completarCoberturaTotal({ db });
  assert.equal(cobertura.ncm_residuais_criados, 1);
  assert.equal(cobertura.nbs_residuais_criados, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM base_ncm WHERE ncm='01029000'").get().c, 1);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM base_servicos WHERE nbs='115013000'").get().c, 1);
  assert.equal((await refs.sincronizarReferenciasOficiaisVigentes({ banco: db, fetcher: async (url) => resposta(url.includes('portalunico.siscomex.gov.br') ? ncm : nbs) })).inseridos, 0);
  console.log('sincronizacao-referencias-oficiais: fonte oficial, idempotência e cobertura residual validadas');
})().finally(() => { db.close(); fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true }); });
