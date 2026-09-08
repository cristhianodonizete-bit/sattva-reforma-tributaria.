/* Conector Sattva–Questor: nenhuma porta é aberta. Ele somente busca tarefas
   autenticadas no Sattva e chama três rotas nWeb de leitura. */
const fs = require('fs');
const path = require('path');
const cfgPath = path.join(__dirname, 'config.json');
if (!fs.existsSync(cfgPath)) throw new Error('Crie config.json a partir de config.example.json.');
// O configurador do Windows pode gravar UTF-8 com BOM. Remove a marca antes
// de interpretar o JSON, sem alterar o conteúdo ou expor credenciais.
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8').replace(/^\uFEFF/, ''));
const permitidas = new Set(['TESTAR_NWEB', 'PARAMETROS_RELATORIO', 'APURACAO_PIS_COFINS', 'IMPORTAR_MOVIMENTACAO']);
const cab = () => ({ 'Content-Type':'application/json', 'X-Connector-Id':cfg.connectorId, 'X-Connector-Secret':cfg.connectorSecret });
const url = (base, rota, params={}) => { const u=new URL(rota, base.replace(/\/$/, '')+'/'); Object.entries(params).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')u.searchParams.set(k,v);}); return u; };
async function requisitar(endpoint, opcoes, limiteMs, descricao) {
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), limiteMs);
  try { return await fetch(endpoint, { ...opcoes, signal: controle.signal }); }
  catch (erro) {
    if (erro?.name === 'AbortError') throw new Error(`${descricao} não respondeu em ${Math.round(limiteMs / 1000)} segundos.`);
    throw erro;
  } finally { clearTimeout(relogio); }
}
async function nweb(rota, params={}, body) {
  const u = url(cfg.nwebUrl, rota, { ...params, TokenApi:cfg.tokenApi || undefined });
  // Relatórios podem demorar na primeira execução, mas não podem manter a
  // solicitação do usuário indefinidamente em "Processando".
  const r = await requisitar(u, { method: body ? 'POST' : 'GET', headers:{'Content-Type':'application/json'}, body:body ? JSON.stringify(body) : undefined }, 120000, 'O nWeb');
  const texto=await r.text(); if(!r.ok) throw new Error(`nWeb ${r.status}: ${texto.slice(0,300)}`); return texto;
}
async function executar(t) {
  if(!permitidas.has(t.tipo)) throw new Error('Tarefa não permitida pelo conector.');
  if(t.tipo==='TESTAR_NWEB') return { versao:await nweb('/TnWebDMDadosGerais/PegarVersaoQuestor'), info:await nweb('/TnInfo/Info') };
  const acao=t.payload?.actionName || 'nFisRRTotalPISCOFINSProd';
  if(t.tipo==='PARAMETROS_RELATORIO') return { parametros:await nweb('/TnWebDMDadosObjetos/Pegar',{_AActionName:acao}) };
  if(t.tipo==='IMPORTAR_MOVIMENTACAO') { const entrada=t.payload?.tipo==='fornecedor'; return { registros:JSON.parse(await nweb(entrada?'/TnWebDMFiscal/PegarLancamentosEntrada':'/TnWebDMFiscal/PegarLancamentosSaida',{codigoempresa:t.payload.codigo_questor,datainicial:t.payload.inicio,datafinal:t.payload.fim})) }; }
  // O roteador nWeb lê os controles do relatório na URL, mas exige POST com
  // corpo JSON para os parâmetros de negócio. GET sem corpo é rejeitado.
  return { actionName:acao, formato:'nrwexTXT', relatorio:await nweb('/TnWebDMRelatorio/Executar',{_AActionName:acao,_ABase64:'False',_ATipoRetorno:'nrwexTXT'}, t.payload?.parametros || {}) };
}
async function ciclo(){
  const r=await requisitar(url(cfg.sattvaUrl,'/api/conector-questor/poll'),{method:'POST',headers:cab()},30000,'O Sattva');
  if(!r.ok) throw new Error(`Sattva ${r.status}: ${(await r.text()).slice(0,200)}`);
  const t=(await r.json()).tarefa; if(!t) return;
  console.log(`${new Date().toISOString()} Processando solicitação ${t.id}: ${t.tipo}.`);
  try {
    const resultado=await executar(t);
    const retorno=await requisitar(url(cfg.sattvaUrl,`/api/conector-questor/tarefas/${t.id}/resultado`),{method:'POST',headers:cab(),body:JSON.stringify({ok:true,resultado})},30000,'O Sattva');
    if(!retorno.ok) throw new Error(`Sattva ${retorno.status}: ${(await retorno.text()).slice(0,200)}`);
    console.log(`${new Date().toISOString()} Solicitação ${t.id} concluída.`);
  } catch(e){
    console.error(`${new Date().toISOString()} Solicitação ${t.id} falhou: ${e.message}`);
    try {
      const retorno=await requisitar(url(cfg.sattvaUrl,`/api/conector-questor/tarefas/${t.id}/resultado`),{method:'POST',headers:cab(),body:JSON.stringify({ok:false,erro:e.message})},30000,'O Sattva');
      if(!retorno.ok) console.error(`${new Date().toISOString()} Não foi possível registrar a falha no Sattva: ${retorno.status} ${await retorno.text()}`);
    } catch(registroErro) { console.error(`${new Date().toISOString()} Não foi possível registrar a falha no Sattva: ${registroErro.message}`); }
  }
}
setInterval(()=>ciclo().catch(e=>console.error(new Date().toISOString(),e.message)), 10000); ciclo().catch(e=>console.error(e.message));
