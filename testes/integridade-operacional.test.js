const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-integridade-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
const integridade = require('../src/services/integridadeOperacional');

const empresa = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)')
  .run('90000000000001', 'Empresa de teste', 'simples_nacional').lastInsertRowid);
db.prepare("INSERT INTO movimentos (empresa_id,tipo,sentido,competencia,valor,origem) VALUES (?,?,?,?,?,?)")
  .run(empresa, 'produto', 'saida', '2026-01', 100, 'xml');
let relatorio = integridade.auditar(db, empresa);
assert.equal(relatorio.natureza, 'CONFERENCIA_SOMENTE_LEITURA');
assert.ok(relatorio.achados.some((x) => x.codigo === 'PERFIL_AUSENTE'));
assert.ok(relatorio.achados.some((x) => x.codigo === 'FOTOGRAFIA_AUSENTE'));
// O cache pode ainda estar vazio numa instância nova. A fonte durável não
// pode, nesse caso, gerar falso alerta de Perfil, PGDAS ou fotografia.
relatorio = integridade.auditar(db, empresa, { fatosDuraveis:{ documentos:1, saidas:1, perfil_competencias:1, pgdas_validados:1, apuracoes_validadas:0, resultados_ativos:1 } });
assert.equal(relatorio.situacao, 'INTEGRO');
db.prepare("INSERT INTO perfil_tributario (empresa_id,competencia,receita_bruta) VALUES (?,?,?)").run(empresa, '2026-01', 100);
db.prepare("INSERT INTO pgdas_documentos (empresa_id,nome_original,tipo_documento,conteudo_original,hash_sha256,data_processamento,metodo_extracao,status_processamento) VALUES (?,?,?,?,?,?,?,?)")
  .run(empresa, 'pgdas.pdf', 'PDF', Buffer.from('teste'), 'hash-integridade', new Date().toISOString(), 'TESTE', 'VALIDADO_USUARIO');
const execucao = Number(db.prepare('INSERT INTO motor_execucoes (empresa_id,itens) VALUES (?,?)').run(empresa, 1).lastInsertRowid);
db.prepare('INSERT INTO motor_resultados (empresa_id,movimento_id,execucao_id) VALUES (?,?,?)').run(empresa, 1, execucao);
relatorio = integridade.auditar(db, empresa);
assert.equal(relatorio.situacao, 'INTEGRO');
assert.equal(relatorio.fotografia.resultados, 1);
const empresaPresumida = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)')
  .run('90000000000002', 'Empresa presumida', 'lucro_presumido').lastInsertRowid);
db.prepare("INSERT INTO movimentos (empresa_id,tipo,sentido,competencia,valor,origem) VALUES (?,?,?,?,?,?)")
  .run(empresaPresumida, 'produto', 'saida', '2026-01', 100, 'xml');
relatorio = integridade.auditar(db, empresaPresumida, { fatosDuraveis:{ documentos:1, saidas:1, perfil_competencias:0, pgdas_validados:0, apuracoes_validadas:0, resultados_ativos:1 } });
assert.ok(!relatorio.achados.some((x) => x.codigo === 'PERFIL_AUSENTE'));
assert.ok(relatorio.achados.some((x) => x.codigo === 'APURACAO_NAO_IMPORTADA'));
db.close(); fs.rmSync(pasta, { recursive:true, force:true });
console.log('integridade-operacional: conferência somente leitura e alertas: OK');
