/**
 * ETAPA 5 — camada analítica da cadeia
 *
 * Não recalcula IBS, CBS, crédito, classificação ou base econômica. Tudo é
 * consolidação de `executarCenario`, que por sua vez usa o motor oficial.
 */
const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r6 = (v) => Math.round(n(v) * 1e6) / 1e6;

const LIMIARES = Object.freeze({ baixo_ou_sem_credito: 0.20, simples: 0.10, indeterminado: 0.10, mudanca: 0.05 });

function grupo(composicao, lado, dimensao, chave) {
  return (((composicao[lado] || {})[dimensao] || {}).grupos || []).find((g) => g.grupo === chave)
    || { grupo: chave, valor: 0, participacao: 0, baseEconomica: 0, custoEfetivo: 0, creditoIbs: 0, creditoCbs: 0, itens: 0, entidades: 0 };
}
function grupos(composicao, lado, dimensao, chaves) {
  return chaves.map((x) => grupo(composicao, lado, dimensao, x));
}
function soma(lista, campo) { return lista.reduce((s, x) => s + n(x[campo]), 0); }
function indicador(chave, nome, valor, denominador, descricao, drilldown) {
  return { chave, nome, valor: r6(valor), denominador: r2(denominador), percentual: denominador ? r6(valor / denominador) : null, descricao, drilldown };
}

function indicadores(resultado) {
  const i = resultado.indicadores || {};
  const c = resultado.composicao || { compras:{}, vendas:{} };
  const compras = n(i.compras), receita = n(i.receita);
  const semCredito = grupos(c, 'compras', 'credito_fornecedor', ['sem_credito']);
  const baixoCredito = grupos(c, 'compras', 'credito_fornecedor', ['sem_credito', 'limitado', 'simples', 'presumido']);
  const simples = grupo(c, 'compras', 'regime_fornecedor', 'simples');
  const mei = grupo(c, 'compras', 'regime_fornecedor', 'mei');
  const indCredito = grupo(c, 'compras', 'credito_fornecedor', 'indeterminado');
  const indFornecedor = grupo(c, 'compras', 'regime_fornecedor', 'indeterminado');
  const indCliente = grupo(c, 'vendas', 'perfil_cliente', 'indeterminado');
  const sensiveis = grupos(c, 'vendas', 'sensibilidade_cliente', ['alta', 'media']);
  const base = resultado.base && resultado.base.indicadores;
  const delta = base ? n(i.custoEfetivoCompras) - n(base.custoEfetivoCompras) : null;
  const indice = resultado.indiceMudanca || { compras:0, vendas:0 };
  return {
    taxa_recuperacao_compras: indicador('taxa_recuperacao_compras', 'Taxa de recuperação das compras', n(i.creditoRecebido), compras, 'Crédito aproveitável sobre compras.', { lado:'compras', dimensao:'credito_fornecedor', grupos:['normal','limitado','simples','presumido'] }),
    exposicao_compras_sem_credito: indicador('exposicao_compras_sem_credito', 'Exposição a compras sem crédito', soma(semCredito,'valor'), compras, 'Compras cujo crédito foi apurado como sem direito.', { lado:'compras', dimensao:'credito_fornecedor', grupos:['sem_credito'] }),
    exposicao_baixo_credito: indicador('exposicao_baixo_credito', 'Exposição a baixo ou nenhum crédito', soma(baixoCredito,'valor'), compras, 'Compras em grupos de crédito limitado, Simples, presumido ou sem crédito.', { lado:'compras', dimensao:'credito_fornecedor', grupos:['limitado','simples','presumido','sem_credito'] }),
    exposicao_simples: indicador('exposicao_simples', 'Exposição ao Simples', n(simples.valor), compras, 'Compras de fornecedores do Simples Nacional.', { lado:'compras', dimensao:'regime_fornecedor', grupos:['simples'] }),
    exposicao_mei: indicador('exposicao_mei', 'Exposição ao MEI', n(mei.valor), compras, 'Compras de fornecedores MEI.', { lado:'compras', dimensao:'regime_fornecedor', grupos:['mei'] }),
    exposicao_credito_indeterminado: indicador('exposicao_credito_indeterminado', 'Exposição a crédito indeterminado', n(indCredito.valor), compras, 'Compras cujo crédito não pôde ser determinado.', { lado:'compras', dimensao:'credito_fornecedor', grupos:['indeterminado'] }),
    credito_entregue_sobre_receita: indicador('credito_entregue_sobre_receita', 'Crédito entregue sobre receita', n(i.creditoEntregue), receita, 'Crédito potencial associado às vendas; não reduz a CBS líquida do vendedor.', { lado:'vendas', dimensao:'perfil_cliente', grupos:['b2b_credito','b2b_sem_credito','b2c_pf','b2c_pj','governo','indeterminado'] }),
    exposicao_comercial_credito: indicador('exposicao_comercial_credito', 'Exposição comercial ao crédito', soma(sensiveis,'valor'), receita, 'Receita com clientes de sensibilidade alta ou média ao crédito.', { lado:'vendas', dimensao:'sensibilidade_cliente', grupos:['alta','media'] }),
    cobertura_cadastral_clientes: indicador('cobertura_cadastral_clientes', 'Cobertura cadastral de clientes', receita - n(indCliente.valor), receita, 'Receita com perfil de cliente conhecido.', { lado:'vendas', dimensao:'perfil_cliente', grupos:['indeterminado'] }),
    cobertura_cadastral_fornecedores: indicador('cobertura_cadastral_fornecedores', 'Cobertura cadastral de fornecedores', compras - n(indFornecedor.valor), compras, 'Compras com regime do fornecedor conhecido.', { lado:'compras', dimensao:'regime_fornecedor', grupos:['indeterminado'] }),
    delta_custo_efetivo: { chave:'delta_custo_efetivo', nome:'Delta de custo efetivo', valor: delta === null ? null : r2(delta), descricao:'Custo efetivo do cenário menos o custo efetivo da base.', drilldown:{ lado:'compras', dimensao:'credito_fornecedor', grupos:['normal','limitado','simples','presumido','sem_credito','indeterminado'] } },
    indice_mudanca_cadeia: { chave:'indice_mudanca_cadeia', nome:'Índice de mudança da cadeia', compras:r6(indice.compras), vendas:r6(indice.vendas), descricao:'Percentual alterado apenas por hipótese; não modifica dados originais.', drilldown:null },
  };
}

function alerta(id, titulo, texto, evidencia, drilldown, severidade = 'atencao') {
  return { id, titulo, texto, evidencia, drilldown, severidade, natureza:'CALCULADO' };
}
function alertas(resultado, inds) {
  const out = [];
  const p = (x) => `${(n(x) * 100).toFixed(1).replace('.', ',')}%`;
  const m = (x) => r2(x).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const baixo = inds.exposicao_baixo_credito;
  if (n(baixo.percentual) >= LIMIARES.baixo_ou_sem_credito) out.push(alerta('baixo_credito', 'Exposição a baixo ou nenhum crédito', `${p(baixo.percentual)} das compras estão concentradas em grupos com baixo ou nenhum crédito.`, baixo, baixo.drilldown));
  const simples = inds.exposicao_simples;
  if (n(simples.percentual) >= LIMIARES.simples) out.push(alerta('simples', 'Exposição ao Simples', `${p(simples.percentual)} das compras são realizadas com fornecedores do Simples.`, simples, simples.drilldown));
  const ind = inds.exposicao_credito_indeterminado;
  if (n(ind.percentual) >= LIMIARES.indeterminado) out.push(alerta('credito_indeterminado', 'Crédito indeterminado', `${p(ind.percentual)} das compras têm crédito indeterminado; este valor não foi convertido em crédito zero.`, ind, ind.drilldown, 'alto'));
  const mudanca = inds.indice_mudanca_cadeia;
  if (Math.max(n(mudanca.compras), n(mudanca.vendas)) >= LIMIARES.mudanca) out.push(alerta('mudanca_cadeia', 'Mudança relevante na cadeia', `O cenário altera ${p(Math.max(n(mudanca.compras), n(mudanca.vendas)))} da composição econômica da cadeia apenas por hipótese.`, mudanca, null));
  const e = resultado.efeitos && resultado.efeitos.compras;
  if (e && (Math.abs(n(e.efeitoCredito)) > 0.01 || Math.abs(n(e.efeitoLiquido)) > 0.01)) out.push(alerta('efeito_custo', 'Efeito econômico da hipótese', `O crédito variou ${m(e.efeitoCredito)}, o custo bruto projetado variou ${m(n(e.precoProjetadoCenario) - n(e.precoProjetadoBase))} e o ganho/perda no custo efetivo foi ${m(-n(e.efeitoLiquido))}.`, { credito_adicional:r2(e.efeitoCredito), custo_bruto:r2(n(e.precoProjetadoCenario) - n(e.precoProjetadoBase)), ganho_perda:r2(-n(e.efeitoLiquido)) }, { lado:'compras', dimensao:'credito_fornecedor', grupos:['normal','limitado','simples','presumido','sem_credito','indeterminado'] }, 'bom'));
  return out;
}

const VERTICAIS = [
  { chave:'alto_credito', nome:'Alto crédito', grupos:['normal'] },
  { chave:'credito_intermediario', nome:'Crédito intermediário', grupos:['limitado','simples','presumido'] },
  { chave:'baixo_credito', nome:'Baixo crédito', grupos:['sem_credito'] },
  { chave:'alta_indeterminacao', nome:'Alta indeterminação', grupos:['indeterminado'] },
];
const HORIZONTAIS = [
  { chave:'credito_relevante', nome:'Clientes com crédito relevante', grupos:['b2b_credito'] },
  { chave:'sem_credito_relevante', nome:'Clientes sem crédito relevante', grupos:['b2b_sem_credito','governo'] },
  { chave:'b2c', nome:'B2C', grupos:['b2c_pf','b2c_pj'] },
  { chave:'alta_indeterminacao', nome:'Alta indeterminação', grupos:['indeterminado'] },
];

function matriz(resultado) {
  const c = resultado.composicao;
  const i = resultado.indicadores;
  const compras = n(i.compras), receita = n(i.receita);
  const linhas = VERTICAIS.map((v) => {
    const pg = grupos(c,'compras','credito_fornecedor',v.grupos);
    const vp = soma(pg,'valor'), pp = compras ? vp / compras : 0;
    return { ...v, valor:r2(vp), participacao:r6(pp), celulas:HORIZONTAIS.map((h) => {
      const cg = grupos(c,'vendas','perfil_cliente',h.grupos);
      const vc = soma(cg,'valor'), pc = receita ? vc / receita : 0;
      // É uma matriz de exposição estratégica: sem chave que ligue cada
      // compra a cada venda, distribui medidas agregadas pelo peso dos dois
      // perfis. Não afirma relação transacional inexistente.
      const peso = pp * pc;
      return { vertical:v.chave, horizontal:h.chave, peso:r6(peso),
        margem: i.margem === null || i.margem === undefined ? null : r2(n(i.margem) * peso),
        custoEfetivo:r2(n(i.custoEfetivoCompras) * peso), creditoRecebido:r2(n(i.creditoRecebido) * peso),
        creditoEntregue:r2(n(i.creditoEntregue) * peso), exposicaoEconomica:r2((vp + vc) * peso),
        compras:r2(vp * pc), receita:r2(vc * pp),
        drilldown:{ compras:{ lado:'compras',dimensao:'credito_fornecedor',grupos:v.grupos }, vendas:{ lado:'vendas',dimensao:'perfil_cliente',grupos:h.grupos } }, natureza:'CALCULADO' };
    }) };
  });
  return { verticais:VERTICAIS, horizontais:HORIZONTAIS, linhas,
    observacao:'Matriz de exposição agregada: não há vínculo transacional presumido entre uma compra e uma venda. Os valores por quadrante são rateados pelos perfis das duas carteiras e reconciliam com os totais analíticos.' };
}

function analisar(resultado) {
  const inds = indicadores(resultado);
  return { indicadores:inds, alertas:alertas(resultado, inds), matriz:matriz(resultado), limiares:LIMIARES,
    origem:'motor_resultados via cenarioMotor', natureza:'CALCULADO' };
}
module.exports = { analisar, indicadores, alertas, matriz, LIMIARES, VERTICAIS, HORIZONTAIS };
