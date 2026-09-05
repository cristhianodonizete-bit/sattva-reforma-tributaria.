-- Campo explícito e opcional; regras legadas com NULL continuam inalteradas.
alter table public.regras_enquadramento add column if not exists regime_pis_cofins text;
alter table public.regras_enquadramento add column if not exists cst_pis text;
alter table public.regras_enquadramento add column if not exists cst_cofins text;
alter table public.regras_enquadramento add column if not exists pis_percentual numeric;
alter table public.regras_enquadramento add column if not exists cofins_percentual numeric;
create index if not exists ix_regras_enquadramento_pis_regime on public.regras_enquadramento(status,ncm,regime_pis_cofins,prioridade desc);
