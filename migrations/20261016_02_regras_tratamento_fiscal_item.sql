CREATE TABLE IF NOT EXISTS regras_tratamento_fiscal_item (
  id INTEGER PRIMARY KEY,
  chave_item TEXT NOT NULL,
  tipo_chave TEXT NOT NULL,
  tratamento TEXT NOT NULL,
  vigencia_inicio TEXT,
  vigencia_fim TEXT,
  fundamento TEXT,
  fonte TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  UNIQUE(tipo_chave, chave_item, tratamento, vigencia_inicio)
);
-- Sem INSERT nesta migration: carga depende de aprovacao separada.
