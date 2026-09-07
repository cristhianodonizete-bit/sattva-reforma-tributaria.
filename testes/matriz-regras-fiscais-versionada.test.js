const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-matriz-versionada-'));
const db = require('../src/db');
const refs = require('../src/services/referenciasFiscaisOficiais');
const matriz = require('../src/services/matrizRegrasFiscaisVersionada');

refs.registrarReferencia({
  dominio: 'NCM', codigo: '30049099', descricao: 'Produto de teste',
  vigencia_inicio: '2026-01-01', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'a'.repeat(64),
});

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Regras PIS Cofins CBS');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

try {
const linhas = [
  { ID: 'PIS_TESTE_001', Tributo: 'PIS_COFINS', NCM: '3004.90.99', 'Vigência início': '2026-01-01', Prioridade: 100, 'Condições JSON': '[]', 'Tratamento PIS/COFINS': 'TRIBUTADA', 'CST PIS': '01', 'CST COFINS': '01', 'PIS (%)': 1.65, 'COFINS (%)': 7.6, Fundamento: 'Fundamento de teste', Fonte: 'Fonte oficial', 'Versão fonte': 'v1' },
  { ID: 'CBS_TESTE_001', Tributo: 'CBS', NCM: '30049099', 'Vigência início': '2026-01-01', Prioridade: 100, 'Condições JSON': '[]', 'CST IBS/CBS': '200', cClassTrib: '200038', 'Redução IBS (%)': 60, 'Redução CBS (%)': 60, Fundamento: 'Fundamento de teste', Fonte: 'Fonte oficial', 'Versão fonte': 'v1' },
];
const arquivo = planilha(linhas);
const previa = matriz.previsualizar(arquivo, { db });
assert.equal(previa.resumo.total, 2);
assert.equal(previa.resumo.pis_cofins, 1);
assert.equal(previa.resumo.cbs, 1);

const carga = matriz.importar(arquivo, { db });
assert.equal(carga.status, 'RASCUNHO');
assert.equal(carga.regras_importadas, 2);
assert.deepEqual(db.prepare('SELECT tributo,status FROM matriz_regras_fiscais_versionada ORDER BY id').all().map((x) => ({ ...x })), [
  { tributo: 'CBS', status: 'RASCUNHO' }, { tributo: 'PIS_COFINS', status: 'RASCUNHO' },
]);
assert.equal(JSON.parse(db.prepare("SELECT resultado_json FROM matriz_regras_fiscais_versionada WHERE id='PIS_TESTE_001'").get().resultado_json).pis_percentual, 1.65);

db.prepare("UPDATE matriz_regras_fiscais_versionada SET status='VALIDADA' WHERE id='PIS_TESTE_001'").run();
assert.throws(() => matriz.importar(arquivo, { db }), /não pode sobrescrever status VALIDADA/);

const invalida = planilha([{ ...linhas[0], ID: 'PIS_INVALIDA', NCM: '99999999' }]);
assert.throws(() => matriz.previsualizar(invalida, { db }), /não existe na referência oficial vigente/);

console.log('matriz-regras-fiscais-versionada: carga PIS/Cofins + CBS fica em rascunho e protege regras aprovadas');
} finally {
db.close();
fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true });
}
