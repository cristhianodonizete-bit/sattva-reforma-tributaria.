const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-receitas-tributacao-'));
process.env.SATTVA_DADOS = pasta;
const XLSX = require('xlsx');
const db = require('../src/db');
const imp = require('../src/services/importador');
const receitas = require('../src/services/dadosAdicionaisAnalise');

const empresa = db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run('00000000000001', 'Empresa de teste').lastInsertRowid;
const arquivo = imp.gerarModelo('receitas_sem_dfe');
const livro = XLSX.read(arquivo, { type: 'buffer' });
const cabecalhos = XLSX.utils.sheet_to_json(livro.Sheets['Receitas sem DFe'], { header: 1 })[0];
['Identificador Questor', 'Espécie Questor', 'Segregação da apuração', 'Base PIS/COFINS atual', 'PIS atual do lançamento', 'COFINS atual do lançamento', 'Critério de tributação atual', 'Origem da tributação atual'].forEach((campo) => assert.ok(cabecalhos.includes(campo), `Modelo sem ${campo}`));

const importado = imp.importarReceitasSemDfe(arquivo);
assert.equal(importado.registros.length, 1);
const linha = importado.registros[0];
assert.equal(linha.identificador_origem, '38988');
assert.equal(linha.especie_questor, 'REC');
assert.equal(linha.segregacao_apuracao, 'LOCAÇÃO / SERVIÇOS');
assert.equal(linha.base_pis_cofins_atual, 3500);
assert.equal(linha.criterio_tributacao_atual, 'RATEIO_PELA_APURACAO_DA_SEGREGACAO');
receitas.salvarReceitaSemDfe(db, Number(empresa), linha);
const salvo = db.prepare('SELECT identificador_origem,especie_questor,segregacao_apuracao,base_pis_cofins_atual,criterio_tributacao_atual FROM receitas_sem_dfe WHERE empresa_id=?').get(empresa);
assert.deepEqual(salvo, { identificador_origem:'38988', especie_questor:'REC', segregacao_apuracao:'LOCAÇÃO / SERVIÇOS', base_pis_cofins_atual:3500, criterio_tributacao_atual:'RATEIO_PELA_APURACAO_DA_SEGREGACAO' });
console.log('OK: modelo e importação de tributação das receitas complementares');
