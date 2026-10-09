const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const path=require('node:path');
const raiz=path.join(__dirname,'..');
const migration=fs.readFileSync(path.join(raiz,'supabase','migrations','20261018_retencao_sincronizacao_operacional.sql'),'utf8');
const server=fs.readFileSync(path.join(raiz,'server.js'),'utf8');

test('retenção é limitada por idade, corte e checkpoint',()=>{
  assert.match(migration,/ocorrido_em\s*<\s*clock_timestamp\(\)-make_interval\(days=>politica\.dias_retencao\)/i);
  assert.match(migration,/sequencia<=corte_tecnico/i);
  assert.match(migration,/sequencia_consumo<=checkpoint_ativo/i);
  assert.match(migration,/limit limite_lote[\s\S]*for update skip locked/i);
});

test('consumidor inativo volta por carga-base antes da retenção',()=>{
  assert.match(migration,/set requer_carga_base=true,sessao_id=null,lease_expira_em=null/i);
  assert.match(migration,/ultimo_heartbeat\s*<\s*clock_timestamp\(\)-make_interval/i);
});

test('arquivo auditável e tombstones não são apagados',()=>{
  assert.match(migration,/create table if not exists public\.sincronizacao_operacional_arquivos/i);
  assert.doesNotMatch(migration,/delete\s+from\s+public\.sincronizacao_operacional_tombstones/i);
});

test('manutenção automática não mascara sincronização aplicada',()=>{
  assert.match(server,/rpc\('limpar_eventos_sincronizacao_operacional'\)/);
  assert.match(server,/Retenção é manutenção: nunca invalida um ciclo de sincronização já aplicado/);
});
