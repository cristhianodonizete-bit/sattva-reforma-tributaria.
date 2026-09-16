function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function coletarNomes(valor, encontrados = []) {
  if (Array.isArray(valor)) {
    valor.forEach((item) => coletarNomes(item, encontrados));
    return encontrados;
  }
  if (!valor || typeof valor !== 'object') return encontrados;
  for (const [chave, item] of Object.entries(valor)) {
    const tipoChave = normalizar(chave);
    if (typeof item === 'string' && ['name', 'nome', 'fieldname', 'nomecampo', 'parametro'].includes(tipoChave)) encontrados.push(item);
    coletarNomes(item, encontrados);
  }
  return encontrados;
}

function formatarDataQuestor(valor) {
  const partes = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : valor;
}

function localizarNome(nomes, opcoes) {
  return nomes.find((nome) => opcoes.includes(normalizar(nome))) || null;
}

function parametrosConsultaConfirmados(metadados, consulta = {}) {
  let estrutura;
  try { estrutura = typeof metadados === 'string' ? JSON.parse(metadados) : metadados; }
  catch (_) { throw new Error('O Questor não devolveu os metadados da consulta de locações em um formato válido. Nenhum lançamento foi importado.'); }

  const nomes = [...new Set(coletarNomes(estrutura).filter((nome) => /^[A-Za-z][A-Za-z0-9_]*$/.test(nome)))];
  const campos = [
    { rotulo: 'empresa', opcoes: ['pcodigoempresa', 'codigoempresa', 'pcodempresa', 'codempresa'], valor: consulta.codigo_questor },
    { rotulo: 'data inicial', opcoes: ['pdatainicial', 'datainicial', 'pdataini', 'dataini'], valor: formatarDataQuestor(consulta.inicio) },
    { rotulo: 'data final', opcoes: ['pdatafinal', 'datafinal', 'pdatafim', 'datafim'], valor: formatarDataQuestor(consulta.fim) },
    { rotulo: 'espécie', opcoes: ['ptipoespecie', 'tipoespecie', 'pespecie', 'especie'], valor: consulta.especie },
  ];
  const faltantes = campos.filter((campo) => !localizarNome(nomes, campo.opcoes)).map((campo) => campo.rotulo);
  if (faltantes.length) {
    const disponiveis = nomes.length ? ` Parâmetros devolvidos pelo Questor: ${nomes.join(', ')}.` : '';
    throw new Error(`O Questor não confirmou o parâmetro de ${faltantes.join(', ')} para a consulta de locações. Nenhum lançamento foi importado.${disponiveis}`);
  }
  return Object.fromEntries(campos.map((campo) => [localizarNome(nomes, campo.opcoes), campo.valor]));
}

module.exports = { parametrosConsultaConfirmados };
