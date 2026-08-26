#!/usr/bin/env node
/* Relatório técnico: leitura e reconciliação, nunca um segundo motor. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('xlsx');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-relatorio-'));
process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const oficial = require('../src/services/consolidacaoOficial');
const relatorio = require('../src/services/relatorio');

const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'relatorio.js'), 'utf8');
for (const proibido of ['motorExec.executar(', "require('../engine/calculadora')", "require('../engine/reconstrucao')", "require('../engine/classificador')"]) {
  assert.equal(fonte.includes(proibido), false, `relatório base não pode conter ${proibido}`);
}
assert.equal(fonte.includes('executarSeAusente: true'), false, 'relatório não pode criar fotografia fiscal ao ser emitido');

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime,regime_resolvido) VALUES ('96000000000001','Fixture relatório','lucro_real','lucro_real')").run().lastInsertRowid);
db.prepare("INSERT INTO parceiros (empresa_id,tipo,cnpj,descricao,regime) VALUES (?, 'cliente','95000000000001','Cliente fixture','lucro_real'), (?, 'fornecedor','94000000000001','Fornecedor fixture','lucro_real')").run(empresaId, empresaId);
db.prepare(`INSERT INTO movimentos (empresa_id,tipo,nome,inscr_federal,descricao,ncm,valor,base_calculo,competencia,reducao)
  VALUES (?, 'cliente','Cliente fixture','95000000000001','Venda fixture','01012100',1000,1000,'2027-01','integral'),
         (?, 'fornecedor','Fornecedor fixture','94000000000001','Compra fixture','01012100',500,500,'2027-01','integral')`).run(empresaId, empresaId);
const empresa = { id: empresaId };

// A execução explícita pertence ao arranjo do teste; gerar() abaixo só lê a
// fotografia materializada e as consolidações oficiais.
motorExec.executar(empresa.id, { ano: 2027 });
const linhas = oficial.linhas(empresa.id, { executarSeAusente: false }).linhas;
const impacto = oficial.impactoFinal(empresa.id, { executarSeAusente: false });
const baseSaidas = r2(linhas.filter((x) => x.sentido === 'saida').reduce((s, x) => s + Number(x.base_economica || 0), 0));
const cbsDebito = r2(linhas.filter((x) => x.sentido === 'saida').reduce((s, x) => s + Number(x.cbs || 0), 0));
const cbsCredito = r2(linhas.filter((x) => x.sentido === 'entrada').reduce((s, x) => s + Number(x.credito_cbs || 0), 0));

const arquivo = relatorio.gerar(empresa.id, 'tecnico');
const wb = XLSX.read(arquivo.buffer, { type: 'buffer' });
const resumo = XLSX.utils.sheet_to_json(wb.Sheets['Sumário técnico'], { defval: null });
const valor = (indicador) => resumo.find((x) => x.Indicador === indicador)?.Valor;

assert.equal(r2(valor('Base econômica das saídas')), baseSaidas);
assert.equal(r2(valor('Débito CBS projetado')), cbsDebito);
assert.equal(r2(valor('Crédito CBS projetado')), cbsCredito);
assert.equal(r2(valor('Saldo CBS projetado')), r2(cbsDebito - cbsCredito));
assert.equal(impacto.cbs_debito_vendas, cbsDebito);
assert.equal(impacto.cbs_credito_compras, cbsCredito);
assert.equal(impacto.reconciliacao.status, 'RECONCILIADO');
const semFotografia = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('96000000000002','Sem fotografia','lucro_real')").run().lastInsertRowid);
assert.throws(() => relatorio.gerar(semFotografia, 'tecnico'), /não há fotografia oficial/i, 'emissão sem fotografia deve bloquear, sem recalcular');
console.log(`relatorio-oficial.test: relatório reconciliado com ${linhas.length} resultados oficiais.`);
try { db.close?.(); } catch (_) { /* noop */ }
fs.rmSync(dir, { recursive: true, force: true });
