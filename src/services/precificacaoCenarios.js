/**
 * Ponte de leitura entre Cenários e Precificação.
 *
 * O catálogo A–H pertence ao módulo de Cenários. Esta camada não replica
 * premissas nem executa cálculo fiscal: apenas informa, por item, se cada
 * hipótese pode ser apresentada pela Precificação e qual dado falta quando
 * ainda não puder ser calculada.
 */
const templates = require('./cenarioTemplates');

function temSaida(item) {
  return Boolean(item && item.saida && item.saida.movimento_id);
}

function formacaoCompleta(item) {
  return Boolean(item && item.formacao && item.formacao.cobertura === 'COMPLETO');
}

function resposta(template, aplicavel, motivo = null) {
  return {
    chave: template.chave,
    codigo: template.codigo,
    nome: template.nome,
    descricao: template.descricao,
    base: Boolean(template.base),
    aplicavel,
    motivo_nao_aplicabilidade: aplicavel ? null : motivo,
  };
}

function aplicabilidadeDoItem(item, { regimeEmpresa = null } = {}) {
  const regime = String(regimeEmpresa || '').toLowerCase();
  const saidaDisponivel = temSaida(item);
  const custoCompleto = formacaoCompleta(item);

  return templates.listar().map((template) => {
    switch (template.chave) {
      case 'A_REFERENCIA':
        return resposta(template, saidaDisponivel,
          'A referência exige uma saída oficial vinculada ao item.');
      case 'B_SEM_ACAO':
        return resposta(template, saidaDisponivel,
          'O Impacto Final CBS exige resultado oficial do motor para a saída.');
      case 'C_PRESERVAR_PRECO':
        return resposta(template, saidaDisponivel,
          'A preservação de preço exige resultado oficial do motor para a saída.');
      case 'D_PRESERVAR_MARGEM':
        return resposta(template, saidaDisponivel && custoCompleto,
          !saidaDisponivel
            ? 'A preservação de margem exige uma saída oficial vinculada ao item.'
            : 'A preservação de margem exige formação de custo completa e conciliada.');
      case 'E_FORNECEDORES':
        return resposta(template, custoCompleto,
          'A otimização de fornecedores exige composição de custo completa e editável.');
      case 'F_B2B_SENSIVEL':
      case 'G_B2C':
        return resposta(template, saidaDisponivel,
          'O cenário de mercado exige uma saída oficial vinculada ao item.');
      case 'H_SIMPLES':
        return resposta(template, saidaDisponivel && regime.includes('simples'),
          !saidaDisponivel
            ? 'A comparação do Simples exige resultado oficial do motor para a saída.'
            : 'A comparação do Simples só é apresentada para empresa do Simples Nacional e após confirmação legal.');
      default:
        return resposta(template, false, 'Cenário sem regra de aplicabilidade definida.');
    }
  });
}

function impactosDoItem(item) {
  const saida = item && item.saida;
  const comercial = item && item.comercial;
  if (!saida) return null;
  return {
    preco_atual: saida.preco_atual ?? null,
    preco_base: saida.base_economica ?? null,
    cbs: saida.cbs ?? null,
    preco_final: saida.preco_projetado ?? null,
    margem_valor: comercial && comercial.margem_projetada != null ? comercial.margem_projetada : null,
    margem_percentual: comercial && comercial.margem_projetada_percentual != null ? comercial.margem_projetada_percentual : null,
    credito_cbs_precificavel: item.formacao && item.formacao.credito_cbs_precificavel != null
      ? item.formacao.credito_cbs_precificavel : null,
  };
}

function enriquecerItem(item, contexto) {
  return {
    ...item,
    cenarios: aplicabilidadeDoItem(item, contexto),
    impacto_final_cbs: impactosDoItem(item),
  };
}

module.exports = { aplicabilidadeDoItem, impactosDoItem, enriquecerItem };
