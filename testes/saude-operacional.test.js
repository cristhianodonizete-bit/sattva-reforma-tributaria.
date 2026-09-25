const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-saude-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
const saude = require('../src/services/saudeOperacional');
db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)').run('80000000000001', 'Empresa saúde', 'lucro_presumido');
const supabase = { configurado:() => true, admin:() => ({ from:() => ({ select:() => ({ order:() => ({ limit:async () => ({ data:[{ id:'job-1', status:'PENDENTE', criado_em:new Date().toISOString() }], error:null }) }) }) }) }) };
const telemetria = { resumo:() => ({ total_requisicoes:2, rotas:[{ rota:'GET /lenta', p95_ms:1400 }] }) };
(async () => {
  const r = await saude.resumo(db, { supabase, telemetria, memoria:{ heapUsed:1024 * 1024, rss:2 * 1024 * 1024 } });
  assert.equal(r.natureza, 'PAINEL_SOMENTE_LEITURA');
  assert.equal(r.worker.situacao, 'FILA_AGUARDANDO_WORKER');
  assert.ok(r.alertas.some((x) => x.codigo === 'FILA_AGUARDANDO'));
  assert.ok(r.alertas.some((x) => x.codigo === 'ROTAS_LENTAS'));
  db.close(); fs.rmSync(pasta, { recursive:true, force:true });
  console.log('saude-operacional: painel somente leitura e alertas: OK');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
