/**
 * MOTOR DE CLASSIFICAÇÃO  (item 7 da especificação)
 * ---------------------------------------------------------------------------
 * Determina CST IBS/CBS, cClassTrib e tratamento tributário de cada item.
 *
 * REGRA CENTRAL: a classificação NÃO sai apenas do NCM. A operação concreta
 * entra na decisão — CFOP, natureza da operação, sentido (entrada/saída),
 * regime das partes, perfil do destinatário e grupos especiais do cliente.
 * O NCM é ponto de partida, não conclusão.
 *
 * Resultado possível (item 7):
 *   CLASSIFICADO        — uma única regra aplicável, com fundamento
 *   REQUER_VALIDACAO    — mais de uma regra possível, ou operação que a base
 *                         não resolve sozinha (o consultor decide)
 *   SEM_CORRESPONDENCIA — nenhuma regra encontrada nas bases
 *
 * Toda conclusão guarda a origem da regra (item 6, parte final).
 */
const db = require('../db');
const bases = require('../services/basesReforma');
const regras = require('../services/regras');
const { avaliarEquivalenciaClassificatoria } = require('../services/equivalenciaClassificatoria');

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
// A base de serviços traz cClassTrib. Para o motor, o grupo do código define
// o CST recomendado quando a planilha não o informa explicitamente.
function cstDaBase(c) {
  if (c.cst) return c.cst;
  const grupo = String(c.cclasstrib || '').slice(0, 3);
  return ['000', '200', '400', '410'].includes(grupo) ? grupo : '';
}

/**
 * CFOPs que, por si sós, indicam operação sem incidência ou com tratamento
 * próprio, independentemente do NCM. A lista fica em banco (param_cfop) e
 * pode ser ajustada; aqui ficam apenas os agrupamentos estruturais.
 */
function naturezaPorCfop(cfop) {
  // A tabela de CFOP vive em Configurações — inclusive a ordem de avaliação,
  // que precisa colocar o primeiro dígito (exterior) antes dos grupos.
  return regras.naturezaCfop(cfop);
}

/** Grupos especiais já cadastrados para a empresa (reuso, item 6) */
function grupoEspecial(empresaId) {
  try {
    const e = db.prepare('SELECT setor, reducao_padrao FROM empresas WHERE id = ?').get(empresaId);
    return e || null;
  } catch (_) { return null; }
}

/**
 * @param {object} item  linha da movimentação já normalizada
 * @param {object} ctx   { empresa, sentido: 'entrada'|'saida', regimeContraparte, perfilDestinatario }
 */
function classificar(item, ctx = {}) {
  const sentido = ctx.sentido === 'saida' ? 'saida' : 'entrada';
  const natureza = naturezaPorCfop(item.cfop);
  const eServico = !item.ncm && (item.nbs || item.lc116 || item.cst || item.iss);
  const fundamentos = [];
  let candidatos = [];
  let origem = '';

  // --- 1. decisão já tomada pelo consultor para esta empresa tem precedência
  if (ctx.empresa && item.ncm) {
    const d = db.prepare('SELECT * FROM base_decisoes WHERE empresa_id = ? AND chave = ? AND tipo = ?')
      .get(ctx.empresa.id, bases.normNcm(item.ncm), 'ncm');
    if (d) {
      const linha = db.prepare('SELECT * FROM base_ncm WHERE ncm = ? AND cclasstrib = ?')
        .get(bases.normNcm(item.ncm), d.cclasstrib);
      return montar('CLASSIFICADO', linha, 'decisão do consultor',
        [`Enquadramento definido manualmente para o NCM ${item.ncm} nesta empresa.`], { natureza, sentido });
    }
  }

  // --- 2. natureza da operação que dispensa consulta à base de produto
  if (natureza === 'exportacao') {
    return montar('CLASSIFICADO', { cst: '410', cclasstrib: '410001', classificacao: 'Imunidade — exportação', reducao: 'imune' },
      'CFOP', ['Exportação: imune ao IBS/CBS com manutenção dos créditos das aquisições.'], { natureza, sentido });
  }
  if (natureza === 'remessa' || natureza === 'transferencia') {
    return montar('REQUER_VALIDACAO', null, 'CFOP',
      [`Operação de ${natureza} identificada pelo CFOP ${item.cfop}. O tratamento depende da finalidade concreta — confirmar se há incidência.`],
      { natureza, sentido });
  }
  if (natureza === 'devolucao') {
    return montar('REQUER_VALIDACAO', null, 'CFOP',
      ['Devolução: o tratamento acompanha a operação original. Confirmar a classificação da venda que originou a devolução.'],
      { natureza, sentido });
  }

  // Benefício específico governamental tem precedência sobre a regra geral.
  // Só entra quando o cadastro oficial já confirmou o ente como elegível.
  if (sentido === 'saida' && ctx.perfilDestinatario === 'governo') {
    const chave = item.ncm ? bases.normNcm(item.ncm) : String(item.nbs || '').replace(/\D/g, '');
    const campo = item.ncm ? 'ncm' : 'nbs';
    const regrasGov = db.prepare(`SELECT * FROM regras_governo WHERE ${campo}=?`).all(chave);
    if (regrasGov.length === 1) {
      const g = regrasGov[0];
      return montar('CLASSIFICADO', { cst: g.cst, cclasstrib: g.cclasstrib, classificacao: g.tratamento,
        reducao: g.aliquota_zero ? 'zero' : 'reduzida', reducao_ibs: Number(g.reducao || 0), reducao_cbs: Number(g.reducao || 0),
        fundamento: g.fundamento, indop: g.indop }, 'regra governamental específica',
        [`Benefício específico para ente elegível: ${g.tratamento}.`, `Fundamento: ${g.fundamento}.`, g.condicoes || ''], { natureza, sentido });
    }
    if (regrasGov.length > 1) return montar('REQUER_VALIDACAO', null, 'regra governamental específica',
      ['Há mais de uma regra governamental para este código. Confirmar LC 116/NBS ou condição legal aplicável.'], { natureza, sentido, candidatos: regrasGov });
  }

  // --- 3. base de produto/serviço
  if (item.ncm) {
    const r = bases.consultarNcm(item.ncm);
    origem = `base NCM (${r.nivel || 'não encontrado'})`;
    if (r.encontrado) {
      candidatos = r.candidatos;
      fundamentos.push(`NCM ${item.ncm} localizado na matriz da LC 214${r.nivel !== 'exato' ? ` por ${r.nivel}` : ''}.`);
      if (r.nivel && r.nivel !== 'exato' && candidatos.length <= 1) {
        return montar('REQUER_VALIDACAO', null, origem,
          fundamentos.concat(['Correspondência apenas por posição/subposição — confirmar o NCM completo do produto.']),
          { natureza, sentido, candidatos });
      }
    }
  }
  if (!candidatos.length && (item.nbs || eServico)) {
    const r = bases.consultarServico(item.lc116 || item.cst, item.nbs);
    origem = `base LC 116/NBS (${r.nivel || 'não encontrado'})`;
    if (r.encontrado) {
      candidatos = r.candidatos;
      fundamentos.push(r.nivel === 'exato'
        ? `Serviço localizado pela chave LC 116 ${r.lc116} + NBS ${r.nbs}.`
        : `Serviço localizado apenas por ${r.nivel} — a chave completa é LC 116 + NBS.`);
      if (r.nivel !== 'exato' && candidatos.length > 1) fundamentos.push('A chave documental está incompleta; os candidatos serão comparados somente pela assinatura tributária material.');
    }
  }

  if (!candidatos.length) {
    // Sem exceção identificada, a projeção econômica segue a tributação
    // regular parametrizada. Não escolhe NCM/NBS arbitrariamente: registra
    // apenas a regra padrão CBS, preservando a ausência de código na memória.
    return montar('CLASSIFICADO', { cst: '000', cclasstrib: '000001', classificacao: 'Tributação integral — regra padrão', reducao: 'integral' },
      'regra padrão CBS', [item.ncm || item.nbs || item.lc116
        ? `Código ${item.ncm || item.nbs || item.lc116} sem exceção específica no catálogo; aplicada tributação regular parametrizada.`
        : 'Sem código de produto/serviço; aplicada tributação regular parametrizada, sem atribuir classificação documental.'],
      { natureza, sentido });
  }

  // --- 4. mais de um candidato: o motor não escolhe (item 7)
  if (candidatos.length > 1) {
    const equivalencia = avaliarEquivalenciaClassificatoria(candidatos, { tipo_operacao: natureza, destinacao: ctx.perfilDestinatario || '' });
    if (equivalencia.status === 'EQUIVALENTE_FISCALMENTE') {
      return montar('PARCIAL', null, origem,
        fundamentos.concat([`${candidatos.length} classificações candidatas têm a mesma assinatura tributária material. Nenhum código foi escolhido.`]),
        { natureza, sentido, candidatos, equivalenciaFiscal: equivalencia });
    }
    return montar('REQUER_VALIDACAO', null, origem,
      fundamentos.concat([`${candidatos.length} enquadramentos possíveis para este código. A escolha depende da operação concreta.`]),
      { natureza, sentido, candidatos, equivalenciaFiscal: equivalencia });
  }

  // --- 5. único candidato, mas a operação pode afastá-lo
  let c = candidatos[0];
  if (sentido === 'entrada' && natureza === 'ativo_consumo') {
    return montar('REQUER_VALIDACAO', c, origem,
      fundamentos.concat(['Aquisição para uso e consumo ou ativo: confirmar se há vedação ao crédito nesta hipótese.']),
      { natureza, sentido, candidatos, vedacaoPossivel: true });
  }
  if (sentido === 'saida' && ctx.perfilDestinatario === 'governo') {
    fundamentos.push('Destinatário é ente público: verificar redução específica prevista para aquisições da Administração Pública.');
    return montar('REQUER_VALIDACAO', c, origem, fundamentos, { natureza, sentido, candidatos });
  }

  fundamentos.push(`Tratamento: ${c.classificacao || c.nome_cclasstrib || 'tributação integral'}.`);
  // A BASE é a recomendação do motor. O documento é preservado apenas para
  // comparação; nunca substitui a regra recomendada silenciosamente.
  c = { ...c, cst: cstDaBase(c) };
  if (item.declarado && (item.declarado.cst || item.declarado.cclasstrib)) {
    const divergente = (item.declarado.cst && c.cst && item.declarado.cst !== c.cst)
      || (item.declarado.cclasstrib && c.cclasstrib && item.declarado.cclasstrib !== c.cclasstrib);
    if (divergente) {
      return montar('REQUER_VALIDACAO', c, origem,
        fundamentos.concat([`Documento: CST ${item.declarado.cst || '—'} / cClassTrib ${item.declarado.cclasstrib || '—'}. Base recomendada: CST ${c.cst || '—'} / cClassTrib ${c.cclasstrib || '—'}. Confirmar a divergência antes da entrega fiscal.`]),
        { natureza, sentido, candidatos, divergencia: true, declarado: item.declarado });
    }
  }
  if (c.fundamento) fundamentos.push(`Fundamento legal: ${c.fundamento}.`);
  if (c.anexo) fundamentos.push(`Anexo ${c.anexo} da LC 214.`);
  return montar('CLASSIFICADO', c, origem, fundamentos, { natureza, sentido, candidatos, declarado: item.declarado || null });
}

function montar(status, c, origem, fundamentos, extra = {}) {
  return {
    status,
    cst: c ? (c.cst || '') : '',
    cclasstrib: c ? (c.cclasstrib || '') : '',
    tratamento: c ? (c.classificacao || c.nome_cclasstrib || '') : '',
    reducao: c ? (c.reducao || 'integral') : 'integral',
    reducaoIbs: c && c.reducao_ibs != null ? c.reducao_ibs : null,
    reducaoCbs: c && c.reducao_cbs != null ? c.reducao_cbs : null,
    anexo: c ? (c.anexo || '') : '',
    fundamentoLegal: c ? (c.fundamento || '') : '',
    localIncidencia: c ? (c.local_incidencia || '') : '',
    indop: c ? (c.indop || '') : '',
    origemRegra: origem,
    fundamentos,
    natureza: extra.natureza || null,
    sentido: extra.sentido,
    candidatos: (extra.candidatos || []).map((x) => ({
      cclasstrib: x.cclasstrib, cst: x.cst, classificacao: x.classificacao || x.nome_cclasstrib,
      anexo: x.anexo, reducao: x.reducao, reducao_ibs: x.reducao_ibs, lc116: x.lc116,
      nbs: x.nbs, ncm: x.ncm, catalogo_versao_id: x.catalogo_versao_id || x.catalogoVersao || null,
    })),
    vedacaoPossivel: !!extra.vedacaoPossivel,
    divergencia: !!extra.divergencia,
    equivalenciaFiscal: extra.equivalenciaFiscal || null,
    impactoTributarioMaterial: extra.equivalenciaFiscal?.impacto_tributario_material ?? null,
    declarado: extra.declarado || null,
  };
}

module.exports = { classificar, naturezaPorCfop };
