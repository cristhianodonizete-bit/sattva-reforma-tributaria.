const assert = require('assert');
const sqlite = require('../src/sqlite');
const comparador = require('../src/services/comparadorRegimes');

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id INTEGER PRIMARY KEY, razao_social TEXT, regime TEXT);
  CREATE TABLE perfil_tributario (empresa_id INTEGER, competencia TEXT, receita_bruta REAL, das REAL);
  CREATE TABLE movimentos (empresa_id INTEGER, tipo TEXT, sentido TEXT, valor REAL);
  CREATE TABLE perfil_cbs_competencias (empresa_id INTEGER, cbs_liquida REAL);
  CREATE TABLE margens_operacionais_premissas (empresa_id INTEGER, periodo_inicio TEXT, periodo_fim TEXT, margem_operacional_percentual REAL);
  CREATE TABLE param_regimes (chave TEXT, pis_cofins REAL);
  CREATE TABLE param_irpj_csll_versionados (
    tributo TEXT, regime TEXT, natureza_receita TEXT, tipo_base TEXT,
    percentual_base REAL, aliquota REAL, adicional REAL, limite_adicional REAL,
    vigencia_inicio TEXT, vigencia_fim TEXT, fonte TEXT, fundamento TEXT,
    versao TEXT, status TEXT
  );
`);
db.prepare("INSERT INTO empresas VALUES (1,'Empresa A','lucro_presumido')").run();
db.prepare("INSERT INTO perfil_tributario VALUES (1,'2026-01',1000,0)").run();
db.prepare('INSERT INTO perfil_cbs_competencias VALUES (1,88)').run();
db.prepare("INSERT INTO margens_operacionais_premissas VALUES (1,'2026-01','2026-12',12.5)").run();
db.prepare("INSERT INTO param_regimes VALUES ('lucro_real',0.0925),('lucro_presumido',0.0365),('simples_nacional',0),('simples_regime_regular',0)").run();

const motorSombra = (_empresaId, opcoes) => {
  assert.strictEqual(opcoes.gravar, false);
  assert.strictEqual(opcoes.regimeEmpresa, 'simples_regime_regular');
  return { apuracao: { cbs: { saldo: 77 } } };
};
const r = comparador.comparar(db, 1, { executarMotor: motorSombra });
assert.strictEqual(r.cenarios.length, 4);
assert.strictEqual(r.cenarios.find((x) => x.chave === 'lucro_real').componentes_disponiveis.pis_cofins.valor, 92.5);
assert.strictEqual(r.cenarios.find((x) => x.chave === 'lucro_presumido').status, 'PARCIAL');
assert.ok(r.cenarios.find((x) => x.chave === 'lucro_real').premissas_utilizadas.some((x) => x.includes('PREMISSA_INFORMADA')),
  'margem deve permanecer premissa simulada, não lucro tributável real');
assert.strictEqual(r.melhor_cenario_estimado, 'INDETERMINADO', 'não deve haver vencedor com carga total incompleta');
assert.strictEqual(r.status_comparacao, 'INCOMPLETA');
assert.strictEqual(r.cenarios.find((x) => x.chave === 'simples_regime_regular').tributos_estimados, null);
assert.strictEqual(r.cenarios.find((x) => x.chave === 'simples_regime_regular').componentes_disponiveis.cbs_hibrida_motor.valor, 77);
assert.strictEqual(r.cbs_hibrida_via_motor, true);
assert.strictEqual(r.irpj_csll_resolvidos, 'NAO', 'sem parâmetros ativos, IRPJ/CSLL deve ficar incompleto');

const inserirParametro = db.prepare(`
  INSERT INTO param_irpj_csll_versionados
  (tributo, regime, natureza_receita, tipo_base, percentual_base, aliquota, adicional, limite_adicional,
   vigencia_inicio, vigencia_fim, fonte, fundamento, versao, status)
  VALUES (?, ?, 'GERAL', ?, ?, ?, ?, ?, '2026-01', NULL, 'TESTE', 'fundamento de teste', 'teste-v1', 'ATIVO')
`);
inserirParametro.run('IRPJ', 'lucro_real', 'MARGEM_OPERACIONAL', null, 0.1, null, null);
inserirParametro.run('CSLL', 'lucro_real', 'MARGEM_OPERACIONAL', null, 0.05, null, null);
inserirParametro.run('IRPJ', 'lucro_presumido', 'BASE_PRESUNCAO', 0.2, 0.1, null, null);
inserirParametro.run('CSLL', 'lucro_presumido', 'BASE_PRESUNCAO', 0.2, 0.05, null, null);

const comParametros = comparador.comparar(db, 1, { executarMotor: motorSombra });
assert.strictEqual(comParametros.cenarios.find((x) => x.chave === 'lucro_real').componentes_disponiveis.irpj_csll.natureza, 'SIMULADO');
assert.ok(comParametros.cenarios.find((x) => x.chave === 'lucro_presumido').componentes_disponiveis.irpj_csll.valor > 0);
assert.strictEqual(comParametros.irpj_csll_resolvidos, 'SIM');
assert.strictEqual(comParametros.cenarios.find((x) => x.chave === 'lucro_real').status, 'COMPLETO');
assert.strictEqual(comParametros.cenarios.find((x) => x.chave === 'lucro_presumido').status, 'COMPLETO');
assert.strictEqual(comParametros.cenarios_comparaveis, 2);
assert.notStrictEqual(comParametros.melhor_cenario_estimado, 'INDETERMINADO');
assert.strictEqual(comParametros.status_comparacao, 'COMPLETA');
assert.strictEqual(comParametros.cenarios.find((x) => x.chave === 'simples_regime_regular').diferenca_para_menor, null,
  'cenário incompleto não pode receber ranking');

db.prepare("INSERT INTO empresas VALUES (2,'Empresa Simples','simples_nacional')").run();
db.prepare("INSERT INTO perfil_tributario VALUES (2,'2026-01',1000,90)").run();
const simples = comparador.comparar(db, 2, { executarMotor: motorSombra });
assert.strictEqual(simples.cenarios.find((x) => x.chave === 'simples_nacional').tributos_estimados, 90);
assert.strictEqual(simples.cenarios.find((x) => x.chave === 'simples_nacional').status, 'COMPLETO');
assert.strictEqual(simples.pgdas_conectado, true);
db.close();
console.log('Fase 4D: comparador preserva CBS existente, incompletude e ausência de vencedor artificial.');
