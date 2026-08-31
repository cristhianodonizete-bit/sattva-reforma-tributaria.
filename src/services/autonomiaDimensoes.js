const crypto=require('crypto');
const ok=(v)=>v===true||v===1||v==='1';
function avaliarDimensoes(linha,{nbsEquivalentes=false}={}){
 const saida=String(linha.sentido||'').toLowerCase()==='saida';
 const base=Number.isFinite(Number(linha.base_economica))&&Number(linha.base_economica)>=0;
 const cbs=Number.isFinite(Number(linha.cbs));
 const equivalencia=linha.classificacao?.equivalenciaFiscal||linha.equivalenciaFiscal||null;
 const equivalentes=nbsEquivalentes||equivalencia?.status==='EQUIVALENTE_FISCALMENTE';
 const classificacao=Boolean(linha.cclasstrib)||equivalentes;
 const credito=String(linha.status_credito_determinacao||linha.status_credito||'').toUpperCase();
 const creditoPis=linha.credito_pis_cofins_adquirente||linha.creditoPisCofinsAdquirente||null;
 const creditoPisDeterminado=creditoPis&&String(creditoPis.status||'').toUpperCase()==='DETERMINADO';
 const creditoEntrada=!saida&&(creditoPisDeterminado||['DETERMINADO','DETERMINADO_POR_PREMISSA','SEM_DIREITO'].includes(credito));
 const creditoCliente=saida&&['DETERMINADO','SEM_DIREITO','NAO_APLICAVEL'].includes(credito);
 const propria=saida&&base&&cbs&&classificacao;
 const classificatoria=classificacao?(equivalentes&&!linha.cclasstrib?'PARCIAL':'DETERMINADA'):'INDETERMINADA';
 const completo=saida?propria&&creditoCliente:base&&classificacao&&creditoEntrada;
 const memoria={
  calculo_cbs_propria:{status:propria?'DETERMINADA':'INCOMPLETA',motivo:propria?'Base, débito e tratamento CBS determinados.':'Falta base, débito ou tratamento CBS.',evidencias:equivalentes?['MULTIPLAS_NBS_EQUIVALENTES']:[],regras:['AUTONOMIA_DIMENSOES_V1']},
  credito_cliente:{status:saida?(creditoCliente?'DETERMINADO':'INDETERMINADO'):'NAO_APLICAVEL',motivo:saida?'Crédito do adquirente não altera o débito CBS próprio.':'Operação de entrada.',evidencias:[],regras:['CREDITO_CLIENTE_NAO_BLOQUEIA_DEBITO_PROPRIO_V1']},
  credito_entrada:{status:saida?'NAO_APLICAVEL':(creditoEntrada?'DETERMINADO':'INDETERMINADO'),motivo:saida?'Operação de saída.':creditoPisDeterminado?(creditoPis.motivo||'Crédito PIS/Cofins da adquirente decidido por regra.'): 'Crédito de entrada sem decisão suficiente.',evidencias:creditoPis?[creditoPis.origem]:[],regras:creditoPis?[creditoPis.regra_versionamento]:[]},
  classificatoria:{status:classificatoria,motivo:equivalentes?'Múltiplas classificações equivalentes; nenhum código foi escolhido.':'Classificação persistida ou indeterminada.',evidencias:equivalencia?.assinaturas||[],regras:[equivalencia?.regra||'MULTIPLAS_NBS_EQUIVALENTES_V1'],catalogo_versoes:equivalencia?.catalogo_versoes||[],origem:equivalencia?.origem||null,hash_decisao:equivalencia?.hash_decisao||null}
 };
 memoria.hash_decisao=crypto.createHash('sha256').update(JSON.stringify(memoria)).digest('hex');
 return {autonomia_calculo_cbs_propria:propria,autonomia_credito_entrada:saida?null:creditoEntrada,autonomia_credito_cliente:saida?creditoCliente:null,autonomia_classificatoria:classificatoria,autonomia_diagnostico_completo:completo,memoria};
}
module.exports={avaliarDimensoes};
