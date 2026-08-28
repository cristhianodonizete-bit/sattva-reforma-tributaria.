const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-excecoes-execucao-'));

const db = require('../src/db');
const excecoes = require('../src/services/excecoesMotor');

db.prepare('INSERT INTO empresas (id,cnpj,razao_social) VALUES (1,?,?)').run('00000000000000', 'Teste autonomia');
db.prepare('INSERT INTO motor_execucoes (id,empresa_id,ano,itens,resumo) VALUES (1,1,2027,1,?)').run('{}');
db.prepare(`INSERT INTO motor_resultados (empresa_id,movimento_id,execucao_id,sentido,status_classificacao,status_credito,natureza,preco_atual,cbs,credito_cbs,detalhe)
  VALUES (1,10,1,'entrada','REQUER_VALIDACAO','SUJEITO_VALIDACAO','SIMULADO',100,0,0,?)`)
  .run(JSON.stringify({ reconstrucao: { status: 'insuficiente' } }));
excecoes.sincronizar(1, 1);
assert(excecoes.listar(1).length > 0, 'a Central mostra somente exceções da execução ativa');
assert.equal(excecoes.resumo(1).execucao_ativa, 1, 'resumo aponta a execução ativa');

db.prepare('INSERT INTO motor_execucoes (id,empresa_id,ano,itens,resumo) VALUES (2,1,2027,0,?)').run('{}');
excecoes.sincronizar(1, 2);
assert.equal(excecoes.listar(1).length, 0, 'exceção antiga não aparece como aberta na nova execução');
const historico = excecoes.listar(1, { visao: 'historico' });
assert(historico.some((x) => x.execucao_id === 1 && x.status_execucao === 'SUPERADA_POR_NOVA_EXECUCAO'), 'histórico preserva a exceção superada');

console.log('excecoes-execucao.test: execução ativa, histórico e superação aprovados');
