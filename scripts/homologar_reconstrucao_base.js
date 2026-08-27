/*
 * Gera uma fotografia oficial íntegra após a correção da precedência de
 * PIS/COFINS. Recalcula só as saídas que dependiam do catálogo condicional ou
 * sem catálogo e reutiliza, sem recálculo, as demais linhas da fotografia 1.
 *
 * Uso: node scripts/homologar_reconstrucao_base.js --executar
 */
require('dotenv').config();
const { Pool } = require('pg');
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const operacao = require('../src/services/operacaoCompartilhada');
const supabase = require('../src/services/supabase');
const regras = require('../src/services/regras');

const EMPRESA_ID = 1;
const ANO = 2027;
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const numero = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const json = (v) => typeof v === 'string' ? JSON.parse(v) : (v || {});

function detalheDe(linha) { return json(json(linha.dados).detalhe); }
function metodoDa(linha) { return detalheDe(linha).reconstrucao?.memoriaPisCofins?.base_reconstrucao_metodo || 'SEM_MEMORIA'; }
function alvo(linha) {
  const d = json(linha.dados);
  // Fase 2A: a regra legal de crédito do Simples é aplicada exclusivamente
  // às entradas de fornecedor Simples para adquirente regular. O predicado
  // usa operação + sentido + ambos os regimes; nunca apenas o fornecedor.
  if (process.argv.includes('--fase2a-simples-legal')) {
    return d.sentido === 'entrada'
      && d.regime_cbs_emitente === 'SIMPLES_DAS'
      && d.regime_cbs_adquirente === 'REGULAR';
  }
  // Correção semântica da saída: o Simples que permanece no DAS não toma
  // crédito integral. Somente o perfil separado "simples_regime_regular"
  // pode creditar. Reprocessa apenas vendas cujo destinatário é Simples.
  if (process.argv.includes('--simples-destinatario')) return d.sentido === 'saida' && d.regime_cbs_adquirente === 'SIMPLES_DAS';
  // Correção pontual posterior: o parâmetro de crédito CBS do Simples já
  // existe na fonte compartilhada, mas não estava na fotografia histórica.
  // Reprocessa somente entradas SIMPLES_DAS, sem tocar nas demais linhas.
  if (process.argv.includes('--simples')) return d.sentido === 'entrada' && d.regime_cbs_emitente === 'SIMPLES_DAS';
  // CBS-only: somente quem teve ISS/ICMS retirado pela metodologia integral
  // precisa ser recalculado. Demais resultados são reutilizados intactos.
  if (process.argv.includes('--cbs-only')) {
    const detalhe = json(d.detalhe);
    const tributos = detalhe.reconstrucao?.tributosAtuais || {};
    return Number(tributos.iss || 0) !== 0 || Number(tributos.icms || 0) !== 0;
  }
  return d.sentido === 'saida' && ['CUMULATIVIDADE_CONDICIONADA', 'SEM_CATALOGO'].includes(metodoDa(linha));
}
function categoriaPis(d) {
  const m = json(d.detalhe).reconstrucao?.memoriaPisCofins || {};
  if (m.base_reconstrucao_metodo === 'DOCUMENTO') return 'DOCUMENTO';
  if (['ALIQUOTA_ZERO', 'MONOFASICO_REVENDA_ZERO', 'CUMULATIVIDADE_OBRIGATORIA'].includes(m.base_reconstrucao_metodo)) return 'REGRA_ESPECIFICA';
  if (m.base_reconstrucao_metodo === 'REGRA_GERAL_REGIME' && Number(m.base_reconstrucao_percentual) === 0.0365) return 'REGRA_EMPRESA_3_65';
  if (m.carga_atual_pis_cofins_natureza === 'SIMULADO') return 'SIMULADO';
  if (m.carga_atual_pis_cofins_valor === null || m.carga_atual_pis_cofins_valor === undefined) return 'INDETERMINADO';
  return 'OUTRA_REGRA';
}
function resumo(linhas) {
  const out = { itens: linhas.length, saidas: 0, entradas: 0, venda: 0, base: 0, pis: 0, cofins: 0, iss: 0, icms: 0, cbs: 0, ibs: 0, creditosCbs: 0, projetada: 0, impacto: 0, distribuicao: {}, issAliquotas: {}, ibsDiferenteZero: 0 };
  for (const linha of linhas) {
    const d = json(linha.dados); if (d.sentido !== 'saida') { out.entradas++; out.creditosCbs += numero(d.credito_cbs); continue; }
    out.saidas++; out.venda += numero(d.preco_atual); out.base += numero(d.base_economica); out.cbs += numero(d.cbs); out.ibs += numero(d.ibs); out.projetada += numero(d.preco_projetado);
    const rec = json(d.detalhe).reconstrucao || {}; const t = rec.tributosAtuais || {};
    out.pis += numero(t.pis); out.cofins += numero(t.cofins); out.iss += numero(t.iss); out.icms += numero(t.icms); out.impacto += numero(d.preco_projetado) - numero(d.preco_atual);
    if (numero(d.ibs)) out.ibsDiferenteZero++;
    const cat = categoriaPis(d); if (!out.distribuicao[cat]) out.distribuicao[cat] = { quantidade: 0, venda: 0, pis: 0, cofins: 0 };
    const g = out.distribuicao[cat]; g.quantidade++; g.venda += numero(d.preco_atual); g.pis += numero(t.pis); g.cofins += numero(t.cofins);
    if (numero(t.iss)) { const a = r2(numero(t.iss) / numero(d.preco_atual)); out.issAliquotas[a] = (out.issAliquotas[a] || 0) + 1; }
  }
  for (const k of ['venda','base','pis','cofins','iss','icms','cbs','ibs','creditosCbs','projetada','impacto']) out[k] = r2(out[k]);
  for (const g of Object.values(out.distribuicao)) { g.venda = r2(g.venda); g.pis = r2(g.pis); g.cofins = r2(g.cofins); }
  return out;
}
function linhaNova(x, movimento, id, execucaoId) {
  const parceiro = db.prepare('SELECT * FROM parceiros WHERE empresa_id=? AND cnpj=? AND tipo=?').get(EMPRESA_ID, movimento.inscr_federal || '', movimento.tipo || '');
  const versoes = motorExec.versoesDaOperacao(movimento, parceiro);
  const dados = {
    id, empresa_id: EMPRESA_ID, movimento_id: movimento.id, execucao_id: execucaoId,
    sentido: x.sentido, ano: ANO, status_classificacao: x.classificacao.status, status_credito: x.credito.status, natureza: x.natureza,
    preco_atual: x.precoAtual, base_economica: x.baseEconomica, ibs: x.ibs, cbs: x.cbs,
    credito_ibs: x.creditoIbs, credito_cbs: x.creditoCbs, tipo_credito: x.credito.tipoCredito || null,
    modalidade_credito: x.credito.modalidadeCredito || null, status_credito_determinacao: x.credito.statusDeterminacao || null,
    movimento_hash: motorExec.hashMovimento(movimento), regra_version: versoes.regra_version, catalogo_version: versoes.catalogo_version,
    parceiro_version: versoes.parceiro_version, parametro_version: versoes.parametro_version, motor_version: 'motor-cbs-2026-08-25-base-economica-v2',
    regime_cbs_emitente: x.regimeCbsEmitente || null, regime_cbs_adquirente: x.regimeCbsAdquirente || null,
    preco_projetado: x.precoProjetado, custo_liquido: x.custoLiquido, cst: x.classificacao.cst, cclasstrib: x.classificacao.cclasstrib,
    tratamento: x.classificacao.tratamento, perfil_destinatario: x.destinatario?.perfil || null, sensibilidade: x.sensibilidade?.nivel || null,
    detalhe: JSON.stringify({ ...x, movimento_id: movimento.id, execucao_id: execucaoId }),
  };
  return { id, empresa_id: EMPRESA_ID, movimento_id: movimento.id, execucao_id: execucaoId, ativo: false, dados };
}

async function executar() {
  if (!process.argv.includes('--executar')) throw new Error('Confirmação ausente. Use --executar.');
  await operacao.baixarConfiguracao();
  if (process.argv.includes('--simples-destinatario')) {
    const simples = regras.regime('simples_nacional');
    if (!simples) throw new Error('Regime Simples Nacional não encontrado na configuração compartilhada.');
    if (simples.creditaNovo) {
      regras.salvarRegime('simples_nacional', { ...simples, creditaNovo: false }, 'homologacao-cbs-only');
      await operacao.publicarConfiguracao(['param_regimes']);
    }
  }
  const remoto = supabase.admin();
  const { data: ativos, error } = await remoto.from('motor_resultados_operacionais').select('*').eq('empresa_id', EMPRESA_ID).eq('ativo', true);
  if (error) throw error;
  if (!ativos?.length) throw new Error('Não existe fotografia ativa para a empresa.');
  const alvos = ativos.filter(alvo); const ids = alvos.map((x) => Number(x.movimento_id)).filter(Boolean);
  if (process.argv.includes('--fase2a-simples-legal') && !ids.length) {
    throw new Error('Nenhum dependente real da regra legal do Simples foi localizado; reprocessamento seletivo cancelado.');
  }
  const movimentos = db.prepare(`SELECT id FROM movimentos WHERE empresa_id=? AND id IN (${ids.map(() => '?').join(',')})`).all(EMPRESA_ID, ...ids);
  if (movimentos.length !== ids.length) throw new Error(`Base local não contém todos os alvos (${movimentos.length}/${ids.length}); operação cancelada.`);
  const pool = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  try {
    const [maxResultado, maxExecucao] = await Promise.all([
      pool.query('select coalesce(max(id),0) as id from public.motor_resultados_operacionais'),
      pool.query('select coalesce(max(id),0) as id from public.motor_execucoes_operacionais'),
    ]);
    const execucaoId = Number(maxExecucao.rows[0].id) + 1; let proximoId = Number(maxResultado.rows[0].id) + 1;
    const calculado = motorExec.executar(EMPRESA_ID, { ano: ANO, movimentoIds: ids, gravar: false });
    const porMovimento = new Map([...calculado.saidas, ...calculado.entradas].map((x) => [Number(x.movimento_id), x]));
    if (porMovimento.size !== ids.length) throw new Error(`Motor retornou ${porMovimento.size}/${ids.length} operações alvo; operação cancelada.`);
    const linhas = ativos.map((x) => ({ ...x, dados: json(x.dados), ativo: false }));
    for (let i = 0; i < linhas.length; i++) {
      const mov = Number(linhas[i].movimento_id); const novoId = proximoId++;
      if (porMovimento.has(mov)) {
        const movimento = db.prepare('SELECT * FROM movimentos WHERE id=?').get(mov);
        linhas[i] = linhaNova(porMovimento.get(mov), movimento, novoId, execucaoId);
      } else {
        // Uma nova fotografia precisa de novas chaves, mesmo para a parcela
        // reutilizada; assim a Execução 1 histórica nunca é sobrescrita.
        linhas[i] = { ...linhas[i], id: novoId, dados: { ...linhas[i].dados, id: novoId, execucao_id: execucaoId }, execucao_id: execucaoId, ativo: false };
      }
    }
    // Linhas intactas são reutilizadas sem recálculo, mas passam a compor a
    // nova fotografia completa e recebem o novo identificador de execução.
    for (const linha of linhas) {
      linha.dados = { ...linha.dados, id: linha.id, execucao_id: execucaoId };
      linha.execucao_id = execucaoId;
      linha.ativo = false;
    }
    const antes = resumo(ativos); const depois = resumo(linhas);
    const tipoHomologacao = process.argv.includes('--fase2a-simples-legal') ? 'REGRA_LEGAL_CREDITO_SIMPLES_SELETIVA'
      : process.argv.includes('--simples-destinatario') ? 'CREDITO_CLIENTE_SIMPLES_DAS'
      : process.argv.includes('--simples') ? 'CREDITO_CBS_SIMPLES'
      : process.argv.includes('--cbs-only') ? 'BASE_ECONOMICA_CBS_ONLY'
        : 'RECONSTRUCAO_BASE_ECONOMICA';
    const cabecalho = { id: execucaoId, empresa_id: EMPRESA_ID, ano: ANO, itens: linhas.length, classificados: 0, requer_validacao: 0, sem_correspondencia: 0,
      resumo: JSON.stringify({ homologacao: tipoHomologacao, execucao_anterior: Number(ativos[0]?.execucao_id) || null, reprocessados: ids.length, reutilizados: linhas.length - ids.length, antes, depois }), criado_em: new Date().toISOString() };
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query('insert into public.motor_execucoes_operacionais (id,empresa_id,dados) values ($1,$2,$3::jsonb)', [execucaoId, EMPRESA_ID, JSON.stringify(cabecalho)]);
      // Inserção em lotes: evita exceder o statement_timeout do Supabase com
      // centenas de comandos unitários, preservando a mesma transação.
      for (let inicio = 0; inicio < linhas.length; inicio += 120) {
        const lote = linhas.slice(inicio, inicio + 120); const valores = []; const parametros = [];
        lote.forEach((linha, indice) => {
          const p = indice * 5;
          valores.push(`($${p + 1},$${p + 2},$${p + 3},$${p + 4}::jsonb,$${p + 5},false)`);
          parametros.push(linha.id, EMPRESA_ID, linha.movimento_id, JSON.stringify(linha.dados), execucaoId);
        });
        await client.query(`insert into public.motor_resultados_operacionais
          (id,empresa_id,movimento_id,dados,execucao_id,ativo) values ${valores.join(',')}`, parametros);
      }
      await client.query('update public.motor_resultados_operacionais set ativo=false where empresa_id=$1 and ativo=true', [EMPRESA_ID]);
      await client.query('update public.motor_resultados_operacionais set ativo=true where empresa_id=$1 and execucao_id=$2', [EMPRESA_ID, execucaoId]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    console.log(JSON.stringify({ homologacao: tipoHomologacao, execucao_anterior: Number(ativos[0]?.execucao_id) || null, execucao_nova: execucaoId, total_operacoes: ativos.length, reprocessados: ids.length, reutilizados: ativos.length - ids.length, antes, depois }, null, 2));
  } finally { await pool.end(); }
}
if (require.main === module) executar().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
module.exports = { executar };
