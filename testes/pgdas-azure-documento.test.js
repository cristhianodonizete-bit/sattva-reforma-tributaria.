const assert = require('assert');
const sqlite = require('../src/sqlite');
const pgdas = require('../src/services/pgdasDocumentoIa');
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 10000) / 10000;

const db = sqlite.abrir(':memory:');
db.exec(`
 CREATE TABLE empresas (id INTEGER PRIMARY KEY, regime TEXT);
 CREATE TABLE perfil_tributario (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, competencia TEXT, receita_bruta REAL, receita_recebida REAL, receita_mercadorias REAL, receita_servicos REAL, receita_exportacao REAL, pis REAL, cofins REAL, das REAL, origem TEXT);
 CREATE TABLE pgdas_documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, nome_original TEXT, tipo_documento TEXT, mime_type TEXT, conteudo_original BLOB, hash_sha256 TEXT, competencia_detectada TEXT, data_processamento TEXT, metodo_extracao TEXT, status_processamento TEXT);
 CREATE TABLE pgdas_documento_campos (id INTEGER PRIMARY KEY AUTOINCREMENT, documento_id INTEGER, campo TEXT, valor_extraido TEXT, rotulo_original TEXT, pagina_ou_localizacao TEXT, confianca REAL, metodo_extracao TEXT, status_validacao TEXT);
 CREATE TABLE movimentos (empresa_id INTEGER, competencia TEXT, sentido TEXT, valor REAL, ncm TEXT, nbs TEXT, lc116 TEXT);
 CREATE TABLE param_simples (anexo TEXT, faixa INTEGER, limite REAL, aliquota_nominal REAL, parcela_deduzir REAL, rep_cofins REAL, rep_pis REAL);
 INSERT INTO empresas VALUES (1,'simples_nacional'),(2,'lucro_presumido');
 INSERT INTO param_simples VALUES
 ('I',4,1800000,.107,22500,.1274,.0276),
 ('III',4,1800000,.16,35640,.1364,.0296);
`);

const extrato = `Programa Gerador do Documento de Arrecadação do Simples Nacional - Declaratório
PGDAS-D 2018
Versão: 2.2.29
Período de Apuração: 01/06/2026 a 30/06/2026
Regime de Apuração: Caixa
2.6) Resumo da Declaração
Receita Bruta Auferida (regime competência) Receita Bruta Recebida (regime caixa) Valor Total do Débito Declarado (R$)
112.476,41 102.292,29 12.850,97
Receita bruta acumulada nos doze meses anteriores ao PA (RBT12) 1.659.529,60 0,00 1.659.529,60
Valor do Débito por Tributo para a Atividade (R$):
Revenda de mercadorias, exceto para o exterior - Sem substituição tributária/tributação monofásica/antecipação com encerramento de tributação
Receita Bruta Informada: R$ 21.195,83
IRPJ CSLL COFINS PIS/Pasep INSS/CPP ICMS IPI ISS Total
108,93 69,32 252,33 54,66 831,84 663,49 0,00 0,00 1.980,57
Valor do Débito por Tributo para a Atividade (R$):
Locação de bens móveis, exceto para o exterior
Receita Bruta Informada: R$ 4.182,32
IRPJ CSLL COFINS PIS/Pasep INSS/CPP ICMS IPI ISS Total
23,17 20,28 79,02 17,15 251,44 0,00 0,00 0,00 391,06
Valor do Débito por Tributo para a Atividade (R$):
Prestação de Serviços, exceto para o exterior - Não sujeitos ao fator r e tributados pelo Anexo III, sem retenção/substituição tributária de ISS
Receita Bruta Informada: R$ 73.024,43
IRPJ CSLL COFINS PIS/Pasep INSS/CPP ICMS IPI ISS Total
404,63 354,05 1.379,77 299,42 4.390,19 0,00 0,00 3.287,58 10.115,64
Valor do Débito por Tributo para a Atividade (R$):
Prestação de Serviços, exceto para o exterior - Não sujeitos ao fator r e tributados pelo Anexo III, com retenção/substituição tributária de ISS
Receita Bruta Informada: R$ 3.889,71
IRPJ CSLL COFINS PIS/Pasep INSS/CPP ICMS IPI ISS Total
21,55 18,86 73,49 15,95 233,85 0,00 0,00 0,00 363,70
Totais do Estabelecimento
Total do Débito Declarado (exigível + suspenso)
IRPJ CSLL COFINS PIS/Pasep INSS/CPP ICMS IPI ISS Total
558,28 462,51 1.784,61 387,18 5.707,32 663,49 0,00 3.287,58 12.850,97`;

const campos = pgdas.normalizarTexto(extrato);
assert.equal(campos.find((x) => x.campo === 'document_type').valor_extraido, 'PGDAS_D');
assert.equal(campos.find((x) => x.campo === 'competencia').valor_extraido, '2026-06');
assert.equal(campos.find((x) => x.campo === 'rbt12').valor_extraido, 1659529.60);
assert.equal(campos.find((x) => x.campo === 'receita_bruta').valor_extraido, 112476.41);
assert.equal(campos.find((x) => x.campo === 'receita_recebida').valor_extraido, 102292.29);
const blocos = JSON.parse(campos.find((x) => x.campo === 'revenue_blocks').valor_extraido);
assert.equal(blocos.length, 4);
assert.equal(blocos[0].anexo, 'I'); assert.equal(blocos[2].anexo, 'III');
assert.equal(blocos[2].factor_r_applicable, false, '"não sujeitos ao fator r" não pode acionar fator r');
assert.equal(blocos[2].iss_withheld, false, '"sem retenção" deve prevalecer');
assert.equal(blocos[3].factor_r_applicable, false);
assert.equal(blocos[3].iss_withheld, true, '"com retenção" deve ser ISS retido');
const valores = Object.fromEntries(campos.map((x) => [x.campo, x.campo === 'competencia' ? x.valor_extraido : Number(x.valor_extraido)]));
// Funções unitárias do motor: nenhuma deriva taxa de PIS/Cofins a partir do
// valor lido no PDF. A origem é sempre faixa + repartição de param_simples.
const faixaIII=pgdas.findSimplesBracket(db,{anexo:'III',rbt12:1659529.60,periodo_apuracao:'2026-06'});
assert.equal(faixaIII.faixa,4);
assert.equal(faixaIII.rbt12_max,1800000);
const efetivaIII=pgdas.calculateSimplesEffectiveRate({rbt12:1659529.60,aliquota_nominal:faixaIII.aliquota_nominal,parcela_deduzir:faixaIII.parcela_deduzir});
assert.equal(r2(efetivaIII),0.1385);
const distribuicaoIII=pgdas.getTaxDistribution(faixaIII);
assert.equal(distribuicaoIII.pis_distribution_percentage,.0296);
assert.equal(distribuicaoIII.cofins_distribution_percentage,.1364);
assert.equal(r2(pgdas.calculatePisEffectiveRate(efetivaIII,distribuicaoIII.pis_distribution_percentage)),.0041);
assert.equal(r2(pgdas.calculateCofinsEffectiveRate(efetivaIII,distribuicaoIII.cofins_distribution_percentage)),.0189);
const reproducao=pgdas.reproducePgdasTaxes({revenue_amount:73024.43,pis_effective_rate:efetivaIII*distribuicaoIII.pis_distribution_percentage,cofins_effective_rate:efetivaIII*distribuicaoIII.cofins_distribution_percentage,pgdas_pis:299.42,pgdas_cofins:1379.77});
assert.equal(reproducao.tax_rule_validated,true);
assert.equal(reproducao.calculation_status,'MATHEMATICALLY_VALIDATED');
assert.equal(campos.find((x)=>x.campo==='rpa_competencia').valor_extraido,112476.41);
assert.equal(campos.find((x)=>x.campo==='rpa_caixa').valor_extraido,102292.29);
assert.equal(campos.find((x)=>x.campo==='receita_mercadorias').valor_extraido,21195.83);
assert.equal(campos.find((x)=>x.campo==='receita_servicos').valor_extraido,76914.14);
assert.equal(campos.find((x)=>x.campo==='receita_locacao').valor_extraido,4182.32);
const validacao = pgdas.validarRegraBlocos(db, valores, blocos);
assert.equal(validacao.validada, true, validacao.motivo);
assert.equal(validacao.blocos[0].pgdas_validation.calculated_pis, 54.66);
assert.equal(validacao.blocos[2].pgdas_validation.calculated_cofins, 1379.77);
assert.equal(validacao.blocos[3].aceite_tributario.iss_withheld, undefined, 'retenção é classificação, não taxa calculada');
assert.equal(validacao.blocos[3].aceite_tributario.cofins_match, true);
assert.equal(validacao.blocos.every((b)=>b.pgdas_validation.tax_rule_validated),true);

// A competência vem dos DFe classificados: nunca se reaproveita a distribuição do caixa.
db.prepare("INSERT INTO movimentos VALUES (1,'2026-06','saida',50000,'12345678','',''),(1,'2026-06','saida',70000,'','1.01.01','')").run();
const doc = pgdas.ingerir(db,1,{nome_original:'pgdas.pdf',tipo_documento:'INTEGRA_CONTADOR_PDF',mime_type:'application/pdf',conteudo_original:Buffer.from('pgdas junho'),metodo_extracao:'teste'},campos);
const confirmado=pgdas.confirmar(db,1,doc.documento_id);
assert.equal(confirmado.validacao_regra_simples.validada,true);
assert.equal(confirmado.calculo_competencia.status,'REVIEW_REQUIRED');
assert.equal(confirmado.calculo_competencia.pis,null, 'não presume rateio entre serviços com e sem retenção');
assert.equal(confirmado.status_processamento,'VALIDADO_USUARIO');
const perfilConfirmado=db.prepare('SELECT pis,cofins FROM perfil_tributario WHERE empresa_id=1 AND competencia=?').get('2026-06');
assert.equal(perfilConfirmado.pis,387.18, 'Perfil recebe PIS efetivamente apurado no PGDAS validado');
assert.equal(perfilConfirmado.cofins,1784.61, 'Perfil recebe COFINS efetivamente apurada no PGDAS validado');

const desconhecido=pgdas.normalizarTexto('arquivo sem âncoras fiscais');
assert.equal(desconhecido.find((x)=>x.campo==='document_type').status_validacao,'INVALID_DOCUMENT');
assert.throws(()=>pgdas.ingerir(db,2,{nome_original:'x.pdf',tipo_documento:'PDF',conteudo_original:Buffer.from('x'),metodo_extracao:'teste'},campos),/Simples Nacional/);
db.close();
console.log(JSON.stringify(validacao.blocos.map((x) => ({ descricao:x.description_raw.slice(0, 55), factor_r_applicable:x.factor_r_applicable, iss_withheld:x.iss_withheld, ...x.aceite_tributario })), null, 2));
console.log('PGDAS: parser determinístico, blocos, validação tributária e competência aprovados.');
