# Supabase — implantação multiusuário

1. No Supabase, abra **SQL Editor** e execute, nesta ordem, `migrations/20260823_usuarios_projetos.sql` e `migrations/20260823_gestao_compartilhada.sql`.
2. No `.env` já existente, preencha `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` localmente.
3. Em **Authentication > Providers**, habilite Email e senha.
4. Crie o primeiro usuário administrador em **Authentication > Users**; depois vincule-o na tabela `perfis` com papel `administrador`.
5. Execute `node scripts/sincronizar_gestao_supabase.js` para copiar empresas, escopos, entregas e acompanhamentos para a base compartilhada.

O próximo passo é migrar as tabelas operacionais atualmente em SQLite para PostgreSQL e trocar as rotas da aplicação para o banco compartilhado. Não ative isso antes de validar a migração em uma cópia do banco local.
