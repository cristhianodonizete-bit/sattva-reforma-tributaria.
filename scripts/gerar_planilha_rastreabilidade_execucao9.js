#!/usr/bin/env node
/*
 * Gera um artefato de homologação a partir da fotografia ATIVA do motor no
 * Supabase. Não executa motor nem publica dados: apenas baixa a fotografia
 * ativa para a base local e exporta a rastreabilidade da execução ativa.
 */
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const XLSX = require('xlsx');
const db = require('../src/db');
const operacao = require('../src/services/operacaoCompartilhada');
const oficial = require('../src/services/consolidacaoOficial');
const qualidadeMotor = require('../src/services/qualidadeCobertura');

const empresaId = Number(process.argv[2] || 1);
const moeda = (v) => Math.round((Number(v) || 0) * 100) / 100;
const texto = (v) => v == null ? '' : String(v);
const json = (v) => { try { return JSON.parse(v || '{}'); } catch (_) { return {}; } };

function memoria(d, chave) {
  return d?.reconstrucao?.memoriaTributos?.[chave] || {};
}

function adicionarAba(livro, nome, linhas, larguras = []) {
  const aba = XLSX.utils.json_to_sheet(linhas);
  aba['!freeze'] = { xSplit: 0, ySplit: 1 };
  aba['!autofilter'] = { ref: XLSX.utils.encode_range(XLSX.utils.decode_range(aba['!ref'] || 'A1')) };
  aba['!cols'] = larguras.map((wch) => ({ wch }));
  const faixa = XLSX.utils.decode_range(aba['!ref'] || 'A1');
  for (let c = faixa.s.c; c <= faixa.e.c; c += 1) {
    const celula = aba[XLSX.utils.encode_cell({ r: 0, c })];
    if (celula) celula.s = { font: { bold: true, color: { rgb: 'FFFFFF' } }, fill: { fgColor: { rgb: '0B4F71' } } };
  }
  XLSX.utils.book_append_sheet(livro, aba, nome);
}

function adicionarAbaComResumo(livro, nome, resumo, linhas, larguras = []) {
  const aba = XLSX.utils.aoa_to_sheet([[`Resumo — ${nome}`], [], ['Indicador', 'Valor']]);
  XLSX.utils.sheet_add_json(aba, resumo, { origin: 'A4', skipHeader: true });
  const inicioDetalhe = resumo.length + 6;
  XLSX.utils.sheet_add_json(aba, linhas, { origin: `A${inicioDetalhe}` });
  aba['!freeze'] = { xSplit: 0, ySplit: inicioDetalhe };
  aba['!cols'] = larguras.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(livro, aba, nome);
}

async function main() {
  const remoto = await operacao.baixarResultadosMotor();
  const execucao = db.prepare('SELECT * FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId);
  if (!execucao) throw new Error(`Não há fotografia ativa do motor para a empresa ${empresaId}.`);
  const resultados = db.prepare(`SELECT r.*, m.documento, m.chave, m.item_numero, m.nome, m.inscr_federal, m.descricao,
      m.ncm, m.nbs, m.cfop, m.competencia, m.regime AS regime_movimento, m.tipo AS tipo_movimento
    FROM motor_resultados r JOIN movimentos m ON m.id=r.movimento_id
    WHERE r.empresa_id=? ORDER BY r.sentido, r.preco_atual DESC, r.id`).all(empresaId);

  const rastreabilidade = resultados.map((r) => {
    const d = json(r.detalhe); const rec = d.reconstrucao || {}; const mp = d.memoriaPisCofins || rec.memoriaPisCofins || {};
    const pis = memoria(d, 'pis'); const cofins = memoria(d, 'cofins'); const iss = memoria(d, 'iss'); const icms = memoria(d, 'icms');
    return {
      'Execução': r.execucao_id,
      'Sentido': r.sentido,
      'Operação / movimento': r.movimento_id,
      'Documento': texto(r.documento || r.chave),
      'Item': r.item_numero || '',
      'Competência': texto(r.competencia),
      'Contraparte': texto(r.nome),
      'CNPJ': texto(r.inscr_federal),
      'Descrição': texto(r.descricao),
      'NCM': texto(r.ncm), 'NBS': texto(r.nbs), 'CFOP': texto(r.cfop),
      'Regime atual': texto(r.regime_movimento || r.regime_cbs_emitente),
      'Regime CBS emitente': texto(r.regime_cbs_emitente),
      'Regime CBS adquirente': texto(r.regime_cbs_adquirente),
      'Preço atual': moeda(r.preco_atual),
      'PIS retirado': moeda(rec.componentesRetirados?.pis ?? rec.tributosAtuais?.pis),
      'COFINS retirado': moeda(rec.componentesRetirados?.cofins ?? rec.tributosAtuais?.cofins),
      'ISS retirado': moeda(rec.componentesRetirados?.iss ?? rec.tributosAtuais?.iss),
      'ICMS retirado': moeda(rec.componentesRetirados?.icms ?? rec.tributosAtuais?.icms),
      'ISS identificado (preservado em CBS-only)': moeda(rec.componentesPreservados?.iss),
      'ICMS identificado (preservado em CBS-only)': moeda(rec.componentesPreservados?.icms),
      'Base econômica CBS': moeda(rec.baseEconomicaCbs ?? r.base_economica),
      'Base econômica integral': moeda(rec.baseEconomicaIntegral),
      'Tipo de base econômica': texto(rec.tipoBaseEconomica),
      'Base econômica usada pelo motor': moeda(r.base_economica),
      'CBS': moeda(r.cbs), 'IBS': moeda(r.ibs),
      'Crédito CBS': moeda(r.credito_cbs), 'Crédito IBS': moeda(r.credito_ibs),
      'Preço projetado': moeda(r.preco_projetado),
      'Tipo crédito': texto(r.tipo_credito), 'Modalidade crédito': texto(r.modalidade_credito),
      'Status crédito': texto(r.status_credito_determinacao || r.status_credito),
      'Origem PIS/COFINS': texto(mp.carga_atual_pis_cofins_origem || pis.origem || cofins.origem),
      'Natureza PIS/COFINS': texto(mp.carga_atual_pis_cofins_natureza || pis.natureza || cofins.natureza),
      'Regra PIS/COFINS': texto(mp.base_reconstrucao_metodo || pis.regra || cofins.regra),
      'Fundamento / evidência': texto(mp.fundamento || pis.evidencia || cofins.evidencia),
      'Origem ISS': texto(iss.origem), 'Origem ICMS': texto(icms.origem),
      'Natureza final': texto(r.natureza),
      'Memória': JSON.stringify({ pis, cofins, iss, icms, reconstrucao: rec.memoriaPisCofins || {} }),
    };
  });

  const simples = resultados.filter((r) => r.regime_cbs_emitente === 'SIMPLES_DAS').map((r) => {
    const d = json(r.detalhe); const info = d.simples || {}; const efetivo = Number(info.aliquotaEfetiva) || 0;
    const reparticao = info.reparticao || {}; const percentualEfetivo = efetivo ? efetivo * ((Number(reparticao.pis) || 0) + (Number(reparticao.cofins) || 0)) : null;
    const status = texto(r.status_credito_determinacao || r.status_credito);
    const usaPremissa = status === 'DETERMINADO_POR_PREMISSA';
    const categoria = percentualEfetivo ? 'SIMPLES_COM_PERCENTUAL_EFETIVO'
      : usaPremissa ? 'SIMPLES_COM_PREMISSA_2_5'
        : status === 'INDETERMINADO' ? 'SIMPLES_SEM_DADO_E_SEM_PREMISSA'
          : status === 'SUJEITO_VALIDACAO' ? 'NAO_APLICAVEL' : 'OUTRA_REGRA';
    const premissa = usaPremissa ? 0.025 : null;
    return {
      'Fornecedor': texto(r.nome), 'CNPJ': texto(r.inscr_federal), 'Documento': texto(r.documento || r.chave),
      'Operação / movimento': r.movimento_id, 'Regime atual': texto(r.regime_movimento), 'Regime CBS': texto(r.regime_cbs_emitente),
      'Categoria': categoria,
      'Base econômica': moeda(r.base_economica),
      'Percentual efetivo CBS': percentualEfetivo,
      'Origem percentual efetivo': percentualEfetivo ? 'DADO_EFETIVO' : '',
      'Percentual premissa CBS': premissa,
      'Parâmetro utilizado': usaPremissa ? 'credito_cbs_simples_referencia' : '',
      'Percentual utilizado': percentualEfetivo || premissa || null,
      'Crédito CBS': moeda(r.credito_cbs),
      'Origem do crédito': usaPremissa ? 'PARAMETRO_CREDITO_SIMPLES' : (percentualEfetivo ? 'DADO_EFETIVO' : 'INDETERMINADO'),
      'Natureza': d.natureza || r.natureza,
      'Modalidade': texto(r.modalidade_credito), 'Status': texto(r.status_credito_determinacao || r.status_credito),
      'Tipo crédito': texto(r.tipo_credito), 'Evidência': texto(d.credito?.motivo), 'Memória': JSON.stringify(d.credito || {}),
    };
  });

  const clientes = oficial.cadeia(empresaId, 'cliente', { executarSeAusente: false });
  const fornecedores = oficial.cadeia(empresaId, 'fornecedor', { executarSeAusente: false });
  const impacto = oficial.impactoFinal(empresaId, { executarSeAusente: false });
  const total = (lista, campo) => moeda(lista.reduce((s, x) => s + (Number(x[campo]) || 0), 0));
  const saidas = resultados.filter((r) => r.sentido === 'saida'); const entradas = resultados.filter((r) => r.sentido === 'entrada');
  const tributos = (lista, campo) => moeda(lista.reduce((s, r) => s + (Number(json(r.detalhe).reconstrucao?.tributosAtuais?.[campo]) || 0), 0));
  // "SIMULADO" é natureza da projeção CBS futura, não falha de evidência.
  // A cobertura é derivada por dimensão (classificação, base, tratamento e
  // crédito) da mesma fotografia de motor_resultados.
  const qualidade = qualidadeMotor.consolidar(resultados.map((r) => ({ ...r, detalhe: json(r.detalhe) })));
  const resumo = [
    { 'Seção': 'FOTOGRAFIA', 'Indicador': 'Execução ativa', 'Valor': execucao.id, 'Origem': 'motor_resultados_operacionais / ativo' },
    { 'Seção': 'FOTOGRAFIA', 'Indicador': 'Resultados ativos', 'Valor': remoto.resultados, 'Origem': 'motor_resultados_operacionais / ativo' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'Quantidade de saídas', 'Valor': saidas.length, 'Origem': 'motor_resultados' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'Venda atual', 'Valor': total(saidas, 'preco_atual'), 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'PIS', 'Valor': tributos(saidas, 'pis'), 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'COFINS', 'Valor': tributos(saidas, 'cofins'), 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'PIS + COFINS', 'Valor': moeda(tributos(saidas, 'pis') + tributos(saidas, 'cofins')), 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'ISS', 'Valor': tributos(saidas, 'iss'), 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'ICMS', 'Valor': tributos(saidas, 'icms'), 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'Base econômica CBS', 'Valor': total(saidas, 'base_economica'), 'Origem': 'CBS-only: venda menos PIS/COFINS; ISS/ICMS preservados' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'CBS débito', 'Valor': impacto.cbs_debito_vendas, 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'IBS débito', 'Valor': total(saidas, 'ibs'), 'Origem': 'IBS desabilitado' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'Venda projetada', 'Valor': impacto.receita_projetada, 'Origem': 'somente saídas' },
    { 'Seção': 'SAÍDAS', 'Indicador': 'Impacto', 'Valor': moeda(impacto.receita_projetada - total(saidas, 'preco_atual')), 'Origem': 'venda projetada - venda atual' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'Quantidade de entradas', 'Valor': entradas.length, 'Origem': 'motor_resultados' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'Valor das entradas', 'Valor': total(entradas, 'preco_atual'), 'Origem': 'somente entradas' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'PIS', 'Valor': tributos(entradas, 'pis'), 'Origem': 'somente entradas' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'COFINS', 'Valor': tributos(entradas, 'cofins'), 'Origem': 'somente entradas' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'ISS', 'Valor': tributos(entradas, 'iss'), 'Origem': 'somente entradas' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'ICMS', 'Valor': tributos(entradas, 'icms'), 'Origem': 'somente entradas' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'Base econômica CBS', 'Valor': total(entradas, 'base_economica'), 'Origem': 'CBS-only: valor menos PIS/COFINS; ISS/ICMS preservados' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'CBS das entradas', 'Valor': total(entradas, 'cbs'), 'Origem': 'somente entradas' },
    { 'Seção': 'ENTRADAS', 'Indicador': 'Crédito CBS', 'Valor': impacto.cbs_credito_compras, 'Origem': 'somente entradas' },
    { 'Seção': 'RESULTADO CBS', 'Indicador': 'CBS débito', 'Valor': impacto.cbs_debito_vendas, 'Origem': 'saídas' },
    { 'Seção': 'RESULTADO CBS', 'Indicador': 'Crédito CBS', 'Valor': impacto.cbs_credito_compras, 'Origem': 'entradas' },
    { 'Seção': 'RESULTADO CBS', 'Indicador': 'CBS líquida', 'Valor': impacto.cbs_liquida, 'Origem': 'débito - crédito' },
    { 'Seção': 'RESULTADO CBS', 'Indicador': 'IBS líquido', 'Valor': moeda(total(saidas, 'ibs') - total(entradas, 'credito_ibs')), 'Origem': 'IBS desabilitado' },
    { 'Seção': 'QUALIDADE / COBERTURA', 'Indicador': 'Natureza de projeção SIMULADO', 'Valor': qualidade.natureza_projecao.SIMULADO?.quantidade || 0, 'Origem': 'projeção CBS futura; não mede qualidade de evidência' },
    { 'Seção': 'QUALIDADE / COBERTURA', 'Indicador': 'Operações pendentes únicas', 'Valor': qualidade.pendencias.operacoes_unicas, 'Origem': 'qualquer dimensão pendente' },
    { 'Seção': 'QUALIDADE / COBERTURA', 'Indicador': 'Cobertura técnica do resultado', 'Valor': qualidade.cobertura.tecnica_resultado.quantidade, 'Origem': 'determinado + premissa aprovada; não inclui IBS N/A' },
    { 'Seção': 'RECONCILIAÇÃO', 'Indicador': 'Clientes / motor', 'Valor': moeda(clientes.totais.cbs - impacto.cbs_debito_vendas), 'Origem': 'zero esperado' },
    { 'Seção': 'RECONCILIAÇÃO', 'Indicador': 'Fornecedores / motor', 'Valor': moeda(fornecedores.totais.creditoFinal - impacto.cbs_credito_compras), 'Origem': 'zero esperado' },
    { 'Seção': 'RECONCILIAÇÃO', 'Indicador': 'Perfil CBS', 'Valor': impacto.reconciliacao.status, 'Origem': 'Impacto Final CBS' },
  ];
  const resumoSimples = [
    { 'Indicador': 'Total de operações Simples', 'Valor': simples.length },
    { 'Indicador': 'Base econômica total', 'Valor': moeda(simples.reduce((s, x) => s + x['Base econômica'], 0)) },
    { 'Indicador': 'Operações com percentual efetivo', 'Valor': simples.filter((x) => x.Categoria === 'SIMPLES_COM_PERCENTUAL_EFETIVO').length },
    { 'Indicador': 'Operações com premissa 2,5%', 'Valor': simples.filter((x) => x.Categoria === 'SIMPLES_COM_PREMISSA_2_5').length },
    { 'Indicador': 'Base com premissa 2,5%', 'Valor': moeda(simples.filter((x) => x.Categoria === 'SIMPLES_COM_PREMISSA_2_5').reduce((s, x) => s + x['Base econômica'], 0)) },
    { 'Indicador': 'Crédito com premissa 2,5%', 'Valor': moeda(simples.filter((x) => x.Categoria === 'SIMPLES_COM_PREMISSA_2_5').reduce((s, x) => s + x['Crédito CBS'], 0)) },
    { 'Indicador': 'Operações indeterminadas / validação', 'Valor': simples.filter((x) => ['SIMPLES_SEM_DADO_E_SEM_PREMISSA', 'NAO_APLICAVEL'].includes(x.Categoria)).length },
    { 'Indicador': 'Crédito CBS total Simples', 'Valor': moeda(simples.reduce((s, x) => s + x['Crédito CBS'], 0)) },
  ];

  const livro = XLSX.utils.book_new();
  adicionarAba(livro, `Resumo Execução ${execucao.id}`, resumo, [24, 34, 20, 52]);
  const qualidadeLinhas = [];
  for (const [dimensao, matriz] of Object.entries(qualidade.matrizes)) {
    for (const [status, item] of Object.entries(matriz)) qualidadeLinhas.push({ 'Dimensão': dimensao, 'Status': status, 'Quantidade': item.quantidade, 'Valor da operação': item.valor });
  }
  qualidadeLinhas.push(...qualidade.pendencias.ocorrencias.map((x) => ({ 'Dimensão': `pendência: ${x.dimensao}`, 'Status': x.status, 'Quantidade': x.ocorrencias, 'Valor da operação': x.valor, 'Operações únicas': x.operacoes, 'Ação sugerida': x.acao })));
  const resumoQualidade = [
    { Indicador: 'Execução ativa', Valor: execucao.id },
    { Indicador: 'Total de operações', Valor: qualidade.total.quantidade },
    { Indicador: 'Valor total da operação', Valor: qualidade.total.valor },
    { Indicador: 'Projeção CBS simulada', Valor: `${qualidade.natureza_projecao.SIMULADO?.quantidade || 0} operação(ões) — natureza prospectiva, fora da métrica de evidência` },
    { Indicador: 'Cobertura técnica / quantidade', Valor: qualidade.cobertura.tecnica_resultado.quantidade },
    { Indicador: 'Cobertura técnica / valor', Valor: qualidade.cobertura.tecnica_resultado.valor },
    { Indicador: 'Pendências únicas', Valor: qualidade.pendencias.operacoes_unicas },
    { Indicador: 'Valor pendente', Valor: qualidade.pendencias.valor },
    { Indicador: 'IBS nesta visão', Valor: 'NAO_APLICAVEL (IBS desabilitado)' },
  ];
  adicionarAbaComResumo(livro, 'Qualidade e cobertura', resumoQualidade, qualidadeLinhas, [26, 28, 16, 22, 18, 40]);
  adicionarAba(livro, 'Rastreabilidade', rastreabilidade, new Array(42).fill(18));
  adicionarAbaComResumo(livro, 'Simples - Crédito CBS', resumoSimples, simples, new Array(22).fill(20));
  const destino = path.join(process.cwd(), 'auditorias');
  fs.mkdirSync(destino, { recursive: true });
  const arquivo = path.join(destino, `rastreabilidade-execucao-${execucao.id}-2026-08-26.xlsx`);
  XLSX.writeFile(livro, arquivo, { cellStyles: true });
  console.log(JSON.stringify({ arquivo, execucao: execucao.id, resultados: resultados.length, simples: simples.length, reconciliacao: impacto.reconciliacao.status }, null, 2));
}

main().catch((erro) => { console.error(erro.stack || erro.message); process.exitCode = 1; });
