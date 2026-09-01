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
const inicioDados = app.indexOf("{ id: 'dados', titulo: 'Dados'");
const inicioDiagnostico = app.indexOf("{ id: 'diagnostico', titulo: 'Módulo 1 · Diagnóstico'");
const basesNaCentral = app.indexOf("{ id: 'bases', t: 'Bases carregadas e classificações', i: '⌘' }");
assert.ok(basesNaCentral > inicioDados && basesNaCentral < inicioDiagnostico,
  'Bases carregadas e classificações deve ficar no menu Dados.');
assert.match(tela, /DADOS · ENTRADA E TRATAMENTO/);
assert.match(tela, /Ir para Central de Dados/);
assert.match(tela, /Importar XML ou SPED/);
assert.match(tela, /Enviar apuração PIS\/Cofins/);
assert.match(tela, /NAO_SUPORTADO_ATUALMENTE/);
assert.match(tela, /Tratamento e revisão de dados/);
assert.match(tela, /Corrigir na Central de Dados/);
assert.match(tela, /abrirIngestaoApuracao/);
assert.doesNotMatch(tela, /id="enviarApuracao"/);
console.log('Fase 4E: cache pendente é explícito e a Central de Dados concentra a entrada operacional.');
