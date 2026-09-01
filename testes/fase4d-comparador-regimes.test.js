const assert = require('assert');
const sqlite = require('../src/sqlite');
const comparador = require('../src/services/comparadorRegimes');
const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id INTEGER PRIMARY KEY, razao_social TEXT, regime TEXT);
  CREATE TABLE perfil_tributario (empresa_id INTEGER, competencia TEXT, receita_bruta REAL, receita_mercadorias REAL, receita_servicos REAL, receita_exportacao REAL, das REAL, pis REAL, cofins REAL);
  CREATE TABLE movimentos (empresa_id INTEGER, tipo TEXT, sentido TEXT, valor REAL);
  CREATE TABLE perfil_cbs_competencias (empresa_id INTEGER, cbs_liquida REAL);
  CREATE TABLE margens_operacionais_premissas (empresa_id INTEGER, periodo_inicio TEXT, periodo_fim TEXT, margem_operacional_percentual REAL);
  CREATE TABLE receitas_sem_dfe (empresa_id INTEGER, tipo_receita TEXT, valor REAL);
  CREATE TABLE param_regimes (chave TEXT, pis_cofins REAL);
  CREATE TABLE param_irpj_csll_versionados (
    tributo TEXT, regime TEXT, natureza_receita TEXT, tipo_base TEXT, percentual_base REAL, aliquota REAL,
    adicional REAL, limite_adicional REAL, limite_receita_anual REAL, acrescimo_percentual_base_excedente REAL,
    aplicacao_excedente TEXT, vigencia_inicio TEXT, vigencia_fim TEXT, fonte TEXT, fundamento TEXT, versao TEXT, status TEXT
  );
`);
db.prepare("INSERT INTO empresas VALUES (1,'Empresa A','lucro_presumido'),(2,'Empresa Simples','simples_nacional')").run();
db.prepare("INSERT INTO perfil_tributario VALUES (1,'2026-01',1000,0,1000,0,0,0,0),(2,'2026-01',1000,0,1000,0,90,5,10)").run();
db.prepare('INSERT INTO perfil_cbs_competencias VALUES (1,88),(2,77)').run();
db.prepare("INSERT INTO margens_operacionais_premissas VALUES (1,'2026-01','2026-12',12.5)").run();
db.prepare("INSERT INTO param_regimes VALUES ('lucro_real',0.0925),('lucro_presumido',0.0365),('simples_nacional',0),('simples_regime_regular',0)").run();
const motorSombra = (_empresaId, opcoes) => { assert.strictEqual(opcoes.gravar, false); assert.strictEqual(opcoes.regimeEmpresa, 'simples_regime_regular'); return { apuracao: { cbs: { saldo: 77 }, ibs: { saldo: 3 } } }; };
let r = comparador.comparar(db, 1, { executarMotor: motorSombra });
assert.strictEqual(r.cenarios.find((x) => x.chave === 'lucro_presumido').status, 'PARCIAL');
assert.strictEqual(r.melhor_cenario_estimado, 'INDETERMINADO');
assert.strictEqual(r.cenarios.find((x) => x.chave === 'simples_regime_regular').componentes_disponiveis.cbs_hibrida_motor.valor, 77);

const inserir = db.prepare(`INSERT INTO param_irpj_csll_versionados
  (tributo,regime,natureza_receita,tipo_base,percentual_base,aliquota,adicional,limite_adicional,limite_receita_anual,acrescimo_percentual_base_excedente,aplicacao_excedente,vigencia_inicio,fonte,fundamento,versao,status)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'ATIVO')`);
const fundamento = 'Matriz aprovada 4D.2';
inserir.run('IRPJ','lucro_real','GERAL','MARGEM_OPERACIONAL',null,.15,.10,20000,null,null,null,'2026-01-01','MATRIZ',fundamento,'4D.2-2026');
inserir.run('CSLL','lucro_real','GERAL','MARGEM_OPERACIONAL',null,.09,null,null,null,null,null,'2026-01-01','MATRIZ',fundamento,'4D.2-2026');
for (const [natureza, irpj, csll] of [['COMERCIO_INDUSTRIA',.08,.12],['SERVICOS_GERAIS',.32,.32],['INTERMEDIACAO',.32,.32],['LOCACAO_CESSAO_BENS_DIREITOS',.32,.32],['TRANSPORTE_CARGA',.08,.12],['SERVICO_HOSPITALAR_QUALIFICADO',.08,.12]]) {
  inserir.run('IRPJ','lucro_presumido',natureza,'BASE_PRESUNCAO',irpj,.15,.10,20000,5000000,.10,'PROPORCIONAL_ATIVIDADE','2026-01-01','MATRIZ',fundamento,'4D.2-2026');
  inserir.run('CSLL','lucro_presumido',natureza,'BASE_PRESUNCAO',csll,.09,null,null,5000000,.10,'PROPORCIONAL_ATIVIDADE','2026-01-01','MATRIZ',fundamento,'4D.2-2026');
}
r = comparador.comparar(db, 1, { executarMotor: motorSombra });
const lr = r.cenarios.find((x) => x.chave === 'lucro_real');
const lp = r.cenarios.find((x) => x.chave === 'lucro_presumido');
assert.strictEqual(lr.status, 'COMPLETO');
assert.strictEqual(lr.componentes_disponiveis.irpj_csll.natureza, 'SIMULADO');
assert.strictEqual(lp.status, 'COMPLETO');
assert.strictEqual(lp.componentes_disponiveis.irpj_csll.valor, 76.8, 'serviços gerais: IRPJ 48 + CSLL 28,8');
assert.strictEqual(r.cenarios_comparaveis, 2);
assert.notStrictEqual(r.melhor_cenario_estimado, 'INDETERMINADO');
assert.strictEqual(r.cenarios.find((x) => x.chave === 'simples_regime_regular').status, 'PARCIAL');

// O excedente 2026 é aplicado somente acima do limite proporcional de três meses.
db.prepare("INSERT INTO empresas VALUES (3,'Empresa Excedente','lucro_presumido')").run();
for (const competencia of ['2026-01','2026-02','2026-03']) db.prepare('INSERT INTO perfil_tributario VALUES (3,?,500000,0,500000,0,0,0,0)').run(competencia);
db.prepare('INSERT INTO perfil_cbs_competencias VALUES (3,0)').run();
const excedente = comparador.comparar(db, 3, { executarMotor: motorSombra }).cenarios.find((x) => x.chave === 'lucro_presumido');
assert.strictEqual(excedente.status, 'COMPLETO');
assert.strictEqual(excedente.componentes_disponiveis.irpj_csll.detalhes[0].excedente_proporcional, 250000);

const simples = comparador.comparar(db, 2, { executarMotor: motorSombra });
assert.strictEqual(simples.cenarios.find((x) => x.chave === 'simples_nacional').status, 'COMPLETO');
assert.strictEqual(simples.pgdas_conectado, true);
const hibrido = simples.cenarios.find((x) => x.chave === 'simples_regime_regular');
assert.strictEqual(hibrido.status, 'COMPLETO');
assert.strictEqual(hibrido.natureza, 'SIMULADO');
assert.strictEqual(hibrido.componentes_disponiveis.das_remanescente_pgdas.valor, 75);
assert.strictEqual(hibrido.tributos_estimados, 155);
assert.strictEqual(simples.cenarios_comparaveis, 3);
assert.notStrictEqual(simples.melhor_cenario_estimado, 'INDETERMINADO');

// DAS sem decomposição documentada não autoriza subtrair PIS/Cofins por aproximação.
db.prepare("INSERT INTO empresas VALUES (4,'Empresa Simples Sem Decomposição','simples_nacional')").run();
db.prepare("INSERT INTO perfil_tributario VALUES (4,'2026-01',1000,0,1000,0,90,0,0)").run();
db.prepare('INSERT INTO perfil_cbs_competencias VALUES (4,77)').run();
const hibridoSemDecomposicao = comparador.comparar(db, 4, { executarMotor: motorSombra }).cenarios.find((x) => x.chave === 'simples_regime_regular');
assert.strictEqual(hibridoSemDecomposicao.status, 'PARCIAL');
assert.strictEqual(hibridoSemDecomposicao.tributos_estimados, null);
db.close();
console.log('Fase 4D.3: cenário híbrido compara DAS remanescente real com CBS/IBS do motor em sombra.');
