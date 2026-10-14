const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const arquivo = path.join(__dirname, '..', 'src', 'services', 'coberturaDiagnostico.js');
const fonte = fs.readFileSync(arquivo, 'utf8');
const tela = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'telas4.js'), 'utf8');
const inicio = fonte.indexOf('const FROM_COBERTURA');
const fim = fonte.indexOf('function registrarFotografia', inicio);
const bloco = fonte.slice(inicio, fim);

assert.ok(inicio >= 0 && fim > inicio, 'bloco de leitura da cobertura deve existir');
assert.match(bloco, /motorExec\.fotografiaOficial\(empresaId\)/, 'cobertura deve usar a fotografia oficial validada');
assert.match(bloco, /LEFT JOIN projecoes_movimentos_estado pe[\s\S]*?ON pe\.empresa_id=r\.empresa_id AND pe\.movimento_id=r\.movimento_id/, 'estado deve ser LEFT JOIN para não ocultar resultados sem estado');
assert.match(bloco, /COALESCE\(pe\.situacao,'SEM_ESTADO'\)/, 'resultado sem estado deve ser divergência explícita');
assert.match(bloco, /CASE WHEN pe\.situacao='ATUAL' THEN r\.preco_atual ELSE 0 END/, 'valor vigente deve excluir estado não atual');
assert.match(bloco, /substr\(COALESCE\(m\.competencia,''\),1,7\)/, 'filtro deve comparar a competência mensal AAAA-MM mesmo quando o movimento preservar data ISO');
assert.match(bloco, /GROUP BY codigo,categoria,status/, 'exceções devem ser agregadas no SQL');
assert.match(bloco, /LIMIT \? OFFSET \?/, 'lista de exceções deve ser paginada no SQL');
assert.match(bloco, /FROM excecoes_motor_execucoes WHERE empresa_id=\? AND execucao_id=\? AND status='ABERTA'/, 'exceções devem pertencer à execução oficial');
assert.doesNotMatch(bloco, /FROM excecoes_motor WHERE/, 'cobertura não pode ler exceções sem escopo de execução');
assert.match(bloco, /respostaIndisponivel\(empresaId,'DIVERGENTE'/, 'divergência deve ser retornada como estado operacional, sem exceção HTTP');
assert.doesNotMatch(bloco, /LIMIT 1000/, 'cobertura não pode materializar uma lista ampla fixa');
assert.match(tela, /d\.status && d\.status !== 'OK'/, 'tela deve tratar resposta sem fotografia');

console.log('cobertura-fotografia-oficial: contrato SQL e estados operacionais: OK');
