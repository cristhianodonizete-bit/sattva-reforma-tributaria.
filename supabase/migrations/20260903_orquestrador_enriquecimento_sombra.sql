-- Etapa 2R: tentativas em modo sombra. Não atualiza resultados oficiais.
create table if not exists public.enriquecimento_tentativas (
 id bigint generated always as identity primary key,
 pendencia_id bigint not null references public.pendencias_enriquecimento_fiscal(id) on delete restrict,
 fonte text not null, versao_fonte text, hash_evidencia text not null,
 hash_entrada text not null, resultado_resolucao text not null,
 memoria_completa boolean not null default false, detalhe jsonb not null default '{}'::jsonb,
 processado_em timestamptz not null default now(),
 unique(pendencia_id, hash_entrada)
);
create index if not exists ix_enriquecimento_tentativas_pendencia on public.enriquecimento_tentativas(pendencia_id,processado_em desc);
