/*
 * Auditoria de identidade e governança da matriz fiscal.
 *
 * Referências oficiais respondem se a chave existe e se uma relação NBS–LC116
 * tem fonte rastreável. Elas não definem tratamento tributário; por isso esta
 * auditoria não certifica alíquota, CST, PIS/Cofins ou CBS.
 */
const dbPadrao = require('../db');
const { normalizarNcm, normalizarNbs, normalizarLc116 } = require('./referenciasFiscaisOficiais');

const VAZIO = (valor) => valor == null || String(valor).trim() === '';
const MARCADOR_NBS_INTERNO = '999999999';

function referenciasPorDominio(db) {
  const mapa = new Map();
  for (const linha of db.prepare(`SELECT dominio,codigo FROM referencias_fiscais_oficiais WHERE situacao='VIGENTE'`).all()) {
    if (!mapa.has(linha.dominio)) mapa.set(linha.dominio, new Set());
    mapa.get(linha.dominio).add(linha.codigo);
  }
  return mapa;
}

function auditarChaves(db, tabela, coluna, dominio, normalizar) {
  const oficiais = referenciasPorDominio(db).get(dominio) || new Set();
  const grupos = new Map();
  for (const linha of db.prepare(`SELECT ${coluna} AS codigo FROM ${tabela} WHERE COALESCE(${coluna},'')<>''`).all()) {
    const codigo = normalizar(linha.codigo);
    grupos.set(codigo, (grupos.get(codigo) || 0) + 1);
  }
  const semReferencia = [...grupos.entries()].filter(([codigo]) => !oficiais.has(codigo))
    .map(([codigo, linhas]) => ({ codigo, linhas }));
  return {
    linhas: [...grupos.values()].reduce((soma, quantidade) => soma + quantidade, 0),
    chaves_distintas: grupos.size,
    chaves_com_referencia: grupos.size - semReferencia.length,
    chaves_sem_referencia: semReferencia.length,
    sem_referencia: semReferencia,
  };
}

function paresOficiais(db) {
  return new Set(db.prepare(`SELECT n.codigo AS nbs, l.codigo AS lc116
    FROM referencias_fiscais_relacoes r
    JOIN referencias_fiscais_oficiais n ON n.id=r.origem_id
    JOIN referencias_fiscais_oficiais l ON l.id=r.destino_id
    WHERE r.tipo='NBS_LC116'`).all().map((x) => `${x.nbs}:${x.lc116}`));
}

function auditarParesServicos(db) {
  const oficiais = paresOficiais(db);
  const grupos = new Map();
  for (const linha of db.prepare(`SELECT nbs,lc116 FROM base_servicos
    WHERE COALESCE(nbs,'')<>'' AND COALESCE(lc116,'')<>''`).all()) {
    const nbs = normalizarNbs(linha.nbs);
    const lc116 = normalizarLc116(linha.lc116);
    const chave = `${nbs}:${lc116}`;
    grupos.set(chave, (grupos.get(chave) || 0) + 1);
  }
  const semRelacao = [...grupos.entries()].filter(([chave]) => !oficiais.has(chave))
    .map(([chave, linhas]) => {
      const [nbs, lc116] = chave.split(':');
      return { nbs, lc116, linhas, motivo: nbs === MARCADOR_NBS_INTERNO ? 'NBS_NAO_IDENTIFICADA' : 'RELACAO_OFICIAL_NAO_LOCALIZADA' };
    });
  return {
    pares_distintos: grupos.size,
    pares_com_relacao_oficial: grupos.size - semRelacao.length,
    pares_sem_relacao_oficial: semRelacao.length,
    sem_relacao_oficial: semRelacao,
  };
}

function contagensPorStatus(db, tabela) {
  return Object.fromEntries(db.prepare(`SELECT status,COUNT(*) quantidade FROM ${tabela} GROUP BY status`).all()
    .map((x) => [x.status || 'SEM_STATUS', Number(x.quantidade)]));
}

function auditarFontes(db) {
  const fontes = db.prepare(`SELECT dominio,fonte,versao_fonte,hash_origem,
      MIN(importado_em) primeiro_importado_em,MAX(importado_em) ultimo_importado_em,COUNT(*) referencias
    FROM referencias_fiscais_oficiais
    GROUP BY dominio,fonte,versao_fonte,hash_origem
    ORDER BY dominio,fonte,versao_fonte`).all();
  const incompletas = db.prepare(`SELECT dominio,codigo,fonte,versao_fonte,hash_origem
    FROM referencias_fiscais_oficiais
    WHERE TRIM(fonte)='' OR TRIM(versao_fonte)='' OR TRIM(hash_origem)=''`).all();
  const relacoesSemFonte = db.prepare(`SELECT id FROM referencias_fiscais_relacoes WHERE TRIM(fonte)=''`).all().length;
  return {
    fontes,
    referencias_sem_proveniencia_completa: incompletas.length,
    exemplos_sem_proveniencia: incompletas.slice(0, 20),
    relacoes_sem_fonte: relacoesSemFonte,
    estado: incompletas.length || relacoesSemFonte ? 'ATENCAO' : 'RASTREAVEL',
  };
}

function reconciliarNcmsSemReferencia({ db = dbPadrao } = {}) {
  const oficiais = referenciasPorDominio(db).get('NCM') || new Set();
  const operacionais = db.prepare(`SELECT ncm,MAX(descricao) descricao,MAX(fonte) fonte,MAX(fundamento) fundamento,MAX(regra) regra,COUNT(*) linhas
    FROM base_ncm WHERE COALESCE(ncm,'')<>''
    GROUP BY ncm ORDER BY ncm`).all();
  const movimentos = db.prepare(`SELECT ncm,COUNT(*) operacoes,COALESCE(SUM(valor),0) valor
    FROM movimentos WHERE COALESCE(ncm,'')<>'' GROUP BY ncm`).all();
  const usoPorNcm = new Map(movimentos.map((x) => [normalizarNcm(x.ncm), { operacoes: Number(x.operacoes), valor: Number(x.valor) }]));
  const candidatosPorPrefixo = (codigo) => {
    const prefixo = codigo.slice(0, 6);
    return [...oficiais].filter((x) => x.startsWith(prefixo)).slice(0, 12);
  };
  const itens = operacionais.map((linha) => {
    const codigo = normalizarNcm(linha.ncm);
    if (oficiais.has(codigo)) return null;
    const interno = ['12345678', '99999999'].includes(codigo);
    // Regra operacional pode ser genérica e não demonstra a identidade de um
    // NCM histórico. Para admitir contexto, exigimos descrição ou fonte/fundamento.
    const temEvidenciaCatalogo = [linha.descricao, linha.fonte, linha.fundamento].some((x) => !VAZIO(x));
    const uso = usoPorNcm.get(codigo) || { operacoes: 0, valor: 0 };
    return {
      ncm_operacional: codigo,
      linhas_catalogo: Number(linha.linhas),
      descricao_catalogo: linha.descricao || '',
      fonte_catalogo: linha.fonte || '',
      fundamento_catalogo: linha.fundamento || '',
      operacoes_atuais: uso.operacoes,
      valor_operacoes_atuais: uso.valor,
      classificacao: interno ? 'CODIGO_INTERNO_OU_TESTE' : temEvidenciaCatalogo ? 'SEM_SUCESSOR_OBJETIVO_COM_CONTEXTO' : 'SEM_SUCESSOR_OBJETIVO_SEM_CONTEXTO',
      sucessor_oficial_comprovado: null,
      candidatos_mesmo_prefixo_apenas_pesquisa: interno ? [] : candidatosPorPrefixo(codigo),
      acao_segura: interno
        ? 'Preservar fora de qualquer correspondência automática; confirmar se deve permanecer apenas em dados de teste.'
        : 'Preservar a chave histórica e obter de/para de fonte oficial antes de qualquer substituição.',
    };
  }).filter(Boolean).sort((a, b) => a.ncm_operacional.localeCompare(b.ncm_operacional));
  const resumo = itens.reduce((acumulado, item) => ({
    ...acumulado,
    [item.classificacao]: (acumulado[item.classificacao] || 0) + 1,
  }), {});
  return {
    finalidade: 'Somente leitura. Não substitui NCM, não atualiza catálogo e não recalcula resultados.',
    criterio: 'Candidato de mesmo prefixo é apenas apoio de pesquisa; não é sucessor fiscal nem autorização para alterar a chave.',
    total: itens.length,
    resumo,
    sucessores_oficiais_comprovados: 0,
    itens,
  };
}

function auditar({ db = dbPadrao } = {}) {
  const ncm = auditarChaves(db, 'base_ncm', 'ncm', 'NCM', normalizarNcm);
  const nbs = auditarChaves(db, 'base_servicos', 'nbs', 'NBS', normalizarNbs);
  const lc116 = auditarChaves(db, 'base_servicos', 'lc116', 'LC116', normalizarLc116);
  const paresNbsLc116 = auditarParesServicos(db);
  const fontes = auditarFontes(db);
  return {
    finalidade: 'Somente leitura. Não altera base_ncm, base_servicos, regras, movimentos, resultados nem motor.',
    limite: 'A existência da chave e da relação oficial não comprova o tratamento tributário. CST, PIS/Cofins, CBS e percentuais permanecem sujeitos à matriz operacional homologada.',
    catalogo_operacional: { ncm, nbs, lc116, pares_nbs_lc116: paresNbsLc116 },
    regras_enquadramento_por_status: contagensPorStatus(db, 'regras_enquadramento'),
    matriz_versionada_por_status: contagensPorStatus(db, 'matriz_regras_fiscais_versionada'),
    governanca_fontes: fontes,
    risco: fontes.estado === 'RASTREAVEL' && !ncm.chaves_sem_referencia && !nbs.chaves_sem_referencia && !lc116.chaves_sem_referencia
      ? 'BAIXO' : 'MEDIO',
  };
}

module.exports = { auditar, reconciliarNcmsSemReferencia, MARCADOR_NBS_INTERNO };
