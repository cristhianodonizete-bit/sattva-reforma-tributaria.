const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const XLSX = require('xlsx');
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
fs.writeFileSync(arquivoNbs, Buffer.from('NBS 2.0;DESCRIÇÃO\n1.1501.30.00;Suporte de TI\n1.1501.20.00;Consultoria em TI\n1.15;Agrupador\n', 'latin1'));
const arquivoLc116 = path.join(dados, 'lc116.csv');
fs.writeFileSync(arquivoLc116, '1.07;Suporte técnico em informática\n1;Grupo sem uso como chave\n');
const previa = refs.importarReferenciasOficiais({ arquivoNcm, arquivoNbs, arquivoLc116 });
assert.deepEqual({ ncm: previa.ncm_lidos, nbs: previa.nbs_lidos, lc116: previa.lc116_lidos, aplicado: previa.aplicado }, { ncm: 1, nbs: 2, lc116: 1, aplicado: false });
const arquivoLc116Html = path.join(dados, 'lc116-oficial.html');
fs.writeFileSync(arquivoLc116Html, '<html><body><p>Lista de serviços anexa à Lei Complementar nº 116</p><p>1.01 - Análise e desenvolvimento de sistemas.</p><p>1.02 - Programação.</p></body></html>');
const lc116Oficial = refs.referenciasLc116DoHtmlOficial(arquivoLc116Html);
assert.equal(lc116Oficial.linhas.length, 2);
assert.equal(lc116Oficial.linhas[0].codigo, '1.01');
assert.match(lc116Oficial.linhas[0].fonte, /Senado Federal/);
const anexoViii = path.join(dados, 'anexo-viii.xlsx');
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet([
  { 'Item LC 116': '01.07', NBS: '1.1501.30.00', INDOP: '100301', cClassTrib: '000001' },
  { 'Item LC 116': '', NBS: '1.1501.20.00', INDOP: '100301', cClassTrib: '000001' },
]);
XLSX.utils.book_append_sheet(wb, ws, 'tabela geral');
XLSX.writeFile(wb, anexoViii);
assert.equal(refs.importarRelacoesNbsLc116DoAnexoViii({ arquivo: anexoViii }).relacoes_lidas, 2);
const carga = refs.importarReferenciasOficiais({ arquivoNcm, arquivoNbs, arquivoLc116, aplicar: true });
assert.equal(carga.inseridos, 4);
assert.equal(refs.importarReferenciasOficiais({ arquivoNcm, arquivoNbs, arquivoLc116, aplicar: true }).inseridos, 0);
assert.equal(refs.importarRelacoesNbsLc116DoAnexoViii({ arquivo: anexoViii, aplicar: true }).inseridas, 2);
assert.equal(refs.importarRelacoesNbsLc116DoAnexoViii({ arquivo: anexoViii, aplicar: true }).inseridas, 0);

console.log('referencias-fiscais-oficiais: normalização, fonte e carga idempotente validadas');
db.close();
fs.rmSync(dados, { recursive: true, force: true });
