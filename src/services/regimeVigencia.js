'use strict';

// Etapa 1: resolução pura e auditável. Ainda não altera parceiros, movimentos,
// projeções nem fotografias; a integração operacional será feita somente após
// validação da regra de vigência.
const digitos=(v)=>String(v || '').replace(/\D/g,'');
const data=(v)=>String(v || '').slice(0,10);
const normalizar=(v)=>String(v || '').trim().toLowerCase();

function registroValido(registro, cnpj, referencia) {
  const inicio=data(registro.vigencia_inicio || '0000-01-01');
  const fim=data(registro.vigencia_fim || '9999-12-31');
  return digitos(registro.cnpj) === digitos(cnpj)
    && normalizar(registro.regime)
    && inicio <= referencia && referencia <= fim;
}

function resolverNaData(registros, cnpj, dataDocumento, fallback = null) {
  const referencia=data(dataDocumento);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referencia)) throw new Error('Data do documento inválida para resolver o regime.');
  const candidatos=(registros || []).filter((r)=>registroValido(r,cnpj,referencia)).sort((a,b)=>
    data(b.vigencia_inicio).localeCompare(data(a.vigencia_inicio))
    || Number(b.versao || 0)-Number(a.versao || 0)
    || String(b.registrado_em || '').localeCompare(String(a.registrado_em || '')));
  if (!candidatos.length) return fallback ? { ...fallback, origem_resolucao:'FALLBACK_SEM_HISTORICO' } : null;
  const escolhido=candidatos[0];
  return {
    cnpj:digitos(cnpj), regime:normalizar(escolhido.regime), versao:escolhido.versao === null || escolhido.versao === undefined || escolhido.versao === '' ? null : Number(escolhido.versao),
    vigencia_inicio:data(escolhido.vigencia_inicio), vigencia_fim:escolhido.vigencia_fim ? data(escolhido.vigencia_fim) : null,
    fonte:escolhido.fonte || null, origem_resolucao:'HISTORICO_VIGENTE'
  };
}

function avaliarFotografia({ registros, cnpj, dataDocumento, regimeFotografia, versaoFotografia }) {
  const vigente=resolverNaData(registros,cnpj,dataDocumento);
  if (!vigente) return { status:'SEM_HISTORICO', regime_vigente:null, regime_fotografia:normalizar(regimeFotografia), reprocessar:false };
  const igualRegime=vigente.regime===normalizar(regimeFotografia);
  // Cadastro compartilhado não publica uma versão de fotografia. Nesse caso a
  // comparação segura é pelo regime, sem inventar uma versão divergente.
  const igualVersao=vigente.versao === null || Number(versaoFotografia || 0)===vigente.versao;
  return { status:igualRegime && igualVersao ? 'ATUAL' : 'DIVERGENTE', regime_vigente:vigente.regime,
    versao_vigente:vigente.versao, regime_fotografia:normalizar(regimeFotografia), versao_fotografia:Number(versaoFotografia || 0),
    reprocessar:!(igualRegime && igualVersao) };
}

module.exports={ resolverNaData, avaliarFotografia };
