#!/usr/bin/env node
/**
 * BATERIA DE VALIDAÇÃO DO NÚCLEO DE CENÁRIOS
 * ---------------------------------------------------------------------------
 * Fecha matematicamente e conceitualmente o motor antes da construção da UI.
 * Cada teste declara: entrada, premissa, resultado esperado, resultado
 * encontrado, diferença e status.
 *
 * Rodar:  node testes/cenarios.test.js
 */
const db = require('../src/db');
const cenarioMotor = require('../src/services/cenarioMotor');
const cenarioMemoria = require('../src/services/cenarioMemoria');
const dimensoes = require('../src/services/dimensoes');

const TOL = 0.05;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const brl = (n) => (n === null || n === undefined ? '—'
  : num(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const pct = (n) => (n === null || n === undefined ? '—' : `${(num(n) * 100).toFixed(2)}%`);

const resultados = [];
let empresaId = null;
let movimentoFixturePerfilDesconhecido = null;

function registrar({ n, nome, entrada, premissa, esperado, encontrado, diferenca, ok, obs }) {
  resultados.push({ n, nome, entrada, premissa, esperado, encontrado, diferenca, ok, obs });
  const st = ok ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`\n${String(n).padStart(2)}. ${nome}  [${st}]`);
  console.log(`    entrada   : ${entrada}`);
  console.log(`    premissa  : ${premissa}`);
  console.log(`    esperado  : ${esperado}`);
  console.log(`    encontrado: ${encontrado}`);
  console.log(`    diferença : ${diferenca}`);
  if (obs) console.log(`    nota      : ${obs}`);
}

// --------------------------------------------------------------------------
// utilidades de cenário descartável
// --------------------------------------------------------------------------
function criarCenario(nome, ano = 2033) {
  const base = cenarioMotor.obterOuCriarBase(empresaId, ano);
  const r = db.prepare(`INSERT INTO cenarios (empresa_id, nome, tipo, base_id, versao, ano, status)
    VALUES (?,?, 'hipotese', ?, 1, ?, 'rascunho')`).run(empresaId, nome, base.id, ano);
  const id = r.lastInsertRowid;
  // Isolamento: garante que o cenário nasce sem premissa ou migração herdada.
  // Sem isto, um id reaproveitado após restauração de backup traria resíduo e
  // o teste passaria ou falharia por motivo errado.
  db.prepare('DELETE FROM cenario_alocacoes WHERE cenario_id = ?').run(id);
  db.prepare('DELETE FROM cenario_premissas WHERE cenario_id = ?').run(id);
  db.prepare('DELETE FROM cenario_composicao WHERE cenario_id = ?').run(id);
  return id;
}
function migrar(cenarioId, lado, dimensao, origem, destino, percentual, variacaoPreco = 0) {
  db.prepare(`INSERT INTO cenario_alocacoes (cenario_id, lado, dimensao, grupo_origem,
    grupo_destino, percentual_grupo, variacao_preco) VALUES (?,?,?,?,?,?,?)`)
    .run(cenarioId, lado, dimensao, origem, destino, percentual, variacaoPreco);
}
function premissaIndividual(cenarioId, lado, cnpj, campo, valor, justificativa = '') {
  db.prepare(`INSERT INTO cenario_premissas (cenario_id, nivel, lado, entidade_tipo, entidade_id,
    campo, valor_simulado, justificativa) VALUES (?, 'individual', ?, 'parceiro', ?, ?, ?, ?)`)
    .run(cenarioId, lado, cnpj, campo, String(valor), justificativa);
}
function limpar(ids) {
  ids.forEach((id) => {
    db.prepare('DELETE FROM cenario_alocacoes WHERE cenario_id = ?').run(id);
    db.prepare('DELETE FROM cenario_premissas WHERE cenario_id = ?').run(id);
    db.prepare('DELETE FROM cenario_composicao WHERE cenario_id = ?').run(id);
    db.prepare('DELETE FROM cenarios WHERE id = ?').run(id);
  });
  if (movimentoFixturePerfilDesconhecido) {
    db.prepare('DELETE FROM motor_resultados WHERE movimento_id=?').run(movimentoFixturePerfilDesconhecido);
    db.prepare('DELETE FROM movimentos WHERE id=?').run(movimentoFixturePerfilDesconhecido);
  }
}
const grupo = (res, lado, dim, g) =>
  (res.composicao[lado][dim].grupos.find((x) => x.grupo === g) || {});

// ==========================================================================
function executar() {
  const emp = db.prepare('SELECT * FROM empresas ORDER BY id LIMIT 1').get();
  if (!emp) { console.error('Nenhuma empresa cadastrada.'); process.exit(1); }
  empresaId = emp.id;

  // Fixture controlada para a regra de perfil desconhecido. A carteira real
  // pode legitimamente ter 0% nesse grupo; o teste não pode depender disso.
  // Copiamos uma saída já classificada, mas removemos somente o regime do
  // destinatário para testar a incerteza comercial sem inventar tributação.
  let fonteFixture = db.prepare(`SELECT m.* FROM movimentos m
    JOIN motor_resultados r ON r.movimento_id=m.id AND r.empresa_id=m.empresa_id
    WHERE m.empresa_id=? AND m.tipo='cliente' AND r.status_classificacao='CLASSIFICADO'
      AND (m.ncm IS NOT NULL AND m.ncm<>'' OR m.nbs IS NOT NULL AND m.nbs<>'' OR m.cst IS NOT NULL AND m.cst<>'')
    ORDER BY id LIMIT 1`).get(empresaId);
  // A fixture não pode depender da fotografia compartilhada: ela pode conter
  // somente itens pendentes em uma empresa real. Neste caso, cria a origem a
  // partir de NCM com uma única classificação determinística do catálogo.
  if (!fonteFixture) {
    const catalogo = db.prepare(`SELECT ncm, MAX(descricao) descricao, MAX(cst) cst, MAX(cclasstrib) cclasstrib,
      MAX(reducao) reducao FROM base_ncm WHERE ncm<>'' GROUP BY ncm HAVING COUNT(DISTINCT cclasstrib)=1 LIMIT 1`).get();
    if (!catalogo) throw new Error('Catálogo sem NCM determinístico para montar fixture independente de cenário.');
    fonteFixture = { ...catalogo, nbs: null, cfop: '5102', competencia: '2027-01', base_calculo: 100000,
      icms: 0, icms_st: 0, ipi: 0, pis: 0, cofins: 0, pis_cofins_documentado: 0, iss: 0, aliq_especifica: null, unidade: 'UN' };
  }
  const fixture = db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,nome,inscr_federal,descricao,ncm,nbs,cfop,cst,competencia,valor,base_calculo,icms,icms_st,ipi,pis,cofins,pis_cofins_documentado,iss,regime,reducao,aliq_especifica,cclasstrib,documento,item_numero,chave,codigo_produto,quantidade,unidade,sentido,origem)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    empresaId, 'cliente', 'FIXTURE PERFIL DESCONHECIDO', '99999999000199', fonteFixture.descricao, fonteFixture.ncm, fonteFixture.nbs,
    fonteFixture.cfop, fonteFixture.cst, fonteFixture.competencia, 100000, fonteFixture.base_calculo, fonteFixture.icms,
    fonteFixture.icms_st, fonteFixture.ipi, fonteFixture.pis, fonteFixture.cofins, fonteFixture.pis_cofins_documentado,
    fonteFixture.iss, null, fonteFixture.reducao, fonteFixture.aliq_especifica, fonteFixture.cclasstrib,
    'FIXTURE-PERFIL-DESCONHECIDO', 1, 'FIXTURE-PERFIL-DESCONHECIDO', 'FIX-PERFIL-IND', 1, fonteFixture.unidade, 'saida', 'teste');
  movimentoFixturePerfilDesconhecido = fixture.lastInsertRowid;

  console.log('='.repeat(78));
  console.log(`BATERIA DE VALIDAÇÃO — ${emp.razao_social}`);
  console.log('='.repeat(78));

  const base = cenarioMotor.calcularBase(empresaId, 2033);
  const cBase = base.composicao.compras.regime_fornecedor.grupos;
  const gSimplesBase = cBase.find((g) => g.grupo === 'simples');
  const gRegularBase = cBase.find((g) => g.grupo === 'regular');
  const gMeiBase = cBase.find((g) => g.grupo === 'mei');
  const descartar = [];

  // ---------------------------------------------------------------- 1
  {
    const id = criarCenario('T1 sem migração'); descartar.push(id);
    const r = cenarioMotor.executarCenario(id);
    const g = grupo(r, 'compras', 'regime_fornecedor', 'simples');
    const dif = num(g.valor) - num(gSimplesBase.valor);
    registrar({ n: 1, nome: 'Grupo sem migração',
      entrada: `grupo Simples com ${brl(gSimplesBase.valor)} (${pct(gSimplesBase.participacao)})`,
      premissa: 'nenhuma',
      esperado: `composição idêntica ao base: ${brl(gSimplesBase.valor)}`,
      encontrado: brl(g.valor), diferenca: brl(dif),
      ok: Math.abs(dif) < TOL });
  }

  // ---------------------------------------------------------------- 2
  {
    const id = criarCenario('T2 migração 0%'); descartar.push(id);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 0);
    let r, erro = null;
    try { r = cenarioMotor.executarCenario(id); } catch (e) { erro = e.message; }
    const g = r ? grupo(r, 'compras', 'regime_fornecedor', 'simples') : {};
    const dif = r ? num(g.valor) - num(gSimplesBase.valor) : null;
    registrar({ n: 2, nome: 'Migração de 0%',
      entrada: `grupo Simples ${brl(gSimplesBase.valor)}`,
      premissa: 'migrar 0% do grupo Simples para regime regular',
      esperado: 'nada muda; composição igual ao base',
      encontrado: erro ? `erro: ${erro}` : brl(g.valor),
      diferenca: erro ? '—' : brl(dif),
      ok: !erro && Math.abs(dif) < TOL });
  }

  // ---------------------------------------------------------------- 3
  {
    const id = criarCenario('T3 migração 100%'); descartar.push(id);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 1);
    const r = cenarioMotor.executarCenario(id);
    const gS = grupo(r, 'compras', 'regime_fornecedor', 'simples');
    const gR = grupo(r, 'compras', 'regime_fornecedor', 'regular');
    const esperadoRegular = num(gRegularBase.valor) + num(gSimplesBase.valor);
    const dif = num(gR.valor) - esperadoRegular;
    const okZero = num(gS.valor) < TOL;
    registrar({ n: 3, nome: 'Migração de 100%',
      entrada: `Simples ${brl(gSimplesBase.valor)} · regular ${brl(gRegularBase.valor)}`,
      premissa: 'migrar 100% do grupo Simples para regime regular',
      esperado: `Simples zerado e regular = ${brl(esperadoRegular)}`,
      encontrado: `Simples ${brl(gS.valor)} · regular ${brl(gR.valor)}`,
      diferenca: brl(dif), ok: okZero && Math.abs(dif) < TOL });
  }

  // ---------------------------------------------------------------- 4
  {
    const id = criarCenario('T4 duas migrações'); descartar.push(id);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 0.30);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'mei', 0.20);
    const r = cenarioMotor.executarCenario(id);
    const gS = grupo(r, 'compras', 'regime_fornecedor', 'simples');
    const gR = grupo(r, 'compras', 'regime_fornecedor', 'regular');
    const gM = grupo(r, 'compras', 'regime_fornecedor', 'mei');
    const espS = num(gSimplesBase.valor) * 0.50;
    const espR = num(gRegularBase.valor) + num(gSimplesBase.valor) * 0.30;
    const espM = num(gMeiBase.valor) + num(gSimplesBase.valor) * 0.20;
    const dif = Math.max(Math.abs(num(gS.valor) - espS), Math.abs(num(gR.valor) - espR), Math.abs(num(gM.valor) - espM));
    registrar({ n: 4, nome: 'Duas migrações saindo do mesmo grupo',
      entrada: `Simples ${brl(gSimplesBase.valor)}`,
      premissa: '30% → regular e 20% → MEI (50% permanece)',
      esperado: `Simples ${brl(espS)} · regular ${brl(espR)} · MEI ${brl(espM)}`,
      encontrado: `Simples ${brl(gS.valor)} · regular ${brl(gR.valor)} · MEI ${brl(gM.valor)}`,
      diferenca: brl(dif), ok: dif < TOL });
  }

  // ---------------------------------------------------------------- 5
  {
    const id = criarCenario('T5 precedência individual'); descartar.push(id);
    // maior fornecedor do grupo Simples
    const itensSimples = base.entradas.filter((x) => x.grupos.regime_fornecedor === 'simples');
    const porCnpj = new Map();
    itensSimples.forEach((x) => porCnpj.set(x.cnpj, (porCnpj.get(x.cnpj) || 0) + num(x.precoAtual)));
    const alvo = [...porCnpj.entries()].sort((a, b) => b[1] - a[1])[0];
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 1);
    premissaIndividual(id, 'compras', alvo[0], 'regime', 'simples_nacional', 'permanece no Simples');
    const r = cenarioMotor.executarCenario(id);
    const gS = grupo(r, 'compras', 'regime_fornecedor', 'simples');
    const dif = num(gS.valor) - alvo[1];
    const drill = cenarioMemoria.drillDown(r, 'compras', 'regime_fornecedor', 'simples', 50);
    const semSplit = drill.every((x) => x.fracao === 1);
    registrar({ n: 5, nome: 'Premissa individual prevalece sobre o grupo',
      entrada: `migração de 100% do Simples; fornecedor ${alvo[0]} com ${brl(alvo[1])}`,
      premissa: 'individual: manter esse fornecedor no Simples',
      esperado: `apenas ${brl(alvo[1])} permanece no Simples, sem fracionamento`,
      encontrado: `${brl(gS.valor)} · linhas sem split: ${semSplit}`,
      diferenca: brl(dif), ok: Math.abs(dif) < TOL && semSplit,
      obs: (drill[0] && drill[0].precedencia && drill[0].precedencia.length)
        ? drill[0].precedencia.map((p) => p.texto).join(' | ').slice(0, 120) : '' });
  }

  // ---------------------------------------------------------------- 6
  {
    const itens = base.entradas.filter((x) => x.grupos.regime_fornecedor === 'simples');
    const comFaixa = itens.filter((x) => x.cenariosSimples);
    const c = comFaixa[0] && comFaixa[0].cenariosSimples;
    const amp = c && c.amplitude;
    const ok = !!(c && c.cenarios.length >= 3 && amp && amp.creditoMax >= amp.creditoMin
      && c.cenarios.every((f) => f.natureza === 'SIMULADO'));
    registrar({ n: 6, nome: 'Grupo Simples com crédito por faixa',
      entrada: `${itens.length} lançamentos do Simples sem faturamento conhecido`,
      premissa: 'nenhuma — o motor simula as faixas em vez de arbitrar',
      esperado: 'intervalo com ao menos 3 faixas, todas marcadas SIMULADO',
      encontrado: c ? `${c.cenarios.length} faixas · crédito de ${brl(amp.creditoMin)} a ${brl(amp.creditoMax)}` : 'sem cenários de faixa',
      diferenca: c ? brl(amp.creditoMax - amp.creditoMin) : '—', ok,
      obs: 'nenhuma faixa é escolhida automaticamente' });
  }

  // ---------------------------------------------------------------- 7
  {
    const semDireito = base.entradas.filter((x) => x.credito && x.credito.status === 'SEM_DIREITO');
    const soma = semDireito.reduce((s, x) => s + num(x.creditoTotal), 0);
    const grp = base.composicao.compras.credito_fornecedor.grupos.find((g) => g.grupo === 'sem_credito');
    registrar({ n: 7, nome: 'Grupo com crédito zero REAL',
      entrada: `${semDireito.length} lançamentos com status SEM_DIREITO`,
      premissa: 'nenhuma',
      esperado: 'crédito exatamente 0,00 — zero apurado, não ausência de dado',
      encontrado: `crédito ${brl(soma)} · grupo "${grp ? grp.nome : '—'}" com ${brl(grp ? grp.valor : 0)}`,
      diferenca: brl(soma), ok: Math.abs(soma) < 0.001 });
  }

  // ---------------------------------------------------------------- 8
  {
    const ind = base.entradas.filter((x) => x.credito
      && ['DADOS_INSUFICIENTES', 'SUJEITO_VALIDACAO'].includes(x.credito.status));
    const det = cenarioMotor.decomporCredito(base.entradas);
    const ok = det.indeterminado.credito === null
      && Math.abs(det.indeterminado.valor - ind.reduce((s, x) => s + num(x.precoAtual), 0)) < TOL;
    registrar({ n: 8, nome: 'Grupo com crédito INDETERMINADO',
      entrada: `${ind.length} lançamentos sem informação suficiente sobre crédito`,
      premissa: 'nenhuma',
      esperado: 'crédito = NÃO DETERMINADO (null), nunca convertido em zero',
      encontrado: `crédito ${det.indeterminado.credito === null ? 'NÃO DETERMINADO' : brl(det.indeterminado.credito)} sobre ${brl(det.indeterminado.valor)}`,
      diferenca: '—', ok });
  }

  // ---------------------------------------------------------------- 9 e 10
  {
    const det = cenarioMotor.decomporCredito(base.saidas);
    const semDir = base.saidas.filter((x) => x.credito && x.credito.status === 'SEM_DIREITO');
    const somaCred = semDir.reduce((s, x) => s + num(x.creditoTotal), 0);
    registrar({ n: 9, nome: 'Cliente conhecido SEM crédito',
      entrada: `${semDir.length} lançamentos para clientes que não se apropriam`,
      premissa: 'nenhuma',
      esperado: 'crédito entregue 0,00 classificado como "sem direito" (conclusão)',
      encontrado: `${brl(det.semDireito.valor)} de receita · crédito ${brl(somaCred)}`,
      diferenca: brl(somaCred), ok: Math.abs(somaCred) < 0.001 });

    const id = criarCenario('T10 cliente com crédito'); descartar.push(id);
    migrar(id, 'vendas', 'perfil_cliente', 'indeterminado', 'b2b_credito', 1);
    const r = cenarioMotor.executarCenario(id);
    const gB = grupo(r, 'vendas', 'perfil_cliente', 'b2b_credito');
    // O crédito entregue é a soma do IBS+CBS efetivamente calculado por item,
    // e cada item carrega o próprio tratamento (integral, redução, alíquota
    // zero). Esperar "base × 26,5%" ignoraria as reduções — a expectativa
    // correta é o débito destacado no próprio grupo.
    // O crédito entregue NÃO é todo o IBS/CBS destacado: itens cuja
    // classificação ainda requer validação geram débito, mas o crédito do
    // adquirente fica pendente. A invariante correta é:
    //    crédito entregue = IBS+CBS dos itens com crédito assegurado
    const doGrupo = r.saidas.filter((x) => x.migracao && x.grupos.perfil_cliente === 'b2b_credito');
    const comCredito = doGrupo.filter((x) => x.credito && x.credito.status === 'PROJETADO');
    const pendentes = doGrupo.filter((x) => x.credito && x.credito.status !== 'PROJETADO');
    const esperado = comCredito.reduce((s2, x) => s2 + num(x.ibs) + num(x.cbs), 0);
    const debitoTotal = num(gB.ibs) + num(gB.cbs);
    const aliqCheia = num(gB.baseEconomica) * 0.265;
    const creditoMigrado = comCredito.reduce((s2, x) => s2 + num(x.creditoTotal), 0);
    const dif = creditoMigrado - esperado;
    registrar({ n: 10, nome: 'Cliente conhecido COM crédito',
      entrada: `100% do grupo indeterminado (${brl(base.composicao.vendas.perfil_cliente.grupos.find((g) => g.grupo === 'indeterminado').valor)})`,
      premissa: 'migrar para B2B com crédito relevante',
      esperado: `crédito = IBS+CBS dos itens com crédito assegurado = ${brl(esperado)}`,
      encontrado: `${brl(creditoMigrado)} (marcado SIMULADO)`,
      diferenca: brl(dif), ok: Math.abs(dif) < Math.max(TOL, comCredito.length * 0.01),
      obs: `débito destacado no grupo ${brl(debitoTotal)}; ${pendentes.length} itens com classificação pendente geram débito mas não crédito assegurado (${brl(debitoTotal - esperado)}); a alíquota cheia daria ${brl(aliqCheia)}` });
  }

  // ---------------------------------------------------------------- 11
  {
    const det = cenarioMotor.decomporCredito(base.saidas);
    const gInd = base.composicao.vendas.perfil_cliente.grupos.find((g) => g.grupo === 'indeterminado');
    // A cobertura de crédito também pode ser reduzida por classificação
    // pendente em perfis já conhecidos. O perfil desconhecido precisa estar
    // integralmente dentro do bloco indeterminado, mas não é necessariamente
    // o único motivo de indeterminação da carteira.
    const ok = det.indeterminado.credito === null && det.indeterminado.valor + TOL >= num(gInd.valor)
      && det.cobertura < 1;
    registrar({ n: 11, nome: 'Cliente desconhecido',
      entrada: `${brl(gInd.valor)} de receita com perfil desconhecido (${pct(gInd.participacao)})`,
      premissa: 'nenhuma',
      esperado: 'crédito entregue NÃO DETERMINADO; cobertura da análise reduzida',
      encontrado: `crédito ${det.indeterminado.credito === null ? 'NÃO DETERMINADO' : 'convertido em número'} · cobertura ${pct(det.cobertura)}`,
      diferenca: '—', ok });
  }

  // ---------------------------------------------------------------- 12
  {
    const id = criarCenario('T12 30% do indeterminado como B2B'); descartar.push(id);
    migrar(id, 'vendas', 'perfil_cliente', 'indeterminado', 'b2b_credito', 0.30);
    const r = cenarioMotor.executarCenario(id);
    const d = r.indicadores.creditoEntregueDetalhe;
    const gInd = base.composicao.vendas.perfil_cliente.grupos.find((g) => g.grupo === 'indeterminado');
    const espValor = num(gInd.valor) * 0.30;
    const gB = grupo(r, 'vendas', 'perfil_cliente', 'b2b_credito');
    const valorB2bOriginal = num(base.composicao.vendas.perfil_cliente.grupos.find((x) => x.grupo === 'b2b_credito').valor);
    // Cada linha virtual é arredondada a 2 casas; com centenas de linhas o
    // erro de arredondamento acumula. A tolerância acompanha o volume:
    // 1 centavo por linha é o limite teórico.
    const linhas = r.saidas.filter((x) => x.migracao).length;
    const tolAcumulada = Math.max(TOL, linhas * 0.01);
    const migrados = r.saidas.filter((x) => x.migracao && x.grupos.perfil_cliente === 'b2b_credito');
    const valorMigrado = migrados.reduce((s, x) => s + num(x.precoAtual), 0);
    const dif = valorMigrado - espValor;
    const creditoMigrado = migrados.reduce((s, x) => s + num(x.creditoTotal), 0);
    // Uma premissa comercial B2B não altera a classificação fiscal nem cria
    // crédito CBS. Se o item segue pendente, o crédito continua pendente/zero
    // apurado; se já era determinado, preserva apenas o crédito oficial.
    const fiscaisPreservados = migrados.every((x) => x.classificacao?.status !== 'CLASSIFICADO'
      ? ['SUJEITO_VALIDACAO', 'DADOS_INSUFICIENTES', 'INDETERMINADO', 'SEM_DIREITO'].includes(x.credito?.statusDeterminacao || x.credito?.status)
      : true);
    const semCreditoInventado = migrados.every((x) => x.classificacao?.status !== 'CLASSIFICADO'
      ? num(x.creditoTotal) === 0 : true);
    const ok = Math.abs(dif) < tolAcumulada && fiscaisPreservados && semCreditoInventado
      && d.indeterminado.credito === null && d.simulado.natureza === 'SIMULADO';
    registrar({ n: 12, nome: 'Cliente desconhecido parcialmente simulado como B2B',
      entrada: `indeterminado ${brl(gInd.valor)}`,
      premissa: 'migrar 30% do grupo indeterminado para B2B com crédito',
      esperado: `${brl(espValor)} migrados; perfil comercial B2B sem alterar classificação nem criar crédito; resto continua NÃO DETERMINADO`,
      encontrado: `${brl(valorMigrado)} migrados · crédito preservado ${brl(creditoMigrado)} · estado fiscal preservado: ${fiscaisPreservados} · resto ${d.indeterminado.credito === null ? 'NÃO DETERMINADO' : 'zerado'}`,
      diferenca: brl(dif), ok,
      obs: `tolerância de arredondamento: ${brl(tolAcumulada)} para ${linhas} linhas virtuais` });
  }

  // ---------------------------------------------------------------- 13 e 14
  for (const [n, var_, rotulo] of [[13, 0.05, '+5%'], [14, -0.05, '-5%']]) {
    const id = criarCenario(`T${n} alteração comercial ${rotulo}`); descartar.push(id);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 1, var_);
    const r = cenarioMotor.executarCenario(id);
    const e = r.efeitos.compras;
    // a base econômica dos itens migrados varia; o restante não muda
    const espEfeito = num(gSimplesBase.baseEconomica) * var_;
    const dif = num(e.efeitoComercial) - espEfeito;
    const somaOk = Math.abs(num(e.efeitoComercial) + num(e.efeitoTributario)
      - num(e.efeitoCredito) - num(e.efeitoLiquido)) < 0.5;
    registrar({ n, nome: `Alteração comercial de ${rotulo}`,
      entrada: `migrar 100% do Simples (base econômica ${brl(gSimplesBase.baseEconomica)})`,
      premissa: `variação comercial de ${rotulo} sobre os itens migrados`,
      esperado: `efeito comercial ≈ ${brl(espEfeito)} e decomposição fechando`,
      encontrado: `comercial ${brl(e.efeitoComercial)} · tributário ${brl(e.efeitoTributario)} · crédito ${brl(e.efeitoCredito)} · líquido ${brl(e.efeitoLiquido)}`,
      diferenca: brl(dif),
      ok: Math.abs(dif) < Math.max(TOL, Math.abs(espEfeito) * 0.02) && somaOk,
      obs: `premissa registrada: ${e.premissaPadrao}` });
  }

  // ---------------------------------------------------------------- 15
  {
    const id = criarCenario('T15 reconciliação'); descartar.push(id);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 0.4);
    const r = cenarioMotor.executarCenario(id);
    const rec = cenarioMemoria.reconciliar(r, 'compras');
    const piorDif = Math.max(...rec.dimensoes.map((d) => Math.abs(d.diferenca)));
    const cem = rec.dimensoes.every((d) => Math.abs(d.participacaoTotal - 1) < 0.0001);
    registrar({ n: 15, nome: 'Reconciliação agregado × detalhe',
      entrada: `${r.entradas.length} linhas virtuais em ${rec.dimensoes.length} dimensões`,
      premissa: 'migrar 40% do Simples',
      esperado: 'soma dos grupos = soma do detalhe em toda dimensão, e participação 100%',
      encontrado: `pior diferença ${brl(piorDif)} · todas em 100%: ${cem}`,
      diferenca: brl(piorDif), ok: piorDif < TOL && cem && rec.confere });
  }

  // ---------------------------------------------------------------- 16
  {
    const id = criarCenario('T16 waterfall'); descartar.push(id);
    migrar(id, 'compras', 'regime_fornecedor', 'simples', 'regular', 0.4);
    const r = cenarioMotor.executarCenario(id);
    // waterfall das entradas, item a item: base + IBS + CBS − crédito = custo efetivo
    let pior = 0, quebrados = 0;
    for (const x of r.entradas) {
      if (x.emitenteNoDas) continue;   // no DAS o IVA não entra por fora
      const esperado = num(x.baseEconomica) + num(x.ibs) + num(x.cbs)
        + num(x.reconstrucao && x.reconstrucao.foraDaBase) * (x.fracao ?? 1) - num(x.creditoTotal);
      const d = Math.abs(esperado - num(x.custoLiquido));
      if (d > 0.05) { quebrados++; pior = Math.max(pior, d); }
    }
    const e = r.efeitos.compras;
    const somaEfeitos = Math.abs(num(e.efeitoComercial) + num(e.efeitoTributario)
      - num(e.efeitoCredito) - num(e.efeitoLiquido));
    registrar({ n: 16, nome: 'Reconciliação do waterfall',
      entrada: `${r.entradas.length} linhas`,
      premissa: 'migrar 40% do Simples',
      esperado: 'base + IBS + CBS − crédito = custo efetivo, em toda linha; e efeitos somando ao líquido',
      encontrado: `${quebrados} linhas fora da conta · soma dos efeitos difere em ${brl(somaEfeitos)}`,
      diferenca: brl(pior), ok: quebrados === 0 && somaEfeitos < 0.5 });
  }

  limpar(descartar);

  // ------------------------------------------------------------- resumo
  const pass = resultados.filter((r) => r.ok).length;
  console.log(`\n${'='.repeat(78)}`);
  console.log(`RESULTADO: ${pass} de ${resultados.length} testes passaram`);
  console.log('='.repeat(78));
  for (const r of resultados) {
    console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${String(r.n).padStart(2)}. ${r.nome}`);
  }
  if (pass < resultados.length) process.exitCode = 1;
  return resultados;
}

if (require.main === module) executar();
module.exports = { executar };
