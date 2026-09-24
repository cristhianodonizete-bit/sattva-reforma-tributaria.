const assert = require('node:assert/strict');
const fs = require('node:fs');

const perfil = fs.readFileSync(require.resolve('../src/services/perfilTributarioHistorico'), 'utf8');
const operacao = fs.readFileSync(require.resolve('../src/services/operacaoCompartilhada'), 'utf8');
const api = fs.readFileSync(require.resolve('../src/routes/api'), 'utf8');

assert.match(perfil, /filtroPeriodoMovimentos/, 'Perfil limita movimentos ao período analisado');
assert.match(operacao, /competenciaInicio/, 'reconciliação aceita a janela fiscal solicitada');
assert.match(operacao, /competencia>=\? AND competencia<=\?/, 'cache local só lê a janela solicitada');
const rotaPerfil = api.slice(api.indexOf("router.get('/empresas/:id/perfil-tributario-historico'"), api.indexOf("router.post('/empresas/:id/perfil-tributario-historico/auditoria"));
assert.ok(rotaPerfil.indexOf('periodoAnalisado.sincronizarCompartilhado') < rotaPerfil.indexOf('reconciliarMovimentosEmpresa'), 'período é restaurado antes da reconciliação');
console.log('perfil-periodo-enxuto: Perfil reconcilia somente o exercício analisado: OK');
