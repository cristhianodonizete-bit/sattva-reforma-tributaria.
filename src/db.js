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
  lotes: {
    tipo_arquivo: 'TEXT', hash_sha256: 'TEXT', competencia_inicio: 'TEXT', competencia_fim: 'TEXT',
    cnpj_arquivo: 'TEXT', status_importacao: 'TEXT',
  },
  enriquecimento_pis_cofins_evidencias: {
    tipo_fonte: 'TEXT', lote_origem_id: 'INTEGER', hash_lineage: 'TEXT', numero_documento: 'TEXT', serie: 'TEXT',
    base_pis: 'REAL', base_cofins: 'REAL', aliquota_pis: 'REAL', aliquota_cofins: 'REAL',
    natureza_credito: 'TEXT', condicao_credito: 'TEXT', grau_confianca: 'TEXT',
  },
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
    lc116: 'TEXT',
    normalizacao_status: 'TEXT', normalizacao_pendencia: 'TEXT', normalizacao_evidencia: 'TEXT',
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
    pis_cofins_documentado: 'INTEGER DEFAULT 0', produto_empresa_id: 'INTEGER',
  },
  motor_resultados: {
    cenario_id: 'INTEGER', grupo_origem: 'TEXT', fracao: 'REAL DEFAULT 1',
    tipo_credito: 'TEXT', modalidade_credito: 'TEXT', status_credito_determinacao: 'TEXT', regime_cbs_emitente: 'TEXT', regime_cbs_adquirente: 'TEXT',
    movimento_hash: 'TEXT', regra_version: 'TEXT', catalogo_version: 'TEXT', parceiro_version: 'TEXT', parametro_version: 'TEXT', motor_version: 'TEXT',
    estado_autonomia: 'TEXT', codigo_causa: 'TEXT', origem_resolucao: 'TEXT', evidencia_utilizada: 'TEXT', regra_vencedora: 'TEXT',
    requer_intervencao_humana: 'INTEGER DEFAULT 0', motivo_intervencao: 'TEXT',
    autonomia_calculo_cbs_propria: 'INTEGER', autonomia_credito_entrada: 'INTEGER', autonomia_credito_cliente: 'INTEGER',
    autonomia_classificatoria: 'TEXT', autonomia_diagnostico_completo: 'INTEGER', memoria_autonomia_dimensoes: 'TEXT',
  },
  jobs_carteira: { proxima_tentativa_em: 'TEXT', resultado: 'TEXT' },
  param_regimes: { credito_cbs_simples_referencia: 'REAL' },
  param_irpj_csll_versionados: {
    limite_receita_anual: 'REAL',
    acrescimo_percentual_base_excedente: 'REAL',
    aplicacao_excedente: 'TEXT',
  },
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
  projeto_responsaveis: { usuario_id: 'TEXT' },
  turmas: { limite_participantes: 'INTEGER DEFAULT 30' },
  participantes: { empresa_id: 'INTEGER' },
  empresa_servicos_fiscais: {
    pis_cofins: 'REAL', das_efetivo: 'REAL', iss_aliquota: 'REAL', ativo: 'INTEGER DEFAULT 1', origem: "TEXT DEFAULT 'manual'",
  },
  empresa_produto_fiscal: { produto_empresa_id: 'INTEGER', possui_sintetizador_voz: 'INTEGER', adaptado_para_pessoa_com_deficiencia: 'INTEGER', acionador_pressao: 'INTEGER' },
  empresa_produto_fiscal_historico: { produto_empresa_id: 'INTEGER' },
  pendencias_fiscais_produtos: { produto_empresa_id: 'INTEGER', regra_id: 'TEXT' },
  conflitos_fatos_fiscais: { produto_empresa_id: 'INTEGER' },
  formacao_custo_itens: { movimento_saida_id: 'INTEGER', despesas_variaveis: 'REAL DEFAULT 0' },
  regras_governo: { origem_linha: 'TEXT' },
  regras_enquadramento: {
    // A tabela já existia antes da chave de serviço. Acrescentar essas
    // colunas antes dos índices evita que uma base SQLite antiga impeça o
    // servidor de iniciar após a atualização.
    ncm: 'TEXT', nbs: 'TEXT', lc116: 'TEXT',
    regime_pis_cofins: 'TEXT', cst_pis: 'TEXT', cst_cofins: 'TEXT', pis_percentual: 'REAL', cofins_percentual: 'REAL',
  },
  base_ncm: {
    operacao_pis_cofins: 'TEXT', cst_pis_atual: 'TEXT', cst_cofins_atual: 'TEXT', pis_percentual: 'REAL', cofins_percentual: 'REAL',
    regime_pis_cofins_receita: 'TEXT', tratamento_pis_cofins: 'TEXT', papel_na_cadeia_necessario: 'TEXT', papel_na_cadeia: 'TEXT',
    tratamento_efetivo_saida: 'TEXT', natureza_reconstrucao: 'TEXT', percentual_reconstrucao_sugerido: 'REAL', regra_precedencia: 'TEXT',
  },
  base_servicos: {
    // Bancos legados anteriores ao catálogo LC 116 continuam válidos. Os
    // gatilhos incrementais usam a chave composta, portanto a coluna precisa
    // existir antes de criar índices e triggers que a referenciam.
    lc116: 'TEXT',
    operacao_pis_cofins: 'TEXT', cst_pis_atual: 'TEXT', cst_cofins_atual: 'TEXT', pis_percentual: 'REAL', cofins_percentual: 'REAL',
    cumulatividade_obrigatoria: 'TEXT', grau_determinacao: 'TEXT', hipotese_legal_cumulativa: 'TEXT', pis_cumulativo_percentual: 'REAL', cofins_cumulativo_percentual: 'REAL', total_cumulativo_percentual: 'REAL', fundamento_cumulatividade: 'TEXT', condicao_cumulatividade: 'TEXT',
    regime_pis_cofins_receita: 'TEXT', tratamento_pis_cofins: 'TEXT', papel_na_cadeia_necessario: 'TEXT', tratamento_efetivo_saida: 'TEXT', natureza_reconstrucao: 'TEXT', percentual_reconstrucao_sugerido: 'REAL', regra_precedencia: 'TEXT',
  },
  empresas: { cnaes_secundarios: 'TEXT' },
  cnpj_cache: { natureza_juridica: 'TEXT', codigo_natureza_juridica: 'TEXT', efr: 'TEXT', cnaes_secundarios: 'TEXT' },
  contratos: {
    nome: 'TEXT', moeda: "TEXT DEFAULT 'BRL'", periodicidade_reajuste: 'TEXT', tipo_relacao: 'TEXT',
    renovacao: 'TEXT', observacoes: 'TEXT', arquivo_origem: 'TEXT', status_analise: "TEXT DEFAULT 'NAO_INICIADA'", natureza_contrato: "TEXT DEFAULT 'INDETERMINADO'", natureza_contrato_origem: 'TEXT', natureza_contrato_evidencia: 'TEXT',
  },
  contrato_precificacao_vinculos: { pricing_simulacao_id: 'INTEGER' },
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
  uf TEXT, municipio TEXT, cnae TEXT, atividade TEXT, cnaes_secundarios TEXT,
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

-- Apurações históricas: o arquivo e cada afirmação extraída ficam separados.
-- A camada é somente de evidência para o Raio-X; jamais alimenta o motor CBS.
CREATE TABLE IF NOT EXISTS pis_cofins_apuracao_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL,
  tipo_documento TEXT NOT NULL,
  mime_type TEXT,
  conteudo_original BLOB NOT NULL,
  hash_sha256 TEXT NOT NULL,
  competencia_detectada TEXT,
  data_processamento TEXT NOT NULL,
  versao_modelo_extracao TEXT NOT NULL,
  status_processamento TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, hash_sha256)
);
CREATE INDEX IF NOT EXISTS ix_apuracao_documentos_empresa_competencia
  ON pis_cofins_apuracao_documentos(empresa_id, competencia_detectada DESC);

CREATE TABLE IF NOT EXISTS pis_cofins_apuracoes_historicas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  documento_id INTEGER NOT NULL REFERENCES pis_cofins_apuracao_documentos(id) ON DELETE CASCADE,
  competencia TEXT,
  regime_pis_cofins TEXT,
  receita_base REAL,
  pis_debito REAL, cofins_debito REAL,
  pis_credito REAL, cofins_credito REAL,
  pis_credito_utilizado REAL, cofins_credito_utilizado REAL,
  saldo_pis REAL, saldo_cofins REAL,
  pis_recolhido REAL, cofins_recolhida REAL,
  observacoes TEXT,
  status_validacao TEXT NOT NULL,
  divergencias TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(documento_id)
);
CREATE INDEX IF NOT EXISTS ix_apuracoes_historicas_empresa_competencia
  ON pis_cofins_apuracoes_historicas(empresa_id, competencia DESC);

CREATE TABLE IF NOT EXISTS pis_cofins_apuracao_campos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  apuracao_id INTEGER NOT NULL REFERENCES pis_cofins_apuracoes_historicas(id) ON DELETE CASCADE,
  campo TEXT NOT NULL,
  valor_extraido TEXT,
  origem_documento TEXT,
  pagina_ou_localizacao TEXT,
  rotulo_original TEXT,
  confianca REAL,
  metodo_extracao TEXT NOT NULL,
  status_validacao TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(apuracao_id, campo)
);

-- PGDAS enviado como documento (PDF/imagem) é mantido separado da planilha
-- estruturada. Só alimenta o perfil depois de revisão humana.
CREATE TABLE IF NOT EXISTS pgdas_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL,
  tipo_documento TEXT NOT NULL,
  mime_type TEXT,
  conteudo_original BLOB NOT NULL,
  hash_sha256 TEXT NOT NULL,
  competencia_detectada TEXT,
  data_processamento TEXT NOT NULL,
  metodo_extracao TEXT NOT NULL,
  status_processamento TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, hash_sha256)
);
CREATE INDEX IF NOT EXISTS ix_pgdas_documentos_empresa_competencia
  ON pgdas_documentos(empresa_id, competencia_detectada DESC);
CREATE TABLE IF NOT EXISTS pgdas_documento_campos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id INTEGER NOT NULL REFERENCES pgdas_documentos(id) ON DELETE CASCADE,
  campo TEXT NOT NULL,
  valor_extraido TEXT,
  rotulo_original TEXT,
  pagina_ou_localizacao TEXT,
  confianca REAL,
  metodo_extracao TEXT NOT NULL,
  status_validacao TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(documento_id, campo)
);

-- ============ DADOS COMPLEMENTARES DE DIAGNÓSTICO ============
-- Fatos e premissas informados. Não são lidos pelo motor fiscal nem
-- substituem documento fiscal já importado.
CREATE TABLE IF NOT EXISTS folhas_pagamento_competencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  valor_folha REAL NOT NULL CHECK(valor_folha >= 0),
  pro_labore REAL CHECK(pro_labore IS NULL OR pro_labore >= 0),
  origem TEXT NOT NULL DEFAULT 'MANUAL',
  referencia_arquivo TEXT,
  status_validacao TEXT NOT NULL DEFAULT 'PENDENTE',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, competencia)
);
CREATE INDEX IF NOT EXISTS ix_folhas_empresa_competencia ON folhas_pagamento_competencias(empresa_id, competencia DESC);

CREATE TABLE IF NOT EXISTS margens_operacionais_premissas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo_inicio TEXT NOT NULL,
  periodo_fim TEXT NOT NULL,
  margem_operacional_percentual REAL NOT NULL CHECK(margem_operacional_percentual >= 0 AND margem_operacional_percentual <= 100),
  origem TEXT NOT NULL DEFAULT 'MANUAL',
  natureza TEXT NOT NULL DEFAULT 'PREMISSA_INFORMADA',
  status_validacao TEXT NOT NULL DEFAULT 'PENDENTE',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, periodo_inicio, periodo_fim)
);
CREATE INDEX IF NOT EXISTS ix_margens_empresa_periodo ON margens_operacionais_premissas(empresa_id, periodo_inicio DESC, periodo_fim DESC);

CREATE TABLE IF NOT EXISTS receitas_sem_dfe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  competencia TEXT NOT NULL,
  tipo_receita TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL CHECK(valor >= 0),
  origem TEXT NOT NULL DEFAULT 'MANUAL',
  evidencia TEXT,
  status_validacao TEXT NOT NULL DEFAULT 'PENDENTE',
  chave_deduplicacao TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, chave_deduplicacao)
);
CREATE INDEX IF NOT EXISTS ix_receitas_sem_dfe_empresa_competencia ON receitas_sem_dfe(empresa_id, competencia DESC);

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

-- ============ MÓDULO 5 — ACOMPANHAMENTO ============
-- Baseline e realizado são fotografias independentes. Nenhuma delas altera o
-- motor ou reescreve a outra: a comparação apenas evidencia o desvio.
CREATE TABLE IF NOT EXISTS monitoring_baselines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL, data_aprovacao TEXT NOT NULL,
  origem TEXT NOT NULL, descricao TEXT, cenario_referencia TEXT,
  premissas_aprovadas TEXT, indicadores_aprovados TEXT NOT NULL,
  composicao_fornecedores TEXT, composicao_clientes TEXT,
  classificacoes_esperadas TEXT, recomendacoes_aprovadas TEXT,
  natureza TEXT NOT NULL DEFAULT 'CALCULADO', memoria TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, versao)
);
CREATE INDEX IF NOT EXISTS ix_monitoring_baselines_empresa ON monitoring_baselines(empresa_id, versao DESC);

CREATE TABLE IF NOT EXISTS monitoring_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo TEXT NOT NULL, origem TEXT NOT NULL, natureza TEXT NOT NULL DEFAULT 'REAL',
  indicadores_realizados TEXT NOT NULL, composicao_fornecedores TEXT,
  composicao_clientes TEXT, classificacoes_reais TEXT, cobertura_dados TEXT,
  memoria TEXT, criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, periodo, origem)
);
CREATE INDEX IF NOT EXISTS ix_monitoring_snapshots_empresa ON monitoring_snapshots(empresa_id, periodo DESC);

CREATE TABLE IF NOT EXISTS monitoring_comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  baseline_id INTEGER NOT NULL REFERENCES monitoring_baselines(id) ON DELETE RESTRICT,
  snapshot_id INTEGER NOT NULL REFERENCES monitoring_snapshots(id) ON DELETE CASCADE,
  status TEXT NOT NULL, memoria TEXT, criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(baseline_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS monitoring_deviations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comparison_id INTEGER NOT NULL REFERENCES monitoring_comparisons(id) ON DELETE CASCADE,
  metrica TEXT NOT NULL, tipo TEXT NOT NULL, baseline_valor REAL,
  realizado_valor REAL, diferenca_absoluta REAL, diferenca_percentual REAL,
  status TEXT NOT NULL, causa TEXT, evidencia TEXT, acao_sugerida TEXT,
  natureza TEXT NOT NULL DEFAULT 'CALCULADO', memoria TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_monitoring_deviations_comparison ON monitoring_deviations(comparison_id, tipo);

CREATE TABLE IF NOT EXISTS monitoring_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  desvio_id INTEGER NOT NULL REFERENCES monitoring_deviations(id) ON DELETE CASCADE,
  titulo TEXT NOT NULL, mensagem TEXT NOT NULL, prioridade TEXT NOT NULL,
  impacto TEXT, evidencia TEXT NOT NULL, natureza TEXT NOT NULL DEFAULT 'CALCULADO',
  status TEXT NOT NULL DEFAULT 'ABERTO', criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(desvio_id)
);
CREATE INDEX IF NOT EXISTS ix_monitoring_alerts_empresa ON monitoring_alerts(empresa_id, prioridade, status);

CREATE TABLE IF NOT EXISTS monitoring_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  desvio_id INTEGER NOT NULL REFERENCES monitoring_deviations(id) ON DELETE RESTRICT,
  acao TEXT NOT NULL, responsavel TEXT, prazo TEXT, prioridade TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ABERTA', evidencia TEXT NOT NULL, origem TEXT NOT NULL,
  criado_em TEXT DEFAULT (datetime('now','localtime')), atualizado_em TEXT
);
CREATE INDEX IF NOT EXISTS ix_monitoring_actions_empresa ON monitoring_actions(empresa_id, status, prazo);

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
CREATE INDEX IF NOT EXISTS ix_parceiros_empresa_tipo_descricao ON parceiros(empresa_id, tipo, descricao);

-- Quadro societário é evidência cadastral da empresa analisada. Percentual
-- nunca recebe valor por inferência: NULL significa que a API/documento não o informou.
CREATE TABLE IF NOT EXISTS empresa_qsa (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nome TEXT NOT NULL, documento TEXT, qualificacao TEXT, pais TEXT,
  percentual_participacao REAL, brasileiro INTEGER NOT NULL DEFAULT 1,
  fonte TEXT, consultado_em TEXT, origem TEXT NOT NULL DEFAULT 'consulta_cadastral',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, nome, documento, qualificacao)
);
CREATE INDEX IF NOT EXISTS ix_empresa_qsa_empresa ON empresa_qsa(empresa_id);

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
  descricao TEXT, ncm TEXT, nbs TEXT, lc116 TEXT, normalizacao_status TEXT, normalizacao_pendencia TEXT, normalizacao_evidencia TEXT, cfop TEXT, cst TEXT,
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
CREATE INDEX IF NOT EXISTS ix_mov_empresa_tipo_valor ON movimentos(empresa_id, tipo, valor DESC);
CREATE INDEX IF NOT EXISTS ix_mov_insc ON movimentos(empresa_id, inscr_federal);

CREATE TABLE IF NOT EXISTS lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT, arquivo TEXT, registros INTEGER DEFAULT 0,
  ignorados INTEGER DEFAULT 0, valor_total REAL DEFAULT 0,
  mensagens TEXT, origem TEXT DEFAULT 'planilha',
  tipo_arquivo TEXT, hash_sha256 TEXT, competencia_inicio TEXT, competencia_fim TEXT,
  cnpj_arquivo TEXT, status_importacao TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_lotes_efd_empresa_tipo_hash
  ON lotes(empresa_id, tipo_arquivo, hash_sha256)
  WHERE tipo_arquivo = 'EFD_CONTRIBUICOES' AND hash_sha256 IS NOT NULL;

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

-- Precificação independente: a base comercial não depende da movimentação do
-- diagnóstico. A composição é sempre explícita; NCM/NBS nunca são uma chave
-- de associação entre insumo e item de venda.
CREATE TABLE IF NOT EXISTS pricing_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL, descricao TEXT NOT NULL, natureza_item TEXT NOT NULL DEFAULT 'produto',
  ncm TEXT, nbs TEXT, lc116 TEXT, unidade TEXT,
  quantidade_producao REAL DEFAULT 1, valor_venda_atual REAL DEFAULT 0,
  custo_direto REAL DEFAULT 0, perfil_cliente TEXT, ativo INTEGER DEFAULT 1,
  origem TEXT DEFAULT 'IMPORTACAO', criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id,codigo,natureza_item)
);
CREATE INDEX IF NOT EXISTS ix_pricing_products_empresa ON pricing_products(empresa_id);

CREATE TABLE IF NOT EXISTS pricing_services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL, descricao TEXT NOT NULL, lc116 TEXT, nbs TEXT, unidade TEXT,
  quantidade_producao REAL DEFAULT 1, valor_venda_atual REAL DEFAULT 0,
  custo_direto REAL DEFAULT 0, perfil_cliente TEXT, ativo INTEGER DEFAULT 1,
  origem TEXT DEFAULT 'IMPORTACAO', criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id,codigo)
);
CREATE INDEX IF NOT EXISTS ix_pricing_services_empresa ON pricing_services(empresa_id);

CREATE TABLE IF NOT EXISTS pricing_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_saida_id INTEGER REFERENCES pricing_products(id) ON DELETE CASCADE,
  servico_saida_id INTEGER REFERENCES pricing_services(id) ON DELETE CASCADE,
  codigo_componente TEXT NOT NULL, descricao TEXT NOT NULL, tipo_componente TEXT NOT NULL,
  ncm TEXT, nbs TEXT, lc116 TEXT, cnpj_fornecedor TEXT, regime_fornecedor TEXT,
  quantidade REAL NOT NULL DEFAULT 1, custo_unitario_bruto REAL NOT NULL DEFAULT 0,
  perda_percentual REAL DEFAULT 0, ativo INTEGER DEFAULT 1,
  origem TEXT DEFAULT 'IMPORTACAO', criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_pricing_components_produto ON pricing_components(produto_saida_id);
CREATE INDEX IF NOT EXISTS ix_pricing_components_servico ON pricing_components(servico_saida_id);

CREATE TABLE IF NOT EXISTS pricing_import_batches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  arquivo TEXT, status TEXT NOT NULL, resumo TEXT, criado_em TEXT DEFAULT (datetime('now','localtime'))
);

-- Fotografia oficial do simulador. Outros módulos apenas leem esta saída;
-- eles nunca chamam o motor tributário em nome próprio.
CREATE TABLE IF NOT EXISTS pricing_simulacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  modo TEXT NOT NULL, parametros_json TEXT, resultados_json TEXT NOT NULL,
  origem TEXT NOT NULL DEFAULT 'MOTOR_FISCAL_OFICIAL', natureza TEXT NOT NULL DEFAULT 'CALCULADO',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_pricing_simulacoes_empresa ON pricing_simulacoes(empresa_id, id DESC);

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

-- Entrega 1 de Contratos: o documento original nunca é substituído pelo
-- texto extraído. Cláusulas, riscos e vínculos econômicos são camadas
-- independentes, rastreáveis e sem qualquer inferência tributária automática.
CREATE TABLE IF NOT EXISTS contrato_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  nome_original TEXT NOT NULL, mime_type TEXT, tipo_origem TEXT NOT NULL,
  conteudo_original BLOB, hash_original TEXT, tamanho_bytes INTEGER DEFAULT 0,
  texto_extraido TEXT, status_extracao TEXT DEFAULT 'PENDENTE',
  observacao_extracao TEXT, criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_contrato_documentos_contrato ON contrato_documentos(contrato_id);

CREATE TABLE IF NOT EXISTS contrato_clausulas_extraidas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id INTEGER NOT NULL REFERENCES contrato_documentos(id) ON DELETE CASCADE,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  ordem INTEGER NOT NULL, texto_original TEXT NOT NULL, localizacao TEXT NOT NULL,
  pagina INTEGER, secao TEXT, tema TEXT NOT NULL, confianca REAL DEFAULT 1,
  natureza TEXT NOT NULL DEFAULT 'EXTRAIDO', criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_contrato_clausulas_documento ON contrato_clausulas_extraidas(documento_id, ordem);

CREATE TABLE IF NOT EXISTS contrato_riscos_iniciais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  documento_id INTEGER NOT NULL REFERENCES contrato_documentos(id) ON DELETE CASCADE,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  clausula_id INTEGER REFERENCES contrato_clausulas_extraidas(id) ON DELETE SET NULL,
  codigo TEXT NOT NULL, risco TEXT NOT NULL, evidencia TEXT NOT NULL,
  impacto_potencial TEXT NOT NULL, nivel TEXT NOT NULL, fundamento TEXT NOT NULL,
  natureza TEXT NOT NULL DEFAULT 'INTERPRETADO', status TEXT DEFAULT 'ABERTO',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_contrato_riscos_documento ON contrato_riscos_iniciais(documento_id);

CREATE TABLE IF NOT EXISTS contrato_precificacao_vinculos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  tipo_item TEXT NOT NULL CHECK(tipo_item IN ('produto','servico')),
  item_precificacao_id INTEGER NOT NULL,
  pricing_simulacao_id INTEGER REFERENCES pricing_simulacoes(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE_CONFIRMACAO', origem TEXT NOT NULL DEFAULT 'EXPLICITO',
  observacoes TEXT, confirmado_em TEXT, criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(contrato_id,tipo_item,item_precificacao_id)
);

CREATE TABLE IF NOT EXISTS contrato_recomendacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  risco_id INTEGER REFERENCES contrato_riscos_iniciais(id) ON DELETE SET NULL,
  clausula_id INTEGER REFERENCES contrato_clausulas_extraidas(id) ON DELETE SET NULL,
  recomendacao TEXT NOT NULL, evidencia TEXT NOT NULL, impacto_potencial TEXT NOT NULL,
  prioridade TEXT NOT NULL CHECK(prioridade IN ('ALTA','MEDIA','BAIXA')),
  fundamento TEXT NOT NULL, natureza TEXT NOT NULL DEFAULT 'INTERPRETADO',
  origem TEXT NOT NULL DEFAULT 'TRIAGEM_CONTRATUAL', criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_contrato_recomendacoes_contrato ON contrato_recomendacoes(contrato_id);

CREATE TABLE IF NOT EXISTS contrato_sugestoes_clausulas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES contratos(id) ON DELETE CASCADE,
  risco_id INTEGER REFERENCES contrato_riscos_iniciais(id) ON DELETE SET NULL,
  clausula_original TEXT, sugestao_redacao TEXT NOT NULL, motivo TEXT NOT NULL,
  impacto_esperado TEXT NOT NULL, fundamento TEXT NOT NULL,
  natureza TEXT NOT NULL DEFAULT 'SUGERIDO', status TEXT DEFAULT 'RASCUNHO',
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_contrato_sugestoes_contrato ON contrato_sugestoes_clausulas(contrato_id);

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
  usuario_id TEXT,
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

-- Checklist automático da implantação: diferente de tarefa livre, registra
-- a evidência solicitada pelo escopo e mantém a pendência auditável.
CREATE TABLE IF NOT EXISTS projeto_checklist_implantacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contratacao_id INTEGER NOT NULL REFERENCES contratacoes(id) ON DELETE CASCADE,
  entrega_id INTEGER REFERENCES projeto_entregas(id) ON DELETE SET NULL,
  escopo TEXT NOT NULL,
  chave TEXT NOT NULL,
  titulo TEXT NOT NULL,
  tipo_evidencia TEXT,
  status TEXT NOT NULL DEFAULT 'NAO_SOLICITADO',
  responsavel_id INTEGER REFERENCES projeto_responsaveis(id) ON DELETE SET NULL,
  origem_tipo TEXT, origem_id TEXT, observacoes TEXT,
  ordem INTEGER NOT NULL DEFAULT 0,
  origem TEXT NOT NULL DEFAULT 'AUTOMATICO',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(contratacao_id, chave)
);
CREATE INDEX IF NOT EXISTS ix_projeto_checklist_implantacao_contratacao ON projeto_checklist_implantacao(contratacao_id, escopo, ordem);

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
  cnae TEXT, cnae_descricao TEXT, cnaes_secundarios TEXT, uf TEXT, municipio TEXT,
  optante_simples INTEGER DEFAULT 0, data_opcao_simples TEXT, data_exclusao_simples TEXT,
  optante_mei INTEGER DEFAULT 0, data_opcao_mei TEXT, data_exclusao_mei TEXT,
  regime_derivado TEXT, justificativa TEXT,
  natureza_juridica TEXT, codigo_natureza_juridica TEXT, efr TEXT,
  fonte TEXT, consultado_em TEXT
);

-- Matriz versionada, editável e auditável de naturezas jurídicas que atendem
-- a condição do Anexo XI para o cClassTrib 200043.
CREATE TABLE IF NOT EXISTS param_naturezas_juridicas_anexo_xi (
  codigo_natureza_juridica TEXT PRIMARY KEY,
  descricao TEXT NOT NULL,
  categoria TEXT NOT NULL,
  elegivel_200043 INTEGER NOT NULL DEFAULT 0,
  fonte TEXT NOT NULL, versao TEXT NOT NULL DEFAULT '1',
  vigencia_inicio TEXT NOT NULL DEFAULT '2026-01-01', vigencia_fim TEXT,
  status TEXT NOT NULL DEFAULT 'ATIVO', atualizado_em TEXT DEFAULT (datetime('now','localtime'))
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

-- Parâmetros versionados para o comparador de regimes. Permanecem sem
-- semente: nenhuma alíquota de IRPJ/CSLL pode nascer de código ou memória.
CREATE TABLE IF NOT EXISTS param_irpj_csll_versionados (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tributo TEXT NOT NULL CHECK (tributo IN ('IRPJ','CSLL')),
  regime TEXT NOT NULL CHECK (regime IN ('lucro_real','lucro_presumido')),
  natureza_receita TEXT NOT NULL DEFAULT 'GERAL',
  tipo_base TEXT NOT NULL,
  percentual_base REAL,
  aliquota REAL,
  adicional REAL,
  limite_adicional REAL,
  limite_receita_anual REAL,
  acrescimo_percentual_base_excedente REAL,
  aplicacao_excedente TEXT,
  vigencia_inicio TEXT NOT NULL,
  vigencia_fim TEXT,
  fonte TEXT, fundamento TEXT,
  versao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RASCUNHO',
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(tributo, regime, natureza_receita, versao, vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS ix_param_irpj_csll_ativo ON param_irpj_csll_versionados(regime, status, vigencia_inicio, vigencia_fim);

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
  estado_autonomia TEXT, codigo_causa TEXT, origem_resolucao TEXT,
  evidencia_utilizada TEXT, regra_vencedora TEXT,
  requer_intervencao_humana INTEGER DEFAULT 0, motivo_intervencao TEXT,
  autonomia_calculo_cbs_propria INTEGER, autonomia_credito_entrada INTEGER, autonomia_credito_cliente INTEGER,
  autonomia_classificatoria TEXT, autonomia_diagnostico_completo INTEGER, memoria_autonomia_dimensoes TEXT,
  detalhe TEXT,                          -- JSON completo para rastreabilidade
  criado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_motor ON motor_resultados(empresa_id, execucao_id, sentido);
CREATE INDEX IF NOT EXISTS ix_motor_autonomia ON motor_resultados(empresa_id, execucao_id, estado_autonomia, requer_intervencao_humana);
-- A consolidação das cadeias ordena por empresa, valor e id. Este índice é
-- estritamente aditivo e evita a ordenação em árvore temporária observada no
-- plano de consulta; não modifica nenhuma linha do motor.
CREATE INDEX IF NOT EXISTS ix_motor_cadeia_ordenacao ON motor_resultados(empresa_id, preco_atual DESC, id);

-- Fila local e derivada do motor incremental. Não é dado fiscal, não é
-- publicada no Supabase e não substitui motor_resultados: apenas evita ler a
-- carteira inteira a cada abertura de tela para descobrir o que mudou.
CREATE TABLE IF NOT EXISTS motor_pendencias (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  movimento_id INTEGER NOT NULL REFERENCES movimentos(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (empresa_id, movimento_id)
);
CREATE INDEX IF NOT EXISTS ix_motor_pendencias_empresa ON motor_pendencias(empresa_id, atualizado_em, movimento_id);
CREATE TABLE IF NOT EXISTS motor_pendencias_controle (
  chave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
-- Exclusões não possuem mais uma linha em movimentos para entrar na fila.
-- Este contador derivado preserva a informação operacional de remoção sem
-- precisar comparar motor_resultados com toda a carteira a cada execução.
CREATE TABLE IF NOT EXISTS motor_pendencias_removidos (
  empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  quantidade INTEGER NOT NULL DEFAULT 0,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_movimento_insert AFTER INSERT ON movimentos BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em) VALUES (NEW.empresa_id,NEW.id,'MOVIMENTO_INSERIDO',datetime('now','localtime'))
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_movimento_update AFTER UPDATE ON movimentos BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em) VALUES (NEW.empresa_id,NEW.id,'MOVIMENTO_ALTERADO',datetime('now','localtime'))
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_movimento_delete AFTER DELETE ON movimentos BEGIN
  DELETE FROM motor_pendencias WHERE empresa_id=OLD.empresa_id AND movimento_id=OLD.id;
  DELETE FROM motor_resultados WHERE empresa_id=OLD.empresa_id AND movimento_id=OLD.id;
  INSERT INTO motor_pendencias_removidos(empresa_id,quantidade,atualizado_em) VALUES (OLD.empresa_id,1,datetime('now','localtime'))
  ON CONFLICT(empresa_id) DO UPDATE SET quantidade=quantidade+1,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_parceiro_update AFTER UPDATE ON parceiros BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT m.empresa_id,m.id,'PARCEIRO_ALTERADO',datetime('now','localtime') FROM movimentos m
  WHERE m.empresa_id=NEW.empresa_id AND m.tipo=NEW.tipo AND m.inscr_federal IN (OLD.cnpj,NEW.cnpj)
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_parceiro_insert AFTER INSERT ON parceiros BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT m.empresa_id,m.id,'PARCEIRO_ALTERADO',datetime('now','localtime') FROM movimentos m
  WHERE m.empresa_id=NEW.empresa_id AND m.tipo=NEW.tipo AND m.inscr_federal=NEW.cnpj
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_parceiro_delete AFTER DELETE ON parceiros BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT m.empresa_id,m.id,'PARCEIRO_ALTERADO',datetime('now','localtime') FROM movimentos m
  WHERE m.empresa_id=OLD.empresa_id AND m.tipo=OLD.tipo AND m.inscr_federal=OLD.cnpj
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_qsa_insert AFTER INSERT ON empresa_qsa BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'QSA_ALTERADO',datetime('now','localtime') FROM movimentos WHERE empresa_id=NEW.empresa_id AND tipo='cliente'
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_qsa_update AFTER UPDATE ON empresa_qsa BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'QSA_ALTERADO',datetime('now','localtime') FROM movimentos WHERE empresa_id=NEW.empresa_id AND tipo='cliente'
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_qsa_delete AFTER DELETE ON empresa_qsa BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'QSA_ALTERADO',datetime('now','localtime') FROM movimentos WHERE empresa_id=OLD.empresa_id AND tipo='cliente'
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;

-- Parâmetros de regime não são globais para cada operação: uma mudança no
-- Simples, por exemplo, só pode reprocessar as linhas cuja contraparte usa
-- esse regime. A fila preserva esse vínculo sem comparar a carteira inteira.
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_param_regime_update AFTER UPDATE ON param_regimes BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT m.empresa_id,m.id,'PARAMETRO_REGIME_ALTERADO',datetime('now','localtime')
  FROM movimentos m
  LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
  WHERE COALESCE(p.regime,m.regime,'indeterminado') IN (OLD.chave,NEW.chave)
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;

-- Telemetria operacional: estados de autonomia não substituem natureza fiscal.
CREATE TABLE IF NOT EXISTS telemetria_autonomia_execucoes (
  execucao_id INTEGER PRIMARY KEY REFERENCES motor_execucoes(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  meta_autonomia REAL NOT NULL DEFAULT 0.95,
  total_operacoes INTEGER NOT NULL DEFAULT 0,
  operacoes_autonomas INTEGER NOT NULL DEFAULT 0,
  operacoes_intervencao INTEGER NOT NULL DEFAULT 0,
  taxa_autonomia REAL, taxa_determinacao REAL, taxa_simulacao REAL,
  taxa_indeterminacao_automatica REAL, taxa_intervencao_humana REAL,
  taxa_autonomia_calculo_cbs_propria REAL, taxa_autonomia_credito_entrada REAL, taxa_autonomia_credito_cliente REAL,
  taxa_autonomia_classificatoria REAL, taxa_autonomia_diagnostico_completo REAL, dimensoes_json TEXT NOT NULL DEFAULT '{}',
  estados_json TEXT NOT NULL DEFAULT '{}', criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_telemetria_autonomia_empresa_execucao ON telemetria_autonomia_execucoes(empresa_id, execucao_id DESC);

-- Evidências complementares não substituem o documento ou resultado original.
-- Elas alimentam somente uma futura execução incremental explicitamente pedida.
CREATE TABLE IF NOT EXISTS enriquecimento_servicos_evidencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  movimento_id INTEGER NOT NULL,
  ctribnac_original TEXT,
  lc116_canonico TEXT,
  nbs_original TEXT,
  indop TEXT,
  onerosa TEXT,
  exterior TEXT,
  local_incidencia TEXT,
  descricao_estruturada TEXT,
  cclasstrib TEXT,
  origem_evidencia TEXT NOT NULL,
  status_validacao TEXT NOT NULL DEFAULT 'PENDENTE',
  criado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(empresa_id, movimento_id, origem_evidencia)
);

CREATE TABLE IF NOT EXISTS enriquecimento_pis_cofins_evidencias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  movimento_id INTEGER NOT NULL,
  pis_documentado REAL,
  cofins_documentada REAL,
  cst_pis TEXT,
  cst_cofins TEXT,
  regime_incidencia TEXT,
  sped_referencia TEXT,
  referencia_fiscal_empresa_item TEXT,
  tratamento_especifico TEXT,
  vigencia_inicio TEXT,
  vigencia_fim TEXT,
  origem_evidencia TEXT NOT NULL,
  status_validacao TEXT NOT NULL DEFAULT 'PENDENTE',
  tipo_fonte TEXT, lote_origem_id INTEGER, hash_lineage TEXT,
  numero_documento TEXT, serie TEXT, base_pis REAL, base_cofins REAL,
  aliquota_pis REAL, aliquota_cofins REAL, natureza_credito TEXT,
  condicao_credito TEXT, grau_confianca TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  UNIQUE(empresa_id, movimento_id, origem_evidencia)
);

CREATE TABLE IF NOT EXISTS pendencias_enriquecimento_fiscal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL,
  movimento_id INTEGER NOT NULL,
  resultado_id INTEGER,
  tipo_pendencia TEXT NOT NULL,
  evidencia_necessaria TEXT NOT NULL,
  prioridade TEXT NOT NULL DEFAULT 'MEDIA',
  status TEXT NOT NULL DEFAULT 'ABERTA',
  origem TEXT NOT NULL DEFAULT 'MOTOR_FISCAL',
  detalhe TEXT,
  criado_em TEXT DEFAULT (datetime('now')),
  resolvido_em TEXT,
  UNIQUE(empresa_id, movimento_id, resultado_id, tipo_pendencia, status)
);
CREATE INDEX IF NOT EXISTS ix_pendencias_enriquecimento_abertas ON pendencias_enriquecimento_fiscal(empresa_id,status,prioridade);

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

-- Fotografia imutável da Central de Exceções por execução. A tabela histórica
-- anterior permanece intacta; esta evita que a execução mais recente regrave
-- ou se confunda com pendências produzidas por uma execução anterior.
CREATE TABLE IF NOT EXISTS excecoes_motor_execucoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  execucao_id INTEGER NOT NULL REFERENCES motor_execucoes(id) ON DELETE CASCADE,
  movimento_id INTEGER,
  codigo TEXT NOT NULL, categoria TEXT NOT NULL, gravidade TEXT DEFAULT 'media',
  status TEXT NOT NULL DEFAULT 'ABERTA', natureza TEXT DEFAULT 'INDETERMINADO', origem TEXT DEFAULT 'MOTOR',
  valor_envolvido REAL DEFAULT 0, impacto_cbs_estimado REAL, materialidade REAL DEFAULT 0,
  detalhe TEXT, criado_em TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, execucao_id, movimento_id, codigo)
);
CREATE INDEX IF NOT EXISTS ix_excecoes_execucao_ativa ON excecoes_motor_execucoes(empresa_id, execucao_id, status, materialidade DESC);

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

-- Staging durável: uma execução em fila nunca toca a fotografia ativa.
CREATE TABLE IF NOT EXISTS motor_fotografias_staging (
  job_id TEXT PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  execucao_id INTEGER,
  status TEXT NOT NULL DEFAULT 'AGUARDANDO',
  quantidade_esperada INTEGER DEFAULT 0,
  resumo TEXT, erro TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_motor_staging_empresa_status ON motor_fotografias_staging(empresa_id,status);

-- Marco local da última sincronização compartilhada. A carga atual só é
-- substituída após a próxima sincronização ser validada integralmente.
CREATE TABLE IF NOT EXISTS sincronizacao_operacional_estado (
  chave TEXT PRIMARY KEY, valor TEXT, atualizado_em TEXT DEFAULT (datetime('now','localtime'))
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

-- Os catálogos são criados neste ponto; os gatilhos precisam vir depois para
-- que uma instalação nova não tente referenciar tabelas ainda inexistentes.
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_base_ncm_update AFTER UPDATE ON base_ncm BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'CATALOGO_NCM_ALTERADO',datetime('now','localtime') FROM movimentos WHERE ncm IN (OLD.ncm,NEW.ncm)
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_base_ncm_insert AFTER INSERT ON base_ncm BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'CATALOGO_NCM_ALTERADO',datetime('now','localtime') FROM movimentos WHERE ncm=NEW.ncm
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_base_ncm_delete AFTER DELETE ON base_ncm BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'CATALOGO_NCM_ALTERADO',datetime('now','localtime') FROM movimentos WHERE ncm=OLD.ncm
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_base_servicos_update AFTER UPDATE ON base_servicos BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'CATALOGO_SERVICO_ALTERADO',datetime('now','localtime') FROM movimentos WHERE nbs IN (OLD.nbs,NEW.nbs)
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_base_servicos_insert AFTER INSERT ON base_servicos BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'CATALOGO_SERVICO_ALTERADO',datetime('now','localtime') FROM movimentos WHERE nbs=NEW.nbs
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;
CREATE TRIGGER IF NOT EXISTS tg_motor_pendente_base_servicos_delete AFTER DELETE ON base_servicos BEGIN
  INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
  SELECT empresa_id,id,'CATALOGO_SERVICO_ALTERADO',datetime('now','localtime') FROM movimentos WHERE nbs=OLD.nbs
  ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em;
END;

CREATE TABLE IF NOT EXISTS base_decisoes (
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave TEXT NOT NULL, tipo TEXT NOT NULL,
  cclasstrib TEXT, reducao TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (empresa_id, chave, tipo)
);

-- Revisões humanas de benefícios não substituem o documento importado nem o
-- catálogo. Elas registram uma decisão operacional auditável, aplicada apenas
-- aos itens explicitamente vinculados abaixo.
CREATE TABLE IF NOT EXISTS revisoes_beneficios_fiscais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  escopo TEXT NOT NULL, motivo TEXT NOT NULL, justificativa TEXT NOT NULL,
  evidencia TEXT, cclasstrib_origem TEXT NOT NULL, nova_cclasstrib TEXT NOT NULL,
  lc116 TEXT, nbs TEXT, status TEXT NOT NULL DEFAULT 'ATIVA',
  resultado_anterior_json TEXT, execucao_anterior_id INTEGER,
  execucao_posterior_id INTEGER, criado_em TEXT DEFAULT (datetime('now','localtime')),
  revertido_em TEXT, motivo_reversao TEXT
);
CREATE INDEX IF NOT EXISTS ix_revisoes_beneficios_empresa ON revisoes_beneficios_fiscais(empresa_id, status);
CREATE TABLE IF NOT EXISTS revisoes_beneficios_itens (
  revisao_id INTEGER NOT NULL REFERENCES revisoes_beneficios_fiscais(id) ON DELETE CASCADE,
  movimento_id INTEGER NOT NULL REFERENCES movimentos(id) ON DELETE CASCADE,
  PRIMARY KEY (revisao_id, movimento_id)
);
CREATE INDEX IF NOT EXISTS ix_revisoes_beneficios_item ON revisoes_beneficios_itens(movimento_id);

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

-- Identidade interna imutável por empresa. Códigos trazidos por XML, SPED ou
-- planilha são aliases; nunca são, por si só, a identidade fiscal do produto.
CREATE TABLE IF NOT EXISTS produtos_empresa (
  id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo_produto_atual TEXT, ncm_atual TEXT, descricao_atual TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')), updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id, codigo_produto_atual)
);
CREATE INDEX IF NOT EXISTS ix_produtos_empresa_ncm ON produtos_empresa(empresa_id,ncm_atual);
CREATE TABLE IF NOT EXISTS produto_aliases (
  id INTEGER PRIMARY KEY AUTOINCREMENT, produto_empresa_id INTEGER NOT NULL REFERENCES produtos_empresa(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE, tipo_origem TEXT NOT NULL CHECK(tipo_origem IN ('XML_CPROD','SPED_COD_ITEM','CADASTRO','PLANILHA','OUTRO')),
  codigo_origem TEXT NOT NULL, vigencia_inicio TEXT, vigencia_fim TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(empresa_id,tipo_origem,codigo_origem,vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS ix_produto_aliases_resolver ON produto_aliases(empresa_id,tipo_origem,codigo_origem,vigencia_inicio,vigencia_fim);

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
  regime_adquirente TEXT, ncm TEXT, nbs TEXT, lc116 TEXT, cclasstrib TEXT, cst TEXT, regime_pis_cofins TEXT, cst_pis TEXT, cst_cofins TEXT, pis_percentual REAL, cofins_percentual REAL,
  cfop TEXT, papel_cadeia TEXT, unidade TEXT, condicoes_obrigatorias TEXT,
  condicoes_excludentes TEXT, tratamento_resultante TEXT, formula_id TEXT,
  fundamento_legal TEXT, vigencia_inicio TEXT, vigencia_fim TEXT,
  prioridade INTEGER NOT NULL DEFAULT 0, versao INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'RASCUNHO', fonte TEXT, evidencia TEXT,
  criado_em TEXT DEFAULT (datetime('now','localtime')), atualizado_em TEXT DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_regras_enquadramento_busca ON regras_enquadramento(status, familia, ncm, nbs, prioridade DESC);
CREATE INDEX IF NOT EXISTS ix_regras_enquadramento_lc116_nbs ON regras_enquadramento(status, lc116, nbs, prioridade DESC);

-- Cadastro complementar: fatos materiais por empresa e produto. Não contém
-- CST, alíquota, regra legal ou resultado de motor; somente evidências que o
-- resolvedor poderá usar quando uma regra condicional vier a ser ativada.
CREATE TABLE IF NOT EXISTS empresa_produto_fiscal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_empresa_id INTEGER REFERENCES produtos_empresa(id) ON DELETE RESTRICT,
  codigo_produto TEXT,
  produto_id INTEGER REFERENCES cadastro_produtos_mestre(id) ON DELETE SET NULL,
  chave_produto TEXT, ncm TEXT,
  papel_padrao TEXT NOT NULL DEFAULT 'INDETERMINADO' CHECK(papel_padrao IN ('INDETERMINADO','FABRICANTE','PRODUTOR','IMPORTADOR','REVENDEDOR','ATACADISTA','DISTRIBUIDOR','VAREJISTA')),
  fabricacao_propria INTEGER CHECK(fabricacao_propria IN (0,1)), importador INTEGER CHECK(importador IN (0,1)), revendedor INTEGER CHECK(revendedor IN (0,1)),
  defensivo_agropecuario INTEGER CHECK(defensivo_agropecuario IN (0,1)), fertilizante INTEGER CHECK(fertilizante IN (0,1)), uso_veterinario INTEGER CHECK(uso_veterinario IN (0,1)), possui_sintetizador_voz INTEGER CHECK(possui_sintetizador_voz IN (0,1)), adaptado_para_pessoa_com_deficiencia INTEGER CHECK(adaptado_para_pessoa_com_deficiencia IN (0,1)), acionador_pressao INTEGER CHECK(acionador_pressao IN (0,1)),
  corretivo_solo INTEGER CHECK(corretivo_solo IN (0,1)), origem_mineral INTEGER CHECK(origem_mineral IN (0,1)), fatos_extras_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(fatos_extras_json)),
  fonte_dado TEXT NOT NULL DEFAULT 'USUARIO', origem_evidencia TEXT,
  observacao TEXT, validado_por TEXT, validado_em TEXT,
  vigencia_inicio TEXT, vigencia_fim TEXT, ativo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK(produto_empresa_id IS NOT NULL OR NULLIF(TRIM(codigo_produto), '') IS NOT NULL),
  UNIQUE(empresa_id, produto_empresa_id, vigencia_inicio)
);
CREATE INDEX IF NOT EXISTS ix_empresa_produto_fiscal_busca ON empresa_produto_fiscal(empresa_id, codigo_produto, ativo, vigencia_inicio, vigencia_fim);
CREATE INDEX IF NOT EXISTS ix_empresa_produto_fiscal_ncm ON empresa_produto_fiscal(empresa_id, ncm, ativo);
CREATE INDEX IF NOT EXISTS ix_empresa_produto_fiscal_produto_empresa ON empresa_produto_fiscal(empresa_id, produto_empresa_id, ativo);
CREATE UNIQUE INDEX IF NOT EXISTS ux_empresa_produto_fiscal_legado_vigencia ON empresa_produto_fiscal(empresa_id, codigo_produto, vigencia_inicio) WHERE produto_empresa_id IS NULL;
CREATE TABLE IF NOT EXISTS motor_condicional_sombra (
  id INTEGER PRIMARY KEY AUTOINCREMENT, movimento_id INTEGER, empresa_id INTEGER NOT NULL, produto_empresa_id INTEGER,
  ncm TEXT, regra_candidata TEXT, regra_selecionada TEXT, familia_regra TEXT, condicoes TEXT, fatos_resolvidos TEXT,
  status_avaliacao TEXT, resultado_oficial TEXT, resultado_sombra TEXT, diferenca TEXT, motivo TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_motor_condicional_sombra_movimento ON motor_condicional_sombra(empresa_id,movimento_id,criado_em DESC);

CREATE TABLE IF NOT EXISTS empresa_produto_fiscal_historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cadastro_id INTEGER NOT NULL REFERENCES empresa_produto_fiscal(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_empresa_id INTEGER REFERENCES produtos_empresa(id) ON DELETE RESTRICT,
  codigo_produto TEXT, fato TEXT NOT NULL,
  valor_anterior TEXT, valor_novo TEXT, fonte TEXT, observacao TEXT,
  usuario_id TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_empresa_produto_fiscal_historico ON empresa_produto_fiscal_historico(empresa_id, codigo_produto, fato, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_empresa_produto_fiscal_historico_produto_empresa ON empresa_produto_fiscal_historico(empresa_id, produto_empresa_id, criado_em DESC);
CREATE TRIGGER IF NOT EXISTS bloquear_update_historico_empresa_produto_fiscal
BEFORE UPDATE ON empresa_produto_fiscal_historico BEGIN SELECT RAISE(ABORT, 'Histórico fiscal é append-only'); END;
CREATE TRIGGER IF NOT EXISTS bloquear_delete_historico_empresa_produto_fiscal
BEFORE DELETE ON empresa_produto_fiscal_historico BEGIN SELECT RAISE(ABORT, 'Histórico fiscal é append-only'); END;

CREATE TABLE IF NOT EXISTS pendencias_fiscais_produtos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  produto_empresa_id INTEGER REFERENCES produtos_empresa(id) ON DELETE RESTRICT,
  codigo_produto TEXT, produto_descricao TEXT, ncm TEXT,
  regra_id TEXT, familia_regra TEXT, regra_candidata TEXT, fato_faltante TEXT NOT NULL,
  pergunta TEXT NOT NULL, origem_dados_existentes TEXT, status TEXT NOT NULL DEFAULT 'PENDENTE',
  movimento_id INTEGER REFERENCES movimentos(id) ON DELETE SET NULL,
  respondida_por TEXT, respondida_em TEXT, resolvida_em TEXT, observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  CHECK(produto_empresa_id IS NOT NULL OR NULLIF(TRIM(codigo_produto), '') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS ix_pendencias_fiscais_produtos_fila ON pendencias_fiscais_produtos(empresa_id, status, fato_faltante, codigo_produto, criado_em DESC);
CREATE INDEX IF NOT EXISTS ix_pendencias_fiscais_produtos_produto_empresa ON pendencias_fiscais_produtos(empresa_id, produto_empresa_id, status, fato_faltante, criado_em DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_pendencias_fiscais_produtos_abertas_identidade ON pendencias_fiscais_produtos(empresa_id,produto_empresa_id,fato_faltante,COALESCE(regra_id,COALESCE(regra_candidata,'')),COALESCE(familia_regra,'')) WHERE produto_empresa_id IS NOT NULL AND status='PENDENTE';
CREATE UNIQUE INDEX IF NOT EXISTS ux_pendencias_fiscais_produtos_abertas_legado ON pendencias_fiscais_produtos(empresa_id,codigo_produto,fato_faltante,COALESCE(regra_id,COALESCE(regra_candidata,'')),COALESCE(familia_regra,'')) WHERE produto_empresa_id IS NULL AND status='PENDENTE';

CREATE TABLE IF NOT EXISTS conflitos_fatos_fiscais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo_produto TEXT, movimento_id INTEGER REFERENCES movimentos(id) ON DELETE SET NULL,
  fato TEXT NOT NULL, valor_precedente TEXT, origem_precedente TEXT,
  valor_menor_precedencia TEXT, origem_menor_precedencia TEXT,
  status TEXT NOT NULL DEFAULT 'ABERTO', criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_conflitos_fatos_fiscais ON conflitos_fatos_fiscais(empresa_id, status, fato, criado_em DESC);

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

-- ============ PLANEJAMENTO TRIBUTÁRIO ============
-- Estudos isolados: nunca alteram a empresa, movimentos ou o motor oficial.
CREATE TABLE IF NOT EXISTS planejamento_analises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL, descricao TEXT,
  periodo_base_inicio TEXT, periodo_base_fim TEXT,
  periodo_projecao_inicio TEXT, periodo_projecao_fim TEXT,
  responsavel_id TEXT, criado_por TEXT,
  status TEXT NOT NULL DEFAULT 'RASCUNHO', versao INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS planejamento_analise_empresas (
  analise_id INTEGER NOT NULL REFERENCES planejamento_analises(id) ON DELETE CASCADE,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,
  incluida_consolidado INTEGER NOT NULL DEFAULT 1, ordem INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (analise_id, empresa_id)
);
CREATE TABLE IF NOT EXISTS planejamento_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT, analise_id INTEGER NOT NULL REFERENCES planejamento_analises(id) ON DELETE CASCADE,
  versao INTEGER NOT NULL, dados_json TEXT NOT NULL, motor_versao TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(analise_id, versao)
);
CREATE TABLE IF NOT EXISTS planejamento_premissas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, analise_id INTEGER NOT NULL REFERENCES planejamento_analises(id) ON DELETE CASCADE,
  cenario TEXT, escopo TEXT NOT NULL DEFAULT 'ANALISE', campo TEXT NOT NULL, valor TEXT, tipo TEXT NOT NULL DEFAULT 'OPERACIONAL',
  origem TEXT NOT NULL DEFAULT 'PREMISSA_MANUAL', justificativa TEXT, responsavel_id TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS planejamento_resultados (
  id INTEGER PRIMARY KEY AUTOINCREMENT, analise_id INTEGER NOT NULL REFERENCES planejamento_analises(id) ON DELETE CASCADE,
  snapshot_id INTEGER NOT NULL REFERENCES planejamento_snapshots(id) ON DELETE RESTRICT,
  cenario TEXT NOT NULL, status TEXT NOT NULL, confianca TEXT NOT NULL,
  resultado_json TEXT NOT NULL, calculado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(analise_id, snapshot_id, cenario)
);
CREATE TABLE IF NOT EXISTS planejamento_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, analise_id INTEGER NOT NULL REFERENCES planejamento_analises(id) ON DELETE CASCADE,
  acao TEXT NOT NULL, usuario_id TEXT, dados_json TEXT, criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS planejamento_assistente_interacoes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analise_id INTEGER NOT NULL REFERENCES planejamento_analises(id) ON DELETE CASCADE,
  snapshot_id INTEGER NOT NULL REFERENCES planejamento_snapshots(id) ON DELETE RESTRICT,
  usuario_id TEXT,
  pergunta TEXT NOT NULL,
  resposta TEXT NOT NULL,
  modelo TEXT,
  uso_json TEXT,
  contexto_json TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS ix_planejamento_analises_status ON planejamento_analises(status, atualizado_em DESC);
CREATE INDEX IF NOT EXISTS ix_planejamento_empresas_empresa ON planejamento_analise_empresas(empresa_id, analise_id);
CREATE INDEX IF NOT EXISTS ix_planejamento_resultados_analise ON planejamento_resultados(analise_id, snapshot_id);
CREATE INDEX IF NOT EXISTS ix_planejamento_assistente_analise ON planejamento_assistente_interacoes(analise_id, id DESC);
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

// Ajuste de parâmetro já homologado para bancos operacionais existentes.
// Este cache não recebe `param_regimes` do Supabase: a carga saneada do
// Simples deve usar a premissa versionada de 2,5%, sem afetar percentuais
// distintos que tenham sido configurados manualmente pelo usuário.
db.prepare(`UPDATE param_regimes
  SET pis_cofins = 2.5,
      obs = 'Premissa versionada de 2,5% para reconstrução econômica de PIS/COFINS quando não houver regra específica; não é alíquota legal fixa do DAS.'
  WHERE chave = 'simples_nacional' AND (pis_cofins IS NULL OR ABS(pis_cofins) < 0.0000001)`).run();

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

// XMLs municipais antigos guardavam o item da lista de serviços no campo
// legado `cst`. A origem não é apagada: apenas espelhamos o item LC116 em seu
// campo próprio quando o lançamento é claramente um serviço de XML.
try {
  db.prepare(`UPDATE movimentos
    SET lc116 = substr(cst, 1, 4)
    WHERE origem='xml' AND (lc116 IS NULL OR lc116='')
      AND COALESCE(ncm,'')='' AND COALESCE(iss,0)<>0
      AND length(COALESCE(cst,'')) >= 4`).run();
  db.prepare(`UPDATE movimentos
    SET normalizacao_status = CASE
          WHEN COALESCE(lc116, '') = '' THEN 'PENDENTE'
          WHEN COALESCE(nbs, '') = '' THEN 'PENDENTE'
          ELSE 'VALIDADO'
        END,
        normalizacao_pendencia = CASE
          WHEN COALESCE(lc116, '') = '' THEN 'LC116_NAO_IDENTIFICADO'
          WHEN COALESCE(nbs, '') = '' THEN 'LC116_IDENTIFICADO_SEM_NBS'
          ELSE ''
        END,
        normalizacao_evidencia = CASE
          WHEN COALESCE(lc116, '') <> '' THEN 'Item LC116: ' || lc116 || CASE WHEN COALESCE(cst, '') <> '' THEN ' · Código fiscal bruto do XML: ' || cst ELSE '' END
          WHEN COALESCE(cst, '') <> '' THEN 'Código fiscal bruto do XML: ' || cst
          ELSE 'XML de serviço sem item LC116 identificado.'
        END
    WHERE origem='xml' AND COALESCE(ncm,'')='' AND COALESCE(iss,0)<>0`).run();
} catch (_) { /* tabela ainda não existe durante uma inicialização incompleta */ }

module.exports = db;
