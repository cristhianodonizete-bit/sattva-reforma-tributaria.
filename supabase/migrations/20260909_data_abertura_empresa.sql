-- Data de início de atividade trazida pela consulta cadastral do CNPJ.
-- Ela limita a competência inicial do período analisado, sem apagar dados
-- históricos que possam existir antes do cadastro ter sido enriquecido.
alter table public.empresas add column if not exists data_abertura date;
alter table public.cadastros_cnpj add column if not exists data_abertura date;
