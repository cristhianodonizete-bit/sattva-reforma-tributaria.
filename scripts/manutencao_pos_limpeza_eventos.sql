-- Executar fora de bloco transacional, somente após a faixa arquivada chegar a zero.
-- VACUUM libera o heap para reutilização; REINDEX CONCURRENTLY reduz os arquivos
-- dos índices sem bloquear leituras/escritas normais.
set lock_timeout='5s';
set statement_timeout='0';

vacuum (analyze, verbose) public.sincronizacao_operacional_eventos;

-- Este índice repete exatamente a chave primária (sequencia).
drop index concurrently if exists public.ix_sync_operacional_eventos_sequencia;

-- Os dois índices de auditoria/legado são preservados, mas reconstruídos para
-- retirar as páginas dos eventos arquivados. A PK também é preservada.
reindex index concurrently public.ix_sync_operacional_eventos_tabela_sequencia;
reindex index concurrently public.ix_sync_operacional_eventos_empresa_sequencia;
reindex index concurrently public.sincronizacao_operacional_eventos_pkey;

vacuum (analyze, verbose) public.sincronizacao_operacional_eventos;
