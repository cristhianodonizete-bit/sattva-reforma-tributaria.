/**
 * Consolidações oficiais do diagnóstico.
 *
 * Esta camada NÃO calcula tributos. Ela somente lê a última execução do
 * motor gravada em motor_resultados e a apresenta por cliente, fornecedor ou
 * cadeia. Assim, telas e relatórios não podem criar uma segunda base,
 * classificação, CBS ou crédito por agregação paralela.
 */
const db = require('../db');
const motorExec = require('./motorExec');
const perfilCbs = require('./perfilCbs');
const elegibilidadeAnexoXi = require('./elegibilidadeAnexoXi');
const periodoAnalisado = require('./periodoAnalisado');
const receitaOperacional = require('./receitaOperacional');
const motor = require('../engine/motor');
const { simplesEfetivo } = require('../engine/reconstrucao');
const projecoesMovimentos = require('./projecoesMovimentos');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const r4 = (v) => Math.round(n(v) * 10000) / 10000;

// A fotografia do motor é imutável depois de gravada. Reaproveitar suas linhas
// já desserializadas evita que cada aba (cadeia, cenário e impacto) releia e
// faça JSON.parse de todos os detalhes. A chave contém a execução: qualquer
// reprocessamento produz nova execução e, portanto, nunca reutiliza resultado
// fiscal anterior. Mantemos poucas fotografias para limitar memória da instância.
const LIMITE_FOTOGRAFIAS_EM_MEMORIA = 12;
const linhasPorExecucao = new Map();
const linhasPorEscopo = new Map();
const cadeiasPorExecucao = new Map();
function guardarLinhas(empresaId, execucaoId, dados) {
  const chave = `${empresaId}:${execucaoId}`;
  linhasPorExecucao.set(chave, dados);
  for (const chaveExistente of [...linhasPorExecucao.keys()]) {
    if (chaveExistente !== chave && chaveExistente.startsWith(`${empresaId}:`)) linhasPorExecucao.delete(chaveExistente);
  }
  while (linhasPorExecucao.size > LIMITE_FOTOGRAFIAS_EM_MEMORIA) linhasPorExecucao.delete(linhasPorExecucao.keys().next().value);
  return dados;
}

// Uma tela analítica não pode combinar o cadastro vivo com o cálculo de uma
// execução anterior. Nome e regime apresentados nesta camada pertencem à
// própria fotografia do motor; a alteração do cadastro exige nova execução.
function invalidarCacheEmpresa(empresaId) {
  const prefixo = `${Number(empresaId)}:`;
  for (const chave of [...linhasPorExecucao.keys()]) if (chave.startsWith(prefixo)) linhasPorExecucao.delete(chave);
  for (const chave of [...linhasPorEscopo.keys()]) if (chave.startsWith(prefixo)) linhasPorEscopo.delete(chave);
  for (const chave of [...cadeiasPorExecucao.keys()]) if (chave.startsWith(prefixo)) cadeiasPorExecucao.delete(chave);
}

function ultimaExecucao(empresaId) {
  const fotografia=motorExec.fotografiaOficial(empresaId);
  return fotografia.status==='OK' ? fotografia.execucao : null;
}

function linhas(empresaId, opcoes = {}) {
  const execucao = ultimaExecucao(empresaId, opcoes);
  if (!execucao) return { execucao: null, linhas: [] };
  // Caminho legado desativado: nunca materialize uma execução inteira no
  // processo. Os consumidores ativos usam resumo(), listar() e detalhe(),
  // que aplicam escopo e limite no SQL. A resposta vazia é deliberada para
  // que qualquer chamada residual não consiga contornar essa garantia nem
  // derrubar a instância por OOM.
  return { execucao, periodo: periodoAnalisado.obter(empresaId), linhas: [] };
  // A leitura não inicia cálculo. Ela só materializa o estado de validade da
  // fotografia diante da fonte canônica atual; portanto uma decisão recém
  // confirmada deixa de usar o resultado antigo imediatamente, mesmo se o
  // worker estiver pendente ou tiver falhado.
  // Leitura analítica não reconcilia nem recalcula: consulta exclusivamente o
  // estado persistido publicado pelo fluxo incremental ou pela migração.
  const aplicarEscopo = (dados) => {
    const periodo = periodoAnalisado.obter(empresaId);
    const chavePeriodo = periodo ? `${periodo.competencia_inicio}:${periodo.competencia_fim}` : 'sem-periodo';
    const chaveEscopo = `${empresaId}:${execucao.id}:${opcoes.tipo || 'todos'}:${chavePeriodo}`;
    if (!linhasPorEscopo.has(chaveEscopo)) linhasPorEscopo.set(chaveEscopo, filtrarLinhasDoEscopo(dados, opcoes.tipo || null, periodo));
    while (linhasPorEscopo.size > LIMITE_FOTOGRAFIAS_EM_MEMORIA * 4) linhasPorEscopo.delete(linhasPorEscopo.keys().next().value);
    return { execucao, periodo, linhas: linhasPorEscopo.get(chaveEscopo) };
  };
  const chave = `${empresaId}:${execucao.id}`;
  const emMemoria = linhasPorExecucao.get(chave);
  if (emMemoria) return aplicarEscopo(emMemoria);
  const duplicadosRazao=motorExec.idsRazaoDuplicadosPorDocumento(empresaId);
  const dados = db.prepare(`WITH regime_base AS (
      SELECT mb.id,br.regime,
        ROW_NUMBER() OVER (PARTITION BY mb.id ORDER BY CASE WHEN br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mb.inscr_federal,''),'.',''),'/',''),'-',''),' ','') THEN 0 ELSE 1 END,br.ano DESC) AS posicao
      FROM movimentos mb
      JOIN base_regime br ON br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mb.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
        OR br.raiz=SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(mb.inscr_federal,''),'.',''),'/',''),'-',''),' ',''),1,8)
      WHERE mb.empresa_id=?
    )
    SELECT r.*, m.competencia, m.documento, m.chave, m.descricao, m.ncm, m.nbs, m.cfop, m.modelo_documento_fiscal,
      m.nome, m.inscr_federal, m.tipo AS tipo_movimento, m.origem AS origem_movimento,
      CASE WHEN EXISTS(SELECT 1 FROM enriquecimento_pis_cofins_evidencias e WHERE e.empresa_id=m.empresa_id AND e.movimento_id=m.id AND e.origem_evidencia='SPED_C175') THEN 'SPED_C175' ELSE '' END AS origem_evidencia_pis_cofins,
      -- O motor registra REGULAR quando só pode afirmar que o emitente está
      -- fora do Simples. Isso é suficiente para o cálculo CBS, mas não deve
      -- apagar Lucro Real ou Presumido já comprovado na base RFB. A base é
      -- consultada somente para completar um parceiro ainda "regular". A
      -- exceção é a pessoa vinda do Questor: ela prova o CNPJ, mas nasce com
      -- Simples como premissa, portanto a base por CNPJ/raiz tem precedência.
      -- Cadastro manual/específico continua tendo precedência.
      COALESCE(NULLIF(CASE
        WHEN UPPER(COALESCE(m.origem,'')) IN ('QUESTOR_RAZAO','QUESTOR_CONCILIACAO_ENTRADA')
          OR UPPER(COALESCE(p.origem,'')) IN ('QUESTOR_PESSOA_CONTRAPARTIDA','QUESTOR_PESSOA_HISTORICO')
          OR LOWER(COALESCE(p.regime,'')) IN ('','regular','regime_regular','indeterminado') THEN rb.regime
        ELSE p.regime
      END,''), NULLIF(p.regime,''), r.regime_cbs_emitente, 'indeterminado') AS regime_parceiro,
      p.descricao AS parceiro_cadastrado,
      COALESCE(d.valor,p.regime) AS regime_canonico_atual,
      pe.situacao AS situacao_projecao, pe.motivo AS motivo_projecao, pe.job_id AS job_atualizacao
    FROM motor_resultados r
    JOIN movimentos m ON m.id=r.movimento_id
    LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo
      AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=
          REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
    LEFT JOIN movimento_decisoes_fiscais d ON d.empresa_id=m.empresa_id AND d.movimento_id=m.id
      AND d.campo='REGIME_FORNECEDOR' AND d.revogado_em IS NULL
    LEFT JOIN regime_base rb ON rb.id=m.id AND rb.posicao=1
    LEFT JOIN projecoes_movimentos_estado pe ON pe.empresa_id=m.empresa_id AND pe.movimento_id=m.id
    WHERE r.empresa_id=?
  ORDER BY r.preco_atual DESC, r.id`).all(empresaId, empresaId).map((x) => {
    let detalhe = {}; try { detalhe = JSON.parse(x.detalhe || '{}'); } catch (_) { /* detalhe inválido vira pendência */ }
    const vencida = x.situacao_projecao && x.situacao_projecao !== projecoesMovimentos.ESTADOS.ATUAL;
    if (vencida) {
      // Nunca deixe uma fotografia vencida voltar a parecer vigente por meio
      // de um valor, detalhe ou total remanescente. A decisão canônica fica
      // disponível para a tela, enquanto o financeiro aguarda o delta.
      return {
        ...x,
        detalhe: { decisao_canonica: {
          parceiro: x.parceiro_cadastrado || x.nome || '',
          regime: x.regime_canonico_atual || x.regime_parceiro || 'indeterminado',
        }, atualizacao: { situacao:x.situacao_projecao, motivo:x.motivo_projecao || null, job_id:x.job_atualizacao || null } },
        parceiro_cadastrado: x.parceiro_cadastrado || x.nome || '',
        regime_parceiro: x.regime_canonico_atual || x.regime_parceiro || 'indeterminado',
        resultado_vigente:false,
        preco_atual:null, base_economica:null, ibs:null, cbs:null, credito_ibs:null, credito_cbs:null,
        preco_projetado:null, custo_liquido:null,
      };
    }
    // Quando a assinatura confere, a fotografia mantém o contexto histórico
    // exato que gerou o cálculo, inclusive para auditoria.
    return {
      ...x,
      detalhe,
      parceiro_cadastrado: detalhe.contraparte || x.parceiro_cadastrado || x.nome || '',
      regime_parceiro: detalhe.regimeEmitente || x.regime_cbs_emitente || x.regime_parceiro || 'indeterminado',
      resultado_vigente:true,
    };
  }).filter((x)=>!duplicadosRazao.has(Number(x.movimento_id)));
  return aplicarEscopo(guardarLinhas(empresaId, execucao.id, dados));
}

function filtrarLinhasDoEscopo(linhas, tipo, periodo) {
  const lado = tipo === 'fornecedor' ? 'fornecedor' : tipo === 'cliente' ? 'cliente' : null;
  return (linhas || []).filter((linha) => {
    if (periodo && !periodoAnalisado.noPeriodo(linha.competencia, periodo)) return false;
    if (lado === 'cliente' && linha.sentido !== 'saida') return false;
    if (lado === 'fornecedor' && linha.sentido !== 'entrada') return false;
    // Compatibilidade de fotografia: uma remessa fica rastreável no
    // documento, mas nunca pode reaparecer como compra ou crédito por ter
    // sido materializada antes da regra de CFOP atual.
    if (lado === 'fornecedor' && ['remessa','retorno_remessa'].includes(receitaOperacional.natureza({
      ...linha, tipo:linha.tipo_movimento || linha.tipo, origem:linha.origem_movimento || linha.origem,
    }))) return false;
    if (lado === 'fornecedor' || linha.sentido !== 'saida') return true;
    return receitaOperacional.compoeReceitaComEvidencia({
      ...linha, tipo: linha.tipo_movimento || linha.tipo, origem: linha.origem_movimento || linha.origem,
    });
  });
}

function natureza(linha) {
  const d = linha.detalhe || {};
  if (['REQUER_VALIDACAO', 'SEM_CORRESPONDENCIA'].includes(linha.status_classificacao)
    || ['DADOS_INSUFICIENTES', 'SUJEITO_VALIDACAO'].includes(linha.status_credito)) return 'INDETERMINADO';
  if (String(linha.natureza || d.natureza).toUpperCase() === 'SIMULADO') return 'SIMULADO';
  if (d.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_natureza === 'REAL') return 'REAL';
  return 'CALCULADO';
}

function leituraCreditoFornecedor(linha) {
  if (linha.status_credito_determinacao === 'INDETERMINADO' || linha.status_credito === 'DADOS_INSUFICIENTES') return 'Crédito indeterminado — requer evidência';
  if (linha.modalidade_credito === 'CONTRIBUICAO_ASSOCIATIVA_PRESUMIDA') return 'Sem crédito — contribuição associativa presumida';
  if (linha.status_credito === 'SEM_DIREITO') return 'Sem crédito — conclusão do motor';
  if (linha.status_credito_determinacao === 'DETERMINADO_POR_PREMISSA') return 'Crédito CBS estimado — premissa cadastrada';
  if (linha.tipo_credito === 'SIMPLES') return 'Crédito limitado CBS Simples';
  return 'Potencialmente relevante — crédito apropriável';
}

function leituraCliente(linha) {
  const s = linha.detalhe?.sensibilidade;
  if (s?.leitura) return s.leitura;
  if (linha.perfil_destinatario === 'b2c_pf') return 'Não aplicável — consumidor final';
  if (linha.perfil_destinatario === 'governo') return 'Preço cheio relevante — ente governamental';
  if (linha.status_credito === 'DADOS_INSUFICIENTES') return 'A validar';
  return 'Potencialmente relevante — B2B regular';
}

function grupoDaLinha(linha, lado) {
  // A fotografia histórica pode trazer códigos do motor (REGULAR,
  // SIMPLES_DAS) e o cadastro usa os códigos canônicos da aplicação. A
  // cadeia não pode transformar uma identidade conhecida em “desconhecida”
  // apenas por essa diferença de representação.
  const regime=normalizarRegimeFornecedor(linha.regime_parceiro);
  if (lado === 'cliente') {
    if (linha.cliente_diverso) return 'Clientes diversos (regime regular)';
    if (linha.perfil_destinatario === 'governo') return 'Governo';
    if (linha.perfil_destinatario === 'b2c_pf') return 'Pessoa Física';
    if (regime === 'simples_nacional') return 'Simples Nacional';
    if (regime === 'mei') return 'MEI';
  }
  return {
    lucro_real: 'Lucro Real', lucro_presumido: 'Lucro Presumido', regime_regular: 'Regular',
    simples_nacional: 'Simples Nacional', simples_regime_regular: 'Simples Nacional (regime regular IBS/CBS)',
    // MEI integra a leitura do Simples na carteira. O detalhe do fornecedor
    // continua mostrando MEI, sem criar um quinto agrupador concorrente.
    mei: 'Simples Nacional',
    pessoa_fisica: 'Pessoa Física (consumidor final)', orgao_publico: 'Governo', imune_isento: 'Imune / Isento',
  }[regime] || 'Perfil desconhecido';
}

function normalizarRegimeFornecedor(valor) {
  const codigo=String(valor || '').trim().toUpperCase();
  return {
    REGULAR:'regime_regular', REGIME_REGULAR:'regime_regular', LUCRO_REAL:'lucro_real', LUCRO_PRESUMIDO:'lucro_presumido',
    SIMPLES_DAS:'simples_nacional', SIMPLES_NACIONAL:'simples_nacional', SIMPLES_REGIME_REGULAR:'simples_nacional',
    MEI:'mei', NAO_CONTRIBUINTE:'regime_regular', NÃO_CONTRIBUINTE:'regime_regular',
  }[codigo] || String(valor || '').trim().toLowerCase() || 'indeterminado';
}

// A faixa vem da classificação já decidida pelo motor. Não inferimos alíquota
// zero pelo valor da CBS: Simples/MEI podem ter CBS zerada por outro motivo.
function faixaTributacao(linha) {
  const classificacao = linha.detalhe?.classificacao || {};
  // Quando o emitente permanece no Simples, a CBS é a parcela do DAS. A
  // eventual redução do catálogo do item não é um benefício de CBS aplicado
  // nessa operação e não pode separar a carteira como se o fosse.
  if (linha.detalhe?.emitenteNoDas === true) return { chave:'SIMPLES_DAS', label:'CBS no DAS · sem benefício' };
  const chave = String(classificacao.reducao || linha.tratamento || '').toLowerCase();
  const percentual = Number(classificacao.reducaoCbs ?? classificacao.reducao_cbs ?? null);
  if (chave === 'zero' || chave === 'reducao_100' || chave.includes('alíquota zero') || chave.includes('aliquota zero') || (Number.isFinite(percentual) && percentual >= 1)) {
    return { chave: 'ALIQUOTA_ZERO', label: 'Alíquota zero' };
  }
  if (Number.isFinite(percentual) && percentual > 0) {
    return { chave: `REDUCAO_${Math.round(percentual * 100)}`, label: `Redução de ${Math.round(percentual * 100)}%` };
  }
  const achado = chave.match(/reducao_(\d{1,3})/);
  if (achado) return { chave: `REDUCAO_${achado[1]}`, label: `Redução de ${Number(achado[1])}%` };
  return { chave: 'INTEGRAL', label: 'Base integral' };
}

// Leitura da regra já decidida e persistida pelo motor. Esta função não
// reclassifica nem recalcula CBS: torna auditável qualquer benefício que o
// motor efetivamente aplicou (reduções e alíquota zero), sem limitar a tela a
// um cClassTrib específico.
function leituraBeneficio(linha) {
  const detalhe = linha.detalhe || {};
  const classificacao = detalhe.classificacao || {};
  const elegibilidade = classificacao.elegibilidadeAnexoXi || {};
  const faixa = faixaTributacao(linha);
  if (['INTEGRAL','SIMPLES_DAS'].includes(faixa.chave) || ['REQUER_VALIDACAO', 'SEM_CORRESPONDENCIA'].includes(linha.status_classificacao)) return null;

  const aliquota = detalhe.aliquotas || {};
  // Fotografias anteriores do motor guardam a redução como "reducao_60".
  // As atuais podem trazer o percentual explícito. A cadeia precisa aceitar
  // ambos, sem inferir um benefício novo a partir do valor de CBS.
  const reducaoInformada = Number(classificacao.reducaoCbs ?? classificacao.reducao_cbs);
  const reducaoDaFaixa = /^REDUCAO_(\d{1,3})$/.exec(faixa.chave);
  const reducao = faixa.chave === 'ALIQUOTA_ZERO'
    ? 1
    : (Number.isFinite(reducaoInformada) && reducaoInformada > 0
      ? reducaoInformada
      : (reducaoDaFaixa ? Number(reducaoDaFaixa[1]) / 100 : 0));
  const aliquotaReferencia = Number(aliquota.aliquotaReferencia?.cbs);
  const base = n(linha.base_economica);
  const cbsSemReducao = Number.isFinite(aliquotaReferencia) ? base * aliquotaReferencia : null;
  const candidato = (classificacao.candidatos || []).find((x) => String(x.cclasstrib) === String(classificacao.cclasstrib || '')) || {};
  const socio = elegibilidade.socio || {};

  return {
    movimento_id: linha.movimento_id,
    documento: linha.documento || linha.chave || '',
    competencia: linha.competencia || null,
    cliente: linha.parceiro_cadastrado || linha.nome || detalhe.contraparte || '',
    cnpj: linha.inscr_federal || '',
    descricao: linha.descricao || detalhe.descricao || '',
    // Mercadorias são rastreadas pelo NCM. LC 116/NBS só devem ser exibidos
    // quando a operação for efetivamente um serviço.
    ncm: linha.ncm || detalhe.ncm || candidato.ncm || '',
    lc116: candidato.lc116 || '',
    nbs: linha.nbs || candidato.nbs || '',
    valor: r2(linha.preco_atual),
    baseEconomica: r2(base),
    cbs: r2(linha.cbs),
    reducaoCbs: reducao,
    aliquotaCbsReferencia: Number.isFinite(aliquotaReferencia) ? aliquotaReferencia : null,
    aliquotaCbsEfetiva: Number.isFinite(Number(aliquota.cbs)) ? Number(aliquota.cbs) : null,
    cbsSemReducao: cbsSemReducao === null ? null : r2(cbsSemReducao),
    diferencaReducaoCbs: cbsSemReducao === null ? null : r2(cbsSemReducao - n(linha.cbs)),
    cclasstrib: classificacao.cclasstrib || candidato.cclasstrib || '',
    cst: classificacao.cst || candidato.cst || '',
    beneficio: faixa.label,
    fundamentoCatalogo: classificacao.fundamentoLegal || candidato.fundamento || classificacao.anexo || 'Fundamento registrado no catálogo fiscal versionado.',
    anexo: classificacao.anexo || candidato.anexo || '',
    fundamentosMotor: classificacao.fundamentos || [],
    qsa: {
      status: elegibilidade.status_qsa,
      socio: socio.nome || '',
      participacao: socio.percentual_participacao ?? null,
      brasileiro: Number(socio.brasileiro) === 1,
      fonte: socio.fonte || '',
      consultadoEm: socio.consultado_em || '',
      motivo: elegibilidade.motivo || '',
    },
  };
}

// Mantida para compatibilidade com consumidores e testes anteriores. A regra
// específica continua exigindo a evidência societária confirmada.
function leitura200044(linha) {
  const classificacao = linha.detalhe?.classificacao || {};
  if (String(classificacao.cclasstrib || '') !== '200044' || classificacao.elegibilidadeAnexoXi?.status_qsa !== 'SIM') return null;
  return leituraBeneficio(linha);
}

// O PGDAS pode já ter sido extraído, mas ainda aguardar confirmação humana.
// Para a projeção (que nunca altera o documento), a linha identificada de
// locação pode servir como memória provisória do DAS. O Perfil Tributário
// confirmado sempre prevalece quando disponível.
function memoriaPgdasExtraidaLocacao(empresaId) {
  const documentos = db.prepare(`SELECT id,competencia_detectada,status_processamento FROM pgdas_documentos
    WHERE empresa_id=? AND status_processamento IN ('REQUER_VALIDACAO','REVIEW_REQUIRED','VALIDADO_USUARIO')
      AND COALESCE(competencia_detectada,'')<>'' ORDER BY id DESC`).all(empresaId);
  if (!documentos.length) return new Map();
  const ids = documentos.map((x) => x.id);
  const campos = db.prepare(`SELECT documento_id,campo,valor_extraido FROM pgdas_documento_campos
    WHERE documento_id IN (${ids.map(() => '?').join(',')})`).all(...ids);
  const porDocumento = new Map(documentos.map((x) => [x.id, {}]));
  for (const campo of campos) porDocumento.get(campo.documento_id)[campo.campo] = campo.valor_extraido;
  const porCompetencia = new Map();
  for (const documento of documentos) {
    if (porCompetencia.has(documento.competencia_detectada)) continue;
    const bruto = porDocumento.get(documento.id) || {};
    let blocos = [];
    try { blocos = JSON.parse(bruto.revenue_blocks || '[]'); } catch (_) { continue; }
    const locacao = blocos.find((x) => x.activity_group === 'LOCACAO' && x.anexo === 'III'
      && Number(x.revenue_amount) > 0 && Number(x.taxes?.total) > 0);
    if (!locacao) continue;
    const pisCofins = n(locacao.taxes?.pis) + n(locacao.taxes?.cofins);
    if (pisCofins <= 0) continue;
    porCompetencia.set(documento.competencia_detectada, {
      receita: n(locacao.revenue_amount), das: n(locacao.taxes.total), cbs: pisCofins,
      rbt12: n(bruto.rbt12),
      // A confirmação é a evidência mais forte. Ela continua disponível
      // mesmo que a materialização do Perfil ainda não tenha sido restaurada
      // na instância atual após um reinício.
      origem: documento.status_processamento === 'VALIDADO_USUARIO'
        ? 'PGDAS_CONFIRMADO' : 'PGDAS_EXTRAIDO_PENDENTE_VALIDACAO',
    });
  }
  return porCompetencia;
}

// Receitas sem DF-e não possuem destinatário. Elas precisam aparecer na
// Cadeia de Clientes para que a carteira represente toda a receita, porém sem
// inventar um cliente ou crédito para terceiro. A convenção é um parceiro
// técnico único, enquadrado como regime regular e sem crédito potencial.
function outrasReceitasDaCadeiaCliente(empresaId, periodo, ano) {
  const empresa = db.prepare('SELECT regime,faturamento_anual FROM empresas WHERE id=?').get(empresaId) || {};
  const regimeEmpresa = empresa.regime || '';
  const linhas = db.prepare(`SELECT * FROM receitas_sem_dfe
    WHERE empresa_id=? AND COALESCE(status_validacao,'PENDENTE')<>'POSSIVEL_DUPLICIDADE'`).all(empresaId)
    .filter((x) => !periodo || periodoAnalisado.noPeriodo(x.competencia, periodo));
  const perfilPorCompetencia = new Map();
  for (const perfil of db.prepare(`SELECT competencia,receita_bruta,pis,cofins,das,origem FROM perfil_tributario
    WHERE empresa_id=? AND COALESCE(competencia,'')<>'' ORDER BY id DESC`).all(empresaId)) {
    if (!perfilPorCompetencia.has(perfil.competencia)) perfilPorCompetencia.set(perfil.competencia, perfil);
  }
  const pgdasExtraidoPorCompetencia = memoriaPgdasExtraidaLocacao(empresaId);
  return linhas.map((x) => {
    const classificacao = {
      cst: x.cst_motor || '000', cclasstrib: x.cclasstrib_motor || '000001',
      reducao: null, reducaoCbs: 0, reducaoIbs: 0,
      origemRegra: x.fundamento_motor || 'Regra técnica de outras receitas',
      tratamento: x.regra_motor_reforma || 'Tributação normal',
    };
    const aliquotas = motor.aliquotasEfetivas(ano, classificacao);
    // PIS/Cofins é apurado pelo regime da empresa vendedora, não pelo perfil
    // técnico “regime regular” usado quando não há cliente identificado.
    const regraAtual = x.item_receita_chave ? db.prepare(`SELECT * FROM regras_itens_receita_regime
      WHERE item_chave=? AND regime_empresa=? AND ativo=1
        AND vigencia_inicio<=? AND (vigencia_fim IS NULL OR vigencia_fim>=?)
      ORDER BY vigencia_inicio DESC LIMIT 1`).get(x.item_receita_chave, regimeEmpresa, `${x.competencia}-01`, `${x.competencia}-01`) : null;
    const valor = n(x.valor);
    const pisInformado = x.pis_atual !== null && x.pis_atual !== undefined && x.cofins_atual !== null && x.cofins_atual !== undefined;
    const regraComAliquota = regraAtual?.pis_percentual !== null && regraAtual?.pis_percentual !== undefined && regraAtual?.cofins_percentual !== null && regraAtual?.cofins_percentual !== undefined;
    const pisCofins = pisInformado ? n(x.pis_atual) + n(x.cofins_atual)
      : regraComAliquota ? valor * (n(regraAtual.pis_percentual) + n(regraAtual.cofins_percentual)) : null;
    const noDas = !pisInformado && !regraComAliquota && ['simples_nacional', 'mei'].includes(regimeEmpresa);
    const cbs = r2(valor * n(aliquotas.cbs)), ibs = r2(valor * n(aliquotas.ibs));
    const perfilDas = perfilPorCompetencia.get(String(x.competencia || ''));
    const pgdasExtraido = pgdasExtraidoPorCompetencia.get(String(x.competencia || ''));
    const receitaDaCompetencia = n(perfilDas?.receita_bruta);
    const componenteCbsPerfil = n(perfilDas?.pis) + n(perfilDas?.cofins);
    const dasPerfilDisponivel = receitaDaCompetencia > 0 && n(perfilDas?.das) > 0;
    // Locações de bens móveis no Simples são, em regra, Anexo III. Quando a
    // guia/PGDAS da competência ainda não está na base, usa-se o RBT12 já
    // cadastrado para projetar o DAS e sua repartição, sempre identificado
    // como estimativa. Locação de imóvel próprio não recebe esta presunção.
    const podeEstimarAnexoIII = x.item_receita_chave === 'LOCACAO_BENS_MOVEIS';
    const simplesEstimado = noDas && podeEstimarAnexoIII && n(empresa.faturamento_anual) > 0
      ? simplesEfetivo('III', n(empresa.faturamento_anual), motor.anexosSimples()) : null;
    const aliquotaCbsDoDas = n(simplesEstimado?.reparticao?.pis) + n(simplesEstimado?.reparticao?.cofins);
    let dasAtualDaVenda = 0, cbsDentroDoDas = 0, origemCbsDentroDoDas = 'NAO_APLICAVEL';
    if (noDas && dasPerfilDisponivel) {
      dasAtualDaVenda = r2(valor / receitaDaCompetencia * n(perfilDas.das));
      if (componenteCbsPerfil > 0) {
        cbsDentroDoDas = r2(valor / receitaDaCompetencia * componenteCbsPerfil);
        origemCbsDentroDoDas = String(perfilDas?.origem || '').includes('pgdas') ? 'PGDAS_IMPORTADO' : 'APURACAO_PERFIL';
      } else if (simplesEstimado) {
        cbsDentroDoDas = r2(dasAtualDaVenda * aliquotaCbsDoDas);
        origemCbsDentroDoDas = 'DAS_IMPORTADO_REPARTICAO_ANEXO_III';
      } else origemCbsDentroDoDas = 'A_VALIDAR';
    } else if (noDas && pgdasExtraido && pgdasExtraido.receita > 0) {
      dasAtualDaVenda = r2(valor / pgdasExtraido.receita * pgdasExtraido.das);
      cbsDentroDoDas = r2(valor / pgdasExtraido.receita * pgdasExtraido.cbs);
      origemCbsDentroDoDas = pgdasExtraido.origem;
    } else if (noDas && simplesEstimado) {
      dasAtualDaVenda = r2(valor * n(simplesEstimado.aliquotaEfetiva));
      cbsDentroDoDas = r2(dasAtualDaVenda * aliquotaCbsDoDas);
      origemCbsDentroDoDas = 'ESTIMATIVA_RBT12_ANEXO_III';
    } else if (noDas) origemCbsDentroDoDas = 'A_VALIDAR';
    const dasResidualHibrido = noDas ? Math.max(0, r2(dasAtualDaVenda - cbsDentroDoDas)) : 0;
    const impactoHibridoLiquido = noDas ? r2(cbs + ibs - cbsDentroDoDas) : r2(cbs + ibs);
    return {
      movimento_id: `receita-sem-dfe:${x.id}`, sentido:'saida', competencia:x.competencia,
      documento: x.identificador_origem ? `Questor ${x.identificador_origem}` : 'Receita sem DF-e',
      descricao: x.descricao || x.tipo_receita || 'Outra receita', nome:'Clientes diversos', inscr_federal:'', cliente_diverso:true,
      regime_parceiro:'regime_regular', perfil_destinatario:'b2b_regular', preco_atual:valor,
      base_economica:valor, cbs, ibs, preco_projetado:r2(valor + impactoHibridoLiquido), custo_liquido:valor,
      credito_cbs:0, credito_ibs:0, status_credito:'SEM_DIREITO', status_credito_determinacao:'NAO_APLICAVEL',
      natureza:'CALCULADO', fonte:'OUTRAS_RECEITAS',
      detalhe:{ contraparte:'Clientes diversos', classificacao, aliquotas,
        cbsDentroDoDas, dasAtualDaVenda, dasResidualHibrido, impactoHibridoLiquido, origemCbsDentroDoDas,
        reconstrucao:{ memoriaPisCofins:{ carga_atual_pis_cofins_valor:noDas ? 0 : pisCofins, carga_atual_pis_cofins_origem:noDas ? 'DAS' : pisCofins === null ? 'INDETERMINADO' : pisInformado ? 'LANCAMENTO_QUESTOR' : 'REGRA_TECNICA_POR_REGIME' } },
        sensibilidade:{ leitura:'Sem cliente identificado — crédito potencial não atribuído.' } },
    };
  });
}

function cadeiaLegadaInacessivel(empresaId, tipo, opcoes = {}) {
  const lado = tipo === 'cliente' ? 'cliente' : 'fornecedor';
  const sentido = lado === 'cliente' ? 'saida' : 'entrada';
  const regimeEmpresa = db.prepare('SELECT regime FROM empresas WHERE id=?').get(empresaId)?.regime || '';
  const base = linhas(empresaId, { ...opcoes, tipo });
  const chavePeriodo = base.periodo ? `${base.periodo.competencia_inicio}:${base.periodo.competencia_fim}` : 'sem-periodo';
  const leituraResumo = opcoes.incluirDetalhes === false && opcoes.incluirBeneficios !== true
    && Number(opcoes.paginaParceiros || 1) === 1 && Number(opcoes.paginaDetalhes || 1) === 1;
  // Nunca reutilizar uma agregação persistida: em workers efêmeros o id local
  // da execução pode reiniciar em 1, fazendo uma fotografia antiga parecer
  // atual. A cadeia é sempre agregada dos resultados canônicos restaurados.
  const adicionais = lado === 'cliente' ? outrasReceitasDaCadeiaCliente(empresaId, base.periodo, base.execucao?.ano || 2027) : [];
  const marcaAdicionais = adicionais.map((x) => `${x.movimento_id}:${x.preco_atual}`).join('|');
  const chaveFiltrosDetalhes=[opcoes.filtroDocumento,opcoes.filtroParceiro,opcoes.filtroRegime,opcoes.filtroServico,opcoes.ordenarDetalhes,opcoes.direcaoDetalhes]
    .map((valor)=>String(valor || '').trim().toLowerCase()).join('|');
  const chaveCache = `${empresaId}:${base.execucao?.id || 'sem-execucao'}:${chavePeriodo}:${tipo}:${marcaAdicionais}:${opcoes.incluirDetalhes === false ? 0 : 1}:${opcoes.incluirBeneficios === true ? 1 : 0}:${opcoes.paginaDetalhes || 1}:${opcoes.limiteDetalhes || 100}:${opcoes.paginaParceiros || 1}:${opcoes.limiteParceiros || 100}:${chaveFiltrosDetalhes}`;
  const cadeiaEmMemoria = cadeiasPorExecucao.get(chaveCache);
  if (cadeiaEmMemoria) return cadeiaEmMemoria;
  // Outras receitas seguem a regra de "Clientes diversos" em regime regular:
  // entram na cadeia como contraparte consolidada, sem atribuir um cliente
  // específico que não existe na origem.
  const itens = [...base.linhas.filter((x) => x.sentido === sentido), ...adicionais];
  // Pendência não pode apagar a parte já determinada da carga histórica.
  // Mantemos um recorte compacto, completo e somente-leitura para a tela
  // explicar exatamente quais documentos impedem a conclusão do total.
  const pendenciasPisCofins = itens
    .filter((x) => x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_valor === null
      || x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_valor === undefined)
    .map((x) => {
      const memoria = x.detalhe?.reconstrucao?.memoriaPisCofins || {};
      const pendencias = x.detalhe?.reconstrucao?.pendencias || [];
      return {
        movimento_id: x.movimento_id,
        documento: x.documento || x.chave || '',
        competencia: x.competencia || null,
        parceiro: x.parceiro_cadastrado || x.nome || x.detalhe?.contraparte || '',
        cnpj: x.inscr_federal || '',
        regimeEmitente: x.detalhe?.regimeEmitente || x.regime_cbs_emitente || null,
        descricao: x.descricao || '',
        valor: r2(x.preco_atual),
        origem: memoria.carga_atual_pis_cofins_origem || 'INDETERMINADO',
        motivo: memoria.base_reconstrucao_metodo
          ? `PIS/COFINS: ${memoria.base_reconstrucao_metodo}${memoria.fundamento ? ` — ${memoria.fundamento}` : ''}`
          : pendencias.join(' ') || 'Sem carga histórica de PIS/Cofins determinada na fotografia do motor.',
      };
    })
    .sort((a, b) => String(a.competencia || '').localeCompare(String(b.competencia || ''))
      || String(a.documento || '').localeCompare(String(b.documento || '')));
  const resumoPendenciasPisCofins = {
    registros: pendenciasPisCofins.length,
    valor: r2(pendenciasPisCofins.reduce((s, x) => s + n(x.valor), 0)),
  };
  const resumoOutrasReceitas = adicionais.reduce((s, x) => ({
    registros: s.registros + 1,
    valor: r2(s.valor + n(x.preco_atual)),
    cbs: r2(s.cbs + n(x.cbs)),
  }), { registros: 0, valor: 0, cbs: 0 });
  const porParceiro = new Map(), porGrupo = new Map();
  const total = { registros: itens.length, valor: 0, baseEconomica: 0, cbs: 0, ibs: 0, cbsDentroDoDas: 0, ibsDentroDoDas: 0, tributosSubstituidosDoDas: 0, dasAtual: 0, dasResidualHibrido: 0, precoFinal: 0, custoLiquido: 0, credito: 0, pisCofinsAtual: 0, pisIndeterminado: false, dasHibridoPendente: false, dasHibridoProvisorio: false };

  const acumular = (destino, x) => {
    const d = x.detalhe || {}; const rec = d.reconstrucao || {};
    const pis = rec.memoriaPisCofins?.carga_atual_pis_cofins_valor;
    destino.itens = (destino.itens || 0) + 1;
    destino.valor = n(destino.valor) + n(x.preco_atual);
    destino.baseEconomica = n(destino.baseEconomica) + n(x.base_economica);
    destino.ibs = n(destino.ibs) + n(x.ibs);
    destino.cbs = n(destino.cbs) + n(x.cbs);
    destino.cbsDentroDoDas = n(destino.cbsDentroDoDas) + n(d.cbsDentroDoDas);
    destino.ibsDentroDoDas = n(destino.ibsDentroDoDas) + n(d.ibsDentroDoDas);
    destino.tributosSubstituidosDoDas = n(destino.tributosSubstituidosDoDas) + n(d.tributosSubstituidosDoDas);
    destino.dasAtual = n(destino.dasAtual) + n(d.dasAtualDaVenda);
    destino.dasResidualHibrido = n(destino.dasResidualHibrido) + n(d.dasResidualHibrido);
    destino.precoFinal = n(destino.precoFinal) + n(x.preco_projetado);
    destino.custoLiquido = n(destino.custoLiquido) + n(x.custo_liquido);
    // O débito CBS da saída existe independentemente do perfil do destinatário.
    // Já o crédito potencial é lido do resultado oficial de crédito: para PF e
    // perfis sem direito, ele permanece zero sem apagar a CBS da venda.
    destino.creditoPotencial = n(destino.creditoPotencial) + n(x.credito_cbs) + n(x.credito_ibs);
    destino.creditoFinal = n(destino.creditoFinal) + n(x.credito_cbs) + n(x.credito_ibs);
    destino.pisCofinsAtual = n(destino.pisCofinsAtual) + n(pis);
    destino.pisIndeterminado = Boolean(destino.pisIndeterminado || pis === null || pis === undefined);
    destino.pisCofinsNoDas = Boolean(destino.pisCofinsNoDas || rec.memoriaPisCofins?.carga_atual_pis_cofins_origem === 'DAS');
    destino.dasHibridoPendente = Boolean(destino.dasHibridoPendente || d.origemCbsDentroDoDas === 'A_VALIDAR');
    destino.dasHibridoProvisorio = Boolean(destino.dasHibridoProvisorio || d.origemCbsDentroDoDas === 'PGDAS_EXTRAIDO_PENDENTE_VALIDACAO');
    destino.naturezas = destino.naturezas || new Set(); destino.naturezas.add(natureza(x));
    destino.statusCredito = destino.statusCredito || new Set(); destino.statusCredito.add(x.status_credito_determinacao || x.status_credito || 'INDETERMINADO');
  };

  for (const x of itens) {
    const clienteDiverso = Boolean(x.cliente_diverso);
    const chave = clienteDiverso ? 'clientes-diversos' : (x.inscr_federal || x.nome || `movimento:${x.movimento_id}`);
    const nome = x.parceiro_cadastrado || x.nome || x.detalhe?.contraparte || 'Sem identificação';
    if (!porParceiro.has(chave)) porParceiro.set(chave, { chave, cnpj: x.inscr_federal || '', nome, regime: normalizarRegimeFornecedor(x.regime_parceiro), regimeLabel: grupoDaLinha(x, lado), parceiros: 1, clienteDiverso });
    acumular(porParceiro.get(chave), x);
    const grupo = grupoDaLinha(x, lado);
    const faixa = faixaTributacao(x);
    const chaveGrupo = `${grupo}::${faixa.chave}`;
    if (!porGrupo.has(chaveGrupo)) porGrupo.set(chaveGrupo, { label: grupo, faixaTributacao: faixa.label, faixaOrdem: faixa.chave, regime: normalizarRegimeFornecedor(x.regime_parceiro), parceirosSet: new Set(), clienteDiverso });
    const g = porGrupo.get(chaveGrupo); g.parceirosSet.add(chave); g.clienteDiverso = Boolean(g.clienteDiverso || clienteDiverso); acumular(g, x);
    acumular(total, x);
  }

  // `_linha` é usada apenas para compor a leitura agregada abaixo. Nunca é
  // parte do contrato da API: ela referencia o resultado completo do motor e
  // multiplicava centenas de memórias JSON no payload da cadeia.
  const finalizar = (x) => {
    const { _linha, ...agregado } = x;
    return { ...agregado,
    valor: r2(x.valor), baseEconomica: r2(x.baseEconomica), ibs: r2(x.ibs), cbs: r2(x.cbs), cbsDentroDoDas: r2(x.cbsDentroDoDas), ibsDentroDoDas: r2(x.ibsDentroDoDas), tributosSubstituidosDoDas: r2(x.tributosSubstituidosDoDas), dasAtual: r2(x.dasAtual), dasResidualHibrido: r2(x.dasResidualHibrido), precoFinal: r2(x.precoFinal), custoLiquido: r2(x.custoLiquido),
    creditoPotencial: r2(x.creditoPotencial), creditoFinal: r2(x.creditoFinal), pisCofinsAtual: r2(x.pisCofinsAtual), pisCofinsNoDas:Boolean(x.pisCofinsNoDas), dasHibridoPendente:Boolean(x.dasHibridoPendente), dasHibridoProvisorio:Boolean(x.dasHibridoProvisorio),
    impactoOperacao: r2(n(x.precoFinal) - n(x.valor)), impactoOperacaoPerc: x.valor ? r4((n(x.precoFinal) - n(x.valor)) / n(x.valor)) : null,
    relevanciaCreditoCliente: lado === 'cliente' ? leituraCliente(x._linha || {}) : leituraCreditoFornecedor(x._linha || {}),
    natureza: x.naturezas?.has('INDETERMINADO') ? 'INDETERMINADO' : x.naturezas?.has('SIMULADO') ? 'SIMULADO' : x.naturezas?.has('REAL') ? 'REAL' : 'CALCULADO',
    };
  };
  // A leitura é fixa por grupo/parceiro a partir da primeira operação apenas; status agregado segue visível no drill-down.
  for (const x of porParceiro.values()) x._linha = itens.find((i) => (i.inscr_federal || i.nome || `movimento:${i.movimento_id}`) === x.chave);
  for (const x of porGrupo.values()) x._linha = itens.find((i) => grupoDaLinha(i, lado) === x.label && faixaTributacao(i).chave === x.faixaOrdem);
  const parceiros = [...porParceiro.values()].map(finalizar).sort((a, b) => b.valor - a.valor);
  let acumulado = 0;
  for (const p of parceiros) { p.representatividade = total.valor ? r4(p.valor / total.valor) : 0; acumulado += p.representatividade; p.acumulado = r4(acumulado); p.classeAbc = acumulado <= .8 ? 'A' : acumulado <= .95 ? 'B' : 'C'; }
  const ordemFaixa = { INTEGRAL: 0, REDUCAO_30: 1, REDUCAO_40: 2, REDUCAO_60: 3, ALIQUOTA_ZERO: 4 };
  const regimes = [...porGrupo.values()].map((x) => ({ ...finalizar(x), parceiros: x.parceirosSet.size, representatividade: total.valor ? r4(x.valor / total.valor) : 0 }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR') || (ordemFaixa[a.faixaOrdem] ?? 99) - (ordemFaixa[b.faixaOrdem] ?? 99) || b.valor - a.valor);
  // O detalhamento é apenas drill-down. Totais, parceiros e regimes acima
  // continuam sendo calculados sobre todas as operações; não há corte fiscal.
  // Evita transferir e montar centenas de memórias JSON quando a tela não está
  // na aba de rastreabilidade.
  const incluirDetalhes = opcoes.incluirDetalhes !== false;
  const normalizarBusca=(valor)=>String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const filtroDocumento=normalizarBusca(opcoes.filtroDocumento), filtroParceiro=normalizarBusca(opcoes.filtroParceiro);
  const filtroRegime=normalizarBusca(opcoes.filtroRegime), filtroServico=normalizarBusca(opcoes.filtroServico);
  const valorOrdenacao=(x,campo)=>({
    documento:String(x.documento || x.chave || ''),
    fornecedor:String(x.parceiro_cadastrado || x.nome || x.detalhe?.contraparte || ''),
    regime:String(x.detalhe?.regimeEmitente || x.regime_cbs_emitente || ''),
    servico:String(x.descricao || x.nbs || x.lc116 || ''),
    competencia:String(x.competencia || ''),
    valor:Number(x.preco_atual || 0),
  }[campo] ?? String(x.competencia || ''));
  const campoOrdenacao=['documento','fornecedor','regime','servico','competencia','valor'].includes(String(opcoes.ordenarDetalhes || '')) ? String(opcoes.ordenarDetalhes) : 'competencia';
  const fatorOrdenacao=String(opcoes.direcaoDetalhes || 'desc').toLowerCase()==='asc' ? 1 : -1;
  const itensDetalhados=itens.filter((x)=>{
    const documento=normalizarBusca(`${x.documento || ''} ${x.chave || ''}`);
    const parceiro=normalizarBusca(`${x.parceiro_cadastrado || ''} ${x.nome || ''} ${x.detalhe?.contraparte || ''} ${x.inscr_federal || ''}`);
    const regime=normalizarBusca(`${x.detalhe?.regimeEmitente || ''} ${x.regime_cbs_emitente || ''}`);
    const servico=normalizarBusca(`${x.descricao || ''} ${x.nbs || ''} ${x.lc116 || ''} ${x.ncm || ''}`);
    return (!filtroDocumento || documento.includes(filtroDocumento)) && (!filtroParceiro || parceiro.includes(filtroParceiro))
      && (!filtroRegime || regime.includes(filtroRegime)) && (!filtroServico || servico.includes(filtroServico));
  }).sort((a,b)=>{
    const av=valorOrdenacao(a,campoOrdenacao), bv=valorOrdenacao(b,campoOrdenacao);
    const comparacao=typeof av==='number' && typeof bv==='number' ? av-bv : String(av).localeCompare(String(bv),'pt-BR',{numeric:true,sensitivity:'base'});
    return comparacao*fatorOrdenacao || (Number(a.movimento_id || 0)-Number(b.movimento_id || 0))*fatorOrdenacao;
  });
  const limiteDetalhes = Math.min(500, Math.max(1, Number(opcoes.limiteDetalhes) || 100));
  const paginasDetalhes = Math.max(1, Math.ceil(itensDetalhados.length / limiteDetalhes));
  const paginaDetalhes = Math.min(paginasDetalhes, Math.max(1, Number(opcoes.paginaDetalhes) || 1));
  const inicioDetalhes = (paginaDetalhes - 1) * limiteDetalhes;
  const detalhes = (incluirDetalhes ? itensDetalhados.slice(inicioDetalhes, inicioDetalhes + limiteDetalhes) : []).map((x) => ({
    // A referência revela a natureza efetivamente analisada pelo motor. NCM
    // (ou tributos próprios de mercadoria) não pode ser apresentado como
    // serviço só porque a tela de rastreabilidade é comum aos dois tipos.
    tipoFiscal: x.ncm || n(x.detalhe?.reconstrucao?.tributosAtuais?.icms) > 0 || n(x.detalhe?.reconstrucao?.tributosAtuais?.ipi) > 0 ? 'PRODUTO' : (x.nbs || x.lc116 ? 'SERVICO' : 'A_CLASSIFICAR'),
    movimento_id: x.movimento_id, documento: x.documento || x.chave || '', parceiro: x.parceiro_cadastrado || x.nome || x.detalhe?.contraparte || '', cnpj: x.inscr_federal || '',
    // O regime é uma informação da fotografia do motor. Expô-lo na
    // rastreabilidade torna visível a premissa que determina a regra geral
    // de PIS/Cofins, sem deduzir nem modificar cadastro de fornecedor.
    regimeEmitente: x.detalhe?.regimeEmitente || x.regime_cbs_emitente || null,
    produto: x.descricao || '', ncm: x.ncm || '', nbs: x.nbs || '', lc116: x.lc116 || '', cfop: x.cfop || '', competencia: x.competencia || null,
    // A origem do fato é distinta da origem da base econômica: identifica a
    // entrada que nasceu de uma inclusão confirmada na conciliação Questor.
    origemMovimento: x.origem_movimento || x.origem || null,
    statusClassificacao: x.status_classificacao || x.detalhe?.classificacao?.status || 'INDETERMINADO', classificacaoOrigem:x.detalhe?.classificacao?.origemRegra || '', cclasstrib: x.cclasstrib || x.detalhe?.classificacao?.cclasstrib || '', cst: x.cst || x.detalhe?.classificacao?.cst || '',
    valor: r2(x.preco_atual), valorSemImposto: r2(x.base_economica), ibs: r2(x.ibs), cbs: r2(x.cbs), cbsDentroDoDas: r2(x.detalhe?.cbsDentroDoDas), origemCbsDentroDoDas: x.detalhe?.origemCbsDentroDoDas || 'NAO_APLICAVEL', ibsDentroDoDas: r2(x.detalhe?.ibsDentroDoDas), tributosSubstituidosDoDas: r2(x.detalhe?.tributosSubstituidosDoDas), precoFinal: r2(x.preco_projetado),
    creditoCbs: r2(x.credito_cbs), creditoIbs: r2(x.credito_ibs), creditoCbsEstimado: r2(x.detalhe?.creditoCbsEstimado), creditoPotencial: r2(n(x.credito_cbs) + n(x.credito_ibs)),
    // Campo separado: a projeção de plano de saúde é exibida na memória, mas
    // não compõe crédito potencial/apurável até confirmação legal e do débito.
    projecaoPlanoSaude: x.detalhe?.projecaoPlanoSaude || null,
    projecaoContribuicaoAssociativa: x.detalhe?.projecaoContribuicaoAssociativa || null,
    projecaoHonorarioAdvocaticio: x.detalhe?.projecaoHonorarioAdvocaticio || null,
    projecaoCustaTaxaJudicial: x.detalhe?.projecaoCustaTaxaJudicial || null,
    pisCofinsAtual: x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_valor ?? null,
    origemPisCofins: x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_origem || 'INDETERMINADO',
    tributosRetirados: {
      // A memória de componentes retirados é distinta dos tributos apenas
      // identificados. Em CBS-only, ISS/ICMS ficam identificados, mas zerados
      // aqui porque não reduzem a base CBS.
      icms: r2(x.detalhe?.reconstrucao?.componentesRetirados?.icms ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.icms),
      iss: r2(x.detalhe?.reconstrucao?.componentesRetirados?.iss ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.iss),
      pis: r2(x.detalhe?.reconstrucao?.componentesRetirados?.pis ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.pis),
      cofins: r2(x.detalhe?.reconstrucao?.componentesRetirados?.cofins ?? x.detalhe?.reconstrucao?.memoriaPisCofins?.tributos_retirados_da_base?.cofins),
      total: r2(x.detalhe?.reconstrucao?.retiradosDaBase),
    },
    tributosIdentificados: x.detalhe?.reconstrucao?.tributosAtuais || {},
    memoriaTributos: x.detalhe?.reconstrucao?.memoriaTributos || {},
    formulaBaseEconomica: x.detalhe?.reconstrucao?.formula || 'Base econômica registrada pelo motor.',
    motivoBaseEconomica: x.detalhe?.reconstrucao?.memoriaPisCofins?.base_reconstrucao_metodo
      ? `PIS/COFINS: ${x.detalhe.reconstrucao.memoriaPisCofins.base_reconstrucao_metodo}${x.detalhe.reconstrucao.memoriaPisCofins.fundamento ? ` — ${x.detalhe.reconstrucao.memoriaPisCofins.fundamento}` : ''}`
      : (x.detalhe?.reconstrucao?.pendencias || []).join(' ') || 'Tributos atuais identificados conforme a memória do motor.',
    origemBaseEconomica: x.detalhe?.reconstrucao?.memoriaPisCofins?.base_reconstrucao_fonte
      || x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_origem || 'INDETERMINADO',
    statusBaseEconomica: x.detalhe?.reconstrucao?.status || 'INDETERMINADO',
    impactoOperacao: r2(n(x.preco_projetado) - n(x.preco_atual)), impactoOperacaoPerc: x.preco_atual ? r4((n(x.preco_projetado) - n(x.preco_atual)) / n(x.preco_atual)) : null,
    tipoCredito: x.tipo_credito, modalidadeCredito: x.modalidade_credito, statusCredito: x.status_credito_determinacao || x.status_credito,
    // A memória bruta permanece no resultado oficial. A tela recebe somente
    // os campos de rastreabilidade que efetivamente apresenta.
    natureza: natureza(x),
  }));
  // A aba de benefícios é um drill-down. O resumo permanece sempre no
  // contrato, mas a relação completa só é transmitida quando a própria aba
  // foi aberta; isso evita centenas de evidências em todas as demais telas.
  const beneficiosCalculados = lado === 'cliente' ? itens.map(leituraBeneficio).filter(Boolean) : [];
  const tratamentoBeneficios = beneficiosCalculados.reduce((s, x) => ({
    operacoes: s.operacoes + 1,
    valor: r2(s.valor + n(x.valor)),
    baseEconomica: r2(s.baseEconomica + n(x.baseEconomica)),
    cbs: r2(s.cbs + n(x.cbs)),
    diferencaReducaoCbs: r2(s.diferencaReducaoCbs + n(x.diferencaReducaoCbs)),
  }), { operacoes: 0, valor: 0, baseEconomica: 0, cbs: 0, diferencaReducaoCbs: 0 });
  const operacoesBeneficios = opcoes.incluirBeneficios === true ? beneficiosCalculados : [];
  const t = finalizar(total); t.parceiros = parceiros.length;
  const limiteParceiros = Math.min(200, Math.max(1, Number(opcoes.limiteParceiros) || 100));
  const totalPaginasParceiros = Math.max(1, Math.ceil(parceiros.length / limiteParceiros));
  const paginaParceiros = Math.min(totalPaginasParceiros, Math.max(1, Number(opcoes.paginaParceiros) || 1));
  const parceirosPaginados = parceiros.slice((paginaParceiros - 1) * limiteParceiros, paginaParceiros * limiteParceiros);
  const resultado = { execucao: base.execucao, periodo_analisado: base.periodo || null, lado,
    projecao_regime: ['simples_nacional', 'mei'].includes(regimeEmpresa) ? 'SIMPLES_HIBRIDO' : 'REGIME_ATUAL',
    leitura_projecao: ['simples_nacional', 'mei'].includes(regimeEmpresa)
      ? 'Projeção principal: Simples Nacional no regime regular de IBS/CBS (híbrido). O DAS permanece disponível somente como comparação.'
      : 'Projeção principal pelo regime tributário atual da empresa.',
    totais: t, parceiros: parceirosPaginados, regimes, detalhes,
    pendenciasPisCofins, resumoPendenciasPisCofins,
    outras_receitas_sem_cliente: lado === 'cliente' ? resumoOutrasReceitas : { registros: 0, valor: 0, cbs: 0 },
    paginacaoParceiros: { pagina: paginaParceiros, limite: limiteParceiros, total: parceiros.length, totalPaginas: totalPaginasParceiros,
      temAnterior: paginaParceiros > 1, temProxima: paginaParceiros < totalPaginasParceiros },
    paginacaoDetalhes: {
      incluido: incluirDetalhes,
      pagina: paginaDetalhes,
      limite: limiteDetalhes,
      total: itensDetalhados.length,
      totalSemFiltro: itens.length,
      totalPaginas: paginasDetalhes,
      temAnterior: paginaDetalhes > 1,
      temProxima: paginaDetalhes < paginasDetalhes,
    },
    condicao200044: lado === 'cliente' ? elegibilidadeAnexoXi.qsaEmpresa(empresaId) : { status: 'NAO_APLICAVEL' },
    operacoesBeneficios, tratamentoBeneficios,
    cenarios: [{ ano: base.execucao?.ano || 2027, valor: t.valor, baseEconomica: t.baseEconomica, ibs: t.ibs, cbs: t.cbs, cbsDentroDoDas: t.cbsDentroDoDas, ibsDentroDoDas: t.ibsDentroDoDas, tributosSubstituidosDoDas: t.tributosSubstituidosDoDas, dasAtual: t.dasAtual, dasResidualHibrido: t.dasResidualHibrido, dasHibridoPendente: t.dasHibridoPendente, dasHibridoProvisorio: t.dasHibridoProvisorio, precoFinal: t.precoFinal, credito: t.creditoFinal, creditoPotencial: t.creditoPotencial, impactoOperacao: t.impactoOperacao, impactoOperacaoPerc: t.impactoOperacaoPerc }],
    riscos: [], fonte: 'motor_resultados' };
  cadeiasPorExecucao.set(chaveCache, resultado);
  while (cadeiasPorExecucao.size > LIMITE_FOTOGRAFIAS_EM_MEMORIA * 12) cadeiasPorExecucao.delete(cadeiasPorExecucao.keys().next().value);
  return resultado;
}

function impactoFinalLegadoInacessivel(empresaId, opcoes = {}) {
  const base = linhas(empresaId, opcoes); const saidas = base.linhas.filter((x) => x.sentido === 'saida'); const entradas = base.linhas.filter((x) => x.sentido === 'entrada');
  const regimeEmpresa = db.prepare('SELECT regime FROM empresas WHERE id=?').get(empresaId)?.regime || '';
  const soma = (lista, campo) => r2(lista.reduce((s, x) => s + n(x[campo]), 0));
  const cbsDebito = soma(saidas, 'cbs'); const cbsCredito = soma(entradas, 'credito_cbs');
  const cbsDentroDoDas = r2(saidas.reduce((s, x) => s + n(x.detalhe?.cbsDentroDoDas), 0));
  const receitaProjetada = soma(saidas, 'preco_projetado');
  const receitaAtual = soma(saidas, 'preco_atual'); const baseSaidas = soma(saidas, 'base_economica');
  const pisDebitos = saidas.map((x) => x.detalhe?.reconstrucao?.memoriaPisCofins?.carga_atual_pis_cofins_valor);
  const pisCreditos = entradas.map((x) => x.detalhe?.creditoAtual?.pisCofins);
  const pisIndeterminado = [...pisDebitos, ...pisCreditos].some((x) => x === null || x === undefined);
  const pisLiquidoReconstruido = pisIndeterminado ? null : r2(pisDebitos.reduce((s, x) => s + n(x), 0) - pisCreditos.reduce((s, x) => s + n(x), 0));
  // A apuração confirmada é a melhor fonte da carga vigente por competência.
  // Onde ela não existir, preservamos a reconstrução já materializada pelo
  // motor, sem transformar ausência em zero.
  const apuracoes = db.prepare(`SELECT competencia, pis_recolhido, cofins_recolhida
    FROM pis_cofins_apuracoes_historicas
    WHERE empresa_id=? AND status_validacao='VALIDADO_USUARIO'
      AND pis_recolhido IS NOT NULL AND cofins_recolhida IS NOT NULL
    ORDER BY id DESC`).all(empresaId);
  const apuracaoPorCompetencia = new Map();
  for (const a of apuracoes) if (!apuracaoPorCompetencia.has(a.competencia)) apuracaoPorCompetencia.set(a.competencia, r2(n(a.pis_recolhido) + n(a.cofins_recolhida)));
  const competenciasSaida = [...new Set(saidas.map((x) => x.competencia).filter(Boolean))];
  const apuracaoCompleta = competenciasSaida.length > 0 && competenciasSaida.every((c) => apuracaoPorCompetencia.has(c));
  const pisLiquido = apuracaoCompleta ? r2(competenciasSaida.reduce((s, c) => s + n(apuracaoPorCompetencia.get(c)), 0)) : pisLiquidoReconstruido;
  const origemCargaAtual = apuracaoCompleta ? 'APURACAO_CONFIRMADA' : pisIndeterminado ? 'INDETERMINADO' : 'RECONSTRUCAO_REGRA';
  const liquida = r2(cbsDebito - cbsCredito);
  const impactoFaturamentoHibrido = ['simples_nacional', 'mei'].includes(regimeEmpresa)
    ? r2(cbsDebito - cbsDentroDoDas) : null;
  // Impacto é leitura: nunca materializa Perfil CBS nem aciona motor.
  const perfil = base.execucao ? perfilCbs.listar(empresaId, { limite:100 }) : { status:'ATUALIZACAO_NECESSARIA', competencias: [] };
  const pDebito = r2((perfil.competencias || []).reduce((s, x) => s + n(x.cbs_debito), 0));
  const pCredito = r2((perfil.competencias || []).reduce((s, x) => s + n(x.cbs_credito), 0));
  const tol = .01;
  const status = !base.execucao ? 'ATUALIZACAO_NECESSARIA' : perfil.status !== 'OK' ? perfil.status : Math.abs(cbsDebito - pDebito) < tol && Math.abs(cbsCredito - pCredito) < tol ? 'RECONCILIADO' : 'DIVERGENTE';
  return { execucao: base.execucao,
    projecao_regime: ['simples_nacional', 'mei'].includes(regimeEmpresa) ? 'SIMPLES_HIBRIDO' : 'REGIME_ATUAL',
    leitura_projecao: ['simples_nacional', 'mei'].includes(regimeEmpresa)
      ? 'Impacto calculado no cenário principal do Simples Híbrido: a CBS regular da venda substitui a parcela equivalente já contida no DAS; créditos das compras seguem a regra de cada operação.'
      : 'Impacto calculado no regime tributário atual da empresa.',
    cbs_debito_vendas: cbsDebito, cbs_credito_compras: cbsCredito, cbs_liquida: liquida,
    cbs_dentro_do_das: cbsDentroDoDas, impacto_faturamento_hibrido: impactoFaturamentoHibrido,
    receita_atual: receitaAtual, receita_projetada: receitaProjetada, base_economica_saidas: baseSaidas,
    carga_efetiva_cbs_receita: receitaAtual ? r4(liquida / receitaAtual) : null,
    carga_efetiva_cbs_base: baseSaidas ? r4(liquida / baseSaidas) : null,
    pis_cofins_debitos_atuais: pisIndeterminado ? null : r2(pisDebitos.reduce((s, x) => s + n(x), 0)),
    pis_cofins_creditos_atuais: pisIndeterminado ? null : r2(pisCreditos.reduce((s, x) => s + n(x), 0)),
    pis_cofins_liquido_atual: pisLiquido, pis_cofins_indeterminado: pisLiquido === null,
    origem_carga_atual: origemCargaAtual,
    carga_atual_percentual: pisLiquido === null || !receitaAtual ? null : r4(pisLiquido / receitaAtual),
    variacao_carga_federal: pisLiquido === null ? null : r2(liquida - pisLiquido),
    // Diferença em pontos percentuais: ambas as cargas usam a mesma venda atual.
    variacao_percentual: pisLiquido === null || !receitaAtual ? null : r4((liquida / receitaAtual) - (pisLiquido / receitaAtual)),
    credito_cbs_recebido_fornecedores: cbsCredito, credito_cbs_entregue_clientes: cbsDebito,
    reconciliacao: { status, motivo:perfil.motivo || null, disponivel: Boolean(base.execucao) && perfil.status === 'OK', itens: base.linhas.length, confere: status === 'RECONCILIADO',
      cbsDebitoVendas: pDebito, cbsCreditoCompras: pCredito,
      motor_resultados: { cbsDebito, cbsCredito }, perfil_cbs: { cbsDebito: pDebito, cbsCredito: pCredito },
      diferencaDebito: r2(cbsDebito - pDebito), diferencaCredito: r2(cbsCredito - pCredito) },
    drill_down: { clientes: 'clientes', fornecedores: 'fornecedores', memoria_atual: 'perfil' } };
}

/*
 * Consulta SQL limitada. O legado acima fica temporariamente no arquivo para
 * referência de regra de negócio, mas não é exportado nem pode ser chamado por
 * rota alguma. Nenhuma função abaixo seleciona `detalhe` em listas ou totais.
 */
const MAX_PAGE = 100;
const JOIN_PROJECAO = `
  FROM motor_resultados r
  JOIN movimentos m ON m.id=r.movimento_id AND m.empresa_id=r.empresa_id
  LEFT JOIN projecoes_movimentos_estado pe ON pe.empresa_id=r.empresa_id AND pe.movimento_id=r.movimento_id
  LEFT JOIN (
    SELECT empresa_id,tipo,
      REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(cnpj,''),'.',''),'/',''),'-',''),' ','') cnpj_normalizado,
      MAX(id) id
    FROM parceiros
    GROUP BY empresa_id,tipo,cnpj_normalizado
  ) parceiro_canonico ON parceiro_canonico.empresa_id=m.empresa_id AND parceiro_canonico.tipo=m.tipo
    AND parceiro_canonico.cnpj_normalizado=
      REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
  LEFT JOIN parceiros p ON p.id=parceiro_canonico.id
  LEFT JOIN movimento_decisoes_fiscais d ON d.empresa_id=m.empresa_id AND d.movimento_id=m.id
    AND d.campo='REGIME_FORNECEDOR' AND d.revogado_em IS NULL`;
const PROJECAO_ATUAL = "pe.situacao='ATUAL'";
const FORNECEDOR_EVIDENCIA_CNPJ = "json_extract(CASE WHEN json_valid(COALESCE(m.normalizacao_evidencia,'')) THEN m.normalizacao_evidencia ELSE '{}' END, '$.fornecedor_vinculado.cnpj')";
const FORNECEDOR_EVIDENCIA_NOME = "json_extract(CASE WHEN json_valid(COALESCE(m.normalizacao_evidencia,'')) THEN m.normalizacao_evidencia ELSE '{}' END, '$.fornecedor_vinculado.descricao')";
const FORNECEDOR_EVIDENCIA_REGIME = "json_extract(CASE WHEN json_valid(COALESCE(m.normalizacao_evidencia,'')) THEN m.normalizacao_evidencia ELSE '{}' END, '$.fornecedor_vinculado.regime')";
const REGIME_CANONICO = `COALESCE(NULLIF(d.valor,''),NULLIF(p.regime,''),NULLIF(m.regime,''),NULLIF(${FORNECEDOR_EVIDENCIA_REGIME},''),r.regime_cbs_emitente,'indeterminado')`;
const ESTADO_PROJECAO = "COALESCE(pe.situacao,'PENDENCIA_REAL')";
// `detalhe` permanece fora das listas. Estes extratos escalares permitem que
// a rastreabilidade exiba a evidência de PIS/Cofins sem materializar a
// fotografia inteira no Node.
const DETALHE_JSON = "CASE WHEN json_valid(COALESCE(r.detalhe,'')) THEN r.detalhe ELSE '{}' END";
const PIS_COFINS_ATUAL = `json_extract(${DETALHE_JSON}, '$.reconstrucao.memoriaPisCofins.carga_atual_pis_cofins_valor')`;
const ORIGEM_PIS_COFINS = `json_extract(${DETALHE_JSON}, '$.reconstrucao.memoriaPisCofins.carga_atual_pis_cofins_origem')`;
const MOTIVO_PIS_COFINS = `COALESCE(json_extract(${DETALHE_JSON}, '$.reconstrucao.memoriaPisCofins.motivo_indeterminacao'), json_extract(${DETALHE_JSON}, '$.reconstrucao.status'))`;
function rotuloRegimeSql(regime) {
  return ({ lucro_real:'Lucro Real',lucro_presumido:'Lucro Presumido',simples_nacional:'Simples Nacional',mei:'MEI',regime_regular:'Regular' })[normalizarRegimeFornecedor(regime)] || 'Perfil desconhecido';
}
function escopoPersistido(empresaId, opcoes={}) {
  const execucao=ultimaExecucao(empresaId,opcoes);
  if(!execucao) return { execucao:null,periodo:null,where:'1=0',params:[] };
  const periodo=periodoAnalisado.obter(empresaId); let where='r.empresa_id=? AND r.execucao_id=?'; const params=[Number(empresaId),Number(execucao.id)];
  if(periodo?.competencia_inicio){ where+=" AND COALESCE(m.competencia,'')>=?"; params.push(periodo.competencia_inicio); }
  if(periodo?.competencia_fim){ where+=" AND COALESCE(m.competencia,'')<=?"; params.push(periodo.competencia_fim); }
  const sentido=opcoes.sentido || (opcoes.tipo==='cliente'?'saida':opcoes.tipo==='fornecedor'?'entrada':null);
  if(sentido){ where+=' AND r.sentido=?'; params.push(sentido); }
  return {execucao,periodo,where,params};
}
function resumo(empresaId,opcoes={}) {
  const e=escopoPersistido(empresaId,opcoes); if(!e.execucao) return {execucao:null,periodo:null,total:0,vigentes:0,pendentes:0,totais:{}};
  const row=db.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN ${PROJECAO_ATUAL} THEN 1 ELSE 0 END) vigentes,SUM(CASE WHEN ${PROJECAO_ATUAL} THEN 0 ELSE 1 END) pendentes,
    COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual ELSE 0 END),0) valor,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.base_economica ELSE 0 END),0) base_economica,
    COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.cbs ELSE 0 END),0) cbs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.ibs ELSE 0 END),0) ibs,
    COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_cbs ELSE 0 END),0) credito_cbs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_ibs ELSE 0 END),0) credito_ibs,
    COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_projetado ELSE 0 END),0) preco_final,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.custo_liquido ELSE 0 END),0) custo_liquido,
    COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN COALESCE(${PIS_COFINS_ATUAL},0) ELSE 0 END),0) pis_cofins_atual,
    SUM(CASE WHEN ${PIS_COFINS_ATUAL} IS NULL THEN 1 ELSE 0 END) pis_indeterminado
    ${JOIN_PROJECAO} WHERE ${e.where}`).get(...e.params);
  const totais={}; for(const [k,v] of Object.entries(row||{})) if(!['total','vigentes','pendentes'].includes(k)) totais[k]=r2(v);
  return {execucao:e.execucao,periodo:e.periodo,total:n(row?.total),vigentes:n(row?.vigentes),pendentes:n(row?.pendentes),totais};
}
function cursorLer(valor){ try { const x=JSON.parse(Buffer.from(String(valor||''),'base64url').toString('utf8')); return Number.isInteger(Number(x?.id))?x:null; } catch(_){ return null; } }
function cursorGravar(valor){ return Buffer.from(JSON.stringify(valor)).toString('base64url'); }
function listar(empresaId,opcoes={}) {
  const e=escopoPersistido(empresaId,opcoes),limite=Math.min(MAX_PAGE,Math.max(1,Number(opcoes.limite)||100)); if(!e.execucao)return {execucao:null,itens:[],limite,proximo_cursor:null,total:0};
  const ordem=String(opcoes.ordem||opcoes.ordenar||'valor').toLowerCase(); const campos={valor:'r.preco_atual',competencia:'m.competencia',documento:'m.documento',fornecedor:`COALESCE(NULLIF(p.descricao,''),NULLIF(${FORNECEDOR_EVIDENCIA_NOME},''),m.nome)`,regime:REGIME_CANONICO};
  const campo=campos[ordem]||campos.valor,direcao=String(opcoes.direcao||'desc').toLowerCase()==='asc'?'ASC':'DESC',cursor=cursorLer(opcoes.cursor); let where=e.where; const params=[...e.params];
  if(cursor){ const sinal=direcao==='ASC'?'>':'<'; where+=` AND (${campo} ${sinal} ? OR (${campo}=? AND r.id ${sinal} ?))`; params.push(cursor.valor,cursor.valor,Number(cursor.id)); }
  for(const [f,col] of Object.entries({documento:"COALESCE(m.documento,m.chave,'')",fornecedor:`COALESCE(NULLIF(p.descricao,''),NULLIF(${FORNECEDOR_EVIDENCIA_NOME},''),m.nome)`,regime:REGIME_CANONICO,servico:"COALESCE(m.descricao,m.nbs,m.ncm,'')"})) if(opcoes[f]){where+=` AND LOWER(${col}) LIKE ?`;params.push(`%${String(opcoes[f]).toLowerCase()}%`);}
  if(opcoes.somentePendenciasPisCofins) where+=` AND ${PIS_COFINS_ATUAL} IS NULL`;
  const total=Number(db.prepare(`SELECT COUNT(*) total ${JOIN_PROJECAO} WHERE ${where}`).get(...params)?.total)||0;
  const paginaSolicitada=Number(opcoes.pagina); const usarPagina=Number.isInteger(paginaSolicitada) && paginaSolicitada>0;
  const rows=db.prepare(`SELECT r.id resultado_id,r.movimento_id,r.sentido,r.status_classificacao,r.status_credito,r.cst,r.cclasstrib,r.tratamento,
    m.competencia,m.documento,m.chave,m.descricao,m.ncm,m.nbs,m.cfop,m.nome,COALESCE(NULLIF(m.inscr_federal,''),${FORNECEDOR_EVIDENCIA_CNPJ}) inscr_federal,m.origem,m.valor movimento_valor,COALESCE(NULLIF(p.descricao,''),NULLIF(${FORNECEDOR_EVIDENCIA_NOME},'')) parceiro_cadastrado,${REGIME_CANONICO} regime_canonico,${ESTADO_PROJECAO} situacao_projecao,pe.motivo motivo_projecao,pe.job_id,
    CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual END preco_atual,CASE WHEN ${PROJECAO_ATUAL} THEN r.base_economica END base_economica,CASE WHEN ${PROJECAO_ATUAL} THEN r.cbs END cbs,CASE WHEN ${PROJECAO_ATUAL} THEN r.ibs END ibs,
    CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_cbs END credito_cbs,CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_ibs END credito_ibs,CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_projetado END preco_projetado,CASE WHEN ${PROJECAO_ATUAL} THEN r.custo_liquido END custo_liquido,
    ${PIS_COFINS_ATUAL} pis_cofins_atual,${ORIGEM_PIS_COFINS} origem_pis_cofins,${MOTIVO_PIS_COFINS} motivo_pis_cofins,${campo} valor_cursor
    ${JOIN_PROJECAO} WHERE ${where} ORDER BY ${campo} ${direcao},r.id ${direcao} LIMIT ?${usarPagina?' OFFSET ?':''}`).all(...params,usarPagina?limite:limite+1,...(usarPagina?[(paginaSolicitada-1)*limite]:[]));
  const mais=usarPagina ? paginaSolicitada*limite<total : rows.length>limite,itens=rows.slice(0,limite).map((x)=>({
    ...x, tipoFiscal:x.ncm?'PRODUTO':(x.nbs?'SERVICO':'A_CLASSIFICAR'), parceiro:x.parceiro_cadastrado||x.nome||'', cnpj:x.inscr_federal||'', produto:x.descricao||'',
    regimeEmitente:normalizarRegimeFornecedor(x.regime_canonico), regimeFornecedor:normalizarRegimeFornecedor(x.regime_canonico), valor:r2(x.preco_atual==null?x.movimento_valor:x.preco_atual), valorSemImposto:r2(x.base_economica), precoFinal:r2(x.preco_projetado), creditoCbs:r2(x.credito_cbs), creditoIbs:r2(x.credito_ibs),
    pisCofinsAtual:x.pis_cofins_atual==null?null:r2(x.pis_cofins_atual), origemPisCofins:x.origem_pis_cofins||'INDETERMINADO', motivoBaseEconomica:x.motivo_pis_cofins||x.motivo_projecao||'',
    regime_parceiro:normalizarRegimeFornecedor(x.regime_canonico),resultado_vigente:x.situacao_projecao==='ATUAL',creditoPotencial:x.credito_cbs==null?null:r2(n(x.credito_cbs)+n(x.credito_ibs)),impactoOperacao:x.preco_atual==null?null:r2(n(x.preco_projetado)-n(x.preco_atual))})); const ultimo=itens.at(-1);
  return {execucao:e.execucao,periodo:e.periodo,itens,limite,total,proximo_cursor:!usarPagina&&mais&&ultimo?cursorGravar({valor:ultimo.valor_cursor,id:ultimo.resultado_id}):null};
}
function detalhe(empresaId,movimentoId){
  const e=escopoPersistido(empresaId);if(!e.execucao)return null;const row=db.prepare(`SELECT r.*,m.competencia,m.documento,m.chave,m.descricao,m.ncm,m.nbs,m.cfop,m.nome,m.inscr_federal,m.origem,${REGIME_CANONICO} regime_canonico,${ESTADO_PROJECAO} situacao_projecao,pe.motivo motivo_projecao,pe.job_id ${JOIN_PROJECAO} WHERE ${e.where} AND m.id=? LIMIT 1`).get(...e.params,Number(movimentoId));
  if(!row)return null;let memoria={};try{memoria=JSON.parse(row.detalhe||'{}')}catch(_){memoria={erro:'DETALHE_INVALIDO'}};if(row.situacao_projecao!=='ATUAL')for(const k of ['preco_atual','base_economica','cbs','ibs','credito_cbs','credito_ibs','preco_projetado','custo_liquido'])row[k]=null;return {...row,regime_parceiro:normalizarRegimeFornecedor(row.regime_canonico),resultado_vigente:row.situacao_projecao==='ATUAL',detalhe:memoria};
}
function cadeia(empresaId,tipo,opcoes={}){
  const sentido=tipo==='cliente'?'saida':'entrada',e=escopoPersistido(empresaId,{sentido}),base=resumo(empresaId,{sentido}),t=base.totais||{};
  const totais={registros:base.total,valor:t.valor||0,baseEconomica:t.base_economica||0,cbs:t.cbs||0,ibs:t.ibs||0,creditoFinal:r2(n(t.credito_cbs)+n(t.credito_ibs)),creditoPotencial:r2(n(t.credito_cbs)+n(t.credito_ibs)),precoFinal:t.preco_final||0,custoLiquido:t.custo_liquido||0}; if(!e.execucao)return {execucao:null,totais,parceiros:[],regimes:[],detalhes:[],paginaDetalhes:{limite:MAX_PAGE,total:0},pendenciasPisCofins:[],resumoPendenciasPisCofins:{registros:0,valor:0},cenarios:[],riscos:[],operacoesBeneficios:[],tratamentoBeneficios:{operacoes:0}};
  const parceiros=db.prepare(`SELECT COALESCE(m.inscr_federal,'') cnpj,COALESCE(NULLIF(p.descricao,''),NULLIF(m.nome,''),'Sem identificação') nome,${REGIME_CANONICO} regime,COUNT(*) itens,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual ELSE 0 END),0) valor,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.base_economica ELSE 0 END),0) baseEconomica,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.cbs ELSE 0 END),0) cbs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.ibs ELSE 0 END),0) ibs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_cbs+r.credito_ibs ELSE 0 END),0) creditoFinal,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_projetado ELSE 0 END),0) precoFinal,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.custo_liquido ELSE 0 END),0) custoLiquido ${JOIN_PROJECAO} WHERE ${e.where} GROUP BY cnpj,nome,regime ORDER BY valor DESC,nome ASC LIMIT ?`).all(...e.params,MAX_PAGE).map((x)=>({...x,regime:normalizarRegimeFornecedor(x.regime),regimeLabel:rotuloRegimeSql(x.regime),representatividade:totais.valor?r4(n(x.valor)/totais.valor):0,impactoOperacao:r2(n(x.precoFinal)-n(x.valor))}));
  const regimes=db.prepare(`SELECT ${REGIME_CANONICO} regime,COUNT(*) itens,COUNT(DISTINCT COALESCE(m.inscr_federal,m.nome,m.id)) parceiros,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual ELSE 0 END),0) valor,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.base_economica ELSE 0 END),0) baseEconomica,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.cbs ELSE 0 END),0) cbs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.ibs ELSE 0 END),0) ibs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_cbs+r.credito_ibs ELSE 0 END),0) creditoFinal,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_projetado ELSE 0 END),0) precoFinal ${JOIN_PROJECAO} WHERE ${e.where} GROUP BY regime ORDER BY valor DESC`).all(...e.params).map((x)=>({...x,regime:normalizarRegimeFornecedor(x.regime),label:rotuloRegimeSql(x.regime),representatividade:totais.valor?r4(n(x.valor)/totais.valor):0,creditoPotencial:n(x.creditoFinal),impactoOperacao:r2(n(x.precoFinal)-n(x.valor))}));
  const pagina=listar(empresaId,{sentido,limite:opcoes.limiteDetalhes||opcoes.limite,cursor:opcoes.cursor,ordenar:opcoes.ordenarDetalhes||opcoes.ordenar,direcao:opcoes.direcaoDetalhes||opcoes.direcao,documento:opcoes.filtroDocumento,fornecedor:opcoes.filtroParceiro,regime:opcoes.filtroRegime,servico:opcoes.filtroServico});
  return {execucao:e.execucao,periodo:e.periodo,totais,parceiros,regimes,detalhes:pagina.itens,paginaDetalhes:{limite:pagina.limite,proximo_cursor:pagina.proximo_cursor,total:base.total},pendenciasPisCofins:[],resumoPendenciasPisCofins:{registros:0,valor:0},cenarios:[{ano:e.execucao.ano||2027,valor:totais.valor,baseEconomica:totais.baseEconomica,cbs:totais.cbs,ibs:totais.ibs,credito:totais.creditoFinal,precoFinal:totais.precoFinal,impactoOperacao:r2(totais.precoFinal-totais.valor)}],riscos:[],operacoesBeneficios:[],tratamentoBeneficios:{operacoes:0},estadoAtualizacao:{vigentes:base.vigentes,pendentes:base.pendentes}};
}
function impactoFinal(empresaId){const entradas=resumo(empresaId,{sentido:'entrada'}),saidas=resumo(empresaId,{sentido:'saida'}),e=entradas.totais||{},s=saidas.totais||{},pendentes=n(entradas.pendentes)+n(saidas.pendentes);return {execucao:saidas.execucao||entradas.execucao,cbs_debito_vendas:r2(s.cbs),cbs_credito_compras:r2(e.credito_cbs),cbs_liquida:r2(n(s.cbs)-n(e.credito_cbs)),ibs_debito_vendas:r2(s.ibs),ibs_credito_compras:r2(e.credito_ibs),ibs_liquida:r2(n(s.ibs)-n(e.credito_ibs)),pendentes,reconciliacao:{status:pendentes?'PENDENTE_ATUALIZACAO':'RECONCILIADO',mensagem:'Totais usam somente projeções ATUAL.'},fontes:{entradas,saidas}};}
function resumoQualidade(empresaId,opcoes={}){const e=escopoPersistido(empresaId,opcoes);if(!e.execucao)return {execucao:null,total:0,por_estado:[]};const por_estado=db.prepare(`SELECT ${ESTADO_PROJECAO} situacao,COUNT(*) quantidade,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual ELSE 0 END),0) valor_vigente ${JOIN_PROJECAO} WHERE ${e.where} GROUP BY situacao ORDER BY situacao`).all(...e.params);return {execucao:e.execucao,total:por_estado.reduce((a,x)=>a+n(x.quantidade),0),por_estado};}
function cadeiaLimitada(empresaId,tipo,opcoes={}) {
  const sentido=tipo==='cliente'?'saida':'entrada', e=escopoPersistido(empresaId,{sentido}), base=resumo(empresaId,{sentido}), t=base.totais||{};
  const totais={registros:base.total,valor:t.valor||0,baseEconomica:t.base_economica||0,cbs:t.cbs||0,ibs:t.ibs||0,creditoFinal:r2(n(t.credito_cbs)+n(t.credito_ibs)),creditoPotencial:r2(n(t.credito_cbs)+n(t.credito_ibs)),precoFinal:t.preco_final||0,custoLiquido:t.custo_liquido||0,pisCofinsAtual:t.pis_cofins_atual||0,pisIndeterminado:n(t.pis_indeterminado)>0};
  if(!e.execucao)return {execucao:null,totais,parceiros:[],regimes:[],detalhes:[],paginaDetalhes:{limite:MAX_PAGE,total:0},pendenciasPisCofins:[],resumoPendenciasPisCofins:{registros:0,valor:0},cenarios:[],riscos:[],operacoesBeneficios:[],tratamentoBeneficios:{operacoes:0}};
  const parceiros=db.prepare(`SELECT COALESCE(NULLIF(m.inscr_federal,''),${FORNECEDOR_EVIDENCIA_CNPJ},'') cnpj,COALESCE(NULLIF(p.descricao,''),NULLIF(${FORNECEDOR_EVIDENCIA_NOME},''),NULLIF(m.nome,''),'Sem identificação') nome,${REGIME_CANONICO} regime,COUNT(*) itens,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual ELSE 0 END),0) valor,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.cbs ELSE 0 END),0) cbs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_cbs+r.credito_ibs ELSE 0 END),0) creditoFinal,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_projetado ELSE 0 END),0) precoFinal ${JOIN_PROJECAO} WHERE ${e.where} GROUP BY cnpj,nome,regime ORDER BY valor DESC,nome ASC LIMIT ?`).all(...e.params,MAX_PAGE).map(x=>({...x,regime:normalizarRegimeFornecedor(x.regime),regimeLabel:rotuloRegimeSql(x.regime),representatividade:totais.valor?r4(n(x.valor)/totais.valor):0,impactoOperacao:r2(n(x.precoFinal)-n(x.valor))}));
  const regimes=db.prepare(`SELECT ${REGIME_CANONICO} regime,COUNT(*) itens,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_atual ELSE 0 END),0) valor,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.cbs ELSE 0 END),0) cbs,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.credito_cbs+r.credito_ibs ELSE 0 END),0) creditoFinal,COALESCE(SUM(CASE WHEN ${PROJECAO_ATUAL} THEN r.preco_projetado ELSE 0 END),0) precoFinal ${JOIN_PROJECAO} WHERE ${e.where} GROUP BY ${REGIME_CANONICO} ORDER BY valor DESC`).all(...e.params).map(x=>({...x,regime:normalizarRegimeFornecedor(x.regime),label:rotuloRegimeSql(x.regime),representatividade:totais.valor?r4(n(x.valor)/totais.valor):0,creditoPotencial:n(x.creditoFinal),impactoOperacao:r2(n(x.precoFinal)-n(x.valor))}));
  const pagina=listar(empresaId,{sentido,limite:opcoes.limiteDetalhes||opcoes.limite,pagina:opcoes.paginaDetalhes,cursor:opcoes.cursor,ordenar:opcoes.ordenarDetalhes||opcoes.ordenar,direcao:opcoes.direcaoDetalhes||opcoes.direcao,documento:opcoes.filtroDocumento,fornecedor:opcoes.filtroParceiro,regime:opcoes.filtroRegime,servico:opcoes.filtroServico});
  const pendenciasPagina=pagina.itens.filter((x)=>x.pisCofinsAtual===null);
  const pendenciasResumo=db.prepare(`SELECT COUNT(*) registros,COALESCE(SUM(COALESCE(m.valor,r.preco_atual,0)),0) valor ${JOIN_PROJECAO} WHERE ${e.where} AND ${PIS_COFINS_ATUAL} IS NULL`).get(...e.params) || {registros:0,valor:0};
  const totalPaginas=Math.max(1,Math.ceil(pagina.total/pagina.limite)),paginaAtual=Math.min(totalPaginas,Math.max(1,Number(opcoes.paginaDetalhes)||1));
  return {execucao:e.execucao,periodo:e.periodo,totais,parceiros,regimes,detalhes:pagina.itens,paginacaoDetalhes:{incluido:opcoes.incluirDetalhes!==false,pagina:paginaAtual,limite:pagina.limite,total:pagina.total,totalSemFiltro:base.total,totalPaginas,temAnterior:paginaAtual>1,temProxima:paginaAtual<totalPaginas},pendenciasPisCofins:pendenciasPagina,resumoPendenciasPisCofins:{registros:n(pendenciasResumo.registros),valor:r2(pendenciasResumo.valor)},cenarios:[{ano:e.execucao.ano||2027,valor:totais.valor,baseEconomica:totais.baseEconomica,cbs:totais.cbs,ibs:totais.ibs,credito:totais.creditoFinal,precoFinal:totais.precoFinal,impactoOperacao:r2(totais.precoFinal-totais.valor)}],riscos:[],operacoesBeneficios:[],tratamentoBeneficios:{operacoes:0},estadoAtualizacao:{vigentes:base.vigentes,pendentes:base.pendentes}};
}
module.exports = { ultimaExecucao, invalidarCacheEmpresa, resumo, listar, detalhe, cadeia:cadeiaLimitada, impactoFinal, resumoQualidade, MAX_PAGE, faixaTributacao, leituraBeneficio, leitura200044 };
