/**
 * Leitura semântica de qualidade da fotografia do motor.
 *
 * Não calcula e não altera resultados tributários. A natureza SIMULADO da
 * projeção CBS é deliberadamente mantida fora da cobertura de evidência: uma
 * projeção futura pode ser simulada e, ainda assim, ter classificação, base e
 * crédito determinados.
 */

const STATUS = Object.freeze({
  DETERMINADO: 'DETERMINADO',
  PREMISSA: 'SIMULADO_POR_PREMISSA',
  VALIDACAO: 'SUJEITO_VALIDACAO',
  INDETERMINADO: 'INDETERMINADO',
  NA: 'NAO_APLICAVEL',
});
const CAMPOS = ['classificacao', 'reconstrucao', 'tratamento', 'credito', 'cbs', 'ibs', 'resultado'];
const numero = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const valorLinha = (linha) => numero(linha.preco_atual);
const arred = (v) => Math.round(numero(v) * 100) / 100;
const resolvido = (status) => [STATUS.DETERMINADO, STATUS.PREMISSA, STATUS.NA].includes(status);

// A classificação pode permanecer PARCIAL sem escolha arbitrária de NBS/NCM.
// Quando o motor já demonstrou que todos os candidatos válidos possuem a mesma
// assinatura tributária, ela é suficiente para cobertura: não existe ação
// humana fiscal a executar. A checagem exige a memória explícita da
// equivalência e do impacto não material; um PARCIAL genérico continua aberto.
function classificacaoEquivalenteNaoMaterial(linha) {
  const equivalencia = linha.detalhe?.classificacao?.equivalenciaFiscal;
  return equivalencia?.status === 'EQUIVALENTE_FISCALMENTE'
    && equivalencia?.impacto_tributario_material === false;
}
function statusClassificacao(linha) {
  if (linha.status_classificacao === 'CLASSIFICADO') return STATUS.DETERMINADO;
  if (linha.status_classificacao === 'PARCIAL' && classificacaoEquivalenteNaoMaterial(linha)) return STATUS.DETERMINADO;
  if (linha.status_classificacao === 'REQUER_VALIDACAO') return STATUS.VALIDACAO;
  return STATUS.INDETERMINADO;
}
function statusReconstrucao(linha) {
  const status = linha.detalhe?.reconstrucao?.status;
  if (status === 'reconstruida') return STATUS.DETERMINADO;
  if (status === 'estimada') return STATUS.PREMISSA;
  if (status === 'parcialmente_determinada') return STATUS.VALIDACAO;
  return STATUS.INDETERMINADO;
}
function statusTratamento(linha, classificacao) {
  // A equivalência material já contém a assinatura tributária comparada. Não
  // há necessidade de escolher um código histórico para reconhecer o
  // tratamento como coberto.
  if (classificacaoEquivalenteNaoMaterial(linha)) return STATUS.DETERMINADO;
  if (classificacao !== STATUS.DETERMINADO) return classificacao === STATUS.VALIDACAO ? STATUS.VALIDACAO : STATUS.INDETERMINADO;
  return linha.tratamento ? STATUS.DETERMINADO : STATUS.INDETERMINADO;
}
function statusCredito(linha) {
  if (linha.sentido !== 'entrada') return STATUS.NA;
  const status = linha.status_credito_determinacao || linha.status_credito;
  if (['DETERMINADO', 'SEM_DIREITO'].includes(status)) return STATUS.DETERMINADO;
  if (status === 'DETERMINADO_POR_PREMISSA') return STATUS.PREMISSA;
  if (['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(status)) return STATUS.VALIDACAO;
  return STATUS.INDETERMINADO;
}
function statusCbs(linha, classificacao, tratamento) {
  if (linha.sentido !== 'saida') return STATUS.NA;
  if (classificacao === STATUS.INDETERMINADO || tratamento === STATUS.INDETERMINADO) return STATUS.INDETERMINADO;
  if (classificacao === STATUS.VALIDACAO || tratamento === STATUS.VALIDACAO) return STATUS.VALIDACAO;
  return Number.isFinite(Number(linha.cbs)) ? STATUS.DETERMINADO : STATUS.INDETERMINADO;
}
function statusIbs() { return STATUS.NA; } // IBS deliberadamente fora desta visão CBS.
function statusResultado(dimensoes, sentido) {
  const relevantes = ['classificacao', 'reconstrucao', 'tratamento'];
  if (sentido === 'entrada') relevantes.push('credito');
  const valores = relevantes.map((campo) => dimensoes[campo]);
  if (valores.includes(STATUS.INDETERMINADO)) return STATUS.INDETERMINADO;
  if (valores.includes(STATUS.VALIDACAO)) return STATUS.VALIDACAO;
  if (valores.includes(STATUS.PREMISSA)) return STATUS.PREMISSA;
  return STATUS.DETERMINADO;
}

function avaliarLinha(linha) {
  const classificacao = statusClassificacao(linha);
  const reconstrucao = statusReconstrucao(linha);
  const tratamento = statusTratamento(linha, classificacao);
  const credito = statusCredito(linha);
  const dimensoes = { classificacao, reconstrucao, tratamento, credito };
  dimensoes.cbs = statusCbs(linha, classificacao, tratamento);
  dimensoes.ibs = statusIbs(linha);
  dimensoes.resultado = statusResultado(dimensoes, linha.sentido);
  return {
    movimento_id: linha.movimento_id,
    sentido: linha.sentido,
    valor: valorLinha(linha),
    natureza_projecao: String(linha.natureza || linha.detalhe?.natureza || 'SIMULADO').toUpperCase(),
    dimensoes,
    // Contexto somente de leitura para que a camada de cobertura explique a
    // pendência ao usuário. Não participa de qualquer decisão do motor.
    linha: {
      documento: linha.documento || linha.chave || null,
      chave: linha.chave || null,
      descricao: linha.descricao || null,
      ncm: linha.ncm || null,
      nbs: linha.nbs || null,
      cnpj: linha.inscr_federal || null,
      parceiro: linha.parceiro_cadastrado || linha.nome || null,
      competencia: linha.competencia || null,
      regime_emitente: linha.regime_cbs_emitente || null,
      regime_adquirente: linha.regime_cbs_adquirente || null,
      status_credito: linha.status_credito_determinacao || linha.status_credito || null,
    },
  };
}

function matriz(avaliadas, campo, filtro = () => true) {
  const saidas = {};
  for (const status of Object.values(STATUS)) saidas[status] = { quantidade: 0, valor: 0 };
  for (const item of avaliadas.filter(filtro)) {
    const status = item.dimensoes[campo];
    if (!saidas[status]) saidas[status] = { quantidade: 0, valor: 0 };
    saidas[status].quantidade += 1; saidas[status].valor += item.valor;
  }
  for (const x of Object.values(saidas)) x.valor = arred(x.valor);
  return saidas;
}
function cobertura(m, incluirNA = false) {
  const lista = Object.entries(m).filter(([status]) => incluirNA || status !== STATUS.NA);
  const denominadorQtd = lista.reduce((s, [, x]) => s + x.quantidade, 0);
  const denominadorValor = lista.reduce((s, [, x]) => s + x.valor, 0);
  const ok = lista.filter(([s]) => resolvido(s)).reduce((s, [, x]) => ({ quantidade: s.quantidade + x.quantidade, valor: s.valor + x.valor }), { quantidade: 0, valor: 0 });
  return { quantidade: denominadorQtd ? ok.quantidade / denominadorQtd : null, valor: denominadorValor ? ok.valor / denominadorValor : null, cobertas: ok, total: { quantidade: denominadorQtd, valor: arred(denominadorValor) } };
}
function pendencias(avaliadas) {
  const mapa = new Map();
  for (const item of avaliadas) {
    for (const [dimensao, status] of Object.entries(item.dimensoes)) {
      if (resolvido(status)) continue;
      const codigo = `${dimensao}:${status}`;
      const atual = mapa.get(codigo) || { codigo, dimensao, status, ocorrencias: 0, operacoes: new Set(), valor: 0 };
      atual.ocorrencias += 1; atual.operacoes.add(item.movimento_id); atual.valor += item.valor; mapa.set(codigo, atual);
    }
  }
  return [...mapa.values()].map((x) => ({ ...x, operacoes: x.operacoes.size, valor: arred(x.valor), acao: acaoPara(x) })).sort((a, b) => b.valor - a.valor);
}
function acaoPara(x) {
  if (x.dimensao === 'reconstrucao' && x.status === STATUS.INDETERMINADO) return 'CADASTRO_OU_EVIDENCIA_DOCUMENTAL';
  if (x.dimensao === 'reconstrucao') return 'REVISAR_EVIDENCIA_E_REGRA';
  if (x.dimensao === 'credito') return 'VALIDAR_ELEGIBILIDADE_DO_CREDITO';
  if (x.dimensao === 'classificacao') return 'CLASSIFICAR_COM_EVIDENCIA_FISCAL';
  return 'VALIDAR_TRATAMENTO_FISCAL';
}

function consolidar(linhas) {
  const avaliadas = linhas.map(avaliarLinha);
  const porSentido = {};
  for (const sentido of ['saida', 'entrada']) {
    const filtro = (x) => x.sentido === sentido;
    porSentido[sentido] = { quantidade: avaliadas.filter(filtro).length, valor: arred(avaliadas.filter(filtro).reduce((s, x) => s + x.valor, 0)), matrizes: Object.fromEntries(CAMPOS.map((campo) => [campo, matriz(avaliadas, campo, filtro)])) };
  }
  const matrizes = Object.fromEntries(CAMPOS.map((campo) => [campo, matriz(avaliadas, campo)]));
  const pendentes = avaliadas.filter((x) => !resolvido(x.dimensoes.resultado));
  const coberturaTecnica = cobertura(matrizes.resultado);
  return {
    total: { quantidade: avaliadas.length, valor: arred(avaliadas.reduce((s, x) => s + x.valor, 0)) },
    por_sentido: porSentido, matrizes,
    natureza_projecao: Object.fromEntries(Object.entries(avaliadas.reduce((m, x) => { m[x.natureza_projecao] = m[x.natureza_projecao] || { quantidade: 0, valor: 0 }; m[x.natureza_projecao].quantidade += 1; m[x.natureza_projecao].valor += x.valor; return m; }, {})).map(([k, v]) => [k, { ...v, valor: arred(v.valor) }])),
    cobertura: { tecnica_resultado: coberturaTecnica, classificacao: cobertura(matrizes.classificacao), reconstrucao: cobertura(matrizes.reconstrucao), credito_entradas: cobertura(porSentido.entrada.matrizes.credito), automacao: coberturaTecnica },
    pendencias: { operacoes_unicas: pendentes.length, valor: arred(pendentes.reduce((s, x) => s + x.valor, 0)), ocorrencias: pendencias(avaliadas) },
    linhas: avaliadas,
  };
}
function obter(empresaId, opcoes = {}) {
  // Mantém os avaliadores puros testáveis sem abrir SQLite; só a consulta da
  // fotografia ativa precisa da camada oficial.
  const oficial = require('./consolidacaoOficial');
  const base = oficial.linhas(empresaId, opcoes);
  return { execucao: base.execucao, ...consolidar(base.linhas) };
}

module.exports = { STATUS, avaliarLinha, consolidar, obter };
