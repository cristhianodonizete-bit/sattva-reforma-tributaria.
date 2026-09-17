const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const questor = require('../services/questor');
const apuracoes = require('../services/apuracoesPisCofinsIa');
const persistencia = require('../services/questorPersistencia');
const supabase = require('../services/supabase');
const router = express.Router();
const hash = (v) => crypto.createHash('sha256').update(String(v || '')).digest('hex');
function lerCancelamentosQuestor(texto) {
  // nWeb devolve o NRWEX como envelope JSON. O relatório já é exclusivo de
  // cancelados, portanto a situação é evidência do próprio relatório, ainda
  // que não exista uma coluna "Situação" em cada linha.
  let fonte=String(texto||''); try { const envelope=JSON.parse(fonte); fonte=String(envelope?.Data||fonte); } catch (_) { /* retorno textual direto */ }
  const ano=(fonte.match(/Per[ií]odo:\s*\d{2}\/\d{2}\/(\d{4})/i)||[])[1]||'';
  const linhas=fonte.replace(/\r/g,'').split('\n');
  const registros=[];
  for(const linha of linhas){
    // Layout nFisRRDocFiscalCancelado: lançamento, cliente, data, número,
    // espécie, série, natureza, valor contábil e situação. O cliente pode
    // conter espaços; por isso a extração ancora na data e no final da linha.
    // Algumas versões trazem "Cancelado" como última coluna; outras já
    // filtram o relatório e não imprimem a situação. Ambas são a mesma
    // evidência e precisam ser aceitas.
    // O campo Cliente tem largura fixa. Quando o nome excede a largura, o
    // Questor pode imprimir a data logo após a última letra (ex.: Desen13/04)
    // sem espaço. A data é o delimitador confiável da linha, não o espaço.
    const m=linha.match(/^\s*\d+\s+\d+\s+.+?(\d{2}\/\d{2}\/\d{3,4})\s+(\d+)(?:-\2)?\s*(NFE|NFSE|NFCE|CTE)\s+(\d*)\s+\S+\s+[\d.,]+(?:\s+(?:Cancelado|Denegado|Inutilizado))?\s*$/i);
    if(!m) continue; const y=m[1].slice(6).length===4?m[1].slice(6):ano;
    if(!/^\d{4}$/.test(y)) continue; registros.push({data:`${y}-${m[1].slice(3,5)}-${m[1].slice(0,2)}`,numero:m[2],modelo:m[3].toLowerCase(),serie:m[4],situacao:'CANCELADO'});
  }
  return registros;
}
async function conciliarCancelamentosQuestor(empresaId, texto) {
  const registros=lerCancelamentosQuestor(texto);
  // "linhas lidas" descreve o que veio do relatório, não o que estava no
  // cache da instância que recebeu a tarefa. Em Render, esse cache pode estar
  // vazio mesmo quando a atualização canônica foi concluída com sucesso.
  const saida={linhas_lidas:registros.length,atualizados:0,ambiguos:0,nao_localizados:0}; const ids=[];
  // Há bases antigas em que o espelho compartilhado preservou o ID
  // operacional anterior. Para documentos de saída, o CNPJ emitente é a
  // identidade fiscal estável da empresa e evita deixar cancelamentos fora da
  // conciliação por mera divergência de identificador interno.
  const empresa=db.prepare('SELECT cnpj FROM empresas WHERE id=?').get(empresaId)||{};
  const cnpj=String(empresa.cnpj||'').replace(/\D/g,'');
  const movimentos=db.prepare("SELECT * FROM movimentos WHERE tipo='cliente' AND (empresa_id=? OR (?<>'' AND replace(replace(replace(emitente_cnpj,'.',''),'/',''),'-','')=?))").all(empresaId,cnpj,cnpj);
  // O Questor pode informar o cancelamento antes de o XML chegar à Sattva,
  // especialmente nas NFS-e. Guardamos a identidade fiscal mesmo sem
  // movimento correspondente; a importação futura a aplicará antes de a nota
  // poder compor receita ou alimentar o motor.
  const guardarCancelamento=db.prepare(`INSERT INTO documentos_fiscais_cancelamentos
    (empresa_id,data_emissao,numero,modelo_documento_fiscal,serie,situacao,origem,evidencia,atualizado_em)
    VALUES (?,?,?,?,?,'CANCELADO','QUESTOR_RELATORIO_CANCELADOS',?,datetime('now','localtime'))
    ON CONFLICT(empresa_id,data_emissao,numero,modelo_documento_fiscal,serie) DO UPDATE SET
      situacao='CANCELADO',origem='QUESTOR_RELATORIO_CANCELADOS',evidencia=excluded.evidencia,atualizado_em=excluded.atualizado_em`);
  db.transaction(()=>registros.forEach((r)=>guardarCancelamento.run(empresaId,r.data,r.numero,r.modelo,r.serie,
    'Cancelamento informado pelo relatório Questor nFisRRDocFiscalCancelado')))();
  if (supabase.configurado() && registros.length) {
    const remoto=supabase.admin();
    const {data: empresasRemotas,error: erroEmpresa}=await remoto.from('empresas').select('id').eq('cnpj',cnpj).limit(2);
    if(erroEmpresa) throw erroEmpresa;
    if((empresasRemotas||[]).length!==1) throw new Error('Não foi possível localizar unicamente a empresa na base compartilhada para gravar os cancelamentos.');
    const {error: erroCancelamentos}=await remoto.from('documentos_fiscais_cancelamentos').upsert(registros.map((r)=>({
      empresa_id:empresasRemotas[0].id,data_emissao:r.data,numero:r.numero,modelo_documento_fiscal:r.modelo,serie:r.serie,
      situacao:'CANCELADO',origem:'QUESTOR_RELATORIO_CANCELADOS',evidencia:'Cancelamento informado pelo relatório Questor nFisRRDocFiscalCancelado.',
    })),{onConflict:'empresa_id,data_emissao,numero,modelo_documento_fiscal,serie'});
    if(erroCancelamentos) throw erroCancelamentos;
    // A fila pode terminar em outra instância do Render que a usada pela
    // tela. Gravar também os movimentos diretamente na fonte compartilhada
    // evita que uma restauração do cache volte a mostrar a nota autorizada.
    const empresaRemotaId=empresasRemotas[0].id;
    const {data: movimentosRemotos,error: erroMovimentos}=await remoto.from('movimentos')
      .select('id,documento,chave,data_emissao,modelo_documento_fiscal,situacao_documento')
      .eq('empresa_id',empresaRemotaId).eq('tipo','cliente').limit(10000);
    if(erroMovimentos) throw erroMovimentos;
    const diagnostico=[]; let atualizadosRemoto=0;
    for(const r of registros) {
      const base=(movimentosRemotos||[]).filter((x)=>{
        const partes=String(x.documento||'').split('/');
        const numero=(partes[partes.length-1]||'').replace(/\D/g,'');
        const serie=(partes.length>1?partes[0]:'').replace(/\D/g,'');
        return numero===r.numero && String(x.modelo_documento_fiscal||'').toLowerCase()===r.modelo && (!r.serie||!serie||serie===r.serie);
      });
      const porData=base.filter((x)=>String(x.data_emissao||'').slice(0,10)===r.data);
      const candidatos=porData.length?porData:base;
      const documentos=new Set(candidatos.map((x)=>x.chave||`d:${x.documento}`));
      if(!documentos.size) { diagnostico.push({documento:r.numero,resultado:'NAO_LOCALIZADO_NA_BASE_COMPARTILHADA'}); continue; }
      if(documentos.size!==1) { diagnostico.push({documento:r.numero,resultado:'AMBIGUO_NA_BASE_COMPARTILHADA'}); continue; }
      const idsRemotos=candidatos.map((x)=>x.id);
      const {error: erroAtualizacao}=await remoto.from('movimentos').update({
        situacao_documento:'CANCELADO',cancelado_em:new Date().toISOString(),
        cancelamento_motivo:'Situação CANCELADO informada pelo Questor',cancelamento_origem:'QUESTOR_RELATORIO_CANCELADOS',
      }).in('id',idsRemotos);
      if(erroAtualizacao) throw erroAtualizacao;
      atualizadosRemoto++; diagnostico.push({documento:r.numero,resultado:'CANCELADO_NA_BASE_COMPARTILHADA'});
    }
    saida.atualizados_base_compartilhada=atualizadosRemoto;
    saida.diagnostico=diagnostico.slice(0,100);
  }
  saida.cancelamentos_registrados=registros.length;
  db.transaction(()=>registros.forEach(r=>{const base=movimentos.filter(x=>{const partes=String(x.documento||'').split('/');const numero=(partes[partes.length-1]||'').replace(/\D/g,'');const serie=(partes.length>1?partes[0]:'').replace(/\D/g,'');return numero===r.numero&&String(x.modelo_documento_fiscal||'').toLowerCase()===r.modelo&&(!r.serie||!serie||serie===r.serie);}); const porData=base.filter(x=>String(x.data_emissao||'').slice(0,10)===r.data); const candidatos=porData.length?porData:base; const docs=new Set(candidatos.map(x=>x.chave||`d:${x.documento}`)); if(!docs.size){saida.nao_localizados++;return;} if(docs.size!==1){saida.ambiguos++;return;} const mudou=candidatos.some(x=>String(x.situacao_documento||'AUTORIZADO')!==r.situacao); db.prepare(`UPDATE movimentos SET situacao_documento=?,cancelado_em=COALESCE(cancelado_em,datetime('now','localtime')),cancelamento_motivo=?,cancelamento_origem='QUESTOR_RELATORIO_CANCELADOS' WHERE id IN (${candidatos.map(()=>'?').join(',')})`).run(r.situacao,`Situação ${r.situacao} informada pelo Questor`,...candidatos.map(x=>x.id)); if(mudou){saida.atualizados++;ids.push(...candidatos.map(x=>x.id));} }));
  if(ids.length) db.prepare(`DELETE FROM motor_resultados WHERE movimento_id IN (${ids.map(()=>'?').join(',')})`).run(...ids);
  return saida;
}

function extrairRelatorioQuestor(texto) {
  let fonte=String(texto||'');
  try { const envelope=JSON.parse(fonte); fonte=String(envelope?.Data||fonte); } catch (_) { /* retorno textual direto */ }
  return fonte;
}

async function conciliarCfopSaidasQuestor(empresaId, texto) {
  // A Conferência de Saídas é a fonte contábil para CFOP. Mantemos o CFOP do
  // XML intacto e registramos, separadamente, o CFOP efetivo informado pelo
  // Questor. Assim a divergência continua auditável e não contamina a origem.
  const fonte=extrairRelatorioQuestor(texto);
  const ano=(fonte.match(/Per[ií]odo:\s*\d{2}\/\d{2}\/(\d{4})/i)||[])[1]||'';
  const registros=[];
  for(const linha of fonte.replace(/\r/g,'').split('\n')) {
    // Exemplo do relatório: 38474  09/03  21627-21627  NFE  1  1047  55  5.916 ...
    const base=linha.match(/^\s*\d+\s+(\d{2}\/\d{2})(?:\/\d{2,4})?\s+(\d+)-(\d+)\s+(NFE|NFSE|NFCE|CTE)\b(.*)$/i);
    if(!base || base[2]!==base[3]) continue;
    const cfop=(base[5].match(/\b([5-7]\.\d{3})\b/)||[])[1];
    if(!cfop || !/^\d{4}$/.test(ano)) continue;
    registros.push({
      data:`${ano}-${base[1].slice(3,5)}-${base[1].slice(0,2)}`,
      numero:base[2], modelo:base[4].toLowerCase(), cfop:cfop.replace(/\D/g,''), linha:linha.trim(),
    });
  }
  const saida={linhas_lidas:registros.length,pareados:0,divergencias:0,atualizados:0,ambiguos:0,nao_localizados:0};
  const empresa=db.prepare('SELECT cnpj FROM empresas WHERE id=?').get(empresaId)||{};
  const cnpj=String(empresa.cnpj||'').replace(/\D/g,'');
  const movimentos=db.prepare("SELECT * FROM movimentos WHERE tipo='cliente' AND (empresa_id=? OR (?<>'' AND replace(replace(replace(emitente_cnpj,'.',''),'/',''),'-','')=?))").all(empresaId,cnpj,cnpj);
  const idsAlterados=[];
  db.transaction(()=>registros.forEach((r)=>{
    const porNumero=movimentos.filter((x)=>{
      const partes=String(x.documento||'').split('/');
      const numero=(partes[partes.length-1]||'').replace(/\D/g,'');
      return numero===r.numero && String(x.modelo_documento_fiscal||'').toLowerCase()===r.modelo;
    });
    const porData=porNumero.filter((x)=>String(x.data_emissao||'').slice(0,10)===r.data);
    const candidatos=porData.length?porData:porNumero;
    const documentos=new Set(candidatos.map((x)=>x.chave||`d:${x.documento}`));
    if(!documentos.size) { saida.nao_localizados++; return; }
    if(documentos.size!==1) { saida.ambiguos++; return; }
    saida.pareados++;
    const xmlCfop=String(candidatos[0].cfop||'').replace(/\D/g,'');
    const diverge=xmlCfop!==r.cfop;
    if(diverge) saida.divergencias++;
    const mudou=candidatos.some((x)=>{
      try { const e=JSON.parse(x.normalizacao_evidencia||'{}'); return String(e.cfop_efetivo||'')!==r.cfop || String(e.cfop_questor||'')!==r.cfop; }
      catch (_) { return true; }
    });
    candidatos.forEach((x)=>{
      let evidencia={}; try { evidencia=JSON.parse(x.normalizacao_evidencia||'{}'); } catch (_) { evidencia={}; }
      evidencia={...evidencia,cfop_xml:String(x.cfop||'').replace(/\D/g,''),cfop_questor:r.cfop,cfop_efetivo:r.cfop,
        fonte_cfop_efetivo:'QUESTOR_CONFERENCIA_SAIDAS',conciliado_em:new Date().toISOString(),documento_questor:r.numero,data_questor:r.data};
      db.prepare('UPDATE movimentos SET normalizacao_status=?,normalizacao_evidencia=? WHERE id=?').run(
        diverge?'DIVERGENCIA_CFOP_QUESTOR':'CFOP_CONCILIADO_QUESTOR',JSON.stringify(evidencia),x.id);
      if(mudou) idsAlterados.push(x.id);
    });
    if(mudou) saida.atualizados++;
  }))();
  if(idsAlterados.length) db.prepare(`DELETE FROM motor_resultados WHERE movimento_id IN (${idsAlterados.map(()=>'?').join(',')})`).run(...idsAlterados);
  return saida;
}

function numeroQuestor(valor) {
  const limpo=String(valor||'').replace(/\./g,'').replace(',','.').replace(/[^0-9.-]/g,'');
  const n=Number(limpo); return Number.isFinite(n) ? n : null;
}
function classificarLocacaoQuestor(descricao) {
  const texto=String(descricao||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  if (!/(loca|aluguel|aluguer)/.test(texto)) return null;
  return /(imovel|imobili|predial|sala comercial|galpao|terreno)/.test(texto)
    ? 'ALUGUEL_IMOVEIS_PROPRIOS' : 'LOCACAO_BENS_MOVEIS';
}
function campoQuestor(linha, nomes) {
  const normalizar=(v)=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
  const indice=Object.fromEntries(Object.entries(linha||{}).map(([chave,valor])=>[normalizar(chave),valor]));
  return nomes.map(normalizar).map((nome)=>indice[nome]).find((valor)=>valor!==undefined&&valor!==null&&valor!=='');
}
function registrosQuestorEstruturados(fonte) {
  let valor=fonte;
  if(typeof valor==='string') { try { valor=JSON.parse(valor); } catch (_) { return null; } }
  if(Array.isArray(valor)) return valor;
  if(valor&&typeof valor==='object') return ['registros','Registros','dados','Dados','data','Data','itens','Itens','result','Result']
    .map((chave)=>valor[chave]).find(Array.isArray)||null;
  return null;
}
function dataQuestorIso(valor) {
  const texto=String(valor||''); const br=texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return br?`${br[3]}-${br[2]}-${br[1]}`:(/^\d{4}-\d{2}-\d{2}/.test(texto)?texto.slice(0,10):null);
}
function lerLocacoesQuestor(fonteOriginal) {
  const estruturados=registrosQuestorEstruturados(fonteOriginal);
  const registros=[];
  if(estruturados) {
    for(const linha of estruturados) {
      const especie=String(campoQuestor(linha,['especie','tipoespecie','especiedocumento'])||'').trim().toUpperCase();
      const descricao=String(campoQuestor(linha,['descricao','descricaoLancamento','historico','descricaoProduto'])||'').trim();
      const data=dataQuestorIso(campoQuestor(linha,['dataLancamento','data','dataEmissao','competencia']));
      const valor=numeroQuestor(campoQuestor(linha,['valorContabil','valor','valorTotal','valorLancamento']));
      const identificador=campoQuestor(linha,['numeroLancamento','nrLcto','lancamento','codigoLancamento','id']);
      const item=classificarLocacaoQuestor(descricao);
      if(especie!=='REC'||!data||!identificador||!item||valor===null||valor<0) continue;
      registros.push({identificador_origem:String(identificador),especie_questor:'REC',competencia:data.slice(0,7),data_lancamento:data,item_receita_chave:item,descricao,valor,linha:JSON.stringify(linha)});
    }
    return registros;
  }
  let fonte=String(fonteOriginal||''); try { const envelope=JSON.parse(fonte); fonte=String(envelope?.Data||envelope?.data||fonte); } catch (_) { /* retorno textual */ }
  const linhas=fonte.replace(/\r/g,'').split('\n');
  // Conferência de Saídas (Gráfico): o cabeçalho da operação traz somente
  // dia/mês e valor; a descrição fiscal vem na linha posterior "Natureza:".
  // O ano é recuperado do período impresso no próprio relatório.
  const periodo=fonte.match(/Per[ií]odo:\s*(\d{2})\/(\d{2})\/(\d{4})\s+a\s+(\d{2})\/(\d{2})\/(\d{4})/i);
  const inicioPeriodo=periodo ? { mes:Number(periodo[2]), ano:Number(periodo[3]) } : null;
  const fimPeriodo=periodo ? { mes:Number(periodo[5]), ano:Number(periodo[6]) } : null;
  for (let indice=0; indice<linhas.length; indice++) {
    const linha=linhas[indice];
    const cabecalho=linha.match(/^\s*(\d+)\s+(\d{2})\/(\d{2})\s+\d+-\d+\s+REC\b.*?\s+([\d.]+,\d{2})\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s+[\d.]+,\d{2}\s*$/i);
    if (cabecalho && inicioPeriodo && fimPeriodo) {
      const dia=Number(cabecalho[2]), mes=Number(cabecalho[3]);
      const ano=(inicioPeriodo.ano !== fimPeriodo.ano && mes < inicioPeriodo.mes) ? fimPeriodo.ano : inicioPeriodo.ano;
      const natureza=(linhas.slice(indice+1,indice+6).map((x)=>x.match(/^\s*Natureza:\s*.+?-\s*(.+?)\s*$/i)).find(Boolean)||[])[1] || '';
      const item=classificarLocacaoQuestor(natureza);
      const valor=numeroQuestor(cabecalho[4]);
      if (item && valor!==null && valor>=0) {
        const data=`${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
        registros.push({ identificador_origem:cabecalho[1], especie_questor:'REC', competencia:data.slice(0,7), data_lancamento:data,
          item_receita_chave:item, descricao:natureza, valor, linha:`${linha.trim()} | Natureza: ${natureza}` });
      }
      continue;
    }
    // Layout observado: lançamento REC data código descrição ... valor.
    // A espécie REC é obrigatória; a descrição é conservada como evidência.
    const m=linha.match(/^\s*(\d+)\s+REC\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+)\s+(.+?)\s+([\d.]+,\d{2})\s*$/i);
    if (!m) continue;
    const item=classificarLocacaoQuestor(m[4]);
    const valor=numeroQuestor(m[5]);
    if (!item || valor===null || valor<0) continue;
    registros.push({ identificador_origem:m[1], especie_questor:'REC', competencia:`${m[2].slice(6)}-${m[2].slice(3,5)}`,
      data_lancamento:`${m[2].slice(6)}-${m[2].slice(3,5)}-${m[2].slice(0,2)}`, item_receita_chave:item, descricao:m[4].trim(), valor, linha:linha.trim() });
  }
  return registros;
}
async function importarLocacoesQuestor(empresaId, texto) {
  const registros=lerLocacoesQuestor(texto);
  const dadosAdicionais=require('../services/dadosAdicionaisAnalise');
  const resultado={linhas_lidas:registros.length,importados:0,ignorados:0,locacao_bens_moveis:0,locacao_imoveis:0,mensagens:[]};
  for (const r of registros) {
    try {
      dadosAdicionais.salvarReceitaSemDfe(db, empresaId, {
        competencia:r.competencia,item_receita_chave:r.item_receita_chave,descricao:r.descricao,valor:r.valor,
        origem:'QUESTOR_LANCAMENTOS_FISCAIS',evidencia:`Questor · TnFisDPConsultLctoFiscal · lançamento ${r.identificador_origem} · ${r.data_lancamento}`,
        identificador_origem:r.identificador_origem,especie_questor:'REC',
      });
      resultado.importados++;
      if(r.item_receita_chave==='LOCACAO_BENS_MOVEIS') resultado.locacao_bens_moveis++; else resultado.locacao_imoveis++;
    } catch (e) {
      resultado.ignorados++; resultado.mensagens.push(`Lançamento ${r.identificador_origem}: ${e.message}`);
    }
  }
  // A tarefa não pode ser concluída só porque gravou no SQLite efêmero.
  // Se a fonte compartilhada recusar a linha, ela falha de forma visível e
  // pode ser repetida; nunca mais há sucesso seguido de desaparecimento.
  if (resultado.importados) await require('../services/dadosAdicionaisCompartilhados').publicar(db, empresaId);
  return resultado;
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
    // conciliarCancelamentosQuestor grava diretamente a fonte canônica. Não
    // publicar a fotografia SQLite depois disso: uma instância com cache
    // anterior poderia regravar AUTORIZADO sobre o cancelamento confirmado.
    if(ok&&t.tipo==='DOCUMENTOS_FISCAIS_CANCELADOS') { resultado={...resultado,...await conciliarCancelamentosQuestor(t.empresa_id,resultado.relatorio)}; }
    if(ok&&t.tipo==='CONCILIAR_CFOP_SAIDAS') { resultado={...resultado,...await conciliarCfopSaidasQuestor(t.empresa_id,resultado.relatorio)}; require('../services/operacaoCompartilhada').publicar().catch(()=>{}); }
    if(ok&&t.tipo==='IMPORTAR_OUTRAS_RECEITAS_LOCACAO') { resultado={...resultado,...await importarLocacoesQuestor(t.empresa_id,resultado.relatorio)}; }
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
module.exports.lerCancelamentosQuestor=lerCancelamentosQuestor;
module.exports.lerLocacoesQuestor=lerLocacoesQuestor;
