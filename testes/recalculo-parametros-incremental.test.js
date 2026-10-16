const assert = require('assert');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(raiz, 'src/routes/api.js'), 'utf8');
const operacao = fs.readFileSync(path.join(raiz, 'src/services/operacaoCompartilhada.js'), 'utf8');
const tela = fs.readFileSync(path.join(raiz, 'public/js/telas6.js'), 'utf8');
const menu = fs.readFileSync(path.join(raiz, 'public/js/app.js'), 'utf8');

assert.match(operacao, /async function listarMovimentosCanonicosEmpresa/, 'o escopo deve ser lido na fonte canônica');
assert.match(operacao, /from\('movimentos'\)\.select\('id'\)/, 'o escopo deve usar IDs canônicos do Supabase');
assert.match(api, /async function agendarRecalculoPorParametro/, 'deve haver um único fluxo de recálculo por parâmetro');
assert.match(api, /listarMovimentosCanonicosEmpresa\(id\)/, 'o recálculo deve obter o escopo canônico');
assert.match(api, /solicitarIncremental\(id/, 'parâmetro não pode acionar motor completo');
assert.match(api, /estadoLeituraEmpresa\.invalidar\(db,id,\['motor','cadeias'\]/, 'a leitura local deve ser invalidada após enfileirar');
assert.match(api, /\/empresas\/:id\/motor\/recalcular-parametros/, 'o Motor tributário deve expor o comando manual');
const rotasParametros = api.slice(api.indexOf("router.put('/config/regras"), api.indexOf("router.post('/config/cfop'"));
assert.doesNotMatch(rotasParametros, /agendarRecalculoDuravelPorConfiguracao\(/, 'salvar parâmetro não pode percorrer toda a carteira');
assert.match(rotasParametros, /agendarRecalculoPorParametro\(req\.body\.empresa_id/, 'cada parâmetro salvo deve usar a empresa selecionada');
assert.match(tela, /corpo: \{ \.\.\.corpo, empresa_id:S\.empresaId \}/, 'a tela deve enviar a empresa selecionada');
assert.match(tela, /Telas\.recalcularParametrosMotor/, 'a ação manual deve existir na interface');
const telaMotor = tela.slice(tela.indexOf('Telas.recalcularParametrosMotor'), tela.indexOf('// -------------------------------------------------------------- ALÍQUOTAS'));
assert.doesNotMatch(telaMotor, /A\.ir\('controleProjeto'\)/, 'o comando incremental não pode redirecionar ao controle do motor completo');
assert.match(telaMotor, /Recálculo incremental agendado/, 'a própria tela deve mostrar a confirmação do job incremental');
assert.match(menu, /recalcularParametrosMotor/, 'a ação manual deve estar no menu do Motor tributário');

console.log('recalculo-parametros-incremental: escopo canônico, fila incremental e fotografia oficial validados.');
