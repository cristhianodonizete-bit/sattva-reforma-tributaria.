/* Parser determinístico do Extrato PGDAS-D. PIS/receita não é usado para descobrir taxa. */
const crypto = require('crypto');
const CAMPOS = ['document_type','document_family','document_version','regime_apuracao','competencia','rbt12','receita_bruta','receita_recebida','receita_mercadorias','receita_servicos','receita_exportacao','das','pis','cofins','revenue_blocks'];
const TOLERANCIA_CENTAVOS = 0.02;
const texto = (v) => String(v ?? '').trim();
const r2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const valorNumero = (v) => { const b=texto(v).replace(/R\$|\s/g,'').replace(/[^0-9,.-]/g,''); if(!b)return null; const n=Number(b.includes(',')?b.replace(/\./g,'').replace(',','.'):b); return Number.isFinite(n)?n:null; };
const competencia = (v) => { const m=texto(v).match(/(\d{2})\/(\d{4})|(\d{4})-(\d{2})/); return !m?null:m[1]?`${m[2]}-${m[1]}`:`${m[3]}-${m[4]}`; };
const linhasDe = (s) => String(s||'').split(/\r?\n/).map((x)=>x.replace(/\s+/g,' ').trim()).filter(Boolean);
const moedas = (s) => (String(s||'').match(/(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g)||[]).map(valorNumero).filter(Number.isFinite);
const campoBase=(campo,metodo)=>({campo,valor_extraido:null,rotulo_original:null,pagina_ou_localizacao:null,confianca:null,metodo_extracao:metodo,status_validacao:'INDETERMINADO'});

function classificarBloco(descricao) {
  const d=texto(descricao).toLowerCase();
  const explicito=d.match(/tributad[oa]s? pelo anexo\s+([ivx]+)/i)?.[1]?.toUpperCase();
  const atividade=/revenda de mercadorias|com[eé]rcio/.test(d)?'REVENDA':/industrializa|mercadorias industrializadas/.test(d)?'INDUSTRIA':/loca[cç][aã]o/.test(d)?'LOCACAO':/presta[cç][aã]o de servi[cç]os|servi[cç]os/.test(d)?'SERVICO':'INDETERMINADO';
  const anexo=explicito||(atividade==='REVENDA'?'I':atividade==='INDUSTRIA'?'II':atividade==='LOCACAO'?'III':null);
  const monofasica=/monof[aá]sic/.test(d)&&!/sem\s+(?:substitui[cç][aã]o|tributa[cç][aã]o\s+monof[aá]sica|antecipa[cç][aã]o)/.test(d);
  return {activity_group:atividade,anexo:anexo||null,market:/exceto para o exterior/.test(d)?'INTERNO':/para o exterior/.test(d)?'EXTERNO':'INDETERMINADO',factor_r_applicable:/fator\s+[“"]?r/.test(d),iss_withheld:/com reten[cç][aã]o\/substitui[cç][aã]o de iss/.test(d),pis_cofins_monophase:monofasica,classification_status:anexo?'CLASSIFICADO':'REVIEW_REQUIRED'};
}

/* A âncora do próprio PGDAS inicia cada bloco; não há ordem ou página fixa. */
function extrairBlocosReceita(textoDocumento) {
  const linhas=linhasDe(textoDocumento), blocos=[];
  for(let inicio=0;inicio<linhas.length;inicio+=1){
    if(!/^Valor do D[eé]bito por Tributo para a Atividade/i.test(linhas[inicio]))continue;
    let fim=linhas.findIndex((l,i)=>i>inicio&&(/^Valor do D[eé]bito por Tributo para a Atividade/i.test(l)||/^Totais do Estabelecimento/i.test(l)||/^2\.8\)/.test(l))); if(fim<0)fim=linhas.length;
    const trecho=linhas.slice(inicio+1,fim), receitaIdx=trecho.findIndex((l)=>/^Receita Bruta Informada:/i.test(l)), cabecalhoIdx=trecho.findIndex((l)=>/\bCOFINS\b.*\bPIS\/Pasep\b/i.test(l));
    if(receitaIdx<0||cabecalhoIdx<0)continue;
    const receita=valorNumero(trecho[receitaIdx].match(/R\$\s*([\d.,]+)/i)?.[1]), tributos=moedas(trecho.slice(cabecalhoIdx+1,cabecalhoIdx+3).join(' | '));
    if(!Number.isFinite(receita)||tributos.length<9)continue;
    const description_raw=trecho.slice(0,receitaIdx).join(' ').trim();
    const bloco={description_raw,revenue_amount:receita,taxes:{irpj:tributos[0],csll:tributos[1],cofins:tributos[2],pis:tributos[3],cpp:tributos[4],icms:tributos[5],ipi:tributos[6],iss:tributos[7],total:tributos[8]},...classificarBloco(description_raw)};
    if(!blocos.some((x)=>x.description_raw===bloco.description_raw&&x.revenue_amount===bloco.revenue_amount))blocos.push(bloco);
  }
  return blocos;
}

function normalizarTexto(textoDocumento,{localizacoes=[],metodo='NORMALIZACAO_DETERMINISTICA_PGDAS_V2'}={}) {
  const linhas=linhasDe(textoDocumento), saida=Object.fromEntries(CAMPOS.map((campo)=>[campo,campoBase(campo,metodo)]));
  const definir=(campo,valor,rotulo,confianca=.9,status='REQUER_VALIDACAO')=>{if(saida[campo].valor_extraido!==null||valor===null||valor===undefined)return; const local=localizacoes.find((x)=>String(x.texto||'').includes(rotulo)); saida[campo]={campo,valor_extraido:valor,rotulo_original:texto(rotulo).slice(0,180),pagina_ou_localizacao:local?.pagina?`p. ${local.pagina}`:null,confianca:local?.confianca??confianca,metodo_extracao:metodo,status_validacao:status};};
  const ePgdas=/PGDAS-D|Programa Gerador do Documento de Arrecadação[\s\S]*Simples Nacional/i.test(String(textoDocumento));
  definir('document_type',ePgdas?'PGDAS_D':'UNKNOWN','detector PGDAS-D',1,ePgdas?'REQUER_VALIDACAO':'INVALID_DOCUMENT');
  const familia=String(textoDocumento).match(/PGDAS-D\s*(\d{4})/i)?.[1]; if(familia)definir('document_family',`PGDAS_D_${familia}`,`PGDAS-D ${familia}`,1);
  const versao=String(textoDocumento).match(/Vers[aã]o\s*:?\s*([0-9.]+)/i)?.[1]; if(versao)definir('document_version',versao,`Versão ${versao}`,1);
  const reg=String(textoDocumento).match(/Regime de Apura[cç][aã]o:\s*(Caixa|Compet[eê]ncia)/i)?.[1]; if(reg)definir('regime_apuracao',reg.toUpperCase(),`Regime de Apuração: ${reg}`,1);
  const pa=String(textoDocumento).match(/Per[ií]odo de Apura[cç][aã]o:\s*(\d{2}\/\d{2}\/\d{4})/i)?.[1]; if(pa)definir('competencia',competencia(pa),`Período de Apuração: ${pa}`,1);
  const resumo=linhas.findIndex((l,i)=>/receita\s+bruta\s+auferida/i.test(l)&&/d[eé]bito\s+declarado/i.test(linhas.slice(i,i+4).join(' ')));
  if(resumo>=0){const vs=moedas(linhas.slice(resumo,resumo+7).join(' | ')), caixa=/receita\s+bruta\s+recebida/i.test(linhas.slice(resumo,resumo+4).join(' ')); if(caixa&&vs.length>=3){definir('receita_bruta',vs[0],linhas[resumo],.98);definir('receita_recebida',vs[1],linhas[resumo],.98);definir('das',vs[2],linhas[resumo],.98);}else if(vs.length>=2){definir('receita_bruta',vs[0],linhas[resumo],.98);definir('das',vs[1],linhas[resumo],.98);}}
  const rbt=String(textoDocumento).match(/RBT12\)?\s*([\d.]+,\d{2})/i)?.[1]; if(rbt)definir('rbt12',valorNumero(rbt),'RBT12',.98);
  const cabecalhos=linhas.map((linha,indice)=>({linha,indice})).filter(({linha})=>/IRPJ.*CSLL.*COFINS.*PIS\/Pasep/i.test(linha));
  for(const {linha,indice} of [...cabecalhos].reverse()){const vs=moedas(linhas.slice(indice+1,indice+3).join(' | '));if(vs.length>=4){definir('cofins',vs[2],linha,.95);definir('pis',vs[3],linha,.95);break;}}
  const blocos=extrairBlocosReceita(textoDocumento); if(blocos.length)definir('revenue_blocks',JSON.stringify(blocos),'Valor do Débito por Tributo para a Atividade',1);
  return CAMPOS.map((campo)=>saida[campo]);
}

function faixaDoSimples(db,anexo,rbt12){const fs=db.prepare('SELECT anexo,faixa,limite,aliquota_nominal,parcela_deduzir,rep_cofins,rep_pis FROM param_simples WHERE anexo=? ORDER BY faixa').all(anexo);return fs.find((x)=>rbt12<=Number(x.limite))||fs.at(-1)||null;}
function validarRegraBlocos(db,valores,blocos){
  if(!Array.isArray(blocos)||!blocos.length||!Number.isFinite(valores.rbt12)||valores.rbt12<=0)return {validada:false,motivo:'RBT12 ou blocos de receita do PGDAS não identificados.',blocos:[]};
  const memoria=[];
  for(const bloco of blocos){
    if(bloco.classification_status!=='CLASSIFICADO'||!bloco.anexo)return {validada:false,motivo:`Bloco sem classificação tributária segura: ${bloco.description_raw}`,blocos:memoria};
    if(bloco.pis_cofins_monophase)return {validada:false,motivo:`Tratamento monofásico requer regra específica: ${bloco.description_raw}`,blocos:memoria};
    const faixa=faixaDoSimples(db,bloco.anexo,valores.rbt12);if(!faixa)return {validada:false,motivo:`Tabela do Simples não cadastrada para Anexo ${bloco.anexo}.`,blocos:memoria};
    const efetiva=Math.max(0,(valores.rbt12*Number(faixa.aliquota_nominal)-Number(faixa.parcela_deduzir))/valores.rbt12), pisEsperado=r2(Number(bloco.revenue_amount)*efetiva*Number(faixa.rep_pis)), cofinsEsperado=r2(Number(bloco.revenue_amount)*efetiva*Number(faixa.rep_cofins)), pisPgdas=Number(bloco.taxes?.pis), cofinsPgdas=Number(bloco.taxes?.cofins), pisDelta=r2(pisEsperado-pisPgdas), cofinsDelta=r2(cofinsEsperado-cofinsPgdas);
    memoria.push({...bloco,calculation:{faixa:Number(faixa.faixa),rbt12:valores.rbt12,aliquota_nominal:Number(faixa.aliquota_nominal),parcela_deduzir:Number(faixa.parcela_deduzir),aliquota_efetiva_simples:efetiva,pis_distribution_percentage:Number(faixa.rep_pis),cofins_distribution_percentage:Number(faixa.rep_cofins),pis_effective_rate:efetiva*Number(faixa.rep_pis),cofins_effective_rate:efetiva*Number(faixa.rep_cofins)},pgdas_validation:{pgdas_pis:pisPgdas,calculated_pis:pisEsperado,pis_delta:pisDelta,pis_match:Math.abs(pisDelta)<=TOLERANCIA_CENTAVOS,pgdas_cofins:cofinsPgdas,calculated_cofins:cofinsEsperado,cofins_delta:cofinsDelta,cofins_match:Math.abs(cofinsDelta)<=TOLERANCIA_CENTAVOS}});
  }
  const esperadoReceita=Number.isFinite(valores.receita_recebida)&&valores.receita_recebida>0?valores.receita_recebida:valores.receita_bruta;
  const somaReceita=r2(memoria.reduce((s,x)=>s+Number(x.revenue_amount||0),0)), somaPis=r2(memoria.reduce((s,x)=>s+Number(x.taxes?.pis||0),0)), somaCofins=r2(memoria.reduce((s,x)=>s+Number(x.taxes?.cofins||0),0));
  const documento_validation={receita_blocos:somaReceita,receita_pgdas:esperadoReceita,receita_match:!Number.isFinite(esperadoReceita)||Math.abs(somaReceita-esperadoReceita)<=TOLERANCIA_CENTAVOS,pis_blocos:somaPis,pis_pgdas:valores.pis,pis_match:!Number.isFinite(valores.pis)||Math.abs(somaPis-valores.pis)<=TOLERANCIA_CENTAVOS,cofins_blocos:somaCofins,cofins_pgdas:valores.cofins,cofins_match:!Number.isFinite(valores.cofins)||Math.abs(somaCofins-valores.cofins)<=TOLERANCIA_CENTAVOS};
  const validada=memoria.every((x)=>x.pgdas_validation.pis_match&&x.pgdas_validation.cofins_match)&&documento_validation.receita_match&&documento_validation.pis_match&&documento_validation.cofins_match;return {validada,tolerancia:TOLERANCIA_CENTAVOS,motivo:validada?null:'A reprodução por bloco ou os totais do documento não conferem com o PGDAS dentro da tolerância.',blocos:memoria,documento_validation};
}
function calcularCompetenciaPisCofins(db,empresaId,valores,validacao){
  if(!validacao?.validada)return null;
  const porAnexoBloco=Object.groupBy(validacao.blocos,(x)=>x.anexo);
  const ambiguos=Object.entries(porAnexoBloco).filter(([,bs])=>bs.length>1).map(([anexo])=>anexo);
  // NCM/NBS/LC116 identifica comércio/serviço, mas não presume, por exemplo,
  // qual NFS-e pertence ao serviço com ISS retido. Sem chave documental que
  // diferencie os buckets, não existe base segura para cálculo em competência.
  if(ambiguos.length)return {status:'REVIEW_REQUIRED',pis:null,cofins:null,motivo:`A receita de competência ainda precisa ser vinculada aos buckets ${ambiguos.join(', ')} do PGDAS; não houve rateio automático.`,memoria:[]};
  const movs=db.prepare(`SELECT valor,ncm,nbs,lc116 FROM movimentos WHERE empresa_id=? AND competencia=? AND sentido='saida'`).all(empresaId,valores.competencia), porAnexo={}; movs.forEach((m)=>{const a=m.ncm?'I':(m.nbs||m.lc116?'III':null);if(a)porAnexo[a]=(porAnexo[a]||0)+(Number(m.valor)||0);});
  let pis=0,cofins=0;const memoria=[];for(const bloco of validacao.blocos){const receita=Number(porAnexo[bloco.anexo]||0);if(!receita)continue;const p=receita*bloco.calculation.pis_effective_rate,c=receita*bloco.calculation.cofins_effective_rate;pis+=p;cofins+=c;memoria.push({anexo:bloco.anexo,receita_competencia:r2(receita),pis:r2(p),cofins:r2(c),regra:bloco.calculation});}return {status:'CALCULADO',pis:r2(pis),cofins:r2(cofins),memoria};
}
function ingerir(db,empresaId,documento,campos){const e=db.prepare('SELECT id,regime FROM empresas WHERE id=?').get(empresaId);if(!e)throw new Error('Empresa não encontrada.');if(e.regime!=='simples_nacional')throw new Error('O PGDAS é aplicável somente à empresa do Simples Nacional.');const hash=crypto.createHash('sha256').update(documento.conteudo_original).digest('hex');if(db.prepare('SELECT id FROM pgdas_documentos WHERE empresa_id=? AND hash_sha256=?').get(empresaId,hash))throw new Error('Este documento PGDAS já foi enviado para esta empresa.');const pc=Object.fromEntries(campos.map((x)=>[x.campo,x]));const inserir=db.transaction(()=>{const doc=db.prepare(`INSERT INTO pgdas_documentos (empresa_id,nome_original,tipo_documento,mime_type,conteudo_original,hash_sha256,competencia_detectada,data_processamento,metodo_extracao,status_processamento) VALUES (?,?,?,?,?,?,?,?,?, 'REQUER_VALIDACAO')`).run(empresaId,documento.nome_original,documento.tipo_documento,documento.mime_type||null,documento.conteudo_original,hash,pc.competencia?.valor_extraido||null,new Date().toISOString(),documento.metodo_extracao), ins=db.prepare(`INSERT INTO pgdas_documento_campos (documento_id,campo,valor_extraido,rotulo_original,pagina_ou_localizacao,confianca,metodo_extracao,status_validacao) VALUES (?,?,?,?,?,?,?,?)`);campos.forEach((x)=>ins.run(doc.lastInsertRowid,x.campo,x.valor_extraido===null?null:String(x.valor_extraido),x.rotulo_original,x.pagina_ou_localizacao,x.confianca,x.metodo_extracao,x.status_validacao));return Number(doc.lastInsertRowid);});return {documento_id:inserir(),hash_sha256:hash,campos};}
function listar(db,empresaId){const ds=db.prepare('SELECT * FROM pgdas_documentos WHERE empresa_id=? ORDER BY id DESC').all(empresaId),cs=db.prepare(`SELECT c.* FROM pgdas_documento_campos c JOIN pgdas_documentos d ON d.id=c.documento_id WHERE d.empresa_id=? ORDER BY c.id`).all(empresaId);return ds.map((d)=>({...d,campos_extraidos:cs.filter((c)=>c.documento_id===d.id),campos_pendentes:cs.filter((c)=>c.documento_id===d.id&&c.status_validacao!=='VALIDADO_USUARIO').map((c)=>c.campo)}));}
function reprocessarCampos(db,empresaId,id,campos,metodo){const doc=db.prepare('SELECT * FROM pgdas_documentos WHERE id=? AND empresa_id=?').get(id,empresaId);if(!doc)throw new Error('Documento PGDAS não encontrado para reprocessamento.');db.transaction(()=>{db.prepare('DELETE FROM pgdas_documento_campos WHERE documento_id=?').run(id);const ins=db.prepare(`INSERT INTO pgdas_documento_campos (documento_id,campo,valor_extraido,rotulo_original,pagina_ou_localizacao,confianca,metodo_extracao,status_validacao) VALUES (?,?,?,?,?,?,?,?)`);campos.forEach((x)=>ins.run(id,x.campo,x.valor_extraido===null?null:String(x.valor_extraido),x.rotulo_original,x.pagina_ou_localizacao,x.confianca,x.metodo_extracao,x.status_validacao));db.prepare("UPDATE pgdas_documentos SET metodo_extracao=?,data_processamento=?,status_processamento='REQUER_VALIDACAO' WHERE id=?").run(metodo||doc.metodo_extracao,new Date().toISOString(),id);})();return listar(db,empresaId).find((x)=>x.id===Number(id));}
function confirmar(db,empresaId,id){const doc=db.prepare('SELECT * FROM pgdas_documentos WHERE id=? AND empresa_id=?').get(id,empresaId);if(!doc)throw new Error('Documento PGDAS não encontrado para a empresa.');const campos=db.prepare('SELECT * FROM pgdas_documento_campos WHERE documento_id=?').all(id),valores=Object.fromEntries(campos.map((x)=>[x.campo,x.valor_extraido===null?null:(x.campo==='competencia'?x.valor_extraido:Number(x.valor_extraido))]));if(!valores.competencia||!Number.isFinite(valores.das))throw new Error('Confirme somente quando competência e valor do DAS estiverem identificados no documento.');let blocos=[];try{blocos=JSON.parse(campos.find((x)=>x.campo==='revenue_blocks')?.valor_extraido||'[]');}catch{throw new Error('Blocos de receita PGDAS inválidos. Reprocesse o documento.');}const validacao=validarRegraBlocos(db,valores,blocos),calculo=calcularCompetenciaPisCofins(db,empresaId,valores,validacao);db.transaction(()=>{const existente=db.prepare('SELECT id FROM perfil_tributario WHERE empresa_id=? AND competencia=? ORDER BY id DESC LIMIT 1').get(empresaId,valores.competencia),origem=String(doc.tipo_documento||'').startsWith('INTEGRA_CONTADOR')?'pgdas_integra_contador_confirmado':'pgdas_pdf_confirmado',perfil=[valores.receita_bruta,valores.receita_recebida,valores.receita_mercadorias,valores.receita_servicos,valores.receita_exportacao,calculo?.pis??null,calculo?.cofins??null];if(existente)db.prepare(`UPDATE perfil_tributario SET receita_bruta=COALESCE(?,receita_bruta),receita_recebida=COALESCE(?,receita_recebida),receita_mercadorias=COALESCE(?,receita_mercadorias),receita_servicos=COALESCE(?,receita_servicos),receita_exportacao=COALESCE(?,receita_exportacao),pis=COALESCE(?,pis),cofins=COALESCE(?,cofins),das=?,origem=? WHERE id=?`).run(...perfil,valores.das,origem,existente.id);else db.prepare(`INSERT INTO perfil_tributario (empresa_id,competencia,receita_bruta,receita_recebida,receita_mercadorias,receita_servicos,receita_exportacao,pis,cofins,das,origem) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId,valores.competencia,...perfil,valores.das,origem);db.prepare("UPDATE pgdas_documento_campos SET status_validacao='VALIDADO_USUARIO' WHERE documento_id=? AND valor_extraido IS NOT NULL").run(id);db.prepare("UPDATE pgdas_documentos SET status_processamento=? WHERE id=?").run(validacao.validada?'VALIDADO_USUARIO':'REVIEW_REQUIRED',id);})();return {...listar(db,empresaId).find((x)=>x.id===Number(id)),validacao_regra_simples:validacao,calculo_competencia:calculo};}
module.exports={CAMPOS,normalizarTexto,extrairBlocosReceita,validarRegraBlocos,calcularCompetenciaPisCofins,ingerir,listar,reprocessarCampos,confirmar};
