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
assert.deepEqual(cabecalhos, ['Competência', 'Tipo de receita', 'Descrição', 'Valor', 'Identificador Questor']);

const importado = imp.importarReceitasSemDfe(arquivo);
assert.equal(importado.registros.length, 1);
const linha = importado.registros[0];
assert.equal(linha.identificador_origem, '38988');
receitas.salvarReceitaSemDfe(db, Number(empresa), linha);
const salvo = db.prepare('SELECT identificador_origem,classificacao_fiscal FROM receitas_sem_dfe WHERE empresa_id=?').get(empresa);
assert.deepEqual(salvo, { identificador_origem:'38988', classificacao_fiscal:'LOCACAO_BEM_MOVEL' });
assert.equal(receitas.classificacaoAutomatica('Receita financeira', 'Rendimento de aplicação'), 'RECEITA_FINANCEIRA');
console.log('OK: modelo simples e classificação automática das receitas complementares');
