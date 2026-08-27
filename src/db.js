const path = require('path');
const fs = require('fs');
const sqlite = require('./sqlite');

const DIR = process.env.SATTVA_DADOS || path.join(__dirname, '..', 'dados');
fs.mkdirSync(DIR, { recursive: true });
const db = sqlite.abrir(path.join(DIR, 'reforma.db'));

/**
 * MIGRAÇÃO DE ESQUEMA
 * ---------------------------------------------------------------------------
 * CREATE TABLE IF NOT EXISTS não altera tabela que já existe. Num banco criado
 * por uma versão anterior, as colunas novas simplesmente não aparecem — e o
 * CREATE INDEX sobre elas quebra a inicialização inteira.
 *
 * Esta rotina roda ANTES do esquema: para cada tabela já existente, acrescenta
 * as colunas que faltam. Em banco novo não faz nada (as tabelas ainda não
 * existem) e o esquema abaixo cria tudo já completo.
 *
 * Toda coluna nova precisa ser registrada aqui, senão quem atualiza o sistema
 * sem apagar o banco recebe erro na primeira execução.
 */
const COLUNAS_NOVAS = {
  cenarios: {
    tipo: "TEXT DEFAULT 'hipotese'",
    base_id: 'INTEGER',
    versao: 'INTEGER DEFAULT 1',
    versao_anterior_id: 'INTEGER',
    ano: 'INTEGER DEFAULT 2033',
    status: "TEXT DEFAULT 'rascunho'",
    calculado_em: 'TEXT',
  },
  movimentos: {
    cclasstrib: 'TEXT', classificacao_origem: 'TEXT',
    cst_declarado: 'TEXT', cclasstrib_declarado: 'TEXT',
    ibs_declarado: 'REAL', cbs_declarado: 'REAL',
    documento: 'TEXT', item_numero: 'INTEGER', chave: 'TEXT',
    emitente_cnpj: 'TEXT', destinatario_cnpj: 'TEXT',
    codigo_produto: 'TEXT', quantidade: 'REAL', unidade: 'TEXT',
    csosn: 'TEXT', data_emissao: 'TEXT',
    frete: 'REAL DEFAULT 0', seguro: 'REAL DEFAULT 0',
    outras: 'REAL DEFAULT 0', desconto: 'REAL DEFAULT 0',
    sentido: 'TEXT',
    pis_cofins_documentado: 'INTEGER DEFAULT 0',
  },
  motor_resultados: {
    cenario_id: 'INTEGER', grupo_origem: 'TEXT', fracao: 'REAL DEFAULT 1',
    tipo_credito: 'TEXT', modalidade_credito: 'TEXT', status_credito_determinacao: 'TEXT', regime_cbs_emitente: 'TEXT', regime_cbs_adquirente: 'TEXT',
    movimento_hash: 'TEXT', regra_version: 'TEXT', catalogo_version: 'TEXT', parceiro_version: 'TEXT', parametro_version: 'TEXT', motor_version: 'TEXT',
  },
  jobs_carteira: { proxima_tentativa_em: 'TEXT', resultado: 'TEXT' },
  param_regimes: { credito_cbs_simples_referencia: 'REAL' },
  param_cfop: { prioridade: 'INTEGER DEFAULT 2' },
  param_aliquotas: { calcular_ibs: 'INTEGER DEFAULT 0' },
  parceiros: {
    faturamento_anual: 'REAL',
    regime_resolvido: "TEXT DEFAULT 'indeterminado'",
    perfil_economico: "TEXT DEFAULT 'indeterminado'",
    perfil_origem: "TEXT DEFAULT 'nao_definido'",
    sensibilidade_credito: "TEXT DEFAULT 'indeterminado'",
    sensibilidade_origem: "TEXT DEFAULT 'nao_definido'",
  },
  servicos: { chave_entrega: "TEXT DEFAULT 'outro'" },
  combos: { acompanhamento_meses: 'INTEGER DEFAULT 3' },
  contratacoes: {
    aprovado_em: 'TEXT', competencia_referencia: 'TEXT',
    acompanhamento_meses: 'INTEGER DEFAULT 0', modulos_json: 'TEXT',
  },
  turmas: { limite_participantes: 'INTEGER DEFAULT 30' },
  participantes: { empresa_id: 'INTEGER' },
  empresa_servicos_fiscais: {
    pis_cofins: 'REAL', das_efetivo: 'REAL', iss_aliquota: 'REAL', ativo: 'INTEGER DEFAULT 1', origem: "TEXT DEFAULT 'manual'",
  },
  formacao_custo_itens: { movimento_saida_id: 'INTEGER', despesas_variaveis: 'REAL DEFAULT 0' },
  regras_governo: { origem_linha: 'TEXT' },
  base_ncm: {
    operacao_pis_cofins: 'TEXT', cst_pis_atual: 'TEXT', cst_cofins_atual: 'TEXT', pis_percentual: 'REAL', cofins_percentual: 'REAL',
    regime_pis_cofins_receita: 'TEXT', tratamento_pis_cofins: 'TEXT', papel_na_cadeia_necessario: 'TEXT', papel_na_cadeia: 'TEXT',
    tratamento_efetivo_saida: 'TEXT', natureza_reconstrucao: 'TEXT', percentual_reconstrucao_sugerido: 'REAL', regra_precedencia: 'TEXT',
  },
  base_servicos: {
    operacao_pis_cofins: 'TEXT', cst_pis_atual: 'TEXT', cst_cofins_atual: 'TEXT', pis_percentual: 'REAL', cofins_percentual: 'REAL',
    cumulatividade_obrigatoria: 'TEXT', grau_determinacao: 'TEXT', hipotese_legal_cumulativa: 'TEXT', pis_cumulativo_percentual: 'REAL', cofins_cumulativo_percentual: 'REAL', total_cumulativo_percentual: 'REAL', fundamento_cumulatividade: 'TEXT', condicao_cumulatividade: 'TEXT',
    regime_pis_cofins_receita: 'TEXT', tratamento_pis_cofins: 'TEXT', papel_na_cadeia_necessario: 'TEXT', tratamento_efetivo_saida: 'TEXT', natureza_reconstrucao: 'TEXT', percentual_reconstrucao_sugerido: 'REAL', regra_precedencia: 'TEXT',
  },
  cnpj_cache: { natureza_juridica: 'TEXT', codigo_natureza_juridica: 'TEXT', efr: 'TEXT' },
};

function migrarEsquema() {
  const existe = (t) => !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  const aplicadas = [];
  for (const [tabela, colunas] of Object.entries(COLUNAS_NOVAS)) {
    if (!existe(tabela)) continue;               // banco novo: o esquema cria completa
    const atuais = new Set(db.prepare(`PRAGMA table_info(${tabela})`).all().map((c) => c.name));
    for (const [coluna, definicao] of Object.entries(colunas)) {
      if (atuais.has(coluna)) continue;
      try {
        db.exec(`ALTER TABLE ${tabela} ADD COLUMN ${coluna} ${definicao}`);
        aplicadas.push(`${tabela}.${coluna}`);
      } catch (e) {
        console.error(`  não foi possível acrescentar ${tabela}.${coluna}: ${e.message}`);
      }
    }
  }
  if (aplicadas.length) {
    console.log(`  banco atualizado: ${aplicadas.length} colunas acrescentadas (${aplicadas.slice(0, 6).join(', ')}${aplicadas.length > 6 ? '…' : ''})`);
  }
}
migrarEsquema();

db.exec(`
-- ============ EMPRESAS CONTRATANTES DO SERVIÇO ============
CREATE TABLE IF NOT EXISTS empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cnpj TEXT UNIQUE NOT NULL,
  razao_social TEXT NOT NULL,
  nome_fantasia TEXT,
  regime TEXT NOT NULL DEFAULT 'indeterminado', -- legado; não é mais a fonte de verdade
  regime_resolvido TEXT DEFAULT 'indeterminado',
  perfil_economico TEXT DEFAULT 'indeterminado',
  perfil_origem TEXT DEFAULT 'nao_definido',
  sensibilidade_credito TEXT DEFAULT 'indeterminado',
  sensibilidade_origem TEXT DEFAULT 'nao_definido',
  uf TEXT, municipio TEXT, cnae TEXT, atividade TEXT,
  faturamento_anual REAL DEFAULT 0,
  setor TEXT, reducao_padrao TEXT DEFAULT 'integral',
  codigo_questor TEXT,
  observacoes TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- Referência da tributação atual por serviço vendido. Nunca substituir uma
-- informação efetivamente destacada no documento; serve quando ela não veio.
CREATE TABLE IF NOT EXISTS empresa_servicos_fiscais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave TEXT NOT NULL, nbs TEXT, descricao TEXT NOT NULL,
  pis_cofins REAL, das_efetivo REAL, iss_aliquota REAL,
  ativo INTEGER DEFAULT 1, origem TEXT DEFAULT 'manual',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, chave)
);

-- ============ 1.a PERFIL TRIBUTÁRIO ============
CREATE TABLE IF NOT EXISTS perfil_tributario (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia TEXT,                     -- AAAA-MM
  receita_bruta REAL DEFAULT 0,
  receita_mercadorias REAL DEFAULT 0,
  receita_servicos REAL DEFAULT 0,
  receita_exportacao REAL DEFAULT 0,
  icms REAL DEFAULT 0, iss REAL DEFAULT 0, ipi REAL DEFAULT 0,
  pis REAL DEFAULT 0, cofins REAL DEFAULT 0, das REAL DEFAULT 0,
  creditos_tomados REAL DEFAULT 0,
  origem TEXT DEFAULT 'manual',         -- manual | planilha | questor
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- ============ PERFIL CBS (consolidação materializada do motor) ============
-- Esta tabela não calcula tributos: apenas consolida motor_resultados por
-- empresa e competência, preservando a execução que originou cada leitura.
CREATE TABLE IF NOT EXISTS perfil_cbs_competencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  receita_bruta REAL DEFAULT 0, compras_brutas REAL DEFAULT 0,
  base_economica_saidas REAL DEFAULT 0, base_economica_entradas REAL DEFAULT 0,
  cbs_debito REAL DEFAULT 0, cbs_credito REAL DEFAULT 0, cbs_liquida REAL DEFAULT 0,
  aliquota_efetiva_cbs_saida REAL, taxa_recuperacao_cbs_entrada REAL,
  receita_tributacao_integral REAL DEFAULT 0, receita_reducao_cbs REAL DEFAULT 0,
  receita_aliquota_zero_cbs REAL DEFAULT 0, receita_imunidade_cbs REAL DEFAULT 0,
  receita_regime_especifico_cbs REAL DEFAULT 0, receita_beneficio_governo_cbs REAL DEFAULT 0,
  receita_tratamento_indeterminado_cbs REAL DEFAULT 0,
  compras_credito_normal REAL DEFAULT 0, compras_credito_limitado REAL DEFAULT 0,
  compras_credito_simples REAL DEFAULT 0, compras_credito_presumido REAL DEFAULT 0,
  compras_sem_credito REAL DEFAULT 0, compras_credito_indeterminado REAL DEFAULT 0,
  cobertura_classificacao_cbs REAL, cobertura_base_economica REAL, cobertura_credito_cbs REAL,
  percentual_real REAL DEFAULT 0, percentual_calculado REAL DEFAULT 0,
  percentual_simulado REAL DEFAULT 0, percentual_indeterminado REAL DEFAULT 0,
  quantidade_documentos INTEGER DEFAULT 0, quantidade_operacoes INTEGER DEFAULT 0,
  motor_execucao_id INTEGER, atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, competencia)
);
CREATE INDEX IF NOT EXISTS ix_perfil_cbs_empresa_competencia ON perfil_cbs_competencias(empresa_id, competencia);

-- ============ PARCEIROS (clientes e fornecedores) ============
CREATE TABLE IF NOT EXISTS parceiros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,                   -- 'fornecedor' | 'cliente'
  cnpj TEXT,
  descricao TEXT,
  regime TEXT NOT NULL DEFAULT 'lucro_real',
  faturamento_anual REAL,               -- RBT12, quando conhecido (faixa do Simples)
  uf TEXT, municipio TEXT,
  origem TEXT DEFAULT 'manual',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, tipo, cnpj)
);
CREATE INDEX IF NOT EXISTS ix_parceiros ON parceiros(empresa_id, tipo);

-- Evidências não se sobrescrevem: uma fonte histórica (RFB 2024) nunca vira
-- automaticamente uma afirmação sobre o regime atual da contraparte.
CREATE TABLE IF NOT EXISTS contraparte_regime_evidencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parceiro_id INTEGER NOT NULL REFERENCES parceiros(id) ON DELETE CASCADE,
  regime TEXT NOT NULL,
  fonte TEXT NOT NULL,
  ano_referencia INTEGER,
  natureza TEXT NOT NULL DEFAULT 'historico', -- atual | historico | manual
  confianca TEXT DEFAULT 'media',
  status TEXT DEFAULT 'confirmada',
  detalhe TEXT,
  consultado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(parceiro_id, regime, fonte, ano_referencia, natureza)
);
CREATE INDEX IF NOT EXISTS ix_contraparte_evidencias ON contraparte_regime_evidencias(parceiro_id);

-- ============ MOVIMENTAÇÃO ============
CREATE TABLE IF NOT EXISTS movimentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  lote_id INTEGER,
  tipo TEXT NOT NULL,                   -- 'fornecedor' (entradas) | 'cliente' (saídas)
  nome TEXT, inscr_federal TEXT,
  descricao TEXT, ncm TEXT, nbs TEXT, cfop TEXT, cst TEXT,
  competencia TEXT,
  valor REAL DEFAULT 0, base_calculo REAL DEFAULT 0,
  icms REAL DEFAULT 0, icms_st REAL DEFAULT 0, ipi REAL DEFAULT 0,
  pis REAL DEFAULT 0, cofins REAL DEFAULT 0, pis_cofins_documentado INTEGER DEFAULT 0, iss REAL DEFAULT 0,
  regime TEXT,                          -- resolvido a partir do cadastro de parceiros
  reducao TEXT DEFAULT 'integral',
  aliq_especifica REAL,
  cclasstrib TEXT,
  classificacao_origem TEXT,
  cst_declarado TEXT, cclasstrib_declarado TEXT, ibs_declarado REAL, cbs_declarado REAL,
  documento TEXT, item_numero INTEGER, chave TEXT,
  emitente_cnpj TEXT, destinatario_cnpj TEXT,
  codigo_produto TEXT, quantidade REAL, unidade TEXT,
  csosn TEXT, data_emissao TEXT,
  frete REAL DEFAULT 0, seguro REAL DEFAULT 0, outras REAL DEFAULT 0, desconto REAL DEFAULT 0,
  sentido TEXT,
  origem TEXT DEFAULT 'planilha',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_mov ON movimentos(empresa_id, tipo);
CREATE INDEX IF NOT EXISTS ix_mov_insc ON movimentos(empresa_id, inscr_federal);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT, arquivo TEXT, registros INTEGER DEFAULT 0,
  ignorados INTEGER DEFAULT 0, valor_total REAL DEFAULT 0,
  mensagens TEXT, origem TEXT DEFAULT 'planilha',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- ============ CENÁRIOS E SIMULAÇÃO DA CADEIA ============
-- A tabela original de cenários vira o cabeçalho. Um cenário é IMUTÁVEL
-- depois de calculado: editar cria nova versão apontando para a anterior.
-- A versão 0 é o CENÁRIO BASE — a fotografia econômica atual, nunca editável.
CREATE TABLE IF NOT EXISTS cenarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, descricao TEXT,
  tipo TEXT DEFAULT 'hipotese',        -- 'base' | 'hipotese'
  base_id INTEGER REFERENCES cenarios(id),   -- cenário-base de referência
  versao INTEGER DEFAULT 1,
  versao_anterior_id INTEGER REFERENCES cenarios(id),
  ano INTEGER DEFAULT 2033,
  status TEXT DEFAULT 'rascunho',      -- rascunho | calculado | arquivado
  parametros TEXT, resultado TEXT,     -- JSON (compatibilidade + resumo)
  calculado_em TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_cenarios ON cenarios(empresa_id, tipo);

-- DIMENSÃO: partição mutuamente exclusiva e exaustiva. Só aqui os percentuais
-- somam 100% e só aqui existe migração entre grupos.
-- VISÃO (tipo='visao'): filtro arbitrário, pode sobrepor. Serve para leitura
-- e drill-down, nunca para migração — é o que evita dupla contagem.
CREATE TABLE IF NOT EXISTS cenario_dimensoes (
  chave TEXT PRIMARY KEY,
  nome TEXT NOT NULL, lado TEXT NOT NULL,     -- 'compras' | 'vendas' | 'ambos'
  tipo TEXT DEFAULT 'dimensao',               -- 'dimensao' | 'visao'
  descricao TEXT, ordem INTEGER DEFAULT 0, ativa INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS cenario_grupos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dimensao TEXT NOT NULL REFERENCES cenario_dimensoes(chave) ON DELETE CASCADE,
  chave TEXT NOT NULL, nome TEXT NOT NULL,
  descricao TEXT, cor TEXT, ordem INTEGER DEFAULT 0,
  UNIQUE (dimensao, chave)
);

-- Composição calculada de um cenário: valor e participação de cada grupo
CREATE TABLE IF NOT EXISTS cenario_composicao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cenario_id INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  lado TEXT NOT NULL, dimensao TEXT NOT NULL, grupo TEXT NOT NULL,
  valor REAL DEFAULT 0, participacao REAL DEFAULT 0,
  itens INTEGER DEFAULT 0, entidades INTEGER DEFAULT 0,
  base_economica REAL DEFAULT 0,
  ibs REAL DEFAULT 0, cbs REAL DEFAULT 0,
  credito_ibs REAL DEFAULT 0, credito_cbs REAL DEFAULT 0,
  custo_efetivo REAL DEFAULT 0, natureza TEXT DEFAULT 'CALCULADO'
);
CREATE INDEX IF NOT EXISTS ix_composicao ON cenario_composicao(cenario_id, lado, dimensao);

-- Premissas: nunca sobrescrevem o cadastro. São overrides aplicados no ctx
-- dos motores. Precedência: individual > grupo > global > dado original.
CREATE TABLE IF NOT EXISTS cenario_premissas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cenario_id INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  nivel TEXT NOT NULL,                  -- 'global' | 'grupo' | 'individual'
  lado TEXT,                            -- 'compras' | 'vendas' | null (global)
  dimensao TEXT, grupo TEXT,            -- escopo quando nivel='grupo'
  entidade_tipo TEXT, entidade_id TEXT, -- cnpj/movimento quando 'individual'
  campo TEXT NOT NULL,                  -- regime | perfil | preco | repasse | ano | ...
  valor_original TEXT, valor_simulado TEXT,
  justificativa TEXT, fonte TEXT,
  natureza TEXT DEFAULT 'SIMULADO',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_premissas ON cenario_premissas(cenario_id, nivel);

-- Migração percentual entre grupos da MESMA dimensão. É uma transferência:
-- o que sai de um grupo entra em outro, então a soma 100% é invariante por
-- construção — não precisa ser validada depois.
CREATE TABLE IF NOT EXISTS cenario_alocacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cenario_id INTEGER NOT NULL REFERENCES cenarios(id) ON DELETE CASCADE,
  lado TEXT NOT NULL, dimensao TEXT NOT NULL,
  grupo_origem TEXT NOT NULL, grupo_destino TEXT NOT NULL,
  percentual_grupo REAL NOT NULL,       -- fração do grupo de origem que migra
  participacao_origem REAL,             -- participação do grupo antes
  percentual_total REAL,                -- impacto sobre o total (part × %grupo)
  valor_afetado REAL,
  variacao_preco REAL DEFAULT 0,        -- premissa comercial; 0 = preço constante
  justificativa TEXT,
  natureza TEXT DEFAULT 'SIMULADO',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_alocacoes ON cenario_alocacoes(cenario_id, lado, dimensao);

-- ============ MÓDULO 2 — PRECIFICAÇÃO ============
CREATE TABLE IF NOT EXISTS itens_precificacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  descricao TEXT, ncm TEXT, tipo TEXT DEFAULT 'mercadoria',
  preco_venda REAL DEFAULT 0, custo_compra REAL DEFAULT 0,
  despesas_variaveis REAL DEFAULT 0,
  regime_fornecedor TEXT, perfil_cliente TEXT DEFAULT 'lucro_real',
  reducao TEXT DEFAULT 'integral', aliq_especifica REAL,
  ano INTEGER DEFAULT 2033,
  resultado TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- Base de formação de custo: separada do motor tributário. NCM/NBS ajudam a
-- identificar o item, mas nunca são usados como chave automática de composição.
CREATE TABLE IF NOT EXISTS formacao_custo_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT, descricao TEXT NOT NULL, tipo TEXT DEFAULT 'mercadoria',
  sku TEXT, gtin TEXT, ncm TEXT, nbs TEXT, unidade TEXT,
  centro_custo TEXT, despesas_variaveis REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
  movimento_saida_id INTEGER REFERENCES movimentos(id) ON DELETE SET NULL,
  status_formacao_custo TEXT DEFAULT 'INCOMPLETO',
  origem TEXT DEFAULT 'MANUAL',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_formacao_custo_empresa ON formacao_custo_itens(empresa_id);

CREATE TABLE IF NOT EXISTS formacao_custo_componentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_formacao_id INTEGER NOT NULL REFERENCES formacao_custo_itens(id) ON DELETE CASCADE,
  movimento_id INTEGER REFERENCES movimentos(id) ON DELETE SET NULL,
  codigo_origem TEXT, descricao_origem TEXT,
  relacionamento TEXT NOT NULL DEFAULT 'NAO_RELACIONADA', -- DIRETA | COMPOSICAO | RATEIO | NAO_RELACIONADA
  criterio_rateio TEXT, percentual_rateio REAL,
  quantidade REAL, unidade TEXT,
  status_alocacao_credito TEXT DEFAULT 'NAO_ALOCADO', -- DIRETO | RATEAVEL | NAO_ALOCADO
  observacoes TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_formacao_componentes_item ON formacao_custo_componentes(item_formacao_id);
CREATE INDEX IF NOT EXISTS ix_formacao_componentes_movimento ON formacao_custo_componentes(movimento_id);

-- ============ MÓDULO 3 — CONTRATOS ============
CREATE TABLE IF NOT EXISTS contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT,                            -- compra | fornecimento | venda | servico
  contraparte TEXT, cnpj_contraparte TEXT, regime_contraparte TEXT,
  objeto TEXT, valor REAL DEFAULT 0,
  vigencia_inicio TEXT, vigencia_fim TEXT,
  reajuste TEXT, preco_com_tributo INTEGER DEFAULT 1,
  status TEXT DEFAULT 'pendente',       -- pendente | em_revisao | revisado | renegociado
  risco TEXT DEFAULT 'nao_avaliado',    -- baixo | medio | alto
  parecer TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS contrato_checklist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  clausula_id TEXT, situacao TEXT DEFAULT 'ausente',  -- ausente | parcial | adequada | na
  observacao TEXT
);

-- ============ MÓDULO 4 — CAPACITAÇÃO ============
CREATE TABLE IF NOT EXISTS turmas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  trilha TEXT, titulo TEXT, formato TEXT DEFAULT 'presencial',
  data TEXT, carga_horaria REAL DEFAULT 4, instrutor TEXT,
  limite_participantes INTEGER DEFAULT 30,
  status TEXT DEFAULT 'planejada',      -- planejada | realizada | cancelada
  observacoes TEXT
);

CREATE TABLE IF NOT EXISTS participantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  turma_id INTEGER NOT NULL REFERENCES turmas(id) ON DELETE CASCADE,
  empresa_id INTEGER REFERENCES empresas(id),
  nome TEXT, area TEXT, email TEXT,
  presenca INTEGER DEFAULT 0, nota_avaliacao REAL
);

-- ============ CATÁLOGO DE SERVIÇOS E COMBOS ============
CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT UNIQUE, modulo TEXT, nome TEXT, descricao TEXT,
  entregaveis TEXT, preco REAL DEFAULT 0, unidade TEXT DEFAULT 'projeto',
  prazo_dias INTEGER DEFAULT 30, recorrente INTEGER DEFAULT 0,
  chave_entrega TEXT DEFAULT 'outro',
  ativo INTEGER DEFAULT 1, ordem INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS combos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT, descricao TEXT, desconto REAL DEFAULT 0,
  destaque INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1,
  acompanhamento_meses INTEGER DEFAULT 3
);

CREATE TABLE IF NOT EXISTS combo_itens (
  combo_id INTEGER NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  servico_id INTEGER NOT NULL REFERENCES servicos(id) ON DELETE CASCADE,
  PRIMARY KEY (combo_id, servico_id)
);

CREATE TABLE IF NOT EXISTS contratacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  combo_id INTEGER REFERENCES combos(id),
  servicos_json TEXT,                   -- ids selecionados
  valor_bruto REAL DEFAULT 0, desconto REAL DEFAULT 0, valor_final REAL DEFAULT 0,
  status TEXT DEFAULT 'proposta',       -- proposta | contratado | em_execucao | concluido
  observacoes TEXT,
  aprovado_em TEXT, competencia_referencia TEXT,
  acompanhamento_meses INTEGER DEFAULT 0,
  modulos_json TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- O escopo aprovado é uma fotografia dos módulos vendidos; progresso não é
-- inferido de acessos à tela, mas registrado como entrega do projeto.
CREATE TABLE IF NOT EXISTS projeto_entregas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contratacao_id INTEGER NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  chave TEXT NOT NULL, titulo TEXT NOT NULL,
  status TEXT DEFAULT 'pendente', -- pendente | em_andamento | concluida | nao_aplicavel
  concluido_em TEXT, observacoes TEXT,
  UNIQUE(contratacao_id, chave)
);

CREATE TABLE IF NOT EXISTS projeto_acompanhamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contratacao_id INTEGER NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL, nome TEXT,
  status TEXT DEFAULT 'planejado', -- planejado | em_andamento | concluido
  observacoes TEXT, criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(contratacao_id, competencia)
);

CREATE TABLE IF NOT EXISTS projeto_responsaveis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contratacao_id INTEGER NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  entrega_id INTEGER REFERENCES projeto_entregas(id) ON DELETE CASCADE,
  lado TEXT NOT NULL, -- sattva | cliente
  nome TEXT NOT NULL, telefone TEXT, email TEXT, funcao TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS projeto_tarefas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contratacao_id INTEGER NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  entrega_id INTEGER NOT NULL REFERENCES projeto_entregas(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, descricao TEXT, status TEXT DEFAULT 'aberta',
  data_abertura TEXT, data_conclusao TEXT,
  envolve_cliente INTEGER DEFAULT 0, pendencia_cliente TEXT, interacoes_cliente TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')), atualizado_em TEXT
);

-- ============ PLANO DE ADEQUAÇÃO ============
CREATE TABLE IF NOT EXISTS acoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  origem TEXT, titulo TEXT, descricao TEXT,
  responsavel TEXT, prazo TEXT, prioridade TEXT DEFAULT 'media',
  status TEXT DEFAULT 'aberta',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- ============ BASES ANUAIS DA RECEITA (Lucro Real / Presumido) ============
-- Milhões de linhas: a chave é (cnpj, ano) e há índice pela raiz, porque as
-- relações da Receita às vezes trazem só a raiz e o regime é da pessoa
-- jurídica, não do estabelecimento.
CREATE TABLE IF NOT EXISTS base_regime (
  cnpj TEXT NOT NULL,
  raiz TEXT NOT NULL,
  regime TEXT NOT NULL,
  ano INTEGER NOT NULL,
  fonte TEXT,
  PRIMARY KEY (cnpj, ano)
);
CREATE INDEX IF NOT EXISTS ix_base_regime_raiz ON base_regime(raiz, ano);

CREATE TABLE IF NOT EXISTS base_regime_importacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  arquivo TEXT, regime TEXT, ano INTEGER,
  linhas INTEGER DEFAULT 0, importados INTEGER DEFAULT 0,
  invalidos INTEGER DEFAULT 0, duplicados INTEGER DEFAULT 0,
  segundos REAL, criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- Regras específicas para vendas a entes governamentais (LC 214).
CREATE TABLE IF NOT EXISTS regras_governo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL, chave TEXT NOT NULL, lc116 TEXT, nbs TEXT, ncm TEXT,
  descricao TEXT, tratamento TEXT, cst TEXT, cclasstrib TEXT, indop TEXT,
  reducao REAL, aliquota_zero INTEGER DEFAULT 0, ente_elegivel TEXT,
  condicoes TEXT, fundamento TEXT, vigencia TEXT, fonte TEXT, origem_linha TEXT,
  UNIQUE(tipo, chave, cclasstrib)
);

-- ============ CONSULTA DE REGIME NA BASE DA RECEITA ============
-- Cache das consultas ao cadastro público de CNPJ. Guarda a situação na data
-- da consulta e a fonte — o regime de um fornecedor pode mudar, e o
-- diagnóstico precisa saber de quando é o dado que usou.
CREATE TABLE IF NOT EXISTS cnpj_cache (
  cnpj TEXT PRIMARY KEY,
  razao_social TEXT, situacao TEXT, porte TEXT,
  cnae TEXT, cnae_descricao TEXT, uf TEXT, municipio TEXT,
  optante_simples INTEGER DEFAULT 0, data_opcao_simples TEXT, data_exclusao_simples TEXT,
  optante_mei INTEGER DEFAULT 0, data_opcao_mei TEXT, data_exclusao_mei TEXT,
  regime_derivado TEXT, justificativa TEXT,
  natureza_juridica TEXT, codigo_natureza_juridica TEXT, efr TEXT,
  fonte TEXT, consultado_em TEXT
);

CREATE TABLE IF NOT EXISTS cnpj_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  provedor TEXT DEFAULT 'brasilapi', token TEXT,
  validade_dias INTEGER DEFAULT 90, intervalo INTEGER DEFAULT 0,
  ativo INTEGER DEFAULT 1, atualizado_em TEXT
);

-- ============ REGRAS DE CÁLCULO (tela de Configurações) ============
-- Toda regra usada pelos motores vive aqui, editável. Nada de percentual
-- ou limiar escrito dentro da lógica de cálculo.
CREATE TABLE IF NOT EXISTS param_regras (
  grupo TEXT NOT NULL, chave TEXT NOT NULL,
  valor TEXT, tipo TEXT DEFAULT 'numero',      -- numero | percentual | texto | booleano
  label TEXT, descricao TEXT, unidade TEXT, ordem INTEGER DEFAULT 0,
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (grupo, chave)
);

-- Forma de cálculo de cada tributo atual: é isso que decide o que sai da
-- base econômica na reconstrução (item 8 da especificação do motor).
CREATE TABLE IF NOT EXISTS param_tributos (
  chave TEXT PRIMARY KEY, label TEXT,
  forma TEXT NOT NULL DEFAULT 'dentro',        -- 'dentro' = integra o preço | 'fora' = soma ao preço
  sai_da_base INTEGER DEFAULT 1,
  substituido INTEGER DEFAULT 1,               -- será substituído por IBS/CBS
  descricao TEXT, ordem INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS param_regimes (
  chave TEXT PRIMARY KEY, label TEXT,
  pis_cofins REAL,                             -- NULL = não estimar
  cumulativo INTEGER,
  credita_atual_piscofins INTEGER DEFAULT 0, credita_atual_icms INTEGER DEFAULT 0,
  credita_atual_ipi INTEGER DEFAULT 0,
  gera_atual_piscofins INTEGER DEFAULT 0, gera_atual_icms INTEGER DEFAULT 0,
  gera_atual_ipi INTEGER DEFAULT 0,
  credita_novo INTEGER DEFAULT 0, gera_credito_novo INTEGER DEFAULT 0,
  no_das INTEGER DEFAULT 0, credito_cbs_simples_referencia REAL,
  obs TEXT, ordem INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS param_reducoes (
  chave TEXT PRIMARY KEY, label TEXT,
  reducao REAL DEFAULT 0, especifico INTEGER DEFAULT 0,
  descricao TEXT, ordem INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS param_cfop (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo TEXT,            -- 3 últimos dígitos do CFOP
  prefixo TEXT,          -- 1º dígito (origem/destino da operação)
  natureza TEXT NOT NULL,
  prioridade INTEGER DEFAULT 2,   -- 1 avaliado primeiro, 3 por último
  descricao TEXT
);

CREATE TABLE IF NOT EXISTS param_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grupo TEXT, chave TEXT, valor_anterior TEXT, valor_novo TEXT,
  usuario TEXT, criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- ============ PARÂMETROS DO MOTOR (alíquotas e Simples) ============
-- Item 28: alíquotas NUNCA ficam no código. Vivem aqui e são editáveis.
CREATE TABLE IF NOT EXISTS param_aliquotas (
  ano INTEGER PRIMARY KEY,
  ibs REAL NOT NULL, cbs REAL NOT NULL,
  fator_icms_iss REAL DEFAULT 1, fator_pis_cofins REAL DEFAULT 1, fator_ipi REAL DEFAULT 1,
  compensavel INTEGER DEFAULT 0,
  calcular_ibs INTEGER DEFAULT 0,       -- fase CBS: IBS só entra quando habilitado
  simulacao INTEGER DEFAULT 1,          -- 1 = parametrizada para simulação
  fonte TEXT, nota TEXT,
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS param_simples (
  anexo TEXT NOT NULL, faixa INTEGER NOT NULL,
  anexo_nome TEXT, tipo TEXT,
  limite REAL, aliquota_nominal REAL, parcela_deduzir REAL,
  rep_irpj REAL, rep_csll REAL, rep_cofins REAL, rep_pis REAL,
  rep_cpp REAL, rep_icms_iss REAL, rep_ipi REAL DEFAULT 0,
  PRIMARY KEY (anexo, faixa)
);

-- ============ RESULTADOS DO MOTOR ============
CREATE TABLE IF NOT EXISTS motor_resultados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  movimento_id INTEGER, execucao_id INTEGER, cenario_id INTEGER,
  sentido TEXT, ano INTEGER,
  grupo_origem TEXT, fracao REAL DEFAULT 1,   -- fração do item nesta linha (expansão proporcional)
  status_classificacao TEXT, status_credito TEXT, natureza TEXT,
  preco_atual REAL, base_economica REAL,
  ibs REAL, cbs REAL, credito_ibs REAL, credito_cbs REAL,
  tipo_credito TEXT, modalidade_credito TEXT, status_credito_determinacao TEXT,
  movimento_hash TEXT, regra_version TEXT, catalogo_version TEXT, parceiro_version TEXT, parametro_version TEXT, motor_version TEXT,
  regime_cbs_emitente TEXT, regime_cbs_adquirente TEXT,
  preco_projetado REAL, custo_liquido REAL,
  cst TEXT, cclasstrib TEXT, tratamento TEXT,
  perfil_destinatario TEXT, sensibilidade TEXT,
  detalhe TEXT,                          -- JSON completo para rastreabilidade
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_motor ON motor_resultados(empresa_id, execucao_id, sentido);

-- Central persistida de exceções: o motor continua calculando tudo que tem
-- evidência suficiente e envia somente os casos não resolvidos para análise.
-- Não é uma nova decisão tributária; é a fila auditável dos fatos que exigem
-- evidência adicional ou validação humana.
CREATE TABLE IF NOT EXISTS excecoes_motor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  movimento_id INTEGER,
  execucao_id INTEGER,
  codigo TEXT NOT NULL,
  categoria TEXT NOT NULL,
  gravidade TEXT DEFAULT 'media',
  status TEXT DEFAULT 'ABERTA',
  natureza TEXT DEFAULT 'INDETERMINADO',
  origem TEXT DEFAULT 'MOTOR',
  valor_envolvido REAL DEFAULT 0,
  impacto_cbs_estimado REAL,
  materialidade REAL DEFAULT 0,
  detalhe TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  resolvido_em TEXT,
  UNIQUE(empresa_id, movimento_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_excecoes_motor_empresa_status ON excecoes_motor(empresa_id, status, materialidade DESC);

-- Fila durável local espelhada no Supabase. O worker sempre usa claim e
-- heartbeat; a memória da instância jamais é a fonte de verdade do job.
CREATE TABLE IF NOT EXISTS jobs_carteira (
  id TEXT PRIMARY KEY,
  processamento_id INTEGER,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia TEXT,
  tipo_job TEXT NOT NULL DEFAULT 'RECALCULO_INCREMENTAL',
  prioridade INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
  tentativas INTEGER NOT NULL DEFAULT 0,
  max_tentativas INTEGER NOT NULL DEFAULT 3,
  payload TEXT,
  worker_id TEXT,
  heartbeat TEXT,
  erro TEXT,
  proxima_tentativa_em TEXT,
  resultado TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  iniciado_em TEXT,
  finalizado_em TEXT,
  UNIQUE(processamento_id, empresa_id, competencia, tipo_job)
);
CREATE INDEX IF NOT EXISTS ix_jobs_carteira_status ON jobs_carteira(status, prioridade DESC, criado_em);
CREATE UNIQUE INDEX IF NOT EXISTS ux_jobs_carteira_ativo
  ON jobs_carteira(empresa_id, competencia, tipo_job)
  WHERE status IN ('PENDENTE','PROCESSANDO');

-- Processamento de carteira: persistimos o cabeçalho e cada empresa para que
-- a operação seja acompanhável e retomável, sem abrir 600 projetos um a um.
CREATE TABLE IF NOT EXISTS processamentos_carteira (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT DEFAULT 'RECALCULO',
  status TEXT DEFAULT 'AGENDADO',
  total_empresas INTEGER DEFAULT 0,
  processadas INTEGER DEFAULT 0,
  automaticas INTEGER DEFAULT 0,
  com_premissas INTEGER DEFAULT 0,
  com_excecoes INTEGER DEFAULT 0,
  bloqueadas INTEGER DEFAULT 0,
  iniciado_em TEXT, concluido_em TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS processamentos_carteira_itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  processamento_id INTEGER NOT NULL REFERENCES processamentos_carteira(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  status TEXT DEFAULT 'AGENDADA',
  motivo TEXT,
  itens_processados INTEGER DEFAULT 0,
  excecoes_abertas INTEGER DEFAULT 0,
  iniciado_em TEXT, concluido_em TEXT,
  UNIQUE(processamento_id, empresa_id)
);
CREATE INDEX IF NOT EXISTS ix_processamentos_carteira_itens_status ON processamentos_carteira_itens(processamento_id, status);

CREATE TABLE IF NOT EXISTS motor_execucoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  ano INTEGER, itens INTEGER DEFAULT 0,
  classificados INTEGER DEFAULT 0, requer_validacao INTEGER DEFAULT 0, sem_correspondencia INTEGER DEFAULT 0,
  resumo TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- ============ BASES DE CLASSIFICAÇÃO TRIBUTÁRIA ============
CREATE TABLE IF NOT EXISTS base_servicos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lc116 TEXT, nbs TEXT,
  descricao_item TEXT, descricao_nbs TEXT,
  onerosa TEXT, exterior TEXT,
  indop TEXT, local_incidencia TEXT,
  cclasstrib TEXT, nome_cclasstrib TEXT,
  reducao TEXT DEFAULT 'integral',
  operacao_pis_cofins TEXT, cst_pis_atual TEXT, cst_cofins_atual TEXT, pis_percentual REAL, cofins_percentual REAL,
  cumulatividade_obrigatoria TEXT, grau_determinacao TEXT, hipotese_legal_cumulativa TEXT, pis_cumulativo_percentual REAL, cofins_cumulativo_percentual REAL, total_cumulativo_percentual REAL, fundamento_cumulatividade TEXT, condicao_cumulatividade TEXT,
  regime_pis_cofins_receita TEXT, tratamento_pis_cofins TEXT, papel_na_cadeia_necessario TEXT, tratamento_efetivo_saida TEXT, natureza_reconstrucao TEXT, percentual_reconstrucao_sugerido REAL, regra_precedencia TEXT
);
CREATE INDEX IF NOT EXISTS ix_bserv_nbs ON base_servicos(nbs);
CREATE INDEX IF NOT EXISTS ix_bserv_lc ON base_servicos(lc116, nbs);

CREATE TABLE IF NOT EXISTS base_ncm (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncm TEXT NOT NULL, descricao TEXT,
  cst TEXT, cclasstrib TEXT, classificacao TEXT, anexo TEXT, fundamento TEXT,
  reducao_ibs REAL, reducao_cbs REAL, regra TEXT, fonte TEXT,
  candidatos INTEGER DEFAULT 1, reducao TEXT DEFAULT 'integral',
  operacao_pis_cofins TEXT, cst_pis_atual TEXT, cst_cofins_atual TEXT, pis_percentual REAL, cofins_percentual REAL,
  regime_pis_cofins_receita TEXT, tratamento_pis_cofins TEXT, papel_na_cadeia_necessario TEXT, papel_na_cadeia TEXT,
  tratamento_efetivo_saida TEXT, natureza_reconstrucao TEXT, percentual_reconstrucao_sugerido REAL, regra_precedencia TEXT
);
CREATE INDEX IF NOT EXISTS ix_bncm ON base_ncm(ncm);

CREATE TABLE IF NOT EXISTS base_decisoes (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave TEXT NOT NULL, tipo TEXT NOT NULL,
  cclasstrib TEXT, reducao TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (empresa_id, chave, tipo)
);

CREATE TABLE IF NOT EXISTS base_importacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT, arquivo TEXT, aba TEXT, registros INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- ============ FASE 2A — COBERTURA E ENQUADRAMENTO ============
-- Estas estruturas não calculam tributo. Elas guardam evidências, regras
-- condicionais e fotografia de cobertura para que o motor central possa ser
-- enriquecido sem criar uma segunda fonte de cálculo.
CREATE TABLE IF NOT EXISTS cadastro_produtos_mestre (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT NOT NULL UNIQUE,
  sku TEXT, gtin TEXT, descricao TEXT, ncm TEXT, cest TEXT, unidade TEXT,
  papel_cadeia TEXT DEFAULT 'INDETERMINADO', tratamento_conhecido TEXT,
  vigencia_inicio TEXT, vigencia_fim TEXT, origem TEXT, evidencia TEXT,
  status TEXT DEFAULT 'ATIVO', atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_cadastro_produtos_ncm ON cadastro_produtos_mestre(ncm);

CREATE TABLE IF NOT EXISTS cadastro_parceiros_mestre (
  cnpj TEXT PRIMARY KEY, razao_social TEXT, tipo TEXT, regime_atual TEXT, regime_cbs TEXT,
  simples INTEGER, mei INTEGER, governo INTEGER, esfera TEXT, produtor_rural INTEGER,
  cooperativa INTEGER, perfil_credito TEXT, vigencia_inicio TEXT, vigencia_fim TEXT,
  origem TEXT, evidencia TEXT, status TEXT DEFAULT 'ATIVO', versao INTEGER DEFAULT 1,
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_cadastro_parceiros_regime ON cadastro_parceiros_mestre(regime_atual, regime_cbs);

CREATE TABLE IF NOT EXISTS cadastro_servicos_mestre (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chave TEXT NOT NULL UNIQUE,
  codigo_interno TEXT, descricao TEXT, nbs TEXT, lc116 TEXT, municipio TEXT,
  natureza_servico TEXT, referencia_fiscal TEXT, tratamento_conhecido TEXT,
  condicoes TEXT, vigencia_inicio TEXT, vigencia_fim TEXT, origem TEXT,
  evidencia TEXT, status TEXT DEFAULT 'ATIVO', atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_cadastro_servicos_nbs ON cadastro_servicos_mestre(nbs);

CREATE TABLE IF NOT EXISTS regras_enquadramento (
  id TEXT PRIMARY KEY,
  familia TEXT NOT NULL, subfamilia TEXT, tipo_operacao TEXT, direcao TEXT,
  perfil_fornecedor TEXT, perfil_adquirente TEXT, regime_fornecedor TEXT,
  regime_adquirente TEXT, ncm TEXT, nbs TEXT, cclasstrib TEXT, cst TEXT,
  cfop TEXT, papel_cadeia TEXT, unidade TEXT, condicoes_obrigatorias TEXT,
  condicoes_excludentes TEXT, tratamento_resultante TEXT, formula_id TEXT,
  fundamento_legal TEXT, vigencia_inicio TEXT, vigencia_fim TEXT,
  prioridade INTEGER NOT NULL DEFAULT 0, versao INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'RASCUNHO', fonte TEXT, evidencia TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')), atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_regras_enquadramento_busca ON regras_enquadramento(status, familia, ncm, nbs, prioridade DESC);

CREATE TABLE IF NOT EXISTS hipoteses_credito_presumido (
  hipotese_id TEXT PRIMARY KEY, familia TEXT, tipo_operacao TEXT,
  perfil_fornecedor TEXT, perfil_adquirente TEXT, condicoes TEXT,
  base_calculo TEXT, percentual REAL, formula TEXT, limite TEXT,
  vigencia_inicio TEXT, vigencia_fim TEXT, fundamento_legal TEXT,
  cclasstrib TEXT, tipo_credito TEXT DEFAULT 'PRESUMIDO', status TEXT DEFAULT 'RASCUNHO',
  fonte TEXT, evidencia TEXT, atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS cobertura_fotografias (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  execucao_id INTEGER, tipo TEXT NOT NULL DEFAULT 'FASE_2A', dados TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_cobertura_fotografias_empresa ON cobertura_fotografias(empresa_id, criado_em DESC);

-- ============ BASE DE CONHECIMENTO (RAG) ============
CREATE TABLE IF NOT EXISTS conhecimento_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL, fonte TEXT, categoria TEXT DEFAULT 'geral',
  arquivo TEXT, empresa_id INTEGER, caracteres INTEGER DEFAULT 0,
  trechos INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS conhecimento_trechos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id INTEGER NOT NULL REFERENCES conhecimento_documentos(id) ON DELETE CASCADE,
  titulo TEXT, fonte TEXT, conteudo TEXT NOT NULL, ordem INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_trechos ON conhecimento_trechos(documento_id);

-- ============ ANÁLISE DE CONTRATOS POR IA ============
CREATE TABLE IF NOT EXISTS contrato_analises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER REFERENCES contratos(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  arquivo TEXT, tipo_arquivo TEXT, caracteres INTEGER DEFAULT 0,
  texto_extraido TEXT, resultado TEXT, fontes TEXT,
  modelo TEXT, tokens_entrada INTEGER DEFAULT 0, tokens_saida INTEGER DEFAULT 0,
  status TEXT DEFAULT 'concluida', mensagem TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_analises ON contrato_analises(empresa_id, contrato_id);

CREATE TABLE IF NOT EXISTS ia_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  api_key TEXT, modelo TEXT DEFAULT 'claude-sonnet-5', atualizado_em TEXT
);

-- ============ INTEGRAÇÃO QUESTOR ============
CREATE TABLE IF NOT EXISTS questor_config (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  base_url TEXT, token TEXT, ativo INTEGER DEFAULT 0,
  endpoints TEXT, atualizado_em TEXT
);
CREATE TABLE IF NOT EXISTS questor_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER, endpoint TEXT, metodo TEXT,
  status TEXT, mensagem TEXT, registros INTEGER DEFAULT 0,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
`);

// --------------------------------------------------------------------------
// SEED — catálogo de serviços conforme a Cartilha do Produto
// --------------------------------------------------------------------------
const CATALOGO = [
  ['DIAG-01', 'Diagnóstico', 'Perfil Tributário da Empresa',
   'Levantamento do regime vigente, carga tributária efetiva, histórico de recolhimentos, composição das receitas e projeção das operações para os próximos 12 meses.',
   'Relatório de perfil tributário; painel de carga efetiva', 3800, 'projeto', 20, 0, 1],
  ['DIAG-02', 'Diagnóstico', 'Análise da Cadeia de Fornecedores',
   'Mapeamento dos fornecedores por regime, produtos/serviços e representatividade financeira; impacto no aproveitamento de créditos e na formação do custo.',
   'Curva ABC de fornecedores; matriz de risco de crédito; pauta de renegociação', 4200, 'projeto', 25, 0, 2],
  ['DIAG-03', 'Diagnóstico', 'Análise da Cadeia de Clientes',
   'Classificação da carteira (PF, PJ e órgãos públicos) e avaliação do impacto por perfil, com leitura de sensibilidade a repasse de preço.',
   'Segmentação da carteira; análise de sensibilidade; recomendações comerciais', 3600, 'projeto', 20, 0, 3],
  ['DIAG-04', 'Diagnóstico', 'Projeção de Cenários',
   'Simulação da carga tributária efetiva ano a ano (2026-2033), comparação entre regimes e projeção de impactos financeiros.',
   'Simulações tributárias; cenários projetados; comparativo de regimes', 4800, 'projeto', 25, 0, 4],
  ['DIAG-05', 'Diagnóstico', 'Enquadramento Tributário (cClassTrib, NBS e CST)',
   'Análise das classificações fiscais utilizadas e adequação às exigências do novo modelo.',
   'Relatório de enquadramento; plano de correção de cadastros', 3200, 'projeto', 20, 0, 5],
  ['DIAG-06', 'Diagnóstico', 'Conformidade Fiscal de Documentos',
   'Avaliação de NF-e, NFS-e, NFC-e, NF-e ABI e CT-e frente aos novos leiautes e campos de IBS/CBS.',
   'Relatório de conformidade documental; plano de adequação de sistemas', 3400, 'projeto', 20, 0, 6],
  ['ACOMP-01', 'Acompanhamento', 'Acompanhamento do Planejamento',
   'Monitoramento contínuo das premissas do diagnóstico: mudanças na cadeia, na carteira e na carga efetiva, com comparativo previsto x realizado.',
   'Relatório mensal de acompanhamento; comparativo previsto x realizado; recomendações de ajuste', 1900, 'mensal', 30, 1, 7],
  ['PREC-01', 'Precificação', 'Precificação e Margem',
   'Reposicionamento de preços frente ao novo IVA, recomposição de margem bruta e simulação por item/família.',
   'Simulação de preços; estudo de margens; recomendação de reposicionamento', 5200, 'projeto', 30, 0, 8],
  ['PREC-02', 'Precificação', 'Política Comercial de Transição',
   'Desenho da régua de repasse por perfil de cliente e por ano da transição, com argumentação comercial.',
   'Política de repasse; matriz de repasse por perfil; material de apoio comercial', 3800, 'projeto', 25, 0, 9],
  ['CONT-01', 'Contratos', 'Revisão de Contratos',
   'Revisão de contratos de compra, fornecimento e venda, com sugestão de cláusulas de repasse de tributos, responsabilidade e reequilíbrio.',
   'Relatório de revisão contratual; sugestões de cláusulas; parecer técnico', 4600, 'projeto', 30, 0, 10],
  ['CAP-01', 'Capacitação', 'Workshop Prático (Compras, Fiscal, Suprimentos e Pricing)',
   'Treinamento aplicado com estudos de caso e revisão dos processos internos de compras e vendas.',
   'Workshop de 8h; material didático; estudos de caso', 4400, 'turma', 15, 0, 11],
  ['CAP-02', 'Capacitação', 'Workshop de Boas Práticas (institucional)',
   'Treinamento institucional sobre o funcionamento do novo IVA e impactos em compras e vendas.',
   'Workshop de 4h; material institucional', 2800, 'turma', 15, 0, 12],
];

const seedServicos = db.prepare(`INSERT OR IGNORE INTO servicos
  (codigo, modulo, nome, descricao, entregaveis, preco, unidade, prazo_dias, recorrente, ordem)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
db.transaction(() => CATALOGO.forEach((s) => seedServicos.run(...s)))();
// Chaves de entrega são estáveis mesmo que nome, preço ou módulo comercial
// sejam alterados. Elas definem o que o plano aprovado libera.
const chavesPadrao = {
  'DIAG-01': 'diagnostico', 'DIAG-02': 'diagnostico', 'DIAG-03': 'diagnostico',
  'DIAG-04': 'diagnostico', 'DIAG-05': 'diagnostico', 'DIAG-06': 'diagnostico',
  'PREC-01': 'precificacao', 'PREC-02': 'precificacao', 'CONT-01': 'contratos',
  'CAP-02': 'treinamento_boas_praticas', 'CAP-01': 'capacitacao_operacional',
  'ACOMP-01': 'acompanhamento',
};
const atualizaChaveServico = db.prepare("UPDATE servicos SET chave_entrega=? WHERE codigo=? AND (chave_entrega IS NULL OR chave_entrega='' OR chave_entrega='outro')");
db.transaction(() => Object.entries(chavesPadrao).forEach(([codigo, chave]) => atualizaChaveServico.run(chave, codigo)))();

// Combos padrão
const combosSeed = [
  ['Diagnóstico Completo', 'Todas as seis frentes do Módulo 1 — a fotografia integral do impacto da reforma na empresa.', 0.10, 1,
   ['DIAG-01', 'DIAG-02', 'DIAG-03', 'DIAG-04', 'DIAG-05', 'DIAG-06']],
  ['Implementação Integral', 'Diagnóstico + Precificação + Contratos + Capacitação + Acompanhamento. O produto completo da cartilha.', 0.18, 1,
   ['DIAG-01', 'DIAG-02', 'DIAG-03', 'DIAG-04', 'DIAG-05', 'DIAG-06', 'ACOMP-01', 'PREC-01', 'PREC-02', 'CONT-01', 'CAP-01', 'CAP-02']],
  ['Essencial', 'Perfil tributário, cadeias de fornecedores e clientes e projeção de cenários — o mínimo para decidir.', 0.08, 0,
   ['DIAG-01', 'DIAG-02', 'DIAG-03', 'DIAG-04']],
  ['Margem Protegida', 'Foco em rentabilidade: projeção de cenários, precificação e política comercial de transição.', 0.10, 0,
   ['DIAG-04', 'PREC-01', 'PREC-02']],
  ['Blindagem Contratual', 'Revisão de contratos apoiada pela análise das cadeias de fornecedores e clientes.', 0.10, 0,
   ['DIAG-02', 'DIAG-03', 'CONT-01']],
  ['Time Preparado', 'Os dois workshops com o perfil tributário como base para os estudos de caso.', 0.10, 0,
   ['DIAG-01', 'CAP-01', 'CAP-02']],
];
if (db.prepare('SELECT COUNT(*) c FROM combos').get().c === 0) {
  const insCombo = db.prepare('INSERT INTO combos (nome, descricao, desconto, destaque) VALUES (?,?,?,?)');
  const insItem = db.prepare('INSERT OR IGNORE INTO combo_itens (combo_id, servico_id) VALUES (?,?)');
  const getServ = db.prepare('SELECT id FROM servicos WHERE codigo = ?');
  db.transaction(() => {
    for (const [nome, desc, descto, destaque, codigos] of combosSeed) {
      const { lastInsertRowid } = insCombo.run(nome, desc, descto, destaque);
      codigos.forEach((c) => { const s = getServ.get(c); if (s) insItem.run(lastInsertRowid, s.id); });
    }
  })();
}

// Produtos comerciais iniciais. Não substituem os demais combos nem travam a
// configuração: são apenas a base editável solicitada para Basic, Pro e Master.
const planosIniciais = [
  ['Plano Basic', 'Diagnóstico + precificação + Treinamento Boas Práticas.', ['DIAG-01', 'DIAG-02', 'DIAG-03', 'DIAG-04', 'DIAG-05', 'DIAG-06', 'PREC-01', 'PREC-02', 'CAP-02']],
  ['Plano Pro', 'Diagnóstico + precificação + revisão de contratos + Treinamento Boas Práticas.', ['DIAG-01', 'DIAG-02', 'DIAG-03', 'DIAG-04', 'DIAG-05', 'DIAG-06', 'PREC-01', 'PREC-02', 'CONT-01', 'CAP-02']],
  ['Plano Master', 'Diagnóstico + precificação + contratos + Treinamento Boas Práticas + Capacitação Operacional.', ['DIAG-01', 'DIAG-02', 'DIAG-03', 'DIAG-04', 'DIAG-05', 'DIAG-06', 'PREC-01', 'PREC-02', 'CONT-01', 'CAP-02', 'CAP-01']],
];
const comboPorNome = db.prepare('SELECT id FROM combos WHERE nome=? ORDER BY id LIMIT 1');
const criaComboBase = db.prepare('INSERT INTO combos (nome, descricao, desconto, destaque, acompanhamento_meses) VALUES (?,?,?,?,?)');
const vinculaItemBase = db.prepare('INSERT OR IGNORE INTO combo_itens (combo_id, servico_id) VALUES (?,?)');
const servicoPorCodigoPlano = db.prepare('SELECT id FROM servicos WHERE codigo=?');
db.transaction(() => {
  for (const [nome, descricao, codigos] of planosIniciais) {
    let combo = comboPorNome.get(nome);
    if (!combo) combo = { id: criaComboBase.run(nome, descricao, 0, 1, 3).lastInsertRowid };
    for (const codigo of codigos) { const serv = servicoPorCodigoPlano.get(codigo); if (serv) vinculaItemBase.run(combo.id, serv.id); }
  }
})();
// Catálogo anterior substituído pelos três planos oficiais. Mantemos os
// registros inativos para não quebrar propostas e históricos antigos.
const combosSubstituidos = ['Diagnóstico Completo', 'Implementação Integral', 'Essencial', 'Margem Protegida', 'Blindagem Contratual', 'Time Preparado'];
const desativaComboSubstituido = db.prepare('UPDATE combos SET ativo=0 WHERE nome=?');
db.transaction(() => combosSubstituidos.forEach((nome) => desativaComboSubstituido.run(nome)))();

if (!db.prepare('SELECT COUNT(*) c FROM questor_config').get().c) {
  db.prepare(`INSERT INTO questor_config (id, base_url, token, ativo, endpoints, atualizado_em)
    VALUES (1, 'http://localhost:8080', '', 0, ?, datetime('now','localtime'))`)
    .run(JSON.stringify(require('./config/questorEndpoints')));
}

if (!db.prepare('SELECT COUNT(*) c FROM ia_config').get().c) {
  db.prepare(`INSERT INTO ia_config (id, api_key, modelo, atualizado_em)
    VALUES (1, '', 'claude-sonnet-5', datetime('now','localtime'))`).run();
}

// Semente da base de conhecimento (só na primeira execução)
if (db.prepare('SELECT COUNT(*) c FROM conhecimento_documentos').get().c === 0) {
  const base = require('./config/conhecimentoBase');
  const insDoc = db.prepare(`INSERT INTO conhecimento_documentos (titulo, fonte, categoria, caracteres, trechos)
    VALUES (?,?,?,?,?)`);
  const insTre = db.prepare('INSERT INTO conhecimento_trechos (documento_id, titulo, fonte, conteudo, ordem) VALUES (?,?,?,?,?)');
  const fatiar = (t, tam = 1200) => {
    const limpo = String(t).trim();
    if (limpo.length <= tam) return [limpo];
    const out = []; let i = 0;
    while (i < limpo.length) {
      let fim = Math.min(i + tam, limpo.length);
      if (fim < limpo.length) {
        const corte = limpo.slice(i, fim).lastIndexOf('\n\n');
        if (corte > tam * 0.5) fim = i + corte;
      }
      out.push(limpo.slice(i, fim).trim());
      i = fim - (fim < limpo.length ? 200 : 0);
    }
    return out.filter(Boolean);
  };
  db.transaction(() => {
    for (const d of base) {
      const pedacos = fatiar(d.conteudo);
      const r = insDoc.run(d.titulo, d.fonte, d.categoria, d.conteudo.length, pedacos.length);
      pedacos.forEach((p, i) => insTre.run(r.lastInsertRowid, d.titulo, d.fonte, p, i));
    }
  })();
}

// Parâmetros de alíquotas (item 28): semeados a partir do cronograma e
// editáveis pelo sistema. O motor lê SEMPRE desta tabela.
if (db.prepare('SELECT COUNT(*) c FROM param_aliquotas').get().c === 0) {
  const P = require('./config/parametros');
  const ins = db.prepare(`INSERT INTO param_aliquotas (ano, ibs, cbs, fator_icms_iss,
    fator_pis_cofins, fator_ipi, compensavel, simulacao, fonte, nota) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const ano of P.ANOS) {
      const c = P.CRONOGRAMA[ano];
      ins.run(ano, c.ibs, c.cbs, c.fatorIcmsIss, c.fatorPisCofins, c.fatorIpi,
        c.compensavel ? 1 : 0, 1, 'EC 132/2023 + estimativa MF', c.nota);
    }
  })();
}

if (db.prepare('SELECT COUNT(*) c FROM param_simples').get().c === 0) {
  const { ANEXOS } = require('./config/tabelasSimples');
  const ins = db.prepare(`INSERT INTO param_simples (anexo, faixa, anexo_nome, tipo, limite,
    aliquota_nominal, parcela_deduzir, rep_irpj, rep_csll, rep_cofins, rep_pis, rep_cpp, rep_icms_iss, rep_ipi)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  db.transaction(() => {
    for (const [chave, a] of Object.entries(ANEXOS)) {
      for (const [faixa, limite, nominal, deduzir, rep] of a.faixas) {
        ins.run(chave, faixa, a.nome, a.tipo, limite, nominal, deduzir,
          rep.irpj, rep.csll, rep.cofins, rep.pis, rep.cpp, rep.icms_iss, rep.ipi || 0);
      }
    }
  })();
}

// --------------------------------------------------------------------------
// SEMENTE DAS REGRAS DE CÁLCULO
// --------------------------------------------------------------------------
// Os arquivos de src/config são a semente; a partir daqui o banco é a fonte
// da verdade e os motores leem de lá via services/regras.js.
if (db.prepare('SELECT COUNT(*) c FROM param_tributos').get().c === 0) {
  const ins = db.prepare(`INSERT INTO param_tributos (chave, label, forma, sai_da_base, substituido, descricao, ordem)
    VALUES (?,?,?,?,?,?,?)`);
  const T = [
    ['icms', 'ICMS', 'dentro', 1, 1, 'Calculado por dentro: integra a própria base e o preço da mercadoria. Sai da base econômica.', 1],
    ['iss', 'ISS', 'dentro', 1, 1, 'Calculado por dentro: integra o preço do serviço. Sai da base econômica.', 2],
    ['pis', 'PIS', 'dentro', 1, 1, 'Integra o preço. Quando não destacado, é estimado pela alíquota do regime.', 3],
    ['cofins', 'COFINS', 'dentro', 1, 1, 'Integra o preço. Quando não destacado, é estimado pela alíquota do regime.', 4],
    ['ipi', 'IPI', 'fora', 0, 1, 'Calculado por fora: soma ao preço da mercadoria, nunca esteve dentro dele. NÃO sai da base econômica.', 5],
    ['icms_st', 'ICMS-ST', 'fora', 0, 0, 'Substituição tributária: soma ao valor da nota e não compõe o preço da mercadoria. NÃO sai da base econômica.', 6],
  ];
  db.transaction(() => T.forEach((t) => ins.run(...t)))();
}

if (db.prepare('SELECT COUNT(*) c FROM param_regimes').get().c === 0) {
  const P = require('./config/parametros');
  const ins = db.prepare(`INSERT INTO param_regimes (chave, label, pis_cofins, cumulativo,
    credita_atual_piscofins, credita_atual_icms, credita_atual_ipi,
    gera_atual_piscofins, gera_atual_icms, gera_atual_ipi,
    credita_novo, gera_credito_novo, no_das, obs, ordem) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  let i = 0;
  db.transaction(() => {
    for (const [chave, r] of Object.entries(P.REGIMES)) {
      ins.run(chave, r.label, r.pisCofins === null ? null : r.pisCofins,
        r.cumulativo === null ? null : (r.cumulativo ? 1 : 0),
        r.creditaAtual.pisCofins ? 1 : 0, r.creditaAtual.icms ? 1 : 0, r.creditaAtual.ipi ? 1 : 0,
        r.geraCreditoAtual.pisCofins ? 1 : 0, r.geraCreditoAtual.icms ? 1 : 0, r.geraCreditoAtual.ipi ? 1 : 0,
        r.creditaNovo ? 1 : 0, r.geraCreditoNovo ? 1 : 0,
        ['simples_nacional', 'mei'].includes(chave) ? 1 : 0, r.obs || '', i++);
    }
  })();
}

if (db.prepare('SELECT COUNT(*) c FROM param_reducoes').get().c === 0) {
  const P = require('./config/parametros');
  const ins = db.prepare('INSERT INTO param_reducoes (chave, label, reducao, especifico, descricao, ordem) VALUES (?,?,?,?,?,?)');
  let i = 0;
  db.transaction(() => {
    for (const [chave, r] of Object.entries(P.REDUCOES)) {
      ins.run(chave, r.label, r.reducao, r.especifico ? 1 : 0, r.desc || '', i++);
    }
  })();
}

if (db.prepare('SELECT COUNT(*) c FROM param_cfop').get().c === 0) {
  const ins = db.prepare('INSERT INTO param_cfop (grupo, prefixo, natureza, prioridade, descricao) VALUES (?,?,?,?,?)');
  db.transaction(() => {
    // Prioridade 1 — o PRIMEIRO dígito define operação com o exterior e
    // precisa ser avaliado antes dos grupos: 5102 é venda interna, não
    // importação, ainda que os três últimos dígitos coincidam com 3102.
    ins.run(null, '3', 'importacao', 1, 'Entrada do exterior');
    ins.run(null, '7', 'exportacao', 1, 'Saída para o exterior');
    // Prioridade 2 — natureza pelos três últimos dígitos
    const G = {
      remessa: ['901','902','903','904','905','906','907','908','909','910','911','912','913','914','915','916','917','920','921','922','923','924','925'],
      devolucao: ['201','202','208','209','210','410','411','412','413','503','553'],
      transferencia: ['151','152','153','154','408','409','658','659'],
      ativo_consumo: ['406','407','551','552','556','557'],
    };
    for (const [nat, lista] of Object.entries(G)) lista.forEach((g) => ins.run(g, null, nat, 2, ''));
    // Prioridade 3 — sentido geral da operação
    ins.run(null, '5', 'venda', 3, 'Saída dentro do estado');
    ins.run(null, '6', 'venda', 3, 'Saída para outro estado');
    ins.run(null, '1', 'aquisicao', 3, 'Entrada de dentro do estado');
    ins.run(null, '2', 'aquisicao', 3, 'Entrada de outro estado');
  })();
}

if (db.prepare('SELECT COUNT(*) c FROM param_regras').get().c === 0) {
  const ins = db.prepare(`INSERT INTO param_regras (grupo, chave, valor, tipo, label, descricao, unidade, ordem)
    VALUES (?,?,?,?,?,?,?,?)`);
  const R = [
    // --- limiares de leitura e classificação de resultado
    ['limiares', 'sensibilidade_alta', '0.15', 'percentual', 'Sensibilidade ALTA ao crédito',
     'Proporção do crédito sobre o preço projetado a partir da qual o crédito passa a ser decisivo para o cliente.', '% do preço', 1],
    ['limiares', 'sensibilidade_media', '0.07', 'percentual', 'Sensibilidade MÉDIA ao crédito',
     'Abaixo deste patamar a importância do crédito é classificada como baixa.', '% do preço', 2],
    ['limiares', 'risco_alto_participacao', '0.15', 'percentual', 'Risco ALTO — participação',
     'Participação sobre o volume analisado que classifica um risco como alto no Mapa de riscos.', '% do volume', 3],
    ['limiares', 'risco_medio_participacao', '0.05', 'percentual', 'Risco MÉDIO — participação',
     'Participação mínima para classificar um risco como médio.', '% do volume', 4],
    ['limiares', 'tolerancia_conferencia', '0.02', 'numero', 'Tolerância da conferência',
     'Diferença máxima, em reais, entre o IBS/CBS declarado no documento e o projetado pelo motor para considerar que confere.', 'R$', 5],
    ['limiares', 'margem_perda_relevante', '0.02', 'percentual', 'Perda de margem relevante',
     'Queda de margem bruta a partir da qual a precificação alerta sobre corrosão.', 'p.p.', 6],
    ['limiares', 'reajuste_relevante', '0.03', 'percentual', 'Reajuste relevante',
     'Reajuste necessário a partir do qual a precificação recomenda planejamento em degraus.', '% do preço', 7],
    // --- padrões usados quando o documento não traz o valor
    ['padroes', 'icms_interno', '0.18', 'percentual', 'ICMS interno presumido',
     'Alíquota usada para estimar o ICMS quando a operação não traz o valor destacado.', '%', 1],
    ['padroes', 'icms_interestadual', '0.12', 'percentual', 'ICMS interestadual presumido', '', '%', 2],
    ['padroes', 'iss', '0.03', 'percentual', 'ISS presumido',
     'Alíquota usada para estimar o ISS quando o documento não a informa.', '%', 3],
    ['padroes', 'ipi', '0', 'percentual', 'IPI presumido', '', '%', 4],
    ['padroes', 'simples_efetivo', '0.08', 'percentual', 'Alíquota efetiva média do Simples',
     'Usada apenas como estimativa grosseira quando não há faixa nem faturamento. A simulação por faixas é sempre preferível.', '%', 5],
    ['padroes', 'simples_parcela_creditavel', '0.35', 'percentual', 'Parcela creditável do DAS',
     'Fração da alíquota efetiva do Simples que corresponde a tributos sobre consumo (ICMS/ISS/PIS/COFINS) e pode virar crédito.', '% do DAS', 6],
    ['padroes', 'proporcao_pis', '0.1757', 'percentual', 'Proporção do PIS no bloco PIS+COFINS',
     'Usada para separar PIS de COFINS quando só se conhece o total do bloco.', '%', 7],
    ['padroes', 'cbs_no_das', '0.35', 'percentual', 'Parcela do crédito do Simples atribuída à CBS',
     'Divisão entre CBS e IBS do valor embutido no DAS transmitido ao adquirente.', '%', 8],
  ];
  db.transaction(() => R.forEach((r) => ins.run(...r)))();
}
db.prepare(`INSERT OR IGNORE INTO param_regras (grupo,chave,valor,tipo,label,descricao,unidade,ordem)
  VALUES ('capacitacao','limite_padrao_turma','30','numero','Limite padrão de participantes','Sugestão aplicada ao programar uma nova turma; cada turma pode ter seu próprio limite.','pessoas',1)`).run();

if (!db.prepare('SELECT COUNT(*) c FROM cnpj_config').get().c) {
  db.prepare(`INSERT INTO cnpj_config (id, provedor, token, validade_dias, ativo, atualizado_em)
    VALUES (1, 'brasilapi', '', 90, 1, datetime('now','localtime'))`).run();
}

/**
 * CARGA INICIAL A PARTIR DE dados/seed.sql
 * ---------------------------------------------------------------------------
 * O sistema é distribuído com um dump em TEXTO, não com o arquivo .db binário.
 * Arquivo SQLite binário não sobrevive bem a zip, transferência entre sistemas
 * e antivírus — corrompe com facilidade ("database disk image is malformed").
 * Texto atravessa tudo isso sem risco e ainda comprime melhor.
 *
 * O dump é aplicado uma única vez, quando o banco está vazio. Depois disso o
 * arquivo pode ser apagado; para recomeçar do zero, apague o reforma.db e
 * reinicie.
 */
const SEED = path.join(DIR, 'seed.sql');
if (fs.existsSync(SEED) && db.prepare('SELECT COUNT(*) c FROM empresas').get().c === 0) {
  try {
    const sql = fs.readFileSync(SEED, 'utf8');
    db.exec(sql);
    const n = db.prepare('SELECT COUNT(*) c FROM movimentos').get().c;
    console.log(`  carga inicial aplicada: ${n} lançamentos de dados/seed.sql`);
  } catch (e) {
    // O dump abre uma transação. Se algo falhar no meio, ela fica aberta e
    // contamina toda a sessão seguinte com "cannot start a transaction within
    // a transaction" — um erro que aparece longe da causa e confunde.
    // Aqui não basta tentar o ROLLBACK: é preciso CONFIRMAR que a sessão
    // ficou limpa, porque um rollback que falhou em silêncio é pior que o
    // erro original.
    for (let i = 0; i < 3; i++) {
      try { db.exec('ROLLBACK'); } catch (_) { /* nada aberto */ }
      try { db.exec('BEGIN'); db.exec('COMMIT'); break; }   // prova de sessão limpa
      catch (_) { /* ainda em transação: tenta de novo */ }
    }
    console.error('  falha ao aplicar dados/seed.sql:', e.message);
  }
}

// Em banco recém-criado as tabelas só passam a existir depois da primeira
// chamada no início deste arquivo. Executar de novo aqui garante que as
// colunas evolutivas também sejam incluídas na primeira inicialização.
migrarEsquema();

module.exports = db;
