const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const router = express.Router();
const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex');
function autenticar(req) {
  const id=String(req.get('X-Connector-Id')||''); const segredo=String(req.get('X-Connector-Secret')||'');
  const c=db.prepare("SELECT * FROM questor_conectores WHERE id=? AND status='ATIVO'").get(id);
  if(!c || !crypto.timingSafeEqual(Buffer.from(c.segredo_hash),Buffer.from(hash(segredo)))) throw new Error('Conector não autorizado.');
  db.prepare("UPDATE questor_conectores SET ultima_conexao_em=datetime('now','localtime') WHERE id=?").run(id); return c;
}
router.post('/poll',(req,res)=>{try{const c=autenticar(req);const t=db.prepare("SELECT * FROM questor_conector_tarefas WHERE conector_id=? AND status='PENDENTE' ORDER BY id LIMIT 1").get(c.id);if(t)db.prepare("UPDATE questor_conector_tarefas SET status='EM_EXECUCAO' WHERE id=?").run(t.id);res.json({ok:true,tarefa:t?{...t,payload:JSON.parse(t.payload_json||'{}')}:null});}catch(e){res.status(401).json({ok:false,erro:e.message});}});
router.post('/tarefas/:id/resultado',(req,res)=>{try{const c=autenticar(req);const t=db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=? AND conector_id=?').get(req.params.id,c.id);if(!t)throw new Error('Tarefa não encontrada.');const ok=!!req.body?.ok;db.prepare("UPDATE questor_conector_tarefas SET status=?,resultado_json=?,erro=?,executado_em=datetime('now','localtime') WHERE id=?").run(ok?'CONCLUIDA':'ERRO',ok?JSON.stringify(req.body.resultado||{}):null,ok?null:String(req.body?.erro||'Erro sem detalhe'),t.id);res.json({ok:true});}catch(e){res.status(401).json({ok:false,erro:e.message});}});
module.exports=router;
