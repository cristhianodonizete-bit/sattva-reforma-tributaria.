/**
 * MOTOR DE CENÁRIOS — orquestração, não cálculo tributário
 * ---------------------------------------------------------------------------
 * Esta camada NÃO calcula tributo. Ela decide QUE contexto cada item recebe e
 * chama os motores que já existem. Toda regra tributária continua em
 * engine/classificador, engine/reconstrucao e engine/motor.
 *
 * O PIPELINE
 *
 *   dados detalhados
 *      ↓
 *   classificação (calculada uma vez, cacheada — invariante sob premissa)
 *      ↓
 *   motores → resultado base
 *      ↓
 *   agregação em dimensões  → composição percentual
 *      ↓
 *   premissas percentuais do consultor
 *      ↓
 *   EXPANSÃO em overrides por item          ← a dobra de volta ao detalhe
 *      ↓
 *   motores DE NOVO (mesmos motores, ctx diferente)
 *      ↓
 *   resultado do cenário → agregação → comparação → drill-down
 *
 * A EXPANSÃO PROPORCIONAL
 *
 * "Migrar 40% do grupo Simples" não escolhe quais fornecedores migram: cada
 * item do grupo migra 40% do seu VALOR. Um item de R$ 10.000 vira duas linhas
 * virtuais — R$ 6.000 na origem e R$ 4.000 no destino — mantendo NCM,
 * classificação e tratamento. Assim o mix tributário do grupo é preservado
 * exatamente, o resultado é determinístico e reconcilia com o waterfall.
 *
 * PRECEDÊNCIA
 *
 *   individual > grupo > global > dado original
 *
 * Cada campo do ctx registra qual nível o determinou, e isso viaja até a
 * memória de cálculo.
 */
const db = require('../db');
const motor = require('../engine/motor');
const motorExec = require('./motorExec');
const dimensoes = require('./dimensoes');
const regras = require('./regras');
const { simplesEfetivo } = require('../engine/reconstrucao');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r6 = (n) => Math.round((Number(n) || 0) * 1e6) / 1e6;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// ==========================================================================
// 1. CENÁRIO BASE — a fotografia econômica atual, imutável
// ==========================================================================
function obterOuCriarBase(empresaId, ano) {
  let base = db.prepare(`SELECT * FROM cenarios WHERE empresa_id = ? AND tipo = 'base' AND ano = ?`)
    .get(empresaId, Number(ano));
  if (!base) {
    const r = db.prepare(`INSERT INTO cenarios (empresa_id, nome, descricao, tipo, versao, ano, status)
      VALUES (?,?,?, 'base', 0, ?, 'rascunho')`)
      .run(empresaId, `Cenário base ${ano}`,
        'Fotografia econômica atual, construída apenas com os dados importados. Imutável.', Number(ano));
    base = db.prepare('SELECT * FROM cenarios WHERE id = ?').get(r.lastInsertRowid);
  }
  return base;
}

/**
 * Executa os motores e devolve o resultado base já classificado em dimensões.
 * O resultado do motor é o insumo da agregação — nunca o contrário.
 */
function calcularBase(empresaId, ano, opcoes = {}) {
  const r = motorExec.executar(empresaId, { ano, gravar: false });
  // Os motores projetam a partir do MOVIMENTO BRUTO, não do resultado. Para
  // recalcular o cenário é preciso guardar o insumo original indexado — o
  // resultado é saída, nunca entrada.
  const brutos = new Map();
  for (const m of db.prepare('SELECT * FROM movimentos WHERE empresa_id = ?').all(empresaId)) {
    brutos.set(m.id, motorExec.normalizar(m));
  }
  const entradas = r.entradas.map((x) => ({ ...x, fracao: 1, grupos: dimensoes.classificarItem(x, 'compras') }));
  const saidas = r.saidas.map((x) => ({ ...x, fracao: 1, grupos: dimensoes.classificarItem(x, 'vendas') }));
  const formacaoPorSaida = carregarFormacaoCusto(empresaId, entradas);
  return {
    empresa: r.empresa, ano: r.ano, resumo: r.resumo, apuracao: r.apuracao,
    entradas, saidas, brutos, formacaoPorSaida,
    composicao: {
      compras: dimensoes.compor(entradas, 'compras'),
      vendas: dimensoes.compor(saidas, 'vendas'),
    },
    indicadores: calcularIndicadores(entradas, saidas, { ...r, formacaoPorSaida }),
  };
}

/** Reúne apenas custo explicitamente vinculado; não há associação por NCM/NBS. */
function carregarFormacaoCusto(empresaId, entradas) {
  const porMovimento = new Map(entradas.map((x) => [Number(x.movimento_id), x]));
  const itens = db.prepare(`SELECT * FROM formacao_custo_itens
    WHERE empresa_id=? AND ativo=1 AND movimento_saida_id IS NOT NULL`).all(empresaId);
  const componentes = db.prepare(`SELECT * FROM formacao_custo_componentes
    WHERE item_formacao_id=? ORDER BY id`);
  const mapa = new Map();
  for (const item of itens) {
    let custoBruto = 0, credito = 0, completo = Boolean(item.movimento_saida_id);
    const cs = componentes.all(item.id);
    if (!cs.length) completo = false;
    for (const c of cs) {
      const entrada = porMovimento.get(Number(c.movimento_id));
      if (!entrada || c.relacionamento === 'NAO_RELACIONADA') { completo = false; continue; }
      const fracao = c.status_alocacao_credito === 'RATEAVEL' ? num(c.percentual_rateio) : 1;
      if (c.status_alocacao_credito === 'RATEAVEL' && !(fracao > 0 && fracao <= 1)) { completo = false; continue; }
      const creditoItem = num(entrada.creditoCbs) + num(entrada.creditoIbs);
      custoBruto += (num(entrada.custoLiquido) + creditoItem) * fracao;
      if (['DIRETO', 'RATEAVEL'].includes(c.status_alocacao_credito)) credito += creditoItem * fracao;
    }
    mapa.set(Number(item.movimento_saida_id), {
      status: completo ? 'COMPLETO' : 'INCOMPLETO',
      custoLiquido: r2(custoBruto - credito), despesasVariaveis: num(item.despesas_variaveis),
    });
  }
  return mapa;
}

/** Persiste a composição do cenário para comparação posterior */
function gravarComposicao(cenarioId, composicao) {
  db.prepare('DELETE FROM cenario_composicao WHERE cenario_id = ?').run(cenarioId);
  const ins = db.prepare(`INSERT INTO cenario_composicao (cenario_id, lado, dimensao, grupo,
    valor, participacao, itens, entidades, base_economica, ibs, cbs, credito_ibs, credito_cbs,
    custo_efetivo, natureza) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const lado of ['compras', 'vendas']) {
      for (const d of Object.values(composicao[lado] || {})) {
        for (const g of d.grupos) {
          ins.run(cenarioId, lado, d.dimensao, g.grupo, r2(g.valor), r6(g.participacao),
            g.itens, g.entidades, r2(g.baseEconomica), r2(g.ibs), r2(g.cbs),
            r2(g.creditoIbs), r2(g.creditoCbs), r2(g.custoEfetivo), g.natureza);
        }
      }
    }
  })();
}

// ==========================================================================
// 2. PREMISSAS — resolução com precedência
// ==========================================================================
/**
 * Monta o ctx de um item aplicando as premissas na ordem de precedência.
 * Devolve também a TRILHA: qual nível determinou cada campo. É isso que
 * torna a precedência visível na memória, como pedido.
 */
function resolverPremissas(item, lado, premissas, originais = {}) {
  const ctx = {};
  const trilha = {};
  const resolucao = {};
  const candidatas = new Map();
  const pertinente = (p) => {
    if (p.nivel === 'global') return !p.lado || p.lado === lado;
    if (p.nivel === 'grupo') return p.lado === lado && item.grupos && item.grupos[p.dimensao] === p.grupo;
    return p.nivel === 'individual' && p.lado === lado
      && ((p.entidade_tipo === 'parceiro' && String(p.entidade_id) === String(item.cnpj))
        || (p.entidade_tipo === 'movimento' && String(p.entidade_id) === String(item.movimento_id)));
  };
  // Ordenação torna o resultado reprodutível mesmo se houver registros antigos
  // duplicados no mesmo escopo. A última inclusão é a mais recente e vence
  // apenas dentro daquele mesmo nível; entre níveis a ordem é fixa.
  const porNivel = ['global', 'grupo', 'individual'];
  for (const nivel of porNivel) {
    premissas.filter((p) => p.nivel === nivel && pertinente(p))
      .sort((a, b) => Number(a.id || 0) - Number(b.id || 0))
      .forEach((p) => {
        if (!candidatas.has(p.campo)) candidatas.set(p.campo, {});
        candidatas.get(p.campo)[nivel] = p;
      });
  }
  for (const [campo, niveis] of candidatas.entries()) {
    const vencedora = niveis.individual || niveis.grupo || niveis.global;
    const nivel = niveis.individual ? 'individual' : niveis.grupo ? 'grupo' : 'global';
    const valorEfetivo = converter(campo, vencedora.valor_simulado);
    ctx[campo] = valorEfetivo;
    trilha[campo] = { nivel, valor: vencedora.valor_simulado, premissa_id: vencedora.id,
      justificativa: vencedora.justificativa || '', natureza: vencedora.natureza || 'SIMULADO' };
    const detalhe = (p) => p ? { id: p.id || null, valor: converter(campo, p.valor_simulado),
      justificativa: p.justificativa || '', natureza: p.natureza || 'SIMULADO' } : null;
    resolucao[campo] = {
      valor_original: Object.prototype.hasOwnProperty.call(originais, campo) ? originais[campo] : (item[campo] ?? null),
      premissa_global: detalhe(niveis.global),
      premissa_grupo: detalhe(niveis.grupo),
      premissa_individual: detalhe(niveis.individual),
      valor_efetivo: valorEfetivo,
      nivel_precedencia_aplicado: nivel,
      origem_da_premissa: vencedora.fonte || nivel,
      natureza: vencedora.natureza || 'SIMULADO',
    };
  }
  return { ctx, trilha, resolucao };
}

function converter(campo, valor) {
  if (['variacao_preco', 'grau_repasse', 'rbt12'].includes(campo)) return Number(valor);
  if (['hibrido'].includes(campo)) return valor === '1' || valor === 'true';
  return valor;
}

// ==========================================================================
// 3. EXPANSÃO — premissas percentuais viram overrides por item
// ==========================================================================
/**
 * Aplica as alocações (migrações percentuais) sobre a lista de itens do base,
 * devolvendo uma lista EXPANDIDA onde os itens afetados aparecem partidos em
 * frações. Nenhum dado original é alterado: a fração é um atributo da linha
 * virtual do cenário.
 *
 * Regras aplicadas:
 *  - migração só ocorre dentro da mesma dimensão (garante soma 100%)
 *  - percentual do grupo entre 0 e 1
 *  - migrações acumuladas sobre o mesmo grupo de origem não podem passar de 100%
 */
function expandir(itens, lado, alocacoes, premissas = []) {
  // Itens cobertos por premissa individual que fixa o mesmo campo da migração
  // não são partidos: a exceção vale para o item inteiro. Sem isso o
  // fornecedor apareceria dividido em duas linhas que voltam ao mesmo grupo.
  const excecoes = new Set(premissas
    .filter((p) => p.nivel === 'individual' && p.campo === 'regime'
      && (!p.lado || p.lado === lado))
    .map((p) => `${p.entidade_tipo}|${p.entidade_id}`));
  const temExcecao = (item) => excecoes.has(`parceiro|${item.cnpj}`)
    || excecoes.has(`movimento|${item.movimento_id}`);
  const doLado = alocacoes.filter((a) => a.lado === lado);
  if (!doLado.length) return { itens: itens.map((x) => ({ ...x })), migracoes: [] };

  // validação: soma das migrações por (dimensão, grupo origem) ≤ 100%
  const acumulado = new Map();
  for (const a of doLado) {
    const k = `${a.dimensao}|${a.grupo_origem}`;
    const total = (acumulado.get(k) || 0) + num(a.percentual_grupo);
    if (total > 1.0000001) {
      throw new Error(`As migrações do grupo "${a.grupo_origem}" somam ${(total * 100).toFixed(1)}% — não é possível migrar mais do que o próprio grupo.`);
    }
    acumulado.set(k, total);
  }

  const saida = [];
  const migracoes = [];

  for (const item of itens) {
    if (temExcecao(item)) { saida.push({ ...item, excecao_individual: true }); continue; }
    // quanto deste item migra, e para onde
    const partes = [];
    let restante = 1;

    for (const a of doLado) {
      if (!item.grupos || item.grupos[a.dimensao] !== a.grupo_origem) continue;
      const f = Math.max(0, Math.min(1, num(a.percentual_grupo)));
      if (!f) continue;
      partes.push({ alocacao: a, fracao: f });
      restante -= f;
    }

    if (!partes.length) { saida.push({ ...item }); continue; }

    // parcela que permanece na origem
    if (restante > 0.0000001) {
      saida.push({ ...item, fracao: r6(restante), origem_migracao: null });
    }

    // parcelas migradas — mantêm NCM, classificação e tratamento
    for (const p of partes) {
      const a = p.alocacao;
      const novo = {
        ...item,
        fracao: r6(p.fracao),
        grupos: { ...item.grupos, [a.dimensao]: a.grupo_destino },
        migracao: {
          dimensao: a.dimensao, de: a.grupo_origem, para: a.grupo_destino,
          percentualGrupo: num(a.percentual_grupo),
          variacaoPreco: num(a.variacao_preco),
          alocacao_id: a.id,
        },
      };
      saida.push(novo);
      migracoes.push({ movimento_id: item.movimento_id, cnpj: item.cnpj,
        valorOriginal: num(item.precoAtual), valorMigrado: r2(num(item.precoAtual) * p.fracao),
        ...novo.migracao });
    }
  }
  return { itens: saida, migracoes };
}

/**
 * Traduz o grupo de destino em atributos concretos que os motores entendem.
 * Migrar para "regular" significa projetar o item como se o fornecedor
 * apurasse pelo regime regular — o motor de crédito faz o resto.
 */
const DESTINO_PARA_REGIME = {
  regular: 'regime_regular',
  simples: 'simples_nacional',
  mei: 'mei',
  nao_contribuinte: 'pessoa_fisica',
};
const DESTINO_PARA_PERFIL = {
  b2b_credito: 'lucro_real',
  b2b_sem_credito: 'simples_nacional',
  b2c_pf: 'pessoa_fisica',
  b2c_pj: 'imune_isento',
  governo: 'orgao_publico',
};

// ==========================================================================
// 4. RECÁLCULO — os mesmos motores, com ctx diferente
// ==========================================================================
function recalcular(base, lado, itensExpandidos, premissas) {
  const empresa = base.empresa;
  const brutos = base.brutos || new Map();
  const ano = base.ano;
  const sentido = lado === 'compras' ? 'entrada' : 'saida';
  const tabelasSimples = motor.anexosSimples();
  const saida = [];

  for (const item of itensExpandidos) {
    const regimeOriginal = lado === 'compras' ? item.regimeEmitente : item.regimeAdquirente;
    const { ctx: over, trilha, resolucao } = resolverPremissas(item, lado, premissas, {
      regime: regimeOriginal || null,
      variacao_preco: 0,
      rbt12: item.simples?.rbt12 || null,
      anexo_simples: item.simples?.anexo || null,
      hibrido: false,
      grau_repasse: null,
      estrategia_preco: null,
    });
    const mig = item.migracao;

    // --- regime da contraparte: migração > premissa > dado original
    let regimeContraparte = regimeOriginal;
    if (over.regime) { regimeContraparte = over.regime; }
    // A migração é premissa de GRUPO. A premissa INDIVIDUAL tem precedência
    // sobre ela — é isso que permite dizer "migre 40% do grupo, mas este
    // fornecedor específico permanece".
    const individualRegime = over.regime && trilha.regime && trilha.regime.nivel === 'individual';
    if (mig && !individualRegime) {
      const novo = lado === 'compras'
        ? DESTINO_PARA_REGIME[mig.para]
        : DESTINO_PARA_PERFIL[mig.para];
      if (novo) {
        regimeContraparte = novo;
        trilha.regime = { nivel: 'migração (grupo)', valor: novo, natureza: 'SIMULADO',
          justificativa: `migrado de ${mig.de} para ${mig.para} (${(mig.percentualGrupo * 100).toFixed(0)}% do grupo)` };
      }
    } else if (mig && individualRegime) {
      trilha.regime.justificativa = `${trilha.regime.justificativa || ''} — premissa individual prevaleceu sobre a migração do grupo "${mig.de}" → "${mig.para}"`.trim();
      trilha.migracao_ignorada = { nivel: 'grupo', valor: `${mig.de} → ${mig.para}`,
        natureza: 'SIMULADO', justificativa: 'sobreposta por premissa individual',
        // texto pronto para a interface — o técnico fica na chave, o legível aqui
        texto: 'A premissa do grupo não foi aplicada a este fornecedor porque existe uma premissa individual com maior precedência.' };
    }

    // --- faixa do Simples: premissa explícita, senão intervalo (nunca arbitrar)
    let simplesEmitente = null;
    if (regimeContraparte === 'simples_nacional' || regimeContraparte === 'mei') {
      const rbt = over.rbt12 || (item.simples && item.simples.rbt12);
      if (rbt) {
        simplesEmitente = simplesEfetivo(over.anexo_simples || 'III', rbt, tabelasSimples);
        simplesEmitente.origem = over.rbt12 ? 'faturamento informado no cenário' : 'faturamento conhecido';
      }
    }

    // --- preço: constante por padrão; variação é premissa explícita
    // Premissa explícita (individual > grupo > global) é independente da
    // migração. A variação informada na migração é apenas o fallback do grupo.
    const temPremissaPreco = Object.prototype.hasOwnProperty.call(over, 'variacao_preco');
    const variacao = temPremissaPreco ? num(over.variacao_preco) : (mig ? num(mig.variacaoPreco) : 0);
    // insumo do motor: o movimento original, nunca o resultado anterior
    const bruto = brutos.get(item.movimento_id) || item;
    const itemAjustado = variacao ? ajustarPreco(bruto, variacao) : bruto;
    if (variacao) {
      trilha.preco = { nivel: temPremissaPreco ? trilha.variacao_preco.nivel : (mig ? 'migração (grupo)' : 'original'),
        valor: `${(variacao * 100).toFixed(2)}%`, natureza: temPremissaPreco ? trilha.variacao_preco.natureza : 'SIMULADO',
        justificativa: temPremissaPreco ? (trilha.variacao_preco.justificativa || 'variação de preço definida por premissa')
          : 'variação de preço bruto informada na migração do grupo' };
    }

    // Sem premissa de perfil, o cenário preserva exatamente o destinatário
    // determinado no cenário-base. Reconsultar apenas pelo CNPJ/regime aqui
    // perderia a classificação já disponível na operação e transformaria uma
    // carteira conhecida em "indeterminada".
    const perfilAlterado = lado === 'vendas' && Boolean((mig && DESTINO_PARA_PERFIL[mig.para]) || over.regime);
    const destinatarioCenario = lado === 'vendas'
      ? (!perfilAlterado && item.destinatario
        ? item.destinatario
        : motor.classificarDestinatario({ regime: regimeContraparte, cnpj: item.cnpj }))
      : null;

    const contextoMotor = {
      empresa, sentido, ano,
      regimeContraparte,
      perfilDestinatario: destinatarioCenario ? destinatarioCenario.perfil : undefined,
      simplesEmitente,
      hibrido: over.hibrido || false,
      grauRepasse: over.grau_repasse,
    };
    let proj = motor.projetarItem(itemAjustado, contextoMotor);

    // Estratégias C e D não calculam tributos: procuram um preço de entrada
    // e chamam repetidamente o MESMO motor oficial para obter a saída fiscal.
    // Sem formação de custo completa, D não altera preço e deixa a cobertura
    // comercial explícita no indicador, em vez de supor custo zero.
    if (lado === 'vendas' && over.estrategia_preco) {
      const estrategia = over.estrategia_preco;
      const formacao = base.formacaoPorSaida && base.formacaoPorSaida.get(Number(item.movimento_id));
      const atual = motor.projetarItem(bruto, contextoMotor);
      let alvo = null;
      if (estrategia === 'PRESERVAR_PRECO_FINAL') alvo = { tipo: 'preco', valor: num(atual.precoAtual) };
      if (estrategia === 'PRESERVAR_MARGEM' && formacao && formacao.status === 'COMPLETO') {
        alvo = { tipo: 'margem', valor: num(atual.baseEconomica) - num(formacao.custoLiquido) - num(atual.precoAtual) * num(formacao.despesasVariaveis) };
      }
      if (alvo) {
        proj = resolverPrecoPorObjetivo(bruto, contextoMotor, alvo, formacao);
        trilha.estrategia_preco = { ...(trilha.estrategia_preco || {}),
          justificativa: `${trilha.estrategia_preco?.justificativa || ''} — preço resolvido pelo motor oficial`.trim() };
      } else if (estrategia === 'PRESERVAR_MARGEM') {
        trilha.estrategia_preco = { ...(trilha.estrategia_preco || {}),
          justificativa: `${trilha.estrategia_preco?.justificativa || ''} — sem formação de custo completa; preço não foi inferido`.trim(),
          status: 'INCOMPLETO' };
      }
    }

    // proporcionaliza os valores monetários pela fração da linha virtual
    const f = item.fracao === undefined ? 1 : item.fracao;
    const escalado = escalar(proj, f);

    if (lado === 'vendas') {
      const d = destinatarioCenario;
      escalado.destinatario = d;
      escalado.sensibilidade = motor.sensibilidadeCredito({
        perfil: d.perfil, credita: d.credita, credito: proj.credito, projecao: proj });
    }

    escalado.fracao = f;
    escalado.movimento_id = item.movimento_id;
    escalado.migracao = mig || null;
    escalado.premissas = trilha;
    escalado.resolucaoPremissas = resolucao;
    escalado.natureza = Object.keys(trilha).length || mig ? 'SIMULADO' : proj.natureza;
    escalado.grupos = dimensoes.classificarItem(escalado, lado);
    saida.push(escalado);
  }
  return saida;
}

function ajustarPreco(item, variacao) {
  const fator = 1 + variacao;
  const esc = (v) => (v === undefined || v === null ? v : num(v) * fator);
  return {
    ...item,
    valor: esc(item.valor),
    base_calculo: esc(item.base_calculo),
    icms: esc(item.icms), iss: esc(item.iss), pis: esc(item.pis),
    cofins: esc(item.cofins), ipi: esc(item.ipi), icms_st: esc(item.icms_st),
  };
}

function resolverPrecoPorObjetivo(bruto, contexto, alvo, formacao) {
  const valorOriginal = Math.max(0.01, num(bruto.valor));
  let baixo = 0, alto = 3, melhor = motor.projetarItem(bruto, contexto);
  const medida = (p) => alvo.tipo === 'preco'
    ? num(p.precoProjetado)
    : num(p.baseEconomica) - num(formacao.custoLiquido) - num(p.precoProjetado) * num(formacao.despesasVariaveis);
  // Expande limite só quando necessário; continua determinístico e não cria
  // percentual tributário nem altera qualquer classificação fiscal.
  while (medida(motor.projetarItem(ajustarPreco(bruto, alto - 1), contexto)) < alvo.valor && alto < 20) alto *= 2;
  for (let i = 0; i < 28; i++) {
    const fator = (baixo + alto) / 2;
    const candidato = motor.projetarItem(ajustarPreco(bruto, fator - 1), contexto);
    melhor = candidato;
    if (medida(candidato) < alvo.valor) baixo = fator; else alto = fator;
  }
  return melhor;
}

/** Aplica a fração aos valores monetários, preservando percentuais e status */
function escalar(proj, f) {
  if (f === 1) return { ...proj };
  const campos = ['precoAtual', 'baseEconomica', 'ibs', 'cbs', 'totalIvA',
    'creditoIbs', 'creditoCbs', 'creditoTotal', 'precoProjetado', 'custoLiquido'];
  const out = { ...proj };
  campos.forEach((c) => { if (out[c] !== undefined) out[c] = r2(num(out[c]) * f); });
  if (out.reconstrucao) {
    out.reconstrucao = { ...out.reconstrucao,
      precoAtual: r2(num(out.reconstrucao.precoAtual) * f),
      baseEconomica: r2(num(out.reconstrucao.baseEconomica) * f),
      retiradosDaBase: r2(num(out.reconstrucao.retiradosDaBase) * f) };
  }
  return out;
}

// ==========================================================================
// 5. INDICADORES
// ==========================================================================
/**
 * Separa o crédito em três naturezas. Ausência de informação NUNCA vira zero:
 * quando o regime do adquirente é desconhecido, o crédito é INDETERMINADO —
 * não sabemos se existe, e afirmar zero seria uma conclusão econômica que os
 * dados não sustentam.
 */
function decomporCredito(lista) {
  const conf = { valor: 0, credito: 0, itens: 0 };
  const sim = { valor: 0, credito: 0, itens: 0 };
  const ind = { valor: 0, itens: 0 };
  const semDireito = { valor: 0, itens: 0 };

  for (const x of lista) {
    const st = x.credito && x.credito.status;
    const v = num(x.precoAtual);
    const c = num(x.creditoTotal);
    if (['DADOS_INSUFICIENTES', 'SUJEITO_VALIDACAO'].includes(st)) { ind.valor += v; ind.itens++; continue; }
    if (st === 'SEM_DIREITO') { semDireito.valor += v; semDireito.itens++; continue; }
    if (x.natureza === 'SIMULADO') { sim.valor += v; sim.credito += c; sim.itens++; }
    else { conf.valor += v; conf.credito += c; conf.itens++; }
  }
  const total = conf.valor + sim.valor + ind.valor + semDireito.valor;
  const pc = (v) => (total ? r6(v / total) : 0);
  return {
    confirmado: { valor: r2(conf.valor), credito: r2(conf.credito), itens: conf.itens, participacao: pc(conf.valor), natureza: 'CALCULADO' },
    simulado: { valor: r2(sim.valor), credito: r2(sim.credito), itens: sim.itens, participacao: pc(sim.valor), natureza: 'SIMULADO' },
    semDireito: { valor: r2(semDireito.valor), credito: 0, itens: semDireito.itens, participacao: pc(semDireito.valor), natureza: 'CALCULADO',
      observacao: 'Crédito zero apurado: o adquirente não se apropria de IBS/CBS. Zero aqui é conclusão, não ausência de dado.' },
    indeterminado: { valor: r2(ind.valor), credito: null, itens: ind.itens, participacao: pc(ind.valor), natureza: 'INDETERMINADO',
      observacao: 'NÃO DETERMINADO — falta informação para afirmar se há crédito. Não é zero.' },
    cobertura: pc(conf.valor + sim.valor + semDireito.valor),
    total: r2(total),
  };
}

function calcularIndicadores(entradas, saidas, r) {
  const soma = (l, f) => l.reduce((s, x) => s + num(f(x)), 0);
  const compras = soma(entradas, (x) => x.precoAtual);
  const receita = soma(saidas, (x) => x.precoAtual);
  const creditoRecebido = soma(entradas, (x) => x.creditoTotal);
  const creditoEntregue = soma(saidas, (x) => x.creditoTotal);

  const porGrupo = (lista, dim, chaves) => soma(
    lista.filter((x) => x.grupos && chaves.includes(x.grupos[dim])), (x) => x.precoAtual);

  const semCredito = porGrupo(entradas, 'credito_fornecedor', ['sem_credito']);
  const indetCompra = porGrupo(entradas, 'credito_fornecedor', ['indeterminado']);
  const simples = porGrupo(entradas, 'regime_fornecedor', ['simples']);
  const mei = porGrupo(entradas, 'regime_fornecedor', ['mei']);
  const regimeIndet = porGrupo(entradas, 'regime_fornecedor', ['indeterminado']);
  const sensiveis = porGrupo(saidas, 'sensibilidade_cliente', ['alta', 'media']);
  const perfilIndet = porGrupo(saidas, 'perfil_cliente', ['indeterminado']);

  const pct = (v, t) => (t ? r6(v / t) : 0);
  const recebido = decomporCredito(entradas);
  const entregue = decomporCredito(saidas);
  const baseEconomicaSaidas = soma(saidas, (x) => x.baseEconomica);
  const baseEconomicaEntradas = soma(entradas, (x) => x.baseEconomica);
  const receitaProjetada = soma(saidas, (x) => x.precoProjetado);
  const comprasProjetadas = soma(entradas, (x) => x.precoProjetado);
  const operacoesSaida = saidas.length;
  const margem = calcularMargemConhecida(saidas, r && r.formacaoPorSaida);
  const apuracao = r ? r.apuracao : null;
  // Não é fluxo de caixa financeiro (não há prazos de recebimento/pagamento
  // na fonte). É a disponibilidade operacional da cadeia antes de prazo,
  // por isso só é exibida se a margem tiver composição de custo completa.
  const caixaOperacional = margem.cobertura === 1 && apuracao
    ? r2(receitaProjetada - comprasProjetadas - num(apuracao.cargaLiquida)) : null;
  return {
    compras: r2(compras), receita: r2(receita),
    creditoRecebido: r2(creditoRecebido), creditoEntregue: r2(creditoEntregue),
    // decomposição por natureza — a interface deve exibir esta, não o total seco
    creditoRecebidoDetalhe: recebido,
    creditoEntregueDetalhe: entregue,
    coberturaAnaliseCompras: recebido.cobertura,
    coberturaAnaliseVendas: entregue.cobertura,
    taxaRecuperacao: pct(creditoRecebido, compras),
    exposicaoSemCredito: pct(semCredito, compras),
    exposicaoSimples: pct(simples, compras),
    exposicaoMei: pct(mei, compras),
    exposicaoCreditoIndeterminado: pct(indetCompra, compras),
    creditoEntregueSobreReceita: pct(creditoEntregue, receita),
    exposicaoComercialCredito: pct(sensiveis, receita),
    coberturaCadastralFornecedores: pct(compras - regimeIndet, compras),
    coberturaCadastralClientes: pct(receita - perfilIndet, receita),
    custoEfetivoCompras: r2(soma(entradas, (x) => x.custoLiquido)),
    receitaProjetada: r2(receitaProjetada), comprasProjetadas: r2(comprasProjetadas),
    precoMedio: operacoesSaida ? r2(receitaProjetada / operacoesSaida) : null,
    baseEconomicaSaidas: r2(baseEconomicaSaidas), baseEconomicaEntradas: r2(baseEconomicaEntradas),
    margem: margem.valor, coberturaMargem: margem.cobertura,
    caixaOperacional, statusCaixa: caixaOperacional === null ? 'INCOMPLETO' : 'CALCULADO',
    apuracao: r ? r.apuracao : null,
  };
}

/**
 * Margem é comercial, não fiscal. Só agrega saídas que têm formação de custo
 * explícita e completa; as demais permanecem fora do número e reduzem a
 * cobertura. Isso evita transformar ausência de custo em margem positiva.
 */
function calcularMargemConhecida(saidas, formacaoPorSaida) {
  if (!formacaoPorSaida) return { valor: null, cobertura: 0, itensCobertos: 0, itens: saidas.length };
  let valor = 0, cobertos = 0;
  for (const x of saidas) {
    const f = formacaoPorSaida.get(Number(x.movimento_id));
    if (!f || f.status !== 'COMPLETO') continue;
    const fracao = num(x.fracao === undefined ? 1 : x.fracao);
    const custo = num(f.custoLiquido) * fracao;
    const despesa = num(x.precoProjetado) * num(f.despesasVariaveis);
    valor += num(x.baseEconomica) - custo - despesa;
    cobertos++;
  }
  return { valor: cobertos ? r2(valor) : null, cobertura: saidas.length ? r6(cobertos / saidas.length) : 0,
    itensCobertos: cobertos, itens: saidas.length };
}

// ==========================================================================
// 6. EXECUÇÃO DE UM CENÁRIO
// ==========================================================================
function executarCenario(cenarioId) {
  const cen = db.prepare('SELECT * FROM cenarios WHERE id = ?').get(cenarioId);
  if (!cen) throw new Error('Cenário não encontrado.');
  if (cen.tipo === 'base') {
    const base = calcularBase(cen.empresa_id, cen.ano);
    gravarComposicao(cen.id, base.composicao);
    marcarCalculado(cen.id, base);
    return { cenario: cen, ...base, migracoes: [], eBase: true };
  }

  const base = calcularBase(cen.empresa_id, cen.ano);
  const premissas = db.prepare('SELECT * FROM cenario_premissas WHERE cenario_id = ?').all(cenarioId);
  const alocacoes = db.prepare('SELECT * FROM cenario_alocacoes WHERE cenario_id = ?').all(cenarioId);

  const expCompras = expandir(base.entradas, 'compras', alocacoes, premissas);
  const expVendas = expandir(base.saidas, 'vendas', alocacoes, premissas);

  const entradas = recalcular(base, 'compras', expCompras.itens, premissas);
  const saidas = recalcular(base, 'vendas', expVendas.itens, premissas);

  const apuracao = motor.apurar(saidas, entradas);
  const composicao = {
    compras: dimensoes.compor(entradas, 'compras'),
    vendas: dimensoes.compor(saidas, 'vendas'),
  };
  const indicadores = calcularIndicadores(entradas, saidas, { apuracao, formacaoPorSaida: base.formacaoPorSaida });
  const resultado = {
    cenario: cen, empresa: base.empresa, ano: cen.ano,
    entradas, saidas, apuracao, composicao, indicadores,
    migracoes: [...expCompras.migracoes, ...expVendas.migracoes],
    base: {
      composicao: base.composicao, indicadores: base.indicadores, apuracao: base.apuracao,
    },
    efeitos: decomporEfeitos(base, { entradas, saidas, apuracao }),
    indiceMudanca: indiceMudanca(base, { entradas, saidas }),
  };
  gravarComposicao(cen.id, composicao);
  marcarCalculado(cen.id, resultado);
  return resultado;
}

function marcarCalculado(cenarioId, resultado) {
  db.prepare(`UPDATE cenarios SET status = 'calculado', calculado_em = datetime('now','localtime'),
    resultado = ? WHERE id = ?`).run(JSON.stringify({
      indicadores: resultado.indicadores, apuracao: resultado.apuracao,
      efeitos: resultado.efeitos || null, indiceMudanca: resultado.indiceMudanca || null,
    }), cenarioId);
}

/**
 * Separa o efeito TRIBUTÁRIO do COMERCIAL, como pedido.
 * Com preço constante, todo o delta é tributário. Quando há variação de preço,
 * o efeito comercial é medido pela diferença do preço bruto e o tributário
 * pelo que sobra.
 */
function decomporEfeitos(base, cen) {
  const somaC = (l, c) => l.reduce((s, x) => s + num(x[c]), 0);
  const compraBase = somaC(base.entradas, 'precoAtual');
  const compraCen = somaC(cen.entradas, 'precoAtual');
  const baseEconBase = somaC(base.entradas, 'baseEconomica');
  const baseEconCen = somaC(cen.entradas, 'baseEconomica');
  const credBase = somaC(base.entradas, 'creditoTotal');
  const credCen = somaC(cen.entradas, 'creditoTotal');
  const custoBase = somaC(base.entradas, 'custoLiquido');
  const custoCen = somaC(cen.entradas, 'custoLiquido');

  const projBase = somaC(base.entradas, 'precoProjetado');
  const projCen = somaC(cen.entradas, 'precoProjetado');

  const efeitoComercial = baseEconCen - baseEconBase;  // variação da BASE ECONÔMICA negociada
  const efeitoTributario = (projCen - projBase) - efeitoComercial; // IBS/CBS que passa a incidir por fora
  const efeitoCredito = credCen - credBase;            // variação do crédito recuperável
  const efeitoLiquido = custoCen - custoBase;          // variação do custo efetivo

  // O custo efetivo pode SUBIR mesmo com mais crédito: ao migrar para o
  // regime regular, o fornecedor passa a destacar IBS/CBS por fora, e o preço
  // projetado sobe mais do que o crédito recuperado. Por isso a decomposição
  // mostra os três efeitos separados — mais crédito não é automaticamente
  // melhor, e o sistema não deve sugerir que seja.
  return {
    compras: {
      // "base econômica constante" é a premissa padrão: o valor financeiro da
      // operação SOBE quando IBS/CBS entram por fora, mas a base econômica
      // negociada permanece a mesma. Só há efeito comercial se o consultor
      // informar variação explícita.
      baseEconomicaBase: r2(baseEconBase), baseEconomicaCenario: r2(baseEconCen),
      efeitoComercial: r2(efeitoComercial),
      premissaPadrao: Math.abs(efeitoComercial) < 0.01 ? 'BASE_ECONOMICA_CONSTANTE' : 'VARIACAO_COMERCIAL_INFORMADA',
      precoProjetadoBase: r2(projBase), precoProjetadoCenario: r2(projCen),
      efeitoTributario: r2(efeitoTributario),
      creditoBase: r2(credBase), creditoCenario: r2(credCen),
      efeitoCredito: r2(efeitoCredito),
      custoEfetivoBase: r2(custoBase), custoEfetivoCenario: r2(custoCen),
      efeitoLiquido: r2(efeitoLiquido),
      conferencia: r2(efeitoComercial + efeitoTributario - efeitoCredito - efeitoLiquido),
      leitura: montarLeitura(efeitoComercial, efeitoTributario, efeitoCredito, efeitoLiquido),
    },
    vendas: {
      creditoEntregueBase: r2(somaC(base.saidas, 'creditoTotal')),
      creditoEntregueCenario: r2(somaC(cen.saidas, 'creditoTotal')),
      debitoBase: r2(base.apuracao.ibs.debitos + base.apuracao.cbs.debitos),
      debitoCenario: r2(cen.apuracao.ibs.debitos + cen.apuracao.cbs.debitos),
    },
  };
}

function montarLeitura(comercial, tributario, credito, liquido) {
  const f = (n) => num(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const partes = [];
  partes.push(Math.abs(comercial) < 0.01
    ? 'Base econômica mantida constante: nenhuma alteração comercial negociada.'
    : `A base econômica negociada variou ${f(comercial)} (efeito comercial).`);
  if (Math.abs(tributario) > 0.01) partes.push(`O IBS/CBS destacado sobre essas compras variou ${f(tributario)} (efeito tributário).`);
  partes.push(`O crédito recuperável variou ${f(credito)}.`);
  partes.push(liquido > 0
    ? `Resultado: o custo efetivo AUMENTOU ${f(liquido)} — o tributo destacado subiu mais do que o crédito recuperado.`
    : `Resultado: o custo efetivo REDUZIU ${f(Math.abs(liquido))}.`);
  return partes.join(' ');
}

/** Quanto da carteira foi efetivamente alterado por hipótese */
function indiceMudanca(base, cen) {
  const total = (l) => l.reduce((s, x) => s + num(x.precoAtual), 0);
  const alterado = (l) => l.filter((x) => x.migracao || (x.premissas && Object.keys(x.premissas).length))
    .reduce((s, x) => s + num(x.precoAtual), 0);
  const tc = total(base.entradas), tv = total(base.saidas);
  return {
    compras: tc ? r6(alterado(cen.entradas) / tc) : 0,
    vendas: tv ? r6(alterado(cen.saidas) / tv) : 0,
  };
}

module.exports = {
  decomporCredito, obterOuCriarBase, calcularBase, executarCenario, expandir, recalcular, resolverPremissas,
  calcularIndicadores, gravarComposicao, decomporEfeitos,
  DESTINO_PARA_REGIME, DESTINO_PARA_PERFIL,
};
