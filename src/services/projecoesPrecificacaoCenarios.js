/* Projeções comerciais derivadas do catálogo A–H; não calcula regra fiscal. */
const templates = require('./cenarioTemplates');
const motor = require('./motorPrecificacaoComercial');
const m = (v) => Math.round((Number(v || 0) + Number.EPSILON) * 100) / 100;

function variacao(valor, base) { return base == null ? null : m(valor - base); }
function projetar(entrada = {}) {
  const base = motor.calcular(entrada);
  const precoAtual = Number(entrada.preco_atual || 0);
  return templates.listar().map((tpl) => {
    if (tpl.chave === 'A_REFERENCIA') return { ...tpl, status:'REFERENCIA', preco_final:precoAtual, variacao_preco:0 };
    if (base.status !== 'CALCULATED') return { ...tpl, status:'INCOMPLETO', motivo:base.bloqueio };
    if (tpl.chave === 'B_SEM_ACAO') return { ...tpl, status:'CALCULATED', resultado:base, variacao_preco:variacao(base.preco_final,precoAtual) };
    if (tpl.chave === 'C_PRESERVAR_PRECO') {
      const divisorFiscal = 1 + Number(entrada.aliquota_efetiva_cbs || 0);
      const precoBase = divisorFiscal > 0 ? m(precoAtual / divisorFiscal) : null;
      return { ...tpl, status:'CALCULATED', resultado:{ ...base, preco_base:precoBase, cbs:m(precoAtual-precoBase), preco_final:precoAtual, margem_valor:m(precoBase - base.custo_liquido - precoBase * base.percentuais_por_dentro) }, variacao_preco:0 };
    }
    if (tpl.chave === 'D_PRESERVAR_MARGEM') return { ...tpl, status:'CALCULATED', resultado:base, variacao_preco:variacao(base.preco_final,precoAtual) };
    if (tpl.chave === 'H_SIMPLES' && !entrada.confirmar_simples) return { ...tpl, status:'REQUER_CONFIRMACAO', motivo:'A comparação do Simples exige confirmação explícita de cabimento.' };
    return { ...tpl, status:'REQUER_PREMISSA', motivo:'Este cenário depende de premissas editáveis do módulo de Cenários.' };
  });
}
module.exports = { projetar };
