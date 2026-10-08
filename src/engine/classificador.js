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
const { filtrarCandidatos } = require('../services/elegibilidadeAnexoXi');

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
// Famílias de remessa do emitente (5.901–5.925 e 6.901–6.925). Elas
// registram circulação física sem caracterizar aquisição do destinatário.
const remessaSemAquisicao = (cfop) => /^[56]9(?:0[1-9]|1\d|2[0-5])$/.test(soDigitos(cfop));
// O valor de carga de vale-alimentação não se confunde com a tarifa do
// arranjo. A descrição documental, combinada ao NBS de cartão de crédito,
// é suficiente para identificar a natureza do fato, ainda que a LC 116 tenha
// vindo genérica. A apuração do crédito continua dependente do débito que o
// fornecedor/arranjo informar, mas essa evidência não é classificatória.
function cargaValeAlimentacao(item = {}) {
  const texto = String(item.descricao || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nbs = soDigitos(item.nbs);
  return nbs === '109014000'
    && /\b(CARGA|REPASSE)\b/.test(texto)
    && /\b(CARTAO|VALE)\b/.test(texto)
    && /\b(ALIMENTACAO|REFEICAO)\b/.test(texto);
}
// A hipótese de reabilitação urbana não pode ser inferida de um serviço
// ordinário de limpeza/conservação. Quando a nota identifica somente essa
// prestação, a descrição resolve a ambiguidade do catálogo para a regra
// geral. Termos que comprovem a exceção preservam a revisão humana.
function limpezaConservacaoOrdinaria(item = {}) {
  const texto = String(item.descricao || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const nbs = soDigitos(item.nbs);
  const manutencao = /\b(LIMPEZA|CONSERVACAO)\b/.test(texto);
  const excecaoUrbana = /\b(REABILITACAO|RECONVERSAO|ZONA\s+HISTORICA|AREA\s+CRITICA)\b/.test(texto);
  return nbs === '118031000' && manutencao && !excecaoUrbana;
}
// Para o NCM 8543.70.99, o benefício de acessibilidade do cClassTrib 200031
// é restrito à agenda eletrônica com teclado em braille. "Controlador facial"
// não demonstra essa característica e deve seguir a tributação geral, salvo
// outro enquadramento concreto já comprovado no catálogo/na revisão técnica.
function evidenciaAgendaBraille(item = {}) {
  const ncm = soDigitos(item.ncm);
  const texto = String(item.descricao || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (ncm === '85437099' && /AGENDA\s+ELETRONICA/.test(texto) && /TECLADO\s+(?:EM\s+)?BRAILLE/.test(texto)) {
    return { status: 'SIM', motivo: 'NCM 8543.70.99 e descrição comprovam agenda eletrônica com teclado em braille.' };
  }
  return { status: 'NAO', motivo: ncm === '85437099'
    ? 'NCM 8543.70.99 sem descrição compatível com agenda eletrônica com teclado em braille; cClassTrib 200031 não aplicável.'
    : 'NCM incompatível com a hipótese de agenda eletrônica com teclado em braille.' };
}
// A base de serviços traz cClassTrib. Para o motor, o grupo do código define
// o CST recomendado quando a planilha não o informa explicitamente.
function cstDaBase(c) {
  if (c.cst) return c.cst;
  const grupo = String(c.cclasstrib || '').slice(0, 3);
  // cClassTrib 011002 identifica plano privado de assistência à saúde. A
  // base de serviços nem sempre replica o CST, mas a classificação não pode
  // chegar ao motor sem o CST 011 exigido para esse regime específico.
  return ['000', '011', '200', '400', '410'].includes(grupo) ? grupo : '';
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
  const modeloFiscal=String(item.modelo_documento_fiscal || '').toLowerCase();
  const eServico = !item.ncm && (modeloFiscal === 'nfse'
    || (String(item.origem || '').toLowerCase() !== 'xml' && (item.nbs || item.lc116)));
  const fundamentos = [];
  let candidatos = [];
  let origem = '';

  // Revisão humana registrada na tela de benefícios. Não altera o XML nem o
  // catálogo: apenas aplica ao item vinculado uma classificação já validada
  // contra a mesma chave LC 116 + NBS, com rastreabilidade fora do motor.
  if (item.revisaoBeneficio?.candidato) {
    const c = item.revisaoBeneficio.candidato;
    return montar('CLASSIFICADO', c, 'revisão de benefício fiscal', [
      `Revisão de benefício fiscal #${item.revisaoBeneficio.revisao_id}: ${item.revisaoBeneficio.motivo}.`,
      `Classificação substituída para CST ${c.cst || '—'} / cClassTrib ${c.cclasstrib}.`,
      item.revisaoBeneficio.justificativa || 'Justificativa técnica registrada pelo usuário.',
    ], { natureza, sentido, candidatos: [c] });
  }

  // Entrada criada manualmente não possui XML para confrontar com a matriz.
  // O tratamento foi informado conscientemente no cadastro técnico e fica
  // gravado na própria linha como declaração auditável. Ele participa do
  // cálculo normal de crédito, sem reclassificar qualquer documento existente.
  if (sentido === 'entrada' && item.entradaManual && item.declarado?.cst && item.declarado?.cclasstrib) {
    const beneficio=Math.min(Math.max(Number(item.entradaManual.beneficioPercentual || 0),0),1);
    const reducao=beneficio >= 1 ? 'zero' : beneficio > 0 ? 'reduzida' : 'integral';
    return montar('CLASSIFICADO', {
      cst:item.declarado.cst, cclasstrib:item.declarado.cclasstrib,
      classificacao:'Entrada manual — tratamento declarado', reducao,
      reducao_ibs:beneficio, reducao_cbs:beneficio,
      fundamento:'Cadastro técnico de item de entrada manual.',
    }, 'lançamento manual de entrada', [
      `Entrada manual: CST ${item.declarado.cst} / cClassTrib ${item.declarado.cclasstrib}.`,
      `Benefício declarado: ${(beneficio * 100).toLocaleString('pt-BR',{maximumFractionDigits:2})}%.`,
      item.entradaManual.observacao || 'Sem observação adicional.',
    ], { natureza, sentido, declarado:item.declarado });
  }

  // Plano privado de assistência à saúde: a NBS identifica objetivamente o
  // regime específico. Não aplicar a regra ordinária quando a referência já
  // é suficiente para CST 011 / cClassTrib 011002.
  if (soDigitos(item.nbs) === '109101000') {
    return montar('CLASSIFICADO', {
      cst: '011', cclasstrib: '011002',
      classificacao: 'Planos de assistência à saúde', reducao: 'especifico',
      fundamento: 'LC 214/2025, arts. 237 e 238; Decreto 12.955/2026, art. 337.',
    }, 'NBS — plano privado de assistência à saúde', [
      'NBS 1.0910.10.00: serviços de planos privados de assistência à saúde.',
      'CST 011 / cClassTrib 011002: regime específico de planos de assistência à saúde.',
      'O crédito do adquirente é tratado em projeção separada e depende do débito da operadora e dos requisitos legais.',
    ], { natureza, sentido, candidatos: [] });
  }

  // Vale-alimentação carregado em cartão: a descrição demonstra a operação
  // concreta e prevalece sobre LC 116 genérica. Não presume crédito integral:
  // somente elimina a ambiguidade de classificação entre serviço financeiro e
  // regra ordinária; o motor de crédito exigirá o débito do fornecedor.
  if (sentido === 'entrada' && cargaValeAlimentacao(item)) {
    return montar('CLASSIFICADO', {
      cst: '010', cclasstrib: '010002',
      classificacao: 'Vale-alimentação — carga em cartão / arranjo de pagamento',
      reducao: 'integral',
      fundamento: 'LC 214/2025, arts. 57, 182 e 214 a 218.',
    }, 'descrição documental + NBS', [
      'Descrição identifica carga ou repasse de vale-alimentação em cartão.',
      'NBS 1.0901.40.00: serviços de cartão de crédito.',
      'LC 116 genérica não impede a classificação da natureza da operação.',
      'O crédito CBS fica limitado ao débito apurado e extinto pelo fornecedor/arranjo.',
    ], { natureza, sentido, candidatos: [] });
  }

  if (limpezaConservacaoOrdinaria(item)) {
    return montar('CLASSIFICADO', {
      cst: '000', cclasstrib: '000001',
      classificacao: 'Serviço ordinário de limpeza e conservação',
      reducao: 'integral',
      fundamento: 'Descrição documental da prestação; a hipótese de reabilitação urbana não foi evidenciada.',
    }, 'descrição documental + NBS', [
      'Descrição identifica exclusivamente serviço de limpeza e conservação.',
      'A hipótese de reabilitação urbana não é presumida sem evidência específica da operação.',
      'Aplicada a tributação integral de serviço (CST 000 / cClassTrib 000001).',
    ], { natureza, sentido, candidatos: [] });
  }

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
  // Remessa para conserto/reparo (por exemplo CFOP 5.915/6.915) não é
  // aquisição: não há transferência de titularidade nem insumo comprado.
  // Em uma entrada importada com esse CFOP, a conclusão é suficiente para
  // encerrar o crédito sem exigir NCM, NBS ou cClassTrib do bem remetido.
  if (sentido === 'entrada' && (natureza === 'remessa' || remessaSemAquisicao(item.cfop))) {
    return montar('CLASSIFICADO', null, 'CFOP', [
      `CFOP ${item.cfop}: remessa sem aquisição tributável.`,
      'A operação não gera crédito de entrada de PIS/Cofins nem crédito CBS/IBS.',
    ], { natureza:'remessa', sentido, semCreditoPorCfop:true });
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
    const r = bases.consultarServico(item.lc116, item.nbs);
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

  const elegibilidade = filtrarCandidatos(candidatos, {
    ...(ctx.elegibilidadeAnexoXi || {}),
    acessibilidade: evidenciaAgendaBraille(item),
  });
  candidatos = elegibilidade.candidatos;
  if (elegibilidade.excluidos.length) fundamentos.push(...elegibilidade.excluidos.map((x) => `${x.codigo} eliminado: ${x.motivo}`));
  if (elegibilidade.pendentes.length) fundamentos.push(...elegibilidade.pendentes.map((x) => `${x.codigo} permanece pendente: ${x.motivo}`));
  if (!candidatos.length) {
    return montar('CLASSIFICADO', { cst: '000', cclasstrib: '000001', classificacao: 'Tributação integral — regra padrão', reducao: 'integral' },
      'elegibilidade condicional Anexo XI', fundamentos.concat(['Nenhuma condição especial do Anexo XI foi atendida; aplicada a regra padrão CBS.']),
      { natureza, sentido, candidatos: [] });
  }

  // 200044 é uma regra específica condicional do Anexo XI. Quando o QSA do
  // emitente confirma a condição, ela prevalece sobre a regra geral 000001;
  // antes esta confirmação apenas mantinha 200044 como candidato e o motor
  // terminava em validação por haver dois códigos. Outra exceção material
  // concorrente continua exigindo decisão humana.
  const qsa = ctx.elegibilidadeAnexoXi?.qsa || {};
  const adquirenteAnexoXi = ctx.elegibilidadeAnexoXi?.adquirente || {};
  const candidato200044 = candidatos.find((c) => c.cclasstrib === '200044');
  // A hipótese pública 200043 cuja natureza jurídica ainda está PENDENTE não
  // pode bloquear a hipótese 200044 já demonstrada pelo QSA do emitente. Ela
  // continua registrada como pendência, mas não é uma divergência material
  // contra uma regra específica comprovada. Um 200043 confirmado (ou outra
  // exceção material) preserva a necessidade de decisão.
  const outrosEspecificos = candidatos.filter((c) => {
    const codigo = String(c.cclasstrib || '');
    if (['000001', '200044'].includes(codigo)) return false;
    return !(codigo === '200043' && adquirenteAnexoXi.status !== 'SIM');
  });
  if (qsa.status === 'SIM' && candidato200044 && !outrosEspecificos.length) {
    candidatos = [candidato200044];
    fundamentos.push(`200044 aplicado como regra específica vencedora: ${qsa.motivo || 'QSA confirmado.'}`);
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
  // O catálogo pode trazer somente a hipótese 200044 para determinado
  // NCM/NBS. Ainda assim, ela é condicional: sem confirmação societária (ou
  // premissa operacional expressa) não se pode aplicar a redução apenas por
  // ter restado um único candidato após os demais filtros.
  if (c.cclasstrib === '200044' && qsa.status !== 'SIM') {
    return montar('REQUER_VALIDACAO', c, origem,
      fundamentos.concat(['A redução do cClassTrib 200044 depende da participação brasileira mínima de 20%, ainda não confirmada para o fornecedor.']),
      { natureza, sentido, candidatos, elegibilidadeAnexoXi: { codigo: '200044', status_qsa: qsa.status || 'PENDENTE', socio: qsa.socio || null, motivo: qsa.motivo || null } });
  }
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
  let divergenciaDocumental = false;
  if (item.declarado && (item.declarado.cst || item.declarado.cclasstrib)) {
    const divergente = (item.declarado.cst && c.cst && item.declarado.cst !== c.cst)
      || (item.declarado.cclasstrib && c.cclasstrib && item.declarado.cclasstrib !== c.cclasstrib);
    if (divergente) {
      // O XML é fato histórico, não uma escolha fiscal que possa prevalecer
      // sobre a condição objetiva já comprovada. Para 200044, NBS elegível +
      // QSA confirmado determinam a regra; a divergência é preservada para
      // rastreabilidade, mas não volta a bloquear o cálculo.
      if (c.cclasstrib === '200044' && qsa.status === 'SIM') {
        divergenciaDocumental = true;
        fundamentos.push(`Documento: CST ${item.declarado.cst || '—'} / cClassTrib ${item.declarado.cclasstrib || '—'} preservado como divergência histórica. Base aplicável: CST ${c.cst || '—'} / cClassTrib 200044, com condição societária comprovada.`);
      } else {
      return montar('REQUER_VALIDACAO', c, origem,
        fundamentos.concat([`Documento: CST ${item.declarado.cst || '—'} / cClassTrib ${item.declarado.cclasstrib || '—'}. Base recomendada: CST ${c.cst || '—'} / cClassTrib ${c.cclasstrib || '—'}. Confirmar a divergência antes da entrega fiscal.`]),
        { natureza, sentido, candidatos, divergencia: true, declarado: item.declarado });
      }
    }
  }
  if (c.fundamento) fundamentos.push(`Fundamento legal: ${c.fundamento}.`);
  if (c.anexo) fundamentos.push(`Anexo ${c.anexo} da LC 214.`);
  return montar('CLASSIFICADO', c, origem, fundamentos, { natureza, sentido, candidatos, divergencia: divergenciaDocumental, declarado: item.declarado || null,
    elegibilidadeAnexoXi: candidato200044 ? { codigo: '200044', status_qsa: qsa.status || 'PENDENTE', socio: qsa.socio || null, motivo: qsa.motivo || null } : null });
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
    elegibilidadeAnexoXi: extra.elegibilidadeAnexoXi || null,
    semCreditoPorCfop: !!extra.semCreditoPorCfop,
  };
}

module.exports = { classificar, naturezaPorCfop, evidenciaAgendaBraille };
