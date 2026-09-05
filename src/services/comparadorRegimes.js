/* Comparador: fatos, parâmetros versionados e fotografia CBS existente. */
const n = (v) => Number(v) || 0;
const REGIMES = [
  { chave: 'lucro_real', rotulo: 'Lucro Real' },
  { chave: 'lucro_presumido', rotulo: 'Lucro Presumido' },
  { chave: 'simples_nacional', rotulo: 'Simples Nacional' },
  { chave: 'simples_regime_regular', rotulo: 'Simples Nacional Híbrido' },
];
const NATUREZAS_LP = new Set(['COMERCIO_INDUSTRIA', 'SERVICOS_GERAIS', 'INTERMEDIACAO', 'LOCACAO_CESSAO_BENS_DIREITOS', 'TRANSPORTE_CARGA', 'SERVICO_HOSPITALAR_QUALIFICADO']);

function linhasSeTabelaExiste(db, sql, empresaId) { try { return db.prepare(sql).all(empresaId); } catch (_) { return []; } }
function margemAplicavel(perfis, margens, receita) {
  if (!perfis.length || !margens.length || !receita) return null;
  let ponderada = 0;
  for (const p of perfis) {
    const margem = margens.find((x) => x.periodo_inicio <= p.competencia && x.periodo_fim >= p.competencia);
    if (!margem) return null;
    ponderada += n(p.receita_bruta) * (n(margem.margem_operacional_percentual) / 100);
  }
  return ponderada / receita;
}
function naturezaReceitaComplementar(tipo) {
  const chave = String(tipo || '').trim().toUpperCase().replace(/[\s\-\/]+/g, '_');
  return {
    COMERCIO_INDUSTRIA: 'COMERCIO_INDUSTRIA', SERVICOS_GERAIS: 'SERVICOS_GERAIS', INTERMEDIACAO: 'INTERMEDIACAO',
    TRANSPORTE_CARGA: 'TRANSPORTE_CARGA', SERVICO_HOSPITALAR_QUALIFICADO: 'SERVICO_HOSPITALAR_QUALIFICADO',
    LOCACAO: 'LOCACAO_CESSAO_BENS_DIREITOS', LOCACAO_BENS: 'LOCACAO_CESSAO_BENS_DIREITOS', LOCACAO_MAQUINAS: 'LOCACAO_CESSAO_BENS_DIREITOS',
    CESSAO: 'LOCACAO_CESSAO_BENS_DIREITOS', CESSAO_BENS_DIREITOS: 'LOCACAO_CESSAO_BENS_DIREITOS',
  }[chave] || null;
}
function receitaSegregada(perfis, receitasSemDfe) {
  const valores = Object.fromEntries([...NATUREZAS_LP].map((x) => [x, 0])); let indeterminada = 0;
  for (const p of perfis) {
    const total = n(p.receita_bruta), comercio = n(p.receita_mercadorias), servicos = n(p.receita_servicos);
    valores.COMERCIO_INDUSTRIA += comercio; valores.SERVICOS_GERAIS += servicos;
    // Exportação e parcela sem natureza explícita não recebem presunção por aproximação.
    if (total - comercio - servicos > 0.005) indeterminada += total - comercio - servicos;
  }
  for (const receita of receitasSemDfe) {
    const natureza = naturezaReceitaComplementar(receita.tipo_receita);
    if (natureza) valores[natureza] += n(receita.valor); else indeterminada += n(receita.valor);
  }
  return { valores, indeterminada };
}
function parametroUnico(parametros, tributo, regime, natureza) {
  const encontrados = parametros.filter((x) => x.tributo === tributo && x.regime === regime && x.natureza_receita === natureza);
  return encontrados.length === 1 ? encontrados[0] : null;
}
function calcularComRegra(regra, base, meses) {
  if (base === null || regra?.aliquota === null || regra?.aliquota === undefined) return null;
  const principal = base * n(regra.aliquota);
  if (regra.adicional === null || regra.adicional === undefined) return principal;
  if (regra.limite_adicional === null || regra.limite_adicional === undefined) return null;
  return principal + Math.max(0, base - (n(regra.limite_adicional) * meses)) * n(regra.adicional);
}
function calcularIrpjCsll(parametros, regime, contexto) {
  const { receita, margem, receitasPorNatureza, receitaIndeterminada, meses } = contexto;
  if (receita === null || !meses) return { valor: null, motivo: 'Receita por competência não disponível.' };
  if (regime === 'lucro_real') {
    const irpj = parametroUnico(parametros, 'IRPJ', regime, 'GERAL'); const csll = parametroUnico(parametros, 'CSLL', regime, 'GERAL');
    if (!irpj || !csll || margem === null) return { valor: null, motivo: 'Parâmetros ativos de IRPJ/CSLL ou margem operacional não disponíveis.' };
    const base = receita * margem, valorIrpj = calcularComRegra(irpj, base, meses), valorCsll = calcularComRegra(csll, base, meses);
    if (valorIrpj === null || valorCsll === null) return { valor: null, motivo: 'Parâmetro de alíquota/adicional incompleto.' };
    return { valor: valorIrpj + valorCsll, natureza: 'SIMULADO', regras: [irpj, csll], base, meses };
  }
  if (regime !== 'lucro_presumido') return { valor: null, motivo: 'Regime não suportado.' };
  if (receitaIndeterminada > 0.005) return { valor: null, motivo: 'Natureza de parte da receita não está determinada para presunção.' };
  let valor = 0; const regras = []; const detalhes = [];
  for (const [natureza, receitaNatureza] of Object.entries(receitasPorNatureza || {})) {
    if (receitaNatureza <= 0.005) continue;
    const irpj = parametroUnico(parametros, 'IRPJ', regime, natureza), csll = parametroUnico(parametros, 'CSLL', regime, natureza);
    if (!irpj || !csll) return { valor: null, motivo: `Parâmetro ativo ausente para ${natureza}.` };
    const limiteAnual = n(irpj.limite_receita_anual), acrescimo = n(irpj.acrescimo_percentual_base_excedente);
    if (!limiteAnual || irpj.acrescimo_percentual_base_excedente === null || irpj.acrescimo_percentual_base_excedente === undefined || n(csll.limite_receita_anual) !== limiteAnual || n(csll.acrescimo_percentual_base_excedente) !== acrescimo) return { valor: null, motivo: `Regra 2026 incompleta ou divergente para ${natureza}.` };
    // R$ 5 mi é proporcional ao período (R$ 1,25 mi em três meses); o excedente é rateado pela receita de cada atividade.
    const excedenteProporcional = Math.max(0, receita - (limiteAnual * meses / 12)) * (receitaNatureza / receita);
    const base = (regra) => receitaNatureza * n(regra.percentual_base) + excedenteProporcional * n(regra.percentual_base) * acrescimo;
    const valorIrpj = calcularComRegra(irpj, base(irpj), meses), valorCsll = calcularComRegra(csll, base(csll), meses);
    if (valorIrpj === null || valorCsll === null) return { valor: null, motivo: `Alíquota/adicional incompleto para ${natureza}.` };
    valor += valorIrpj + valorCsll; regras.push(irpj, csll); detalhes.push({ natureza, receita: receitaNatureza, excedente_proporcional: excedenteProporcional });
  }
  return regras.length ? { valor, natureza: 'CALCULADO', regras, detalhes, meses } : { valor: null, motivo: 'Receita sem natureza enquadrável.' };
}
function dasRemanescenteDoHibrido(empresa, perfis) {
  if (empresa.regime !== 'simples_nacional') return { valor: null, motivo: 'PGDAS real não é aplicável ao regime cadastral da empresa.' };
  if (!perfis.length) return { valor: null, motivo: 'Não há competências de PGDAS para separar PIS/Cofins do DAS.' };
  let valor = 0;
  for (const perfil of perfis) {
    const das = Number(perfil.das), pis = Number(perfil.pis), cofins = Number(perfil.cofins);
    // Zero por default de persistência não prova a decomposição do DAS.
    if (!Number.isFinite(das) || das <= 0 || !Number.isFinite(pis) || !Number.isFinite(cofins) || pis + cofins <= 0) {
      return { valor: null, motivo: `Decomposição PIS/Cofins do PGDAS não está comprovada em ${perfil.competencia}.` };
    }
    if (das + 0.005 < pis + cofins) return { valor: null, motivo: `DAS menor que PIS/Cofins informado em ${perfil.competencia}.` };
    valor += das - pis - cofins;
  }
  return { valor, natureza: 'REAL', origem: 'PGDAS real menos componentes PIS/Cofins documentados' };
}
function comparar(db, empresaId, opcoes = {}) {
  const empresa = db.prepare('SELECT id, razao_social, regime FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const perfis = db.prepare("SELECT * FROM perfil_tributario WHERE empresa_id=? AND COALESCE(competencia,'')<>''").all(empresaId);
  const receitasSemDfe = linhasSeTabelaExiste(db, 'SELECT * FROM receitas_sem_dfe WHERE empresa_id=?', empresaId);
  const receitaDocumento = db.prepare("SELECT SUM(COALESCE(valor,0)) valor FROM movimentos WHERE empresa_id=? AND (tipo='cliente' OR sentido='saida')").get(empresaId).valor;
  const receitaPerfil = perfis.length ? perfis.reduce((s, x) => s + n(x.receita_bruta), 0) : null;
  const receitaComplementar = receitasSemDfe.reduce((s, x) => s + n(x.valor), 0), receitaBase = receitaPerfil !== null ? receitaPerfil : (receitaDocumento === null || receitaDocumento === undefined ? null : n(receitaDocumento));
  const receita = receitaBase === null ? null : receitaBase + receitaComplementar, segregacao = receitaSegregada(perfis, receitasSemDfe);
  const cbs = db.prepare('SELECT SUM(COALESCE(cbs_liquida,0)) valor, COUNT(*) quantidade FROM perfil_cbs_competencias WHERE empresa_id=?').get(empresaId);
  const parametros = new Map(db.prepare('SELECT chave,pis_cofins FROM param_regimes').all().map((x) => [x.chave, x]));
  const dasReal = perfis.reduce((s, x) => s + n(x.das), 0), temDasReal = perfis.length > 0 && empresa.regime === 'simples_nacional';
  const margens = db.prepare('SELECT * FROM margens_operacionais_premissas WHERE empresa_id=?').all(empresaId), margemInformada = margens.length > 0, margem = margemAplicavel(perfis, margens, receita);
  const competencias = [...new Set(perfis.map((x) => x.competencia))], meses = competencias.length, competenciaReferencia = competencias.sort().at(-1) || null;
  const competenciaVigencia = /^\d{4}-\d{2}$/.test(String(competenciaReferencia || '')) ? `${competenciaReferencia}-28` : competenciaReferencia;
  const parametrosIrpjCsll = competenciaVigencia ? db.prepare("SELECT * FROM param_irpj_csll_versionados WHERE status='ATIVO' AND vigencia_inicio<=? AND (vigencia_fim IS NULL OR vigencia_fim>=?)").all(competenciaVigencia, competenciaVigencia) : [];
  let hibridoMotor = null; let erroHibrido = null;
  try { hibridoMotor = (opcoes.executarMotor || require('./motorExec').executar)(empresaId, { ano: opcoes.ano || 2027, gravar: false, regimeEmpresa: 'simples_regime_regular' }); } catch (e) { erroHibrido = e.message; }
  const cenarios = REGIMES.map((regime) => {
    const p = parametros.get(regime.chave), componentes = {}, pendencias = [];
    if (receita === null) pendencias.push('Receita fiscal por período não disponível.');
    if (regime.chave !== 'simples_regime_regular' && p?.pis_cofins !== null && p?.pis_cofins !== undefined && receita !== null) componentes.pis_cofins = { valor: require('./percentual').aplicarPercentual(receita, p.pis_cofins), natureza: 'CALCULADO', regra: `param_regimes.${regime.chave}` };
    else if (!['simples_nacional', 'simples_regime_regular'].includes(regime.chave)) pendencias.push('Regra parametrizada de PIS/Cofins não disponível para este regime.');
    const irpjCsll = ['lucro_real', 'lucro_presumido'].includes(regime.chave) ? calcularIrpjCsll(parametrosIrpjCsll, regime.chave, { receita, margem, receitasPorNatureza: segregacao.valores, receitaIndeterminada: segregacao.indeterminada, meses }) : null;
    if (irpjCsll?.valor !== null && irpjCsll?.valor !== undefined) componentes.irpj_csll = { valor: irpjCsll.valor, natureza: irpjCsll.natureza, regras: irpjCsll.regras.map((x) => ({ tributo: x.tributo, natureza_receita: x.natureza_receita, versao: x.versao, fonte: x.fonte, fundamento: x.fundamento })), detalhes: irpjCsll.detalhes || null };
    if (cbs.quantidade > 0) componentes.cbs_motor_existente = { valor: n(cbs.valor), natureza: 'CALCULADO', origem: 'perfil_cbs_competencias' }; else pendencias.push('Fotografia CBS do motor não materializada.');
    let tributosEstimados = null, natureza = 'INDETERMINADO', status = 'INCOMPLETO';
    if (regime.chave === 'simples_nacional' && temDasReal && receita !== null) { tributosEstimados = dasReal; natureza = 'REAL'; status = 'COMPLETO'; }
    else if (['lucro_real', 'lucro_presumido'].includes(regime.chave) && receita !== null && componentes.pis_cofins && componentes.irpj_csll && componentes.cbs_motor_existente) { tributosEstimados = componentes.pis_cofins.valor + componentes.irpj_csll.valor + componentes.cbs_motor_existente.valor; natureza = regime.chave === 'lucro_real' ? 'SIMULADO' : 'CALCULADO'; status = 'COMPLETO'; }
    else { pendencias.push(regime.chave === 'simples_nacional' ? 'PGDAS real ou dados completos para apuração do DAS não disponíveis.' : irpjCsll?.motivo || 'IRPJ/CSLL e demais componentes necessários à carga total não estão determinados pelas evidências disponíveis.'); natureza = receita !== null && Object.keys(componentes).length ? 'PARCIAL' : 'INCOMPLETO'; status = natureza; }
    if (regime.chave === 'simples_regime_regular') {
      const dasRemanescente = dasRemanescenteDoHibrido(empresa, perfis);
      if (dasRemanescente.valor !== null) componentes.das_remanescente_pgdas = { valor: dasRemanescente.valor, natureza: dasRemanescente.natureza, origem: dasRemanescente.origem };
      else pendencias.push(dasRemanescente.motivo);
      if (hibridoMotor?.apuracao?.cbs) componentes.cbs_hibrida_motor = { valor: n(hibridoMotor.apuracao.cbs.saldo), natureza: 'SIMULADO', origem: 'motorExec.executar(regimeEmpresa=simples_regime_regular)' }; else pendencias.push(`Motor CBS híbrido não disponível em sombra${erroHibrido ? `: ${erroHibrido}` : '.'}`);
      if (hibridoMotor?.apuracao?.ibs) componentes.ibs_hibrida_motor = { valor: n(hibridoMotor.apuracao.ibs.saldo), natureza: 'SIMULADO', origem: 'motorExec.executar(regimeEmpresa=simples_regime_regular)' }; else pendencias.push(`Motor IBS híbrido não disponível em sombra${erroHibrido ? `: ${erroHibrido}` : '.'}`);
      if (receita !== null && componentes.das_remanescente_pgdas && componentes.cbs_hibrida_motor && componentes.ibs_hibrida_motor) {
        tributosEstimados = componentes.das_remanescente_pgdas.valor + componentes.cbs_hibrida_motor.valor + componentes.ibs_hibrida_motor.valor;
        natureza = 'SIMULADO'; status = 'COMPLETO';
      } else { natureza = receita !== null && Object.keys(componentes).length ? 'PARCIAL' : 'INCOMPLETO'; status = natureza; }
    }
    return { ...regime, tributos_estimados: tributosEstimados, carga_efetiva_percentual: tributosEstimados !== null && receita > 0 ? tributosEstimados / receita : null, diferenca_para_menor: null, status, completude: status, natureza, componentes_disponiveis: componentes,
      premissas_utilizadas: [receitaPerfil !== null ? 'Receita do Perfil Tributário.' : 'Receita fiscal de documentos.', receitaComplementar > 0 ? 'Receitas sem DF-e validadas foram adicionadas à mesma base econômica.' : null, cbs.quantidade > 0 ? 'CBS consumida da fotografia materializada do motor.' : 'CBS indisponível.', regime.chave === 'simples_nacional' && temDasReal ? 'PGDAS real prevaleceu sobre estimativa.' : null, regime.chave === 'lucro_real' && margemInformada ? 'Margem operacional informada: PREMISSA_INFORMADA em cenário simulado; não é lucro tributável real.' : null, regime.chave === 'lucro_presumido' && componentes.irpj_csll ? 'Presunção segregada por natureza de receita, com excedente 2026 proporcional.' : null, regime.chave === 'simples_regime_regular' && hibridoMotor ? 'CBS híbrida executada pelo motor existente em modo sombra.' : null].filter(Boolean), pendencias };
  });
  const completos = cenarios.filter((x) => x.status === 'COMPLETO' && x.tributos_estimados !== null), comparacaoCompleta = completos.length >= 2;
  const menor = comparacaoCompleta ? completos.reduce((a, b) => a.tributos_estimados <= b.tributos_estimados ? a : b) : null;
  if (menor) completos.forEach((x) => { x.diferenca_para_menor = x.tributos_estimados - menor.tributos_estimados; });
  return { empresa: { id: empresa.id, nome: empresa.razao_social, regime_atual: empresa.regime || 'INDETERMINADO' }, receita_analisada: receita, cenarios, melhor_cenario_estimado: menor ? menor.chave : 'INDETERMINADO', economia_estimada: menor ? Math.max(...completos.map((x) => x.tributos_estimados)) - menor.tributos_estimados : null, status_comparacao: comparacaoCompleta ? 'COMPLETA' : 'INCOMPLETA', cenarios_comparaveis: completos.length, cbs_hibrida_via_motor: Boolean(hibridoMotor?.apuracao?.cbs), pgdas_conectado: temDasReal, irpj_csll_resolvidos: ['lucro_real', 'lucro_presumido'].every((r) => cenarios.find((x) => x.chave === r)?.componentes_disponiveis?.irpj_csll) ? 'SIM' : 'NAO', pendencias: [...new Set(cenarios.flatMap((x) => x.pendencias))] };
}
module.exports = { comparar, REGIMES, calcularIrpjCsll, receitaSegregada, dasRemanescenteDoHibrido };
