/**
 * Contratos — Entrega 2
 *
 * Recomendações e textos sugeridos são derivados dos riscos da Entrega 1 e
 * de fotografias oficiais já produzidas pela Precificação. Não recalcula
 * tributos, não altera arquivos originais e não transforma rascunho em
 * cláusula definitiva.
 */
const prioridade = (nivel) => ({ alto: 'ALTA', medio: 'MEDIA', baixo: 'BAIXA', ALTO: 'ALTA', MEDIO: 'MEDIA', BAIXO: 'BAIXA' }[String(nivel || '')] || 'MEDIA');
const moeda = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MAPA = {
  AUSENCIA_CLAUSULA_TRIBUTARIA: {
    recomendacao: 'Submeter a alocação de efeitos tributários à negociação contratual, pois o texto não contém cláusula tributária identificada.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — As partes deverão definir, de forma expressa, a responsabilidade pelos tributos incidentes e o procedimento aplicável a alterações normativas que afetem a operação.',
    impacto: 'Reduz a ausência de regra contratual sobre a alocação de efeitos tributários.',
  },
  CLAUSULA_TRIBUTARIA_GENERICA: {
    recomendacao: 'Detalhar a cláusula tributária identificada, incluindo procedimento de repasse, reequilíbrio e gatilho de alteração legislativa.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — Em caso de alteração legislativa que modifique a carga tributária da operação, as partes avaliarão os efeitos documentados e o procedimento de reequilíbrio ou repasse aplicável.',
    impacto: 'Torna verificável o tratamento contratual de variações tributárias.',
  },
  PRECO_FIXO_SEM_REVISAO: {
    recomendacao: 'Avaliar mecanismo expresso de reajuste ou reequilíbrio para o preço fixo identificado.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — O preço poderá ser revisto mediante demonstração objetiva de alteração legal ou econômica que afete a base de formação do preço, conforme procedimento acordado entre as partes.',
    impacto: 'Cria um caminho contratual para tratar alteração relevante da formação de preço.',
  },
  SEM_GATILHO_ALTERACAO_LEGAL: {
    recomendacao: 'Incluir gatilho específico para mudança legislativa que afete a operação.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — Alterações legislativas que impactem diretamente os tributos, a emissão fiscal ou a formação de preço deverão ser comunicadas e avaliadas pelas partes antes da aplicação do novo tratamento.',
    impacto: 'Diminui a incerteza operacional diante de mudança normativa.',
  },
  POTENCIAL_ABSORCAO_AUMENTO: {
    recomendacao: 'Definir expressamente se o efeito tributário será absorvido, repassado ou submetido a reequilíbrio.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — A variação comprovada de encargos tributários será tratada conforme mecanismo de repasse ou reequilíbrio definido pelas partes, sem presunção de absorção unilateral.',
    impacto: 'Evita que a alocação de um aumento de custo fique implícita.',
  },
  RESPONSABILIDADE_TRIBUTARIA_INDEFINIDA: {
    recomendacao: 'Delimitar responsabilidades de classificação, emissão fiscal, recolhimento e comprovação documental.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — Cada parte responderá pelas informações fiscais sob sua responsabilidade, incluindo classificação, emissão de documento fiscal e recolhimento, sem prejuízo do dever de cooperação documental.',
    impacto: 'Melhora a definição operacional entre as partes.',
  },
  RETENCOES_SEM_RESPONSABILIDADE: {
    recomendacao: 'Especificar a responsabilidade operacional e documental pelas retenções mencionadas.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — As retenções aplicáveis serão executadas pela parte legalmente responsável, com entrega da documentação de suporte e comunicação tempestiva à outra parte.',
    impacto: 'Reduz ambiguidade no procedimento de retenções.',
  },
  TRIBUTOS_LEGADOS_SEM_TRANSICAO: {
    recomendacao: 'Revisar a referência a tributos atuais e incluir tratamento de transição aplicável à operação.',
    sugestao: 'RASCUNHO PARA REVISÃO JURÍDICA — As referências a tributos atuais deverão ser revisadas diante da transição para IBS e CBS, preservando-se a documentação e o procedimento contratual aplicáveis.',
    impacto: 'Evita que referências fiscais legadas fiquem sem tratamento de transição.',
  },
};

function recomendacaoDeRisco(risco, clausulasPorId) {
  if (!risco?.evidencia) return null; // nenhum texto sem fonte ou ausência objetiva
  const regra = MAPA[risco.codigo];
  if (!regra) return null;
  const clausula = risco.clausula_id ? clausulasPorId.get(Number(risco.clausula_id)) : null;
  return {
    risco_id: risco.id, clausula_id: clausula?.id || null, prioridade: prioridade(risco.nivel),
    recomendacao: regra.recomendacao, evidencia: risco.evidencia, impacto_potencial: risco.impacto_potencial || regra.impacto,
    fundamento: risco.fundamento || 'Triagem contratual baseada em trecho extraído ou ausência objetiva.', natureza: 'INTERPRETADO',
    sugestao: { risco_id: risco.id, clausula_original: clausula?.texto_original || `Ausência objetiva registrada: ${risco.evidencia}`,
      sugestao_redacao: regra.sugestao, motivo: regra.recomendacao, impacto_esperado: regra.impacto,
      fundamento: risco.fundamento || 'Triagem contratual baseada em evidência.', natureza: 'SUGERIDO', status: 'RASCUNHO' },
  };
}

function itemEconomico(item) {
  const s = item?.simulacao || item || {};
  const margemAtual = s.margem_atual; const margemProjetada = s.margem_projetada;
  const precoAtual = s.valor_venda_atual; const precoProjetado = s.preco_projetado;
  if (![precoAtual, precoProjetado, margemAtual, margemProjetada].some((x) => x != null)) return null;
  const precisaReajuste = precoAtual != null && precoProjetado != null && Number(precoProjetado) > Number(precoAtual);
  const margemComprimida = margemAtual != null && margemProjetada != null && Number(margemProjetada) < Number(margemAtual);
  if (!precisaReajuste && !margemComprimida) return null;
  const titulo = item.item?.descricao || item.descricao || 'Item vinculado';
  const deltaPreco = precoAtual == null || precoProjetado == null ? null : Number(precoProjetado) - Number(precoAtual);
  const deltaMargem = margemAtual == null || margemProjetada == null ? null : Number(margemProjetada) - Number(margemAtual);
  const evidencia = `Fotografia oficial de Precificação para ${titulo}: preço atual ${moeda(precoAtual)}, preço projetado ${moeda(precoProjetado)}, margem atual ${margemAtual == null ? 'INCOMPLETO' : moeda(margemAtual)} e margem projetada ${margemProjetada == null ? 'INCOMPLETO' : moeda(margemProjetada)}.`;
  return {
    prioridade: precisaReajuste || margemComprimida ? 'ALTA' : 'MEDIA',
    recomendacao: precisaReajuste ? `Validar o mecanismo contratual de reajuste para o item vinculado: a fotografia de Precificação indica variação de ${moeda(deltaPreco)}.` : `Validar o preço contratual do item vinculado: a margem projetada varia ${moeda(deltaMargem)} na fotografia oficial.`,
    evidencia, impacto_potencial: precisaReajuste ? 'O preço projetado é superior ao preço atual da fotografia vinculada.' : 'A margem projetada é inferior à margem atual da fotografia vinculada.',
    fundamento: 'Fotografia oficial de Precificação vinculada explicitamente ao contrato.', natureza: 'INTERPRETADO', origem: 'PRECIFICACAO_VINCULO_EXPLICITO',
  };
}

function gerar({ riscos = [], clausulas = [], itensPrecificacao = [] } = {}) {
  const porId = new Map(clausulas.map((c) => [Number(c.id), c]));
  const derivados = riscos.map((r) => recomendacaoDeRisco(r, porId)).filter(Boolean);
  const economicos = itensPrecificacao.map(itemEconomico).filter(Boolean);
  return { recomendacoes: [...derivados, ...economicos], sugestoes: derivados.map((x) => x.sugestao), versao: 'CONTRATOS_ENTREGA_2_V1' };
}

module.exports = { gerar, recomendacaoDeRisco, itemEconomico, prioridade };
