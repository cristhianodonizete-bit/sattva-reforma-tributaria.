/**
 * MAPA DE RISCOS  (entregável já previsto na cartilha)
 * ---------------------------------------------------------------------------
 * Deriva os riscos dos RESULTADOS DO MOTOR, não de regras genéricas. Cada
 * risco carrega o valor exposto, os itens que o originaram e a ação sugerida —
 * é o que transforma o diagnóstico em pauta de trabalho.
 *
 * Dimensões avaliadas:
 *   CRÉDITO      — crédito que não vem, ou vem limitado
 *   CLASSIFICAÇÃO— itens sem enquadramento seguro
 *   CADASTRO     — dados que faltam e travam a projeção
 *   MARGEM       — variação de carga que a operação vai absorver
 *   CARTEIRA     — concentração em perfis que não creditam
 *   FLUXO        — saldo credor estrutural e split payment
 */
const P = require('../config/parametros');
const regras = require('./regras');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const pct = (n) => `${((Number(n) || 0) * 100).toFixed(1).replace('.', ',')}%`;
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * @param {object} r  saída de motorExec.executar()
 * @param {object} consolidado { fornecedores, clientes }
 */
function montar(r, consolidado = {}) {
  const riscos = [];
  const { entradas, saidas, resumo, empresa } = r;
  const totalCompras = resumo.comprasAnalisadas || 0;
  const totalVendas = resumo.faturamentoAnalisado || 0;
  const fornecedores = consolidado.fornecedores || [];
  const clientes = consolidado.clientes || [];

  // ---------------------------------------------------------------- CRÉDITO
  const semCredito = entradas.filter((x) => x.credito.status === 'SEM_DIREITO');
  const limitado = entradas.filter((x) => x.credito.status === 'PROJETADO_LIMITADO');
  const aValidar = entradas.filter((x) => ['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES'].includes(x.credito.status));

  if (limitado.length) {
    const valor = limitado.reduce((s, x) => s + x.precoAtual, 0);
    const creditoPerdido = limitado.reduce((s, x) => s + (x.baseEconomica * 0.265 - x.creditoTotal), 0);
    riscos.push({
      dimensao: 'Crédito', nivel: nivelPor(valor, totalCompras, 0.15, 0.05),
      titulo: 'Compras de fornecedores que não geram crédito integral',
      exposicao: r2(valor), participacao: totalCompras ? valor / totalCompras : 0,
      itens: limitado.length,
      descricao: `${pct(totalCompras ? valor / totalCompras : 0)} do volume de compras vem de optantes do Simples ou MEI. O crédito fica limitado ao IBS/CBS embutido no DAS, muito abaixo do que um fornecedor do regime regular destacaria.`,
      impacto: `Diferença estimada de ${brl(Math.max(creditoPerdido, 0))} em crédito não aproveitado no cenário final.`,
      acao: 'Renegociar preço com base no valor SEM imposto, avaliar a migração desses fornecedores para o regime regular de IBS/CBS ou revisar a base de fornecimento dos itens de maior valor.',
      evidencias: topN(limitado, 6),
    });
  }
  if (semCredito.length && !['simples_nacional', 'mei'].includes(empresa.regime)) {
    const valor = semCredito.reduce((s, x) => s + x.precoAtual, 0);
    riscos.push({
      dimensao: 'Crédito', nivel: nivelPor(valor, totalCompras, 0.10, 0.03),
      titulo: 'Aquisições sem direito a crédito',
      exposicao: r2(valor), participacao: totalCompras ? valor / totalCompras : 0,
      itens: semCredito.length,
      descricao: 'Entradas em que o adquirente não se apropria de IBS/CBS.',
      impacto: 'O tributo dessas aquisições vira custo definitivo, não recuperável.',
      acao: 'Confirmar o enquadramento dessas operações e verificar se há reclassificação possível.',
      evidencias: topN(semCredito, 6),
    });
  }
  if (aValidar.length) {
    const valor = aValidar.reduce((s, x) => s + x.precoAtual, 0);
    riscos.push({
      dimensao: 'Crédito', nivel: nivelPor(valor, totalCompras, 0.20, 0.08),
      titulo: 'Crédito projetado dependente de validação',
      exposicao: r2(valor), participacao: totalCompras ? valor / totalCompras : 0,
      itens: aValidar.length,
      descricao: 'Itens em que a apropriação depende de informação ausente nos documentos ou nas bases.',
      impacto: 'Esses valores não podem ser apresentados ao cliente como crédito assegurado.',
      acao: 'Completar cadastro de regimes, confirmar destinação de uso e consumo e concluir a classificação pendente.',
      evidencias: topN(aValidar, 6),
    });
  }

  // ---------------------------------------------------- CLASSIFICAÇÃO
  const todos = [...entradas, ...saidas];
  const semCorresp = todos.filter((x) => x.classificacao.status === 'SEM_CORRESPONDENCIA');
  const multiplos = todos.filter((x) => x.classificacao.status === 'REQUER_VALIDACAO'
    && x.classificacao.candidatos && x.classificacao.candidatos.length > 1);

  if (semCorresp.length) {
    const valor = semCorresp.reduce((s, x) => s + x.precoAtual, 0);
    riscos.push({
      dimensao: 'Classificação', nivel: nivelPor(valor, totalCompras + totalVendas, 0.10, 0.02),
      titulo: 'Itens sem correspondência nas bases tributárias',
      exposicao: r2(valor), participacao: (totalCompras + totalVendas) ? valor / (totalCompras + totalVendas) : 0,
      itens: semCorresp.length,
      descricao: 'NCM ou NBS que não constam das bases carregadas, ou itens sem código algum.',
      impacto: 'Entram no cálculo como tributação integral, o que pode superestimar a carga — e, se o NCM estiver de fato incorreto no cadastro, é apontamento fiscal, não só imprecisão de projeção.',
      acao: 'Auditar o cadastro de produtos, corrigir NCM/NBS inválidos e verificar se a base carregada está na versão vigente.',
      evidencias: topN(semCorresp, 8),
    });
  }
  if (multiplos.length) {
    const valor = multiplos.reduce((s, x) => s + x.precoAtual, 0);
    riscos.push({
      dimensao: 'Classificação', nivel: nivelPor(valor, totalCompras + totalVendas, 0.15, 0.05),
      titulo: 'Itens com mais de um enquadramento possível',
      exposicao: r2(valor), participacao: (totalCompras + totalVendas) ? valor / (totalCompras + totalVendas) : 0,
      itens: multiplos.length,
      descricao: 'A base traz mais de um tratamento aplicável ao mesmo código. A escolha depende da operação concreta e não pode ser automatizada.',
      impacto: 'Enquadramento indevido gera autuação para a empresa e glosa de crédito na ponta seguinte da cadeia.',
      acao: 'Decidir o enquadramento por NCM na tela de Bases de classificação, registrando o fundamento da escolha.',
      evidencias: topN(multiplos, 8),
    });
  }

  // -------------------------------------------------------- CADASTRO
  const semRegime = todos.filter((x) => !x.regimeEmitente || !x.regimeAdquirente);
  if (semRegime.length) {
    const valor = semRegime.reduce((s, x) => s + x.precoAtual, 0);
    riscos.push({
      dimensao: 'Cadastro', nivel: nivelPor(valor, totalCompras + totalVendas, 0.15, 0.05),
      titulo: 'Contrapartes sem regime tributário cadastrado',
      exposicao: r2(valor), participacao: (totalCompras + totalVendas) ? valor / (totalCompras + totalVendas) : 0,
      itens: semRegime.length,
      descricao: 'O regime determina se há crédito e quanto. Sem ele, a projeção assume o cenário mais conservador.',
      impacto: 'É a lacuna que mais compromete a confiabilidade do diagnóstico — todo o resto depende dela.',
      acao: 'Completar o cadastro de parceiros. O SPED não traz o regime; o XML só sugere pelo CRT, sem separar Lucro Real de Presumido.',
      evidencias: topN(semRegime, 8),
    });
  }
  const simplesSemFaixa = entradas.filter((x) => x.cenariosSimples);
  if (simplesSemFaixa.length) {
    const valor = simplesSemFaixa.reduce((s, x) => s + x.precoAtual, 0);
    const amplitude = simplesSemFaixa.reduce((s, x) => {
      const a = x.cenariosSimples.amplitude;
      return s + (a ? a.creditoMax - a.creditoMin : 0);
    }, 0);
    riscos.push({
      dimensao: 'Cadastro', nivel: 'media',
      titulo: 'Faturamento de fornecedores do Simples desconhecido',
      exposicao: r2(valor), participacao: totalCompras ? valor / totalCompras : 0,
      itens: simplesSemFaixa.length,
      descricao: 'Sem o RBT12, a alíquota efetiva não é determinável e o crédito é simulado por faixa.',
      impacto: `A incerteza soma ${brl(amplitude)} entre a faixa mais baixa e a mais alta. Nenhum desses valores pode ser tratado como apurado.`,
      acao: 'Solicitar o faturamento dos 12 meses aos fornecedores relevantes, ou trabalhar com a faixa mais conservadora nas decisões de compra.',
      evidencias: topN(simplesSemFaixa, 6),
    });
  }

  // ------------------------------------------------------ BASE ECONÔMICA
  const baseInsegura = todos.filter((x) => x.reconstrucao.status !== 'reconstruida');
  if (baseInsegura.length) {
    const valor = baseInsegura.reduce((s, x) => s + x.precoAtual, 0);
    riscos.push({
      dimensao: 'Base econômica', nivel: nivelPor(valor, totalCompras + totalVendas, 0.20, 0.08),
      titulo: 'Base econômica reconstruída com estimativa',
      exposicao: r2(valor), participacao: (totalCompras + totalVendas) ? valor / (totalCompras + totalVendas) : 0,
      itens: baseInsegura.length,
      descricao: 'Documentos sem os tributos destacados obrigaram a estimar componentes pela alíquota do regime.',
      impacto: 'Todo número derivado dessa base é projeção sujeita à validação, não apuração.',
      acao: 'Verificar se a importação capturou todos os campos e se a escrituração traz o detalhe por item (registro C170).',
      evidencias: topN(baseInsegura, 6),
    });
  }

  // ----------------------------------------------------------- CARTEIRA
  const naoCredita = clientes.filter((c) => ['b2c_pf', 'b2c_pj', 'governo'].includes(c.perfil)
    || ['simples_nacional', 'mei'].includes(c.regime));
  const valorNaoCredita = naoCredita.reduce((s, c) => s + num(c.faturamento), 0);
  if (totalVendas && valorNaoCredita / totalVendas > 0.20) {
    riscos.push({
      dimensao: 'Carteira', nivel: valorNaoCredita / totalVendas > 0.5 ? 'alta' : 'media',
      titulo: 'Carteira concentrada em clientes que não se creditam',
      exposicao: r2(valorNaoCredita), participacao: valorNaoCredita / totalVendas,
      itens: naoCredita.length,
      descricao: `${pct(valorNaoCredita / totalVendas)} do faturamento vai para pessoas físicas, optantes do Simples, entes públicos ou entidades imunes.`,
      impacto: 'Esses clientes sentem o preço cheio. O repasse do IVA não é neutro para eles e o risco comercial é real.',
      acao: 'Definir política de repasse gradual por perfil, revisar mix e preparar a argumentação comercial antes de 2027.',
      evidencias: naoCredita.slice(0, 8).map((c) => ({ contraparte: c.cliente, cnpj: c.cnpj, valor: c.faturamento, detalhe: c.perfil })),
    });
  }
  const altaSensibilidade = clientes.filter((c) => c.sensibilidade === 'ALTA');
  if (altaSensibilidade.length) {
    const valor = altaSensibilidade.reduce((s, c) => s + num(c.faturamento), 0);
    riscos.push({
      dimensao: 'Carteira', nivel: 'media',
      titulo: 'Clientes para quem o crédito passa a ser decisivo',
      exposicao: r2(valor), participacao: totalVendas ? valor / totalVendas : 0,
      itens: altaSensibilidade.length,
      descricao: 'Para esses clientes o crédito representa parcela relevante do preço projetado.',
      impacto: 'A comparação de propostas migra do preço de nota para o custo líquido. Um concorrente que gere crédito integral leva vantagem visível.',
      acao: 'Assegurar destaque correto de IBS/CBS e classificação fiscal precisa — erro aqui glosa o crédito do cliente e destrói a relação comercial.',
      evidencias: altaSensibilidade.slice(0, 8).map((c) => ({ contraparte: c.cliente, cnpj: c.cnpj, valor: c.faturamento, detalhe: `crédito entregue ${brl(c.creditoEntregue)}` })),
    });
  }

  // -------------------------------------------------------------- FLUXO
  const ap = resumo.apuracao;
  if (ap.ibs.saldo < 0 || ap.cbs.saldo < 0) {
    const acumulo = Math.abs(Math.min(ap.ibs.saldo, 0)) + Math.abs(Math.min(ap.cbs.saldo, 0));
    riscos.push({
      dimensao: 'Fluxo de caixa', nivel: 'media',
      titulo: 'Saldo credor projetado no período',
      exposicao: r2(acumulo), participacao: 0, itens: 0,
      descricao: `IBS ${brl(ap.ibs.saldo)} e CBS ${brl(ap.cbs.saldo)} no período analisado. IBS e CBS são apurados separadamente: saldo credor de um não compensa débito do outro.`,
      impacto: 'Saldo credor estrutural imobiliza caixa até a compensação ou o ressarcimento.',
      acao: 'Projetar o ciclo de recuperação e avaliar o efeito no capital de giro, especialmente se houver exportação na operação.',
      evidencias: [],
    });
  }

  // ------------------------------------------------------------ MARGEM
  const comp = resumo.comparacao;
  if (comp && comp.cargaAtual && comp.diferencaPerc !== null && Math.abs(comp.diferencaPerc) > 0.05) {
    const sobe = comp.diferenca > 0;
    riscos.push({
      dimensao: 'Margem', nivel: sobe ? nivelPor(Math.abs(comp.diferencaPerc), 1, 0.20, 0.08) : 'baixa',
      titulo: sobe ? 'Aumento projetado da carga tributária' : 'Redução projetada da carga tributária',
      exposicao: r2(Math.abs(comp.diferenca)), participacao: Math.abs(comp.diferencaPerc), itens: 0,
      descricao: `Carga atual identificada de ${brl(comp.cargaAtual)} contra ${brl(comp.cargaProjetada)} projetados — variação de ${pct(comp.diferencaPerc)}.`,
      impacto: sobe
        ? 'Sem reposicionamento de preço, a diferença sai da margem.'
        : 'Há espaço para política comercial ou repasse parcial do ganho ao cliente.',
      acao: sobe
        ? 'Simular o preço neutro por item no módulo de Precificação e planejar o reajuste em degraus ao longo da transição.'
        : 'Avaliar uso do ganho como diferencial competitivo, com cuidado para não consolidar preço antes da alíquota definitiva.',
      evidencias: [],
    });
  }

  const ordem = { alta: 0, media: 1, baixa: 2 };
  riscos.sort((a, b) => (ordem[a.nivel] - ordem[b.nivel]) || (b.exposicao - a.exposicao));

  return {
    ano: resumo.ano,
    riscos,
    sintese: {
      total: riscos.length,
      alta: riscos.filter((x) => x.nivel === 'alta').length,
      media: riscos.filter((x) => x.nivel === 'media').length,
      baixa: riscos.filter((x) => x.nivel === 'baixa').length,
      exposicaoTotal: r2(riscos.reduce((s, x) => s + x.exposicao, 0)),
      dimensoes: [...new Set(riscos.map((x) => x.dimensao))],
    },
    observacao: 'Os riscos derivam dos itens efetivamente importados. Ampliar a base de documentos analisados tende a alterar a exposição.',
  };
}

/** Limiares vindos de Configurações; os argumentos são apenas o padrão */
function nivelPor(valor, total, limiteAlto, limiteMedio) {
  const p = total ? valor / total : 0;
  limiteAlto = regras.limiar('risco_alto_participacao', limiteAlto);
  limiteMedio = regras.limiar('risco_medio_participacao', limiteMedio);
  if (p >= limiteAlto) return 'alta';
  if (p >= limiteMedio) return 'media';
  return 'baixa';
}

function topN(itens, n) {
  return [...itens].sort((a, b) => b.precoAtual - a.precoAtual).slice(0, n).map((x) => ({
    contraparte: x.contraparte, cnpj: x.cnpj, documento: x.documento,
    item: x.descricao, ncm: x.ncm || x.nbs, valor: x.precoAtual,
    detalhe: x.credito ? x.credito.motivo : '',
  }));
}

/** Converte os riscos em ações para o plano de adequação */
function acoesSugeridas(mapa) {
  return mapa.riscos.map((r) => ({
    origem: 'mapa de riscos (motor)',
    titulo: r.titulo,
    descricao: `${r.descricao} ${r.impacto} Ação: ${r.acao}`.trim(),
    prioridade: r.nivel === 'alta' ? 'alta' : r.nivel === 'media' ? 'media' : 'baixa',
  }));
}

module.exports = { montar, acoesSugeridas };
