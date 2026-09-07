const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dados = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-referencias-'));
process.env.SATTVA_DADOS = dados;
const db = require('../src/db');
const refs = require('../src/services/referenciasFiscaisOficiais');

assert.equal(refs.normalizarNcm('01.02.90.00'), '01029000');
assert.equal(refs.normalizarNbs('1.1501.30.00'), '115013000');
assert.equal(refs.normalizarLc116('1.07'), '0107');

assert.throws(() => refs.registrarReferencia({ dominio: 'NCM', codigo: '01029000' }), /Fonte oficial/);
assert.throws(() => refs.registrarReferencia({ dominio: 'NBS', codigo: '', fonte: 'Teste' }), /inválido/);

const ncm = refs.registrarReferencia({ dominio: 'NCM', codigo: '01.02.90.00', descricao: 'Outros', fonte: 'RFB', versao_fonte: '2026-02' });
assert.equal(ncm.criado, true);
assert.equal(refs.registrarReferencia({ dominio: 'NCM', codigo: '01029000', descricao: 'Outro texto não substitui a fonte', fonte: 'RFB', versao_fonte: '2026-02' }).criado, false);
assert.equal(refs.consultar({ ncm: '01029000' }).length, 1);

const relacao = refs.registrarRelacaoNbsLc116({
  nbs: { codigo: '1.1501.30.00', descricao: 'Suporte de TI', fonte: 'NBS oficial', versao_fonte: '2026' },
  lc116: { codigo: '1.07', descricao: 'Suporte técnico', fonte: 'LC 116', versao_fonte: '2003' },
  fonte: 'Correlação oficial', evidencia: 'Anexo de correlação',
});
assert.equal(relacao.criado, true);

const arquivoNcm = path.join(dados, 'ncm.json');
fs.writeFileSync(arquivoNcm, JSON.stringify({ Data_Ultima_Atualizacao_NCM: 'Vigente em teste', Ato: 'Ato teste', Nomenclaturas: [
  { Codigo: '01.02.90.00', Descricao: 'NCM folha', Data_Inicio: '01/01/2026', Data_Fim: '31/12/9999' },
  { Codigo: '01.02', Descricao: 'NCM agrupadora', Data_Inicio: '01/01/2026', Data_Fim: '31/12/9999' },
] }));
const arquivoNbs = path.join(dados, 'nbs.csv');
fs.writeFileSync(arquivoNbs, Buffer.from('NBS 2.0;DESCRIÇÃO\n1.1501.30.00;Suporte de TI\n1.15;Agrupador\n', 'latin1'));
const previa = refs.importarReferenciasOficiais({ arquivoNcm, arquivoNbs });
assert.deepEqual({ ncm: previa.ncm_lidos, nbs: previa.nbs_lidos, aplicado: previa.aplicado }, { ncm: 1, nbs: 1, aplicado: false });
const carga = refs.importarReferenciasOficiais({ arquivoNcm, arquivoNbs, aplicar: true });
assert.equal(carga.inseridos, 2);
assert.equal(refs.importarReferenciasOficiais({ arquivoNcm, arquivoNbs, aplicar: true }).inseridos, 0);

console.log('referencias-fiscais-oficiais: normalização, fonte e carga idempotente validadas');
db.close();
fs.rmSync(dados, { recursive: true, force: true });
