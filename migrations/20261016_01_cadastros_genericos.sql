CREATE TABLE IF NOT EXISTS cadastros_genericos (
  chave TEXT PRIMARY KEY,
  regime_derivado TEXT NOT NULL,
  razao_social TEXT NOT NULL,
  fonte TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Sem INSERT nesta migration: carga depende de aprovacao separada.
