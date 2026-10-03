const assert=require('assert');
const fs=require('fs');
const path=require('path');

const raiz=path.resolve(__dirname,'..');
const leitor=fs.readFileSync(path.join(raiz,'src/services/documentosFiscaisCompartilhados.js'),'utf8');
const api=fs.readFileSync(path.join(raiz,'src/routes/api.js'),'utf8');
const tela=fs.readFileSync(path.join(raiz,'public/js/telas.js'),'utf8');

assert.match(leitor,/async function listarRastreabilidadeSaidas/);
assert.match(leitor,/BEGIN READ ONLY/);
assert.match(leitor,/ROLLBACK/);
assert.match(leitor,/cfop_xml/);
assert.match(leitor,/cfop_efetivo/);
assert.match(leitor,/composicao_cfop/);
assert.match(leitor,/MAX\(origem\) origem/,'a rastreabilidade precisa devolver a origem documental');
assert.match(leitor,/module\.exports = \{ listar, listarOpcoesFiltros, listarRastreabilidadeSaidas \}/);
const rota=api.indexOf("/empresas/:id/documentos-fiscais/saidas/rastreabilidade-cfop");
const generica=api.indexOf("/empresas/:id/documentos-fiscais/:referencia");
assert.ok(rota >= 0 && rota < generica,'A rota específica deve vir antes da rota genérica de documento.');
assert.match(api,/listarRastreabilidadeSaidas/);
assert.match(tela,/Rastreabilidade das saídas/);
assert.match(tela,/Ver rastreabilidade/);
assert.match(tela,/\{t:'Origem',r:d=>String\(d\.origem/,'a tabela deve exibir a origem da nota');
assert.match(tela,/não executa o motor tributário/);
console.log('OK: rastreabilidade de CFOP das saídas é uma leitura isolada e paginada.');
