/**
 * Resolvedor de perfil da Fase 2A.
 *
 * Não consulta APIs nem altera resultado tributário. Consolida apenas fatos já
 * confirmados no documento, no parceiro e no cadastro central compartilhado.
 * Ausência de evidência permanece explicitamente indeterminada.
 */
const db = require('../db');
const supabase = require('./supabase');
const texto = (v) => String(v || '').trim();

function resolver(contexto = {}) {
  const cnpj = String(contexto.cnpj || '').replace(/\D/g, '');
  const parceiro = contexto.parceiro || (contexto.empresa_id && cnpj
    ? db.prepare('SELECT * FROM parceiros WHERE empresa_id=? AND cnpj=? ORDER BY id LIMIT 1').get(contexto.empresa_id, cnpj)
    : null) || {};
  const central = contexto.cadastro_central || (cnpj.length === 14
    ? db.prepare('SELECT * FROM cadastro_parceiros_mestre WHERE cnpj=?').get(cnpj)
      || db.prepare('SELECT * FROM cnpj_cache WHERE cnpj=?').get(cnpj) || {}
    : {});
  const regime = texto(contexto.regime || parceiro.regime_resolvido || parceiro.regime || central.regime_atual || central.regime_derivado || 'indeterminado');
  const perfil = texto(contexto.perfil_economico || parceiro.perfil_economico);
  const governo = perfil === 'governo' || regime === 'orgao_publico' || Boolean(central.governo);
  const mei = regime === 'mei' || Boolean(central.mei ?? central.optante_mei);
  const simples = !mei && (regime === 'simples_nacional' || Boolean(central.simples ?? central.optante_simples));
  const tipo = cnpj.length === 11 ? 'PESSOA_FISICA'
    : governo ? 'GOVERNO'
      : mei ? 'MEI'
        : simples ? 'SIMPLES'
          : ['lucro_real', 'lucro_presumido', 'regime_regular'].includes(regime) ? 'REGULAR' : 'INDETERMINADO';
  const evidencias = [];
  if (contexto.regime) evidencias.push({ origem: 'DOCUMENTO', campo: 'regime', valor: contexto.regime });
  if (parceiro.regime_resolvido && parceiro.regime_resolvido !== 'indeterminado') evidencias.push({ origem: parceiro.origem || 'CADASTRO_MESTRE', campo: 'regime_resolvido', valor: parceiro.regime_resolvido });
  if (central.regime_atual || central.regime_derivado) evidencias.push({ origem: central.origem || central.fonte || 'CADASTRO_MESTRE', campo: 'regime_atual', valor: central.regime_atual || central.regime_derivado });
  if (governo) evidencias.push({ origem: parceiro.perfil_origem || 'CADASTRO_MESTRE', campo: 'perfil_economico', valor: 'governo' });
  return {
    perfil: tipo, regime_atual: regime || 'indeterminado', regime_cbs: tipo === 'SIMPLES' ? 'SIMPLES_DAS' : tipo === 'MEI' ? 'MEI' : tipo === 'REGULAR' ? 'REGULAR' : 'INDETERMINADO',
    governo, simples, mei, produtor_rural: false, cooperativa: false,
    status: tipo === 'INDETERMINADO' ? 'INDETERMINADO' : 'DETERMINADO',
    origem: evidencias[0]?.origem || 'SEM_EVIDENCIA', evidencias,
    pendencia: tipo === 'INDETERMINADO' ? 'Regime ou perfil cadastral sem evidência suficiente.' : null,
  };
}

async function resolverCompartilhado(contexto = {}) {
  if (!supabase.configurado()) throw new Error('Supabase não configurado no .env.');
  const cnpj = String(contexto.cnpj || '').replace(/\D/g, '');
  let central = null;
  if (cnpj.length === 14) {
    const { data, error } = await supabase.admin().from('cadastro_parceiros_mestre').select('*').eq('cnpj', cnpj).limit(1);
    if (error) throw new Error(`cadastro_parceiros_mestre: ${error.message}`);
    central = data?.[0] || null;
  }
  return resolver({ ...contexto, cadastro_central: central || {} });
}

module.exports = { resolver, resolverCompartilhado };
