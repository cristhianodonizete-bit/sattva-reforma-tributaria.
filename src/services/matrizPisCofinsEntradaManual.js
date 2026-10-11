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

module.exports={ normalizar,REGIMES };
