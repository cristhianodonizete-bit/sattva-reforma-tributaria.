const assert = require('assert');
const fs = require('fs');

const rota = fs.readFileSync('src/routes/api.js', 'utf8');
const tela = fs.readFileSync('public/js/telas.js', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');

assert.match(rota, /dados_operacionais_pendentes_sincronizacao/);
assert.match(rota, /operacaoCompartilhada'\)\.baixar\(\)/);
assert.match(tela, /Dados operacionais aguardando sincronização/);
assert.match(tela, /não representam ausência de dados fiscais/);
assert.match(app, /Central de Dados/);
const inicioDados = app.indexOf("{ id: 'dados', titulo: 'Central de Dados'");
const inicioDiagnostico = app.indexOf("{ id: 'diagnostico', titulo: 'Módulo 1 · Diagnóstico'");
const basesNaCentral = app.indexOf("{ id: 'bases', t: 'Bases, catálogos e classificações', i: '⌘' }");
assert.ok(basesNaCentral > inicioDados && basesNaCentral < inicioDiagnostico,
  'Bases, catálogos e classificações deve ficar no menu Central de Dados.');
assert.match(app, /t: 'Documentos fiscais'.*centralGrupo: 'documentos'/);
assert.match(app, /t: 'Folha'.*centralGrupo: 'folha'/);
assert.match(app, /t: 'Outras receitas'.*centralGrupo: 'receitas'/);
assert.match(app, /t: 'Apurações'.*centralGrupo: 'apuracoes'/);
assert.match(app, /t: 'Margem operacional'.*centralGrupo: 'margem'/);
assert.match(tela, /DADOS · ENTRADA E TRATAMENTO/);
assert.match(tela, /Ir para Central de Dados/);
assert.match(tela, /As únicas abas de Documentos fiscais são Planilhas e XML\/SPED/);
assert.doesNotMatch(tela, /<button data-central-grupo=/);
assert.match(tela, /Enviar apuração PIS\/Cofins/);
assert.match(tela, /Tratamento e revisão de dados/);
assert.match(tela, /Corrigir na Central de Dados/);
assert.match(tela, /abrirIngestaoApuracao/);
assert.match(tela, /executarMotorPlanilha/);
assert.match(tela, /dadosMotor = 'atual'/);
assert.doesNotMatch(tela, /id="enviarApuracao"/);
console.log('Central de Dados: importações e atalhos operacionais centralizados.');
