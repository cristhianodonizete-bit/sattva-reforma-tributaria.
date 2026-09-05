/* Prévia local: não conecta banco, não importa regras e não altera o motor. */
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

const texto = (v) => String(v ?? '').trim();
const chave = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
const campo = (l, n) => l[n] ?? '';
function numero(valor) {
  let s = texto(valor).replace(/%/g, '').replace(/\s/g, '');
  if (!s || !/^-?[\d.,]+$/.test(s)) return null;
  if (s.includes('.') && s.includes(',')) {
    const decimal = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    s = s.replaceAll(decimal === '.' ? ',' : '.', '').replace(decimal, '.');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
const normalizaNcm = (v) => { const n = texto(v).replace(/\D/g, ''); return n ? n.padStart(8, '0').slice(0, 8) : ''; };
const normalizaNbs = (v) => texto(v).replace(/\D/g, '');
const unico = (itens) => [...new Set(itens.filter(Boolean))];
const hash = (partes) => { let n = 2166136261; for (const c of partes.join('|')) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(36).toUpperCase(); };
const percentualSuspeito = (n) => n !== null && (n < 0 || n > 100);
const papelExigeFato = (v) => ['sim', 'indeterminado'].includes(chave(v));
const condicaoGenerica = (v) => /nao identificada|não identificada|sem prejuizo|sem prejuízo|aplicar o regime geral/i.test(v);
function marcadorCondicional({ operacao, cstPis, cstCofins, status, tratamento, condicao, precedencia }) {
  return /poss[ií]vel|se requisitos|hip[oó]tese legal espec[ií]fica|valida[cç][aã]o necess[aá]ria|condicionad[oa]|condicional|requisit[oa]s? atendid[oa]s?|depende de/i.test([operacao, cstPis, cstCofins, status, tratamento, condicao, precedencia].join(' | '));
}
function chaveCanonica(item) {
  return [item.tipo_chave, item.ncm || '', item.nbs || '', item.lc116 || '', item.tratamento_resultante_proposto || '', item.operacao_pis_cofins_fonte || '', item.cst_pis || '', item.cst_cofins || '', item.pis_percentual ?? '', item.cofins_percentual ?? '', item.regime_pis_cofins_receita || '', item.papel_cadeia_necessario || '', item.condicao_textual_fonte || '', item.status_fonte || ''].map(chave).join('::');
}
function chaveBaseConflito(item) {
  return [item.tipo_chave, item.ncm || '', item.nbs || '', item.lc116 || '', item.operacao_pis_cofins_fonte || '', item.regime_pis_cofins_receita || '', item.papel_cadeia_necessario || '', item.condicao_textual_fonte || ''].map(chave).join('::');
}
function classificar(item) {
  if (!item.ncm && !item.nbs || item.bloqueios_para_ativacao.includes('PERCENTUAL_PIS_COFINS_SUSPEITO')) return 'INCONSISTENTE';
  if (papelExigeFato(item.papel_cadeia_necessario)) return 'PAPEL_CADEIA';
  if (item.marcador_condicional) return 'REGRA_CONDICIONAL';
  if (chave(item.operacao_pis_cofins_fonte) === 'tributado - regra geral da receita' && chave(item.tratamento_resultante_proposto) === 'normal' && !item.condicao_textual_fonte) return 'REGRA_GERAL_RESIDUAL';
  return 'REGRA_ESPECIFICA_DIRETA';
}
function candidatoBase({ tipo, linha, linhaPlanilha }) {
  const ncm = tipo === 'NCM' ? normalizaNcm(campo(linha, 'NCM')) : null;
  const nbs = tipo === 'NCM' ? null : normalizaNbs(campo(linha, 'NBS'));
  const lc116 = tipo === 'NCM' ? null : texto(campo(linha, 'LC 116')) || null;
  const tratamento = texto(campo(linha, 'Tratamento específico PIS/COFINS vigente'));
  const operacao = texto(campo(linha, 'Operação atual PIS/COFINS'));
  const status = texto(campo(linha, 'Status da regra atual'));
  const condicao = texto(campo(linha, 'Condição/observação'));
  const precedencia = texto(campo(linha, 'Regra/precedência vigente'));
  const cstPis = texto(campo(linha, 'CST PIS atual'));
  const cstCofins = texto(campo(linha, 'CST COFINS atual'));
  const pis = numero(campo(linha, 'PIS % atual'));
  const cofins = numero(campo(linha, 'COFINS % atual'));
  const papel = texto(campo(linha, 'Papel na cadeia necessário'));
  const bloqueios = [];
  const condicional = marcadorCondicional({ operacao, cstPis, cstCofins, status, tratamento, condicao, precedencia });
  if (!(ncm || nbs)) bloqueios.push(tipo === 'NCM' ? 'NCM_AUSENTE_OU_INVALIDO' : 'NBS_AUSENTE_OU_INVALIDO');
  if (!tratamento) bloqueios.push('TRATAMENTO_PIS_COFINS_AUSENTE');
  if (percentualSuspeito(pis) || percentualSuspeito(cofins)) bloqueios.push('PERCENTUAL_PIS_COFINS_SUSPEITO');
  if (papelExigeFato(papel)) bloqueios.push('PAPEL_NA_CADEIA_EXIGE_FATO_ESTRUTURADO');
  if (condicao && !condicaoGenerica(condicao)) bloqueios.push('CONDICAO_TEXTO_EXIGE_ESTRUTURACAO');
  if (condicional && (!condicao || condicaoGenerica(condicao))) bloqueios.push('REGRA_CONDICIONAL_NAO_ESTRUTURADA');
  const item = {
    status_proposto: 'RASCUNHO', fonte: 'BASE_REGRAS_PIS_COFINS_ATUAL_E_REFORMA_PIS_COFINS_PREENCHIDO.xlsx',
    aba_origem: tipo === 'NCM' ? 'Produtos NCM' : 'Serviços LC116 NBS', linha_planilha: linhaPlanilha, id_origem: campo(linha, 'ID'),
    tipo_chave: tipo, ncm, nbs, lc116,
    descricao: tipo === 'NCM' ? texto(campo(linha, 'Descrição')) : texto(campo(linha, 'Descrição do serviço')) || texto(campo(linha, 'Descrição NBS')),
    tratamento_resultante_proposto: tratamento || null, operacao_pis_cofins_fonte: operacao || null, cst_pis: cstPis || null, cst_cofins: cstCofins || null,
    pis_percentual: pis, cofins_percentual: cofins, regime_pis_cofins_receita: texto(campo(linha, 'Regime PIS/COFINS da receita')) || null,
    papel_cadeia_fonte: texto(campo(linha, 'Papel na cadeia')) || null, papel_cadeia_necessario: papel || null,
    condicao_textual_fonte: condicao || null, regra_precedencia_fonte: precedencia || null, status_fonte: status || null, marcador_condicional: condicional,
    campos_regras_enquadramento_pendentes_estruturacao: ['familia', 'tipo_operacao', 'direcao', 'prioridade', 'vigencia_inicio', 'fundamento_legal', 'versao'],
    bloqueios_para_ativacao: unico(bloqueios), elegivel_para_revisao: Boolean((ncm || nbs) && tratamento),
    observacao: 'Prévia local. Nenhuma linha foi enviada ao banco ou ativada no motor.'
  };
  item.chave_fiscal_canonica = chaveCanonica(item);
  item.id_proposto = `RASCUNHO_${tipo}_${hash([item.chave_fiscal_canonica])}`;
  item.classificacao_preliminar = classificar(item);
  item.elegivel_para_rascunho_operacional = item.elegivel_para_revisao && !item.bloqueios_para_ativacao.length && item.classificacao_preliminar === 'REGRA_ESPECIFICA_DIRETA';
  return item;
}
function consolidar(candidatos) {
  const grupos = new Map();
  candidatos.forEach((item) => { const grupo = grupos.get(item.chave_fiscal_canonica) || []; grupo.push(item); grupos.set(item.chave_fiscal_canonica, grupo); });
  const registrosConsolidados = [...grupos.entries()].map(([chaveFiscal, itens]) => {
    const p = itens[0];
    return {
      chave_fiscal_canonica: chaveFiscal, id_proposto: `RASCUNHO_${p.tipo_chave}_${hash([chaveFiscal])}`, status_proposto: 'RASCUNHO',
      tipo_chave: p.tipo_chave, ncm: p.ncm, nbs: p.nbs, lc116: p.lc116, descricao: unico(itens.map((i) => i.descricao)),
      tratamento_resultante_proposto: p.tratamento_resultante_proposto, operacao_pis_cofins_fonte: p.operacao_pis_cofins_fonte, cst_pis: p.cst_pis, cst_cofins: p.cst_cofins,
      pis_percentual: p.pis_percentual, cofins_percentual: p.cofins_percentual, regime_pis_cofins_receita: p.regime_pis_cofins_receita,
      papel_cadeia_fonte: p.papel_cadeia_fonte, papel_cadeia_necessario: p.papel_cadeia_necessario, condicao_textual_fonte: p.condicao_textual_fonte, status_fonte: p.status_fonte,
      marcador_condicional: itens.some((i) => i.marcador_condicional), classificacao: p.classificacao_preliminar,
      bloqueios_para_ativacao: unico(itens.flatMap((i) => i.bloqueios_para_ativacao)), elegivel_para_revisao: itens.some((i) => i.elegivel_para_revisao),
      elegivel_para_rascunho_operacional: itens.some((i) => i.elegivel_para_rascunho_operacional), campos_pendentes_estruturacao: p.campos_regras_enquadramento_pendentes_estruturacao,
      origens: itens.map((i) => ({ aba: i.aba_origem, linha: i.linha_planilha, id_origem: i.id_origem }))
    };
  });
  const porContexto = new Map();
  candidatos.forEach((item) => { const base = chaveBaseConflito(item); const grupo = porContexto.get(base) || []; grupo.push(item); porContexto.set(base, grupo); });
  const conflitos = [];
  for (const [chaveBase, itens] of porContexto) {
    const resultados = unico(itens.map((i) => [i.tratamento_resultante_proposto, i.cst_pis, i.cst_cofins, i.pis_percentual, i.cofins_percentual].map(chave).join('|')));
    if (resultados.length > 1) conflitos.push({ chave_base_conflito: chaveBase, tipo_chave: itens[0].tipo_chave, ncm: itens[0].ncm, nbs: itens[0].nbs, lc116: itens[0].lc116, resultados_incompativeis: resultados, origens: itens.map((i) => ({ aba: i.aba_origem, linha: i.linha_planilha, id_origem: i.id_origem, tratamento: i.tratamento_resultante_proposto, cst_pis: i.cst_pis, cst_cofins: i.cst_cofins, pis_percentual: i.pis_percentual, cofins_percentual: i.cofins_percentual })) });
  }
  return { registrosConsolidados, conflitos };
}
function porClassificacao(itens, campo) { return Object.fromEntries(['REGRA_GERAL_RESIDUAL', 'REGRA_ESPECIFICA_DIRETA', 'REGRA_CONDICIONAL', 'PAPEL_CADEIA', 'INCONSISTENTE'].map((tipo) => [tipo, itens.filter((i) => i[campo] === tipo).length])); }
function executar({ arquivo, destinoPrevia, destinoConsolidacao }) {
  const w = XLSX.readFile(arquivo, { cellDates: false });
  const candidatos = [];
  for (const { aba, tipo } of [{ aba: 'Produtos NCM', tipo: 'NCM' }, { aba: 'Serviços LC116 NBS', tipo: 'NBS_LC116' }]) {
    if (!w.Sheets[aba]) throw new Error(`Aba obrigatória ausente: ${aba}`);
    XLSX.utils.sheet_to_json(w.Sheets[aba], { defval: '', raw: false }).forEach((linha, indice) => candidatos.push(candidatoBase({ tipo, linha, linhaPlanilha: indice + 2 })));
  }
  const { registrosConsolidados, conflitos } = consolidar(candidatos);
  const resumo = {
    arquivo_origem: arquivo, gerado_em: new Date().toISOString(), modo: 'SOMENTE_LEITURA', alteracoes_banco: 'NENHUMA', alteracoes_supabase: 'NENHUMA', alteracoes_motor: 'NENHUMA',
    linhas_originais: candidatos.length, candidatos_apos_correcao: candidatos.length, chaves_fiscais_consolidadas: registrosConsolidados.length, duplicidades_exatas_consolidadas: candidatos.length - registrosConsolidados.length,
    percentuais_suspeitos: candidatos.filter((i) => i.bloqueios_para_ativacao.includes('PERCENTUAL_PIS_COFINS_SUSPEITO')).length,
    condicionados_sem_condicao_bloqueados: candidatos.filter((i) => i.bloqueios_para_ativacao.includes('REGRA_CONDICIONAL_NAO_ESTRUTURADA')).length,
    por_classificacao_linhas: porClassificacao(candidatos, 'classificacao_preliminar'), por_classificacao_consolidada: porClassificacao(registrosConsolidados, 'classificacao'),
    conflitos_fiscais: conflitos.length, bloqueios: Object.fromEntries(unico(candidatos.flatMap((i) => i.bloqueios_para_ativacao)).sort().map((motivo) => [motivo, candidatos.filter((i) => i.bloqueios_para_ativacao.includes(motivo)).length]))
  };
  fs.mkdirSync(path.dirname(destinoPrevia), { recursive: true }); fs.mkdirSync(path.dirname(destinoConsolidacao), { recursive: true });
  fs.writeFileSync(destinoPrevia, JSON.stringify({ resumo, candidatos }, null, 2));
  fs.writeFileSync(destinoConsolidacao, JSON.stringify({ resumo, registros_consolidados: registrosConsolidados, conflitos, bloqueados: registrosConsolidados.filter((i) => i.bloqueios_para_ativacao.length), estatisticas: { por_classificacao: resumo.por_classificacao_consolidada, por_bloqueio: resumo.bloqueios } }, null, 2));
  return { resumo, destinoPrevia, destinoConsolidacao };
}
if (require.main === module) {
  const arquivo = process.argv[2] || 'C:/Users/cristhiano/Downloads/BASE_REGRAS_PIS_COFINS_ATUAL_E_REFORMA_PIS_COFINS_PREENCHIDO.xlsx';
  console.log(JSON.stringify(executar({ arquivo, destinoPrevia: process.argv[3] || path.resolve(__dirname, '../outputs/previa_rascunhos_pis_cofins_corrigida.json'), destinoConsolidacao: process.argv[4] || path.resolve(__dirname, '../outputs/consolidacao_regras_pis_cofins.json') }), null, 2));
}
module.exports = { numero, candidatoBase, consolidar, executar, percentualSuspeito };
