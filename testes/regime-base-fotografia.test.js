const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const dir=path.join(os.tmpdir(),`sattva-regime-base-${process.pid}-${Date.now()}`);
process.env.SATTVA_DADOS=dir;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const db=require('../src/db');
const motorExec=require('../src/services/motorExec');

try {
  const empresaId=Number(db.prepare("INSERT INTO empresas(cnpj,razao_social,regime,regime_resolvido) VALUES ('99000000000001','Compradora fixture','lucro_real','lucro_real')").run().lastInsertRowid);
  db.prepare("INSERT INTO base_regime(cnpj,raiz,regime,ano,fonte) VALUES ('04622116003210','04622116','lucro_real',2024,'fixture')").run();
  db.prepare("INSERT INTO parceiros(empresa_id,tipo,cnpj,descricao,regime,origem) VALUES (?,'fornecedor','04.622.116/0032-10','ALGAR MULTIMIDIA S/A','regime_regular','QUESTOR_PESSOA_HISTORICO')")
    .run(empresaId);
  const movimentoId=Number(db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,base_calculo,competencia,origem,normalizacao_evidencia)
    VALUES (?,'fornecedor','ALGAR MULTIMIDIA S/A','04.622.116/0032-10','Telecomunicacoes','85176259',259.18,259.18,'2026-01','QUESTOR_RAZAO','{')`)
    .run(empresaId).lastInsertRowid);

  assert.doesNotThrow(()=>motorExec.executar(empresaId,{ ano:2027 }),
    'JSON legado malformado não pode impedir a renovação da fotografia');
  const linha=db.prepare('SELECT detalhe FROM motor_resultados WHERE empresa_id=? AND movimento_id=?').get(empresaId,movimentoId);
  assert.ok(linha,'o lançamento precisa ser materializado');
  const detalhe=JSON.parse(linha.detalhe);
  assert.equal(detalhe.regimeEmitente,'lucro_real','CNPJ formatado deve encontrar o Lucro Real da base canônica');
  console.log('regime-base-fotografia: CNPJ formatado e JSON legado resolvidos pela fonte canônica');
} finally {
  try { fs.rmSync(dir,{ recursive:true,force:true }); } catch (_) {}
}
