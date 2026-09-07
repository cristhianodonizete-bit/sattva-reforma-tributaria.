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
refs.registrarReferencia({ dominio: 'NCM', codigo: '01012100', descricao: 'NCM residual', vigencia_inicio: '2026-01-01', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'b'.repeat(64) });
const nbs = refs.registrarReferencia({ dominio: 'NBS', codigo: '115013000', descricao: 'Serviço residual', vigencia_inicio: '2026-01-01', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'c'.repeat(64) });
const lc = refs.registrarReferencia({ dominio: 'LC116', codigo: '0107', descricao: 'Serviço', vigencia_inicio: '2026-01-01', fonte: 'Fonte oficial', versao_fonte: 'v1', hash_origem: 'd'.repeat(64) });
refs.registrarRelacaoNbsLc116({ nbs, lc116: lc, fonte: 'Correlação oficial', vigencia_inicio: '2026-01-01' });
db.prepare("INSERT INTO base_ncm (ncm,descricao,cst,cclasstrib) VALUES ('01012100','Regra legada preservada','000','000001')").run();

function planilha(linhas) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(linhas), 'Regras PIS Cofins CBS');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

try {
const linhas = [{
  'ID Regra': 'NCM_TESTE_001', 'Tipo de chave': 'NCM', NCM: '3004.90.99',
  'Vigência início': '2026-01-01', Prioridade: 100, 'Condições JSON': '[]',
  'Descrição / classificação CBS': 'Redução de teste', 'CST IBS/CBS': '200', cClassTrib: '200038', 'Redução IBS (%)': 60, 'Redução CBS (%)': 60,
  'Tratamento PIS/COFINS': 'TRIBUTADA', 'CST PIS': '01', 'CST COFINS': '01', 'PIS (%)': 1.65, 'COFINS (%)': 7.6,
  Fundamento: 'Fundamento de teste', Fonte: 'Fonte oficial', 'Versão fonte': 'v1',
}];
const arquivo = planilha(linhas);
const previa = matriz.previsualizar(arquivo, { db });
assert.equal(previa.resumo.total, 1);
assert.equal(previa.resumo.ncm, 1);

const carga = matriz.importar(arquivo, { db });
assert.equal(carga.status, 'OPERACIONAL');
assert.equal(carga.regras_importadas, 1);
assert.equal(db.prepare("SELECT COUNT(*) c FROM base_ncm WHERE ncm='30049099'").get().c, 1);
assert.equal(db.prepare("SELECT COUNT(*) c FROM base_ncm WHERE ncm='01012100'").get().c, 1);
const regra = db.prepare("SELECT cst,cclasstrib,reducao_cbs,pis_percentual,cofins_percentual FROM base_ncm WHERE ncm='30049099'").get();
assert.equal(regra.cst, '200'); assert.equal(regra.cclasstrib, '200038'); assert.equal(regra.reducao_cbs, 0.6); assert.equal(regra.pis_percentual, 1.65); assert.equal(regra.cofins_percentual, 7.6);

const atualizada = planilha([{ ...linhas[0], 'Redução CBS (%)': 30 }]);
matriz.importar(atualizada, { db });
assert.equal(db.prepare("SELECT reducao_cbs FROM base_ncm WHERE ncm='30049099'").get().reducao_cbs, 0.3);
assert.equal(db.prepare("SELECT COUNT(*) c FROM base_ncm WHERE ncm='30049099'").get().c, 1);

const condicional = planilha([{
  'ID Regra': 'PIS_CONDICIONAL_001', 'Tipo de chave': 'NCM', NCM: '30049099',
  'Vigência início': '2026-01-01', Prioridade: 200,
  'Condições JSON': '[{"fato":"papel_cadeia","operador":"IGUAL","valor":"IMPORTADOR"}]',
  'Tratamento PIS/COFINS': 'MONOFASICO', 'CST PIS': '04', 'CST COFINS': '04', 'PIS (%)': 0, 'COFINS (%)': 0,
  Fundamento: 'Fundamento condicional', Fonte: 'Fonte oficial', 'Versão fonte': 'v1',
}]);
const cargaCondicional = matriz.importar(condicional, { db });
assert.equal(cargaCondicional.condicionais_pis, 1);
assert.equal(db.prepare("SELECT status FROM regras_enquadramento WHERE id='CATALOGO_PIS_CONDICIONAL_001'").get().status, 'ATIVA');

const cobertura = matriz.completarCoberturaTotal({ db });
assert.equal(cobertura.ncm_residuais_criados, 0);
assert.equal(cobertura.nbs_residuais_criados, 1);
assert.equal(db.prepare("SELECT cclasstrib,tratamento_pis_cofins FROM base_servicos WHERE nbs='115013000'").get().cclasstrib, '000001');
assert.equal(db.prepare("SELECT tratamento_pis_cofins FROM base_servicos WHERE nbs='115013000'").get().tratamento_pis_cofins, 'REGRA_RESIDUAL_REGIME');

const invalida = planilha([{ ...linhas[0], 'ID Regra': 'PIS_INVALIDA', NCM: '99999999' }]);
assert.throws(() => matriz.previsualizar(invalida, { db }), /não existe na referência oficial vigente/);

console.log('matriz-regras-fiscais-versionada: carga integrada PIS/Cofins + CBS atualiza o catálogo sem DELETE global');
} finally {
db.close();
fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true });
}
