const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const diretorio = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cobertura-periodo-'));
process.env.SATTVA_DADOS = diretorio;
const db = require('../src/db');

try {
  const empresa = Number(db.prepare('INSERT INTO empresas(cnpj,razao_social) VALUES (?,?)')
    .run('99200000000001', 'Empresa cobertura período').lastInsertRowid);
  const inserir = db.prepare('INSERT INTO movimentos(empresa_id,tipo,sentido,competencia,valor) VALUES (?,?,?,?,?)');
  inserir.run(empresa, 'fornecedor', 'entrada', '2026-02', 10);
  inserir.run(empresa, 'fornecedor', 'entrada', '2026-02-15', 20);
  inserir.run(empresa, 'fornecedor', 'entrada', '2026-03', 30);
  const linhas = db.prepare(`SELECT competencia FROM movimentos
    WHERE empresa_id=? AND substr(COALESCE(competencia,''),1,7)>=? AND substr(COALESCE(competencia,''),1,7)<=?
    GROUP BY competencia ORDER BY competencia`).all(empresa, '2026-02', '2026-02').map((x) => x.competencia);
  assert.deepEqual(linhas, ['2026-02', '2026-02-15']);
  console.log('cobertura-periodo-competencia: AAAA-MM e data ISO no mesmo recorte mensal: OK');
} finally {
  db.close();
  fs.rmSync(diretorio, { recursive:true, force:true });
}
