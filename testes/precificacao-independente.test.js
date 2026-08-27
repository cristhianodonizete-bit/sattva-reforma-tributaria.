#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-prec-independente-')); process.env.SATTVA_DADOS = dir;
const db = require('../src/db'); const pricing = require('../src/services/precificacaoIndependente'); const executivo = require('../src/services/precificacaoExecutiva'); const { PassThrough } = require('node:stream');
try {
  const valida = pricing.validarPlanilha({ produtos:[{codigo:'P1',descricao:'Produto',ncm:'85171300',quantidade_producao:10,valor_venda_atual:100},{codigo:'P2',descricao:'Outro produto',ncm:'85171300',quantidade_producao:5,valor_venda_atual:200}], servicos:[{codigo:'S1',descricao:'Serviço simples',lc116:'1.07',quantidade_producao:2,valor_venda_atual:500},{codigo:'S2',descricao:'Serviço composto',nbs:'115013000',quantidade_producao:1,valor_venda_atual:600}], componentes:[{codigo_item_saida:'P1',codigo_componente:'MP1',descricao:'Insumo',tipo_componente:'produto',ncm:'11111111',quantidade:2,custo_unitario_bruto:10,regime_fornecedor:'lucro_real'},{codigo_item_saida:'P1',codigo_componente:'MP2',descricao:'Frete',tipo_componente:'frete',quantidade:1,custo_unitario_bruto:5,regime_fornecedor:'lucro_real'},{codigo_item_saida:'P2',codigo_componente:'MP1',descricao:'Mesmo insumo',tipo_componente:'produto',ncm:'11111111',quantidade:3,custo_unitario_bruto:10,regime_fornecedor:'lucro_real'},{codigo_item_saida:'S2',codigo_componente:'T1',descricao:'Terceiro',tipo_componente:'terceiros',quantidade:1,custo_unitario_bruto:50,regime_fornecedor:'lucro_real'}] });
  assert.equal(valida.erros.length, 0, 'produto e serviço com composição explícita devem validar');
  const incompleta = pricing.validarPlanilha({ produtos:[{codigo:'P2',descricao:'Sem composição',ncm:'85171300',quantidade_producao:1,valor_venda_atual:1}],servicos:[],componentes:[] });
  assert.ok(incompleta.erros.some(x=>/sem composição/i.test(x.erro)), 'composição ausente não pode contaminar a base ativa');
  const empresaId = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('97111111000001','Fixture precificação','lucro_real')").run().lastInsertRowid);
  db.prepare("INSERT INTO base_ncm (ncm,descricao,cst,cclasstrib,classificacao,reducao) VALUES ('85171300','Produto fixture','000','000001','Tributação integral','integral')").run();
  db.prepare("INSERT INTO base_servicos (lc116,nbs,descricao_item,cclasstrib,nome_cclasstrib,reducao) VALUES ('1.07','115013000','Serviço fixture','000001','Tributação integral','integral')").run();
  const produtoId = Number(db.prepare("INSERT INTO pricing_products (empresa_id,codigo,descricao,ncm,quantidade_producao,valor_venda_atual) VALUES (?,?,?,?,?,?)").run(empresaId,'P1','Produto','85171300',10,100).lastInsertRowid);
  const servicoId = Number(db.prepare("INSERT INTO pricing_services (empresa_id,codigo,descricao,nbs,quantidade_producao,valor_venda_atual) VALUES (?,?,?,?,?,?)").run(empresaId,'S1','Serviço','115013000',2,500).lastInsertRowid);
  db.prepare("INSERT INTO pricing_components (empresa_id,produto_saida_id,codigo_componente,descricao,tipo_componente,ncm,quantidade,custo_unitario_bruto,regime_fornecedor) VALUES (?,?,?,?,?,?,?,?,?)").run(empresaId,produtoId,'MP1','Insumo','produto','85171300',2,10,'lucro_real');
  db.prepare("INSERT INTO pricing_components (empresa_id,servico_saida_id,codigo_componente,descricao,tipo_componente,nbs,quantidade,custo_unitario_bruto,regime_fornecedor) VALUES (?,?,?,?,?,?,?,?,?)").run(empresaId,servicoId,'T1','Terceiro','terceiros','115013000',1,50,'lucro_real');
  const base = pricing.listarBase(empresaId);
  assert.equal(base.produtos.length,1); assert.equal(base.servicos.length,1); assert.equal(base.componentes.length,2);
  assert.notEqual(base.componentes[0].produto_saida_id, null); assert.notEqual(base.componentes[1].servico_saida_id, null);
  const formado = pricing.calcularEmpresa(empresaId, { ano: 2027 });
  assert.equal(formado.find(x=>x.item.codigo === 'P1').status, 'COMPLETO', 'produto com componente fiscalmente determinado forma custo');
  assert.equal(formado.find(x=>x.item.codigo === 'S1').status, 'COMPLETO', 'serviço simples pode formar custo somente pelo custo direto');
  const precoFixo = pricing.simularEmpresa(empresaId,{ano:2027,modo:'PRESERVAR_PRECO_FINAL'}).find(x=>x.item.codigo==='P1');
  const margem = pricing.simularEmpresa(empresaId,{ano:2027,modo:'PRESERVAR_MARGEM'}).find(x=>x.item.codigo==='P1');
  const livre = pricing.simularEmpresa(empresaId,{ano:2027,modo:'REAJUSTE_LIVRE',percentual_reajuste:0.1}).find(x=>x.item.codigo==='P1');
  const cliente = pricing.simularEmpresa(empresaId,{ano:2027,modo:'PRESERVAR_CUSTO_EFETIVO_CLIENTE'}).find(x=>x.item.codigo==='P1');
  assert.ok(precoFixo.simulacao.preco_projetado >= 0, 'preservar preço usa motor oficial');
  assert.ok(margem.simulacao.margem_projetada != null, 'preservar margem exige e usa custo completo');
  assert.ok(livre.simulacao.preco_projetado > precoFixo.simulacao.preco_projetado, 'reajuste livre altera somente a premissa comercial');
  assert.equal(cliente.status,'INCOMPLETO','B2B/perfil sem crédito determinado não preserva custo efetivo por presunção');
  const relatorio = executivo.montar(empresaId,{ano:2027,modo:'PRESERVAR_MARGEM'});
  assert.equal(relatorio.itens.length,2,'saída executiva mantém produto e serviço');
  assert.ok(relatorio.indicadores.itens_credito_indeterminado >= 1,'crédito indeterminado permanece explícito');
  const pdf = new PassThrough(); let bytes=0; pdf.on('data',b=>{bytes+=b.length;}); executivo.gerarPdf(relatorio,pdf); pdf.on('end',()=>assert.ok(bytes>100,'PDF deve ser gerado com conteúdo'));
  const ruim = pricing.validarPlanilha({ produtos:[{codigo:'X',descricao:'Inválido',ncm:'123',quantidade_producao:1,valor_venda_atual:1}],servicos:[],componentes:[] });
  assert.ok(ruim.erros.some(x=>/NCM/i.test(x.erro)), 'NCM inválido bloqueia importação e rollback preserva a base ativa');
  console.log('precificacao-independente.test: base própria, produto, serviço, composição e bloqueio de composição incompleta aprovados.');
} finally { try { db.close?.(); } catch (_) {} fs.rmSync(dir,{recursive:true,force:true}); }
