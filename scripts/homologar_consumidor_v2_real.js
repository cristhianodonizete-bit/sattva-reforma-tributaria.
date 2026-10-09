/* Homologação real: PostgREST local + PostgreSQL descartável + SQLite temporário.
   Requer HOMOLOG_POSTGRES_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e SATTVA_DADOS. */
const fs=require('fs'); const path=require('path'); const assert=require('assert'); const {Client}=require('pg');
const raiz=path.join(__dirname,'..');
const pgUrl=process.env.HOMOLOG_POSTGRES_URL;
if (!pgUrl || !process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.SATTVA_DADOS) throw new Error('Ambiente local de homologação incompleto.');
const resultadoJson=process.env.HOMOLOG_RESULTADO_JSON;
const rpcTraceFile=process.env.HOMOLOG_RPC_TRACE_JSONL;
const fetchNativo=globalThis.fetch;
function jsonSeguro(texto){ try{return JSON.parse(texto);}catch(_){return texto;} }
function corpoSeguro(body){
  if (typeof body==='string') return jsonSeguro(body);
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  return body==null ? null : '[corpo binário ou stream]';
}
globalThis.fetch=async function fetchPostgrestHomologacao(input,init={}){
  const original=typeof input==='string'||input instanceof URL ? String(input) : input.url;
  const url=new URL(original);
  if (url.pathname==='/rest/v1') url.pathname='/';
  else if (url.pathname.startsWith('/rest/v1/')) url.pathname=url.pathname.slice('/rest/v1'.length);
  const request=typeof input==='string'||input instanceof URL ? url : new Request(url,new Request(input));
  let resposta;
  try { resposta=await fetchNativo(request,init); }
  catch(erro){
    if (rpcTraceFile && url.pathname.startsWith('/rpc/')) {
      const registro={instante:new Date().toISOString(),metodo:String(init.method||(request.method||'GET')).toUpperCase(),caminho:url.pathname,status:0,status_text:'',requisição:corpoSeguro(init.body),erro_transporte:{name:erro?.name||null,message:erro?.message||String(erro),code:erro?.code||null}};
      fs.appendFileSync(rpcTraceFile,`${JSON.stringify(registro)}\n`,'utf8');
    }
    throw erro;
  }
  if (rpcTraceFile && url.pathname.startsWith('/rpc/')) {
    const body=await resposta.clone().text();
    const registro={instante:new Date().toISOString(),metodo:String(init.method||(request.method||'GET')).toUpperCase(),caminho:url.pathname,status:resposta.status,status_text:resposta.statusText,requisição:corpoSeguro(init.body),resposta:jsonSeguro(body)};
    fs.appendFileSync(rpcTraceFile,`${JSON.stringify(registro)}\n`,'utf8');
  }
  return resposta;
};
const sql=n=>fs.readFileSync(path.join(raiz,'supabase','migrations',n),'utf8');
const c=new Client({connectionString:pgUrl,ssl:false});
const resultado={homologacao:'consumidor_real_v2',aprovados:[],falhos:[],nao_executados:[],metricas:{}};
let cenarioAtual='preparacao_postgrest';
const ok=(cenario,detalhe={})=>resultado.aprovados.push({cenario,detalhe});
function evidenciaResposta(resposta){return {status:resposta?.status??null,status_text:resposta?.statusText??null,dados:resposta?.data??null,erro:resposta?.error?{code:resposta.error.code??null,message:resposta.error.message??null,details:resposta.error.details??null,hint:resposta.error.hint??null}:null};}
const cenariosObrigatorios=['carga_base_real','transicao_legado_v2_e_delta','publicacao_idempotente_movimentos_e_parceiros','dois_ciclos_sem_alteracao','tombstone_republicacao_e_restauracao','falha_reinicio_idempotencia','lease_consumidor_real'];
async function q(text,params=[]){ return c.query(text,params); }
async function esperarPostgrest(){
  const limite=Date.now()+Number(process.env.HOMOLOG_POSTGREST_TIMEOUT_MS||120000); let ultimo='sem resposta';
  while(Date.now()<limite){
    try {
      const resposta=await fetch(`${process.env.SUPABASE_URL}/empresas?select=id&limit=1`,{headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`}});
      if(resposta.ok) return;
      ultimo=`HTTP ${resposta.status}: ${(await resposta.text()).slice(0,300)}`;
    } catch(erro){ ultimo=erro.message; }
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  throw new Error(`PostgREST não ficou pronto após migrations/cache: ${ultimo}`);
}
function nomesRemotos(){
  const fonte=fs.readFileSync(path.join(raiz,'src','services','operacaoCompartilhada.js'),'utf8');
  const bloco=fonte.slice(fonte.indexOf('const CAMPOS = {'),fonte.indexOf('const CONFIG_TABELAS'));
  const campos=[...bloco.matchAll(/^\s{2}([a-z_]+): \[/gm)].map(x=>x[1]);
  const diretos=[...fonte.matchAll(/\.from\('([a-z_]+)'\)/g)].map(x=>x[1]);
  return [...new Set([...campos,...diretos])].filter(x=>/^[a-z_]+$/.test(x));
}
function contratoCargaBase(){
  const fonte=fs.readFileSync(path.join(raiz,'src','services','operacaoCompartilhada.js'),'utf8');
  const bloco=fonte.slice(fonte.indexOf('const CAMPOS = {'),fonte.indexOf('const CONFIG_TABELAS'));
  const tabelas={};
  for(const achado of bloco.matchAll(/^\s{2}([a-z_]+): \[([^\]]*)\]/gm)) tabelas[achado[1]]=[...achado[2].matchAll(/'([a-z_]+)'/g)].map(x=>x[1]);
  Object.assign(tabelas,{
    parametros_operacionais:['tabela','chave','dados'],
    param_irpj_csll_versionados:['id','tributo','regime','natureza_receita','tipo_base','percentual_base','aliquota','adicional','limite_adicional','limite_receita_anual','acrescimo_percentual_base_excedente','aplicacao_excedente','vigencia_inicio','vigencia_fim','fonte','fundamento','versao','status','criado_em','atualizado_em'],
    projetos:['id','empresa_id','origem_local_contratacao_id','nome_plano','escopo','status','acompanhamento_meses','competencia_referencia','aprovado_em','criado_em','atualizado_em'],
    projeto_entregas:['id','projeto_id','origem_local_id','chave','titulo','status','concluido_em','observacoes'],
    projeto_acompanhamentos:['id','projeto_id','origem_local_id','competencia','nome','status','observacoes','criado_em'],
    projeto_responsaveis:['id','projeto_id','entrega_id','origem_local_id','lado','usuario_id','nome','telefone','email','funcao','criado_em'],
    projeto_tarefas:['id','projeto_id','entrega_id','origem_local_id','titulo','descricao','status','data_abertura','data_conclusao','envolve_cliente','pendencia_cliente','interacoes_cliente','obrigatoria','sla_marco_id','prazo_original','prorrogado_em','justificativa_prorrogacao','criado_em','atualizado_em'],
    projeto_checklist_implantacao:['id','projeto_id','entrega_id','origem_local_id','escopo','chave','titulo','tipo_evidencia','status','responsavel_id','origem_tipo','origem_id','observacoes','ordem','origem','criado_em','atualizado_em'],
    sla_marcos:['id','origem_local_id','chave','titulo','prazo_dias','precedencia_chave','ativo','ordem','criado_em','atualizado_em'],
    sla_tarefas:['id','origem_local_id','marco_id','titulo','descricao','obrigatoria','ativo','ordem'],
    sincronizacao_operacional_tombstones:['empresa_id','tabela','chave','sequencia_exclusao','excluido_em','restaurado_em','restaurado_por','justificativa_restauracao'],
  });
  return {tabelas,funcoes:['public.registrar_consumidor_sincronizacao_operacional(text,text,integer)','public.publicar_eventos_sincronizacao_operacional(integer)','public.estado_fila_sincronizacao_operacional()','public.confirmar_checkpoint_sincronizacao_operacional(text,text,bigint,boolean)','public.restaurar_linha_sincronizacao_operacional(text,jsonb,text)']};
}
function tipoColunaHomologacao(coluna){
  if(['ativo','brasileiro','cancelado','obrigatoria','envolve_cliente'].includes(coluna)) return 'boolean';
  if(/(^id$|_id$|^ordem$|^prioridade$|^registros$|^ignorados$|^item_numero$|^prazo_dias$|^acompanhamento_meses$)/.test(coluna)) return 'bigint';
  if(/(^dados$|^chave$)/.test(coluna)) return coluna==='dados'?'jsonb':'text';
  return 'text';
}
async function verificarDependenciasCargaBase(){
  const contrato=contratoCargaBase();
  const colunas=(await q("select table_name,column_name from information_schema.columns where table_schema='public'")).rows;
  const existentes=new Map(); for(const linha of colunas){if(!existentes.has(linha.table_name)) existentes.set(linha.table_name,new Set()); existentes.get(linha.table_name).add(linha.column_name);}
  const ausencias=[];
  for(const [tabela,esperadas] of Object.entries(contrato.tabelas)){
    if(!existentes.has(tabela)){ausencias.push({tipo:'tabela',objeto:`public.${tabela}`});continue;}
    for(const coluna of esperadas) if(!existentes.get(tabela).has(coluna)) ausencias.push({tipo:'coluna',objeto:`public.${tabela}.${coluna}`});
    const permissao=(await q("select has_table_privilege('service_role',$1,'SELECT') ok",[`public.${tabela}`])).rows[0]?.ok;
    if(!permissao) ausencias.push({tipo:'permissao',objeto:`SELECT public.${tabela} para service_role`});
  }
  for(const assinatura of contrato.funcoes){
    const funcao=(await q('select to_regprocedure($1) is not null existe, case when to_regprocedure($1) is null then false else has_function_privilege(\'service_role\',to_regprocedure($1),\'EXECUTE\') end executa',[assinatura])).rows[0];
    if(!funcao.existe) ausencias.push({tipo:'funcao',objeto:assinatura}); else if(!funcao.executa) ausencias.push({tipo:'permissao',objeto:`EXECUTE ${assinatura} para service_role`});
  }
  const preflight={ok:ausencias.length===0,tabelas_verificadas:Object.keys(contrato.tabelas).length,funcoes_verificadas:contrato.funcoes.length,ausencias};
  resultado.preflight=preflight;
  if(ausencias.length) throw new Error(`Dependências incompletas: ${JSON.stringify(ausencias)}`);
  return preflight;
}
async function prepararSchema(){
  await q(`create table public.empresas(id bigint primary key, origem_local_id bigint, cnpj text, razao_social text, nome_fantasia text, regime text, criado_em timestamptz default clock_timestamp());
    create table public.movimentos(id bigint primary key, empresa_id bigint not null, lote_id bigint, tipo text, nome text, descricao text, competencia text, valor numeric, chave text, item_numero integer default 1, origem text, criado_em timestamptz default clock_timestamp(), unique(empresa_id,chave,item_numero));`);
  const especiais=new Set(['empresas','movimentos','parametros_operacionais','param_irpj_csll_versionados','projetos','projeto_entregas','projeto_acompanhamentos','projeto_responsaveis','projeto_tarefas','projeto_checklist_implantacao','sla_marcos','sla_tarefas']);
  for (const tabela of nomesRemotos()) {
    if (especiais.has(tabela)||tabela.startsWith('sincronizacao_operacional_')) continue;
    await q(`create table if not exists public.${tabela}(id bigint primary key, empresa_id bigint, lote_id bigint, movimento_id bigint, execucao_id text, chave text, tabela text, tipo text, status text, codigo text, nome text, documento text, competencia text, valor numeric, ativo boolean, origem text, dados jsonb, criado_em timestamptz, atualizado_em timestamptz)`);
  }
  const contrato=contratoCargaBase();
  for(const [tabela,colunas] of Object.entries(contrato.tabelas)){
    if(!/^[a-z_]+$/.test(tabela)) throw new Error(`Tabela inválida no contrato: ${tabela}`);
    if(tabela.startsWith('sincronizacao_operacional_')) continue;
    await q(`create table if not exists public.${tabela}(id bigint generated by default as identity primary key)`);
    for(const coluna of colunas){
      if(coluna==='id'||!/^[a-z_]+$/.test(coluna)) continue;
      await q(`alter table public.${tabela} add column if not exists ${coluna} ${tipoColunaHomologacao(coluna)}`);
    }
  }
  await q(`create unique index if not exists ux_parametros_operacionais on public.parametros_operacionais(tabela,chave);
    create unique index if not exists ux_param_irpj_csll_homolog on public.param_irpj_csll_versionados(tributo,regime,natureza_receita,versao,vigencia_inicio);`);
  await q(sql('20260917_trilha_incremental_operacional.sql'));
  // A migration 20260917 já instala exatamente um gatilho por tabela.
  // Criá-los novamente aqui duplicava artificialmente cada evento.
  await q(`insert into public.empresas(id,origem_local_id,cnpj,razao_social,regime) values(1,1,'00000000000191','Empresa teste','Lucro Real');
    insert into public.movimentos(id,empresa_id,tipo,nome,descricao,competencia,valor,chave,item_numero,origem) values(1,1,'ENTRADA','Fornecedor','Base','2026-01',100,'NFE-1',1,'teste');`);
  await q(sql('20261015_sincronizacao_operacional_v2_homologacao.sql'));
  await q(sql('20261016_sincronizacao_exclusoes_v2_homologacao.sql'));
  await q(sql('20261017_sincronizacao_eventos_idempotentes.sql'));
  const configuracoes=['param_regras','param_aliquotas','param_tributos','param_regimes','param_reducoes','param_cfop','param_simples','param_naturezas_juridicas_anexo_xi','catalogo_itens_receita','regras_itens_receita_regime','servicos','combos','combo_itens'];
  for(const chave of configuracoes) await q("insert into public.parametros_operacionais(tabela,chave,dados) values('configuracao',$1,'[]'::jsonb) on conflict(tabela,chave) do update set dados=excluded.dados",[chave]);
  await q(`insert into public.param_irpj_csll_versionados(tributo,regime,natureza_receita,tipo_base,percentual_base,aliquota,vigencia_inicio,fonte,fundamento,versao,status)
    values('IRPJ','lucro_presumido','SERVICOS_GERAIS','BASE_PRESUNCAO',0.32,0.15,'2026-01-01','HOMOLOGACAO_LOCAL','DADO SINTETICO SEM VALIDADE FISCAL','homologacao','ATIVO') on conflict do nothing;
    grant usage on schema public to authenticator, anon, authenticated, service_role; grant select,insert,update,delete on all tables in schema public to service_role; grant usage,select on all sequences in schema public to service_role; grant execute on all functions in schema public to service_role; notify pgrst,'reload schema';`);
}
function recarregarServico(){
  delete require.cache[require.resolve('../src/services/operacaoCompartilhada')];
  return require('../src/services/operacaoCompartilhada');
}
async function main(){
  let conectado=false;
  try {
    await c.connect(); conectado=true;
    await q('begin');
    try { await prepararSchema(); await verificarDependenciasCargaBase(); await q('commit'); }
    catch(erro){ try{await q('rollback');}catch(_){/* preservar a causa original */} throw erro; }
    await esperarPostgrest();
    let operacao=recarregarServico(); cenarioAtual='carga_base_real';
    const base=await operacao.sincronizarIncremental();
    assert.equal(base.modo,'carga_base_v2');
    const db=require('../src/db');
    assert.ok(db.prepare('select id from movimentos where id=1').get());
    ok('carga_base_real',{modo:base.modo});
    cenarioAtual='transicao_legado_v2_e_delta';
    const evidenciaMovimento2={}; resultado.evidencias={movimento_id_2:evidenciaMovimento2};
    const checkpointAntes=(await q('select sequencia_confirmada from public.sincronizacao_operacional_consumidores where consumidor_id=$1',[process.env.SINCRONIZACAO_CONSUMIDOR_ID])).rows[0];
    await q("insert into public.movimentos(id,empresa_id,tipo,nome,descricao,competencia,valor,chave,item_numero,origem) values(2,1,'ENTRADA','Fornecedor','Delta','2026-01',200,'NFE-2',1,'teste')");
    evidenciaMovimento2.fonte_postgresql={confirmado:(await q('select id,empresa_id,chave,item_numero from public.movimentos where id=2')).rows[0]||null};
    evidenciaMovimento2.gatilho={evento:(await q("select sequencia,sequencia_consumo,tabela,operacao,chave,empresa_id from public.sincronizacao_operacional_eventos where tabela='movimentos' and chave->>'id'='2' order by sequencia desc limit 1")).rows[0]||null};
    evidenciaMovimento2.checkpoint_antes={remoto:Number(checkpointAntes?.sequencia_confirmada||0),local:db.prepare("select valor from sincronizacao_operacional_estado where chave='operacao_compartilhada_sequencia_v2'").get()?.valor||null};
    const delta=await operacao.sincronizarIncremental();
    const remotoEvidencia=require('../src/services/supabase').admin();
    evidenciaMovimento2.fila_publicada={evento:(await q("select sequencia,sequencia_consumo,tabela,operacao,chave,empresa_id from public.sincronizacao_operacional_eventos where tabela='movimentos' and chave->>'id'='2' order by sequencia desc limit 1")).rows[0]||null};
    evidenciaMovimento2.consumidor={resultado_incremental:delta,leitura_eventos:evidenciaResposta(await remotoEvidencia.from('sincronizacao_operacional_eventos').select('sequencia,sequencia_consumo,tabela,operacao,chave,empresa_id').gt('sequencia_consumo',Number(checkpointAntes?.sequencia_confirmada||0)).not('sequencia_consumo','is',null).order('sequencia_consumo',{ascending:true}))};
    evidenciaMovimento2.leitura_canonica=evidenciaResposta(await remotoEvidencia.from('movimentos').select('*').eq('id',2).limit(2));
    evidenciaMovimento2.sqlite={registro:db.prepare('select id,empresa_id,chave,item_numero from movimentos where id=2').get()||null};
    const checkpointDepois=(await q('select sequencia_confirmada from public.sincronizacao_operacional_consumidores where consumidor_id=$1',[process.env.SINCRONIZACAO_CONSUMIDOR_ID])).rows[0];
    evidenciaMovimento2.checkpoint_depois={remoto:Number(checkpointDepois?.sequencia_confirmada||0),local:db.prepare("select valor from sincronizacao_operacional_estado where chave='operacao_compartilhada_sequencia_v2'").get()?.valor||null,ordem:'após transação SQLite concluída'};
    assert.ok(db.prepare('select id from movimentos where id=2').get());
    ok('transicao_legado_v2_e_delta',{modo:delta.modo,evidencia:'resultado.evidencias.movimento_id_2'});
    cenarioAtual='publicacao_idempotente_movimentos_e_parceiros';
    const contarEventos=async()=>Number((await q('select count(*)::bigint total from public.sincronizacao_operacional_eventos')).rows[0].total);
    await q("insert into public.parceiros(id,empresa_id,tipo,cnpj,descricao,regime,origem,criado_em) values(1,1,'fornecedor','00000000000191','Parceiro teste','lucro_real','teste',clock_timestamp())");
    const eventosAntes=await contarEventos();
    await q("update public.movimentos set valor=valor,nome=nome where id=1");
    await q("update public.movimentos set lote_id=coalesce(lote_id,0)+1,criado_em=clock_timestamp() where id=1");
    await q("update public.parceiros set descricao=descricao,criado_em=clock_timestamp() where id=1");
    const eventosAposRepeticao=await contarEventos();
    assert.equal(eventosAposRepeticao,eventosAntes,'Repetição/reimportação técnica gerou evento.');
    await q("update public.movimentos set valor=101 where id=1");
    await q("update public.parceiros set regime='lucro_presumido' where id=1");
    const eventosAposNegocio=await contarEventos();
    const eventosNegocio=(await q(`select tabela,operacao,count(*)::int total from public.sincronizacao_operacional_eventos
      where sequencia>(select coalesce(max(sequencia),0)-$1 from public.sincronizacao_operacional_eventos)
      group by tabela,operacao order by tabela`,[eventosAposNegocio-eventosAposRepeticao])).rows;
    assert.equal(eventosAposNegocio-eventosAposRepeticao,2,`Alterações de negócio geraram ${eventosAposNegocio-eventosAposRepeticao} evento(s), esperado 2.`);
    assert.deepEqual(eventosNegocio.map(x=>[x.tabela,x.operacao,x.total]),[['movimentos','UPDATE',1],['parceiros','UPDATE',1]]);
    const cicloAlterado=await operacao.sincronizarIncremental();
    assert.equal(Number(db.prepare('select valor from movimentos where id=1').get().valor),101);
    assert.equal(db.prepare('select regime from parceiros where id=1').get().regime,'lucro_presumido');
    ok('publicacao_idempotente_movimentos_e_parceiros',{eventos_antes:eventosAntes,eventos_apos_repeticao:eventosAposRepeticao,eventos_apos_alteracao:eventosAposNegocio,eventos_negocio:eventosNegocio,eventos_incrementais:cicloAlterado.eventos});
    cenarioAtual='dois_ciclos_sem_alteracao';
    const primeiroSemMudanca=await operacao.sincronizarIncremental();
    const segundoSemMudanca=await operacao.sincronizarIncremental();
    assert.equal(Number(primeiroSemMudanca.eventos||0),0);
    assert.equal(Number(segundoSemMudanca.eventos||0),0);
    assert.equal(await contarEventos(),eventosAposNegocio);
    ok('dois_ciclos_sem_alteracao',{primeiro:Number(primeiroSemMudanca.eventos||0),segundo:Number(segundoSemMudanca.eventos||0)});
    cenarioAtual='tombstone_republicacao_e_restauracao'; await q('delete from public.movimentos where id=2');
    await operacao.sincronizarIncremental();
    assert.equal(db.prepare('select id from movimentos where id=2').get(),undefined);
    let recusada=false; try { await q("insert into public.movimentos(id,empresa_id,tipo,nome,descricao,competencia,valor,chave,item_numero,origem) values(2,1,'ENTRADA','Antigo','República','2026-01',200,'NFE-2',1,'teste')"); } catch (_) { recusada=true; }
    assert.ok(recusada);
    await operacao.restaurarLinhaCanonica('movimentos',{id:2,empresa_id:1,tipo:'ENTRADA',nome:'Fornecedor',descricao:'Restaurado',competencia:'2026-01',valor:200,chave:'NFE-2',item_numero:1,origem:'teste'},'restauração homologada');
    await operacao.sincronizarIncremental();
    assert.ok(db.prepare('select id from movimentos where id=2').get());
    const tomb=(await q("select empresa_id,tabela,restaurado_em from public.sincronizacao_operacional_tombstones where tabela='movimentos' and chave->>'id'='2'")).rows[0];
    assert.equal(String(tomb.empresa_id),'1'); assert.ok(tomb.restaurado_em);
    ok('tombstone_republicacao_e_restauracao',{republicacao_recusada:recusada});
    cenarioAtual='falha_reinicio_idempotencia'; await q("insert into public.movimentos(id,empresa_id,tipo,nome,descricao,competencia,valor,chave,item_numero,origem) values(3,1,'ENTRADA','Fornecedor','Falha','2026-01',300,'NFE-3',1,'teste')");
    const supabase=require('../src/services/supabase').admin(); let falhar=true;
    const remoto={from:(...a)=>supabase.from(...a),rpc:async(nome,args)=>{
      if (nome==='confirmar_checkpoint_sincronizacao_operacional'&&falhar) { falhar=false; return {data:null,error:{message:'falha injetada antes do checkpoint'}}; }
      return supabase.rpc(nome,args);
    }};
    await assert.rejects(()=>operacao.sincronizarIncremental({remoto}),/falha injetada/);
    assert.ok(db.prepare('select id from movimentos where id=3').get());
    const consumidor=process.env.SINCRONIZACAO_CONSUMIDOR_ID;
    const antes=(await q('select sequencia_confirmada from public.sincronizacao_operacional_consumidores where consumidor_id=$1',[consumidor])).rows[0];
    assert.ok(Number(antes.sequencia_confirmada)<Number((await q('select max(sequencia_consumo) s from public.sincronizacao_operacional_eventos')).rows[0].s));
    await q('update public.sincronizacao_operacional_consumidores set lease_expira_em=clock_timestamp()-interval \'1 second\' where consumidor_id=$1',[consumidor]);
    operacao=recarregarServico();
    const retomada=await operacao.sincronizarIncremental();
    assert.ok(db.prepare('select id from movimentos where id=3').get());
    ok('falha_reinicio_idempotencia',{modo:retomada.modo});
    cenarioAtual='lease_consumidor_real'; const outra=recarregarServico();
    await assert.rejects(()=>outra.sincronizarIncremental(),/outra sessão|lease/i);
    ok('lease_consumidor_real');
    resultado.metricas={tombstones:1,sqlite_temp:process.env.SATTVA_DADOS};
  } catch (erro) { resultado.falhos.push({cenario:cenarioAtual,erro:erro?.stack||erro?.message||String(erro),rpc:erro?.rpc||null}); process.exitCode=1; }
  finally {
    const concluídos=new Set(resultado.aprovados.map(x=>x.cenario));
    for(const cenario of cenariosObrigatorios) if(!concluídos.has(cenario)&&!resultado.falhos.some(x=>x.cenario===cenario)) resultado.nao_executados.push({cenario,motivo:'Execução interrompida antes deste cenário.'});
    if(conectado) try { await c.end(); } catch (erro) { resultado.falhos.push({cenario:'encerramento_postgres',erro:erro?.stack||erro?.message||String(erro)}); process.exitCode=1; }
    const json=JSON.stringify(resultado,null,2);
    if(resultadoJson) fs.writeFileSync(resultadoJson,json,'utf8');
    console.log(json);
  }
}
main();
