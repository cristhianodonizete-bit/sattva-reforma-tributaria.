/* Checklist operacional de implantação. Não cria módulos nem regras fiscais:
 * transforma exclusivamente o escopo já contratado em pendências rastreáveis. */
const STATUS = ['NAO_SOLICITADO', 'SOLICITADO', 'AGUARDANDO_CLIENTE', 'RECEBIDO', 'PARCIAL', 'COM_PENDENCIA', 'VALIDADO', 'CONCLUIDO', 'NAO_APLICAVEL'];

const CHECKLISTS = {
  diagnostico: [
    ['SOLICITAR_XML', 'Solicitar XML/DF-e', 'XML_DFE'],
    ['SOLICITAR_EFD', 'Solicitar EFD quando aplicável', 'EFD_CONTRIBUICOES'],
    ['SOLICITAR_PLANILHA_ERP', 'Solicitar planilha/ERP quando aplicável', 'PLANILHA_ERP'],
    ['SOLICITAR_FOLHA', 'Solicitar folha de pagamento por competência', 'FOLHA_PAGAMENTO'],
    ['SOLICITAR_MARGEM_OPERACIONAL', 'Solicitar margem operacional', 'MARGEM_OPERACIONAL'],
    ['SOLICITAR_RECEITAS_SEM_DFE', 'Solicitar receitas sem documento fiscal', 'RECEITA_SEM_DFE'],
    ['VERIFICAR_DOCUMENTOS', 'Verificar documentos recebidos', 'VERIFICACAO'],
    ['IDENTIFICAR_PENDENCIAS', 'Identificar pendências', 'PENDENCIA'],
    ['VALIDAR_BASE_DIAGNOSTICO', 'Validar base para diagnóstico', 'VALIDACAO'],
  ],
  contratos: [
    ['SOLICITAR_CONTRATOS', 'Solicitar contratos', 'CONTRATO'],
    ['REGISTRAR_CONTRATOS_RECEBIDOS', 'Registrar contratos recebidos', 'CONTRATO'],
    ['REGISTRAR_CONTRATOS_PENDENTES', 'Registrar contratos pendentes', 'PENDENCIA'],
    ['LIBERAR_ANALISE_CONTRATUAL', 'Liberar análise contratual', 'VALIDACAO'],
  ],
  precificacao: [
    ['SOLICITAR_BASE_PRECIFICACAO', 'Solicitar planilha/base de precificação', 'PLANILHA_ERP'],
    ['VALIDAR_ARQUIVO_PRECIFICACAO', 'Validar arquivo de precificação', 'VALIDACAO'],
    ['LIBERAR_PRECIFICACAO', 'Liberar módulo de precificação', 'VALIDACAO'],
  ],
  capacitacao: [
    ['SOLICITAR_PARTICIPANTES', 'Solicitar participantes: nome, e-mail, cargo e área', 'LISTA_PARTICIPANTES'],
    ['CONTROLAR_LISTA_PARTICIPANTES', 'Controlar recebimento da lista de participantes', 'LISTA_PARTICIPANTES'],
  ],
  acompanhamento: [
    ['VALIDAR_BASELINE_ACOMPANHAMENTO', 'Validar baseline para acompanhamento', 'VALIDACAO'],
  ],
};

function escoposCanonicos(modulos = [], acompanhamentoMeses = 0) {
  const entrada = new Set((modulos || []).map((x) => String(x).toLowerCase()));
  const saida = [];
  ['diagnostico', 'contratos', 'precificacao'].forEach((x) => { if (entrada.has(x)) saida.push(x); });
  if (entrada.has('capacitacao') || entrada.has('treinamento_boas_praticas') || entrada.has('capacitacao_operacional')) saida.push('capacitacao');
  if (entrada.has('acompanhamento') || Number(acompanhamentoMeses) > 0) saida.push('acompanhamento');
  return saida;
}

function gerarChecklist(db, contratacaoId, modulos, acompanhamentoMeses = 0) {
  const entregaPorChave = new Map(db.prepare('SELECT id,chave FROM projeto_entregas WHERE contratacao_id=?').all(contratacaoId).map((x) => [x.chave, x.id]));
  const inserir = db.prepare(`INSERT OR IGNORE INTO projeto_checklist_implantacao
    (contratacao_id,entrega_id,escopo,chave,titulo,tipo_evidencia,status,ordem,origem)
    VALUES (?,?,?,?,?,?, 'NAO_SOLICITADO', ?, 'AUTOMATICO')`);
  let criados = 0;
  for (const escopo of escoposCanonicos(modulos, acompanhamentoMeses)) {
    const entregaId = entregaPorChave.get(escopo) || null;
    (CHECKLISTS[escopo] || []).forEach(([chave, titulo, tipoEvidencia], ordem) => {
      const r = inserir.run(contratacaoId, entregaId, escopo, `${escopo}:${chave}`, titulo, tipoEvidencia, ordem + 1);
      criados += Number(r.changes || 0);
    });
  }
  return criados;
}

function progresso(checklist = []) {
  const concluidos = checklist.filter((x) => ['VALIDADO', 'CONCLUIDO', 'NAO_APLICAVEL'].includes(x.status)).length;
  const pendentes = checklist.filter((x) => ['COM_PENDENCIA', 'AGUARDANDO_CLIENTE'].includes(x.status)).length;
  return { total: checklist.length, concluidos, pendentes, percentual: checklist.length ? Math.round(concluidos * 100 / checklist.length) : 0 };
}

module.exports = { STATUS, CHECKLISTS, escoposCanonicos, gerarChecklist, progresso };
