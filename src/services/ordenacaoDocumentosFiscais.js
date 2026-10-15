const CAMPOS = new Set(['competencia', 'documento', 'modelo', 'itens', 'valor', 'origem']);

function campoOrdenacao(filtros = {}) {
  const campo = String(filtros.ordenar_por || '').trim();
  return CAMPOS.has(campo) ? campo : 'competencia';
}

function direcaoOrdenacao(filtros = {}) {
  return String(filtros.ordem || '').trim().toUpperCase() === 'ASC' ? 1 : -1;
}

function numero(valor) {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
}

function texto(valor) {
  return String(valor || '');
}

// A fonte compartilhada já entrega a página ordenada. Quando a tela inclui
// lançamentos Questor pendentes da base local, esta comparação recompõe a
// mesma ordem solicitada pelo usuário sem alterar qualquer dado fiscal.
function compararDocumentos(filtros = {}) {
  const campo = campoOrdenacao(filtros);
  const direcao = direcaoOrdenacao(filtros);
  return (a, b) => {
    let comparacao = 0;
    if (campo === 'valor' || campo === 'itens') {
      const chave = campo === 'valor' ? 'valor' : 'itens';
      comparacao = numero(a?.[chave]) - numero(b?.[chave]);
    } else {
      const valores = {
        competencia: (x) => x?.data_emissao || x?.competencia || x?.criado_em,
        documento: (x) => x?.documento,
        modelo: (x) => x?.modelo_documento_fiscal,
        origem: (x) => x?.origem,
      };
      comparacao = texto(valores[campo](a)).localeCompare(texto(valores[campo](b)), 'pt-BR');
    }
    if (comparacao) return comparacao * direcao;
    const porItem = numero(a?.item_id) - numero(b?.item_id);
    if (porItem) return porItem * direcao;
    return texto(a?.referencia).localeCompare(texto(b?.referencia), 'pt-BR') * direcao;
  };
}

function ordenarDocumentos(documentos, filtros = {}) {
  return [...(documentos || [])].sort(compararDocumentos(filtros));
}

function referenciaDocumento(documento = {}) {
  if (documento.referencia) return `referencia:${documento.referencia}`;
  if (documento.chave) return `chave:${documento.chave}`;
  if (documento.item_id !== undefined && documento.item_id !== null) return `item:${documento.item_id}`;
  return `documento:${texto(documento.documento)}|${texto(documento.data_emissao || documento.competencia)}|${numero(documento.valor)}`;
}

function numeroPagina(valor) {
  return Math.max(1, Number(valor) || 1);
}

function numeroLimite(valor) {
  return Math.max(1, Number(valor) || 100);
}

// A paginação precisa ocorrer depois da mesclagem. Caso contrário, um pendente
// local seria anexado a toda página remota e apareceria repetidamente.
function mesclarEPaginarDocumentos(remotos, pendentes, filtros = {}, opcoes = {}) {
  const porReferencia = new Map();
  for (const documento of [...(remotos || []), ...(pendentes || [])]) {
    const referencia = referenciaDocumento(documento);
    if (!porReferencia.has(referencia)) porReferencia.set(referencia, documento);
  }
  const conjunto = ordenarDocumentos([...porReferencia.values()], filtros);
  if (opcoes.completo) {
    return { documentos:conjunto, total:conjunto.length,
      paginacao:{ pagina:1, limite:null, totalPaginas:1, temAnterior:false, temProxima:false } };
  }
  const pagina = numeroPagina(opcoes.pagina);
  const limite = numeroLimite(opcoes.limite);
  const inicio = (pagina - 1) * limite;
  return { documentos:conjunto.slice(inicio, inicio + limite), total:conjunto.length,
    paginacao:{ pagina, limite, totalPaginas:Math.max(1, Math.ceil(conjunto.length / limite)), temAnterior:pagina > 1, temProxima:inicio + limite < conjunto.length } };
}

module.exports = { ordenarDocumentos, compararDocumentos, mesclarEPaginarDocumentos };
