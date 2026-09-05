/*
 * Mapeamento jurídico local dos 76 candidatos. Não grava banco ou motor.
 * Fontes oficiais: Planalto, Câmara e Receita Federal.
 */
const fs = require('fs');
const path = require('path');
const fontes = {
  l10925: 'https://planalto.gov.br/ccivil_03/_ato2004-2006/2004/lei/l10.925.htm',
  l10865: 'https://www.planalto.gov.br/ccivil_03/_ato2004-2006/2004/lei/l10.865compilado.htm',
  lc224: 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&cod_menu=7145&cod_modulo=420&desItem=&desItemFim=&nomeTitulo=codigos&numeroAto=00000224&orgao=NI&seqAto=000&tipo=LCP&valorAno=2025',
  lc214: 'https://www2.camara.leg.br/legin/fed/leicom/2025/leicomplementar-214-16-janeiro-2025-796905-normaatualizada-pl.html',
  rfb: 'https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/beneficios-fiscais/perguntas-e-respostas-reducao-dos-incentivos-e-beneficios-tributarios.pdf/%40%40download/file'
};
function familia(ncm) {
  if (['84701000','84716053','84719014','87142000'].includes(ncm)) return { familia_legal: 'FAMILIA_LEI_10865_ART28_ACESSIBILIDADE', lei: 'Lei 10.865/2004', artigo: '28', inciso: ({84701000:'XXIII',84716053:'XXV ou XXXI',84719014:'XXVII',87142000:'XXII'})[ncm], fonte: fontes.l10865 };
  let inciso = null;
  if (['07133319','07133399','10063021','10063029','11062000'].includes(ncm)) inciso = 'V';
  else if (ncm === '30023010' || ncm === '30023070' || ncm === '30023080' || ncm === '30023090') inciso = 'VII';
  else if (ncm === '11022000') inciso = 'IX';
  else if (ncm.startsWith('02')) inciso = 'XIX';
  else if (ncm.startsWith('03')) inciso = 'XX';
  else if (ncm.startsWith('1701')) inciso = 'XXII';
  else if (ncm.startsWith('15')) inciso = 'XXIII';
  else if (ncm === '04051000') inciso = 'XXIV';
  else if (ncm === '48181000') inciso = 'XXVIII';
  return inciso ? { familia_legal: 'FAMILIA_LEI_10925_ART1', lei: 'Lei 10.925/2004', artigo: '1º', inciso, fonte: fontes.l10925 } : { familia_legal: 'INDETERMINADA', lei: null, artigo: null, inciso: null, fonte: null };
}
function anexoI(ncm) {
  if (ncm.startsWith('0201') || ncm.startsWith('0202') || ncm.startsWith('0203') || ncm.startsWith('0204') || ncm.startsWith('0206') || ncm.startsWith('0207') || ncm.startsWith('0209') || ncm.startsWith('02101') || ncm === '02102000') return { consta: true, item: '19' };
  if (['03024300','03024990','03043100','03046100'].includes(ncm)) return { consta: true, item: '20' };
  if (['07133319','07133399'].includes(ncm)) return { consta: true, item: '7' };
  if (ncm.startsWith('100630')) return { consta: true, item: '1' };
  if (ncm === '04051000') return { consta: true, item: '5' };
  if (ncm === '11062000') return { consta: true, item: '10' };
  if (ncm === '11022000') return { consta: true, item: '11' };
  if (ncm === '17011400' || ncm === '17019900') return { consta: true, item: '14' };
  return { consta: false, item: null };
}
function requisitoAcessibilidade(ncm) {
  return ({84701000:{ fato:'produto_possui_sintetizador_voz', fundamento:'Lei 10.865/2004, art. 28, XXIII — Ex 01' },84716053:{ fato:'adaptado_para_pessoa_com_deficiencia', fundamento:'Lei 10.865/2004, art. 28, XXV ou XXXI — hipóteses materiais distintas' },84719014:{ fato:'produto_possui_sintetizador_voz', fundamento:'Lei 10.865/2004, art. 28, XXVII — Ex 01' }})[ncm] || null;
}
function mapear(r) {
  const f = familia(r.ncm); const anexo = anexoI(r.ncm); const requisito = requisitoAcessibilidade(r.ncm);
  const base = {
    id_proposto:r.id_proposto,ncm:r.ncm,descricao:r.descricao,familia_legal:f.familia_legal,fundamento_legal_original:f.lei ? `${f.lei}, art. ${f.artigo}, inciso ${f.inciso}` : null,
    lei:f.lei,artigo:f.artigo,inciso:f.inciso,alinea:null,tipo_correspondencia:f.lei === 'Lei 10.925/2004' && ['XIX','XX','XXIII'].includes(f.inciso) ? 'POSICAO' : 'CODIGO_EXATO',
    texto_legal_resumido:f.lei === 'Lei 10.925/2004' ? 'Redução a zero de PIS/Cofins para o grupo de NCM expressamente listado no art. 1º.' : 'Benefício de PIS/Cofins previsto para produto de acessibilidade listado no art. 28.',
    consta_anexo_I_lc214:anexo.consta,item_anexo_I:anexo.item,consta_anexo_XV_lc214:false,item_anexo_XV:null,requisito_material:requisito?.fato || null,condicoes_obrigatorias:requisito ? [requisito.fato] : [],
    tratamento_ate_2026_03_31:'ALÍQUOTA ZERO; CST PIS 06; CST Cofins 06; PIS 0%; Cofins 0%.',fontes_oficiais:[f.fonte, fontes.lc224, fontes.lc214, fontes.rfb].filter(Boolean)
  };
  if (requisito) return {...base,impacto_lc224:'INDETERMINADO',fundamento_lc224:`${requisito.fundamento}; NCM isolado não prova o requisito material.`,tratamento_desde_2026_04_01:'CONDICIONAL — depende do fato estruturado.',cst_pis:null,cst_cofins:null,pis_cumulativo:null,cofins_cumulativo:null,pis_nao_cumulativo:null,cofins_nao_cumulativo:null,exige_inf_ad_fisco_lc224:null,status_validacao:'RECLASSIFICADA_COMO_CONDICIONAL'};
  if (f.familia_legal === 'FAMILIA_LEI_10925_ART1' && anexo.consta) return {...base,impacto_lc224:'EXCECAO_EXPRESSA',fundamento_lc224:`LC 224/2025, art. 4º, §8º, III; LC 214/2025, Anexo I, item ${anexo.item}.`,tratamento_desde_2026_04_01:'ALÍQUOTA ZERO MANTIDA — exceção expressa.',cst_pis:'06',cst_cofins:'06',pis_cumulativo:0,cofins_cumulativo:0,pis_nao_cumulativo:0,cofins_nao_cumulativo:0,exige_inf_ad_fisco_lc224:false,status_validacao:'VALIDADA_ZERO_MANTIDO'};
  if (f.familia_legal === 'FAMILIA_LEI_10925_ART1') return {...base,impacto_lc224:'ALCANCADO',fundamento_lc224:'LC 224/2025, art. 4º, §2º, II, e, e §4º, I; não consta na exceção do §8º, III, pelos cruzamentos objetivos deste lote.',tratamento_desde_2026_04_01:'ALÍQUOTA EFETIVA DE 10% DA PADRÃO.',cst_pis:'06',cst_cofins:'06',pis_cumulativo:0.065,cofins_cumulativo:0.30,pis_nao_cumulativo:0.165,cofins_nao_cumulativo:0.76,exige_inf_ad_fisco_lc224:true,status_validacao:'VALIDADA_COM_REDUCAO_LC224'};
  return {...base,impacto_lc224:'INDETERMINADO',fundamento_lc224:'Fundamento original identificado, mas o alcance no DGT/LC 224 não foi comprovado nesta reconciliação.',tratamento_desde_2026_04_01:'PRECISA DE REVISÃO JURÍDICA DO ALCANCE DA LC 224.',cst_pis:null,cst_cofins:null,pis_cumulativo:null,cofins_cumulativo:null,pis_nao_cumulativo:null,cofins_nao_cumulativo:null,exige_inf_ad_fisco_lc224:null,status_validacao:'PRECISA_REVISAO_JURIDICA'};
}
function executar(entrada,saida){const lote=JSON.parse(fs.readFileSync(entrada));if(lote.length!==76)throw Error('Lote deve conter 76');const registros=lote.map(mapear);const resumo={registros_originais:76,fundamento_legal_identificado:registros.filter(r=>r.lei).length,fundamento_legal_nao_identificado:registros.filter(r=>!r.lei).length,lei_10925_art1:registros.filter(r=>r.familia_legal==='FAMILIA_LEI_10925_ART1').length,lei_10865_art28:registros.filter(r=>r.familia_legal==='FAMILIA_LEI_10865_ART28_ACESSIBILIDADE').length,outras_fontes:0,zero_mantido_2026:registros.filter(r=>r.status_validacao==='VALIDADA_ZERO_MANTIDO').length,alcancados_lc224:registros.filter(r=>r.impacto_lc224==='ALCANCADO').length,reclassificados_condicionais:registros.filter(r=>r.status_validacao==='RECLASSIFICADA_COMO_CONDICIONAL').length,outro_tratamento:0,precisa_revisao_juridica:registros.filter(r=>r.status_validacao==='PRECISA_REVISAO_JURIDICA').length,anexo_I_lc214:registros.filter(r=>r.consta_anexo_I_lc214).length,anexo_XV_lc214:0,com_vigencia_dividida:registros.filter(r=>r.status_validacao==='VALIDADA_COM_REDUCAO_LC224').length,cst06_percentual_nao_zero:registros.filter(r=>r.status_validacao==='VALIDADA_COM_REDUCAO_LC224').length,registros_prontos_modelagem:registros.filter(r=>r.status_validacao.startsWith('VALIDADA_')).length,registros_nao_prontos:registros.filter(r=>!r.status_validacao.startsWith('VALIDADA_')).length,fontes_nao_oficiais_utilizadas:0,alteracoes_banco:'NENHUMA',alteracoes_supabase:'NENHUMA',alteracoes_motor:'NENHUMA'};fs.mkdirSync(saida,{recursive:true});fs.writeFileSync(path.join(saida,'mapeamento_legal_76_diretas.json'),JSON.stringify({resumo,registros},null,2));fs.writeFileSync(path.join(saida,'mapeamento_legal_76_diretas_resumo.json'),JSON.stringify({resumo,familias:Object.groupBy(registros,r=>r.fundamento_legal_original||'INDETERMINADA')},null,2));fs.writeFileSync(path.join(saida,'reclassificadas_condicionais_76.json'),JSON.stringify(registros.filter(r=>r.status_validacao==='RECLASSIFICADA_COMO_CONDICIONAL'),null,2));return resumo;}
if(require.main===module){const raiz=path.resolve(__dirname,'..');console.log(JSON.stringify(executar(process.argv[2]||path.join(raiz,'outputs/lote_validacao_juridica_direta.json'),process.argv[3]||path.join(raiz,'outputs')),null,2));}module.exports={mapear,executar};
