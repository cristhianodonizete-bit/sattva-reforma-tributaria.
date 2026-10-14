const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-perfil-cbs-'));
process.env.SATTVA_DADOS = diretorio;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = require('../src/db');
const perfil = require('../src/services/perfilCbs');

try {
  const semFoto = perfil.listar(991);
  assert.equal(semFoto.status, 'ATUALIZACAO_NECESSARIA');
  assert.equal(semFoto.itens.length, 0);
  assert.equal(semFoto.execucao, null);

  db.prepare("INSERT INTO empresas(id,cnpj,razao_social) VALUES (?,?,?)").run(991, '99100000000001', 'Empresa de teste');
  db.prepare("INSERT INTO movimentos(id,empresa_id,tipo,sentido,valor) VALUES (?,?,?,?,?)").run(9911, 991, 'fornecedor', 'entrada', 100);
  db.prepare("INSERT INTO motor_execucoes(id,empresa_id,ano,resumo) VALUES (?,?,?,?)").run(99101, 991, 2026, '{}');
  db.prepare("INSERT INTO motor_resultados(id,empresa_id,movimento_id,execucao_id,sentido,preco_atual) VALUES (?,?,?,?,?,?)").run(991001, 991, 9911, 99101, 'entrada', 100);
  db.prepare("INSERT INTO projecoes_movimentos_estado(empresa_id,movimento_id,assinatura_origem,versao_origem,situacao) VALUES (?,?,?,?,?)").run(991, 9911, 'assinatura-teste', 1, 'ATUAL');
  db.prepare("INSERT INTO fotografia_oficial(empresa_id,execucao_id,empresa_remota_id,execucao_remota_id,quantidade_resultados,quantidade_estados,sincronizado_em) VALUES (?,?,?,?,?,?,datetime('now'))")
    .run(991, 99101, 77, 99101, 1, 1);

  const agregadoPendente = perfil.listar(991);
  assert.equal(agregadoPendente.status, 'AGREGADO_PENDENTE');
  assert.equal(agregadoPendente.itens.length, 0);
  assert.equal(agregadoPendente.execucao.id, 99101);
  console.log('perfil-cbs-fotografia-runtime: atualização necessária e agregado pendente: OK');
} finally {
  db.close();
  fs.rmSync(diretorio, { recursive:true, force:true });
}
