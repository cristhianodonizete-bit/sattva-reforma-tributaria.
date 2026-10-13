#!/usr/bin/env node
/* Contrato: nenhuma rota de leitura pode reabrir carteira no Node. */
const assert=require('node:assert/strict');
const fs=require('node:fs'); const path=require('node:path');
const raiz=path.resolve(__dirname,'..');
const oficial=fs.readFileSync(path.join(raiz,'src/services/consolidacaoOficial.js'),'utf8');
const perfil=fs.readFileSync(path.join(raiz,'src/services/perfilCbs.js'),'utf8');
const relatorio=fs.readFileSync(path.join(raiz,'src/services/relatorio.js'),'utf8');
const api=fs.readFileSync(path.join(raiz,'src/routes/api.js'),'utf8');
const sqlite=fs.readFileSync(path.join(raiz,'src/sqlite.js'),'utf8');
for(const [nome,fonte] of Object.entries({oficial,perfil,relatorio})) {
  assert.equal(/consolidacaoOficial\.linhas\s*\(/.test(fonte),false,`${nome} não pode consumir linhas legadas`);
}
assert.match(oficial,/LIMIT \?/,'listas SQL devem receber limite');
assert.match(oficial,/r\.id \$\{direcao\}/,'cursor deve desempatar por id');
assert.match(oficial,/function detalhe\(empresaId,movimentoId\)/,'detalhe deve ser unitário');
assert.match(oficial,/AND m\.id=\? LIMIT 1/,'detalhe deve ter identidade e LIMIT 1');
const trechoLista=oficial.slice(oficial.indexOf('function listar('),oficial.indexOf('function detalhe('));
assert.equal(/SELECT r\.\*/.test(trechoLista),false,'leitura de lista não pode selecionar detalhe global');
const perfilLista=perfil.slice(perfil.indexOf('function listar('),perfil.indexOf('function detalhes('));
assert.match(perfilLista,/LIMIT \?/,'Perfil CBS deve paginar agregados persistidos');
assert.equal(/SELECT \*/.test(perfilLista),false,'Perfil CBS não pode buscar colunas amplas por padrão');
const rota=(inicio,fim)=>api.slice(api.indexOf(inicio),api.indexOf(fim,api.indexOf(inicio)));
const cancelamentos=rota("router.get('/empresas/:id/questor/cancelamentos-pendentes'","router.post('/empresas/:id/questor/cancelamentos-pendentes/reconciliar'");
const reconciliarCancelamentos=rota("router.post('/empresas/:id/questor/cancelamentos-pendentes/reconciliar'","// ---- Importação de XML");
const releituraRazao=rota("router.post('/empresas/:id/questor/razao/reler-fornecedores'","// Corrige a natureza técnica");
const reclassificarRazao=rota("router.post('/empresas/:id/questor/razao/reclassificar-naturezas'","router.post('/empresas/:id/questor/conector/documentos-fiscais-cancelados'");
const entradas=rota("router.get('/empresas/:id/entradas-manuais'","router.delete('/empresas/:id/entradas-manuais");
assert.match(cancelamentos,/WITH pagina AS \(/,'lista de cancelamentos deve paginar no SQL');
assert.match(cancelamentos,/EXISTS\(SELECT 1 FROM movimentos m WHERE m\.empresa_id=\?/,'cancelamentos devem conciliar por JOIN/EXISTS com escopo da empresa');
assert.match(cancelamentos,/LIMIT \? OFFSET \?/,'cancelamentos devem limitar antes de chegar ao Node');
assert.equal(/const movimentos=.*\.all\(empresaId\)/.test(cancelamentos),false,'cancelamentos não podem materializar movimentos');
assert.match(reconciliarCancelamentos,/WITH correspondencias AS/,'reconciliação de cancelamentos deve usar CTE SQL');
assert.equal(/movimentosRemotos|cancelamentosRemotos|new Set\(\)/.test(reconciliarCancelamentos),false,'reconciliação não pode cruzar carteiras remotas em memória');
assert.match(releituraRazao,/ORDER BY id LIMIT \?/,'releitura do Razão deve ter lote paginado');
assert.match(releituraRazao,/competencia=\?/,'releitura deve aceitar recorte de competência');
assert.match(releituraRazao,/lote_id=\?/,'releitura deve aceitar recorte de lote');
assert.match(releituraRazao,/solicitarIncremental/,'releitura não pode agendar motor global');
assert.equal(/resultado_json \|\| '\{\}'\)\.linhas/.test(releituraRazao),false,'releitura não pode expandir prévia JSON inteira');
assert.match(reclassificarRazao,/ORDER BY id LIMIT \?/,'reclassificação do Razão deve processar lote paginado');
assert.match(reclassificarRazao,/competencia=\?/,'reclassificação deve aceitar recorte de competência');
assert.match(reclassificarRazao,/lote_id=\?/,'reclassificação deve aceitar recorte de lote');
assert.match(reclassificarRazao,/solicitarIncremental/,'reclassificação não pode agendar motor global');
assert.match(entradas,/LIMIT \? OFFSET \?/,'entradas manuais devem limitar no SQL');
assert.match(sqlite,/LEITURA_GLOBAL_PROIBIDA/,'SQLite deve bloquear materialização ampla de movimentos/resultados');
console.log('leitura-analitica-limitada.test: contrato SQL de Cadeia, Entradas, Razão e Cancelamentos aprovado.');
