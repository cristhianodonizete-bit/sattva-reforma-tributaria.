const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const questor = require('../services/questor');
const apuracoes = require('../services/apuracoesPisCofinsIa');
const persistencia = require('../services/questorPersistencia');
const router = express.Router();
const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex');
async function autenticar(req) {
  const id=String(req.get('X-Connector-Id')||''); const segredo=String(req.get('X-Connector-Secret')||'');
  await persistencia.recuperarConector(id);
  const c=db.prepare("SELECT * FROM questor_conectores WHERE id=? AND status='ATIVO'").get(id);
  if(!c || !crypto.timingSafeEqual(Buffer.from(c.segredo_hash),Buffer.from(hash(segredo)))) throw new Error('Conector não autorizado.');
  db.prepare("UPDATE questor_conectores SET ultima_conexao_em=datetime('now','localtime') WHERE id=?").run(id);
  await persistencia.publicarConector(db.prepare('SELECT * FROM questor_conectores WHERE id=?').get(id)); return c;
}
router.post('/poll',async(req,res)=>{try{
  const c=await autenticar(req);
  // Caso o conector tenha sido fechado durante uma chamada, a tarefa não pode
  // permanecer bloqueada. O conector local limita a execução a 2 min; após
  // 3 min sem retorno ela volta à fila para uma nova tentativa.
  db.prepare(`UPDATE questor_conector_tarefas
    SET status='PENDENTE', erro='Execução anterior sem retorno; reenviada ao conector.'
    WHERE conector_id=? AND status='EM_EXECUCAO'
      AND julianday('now') - julianday(criado_em) > (3.0 / 1440.0)`).run(c.id);
  const t=db.prepare("SELECT * FROM questor_conector_tarefas WHERE conector_id=? AND status='PENDENTE' ORDER BY id LIMIT 1").get(c.id);
  if(t){
    db.prepare("UPDATE questor_conector_tarefas SET status='EM_EXECUCAO', erro=NULL WHERE id=?").run(t.id);
    await persistencia.publicarTarefa(db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=?').get(t.id));
  }
  res.json({ok:true,tarefa:t?{...t,payload:JSON.parse(t.payload_json||'{}')}:null});
}catch(e){res.status(401).json({ok:false,erro:e.message});}});
router.post('/tarefas/:id/resultado',async(req,res)=>{try{const c=await autenticar(req);const t=db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=? AND conector_id=?').get(req.params.id,c.id);if(!t)throw new Error('Tarefa não encontrada.');const ok=!!req.body?.ok;let resultado=req.body.resultado||{};if(ok&&t.tipo==='IMPORTAR_MOVIMENTACAO'){const p=JSON.parse(t.payload_json||'{}');resultado={...resultado,...questor.importarMovimentacaoConector(t.empresa_id,p.tipo,resultado,{inicio:p.inicio,fim:p.fim})};}if(ok&&t.tipo==='APURACAO_PIS_COFINS')resultado={...resultado,...apuracoes.importarRelatorioQuestor(db,t.empresa_id,resultado.relatorio)};db.prepare("UPDATE questor_conector_tarefas SET status=?,resultado_json=?,erro=?,executado_em=datetime('now','localtime') WHERE id=?").run(ok?'CONCLUIDA':'ERRO',ok?JSON.stringify(resultado):null,ok?null:String(req.body?.erro||'Erro sem detalhe'),t.id);await persistencia.publicarTarefa(db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=?').get(t.id));res.json({ok:true});}catch(e){res.status(401).json({ok:false,erro:e.message});}});
module.exports=router;
