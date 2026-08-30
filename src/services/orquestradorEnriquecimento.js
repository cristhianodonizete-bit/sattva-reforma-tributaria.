const crypto = require('crypto');
const { evidenciaNecessaria } = require('./pendenciasEnriquecimento');
const FONTES = Object.freeze([
  { nome: 'DOCUMENTO_FISCAL_ORIGINAL', tipo: 'DOCUMENTO_FISCAL', automatica: true, chave: 'movimento_id', qualidade: 'ORIGINAL' },
  { nome: 'CADASTRO_FISCAL_VALIDADO', tipo: 'BANCO_INTERNO', automatica: true, chave: 'empresa_id+chave_fiscal', qualidade: 'VALIDADA' },
  { nome: 'CATALOGO_OFICIAL_VERSIONADO', tipo: 'CATÁLOGO_OFICIAL', automatica: true, chave: 'codigo+versao', qualidade: 'OFICIAL' },
  { nome: 'REGRA_VERSIONADA', tipo: 'BANCO_INTERNO', automatica: true, chave: 'regra+versao', qualidade: 'VERSIONADA' },
  { nome: 'HISTORICO_VALIDADO_MESMA_EMPRESA', tipo: 'HISTÓRICO_VALIDADO', automatica: true, chave: 'empresa+chave+condicao+versao', qualidade: 'CONDICIONAL' },
  { nome: 'XML_REIMPORTADO', tipo: 'DOCUMENTO_FISCAL', automatica: true, chave: 'chave_documento+hash', qualidade: 'ORIGINAL' },
  { nome: 'SPED_EMPRESA', tipo: 'INPUT_EMPRESA', automatica: false, chave: 'empresa+periodo+documento', qualidade: 'A_VALIDAR' },
  { nome: 'CADASTRO_MESTRE_EMPRESA', tipo: 'INPUT_EMPRESA', automatica: false, chave: 'empresa+item_servico', qualidade: 'A_VALIDAR' },
]);
const ORDEM = ['DOCUMENTO_FISCAL_ORIGINAL','CADASTRO_FISCAL_VALIDADO','SPED_EMPRESA','CATALOGO_OFICIAL_VERSIONADO','REGRA_VERSIONADA','HISTORICO_VALIDADO_MESMA_EMPRESA','CADASTRO_MESTRE_EMPRESA'];
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function avaliar(pendencia, evidencias = []) {
  const necessarias = evidenciaNecessaria(pendencia.tipo_pendencia, pendencia.tipo);
  const candidatas = evidencias.filter((x) => x?.validada === true && x.versao_fonte && x.hash_evidencia).sort((a,b) => ORDEM.indexOf(a.fonte) - ORDEM.indexOf(b.fonte));
  const valores = new Map();
  for (const e of candidatas) for (const [k,v] of Object.entries(e.dados || {})) { if (v != null && v !== '') { if (valores.has(k) && valores.get(k).valor !== v) return { status: 'REQUER_VALIDACAO', motivo: 'EVIDENCIA_CONFLITANTE', memoria_completa: false }; valores.set(k,{valor:v}); } }
  const atendidas = necessarias.filter((k) => valores.has(k)); const base={modo:'SHADOW',hash_entrada:hash({pendencia,evidencias:candidatas}),fontes_consultadas:candidatas.map(x=>x.fonte),atendidas,necessarias};
  if (atendidas.length !== necessarias.length || !candidatas.length) return {...base,status:atendidas.length?'PARCIALMENTE_ENRIQUECIDA':'CONTINUA_INDETERMINADA',memoria_completa:false};
  return {...base,status:'RESOLVIDA_AUTOMATICAMENTE',memoria_completa:true,fonte:candidatas[0].fonte,versao_fonte:candidatas[0].versao_fonte,dados:Object.fromEntries([...valores].map(([k,x])=>[k,x.valor]))};
}
module.exports = { FONTES, ORDEM, avaliar };
