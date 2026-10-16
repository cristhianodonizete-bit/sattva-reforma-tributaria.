// Estados só podem ser gravados depois que seu movimento canônico existir localmente.
const assert=require('node:assert/strict'),os=require('os'),fs=require('fs'),path=require('path');
process.env.SATTVA_DADOS=process.env.SATTVA_DADOS||fs.mkdtempSync(path.join(os.tmpdir(),'sattva-restauracao-'));
process.env.SUPABASE_URL='https://fake.supabase.test';process.env.SUPABASE_SERVICE_ROLE_KEY='chave-falsa';process.env.SUPABASE_OPERACAO_COMPARTILHADA='true';
const db=require('../src/db');
const {restaurarFotografiaMotorEmpresa}=require('../src/services/operacaoCompartilhada');
const CNPJ='11222333000181',REMOTA=900,EXECUCAO=987654,PRIMEIRO=999001,ATIVOS=1306,ORFAOS=202;
const ativos=Array.from({length:ATIVOS},(_,i)=>PRIMEIRO+i),orfaos=Array.from({length:ORFAOS},(_,i)=>PRIMEIRO+ATIVOS+i);
const tabelas={
  empresas:[{id:REMOTA,cnpj:CNPJ,origem_local_id:null}],
  motor_resultados_operacionais:ativos.map((movimento_id,i)=>({id:i+1,empresa_id:REMOTA,movimento_id,execucao_id:EXECUCAO,ativo:true,dados:{sentido:'saida',cbs:1,detalhe:{reconstrucao:{origem:'TESTE'}}}})),
  motor_execucoes_operacionais:[{id:EXECUCAO,empresa_id:REMOTA,ano:2026,itens:ATIVOS,classificados:ATIVOS,ativo:true,resumo:{origem:'TESTE'},criado_em:'2026-01-01'}],
  movimentos:[...ativos,...orfaos].map((id)=>({id,empresa_id:REMOTA,tipo:'fornecedor',nome:'Movimento canônico',documento:'FOTO-CANONICA',item_numero:id,valor:1,base_calculo:1,sentido:'entrada'})),
  projecoes_movimentos_estado:[...ativos.map(movimento_id=>({empresa_id:REMOTA,movimento_id,assinatura_origem:`a${movimento_id}`,versao_origem:1,assinatura_calculada:`a${movimento_id}`,versao_calculada:1,situacao:'ATUAL',atualizado_em:'2026-01-01'})),...orfaos.map(movimento_id=>({empresa_id:REMOTA,movimento_id,assinatura_origem:`o${movimento_id}`,versao_origem:1,assinatura_calculada:`o${movimento_id}`,versao_calculada:1,situacao:'ATUAL',atualizado_em:'2026-01-01'}))],
};
let empresaLocal;
function consulta(tabela){const filtros=[];let ordem,faixa,limite,cabecalho=false,contagem=false;const q={select(_c,o={}){cabecalho=!!o.head;contagem=!!o.count;return q},eq(c,v){filtros.push(x=>String(x[c])===String(v));return q},in(c,vs){filtros.push(x=>vs.map(String).includes(String(x[c])));return q},gt(c,v){filtros.push(x=>Number(x[c])>Number(v));return q},or(texto){const cnpj=texto.match(/cnpj\.eq\.([0-9]+)/)?.[1];filtros.push(x=>String(x.origem_local_id)===String(empresaLocal)||String(x.cnpj||'').replace(/\D/g,'')===cnpj);return q},order(c,o={}){ordem=[c,o.ascending!==false];return q},limit(n){limite=n;return q},range(a,b){faixa=[a,b];return q},then(ok,erro){try{let xs=(tabelas[tabela]||[]).filter(x=>filtros.every(f=>f(x)));if(ordem)xs=[...xs].sort((a,b)=>(Number(a[ordem[0]])-Number(b[ordem[0]]))*(ordem[1]?1:-1));if(faixa)xs=xs.slice(faixa[0],faixa[1]+1);if(limite!=null)xs=xs.slice(0,limite);return Promise.resolve(cabecalho?{data:null,error:null,count:xs.length}:{data:xs,error:null,count:contagem?xs.length:null}).then(ok,erro)}catch(e){return Promise.reject(e).then(ok,erro)}}};return q}
const remoto={from:consulta};
(async()=>{
  empresaLocal=Number(db.prepare('INSERT INTO empresas(cnpj,razao_social) VALUES (?,?)').run(CNPJ,'Teste Fotografia').lastInsertRowid);tabelas.empresas[0].origem_local_id=empresaLocal;
  await restaurarFotografiaMotorEmpresa(empresaLocal,remoto);
  assert.equal(db.prepare('SELECT COUNT(*) quantidade FROM motor_resultados WHERE empresa_id=?').get(empresaLocal).quantidade,ATIVOS);
  assert.equal(db.prepare('SELECT COUNT(*) quantidade FROM movimentos WHERE empresa_id=?').get(empresaLocal).quantidade,ATIVOS+ORFAOS);
  assert.equal(db.prepare('SELECT COUNT(*) quantidade FROM projecoes_movimentos_estado WHERE empresa_id=?').get(empresaLocal).quantidade,ATIVOS+ORFAOS);
  assert.equal(db.prepare('SELECT quantidade_estados FROM fotografia_oficial WHERE empresa_id=?').get(empresaLocal).quantidade_estados,ATIVOS+ORFAOS);
  // FK preservada: o estado só entra após a hidratação resolver remoto→local.
  const mapeado=db.prepare('SELECT movimento_local_id FROM movimentos_cache_remoto WHERE empresa_id=? AND movimento_remoto_id=?').get(empresaLocal,orfaos[0]);
  assert.notEqual(mapeado,undefined);
  assert.notEqual(db.prepare('SELECT id FROM movimentos WHERE empresa_id=? AND id=?').get(empresaLocal,mapeado.movimento_local_id),undefined);
  assert.equal(db.prepare('SELECT movimento_id FROM projecoes_movimentos_estado WHERE empresa_id=? AND movimento_id=?').get(empresaLocal,mapeado.movimento_local_id).movimento_id,mapeado.movimento_local_id);
  const ausente=PRIMEIRO+ATIVOS+ORFAOS+1;tabelas.motor_resultados_operacionais.push({id:ATIVOS+1,empresa_id:REMOTA,movimento_id:ausente,execucao_id:EXECUCAO,ativo:true,dados:{sentido:'saida',cbs:1,detalhe:{}}});
  const movimentosAntes=db.prepare('SELECT COUNT(*) quantidade FROM movimentos WHERE empresa_id=?').get(empresaLocal).quantidade;
  const estadosAntes=db.prepare('SELECT COUNT(*) quantidade FROM projecoes_movimentos_estado WHERE empresa_id=?').get(empresaLocal).quantidade;
  await assert.rejects(restaurarFotografiaMotorEmpresa(empresaLocal,remoto),/1 movimento\(s\) da fotografia não existe\(m\) na fonte canônica/);
  assert.equal(db.prepare('SELECT COUNT(*) quantidade FROM movimentos WHERE empresa_id=?').get(empresaLocal).quantidade,movimentosAntes);
  assert.equal(db.prepare('SELECT COUNT(*) quantidade FROM projecoes_movimentos_estado WHERE empresa_id=?').get(empresaLocal).quantidade,estadosAntes);
  console.log('restauracao-fotografia-estados-fk: 1306 ativos + 202 estados com FK hidratada; falta canônica bloqueia sem escrita: OK');
})().catch(e=>{console.error(e);process.exitCode=1});
