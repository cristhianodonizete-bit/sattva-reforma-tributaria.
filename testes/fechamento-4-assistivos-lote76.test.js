const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path');
const pasta=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-assistivos-')); process.env.SATTVA_DADOS=pasta;
const db=require('../src/db'),cfc=require('../src/services/cadastroFiscalComplementar'),identidade=require('../src/services/identidadeProduto'),motor=require('../src/services/motorCondicionalPisCofins'),{aplicarPercentual,arredondarMoeda}=require('../src/services/percentual');
const rascunhos=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../outputs/fechamento_4_restantes_lote_76.json'))).regras;
const empresa=Number(db.prepare("INSERT INTO empresas(cnpj,razao_social) VALUES('84700000000001','Assistivos E2E')").run().lastInsertRowid);
function regras(ncm){return rascunhos.filter(r=>r.ncm===ncm).map(r=>({regra_id:r.id,familia_regra:r.familia,prioridade:r.prioridade_proposta,vigencia_inicio:r.vigencia_inicio,vigencia_fim:r.vigencia_fim,regime_pis_cofins:r.regime_pis_cofins,condicoes:r.condicoes_obrigatorias.map(c=>({...c,valor:c.valor})),resultado:{cst_pis:r.cst_pis,cst_cofins:r.cst_cofins,pis_percentual:r.pis_percentual,cofins_percentual:r.cofins_percentual,tratamento:r.tratamento_resultante}}));}
function ctx(ncm,codigo,data='2026-04-01',regime='CUMULATIVO',fatos={}){const p=identidade.resolver({empresa_id:empresa,tipo_origem:'CADASTRO',codigo_origem:codigo,ncm,descricao:'Assistivo'});return {empresa_id:empresa,produto_empresa_id:p.produto_empresa_id,ncm,codigo_produto:codigo,data_operacao:data,regime_pis_cofins:regime,fatos_operacao:fatos};}
function avaliar(ncm,codigo,fatos,data,regime){return motor.selecionar(regras(ncm),ctx(ncm,codigo,data,regime,fatos),{criar_pendencia:true});}
for(const ncm of ['84701000','84719014']){
  assert.equal(avaliar(ncm,`${ncm}-T`,{possui_sintetizador_voz:true},'2026-03-31').status,'APLICAVEL');
  assert.equal(avaliar(ncm,`${ncm}-F`,{possui_sintetizador_voz:false}).status,'NAO_APLICAVEL');
  assert.equal(avaliar(ncm,`${ncm}-N`,{}).status,'INDETERMINADA');
  const base=ctx(ncm,`${ncm}-R`); let pend=avaliar(ncm,`${ncm}-R`,{}); assert.equal(pend.status,'INDETERMINADA');
  const ps=cfc.listarPendencias(empresa,{fato:'possui_sintetizador_voz'}); assert.ok(ps.length>=1); cfc.responderPendencia(ps.at(-1).id,'SIM',{usuario_id:'e2e'});
  const aposResposta=motor.selecionar(regras(ncm),base); assert.equal(aposResposta.status,'APLICAVEL');
  assert.equal(avaliar(ncm,`${ncm}-C`,{possui_sintetizador_voz:true},'2026-04-01','CUMULATIVO').selecionada.regra.resultado.pis_percentual,0.065);
  assert.equal(avaliar(ncm,`${ncm}-NC`,{possui_sintetizador_voz:true},'2026-04-01','NAO_CUMULATIVO').selecionada.regra.resultado.cofins_percentual,0.76);
}
assert.equal(avaliar('84716053','MOUSE',{adaptado_para_pessoa_com_deficiencia:true,acionador_pressao:false}).status,'APLICAVEL');
assert.equal(avaliar('84716053','PRESS',{adaptado_para_pessoa_com_deficiencia:false,acionador_pressao:true}).status,'APLICAVEL');
assert.equal(avaliar('84716053','AMBOS',{adaptado_para_pessoa_com_deficiencia:true,acionador_pressao:true}).status,'APLICAVEL');
assert.equal(avaliar('84716053','NENHUM',{adaptado_para_pessoa_com_deficiencia:false,acionador_pressao:false}).status,'NAO_APLICAVEL');
assert.equal(avaliar('84716053','NULLS',{}).status,'INDETERMINADA');
assert.equal(avaliar('84716053','AUS1',{adaptado_para_pessoa_com_deficiencia:false}).status,'INDETERMINADA');
assert.equal(avaliar('84716053','AUS2',{acionador_pressao:false}).status,'INDETERMINADA');
assert.equal(avaliar('87142000','DIRETA',{},'2026-03-31').selecionada.regra.resultado.pis_percentual,0);
assert.equal(avaliar('87142000','DIRC',{},'2026-04-01','CUMULATIVO').selecionada.regra.resultado.cofins_percentual,0.30);
assert.equal(avaliar('87142000','DIRNC',{},'2026-04-01','NAO_CUMULATIVO').selecionada.regra.resultado.pis_percentual,0.165);
assert.deepEqual([arredondarMoeda(aplicarPercentual(10000,.065)),arredondarMoeda(aplicarPercentual(10000,.30)),arredondarMoeda(aplicarPercentual(10000,.165)),arredondarMoeda(aplicarPercentual(10000,.76))],[6.5,30,16.5,76]);
console.log('fechamento-4-assistivos-lote76: 25 cenários aprovados'); db.close(); fs.rmSync(pasta,{recursive:true,force:true});
