const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-reprocessamento-pausado-'));
process.env.SATTVA_DADOS = dados;
process.env.REPROCESSAMENTO_AUTOMATICO_PAUSADO = '1';

const { agendarPendencias } = require('../src/services/reprocessamentoAutomatico');

(async () => {
  assert.deepEqual(await agendarPendencias(), [], 'a pausa deve impedir qualquer novo agendamento automático');
  console.log('reprocessamento-automatico-pausa: agendamento automático interrompido: OK');
})().finally(() => {
  try { require('../src/db').close?.(); } catch (_) {}
  fs.rmSync(dados, { recursive: true, force: true });
});
