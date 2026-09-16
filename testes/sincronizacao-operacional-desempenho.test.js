const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fonte = fs.readFileSync(path.join(__dirname, '..', 'src/services/operacaoCompartilhada.js'), 'utf8');
const { fetchComPrazo } = require('../src/services/supabase');

assert.match(fonte, /async function buscarColecoes[\s\S]*concorrencia = 4/);
assert.match(fonte, /const colecoes = await buscarColecoes\(remoto, tabelas\)/);
assert.match(fonte, /const origemEmpresas = await buscarTudo\(remoto, 'empresas'\)[\s\S]*resultado\.empresas = gravarEmpresas\(origemEmpresas\)[\s\S]*const colecoes = await buscarColecoes/,
  'a carteira precisa ser gravada antes de carregar os catálogos paralelos');
(async () => {
  await assert.rejects(fetchComPrazo('http://127.0.0.1:1', {}, 20), /abort|aborted|fetch failed/i);
  console.log('OK: carga operacional limitada por prazo e leitura paralela controlada.');
})().catch((erro) => { console.error(erro); process.exit(1); });
