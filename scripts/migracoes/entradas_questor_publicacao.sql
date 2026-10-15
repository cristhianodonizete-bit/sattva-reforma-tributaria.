-- Migração aditiva: outbox das entradas Questor (plano aprovado).
-- Nunca executada pelo boot. Aplicada somente por
--   scripts/aplicar_migracao_entradas_outbox.js --confirmar
-- dentro de UMA transação (src/services/entradasQuestorMigracao.js). Não contém
-- BEGIN/COMMIT: a atomicidade é dada pelo runner. Não altera tabelas existentes.
CREATE TABLE IF NOT EXISTS entradas_questor_publicacao (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  movimento_id INTEGER,
  origem TEXT NOT NULL CHECK (origem IN ('QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO')),
  identidade_outbox TEXT NOT NULL,
  item_numero INTEGER NOT NULL DEFAULT 0,
  chave_publicacao TEXT,
  estado TEXT NOT NULL CHECK (estado IN ('PENDENTE','PUBLICANDO','PUBLICADO','FALHOU','FALHOU_DEFINITIVO','CANCELADO')),
  tentativas INTEGER NOT NULL DEFAULT 0,
  proxima_tentativa_em TEXT,
  ultimo_erro TEXT,
  publicando_em TEXT,
  lease_token TEXT,
  lease_expira_em TEXT,
  publicado_em TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (empresa_id, origem, identidade_outbox, item_numero)
);
CREATE INDEX IF NOT EXISTS idx_entradas_questor_publicacao_fila
  ON entradas_questor_publicacao (empresa_id, estado, proxima_tentativa_em);

-- Cursor persistido do backfill: retomável após interrupção.
CREATE TABLE IF NOT EXISTS entradas_questor_backfill (
  empresa_id INTEGER PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  ultimo_movimento_id INTEGER NOT NULL DEFAULT 0,
  lotes INTEGER NOT NULL DEFAULT 0,
  concluido_em TEXT,
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- Gatilhos: qualquer exclusão ou cancelamento de movimento Questor, em qualquer
-- rota, cancela a outbox na MESMA transação. Itens já PUBLICADO não são alterados
-- localmente; a remoção na fonte de um item já publicado fica fora desta migração.
CREATE TRIGGER IF NOT EXISTS trg_entradas_questor_movimento_excluido
AFTER DELETE ON movimentos
WHEN OLD.origem IN ('QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO')
BEGIN
  UPDATE entradas_questor_publicacao
     SET estado='CANCELADO', ultimo_erro='MOVIMENTO_EXCLUIDO', proxima_tentativa_em=NULL,
         publicando_em=NULL, lease_token=NULL, lease_expira_em=NULL, atualizado_em=datetime('now','localtime')
   WHERE movimento_id=OLD.id AND estado NOT IN ('PUBLICADO','CANCELADO');
END;

CREATE TRIGGER IF NOT EXISTS trg_entradas_questor_movimento_cancelado
AFTER UPDATE OF situacao_documento ON movimentos
WHEN NEW.origem IN ('QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO')
  AND NEW.situacao_documento = 'CANCELADO' AND COALESCE(OLD.situacao_documento,'') <> 'CANCELADO'
BEGIN
  UPDATE entradas_questor_publicacao
     SET estado='CANCELADO', ultimo_erro='MOVIMENTO_CANCELADO', proxima_tentativa_em=NULL,
         publicando_em=NULL, lease_token=NULL, lease_expira_em=NULL, atualizado_em=datetime('now','localtime')
   WHERE movimento_id=NEW.id AND estado NOT IN ('PUBLICADO','CANCELADO');
END;
