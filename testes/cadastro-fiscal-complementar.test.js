const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cfc-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
const cfc = require('../src/services/cadastroFiscalComplementar');
const identidade = require('../src/services/identidadeProduto');
const empresa = db.prepare("INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)").run('00000000000001','Empresa teste').lastInsertRowid;
const base = { empresa_id:Number(empresa), codigo_produto:'P-01', ncm:'38089199', usuario_id:'teste' };
const produto = identidade.resolver({empresa_id:Number(empresa),tipo_origem:'XML_CPROD',codigo_origem:'SKU-1',ncm:'38089199',descricao:'Produto teste'});
assert.equal(produto.status,'CRIADO_SEM_FATO_FISCAL'); assert.equal(identidade.resolver({empresa_id:Number(empresa),tipo_origem:'XML_CPROD',codigo_origem:'SKU-1',ncm:'99999999'}).status,'CONFLITO_NCM_PRODUTO');

// A: operação/documento prevalece sobre cadastro.
cfc.salvarFato({ ...base, fato:'defensivo_agropecuario', valor:'NAO', vigencia_inicio:'2026-01-01' });
let r=cfc.resolverFato({ ...base, data:'2026-02-01', fatos_documento:{ defensivo_agropecuario:true } },'defensivo_agropecuario');
assert.equal(r.origem,'XML_SPED_MOVIMENTO'); assert.equal(r.valor,true);
// B: sem documento, usa cadastro empresa+produto.
r=cfc.resolverFato({ ...base, data:'2026-02-01' },'defensivo_agropecuario'); assert.equal(r.origem,'CADASTRO_EMPRESA_PRODUTO'); assert.equal(r.valor,false);
// C: fato ausente permanece não determinado; D: responder pendência grava cadastro.
assert.equal(cfc.resolverFato({ ...base },'fertilizante').status,'NAO_DETERMINADO');
const p=cfc.criarPendencia({ ...base, fato_faltante:'fertilizante', produto_descricao:'Produto de teste' });
const resposta=cfc.responderPendencia(p.id,'SIM',{ ...base, usuario_id:'teste' }); assert.equal(resposta.status,'RESPONDIDA');
// E: próxima operação reutiliza o cadastro.
assert.equal(cfc.resolverFato({ ...base },'fertilizante').valor,true);
// F: lote é composto de registros independentes por produto.
['P-02','P-03'].forEach(codigo_produto=>cfc.salvarFato({ ...base,codigo_produto,fato:'revendedor',valor:'SIM' }));
assert.equal(cfc.resolverFato({ ...base,codigo_produto:'P-03' },'revendedor').valor,true);
// G: conflito documento x cadastro é registrado e precedência respeitada.
cfc.resolverFato({ ...base, fatos_documento:{ fertilizante:false } },'fertilizante');
assert.equal(db.prepare("SELECT COUNT(*) c FROM conflitos_fatos_fiscais WHERE fato='fertilizante'").get().c,1);
// H: vigência vencida não resolve; I: NÃO SEI não cria novo fato especial.
cfc.salvarFato({ ...base,codigo_produto:'P-04',fato:'origem_mineral',valor:'SIM',vigencia_inicio:'2020-01-01',vigencia_fim:'2020-12-31' });
assert.equal(cfc.resolverFato({ ...base,codigo_produto:'P-04',data:'2026-01-01' },'origem_mineral').status,'NAO_DETERMINADO');
const p2=cfc.criarPendencia({ ...base,codigo_produto:'P-05',fato_faltante:'uso_veterinario' }); cfc.responderPendencia(p2.id,'NAO_SEI',{...base,usuario_id:'teste'});
assert.equal(cfc.resolverFato({ ...base,codigo_produto:'P-05' },'uso_veterinario').status,'NAO_DETERMINADO');
// J: alteração produz histórico, sem apagar a versão anterior.
cfc.salvarFato({ ...base,fato:'fertilizante',valor:'NAO' });
assert.ok(db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal_historico WHERE fato='fertilizante'").get().c >= 2);
// Suplementares: vigência sobreposta, NULL x FALSE, extras, empresa/NCM e lote atômico.
cfc.salvarFato({ ...base,codigo_produto:'P-06',fato:'importador',valor:'SIM',vigencia_inicio:'2026-01-01',vigencia_fim:'2026-12-31' }); assert.throws(()=>cfc.salvarFato({ ...base,codigo_produto:'P-06',fato:'importador',valor:'NAO',vigencia_inicio:'2026-06-01',vigencia_fim:'2026-12-31' }), /vigência sobreposta/i);
assert.equal(cfc.resolverFato({ ...base,codigo_produto:'P-07' },'importador').valor,null);
assert.throws(()=>cfc.validarFatosExtras({qualquer_coisa:'x'}),/não reconhecido/i);
assert.throws(()=>cfc.validarFatosExtras({papel_vendedor:'OUTRO'}),/inválido/i);
cfc.salvarFatosExtras({ ...base,fatos_extras:{papel_vendedor:'REVENDEDOR'} });
const outra=db.prepare("INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)").run('00000000000002','Outra').lastInsertRowid;
assert.equal(cfc.resolverFato({ ...base,empresa_id:Number(outra) },'fertilizante').status,'NAO_DETERMINADO');
cfc.resolverFato({ ...base,ncm:'99999999' },'fertilizante'); assert.equal(db.prepare("SELECT COUNT(*) c FROM conflitos_fatos_fiscais WHERE fato='CONFLITO_NCM_PRODUTO'").get().c,1);
const dup1=cfc.criarPendencia({ ...base,codigo_produto:'P-08',fato_faltante:'corretivo_solo',familia_regra:'A' }); const dup2=cfc.criarPendencia({ ...base,codigo_produto:'P-08',fato_faltante:'corretivo_solo',familia_regra:'A' }); assert.equal(dup1.id,dup2.id);
cfc.salvarFato({ ...base,codigo_produto:'P-09',fato:'origem_mineral',valor:'SIM',vigencia_inicio:'2020-01-01',vigencia_fim:'2020-12-31' }); cfc.salvarFato({ ...base,codigo_produto:'P-09',fato:'origem_mineral',valor:'NAO',vigencia_inicio:'2021-01-01' });
assert.equal(cfc.resolverFato({ ...base,codigo_produto:'P-09',data:'2020-06-01' },'origem_mineral').valor,true); assert.equal(cfc.resolverFato({ ...base,codigo_produto:'P-09',data:'2022-01-01' },'origem_mineral').valor,false);
assert.throws(()=>cfc.salvarLote({ ...base,fato:'revendedor',valor:'SIM',itens:[{codigo_produto:'P-10'},{codigo_produto:''}]}),/código/i); assert.equal(db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal WHERE codigo_produto='P-10'").get().c,0);
assert.equal(cfc.salvarLote({ ...base,fato:'revendedor',valor:'SIM',itens:[{codigo_produto:'P-11'},{codigo_produto:'P-12'}]}).length,2);

// Identidade interna do produto: criação, consulta, validação de empresa e histórico.
const produtoInterno = identidade.resolver({empresa_id:Number(empresa),tipo_origem:'XML_CPROD',codigo_origem:'SKU-INTERNO',ncm:'27101259',descricao:'Produto com identidade interna'});
const porIdentidade = { empresa_id:Number(empresa), produto_empresa_id:produtoInterno.produto_empresa_id, ncm:'27101259', usuario_id:'teste' };
// A: cria sem código informado; B: encontra pela identidade interna.
const criadoInterno = cfc.salvarFato({ ...porIdentidade, fato:'importador', valor:'SIM', vigencia_inicio:'2026-01-01', vigencia_fim:'2026-12-31' });
assert.ok(criadoInterno.id > 0);
assert.equal(cfc.resolverFato({ ...porIdentidade, codigo_produto:'CODIGO-DIVERGENTE', data:'2026-02-01' },'importador').valor,true);
// C: produto de outra empresa é rejeitado.
const produtoOutraEmpresa = identidade.resolver({empresa_id:Number(outra),tipo_origem:'XML_CPROD',codigo_origem:'SKU-OUTRA',ncm:'27101259',descricao:'Produto de outra empresa'});
assert.throws(()=>cfc.salvarFato({ ...base, produto_empresa_id:produtoOutraEmpresa.produto_empresa_id, fato:'importador', valor:'SIM' }),/não pertence/i);
// D: com identidade, código divergente é somente snapshot; a identidade continua prevalecendo.
cfc.salvarFato({ ...porIdentidade, codigo_produto:'CODIGO-DIVERGENTE', fato:'importador', valor:'NAO', vigencia_inicio:'2027-01-01' });
assert.equal(cfc.resolverFato({ ...porIdentidade, codigo_produto:'OUTRO-CODIGO', data:'2027-02-01' },'importador').valor,false);
// E: fluxo legado permanece pesquisável por código.
assert.equal(cfc.resolverFato({ ...base, codigo_produto:'P-03' },'revendedor').valor,true);
// F: sobreposição para a mesma identidade interna é recusada.
assert.throws(()=>cfc.salvarFato({ ...porIdentidade, fato:'importador', valor:'NAO', vigencia_inicio:'2026-06-01', vigencia_fim:'2026-12-31' }),/vigência sobreposta/i);
// G: histórico novo carrega produto_empresa_id; H: histórico legado sem a coluna preenchida continua legível.
const historicoInterno = db.prepare('SELECT * FROM empresa_produto_fiscal_historico WHERE cadastro_id=? ORDER BY id DESC LIMIT 1').get(criadoInterno.id);
assert.equal(Number(historicoInterno.produto_empresa_id), Number(produtoInterno.produto_empresa_id));
db.prepare('INSERT INTO empresa_produto_fiscal_historico (cadastro_id,empresa_id,codigo_produto,fato,valor_novo,fonte) VALUES (?,?,?,?,?,?)').run(criadoInterno.id,empresa,'LEGADO','importador','true','LEGADO');
assert.equal(db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal_historico WHERE produto_empresa_id IS NULL AND codigo_produto='LEGADO'").get().c,1);

// Pendências por identidade interna: criação, deduplicação, resposta e reconciliação.
const produtoPendencia = identidade.resolver({empresa_id:Number(empresa),tipo_origem:'XML_CPROD',codigo_origem:'SKU-PENDENCIA',ncm:'30049099',descricao:'Produto de pendência'});
const basePendencia = { empresa_id:Number(empresa), produto_empresa_id:produtoPendencia.produto_empresa_id, ncm:'30049099', regra_id:'REGRA-PENDENCIA-1', familia_regra:'FAMILIA-PENDENCIA', fato_faltante:'fabricacao_propria', pergunta:'Confirme fabricação própria' };
// 1: aceita identidade sem código; 3 e 11: código não participa da identidade quando há produto interno.
const pendenciaIdentidade = cfc.criarPendencia(basePendencia);
assert.ok(pendenciaIdentidade.id > 0);
const pendenciaDuplicada = cfc.criarPendencia({ ...basePendencia, codigo_produto:'CODIGO-DIVERGENTE' });
assert.equal(pendenciaDuplicada.id, pendenciaIdentidade.id);
// 2: identidade de outra empresa é recusada.
assert.throws(()=>cfc.criarPendencia({ ...basePendencia, produto_empresa_id:produtoOutraEmpresa.produto_empresa_id }),/não pertence/i);
// 4: mesmo fato em outro produto é independente; 5: fatos distintos no mesmo produto também.
const outroProdutoPendencia=identidade.resolver({empresa_id:Number(empresa),tipo_origem:'XML_CPROD',codigo_origem:'SKU-PENDENCIA-2',ncm:'30049099',descricao:'Outro produto de pendência'});
const pendenciaOutroProduto=cfc.criarPendencia({ ...basePendencia, produto_empresa_id:outroProdutoPendencia.produto_empresa_id });
assert.notEqual(pendenciaOutroProduto.id,pendenciaIdentidade.id);
const pendenciaOutroFato=cfc.criarPendencia({ ...basePendencia, fato_faltante:'importador' });
assert.notEqual(pendenciaOutroFato.id,pendenciaIdentidade.id);
// 6: SIM grava fato pela identidade; 12: histórico recebe produto_empresa_id.
assert.equal(cfc.responderPendencia(pendenciaIdentidade.id,'SIM',{usuario_id:'teste'}).status,'RESPONDIDA');
assert.equal(cfc.resolverFato({empresa_id:Number(empresa),produto_empresa_id:produtoPendencia.produto_empresa_id,codigo_produto:'NAO-USAR'},'fabricacao_propria').valor,true);
assert.equal(Number(db.prepare("SELECT produto_empresa_id FROM empresa_produto_fiscal_historico WHERE fato='fabricacao_propria' ORDER BY id DESC LIMIT 1").get().produto_empresa_id),Number(produtoPendencia.produto_empresa_id));
// 7: NÃO grava FALSE explícito.
assert.equal(cfc.responderPendencia(pendenciaOutroFato.id,'NÃO',{usuario_id:'teste'}).status,'RESPONDIDA');
assert.equal(cfc.resolverFato({empresa_id:Number(empresa),produto_empresa_id:produtoPendencia.produto_empresa_id},'importador').valor,false);
// 8: NÃO SEI não cria FALSE.
const pendenciaNaoSei=cfc.criarPendencia({ ...basePendencia, fato_faltante:'fertilizante' });
assert.equal(cfc.responderPendencia(pendenciaNaoSei.id,'NÃO SEI',{usuario_id:'teste'}).status,'IGNORADA');
assert.equal(cfc.resolverFato({empresa_id:Number(empresa),produto_empresa_id:produtoPendencia.produto_empresa_id},'fertilizante').status,'NAO_DETERMINADO');
// 9: duplicidade histórica aberta é reconciliada, sem alcançar outro produto.
db.exec('DROP INDEX ux_pendencias_fiscais_produtos_abertas_identidade');
const paraReconciliar=cfc.criarPendencia({ ...basePendencia, fato_faltante:'revendedor', regra_id:'REGRA-RECONCILIAR', familia_regra:'FAMILIA-RECONCILIAR' });
const duplicataHistorica=db.prepare(`INSERT INTO pendencias_fiscais_produtos (empresa_id,produto_empresa_id,codigo_produto,ncm,regra_id,familia_regra,fato_faltante,pergunta,status) VALUES (?,?,?,?,?,?,?,?,?)`)
  .run(empresa,produtoPendencia.produto_empresa_id,'SNAPSHOT-ANTIGO','30049099','REGRA-RECONCILIAR','FAMILIA-RECONCILIAR','revendedor','Histórica','PENDENTE').lastInsertRowid;
assert.equal(cfc.responderPendencia(paraReconciliar.id,'SIM',{usuario_id:'teste'}).status,'RESPONDIDA');
assert.equal(db.prepare('SELECT status FROM pendencias_fiscais_produtos WHERE id=?').get(duplicataHistorica).status,'RESOLVIDA_AUTOMATICAMENTE');
assert.equal(db.prepare('SELECT status FROM pendencias_fiscais_produtos WHERE id=?').get(pendenciaOutroProduto.id).status,'PENDENTE');
// 10: pendência legada, sem produto_empresa_id, continua legível.
const pendenciaLegada=cfc.criarPendencia({empresa_id:Number(empresa),codigo_produto:'PENDENCIA-LEGADA',fato_faltante:'origem_mineral',familia_regra:'LEGADA'});
assert.equal(cfc.listarPendencias(Number(empresa)).some(x=>x.id===pendenciaLegada.id && x.produto_empresa_id===null),true);

// Lote por produto_empresa_id: sucesso, isolamento por empresa e rollback integral.
const loteProdutos=Array.from({length:10},(_,i)=>identidade.resolver({empresa_id:Number(empresa),tipo_origem:'XML_CPROD',codigo_origem:`SKU-LOTE-${i}`,ncm:'27101259',descricao:`Produto de lote ${i}`}));
const idsLote=loteProdutos.map(x=>x.produto_empresa_id);
assert.equal(cfc.salvarLote({empresa_id:Number(empresa),produtos_empresa_id:idsLote,fato:'corretivo_solo',valor:'SIM',usuario_id:'teste'}).length,10);
assert.equal(db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal WHERE corretivo_solo=1 AND produto_empresa_id IN ("+idsLote.map(()=>'?').join(',')+")").get(...idsLote).c,10);
assert.equal(db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal_historico WHERE fato='corretivo_solo' AND produto_empresa_id IN ("+idsLote.map(()=>'?').join(',')+")").get(...idsLote).c,10);
const mesmoCodigoOutraEmpresa=identidade.resolver({empresa_id:Number(outra),tipo_origem:'XML_CPROD',codigo_origem:'SKU-LOTE-0',ncm:'27101259',descricao:'Mesmo código, outra empresa'});
const antesFalha=db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal WHERE origem_mineral IS NOT NULL").get().c;
assert.throws(()=>cfc.salvarLote({empresa_id:Number(empresa),produtos_empresa_id:[idsLote[0],mesmoCodigoOutraEmpresa.produto_empresa_id],fato:'origem_mineral',valor:'SIM',usuario_id:'teste'}),/Lote rejeitado.*não pertence/i);
assert.equal(db.prepare("SELECT COUNT(*) c FROM empresa_produto_fiscal WHERE origem_mineral IS NOT NULL").get().c,antesFalha);
assert.throws(()=>cfc.salvarLote({empresa_id:Number(empresa),produtos_empresa_id:[idsLote[0],idsLote[1]],fato:'fato_invalido',valor:'SIM',usuario_id:'teste'}),/não permitido/i);
console.log('cadastro-fiscal-complementar: 50 cenários aprovados');
db.close(); fs.rmSync(pasta,{recursive:true,force:true});
