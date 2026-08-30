const assert = require('assert');
const fs = require('fs');
const path = require('path');

const migration = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260901_memoria_decisao_versionada.sql'),
  'utf8',
);

for (const tabela of [
  'regras_versionadas', 'fundamentos_normativos', 'regras_fundamentos',
  'evidencias_decisao', 'decisoes_memoria', 'decisoes_evidencias',
  'decisoes_regras', 'decisoes_catalogos', 'decisoes_parametros', 'decisoes_premissas',
]) assert.match(migration, new RegExp(`create table if not exists public\\.${tabela}`));

assert.match(migration, /resultado_id bigint not null references public\.motor_resultados_operacionais\(id\) on delete restrict/);
assert.match(migration, /catalogo_linha_id bigint not null references public\.catalogo_linhas_versoes\(id\) on delete restrict/);
assert.match(migration, /unique \(resultado_id, tipo_decisao\)/);
assert.match(migration, /RETROVINCULO/);
assert.match(migration, /DETERMINISTICA/);
assert.match(migration, /bloquear_mutacao_memoria_versionada/);
assert.doesNotMatch(migration, /update public\.motor_resultados_operacionais/i);
assert.doesNotMatch(migration, /delete from public\.motor_resultados_operacionais/i);

console.log('Etapa 2O: estrutura aditiva, FK RESTRICT e imutabilidade verificadas.');
