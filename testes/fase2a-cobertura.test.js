const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = path.join(os.tmpdir(), `sattva-fase2a-${process.pid}-${Date.now()}`);
process.env.SATTVA_DADOS = dir;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = require('../src/db');
const perfil = require('../src/services/resolvedorPerfil');
const regra = require('../src/services/resolvedorRegra');
const cobertura = require('../src/services/coberturaDiagnostico');

try {
  // Cadastro mestre de parceiro é reutilizado por CNPJ, sem consulta externa.
  db.prepare(`INSERT INTO cnpj_cache (cnpj,razao_social,regime_derivado,fonte,consultado_em)
    VALUES ('12345678000199','Parceiro Simples','simples_nacional','FIXTURE',datetime('now'))`).run();
  const p = perfil.resolver({ cnpj: '12.345.678/0001-99' });
  assert.equal(p.perfil, 'SIMPLES');
  assert.equal(p.status, 'DETERMINADO');
  assert.equal(p.origem, 'FIXTURE');
  assert.equal(perfil.resolver({ cnpj: '99.999.999/0001-99' }).status, 'INDETERMINADO', 'parceiro desconhecido não pode receber perfil presumido');

  // Documento conclusivo vence regra e não permite que cadastro a sobrescreva.
  const doc = regra.resolver({ documento_conclusivo: true, cclasstrib: '000001', cst: '000', tratamento_documento: 'DOCUMENTAL' });
  assert.equal(doc.origem, 'DOCUMENTO');
  assert.equal(doc.status, 'DETERMINADO');

  db.prepare(`INSERT INTO regras_enquadramento (id,familia,tipo_operacao,ncm,condicoes_obrigatorias,tratamento_resultante,prioridade,versao,status,fonte)
    VALUES ('regra-ncm','MEDICAMENTOS','VENDA','30049099','["registro_anvisa"]','REDUCAO_CONDICIONAL',10,1,'ATIVA','FIXTURE')`).run();
  let r = regra.resolver({ tipo_operacao: 'VENDA', ncm: '30049099' });
  assert.equal(r.status, 'SUJEITO_VALIDACAO');
  assert.deepEqual(r.pendencias, ['registro_anvisa']);
  assert.notEqual(r.tratamento, 'ZERO');
  r = regra.resolver({ tipo_operacao: 'VENDA', ncm: '30049099', registro_anvisa: '123' });
  assert.equal(r.status, 'DETERMINADO');
  assert.equal(r.tratamento, 'REDUCAO_CONDICIONAL');
  assert.equal(r.origem, 'REGRA_ENQUADRAMENTO');
  r = regra.resolver({ tipo_operacao: 'VENDA', ncm: '99999999' });
  assert.equal(r.status, 'INDETERMINADO');

  // Regra legal versionada: vigência, condição e exclusão são fatos, não fórmula.
  db.prepare(`INSERT INTO regras_enquadramento (id,familia,tipo_operacao,condicoes_obrigatorias,condicoes_excludentes,tratamento_resultante,fundamento_legal,vigencia_inicio,vigencia_fim,prioridade,versao,status,fonte)
    VALUES ('lc214-art4-v1','OPERACAO_GERAL','FORNECIMENTO_ONEROSO','["contraprestacao"]','["operacao_nao_onerosa"]','INCIDENCIA_OPERACAO_ONEROSA','LC 214/2025, art. 4º','2027-01-01',null,50,1,'ATIVA','PLANALTO')`).run();
  r = regra.resolver({ tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2026-12-31' });
  assert.equal(r.status, 'INDETERMINADO', 'regra futura não atinge operação anterior');
  r = regra.resolver({ tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2027-01-01' });
  assert.equal(r.regra.id, 'lc214-art4-v1');
  r = regra.resolver({ tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, operacao_nao_onerosa: true, data: '2027-01-01' });
  assert.equal(r.status, 'INDETERMINADO', 'condição excludente impede aplicação parcial');
  r = regra.resolver({ documento_conclusivo: true, cclasstrib: '000001', cst: '000', tratamento_documento: 'DOCUMENTAL', tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2027-01-01' });
  assert.equal(r.origem, 'DOCUMENTO', 'documento conclusivo vence regra ativa conflitante');

  db.prepare(`INSERT INTO regras_enquadramento (id,familia,tipo_operacao,tratamento_resultante,prioridade,versao,status,fonte)
    VALUES ('conflito-a','TESTE','CONFLITO','A',5,1,'ATIVA','FIXTURE'),('conflito-b','TESTE','CONFLITO','B',5,1,'ATIVA','FIXTURE')`).run();
  r = regra.resolver({ tipo_operacao: 'CONFLITO', data: '2027-01-01' });
  assert.equal(r.codigo, 'CONFLITO_DE_REGRAS');

  // Catálogo pode popular cadastros reutilizáveis, mas não vira regra ativa.
  db.prepare("INSERT INTO base_ncm (ncm,descricao,tratatamento_efetivo_saida) VALUES ('01012100','Produto fixture','TRIBUTADA')".replace('tratatamento','tratamento')).run();
  db.prepare("INSERT INTO base_servicos (lc116,nbs,descricao_item,tratamento_efetivo_saida) VALUES ('0101','1110132','Serviço fixture','TRIBUTADA')").run();
  const pop = cobertura.popularCadastrosMestre();
  assert.equal(pop.parceiros, 1);
  assert.equal(pop.produtos, 1);
  assert.equal(pop.servicos, 1);
  const popReuso = cobertura.popularCadastrosMestre();
  assert.deepEqual(popReuso, { parceiros: 1, produtos: 0, servicos: 0 }, 'reuso do catálogo não pode duplicar cadastros');
  assert.equal(cobertura.mestres().regras_enquadramento.ativas, 4);
  assert.equal(cobertura.mestres().credito_presumido.ativas, 0);
  const familias = cobertura.familias([
    { valor: 10, dimensoes: { resultado: 'DETERMINADO', classificacao: 'DETERMINADO' }, linha: { detalhe: { reconstrucao: { modo_reconstrucao_monofasia: 'INDETERMINADO' } } } },
    { valor: 20, dimensoes: { resultado: 'DETERMINADO', classificacao: 'DETERMINADO' }, linha: { detalhe: { reconstrucao: { modo_reconstrucao_monofasia: 'PREMISSA_PERCENTUAL' } } } },
  ]);
  assert.equal(familias.find((x) => x.familia === 'MONOFASIA').quantidade, 1, 'campo indeterminado não pode identificar monofasia');
  assert.equal(familias.find((x) => x.familia === 'OPERACAO_REGULAR').quantidade, 1);
  console.log('fase2a-cobertura: perfil, precedência, regra condicional e cadastro mestre: OK');
} finally {
  try { db.close?.(); } catch (_) { /* noop */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
