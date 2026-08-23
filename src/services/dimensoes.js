/**
 * DIMENSÕES E VISÕES DA CADEIA
 * ---------------------------------------------------------------------------
 * DIMENSÃO é uma PARTIÇÃO: mutuamente exclusiva e exaustiva. Cada item cai em
 * exatamente um grupo. Só em dimensões os percentuais somam 100% e só nelas
 * existe migração — é o que impede dupla contagem.
 *
 * VISÃO é um filtro arbitrário e pode sobrepor (Top 10, região, família de
 * NCM). Serve para ler e para drill-down, nunca para migrar.
 *
 * A função classificadora de cada dimensão recebe o RESULTADO JÁ CALCULADO
 * pelos motores (não o dado cru), porque grupos como "comportamento de
 * crédito" dependem da conclusão do motor de crédito. Isto é agregação sobre
 * o cálculo, jamais cálculo sobre o agregado.
 */
const regras = require('./regras');

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

// ==========================================================================
// DEFINIÇÃO DAS DIMENSÕES
// ==========================================================================
/**
 * Cada dimensão declara seus grupos e uma função `classificar(item)` que
 * devolve a chave do grupo. A função DEVE ser total: todo item recebe um
 * grupo, nem que seja "indeterminado". É isso que garante a exaustividade.
 */
const DIMENSOES = {

  // ------------------------------------------------------------ COMPRAS
  regime_fornecedor: {
    nome: 'Regime do fornecedor', lado: 'compras', tipo: 'dimensao', ordem: 1,
    descricao: 'Como o fornecedor apura IBS/CBS. É o que determina o crédito que ele transmite.',
    grupos: [
      { chave: 'regular', nome: 'Regime regular' },
      { chave: 'simples', nome: 'Simples Nacional' },
      { chave: 'mei', nome: 'MEI' },
      { chave: 'nao_contribuinte', nome: 'Não contribuinte' },
      { chave: 'indeterminado', nome: 'Regime desconhecido' },
    ],
    classificar: (x) => {
      const r = x.regimeEmitente;
      if (!r) return 'indeterminado';
      if (r === 'mei') return 'mei';
      if (r === 'simples_nacional') return 'simples';
      if (['pessoa_fisica', 'produtor_rural_pf', 'imune_isento', 'orgao_publico'].includes(r)) return 'nao_contribuinte';
      const cfg = regras.regime(r);
      return cfg && cfg.geraCreditoNovo ? 'regular' : 'nao_contribuinte';
    },
  },

  credito_fornecedor: {
    nome: 'Comportamento de crédito nas compras', lado: 'compras', tipo: 'dimensao', ordem: 2,
    descricao: 'O que a empresa efetivamente recupera em cada aquisição. Nunca reduz Simples a "sem crédito".',
    grupos: [
      { chave: 'normal', nome: 'Crédito normal do regime regular' },
      { chave: 'limitado', nome: 'Crédito limitado' },
      { chave: 'simples', nome: 'Crédito do Simples Nacional' },
      { chave: 'presumido', nome: 'Crédito presumido' },
      { chave: 'sem_credito', nome: 'Sem crédito' },
      { chave: 'indeterminado', nome: 'Crédito indeterminado' },
    ],
    classificar: (x) => {
      const s = x.credito && x.credito.status;
      if (s === 'PROJETADO') return 'normal';
      if (s === 'CREDITO_PRESUMIDO') return 'presumido';
      if (s === 'PROJETADO_LIMITADO') {
        return ['simples_nacional'].includes(x.regimeEmitente) ? 'simples'
          : (x.regimeEmitente === 'mei' ? 'presumido' : 'limitado');
      }
      if (s === 'SEM_DIREITO') return 'sem_credito';
      return 'indeterminado';
    },
  },

  // ------------------------------------------------------------- VENDAS
  perfil_cliente: {
    nome: 'Perfil do cliente', lado: 'vendas', tipo: 'dimensao', ordem: 1,
    descricao: 'Quem compra determina se o crédito entregue tem valor econômico.',
    grupos: [
      { chave: 'b2b_credito', nome: 'B2B com crédito relevante' },
      { chave: 'b2b_sem_credito', nome: 'B2B sem aproveitamento relevante' },
      { chave: 'b2c_pf', nome: 'B2C pessoa física' },
      { chave: 'b2c_pj', nome: 'B2C pessoa jurídica' },
      { chave: 'governo', nome: 'Governo' },
      { chave: 'indeterminado', nome: 'Perfil desconhecido' },
    ],
    classificar: (x) => {
      const d = x.destinatario;
      if (!d || d.perfil === 'requer_validacao') return 'indeterminado';
      if (d.perfil === 'governo') return 'governo';
      if (d.perfil === 'b2c_pf') return 'b2c_pf';
      if (d.perfil === 'b2c_pj') return 'b2c_pj';
      if (d.perfil === 'b2b') return d.credita ? 'b2b_credito' : 'b2b_sem_credito';
      return 'indeterminado';
    },
  },

  sensibilidade_cliente: {
    nome: 'Sensibilidade do cliente ao crédito', lado: 'vendas', tipo: 'dimensao', ordem: 2,
    descricao: 'Importância potencial do crédito para o adquirente — projeção econômica, não afirmação sobre o comportamento dele.',
    grupos: [
      { chave: 'alta', nome: 'Alta' },
      { chave: 'media', nome: 'Média' },
      { chave: 'baixa', nome: 'Baixa' },
      { chave: 'irrelevante', nome: 'Irrelevante' },
      { chave: 'indeterminado', nome: 'Desconhecida' },
    ],
    classificar: (x) => {
      const s = x.sensibilidade && x.sensibilidade.nivel;
      if (s === 'ALTA') return 'alta';
      if (s === 'MEDIA') return 'media';
      if (s === 'BAIXA') return 'baixa';
      if (s === 'NAO_APLICAVEL') return 'irrelevante';
      return 'indeterminado';
    },
  },

  // -------------------------------------------------------------- AMBOS
  natureza_operacao: {
    nome: 'Natureza da operação', lado: 'ambos', tipo: 'dimensao', ordem: 3,
    descricao: 'Mercadoria, serviço, frete e demais categorias econômicas.',
    grupos: [
      { chave: 'mercadoria', nome: 'Mercadorias' },
      { chave: 'servico', nome: 'Serviços' },
      { chave: 'frete', nome: 'Fretes e transporte' },
      { chave: 'energia', nome: 'Energia e utilidades' },
      { chave: 'locacao', nome: 'Locações' },
      { chave: 'outros', nome: 'Outras naturezas' },
    ],
    classificar: (x) => {
      const d = String(x.descricao || '').toLowerCase();
      const nat = x.classificacao && x.classificacao.natureza;
      if (/frete|transporte|carreto|log[ií]stic/.test(d) || x.documento_tipo === 'cte') return 'frete';
      if (/energia|el[ée]tric|[áa]gua|esgoto|g[áa]s|telecom/.test(d)) return 'energia';
      if (/loca[çc][ãa]o|aluguel|arrendamento|leasing/.test(d)) return 'locacao';
      if (x.tipo === 'mercadoria' || x.ncm) return 'mercadoria';
      if (x.tipo === 'servico' || x.nbs) return 'servico';
      return nat ? 'outros' : 'outros';
    },
  },

  tratamento_tributario: {
    nome: 'Tratamento tributário', lado: 'ambos', tipo: 'dimensao', ordem: 4,
    descricao: 'Enquadramento aplicado no IBS/CBS conforme as bases de classificação.',
    grupos: [
      { chave: 'integral', nome: 'Tributação integral' },
      { chave: 'reducao', nome: 'Redução de alíquota' },
      { chave: 'aliquota_zero', nome: 'Alíquota zero' },
      { chave: 'imunidade', nome: 'Imunidade e isenção' },
      { chave: 'especifico', nome: 'Regimes específicos' },
      { chave: 'indeterminado', nome: 'Enquadramento pendente' },
    ],
    classificar: (x) => {
      const c = x.classificacao || {};
      if (c.status !== 'CLASSIFICADO') return 'indeterminado';
      const r = c.reducao;
      if (r === 'imune') return 'imunidade';
      if (r === 'reducao_100') return 'aliquota_zero';
      if (r === 'reducao_30' || r === 'reducao_60') return 'reducao';
      if (r === 'especifico') return 'especifico';
      return 'integral';
    },
  },
};

// ==========================================================================
// VISÕES (podem sobrepor — nunca usadas para migração)
// ==========================================================================
const VISOES = {
  concentracao: {
    nome: 'Importância econômica', lado: 'ambos', tipo: 'visao', ordem: 10,
    descricao: 'Top 10, Top 20 e demais. Um mesmo parceiro aparece em mais de uma faixa acumulada, por isso é visão e não dimensão.',
    // avaliada sobre o ranking de parceiros, fora do classificador por item
  },
  uf: {
    nome: 'Localização', lado: 'ambos', tipo: 'visao', ordem: 11,
    descricao: 'UF do parceiro, quando conhecida.',
  },
};

// ==========================================================================
// APLICAÇÃO
// ==========================================================================
function dimensoesDoLado(lado) {
  return Object.entries(DIMENSOES)
    .filter(([, d]) => d.lado === lado || d.lado === 'ambos')
    .sort((a, b) => a[1].ordem - b[1].ordem)
    .map(([chave, d]) => ({ chave, ...d }));
}

/** Classifica um resultado do motor em todas as dimensões do seu lado */
function classificarItem(x, lado) {
  const out = {};
  for (const d of dimensoesDoLado(lado)) {
    try { out[d.chave] = d.classificar(x) || 'indeterminado'; }
    catch (_) { out[d.chave] = 'indeterminado'; }
  }
  return out;
}

/**
 * Consolida os resultados numa composição por dimensão.
 * A base do percentual é o VALOR ECONÔMICO (preço praticado), porque é sobre
 * ele que o consultor raciocina ao dizer "25% das minhas compras".
 */
function compor(resultados, lado) {
  const dims = dimensoesDoLado(lado);
  // Os valores das linhas virtuais já chegam escalados pela fração em
  // cenarioMotor.escalar — multiplicar de novo aqui contaria a fração 2x.
  const total = resultados.reduce((s, x) => s + num(x.precoAtual), 0);
  const saida = {};

  for (const d of dims) {
    const mapa = new Map();
    for (const g of d.grupos) {
      mapa.set(g.chave, { grupo: g.chave, nome: g.nome, valor: 0, itens: 0,
        entidades: new Set(), baseEconomica: 0, ibs: 0, cbs: 0,
        creditoIbs: 0, creditoCbs: 0, custoEfetivo: 0, simulados: 0 });
    }
    for (const x of resultados) {
      const chave = (x.grupos && x.grupos[d.chave]) || classificarItem(x, lado)[d.chave];
      const g = mapa.get(chave) || mapa.get('indeterminado');
      if (!g) continue;
      g.valor += num(x.precoAtual);
      g.itens += 1;
      if (x.cnpj) g.entidades.add(x.cnpj);
      g.baseEconomica += num(x.baseEconomica);
      g.ibs += num(x.ibs); g.cbs += num(x.cbs);
      g.creditoIbs += num(x.creditoIbs); g.creditoCbs += num(x.creditoCbs);
      g.custoEfetivo += num(x.custoLiquido);
      if (x.natureza === 'SIMULADO') g.simulados += 1;
    }
    saida[d.chave] = {
      dimensao: d.chave, nome: d.nome, descricao: d.descricao, total,
      grupos: [...mapa.values()].map((g) => ({
        ...g,
        entidades: g.entidades.size,
        participacao: total ? g.valor / total : 0,
        natureza: g.simulados ? 'SIMULADO' : 'CALCULADO',
      })),
    };
  }
  return saida;
}

/** Semeia as dimensões e grupos no banco, para ficarem visíveis e ordenáveis */
function semear() {
  // `db` é exigido aqui dentro, e não no topo do módulo: db.js carrega este
  // arquivo durante a própria inicialização e o require circular devolveria
  // um módulo ainda vazio.
  const db = require('../db');
  const insD = db.prepare(`INSERT OR IGNORE INTO cenario_dimensoes (chave, nome, lado, tipo, descricao, ordem)
    VALUES (?,?,?,?,?,?)`);
  const insG = db.prepare('INSERT OR IGNORE INTO cenario_grupos (dimensao, chave, nome, ordem) VALUES (?,?,?,?)');
  db.transaction(() => {
    for (const [chave, d] of Object.entries(DIMENSOES)) {
      insD.run(chave, d.nome, d.lado, 'dimensao', d.descricao, d.ordem);
      d.grupos.forEach((g, i) => insG.run(chave, g.chave, g.nome, i));
    }
    for (const [chave, v] of Object.entries(VISOES)) {
      insD.run(chave, v.nome, v.lado, 'visao', v.descricao, v.ordem);
    }
  })();
}

module.exports = { DIMENSOES, VISOES, dimensoesDoLado, classificarItem, compor, semear };
