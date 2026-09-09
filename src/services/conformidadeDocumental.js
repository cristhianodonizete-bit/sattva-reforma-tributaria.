/**
 * Conformidade documental: leitura da qualidade de emissão dos documentos.
 *
 * Não chama o motor, não reclassifica e não grava nos movimentos. Apenas
 * compara LC 116/NBS já importados com o catálogo versionado para entregar
 * evidência e orientação operacional ao usuário.
 */
const db = require('../db');
const bases = require('./basesReforma');
const { correlacoesIndicativas } = require('./mapaOperacional');
const NBS_INTERNA_SEM_CORRESPONDENCIA = '999999999';

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;

function candidato(linha) {
  return {
    lc116: linha.lc116 || null,
    nbs: linha.nbs || null,
    descricao_lc116: linha.descricao_item || null,
    descricao_nbs: linha.descricao_nbs || null,
    // O catálogo de serviços atualmente não possui CST próprio. Não há
    // inferência por memória: a ausência é declarada para revisão do catálogo.
    cst: linha.cst || null,
    cclasstrib: linha.cclasstrib || null,
    tratamento: linha.nome_cclasstrib || linha.reducao || 'Não informado',
    reducao: linha.reducao || 'integral',
    regra: linha.regra_precedencia || linha.condicao_cumulatividade || null,
    fundamento: linha.fundamento_cumulatividade || null,
  };
}

function regraDeUso(x) {
  const partes = [
    x.lc116 && `Use quando o serviço corresponder ao item LC 116 ${x.lc116}.`,
    x.nbs && `Confirme o NBS ${x.nbs} pela descrição efetiva do serviço.`,
    x.regra && x.regra,
    x.fundamento && `Fundamento registrado: ${x.fundamento}.`,
  ].filter(Boolean);
  return partes.join(' ');
}

function avaliar(movimento) {
  const lc116 = bases.normLc116(movimento.lc116);
  const nbs = bases.normNbs(movimento.nbs);
  const marcadorInternoNbs = nbs === NBS_INTERNA_SEM_CORRESPONDENCIA;
  if (!lc116 && !nbs) return null;
  const consulta = bases.consultarServico(lc116, marcadorInternoNbs ? '' : nbs);
  // O catálogo pode conter linhas técnicas repetidas pela origem da carga.
  // Na conformidade, a alternativa é a combinação fiscal distinta; não faz
  // sentido repetir a mesma opção para quem revisa o documento.
  const vistos = new Set();
  const candidatos = (consulta.candidatos || []).map(candidato).filter((x) => {
    const chave = [x.lc116, x.nbs, x.cst, x.cclasstrib, x.reducao].map((v) => String(v || '')).join('|');
    if (vistos.has(chave)) return false;
    vistos.add(chave); return true;
  }).map((x) => ({ ...x, regra_uso: regraDeUso(x) }));

  if (lc116 && !nbs) return {
    tipo: 'LC116_SEM_NBS', severidade: 'ATENCAO',
    titulo: 'Omissão de NBS no documento fiscal',
    evidencia: `O lançamento informa LC 116 ${lc116}, mas não informa NBS.`,
    solucao: candidatos.length
      ? 'Confirme a descrição efetiva do serviço e informe o NBS compatível dentre as opções apresentadas.'
      : 'Complete o NBS e revise a correspondência no catálogo fiscal.',
    candidatos,
  };
  if (!lc116 && nbs) return {
    tipo: 'NBS_SEM_LC116', severidade: 'ATENCAO',
    titulo: 'Omissão de LC 116 no documento fiscal',
    evidencia: `O lançamento informa NBS ${nbs}, mas não informa o item LC 116.`,
    solucao: candidatos.length
      ? 'Confirme o item da lista de serviços aplicável dentre as opções apresentadas.'
      : 'Complete o item LC 116 e revise a correspondência no catálogo fiscal.',
    candidatos,
  };
  if (marcadorInternoNbs) return {
    tipo: 'NBS_NAO_IDENTIFICADA', severidade: 'ATENCAO',
    titulo: 'NBS não identificada no documento fiscal',
    evidencia: `O lançamento informa LC 116 ${lc116}, mas contém apenas um marcador interno no campo NBS; não há NBS oficial identificada.`,
    solucao: candidatos.length
      ? 'Confirme a descrição efetiva do serviço e informe uma NBS oficial compatível dentre as opções apresentadas.'
      : 'Complete a NBS oficial e revise a correspondência no catálogo fiscal.',
    candidatos,
  };
  if (!consulta.encontrado) return {
    tipo: 'LC116_NBS_SEM_CORRESPONDENCIA', severidade: 'ATENCAO',
    titulo: 'LC 116 e NBS sem correspondência no catálogo',
    evidencia: `A combinação LC 116 ${lc116} + NBS ${nbs} não foi localizada no catálogo fiscal.`,
    solucao: 'Confira os dois códigos no documento e, se estiverem corretos, solicite a inclusão da correlação no catálogo fiscal.',
    candidatos: [],
  };
  if (consulta.nivel !== 'exato') return {
    tipo: 'LC116_NBS_INCOMPATIVEIS', severidade: 'ATENCAO',
    titulo: 'Divergência documental entre LC 116 e NBS',
    evidencia: `A combinação LC 116 ${lc116} + NBS ${nbs} não existe como chave composta no catálogo. As referências foram encontradas separadamente, mas não como o mesmo serviço. Isso, isoladamente, não comprova alteração de CBS, crédito ou PIS/Cofins.`,
    solucao: 'Confirme a descrição do serviço e a combinação documental aplicável. Trate como prioridade alta somente se a análise econômica apontar impacto tributário material.',
    candidatos,
  };
  return null;
}

function dadosCnae(empresa) {
  let secundarios = [];
  try { secundarios = JSON.parse(empresa.cnaes_secundarios || '[]'); } catch (_) { secundarios = []; }
  return [{ codigo: empresa.cnae || '', descricao: empresa.atividade || '', tipo: 'Principal' }, ...secundarios.map((x) => ({
    codigo: x.codigo || x.cnae || '', descricao: x.descricao || x.texto || '', tipo: 'Secundário',
  }))].filter((x) => x.codigo || x.descricao);
}

function projetarOperacoes(empresaId, movimentos) {
  const empresa = db.prepare('SELECT id,cnae,atividade,cnaes_secundarios FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa) return { cnaes: [], itens: [], aviso: '' };
  const documentados = new Set(movimentos.map((m) => `${bases.normLc116(m.lc116)}|${bases.normNbs(m.nbs)}`));
  const referencias = db.prepare(`SELECT chave,nbs,descricao,origem FROM empresa_servicos_fiscais
    WHERE empresa_id=? AND ativo=1 ORDER BY descricao`).all(Number(empresaId));
  const cadastrados = referencias.map((r) => {
    const nbs = bases.normNbs(r.nbs) || null;
    const chave = String(r.chave || '').trim();
    const lc116 = /^\d{3,5}$/.test(chave.replace(/\D/g, '')) ? bases.normLc116(chave) : null;
    return {
      tipo: 'SERVIÇO', lc116, nbs, descricao: r.descricao || 'Serviço cadastrado',
      fonte: 'Cadastro fiscal da empresa', confianca: 'ALTA',
      cnae: null, atividade: null, status: documentados.has(`${lc116 || ''}|${nbs || ''}`) ? 'DOCUMENTADA' : 'A_VALIDAR',
      impacto_motor: false,
    };
  });
  // Reusa a mesma correlação textual do Mapa Operacional. Ela só oferece
  // hipóteses quando há correspondência objetiva na descrição do CNAE.
  const indicados = correlacoesIndicativas(db, empresa, { produto: false, servico: true }).map((x) => ({
    tipo: 'SERVIÇO', lc116: bases.normLc116(x.lc116) || null, nbs: bases.normNbs(x.nbs) || null,
    descricao: x.descricao || 'Serviço catalogado', fonte: 'Correlação indicativa CNAE × catálogo LC 116/NBS',
    confianca: x.confianca || 'BAIXA', cnae: x.cnae || null, atividade: x.atividade || null,
    status: documentados.has(`${bases.normLc116(x.lc116)}|${bases.normNbs(x.nbs)}`) ? 'DOCUMENTADA' : 'A_VALIDAR',
    impacto_motor: false,
  }));
  const unicos = new Map();
  for (const item of [...cadastrados, ...indicados]) {
    const chave = `${item.lc116 || ''}|${item.nbs || ''}|${String(item.descricao).trim().toLowerCase()}`;
    const atual = unicos.get(chave);
    if (!atual || item.confianca === 'ALTA') unicos.set(chave, item);
  }
  return {
    cnaes: dadosCnae(empresa),
    itens: [...unicos.values()].sort((a, b) => `${a.status}:${a.descricao}`.localeCompare(`${b.status}:${b.descricao}`)),
    aviso: 'São possibilidades de operação para validação humana. CNAE e cadastro não comprovam a prestação; esta tela não cria documento, não altera classificação e não alimenta receita, apuração ou motor tributário.',
  };
}

function listar(empresaId) {
  const movimentos = db.prepare(`SELECT id,empresa_id,tipo,nome,inscr_federal,documento,chave,item_numero,data_emissao,competencia,descricao,valor,origem,modelo_documento_fiscal,lc116,nbs,cst,normalizacao_status,normalizacao_pendencia,normalizacao_evidencia
    FROM movimentos WHERE empresa_id=? AND (COALESCE(lc116,'')<>'' OR COALESCE(nbs,'')<>'')
      AND (lower(COALESCE(modelo_documento_fiscal,''))='nfse' OR lower(COALESCE(origem,''))<>'xml')
    ORDER BY valor DESC,id`).all(Number(empresaId));
  const itens = movimentos.map((movimento) => {
    const achado = avaliar(movimento);
    return achado && {
      movimento_id: movimento.id, empresa_id: movimento.empresa_id, tipo: movimento.tipo,
      contraparte: movimento.nome || 'Não identificada', cnpj_contraparte: movimento.inscr_federal || '',
      documento: movimento.documento || '', chave: movimento.chave || '', item_numero: movimento.item_numero || null,
      data_emissao: movimento.data_emissao || null, competencia: movimento.competencia || null,
      descricao: movimento.descricao || '', valor: r2(movimento.valor), origem: movimento.origem || '',
      lc116: bases.normLc116(movimento.lc116) || null, nbs: bases.normNbs(movimento.nbs) || null,
      normalizacao: { status: movimento.normalizacao_status || null, pendencia: movimento.normalizacao_pendencia || null, evidencia: movimento.normalizacao_evidencia || null },
      ...achado,
    };
  }).filter(Boolean);
  return {
    empresa_id: Number(empresaId),
    resumo: { total: itens.length, valor: r2(itens.reduce((s, x) => s + n(x.valor), 0)), por_tipo: itens.reduce((m, x) => ({ ...m, [x.tipo]: (m[x.tipo] || 0) + 1 }), {}) },
    itens,
    projecoes: projetarOperacoes(empresaId, movimentos),
  };
}

module.exports = { listar, avaliar, projetarOperacoes };
