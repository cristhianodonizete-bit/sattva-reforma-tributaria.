const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-receitas-tributacao-'));
process.env.SATTVA_DADOS = pasta;
const XLSX = require('xlsx');
const db = require('../src/db');
const imp = require('../src/services/importador');
const receitas = require('../src/services/dadosAdicionaisAnalise');

const empresa = db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)').run('00000000000001', 'Empresa de teste', 'lucro_real').lastInsertRowid;
const arquivo = imp.gerarModelo('receitas_sem_dfe');
const livro = XLSX.read(arquivo, { type: 'buffer' });
const cabecalhos = XLSX.utils.sheet_to_json(livro.Sheets['Receitas sem DFe'], { header: 1 })[0];
assert.deepEqual(cabecalhos, ['Competência', 'Item de receita', 'Descrição', 'Valor', 'Identificador Questor']);

const importado = imp.importarReceitasSemDfe(arquivo);
assert.equal(importado.registros.length, 1);
const linha = importado.registros[0];
assert.equal(linha.identificador_origem, '38988');
receitas.salvarReceitaSemDfe(db, Number(empresa), linha);
const salvo = db.prepare('SELECT identificador_origem,item_receita_chave,classificacao_fiscal,criterio_tributacao_atual FROM receitas_sem_dfe WHERE empresa_id=?').get(empresa);
assert.deepEqual(salvo, { identificador_origem:'38988', item_receita_chave:'LOCACAO_BENS_MOVEIS', classificacao_fiscal:'LOCACAO_BEM_MOVEL', criterio_tributacao_atual:'Não cumulativo: PIS 1,65% + Cofins 7,60%, salvo exceção específica.' });
assert.equal(receitas.classificacaoAutomatica('Receita financeira', 'Rendimento de aplicação'), 'RECEITA_FINANCEIRA');
console.log('OK: modelo simples, item padronizado e regra tributária por regime nas receitas complementares');
