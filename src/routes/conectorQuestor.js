const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const questor = require('../services/questor');
const apuracoes = require('../services/apuracoesPisCofinsIa');
const persistencia = require('../services/questorPersistencia');
const router = express.Router();
const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex');
function conciliarCancelamentosQuestor(empresaId, texto) {
  // nWeb devolve o NRWEX como envelope JSON. O relatório já é exclusivo de
  // cancelados, portanto a situação é evidência do próprio relatório, ainda
  // que não exista uma coluna "Situação" em cada linha.
  let fonte=String(texto||''); try { const envelope=JSON.parse(fonte); fonte=String(envelope?.Data||fonte); } catch (_) { /* retorno textual direto */ }
  const ano=(fonte.match(/Per[ií]odo:\s*\d{2}\/\d{2}\/(\d{4})/i)||[])[1]||'';
  const linhas=fonte.replace(/\r/g,'').split('\n'); const saida={linhas_lidas:0,atualizados:0,ambiguos:0,nao_localizados:0}; const ids=[];
  const registros=[];
  for(const linha of linhas){
    // Layout nFisRRDocFiscalCancelado: lançamento, cliente, data, número,
    // espécie, série, natureza, valor contábil e situação. O cliente pode
    // conter espaços; por isso a extração ancora na data e no final da linha.
    const m=linha.match(/^\s*\d+\s+\d+\s+.+?\s+(\d{2}\/\d{2}\/\d{3,4})\s+(\d+)\s*(NFE|NFSE|NFCE|CTE)\s+(\d*)\s+\S+\s+[\d.,]+\s*$/i);
    if(!m) continue; const y=m[1].slice(6).length===4?m[1].slice(6):ano;
    if(!/^\d{4}$/.test(y)) continue; registros.push({data:`${y}-${m[1].slice(3,5)}-${m[1].slice(0,2)}`,numero:m[2],modelo:m[3].toLowerCase(),serie:m[4],situacao:'CANCELADO'});
  }
  const movimentos=db.prepare("SELECT * FROM movimentos WHERE empresa_id=? AND tipo='cliente'").all(empresaId);
  db.transaction(()=>registros.forEach(r=>{saida.linhas_lidas++; const base=movimentos.filter(x=>{const partes=String(x.documento||'').split('/');const numero=(partes[partes.length-1]||'').replace(/\D/g,'');const serie=(partes.length>1?partes[0]:'').replace(/\D/g,'');return numero===r.numero&&String(x.modelo_documento_fiscal||'').toLowerCase()===r.modelo&&(!r.serie||!serie||serie===r.serie);}); const porData=base.filter(x=>String(x.data_emissao||'').slice(0,10)===r.data); const candidatos=porData.length?porData:base; const docs=new Set(candidatos.map(x=>x.chave||`d:${x.documento}`)); if(!docs.size){saida.nao_localizados++;return;} if(docs.size!==1){saida.ambiguos++;return;} const mudou=candidatos.some(x=>String(x.situacao_documento||'AUTORIZADO')!==r.situacao); db.prepare(`UPDATE movimentos SET situacao_documento=?,cancelado_em=COALESCE(cancelado_em,datetime('now','localtime')),cancelamento_motivo=?,cancelamento_origem='QUESTOR_RELATORIO_CANCELADOS' WHERE id IN (${candidatos.map(()=>'?').join(',')})`).run(r.situacao,`Situação ${r.situacao} informada pelo Questor`,...candidatos.map(x=>x.id)); if(mudou){saida.atualizados++;ids.push(...candidatos.map(x=>x.id));} }));
  if(ids.length) db.prepare(`DELETE FROM motor_resultados WHERE empresa_id=? AND movimento_id IN (${ids.map(()=>'?').join(',')})`).run(empresaId,...ids);
  return saida;
}
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
router.post('/tarefas/:id/resultado',async(req,res)=>{
  let c;
  try { c=await autenticar(req); } catch(e) { return res.status(401).json({ok:false,erro:e.message}); }
  const t=db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=? AND conector_id=?').get(req.params.id,c.id);
  if(!t) return res.status(404).json({ok:false,erro:'Tarefa não encontrada.'});
  try {
    const ok=!!req.body?.ok; let resultado=req.body.resultado||{};
    if(ok&&t.tipo==='IMPORTAR_MOVIMENTACAO') { const p=JSON.parse(t.payload_json||'{}'); resultado={...resultado,...questor.importarMovimentacaoConector(t.empresa_id,p.tipo,resultado,{inicio:p.inicio,fim:p.fim})}; }
    if(ok&&t.tipo==='APURACAO_PIS_COFINS') { const p=JSON.parse(t.payload_json||'{}'); resultado={...resultado,...apuracoes.importarRelatorioQuestor(db,t.empresa_id,resultado.relatorio,{competenciaSolicitada:p.competencia})}; await apuracoes.publicarCompartilhado(db,t.empresa_id); }
    if(ok&&t.tipo==='DOCUMENTOS_FISCAIS_CANCELADOS') { resultado={...resultado,...conciliarCancelamentosQuestor(t.empresa_id,resultado.relatorio)}; require('../services/operacaoCompartilhada').publicar().catch(()=>{}); }
    db.prepare("UPDATE questor_conector_tarefas SET status=?,resultado_json=?,erro=?,executado_em=datetime('now','localtime') WHERE id=?").run(ok?'CONCLUIDA':'ERRO',ok?JSON.stringify(resultado):null,ok?null:String(req.body?.erro||'Erro sem detalhe'),t.id);
    await persistencia.publicarTarefa(db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=?').get(t.id));
    res.json({ok:true});
  } catch(e) {
    db.prepare("UPDATE questor_conector_tarefas SET status='ERRO',erro=?,executado_em=datetime('now','localtime') WHERE id=?").run(e.message,t.id);
    await persistencia.publicarTarefa(db.prepare('SELECT * FROM questor_conector_tarefas WHERE id=?').get(t.id));
    // A entrega foi recebida; a falha pertence à tarefa e não à autenticação.
    res.json({ok:true,tarefa_status:'ERRO',erro:e.message});
  }
});
module.exports=router;
