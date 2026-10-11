'use strict';

function textoSocietario(valor) {
  return String(valor || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
}

function ehSociedadeAnonima(nome) {
  const texto = textoSocietario(nome);
  return /(?:^|\s)(?:SA|S A|SOCIEDADE ANONIMA)(?:\s|$)/.test(texto);
}

// Sociedade por ações não pode optar pelo Simples Nacional. A forma
// societária elimina o Simples, mas não demonstra se a tributação é por
// Lucro Real ou Presumido; por isso o resultado correto é regime regular.
function resolver(regime, nome) {
  const informado = String(regime || '').trim().toLowerCase() || null;
  if (ehSociedadeAnonima(nome) && ['simples_nacional', 'mei'].includes(informado)) return 'regime_regular';
  return informado;
}

module.exports = { ehSociedadeAnonima, resolver };
