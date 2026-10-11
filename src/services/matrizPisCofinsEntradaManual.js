const REGIMES = ['simples_nacional','lucro_real','lucro_presumido'];
const SEM_INCIDENCIA = new Set(['CUSTAS_TAXAS_DEPOSITOS_JUDICIAIS','IPTU_TAXAS_PUBLICAS']);

function normalizar(regra = {}, chaveItem = '', padroes = {}) {
  const escalaAtual=regra.escala_pis_cofins === 'PONTOS_PERCENTUAIS_V1';
  const origemAtual=regra.origem_referencia_pis_cofins === 'MATRIZ_TRES_REGIMES_V6';
  if (escalaAtual && origemAtual) return { regra, converteu:false };
  const semIncidencia=SEM_INCIDENCIA.has(String(chaveItem));
  const cumulatividadeObrigatoria=regra.cumulatividade_obrigatoria === true || String(chaveItem)==='LICENCA_USO_SISTEMAS_SOFTWARE';
  const regimes={};
  for (const chave of REGIMES) {
    const referencia=chave==='lucro_real' && cumulatividadeObrigatoria ? padroes.lucro_presumido : padroes[chave];
    regimes[chave]=semIncidencia
      ? { pis:0,cofins:0,pis_cofins:0,tratamento_atual:'Operação sem incidência de PIS/Cofins no cadastro técnico.' }
      : { ...referencia };
  }
  return { regra:{ ...regra,cumulatividade_obrigatoria:cumulatividadeObrigatoria,regimes,escala_pis_cofins:'PONTOS_PERCENTUAIS_V1',origem_referencia_pis_cofins:'MATRIZ_TRES_REGIMES_V6' },converteu:true };
}

function fotografiaRefleteReferencia(valorMovimento, referencia = null, detalheInformado = null) {
  if (!referencia) return true;
  let detalhe=detalheInformado;
  try { if (typeof detalhe==='string') detalhe=JSON.parse(detalhe); } catch (_) { return false; }
  const memoria=detalhe?.reconstrucao?.memoriaPisCofins;
  if (!memoria) return false;
  const percentual=referencia.pis_cofins_percentual ?? (
    referencia.pis_percentual !== null && referencia.pis_percentual !== undefined
      && referencia.cofins_percentual !== null && referencia.cofins_percentual !== undefined
      ? Number(referencia.pis_percentual)+Number(referencia.cofins_percentual) : null
  );
  if (percentual===null || !Number.isFinite(Number(percentual))) return false;
  const valorEsperado=Math.round((Number(valorMovimento || 0)*Number(percentual)/100)*100)/100;
  return memoria.carga_atual_pis_cofins_origem==='CATALOGO_ENTRADA_MANUAL'
    && Math.abs(Number(memoria.carga_atual_pis_cofins_percentual)-Number(percentual))<0.000001
    && Math.abs(Number(memoria.carga_atual_pis_cofins_valor)-valorEsperado)<0.011;
}

function referenciaDoRegime(regra = {}, regimeFornecedor = '') {
  const regime=String(regimeFornecedor || '').trim().toLowerCase();
  if (!REGIMES.includes(regime)) return null;
  const faixa=regra?.regimes?.[regime];
  if (!faixa) return null;
  const pis=faixa.pis === null || faixa.pis === undefined ? null : Number(faixa.pis);
  const cofins=faixa.cofins === null || faixa.cofins === undefined ? null : Number(faixa.cofins);
  const conjunto=faixa.pis_cofins === null || faixa.pis_cofins === undefined
    ? (pis !== null && cofins !== null ? pis+cofins : null) : Number(faixa.pis_cofins);
  if (conjunto === null || !Number.isFinite(conjunto)) return null;
  return { regime,escala:'PONTOS_PERCENTUAIS_V1',pis_percentual:pis,cofins_percentual:cofins,
    pis_cofins_percentual:conjunto,tratamento_atual:faixa.tratamento_atual || '' };
}

module.exports={ normalizar,fotografiaRefleteReferencia,referenciaDoRegime,REGIMES };
