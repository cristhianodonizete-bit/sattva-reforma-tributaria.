/*
 * Contrato de percentuais fiscais: valores persistidos em pontos percentuais.
 * Ex.: 0.065 representa 0,065%; 9.25 representa 9,25%.
 *
 * Não há inferência de escala por magnitude. A conversão de dados legados é
 * feita somente pela migration versionada, antes de esta camada ser ativada.
 */
function numeroPontosPercentuais(valor, { nulo = null } = {}) {
  if (valor === null || valor === undefined || valor === '') return nulo;
  let texto = String(valor).trim().replace(/%/g, '').replace(/\s/g, '');
  if (!texto) return nulo;
  if (texto.includes(',') && texto.includes('.')) {
    if (texto.lastIndexOf(',') > texto.lastIndexOf('.')) texto = texto.replace(/\./g, '').replace(',', '.');
    else texto = texto.replace(/,/g, '');
  } else if (texto.includes(',')) texto = texto.replace(',', '.');
  const numero = Number(texto);
  return Number.isFinite(numero) ? numero : nulo;
}

function aplicarPercentual(base, percentual) {
  const valor = Number(base);
  const pontos = numeroPontosPercentuais(percentual, { nulo: null });
  if (!Number.isFinite(valor) || pontos === null) return null;
  return valor * (pontos / 100);
}

function percentualDeValor(valor, base) {
  const v = Number(valor), b = Number(base);
  return Number.isFinite(v) && Number.isFinite(b) && b !== 0 ? (v / b) * 100 : 0;
}

function arredondarMoeda(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

module.exports = { numeroPontosPercentuais, aplicarPercentual, percentualDeValor, arredondarMoeda };
