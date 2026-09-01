/*
 * Comparador de regimes: leitura e orquestração de dados existentes.
 * Não executa o motor CBS nem cria fórmula concorrente. A CBS apresentada é
 * sempre a fotografia já materializada pelo motor.
 */
const n = (v) => Number(v) || 0;
const REGIMES = [
  { chave: 'lucro_real', rotulo: 'Lucro Real' },
  { chave: 'lucro_presumido', rotulo: 'Lucro Presumido' },
  { chave: 'simples_nacional', rotulo: 'Simples Nacional' },
  { chave: 'simples_regime_regular', rotulo: 'Simples Nacional Híbrido' },
];

function somaSeTabelaExiste(db, sql, empresaId) {
  try { return n(db.prepare(sql).get(empresaId)?.valor); }
  catch (_) { return 0; }
}

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

function calcularIrpjCsll(parametros, regime, receita, margem) {
  const regras = parametros.filter((x) => x.regime === regime && x.natureza_receita === 'GERAL');
  const porTributo = new Map();
  for (const r of regras) {
    if (porTributo.has(r.tributo)) return null; // variantes concorrentes exigem seleção explícita futura
    porTributo.set(r.tributo, r);
  }
  if (!porTributo.has('IRPJ') || !porTributo.has('CSLL') || receita === null) return null;
  const calcular = (r) => {
    let base = null;
    if (r.tipo_base === 'MARGEM_OPERACIONAL') base = margem === null ? null : receita * margem;
    if (r.tipo_base === 'RECEITA_BRUTA') base = receita;
    if (r.tipo_base === 'BASE_PRESUNCAO' && r.percentual_base !== null && r.percentual_base !== undefined) base = receita * n(r.percentual_base);
    if (base === null || r.aliquota === null || r.aliquota === undefined) return null;
    if (r.adicional !== null && r.adicional !== undefined && (r.limite_adicional === null || r.limite_adicional === undefined)) return null;
    return base * n(r.aliquota) + (r.adicional !== null && r.adicional !== undefined ? Math.max(0, base - n(r.limite_adicional)) * n(r.adicional) : 0);
  };
  const irpj = calcular(porTributo.get('IRPJ')), csll = calcular(porTributo.get('CSLL'));
  if (irpj === null || csll === null) return null;
  return { valor: irpj + csll, natureza: regime === 'lucro_real' ? 'SIMULADO' : 'CALCULADO', regras: [...porTributo.values()] };
}

function comparar(db, empresaId, opcoes = {}) {
  const empresa = db.prepare('SELECT id, razao_social, regime FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const perfis = db.prepare('SELECT * FROM perfil_tributario WHERE empresa_id=? AND COALESCE(competencia,\'\')<>\'\'').all(empresaId);
  const receitaDocumento = db.prepare(`SELECT SUM(COALESCE(valor,0)) valor FROM movimentos
    WHERE empresa_id=? AND (tipo='cliente' OR sentido='saida')`).get(empresaId).valor;
  const receitaComplementar = somaSeTabelaExiste(db, 'SELECT SUM(COALESCE(valor,0)) valor FROM receitas_sem_dfe WHERE empresa_id=?', empresaId);
  const receitaPerfil = perfis.length ? perfis.reduce((s, x) => s + n(x.receita_bruta), 0) : null;
  const receitaBase = receitaPerfil !== null ? receitaPerfil : (receitaDocumento === null || receitaDocumento === undefined ? null : n(receitaDocumento));
  const receita = receitaBase === null ? null : receitaBase + receitaComplementar;
  const cbs = db.prepare(`SELECT SUM(COALESCE(cbs_liquida,0)) valor, COUNT(*) quantidade
    FROM perfil_cbs_competencias WHERE empresa_id=?`).get(empresaId);
  const parametros = new Map(db.prepare('SELECT chave,pis_cofins FROM param_regimes').all().map((x) => [x.chave, x]));
  const dasReal = perfis.reduce((s, x) => s + n(x.das), 0);
  const temDasReal = perfis.length > 0 && empresa.regime === 'simples_nacional';
  const margens = db.prepare('SELECT * FROM margens_operacionais_premissas WHERE empresa_id=?').all(empresaId);
  const margemInformada = margens.length > 0;
  const margem = margemAplicavel(perfis, margens, receita);
  const competenciaReferencia = perfis.map((x) => x.competencia).sort().at(-1) || null;
  const parametrosIrpjCsll = competenciaReferencia ? db.prepare(`SELECT * FROM param_irpj_csll_versionados
    WHERE status='ATIVO' AND vigencia_inicio<=? AND (vigencia_fim IS NULL OR vigencia_fim>=?)`).all(competenciaReferencia, competenciaReferencia) : [];
  let hibridoMotor = null;
  let erroHibrido = null;
  try {
    // Carregamento tardio preserva o comparador como serviço testável e só
    // conecta o banco operacional quando não há executor de cenário injetado.
    const executarMotor = opcoes.executarMotor || require('./motorExec').executar;
    hibridoMotor = executarMotor(empresaId, { ano: opcoes.ano || 2027, gravar: false, regimeEmpresa: 'simples_regime_regular' });
  } catch (e) { erroHibrido = e.message; }

  const cenarios = REGIMES.map((regime) => {
    const p = parametros.get(regime.chave);
    const componentes = {};
    const pendencias = [];
    if (receita === null) pendencias.push('Receita fiscal por período não disponível.');
    if (p?.pis_cofins !== null && p?.pis_cofins !== undefined && receita !== null) {
      componentes.pis_cofins = { valor: receita * n(p.pis_cofins), natureza: 'CALCULADO', regra: `param_regimes.${regime.chave}` };
    } else if (regime.chave !== 'simples_nacional') {
      pendencias.push('Regra parametrizada de PIS/Cofins não disponível para este regime.');
    }
    const irpjCsll = ['lucro_real', 'lucro_presumido'].includes(regime.chave)
      ? calcularIrpjCsll(parametrosIrpjCsll, regime.chave, receita, margem) : null;
    if (irpjCsll) componentes.irpj_csll = { valor: irpjCsll.valor, natureza: irpjCsll.natureza,
      regras: irpjCsll.regras.map((x) => ({ tributo: x.tributo, versao: x.versao, fonte: x.fonte, fundamento: x.fundamento })) };
    if (cbs.quantidade > 0) componentes.cbs_motor_existente = { valor: n(cbs.valor), natureza: 'CALCULADO', origem: 'perfil_cbs_competencias' };
    else pendencias.push('Fotografia CBS do motor não materializada.');

    let tributosEstimados = null;
    let natureza = 'INDETERMINADO';
    let status = 'INCOMPLETO';
    if (regime.chave === 'simples_nacional' && temDasReal && receita !== null) {
      // PGDAS real é fato histórico; não é estimativa genérica de DAS.
      tributosEstimados = dasReal;
      natureza = 'REAL';
      status = 'COMPLETO';
    } else if (['lucro_real', 'lucro_presumido'].includes(regime.chave)
      && receita !== null && componentes.pis_cofins && componentes.irpj_csll && componentes.cbs_motor_existente) {
      tributosEstimados = componentes.pis_cofins.valor + componentes.irpj_csll.valor + componentes.cbs_motor_existente.valor;
      natureza = regime.chave === 'lucro_real' ? 'SIMULADO' : 'CALCULADO';
      status = 'COMPLETO';
    } else {
      pendencias.push(regime.chave === 'simples_nacional'
        ? 'PGDAS real ou dados completos para apuração do DAS não disponíveis.'
        : irpjCsll ? 'Demais componentes necessários à carga total não estão determinados pelas evidências disponíveis.' : 'IRPJ/CSLL e demais componentes necessários à carga total não estão determinados pelas evidências disponíveis.');
      natureza = receita !== null && Object.keys(componentes).length ? 'PARCIAL' : 'INCOMPLETO';
      status = natureza;
    }
    if (regime.chave === 'simples_regime_regular') {
      if (hibridoMotor?.apuracao?.cbs) {
        componentes.cbs_hibrida_motor = { valor: n(hibridoMotor.apuracao.cbs.saldo), natureza: 'SIMULADO', origem: 'motorExec.executar(regimeEmpresa=simples_regime_regular)' };
      } else {
        pendencias.push(`Motor CBS híbrido não disponível em sombra${erroHibrido ? `: ${erroHibrido}` : '.'}`);
      }
      tributosEstimados = null;
      natureza = receita !== null ? 'PARCIAL' : 'INCOMPLETO';
      status = natureza;
    }
    return {
      ...regime,
      tributos_estimados: tributosEstimados,
      carga_efetiva_percentual: tributosEstimados !== null && receita > 0 ? tributosEstimados / receita : null,
      diferenca_para_menor: null,
      status,
      completude: status,
      natureza,
      componentes_disponiveis: componentes,
      premissas_utilizadas: [
        receitaPerfil !== null ? 'Receita do Perfil Tributário.' : 'Receita fiscal de documentos.',
        receitaComplementar > 0 ? 'Receitas sem DF-e validadas foram adicionadas à mesma base econômica.' : null,
        cbs.quantidade > 0 ? 'CBS consumida da fotografia materializada do motor.' : 'CBS indisponível.',
        regime.chave === 'simples_nacional' && temDasReal ? 'PGDAS real prevaleceu sobre estimativa.' : null,
        regime.chave === 'lucro_real' && margemInformada ? 'Margem operacional informada: usada apenas como PREMISSA_INFORMADA em cenário simulado; não é lucro tributável real.' : null,
        regime.chave === 'simples_regime_regular' && hibridoMotor ? 'CBS híbrida executada pelo motor existente em modo sombra.' : null,
      ].filter(Boolean),
      pendencias,
    };
  });
  // O ranking compara somente cenários completos na mesma base econômica.
  // Cenários parciais não entram nem impedem os completos de serem comparados.
  const completos = cenarios.filter((x) => x.status === 'COMPLETO' && x.tributos_estimados !== null);
  const comparacaoCompleta = completos.length >= 2;
  const menor = comparacaoCompleta ? completos.reduce((a, b) => a.tributos_estimados <= b.tributos_estimados ? a : b) : null;
  if (menor) completos.forEach((x) => { x.diferenca_para_menor = x.tributos_estimados - menor.tributos_estimados; });
  return {
    empresa: { id: empresa.id, nome: empresa.razao_social, regime_atual: empresa.regime || 'INDETERMINADO' },
    receita_analisada: receita,
    cenarios,
    melhor_cenario_estimado: menor ? menor.chave : 'INDETERMINADO',
    economia_estimada: menor ? Math.max(...completos.map((x) => x.tributos_estimados)) - menor.tributos_estimados : null,
    status_comparacao: comparacaoCompleta ? 'COMPLETA' : 'INCOMPLETA',
    cenarios_comparaveis: completos.length,
    cbs_hibrida_via_motor: Boolean(hibridoMotor?.apuracao?.cbs),
    pgdas_conectado: temDasReal,
    irpj_csll_resolvidos: ['lucro_real', 'lucro_presumido'].every((r) => cenarios.find((x) => x.chave === r)?.componentes_disponiveis?.irpj_csll) ? 'SIM' : 'NAO',
    pendencias: [...new Set(cenarios.flatMap((x) => x.pendencias))],
  };
}

module.exports = { comparar, REGIMES };
