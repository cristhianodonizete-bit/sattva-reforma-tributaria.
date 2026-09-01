/**
 * Visão Fase 2A: mede cobertura a partir da fotografia oficial. Não recalcula
 * CBS, crédito ou base econômica, e não promove premissa a dado real.
 */
const db = require('../db');
const qualidade = require('./qualidadeCobertura');
const excecoes = require('./excecoesMotor');
const supabase = require('./supabase');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round(n(v) * 100) / 100;
const pct = (a, b) => b ? a / b : null;
const estado = (v) => ['DETERMINADO', 'SIMULADO_POR_PREMISSA', 'NAO_APLICAVEL'].includes(v) ? 'RESOLVIDA' : v;

function matriz(mapa) {
  const itens = Object.entries(mapa || {}).map(([status, dado]) => ({ status, quantidade: n(dado.quantidade), valor: r2(dado.valor) }));
  const total = itens.reduce((a, x) => ({ quantidade: a.quantidade + x.quantidade, valor: a.valor + x.valor }), { quantidade: 0, valor: 0 });
  const resolvida = itens.filter((x) => estado(x.status) === 'RESOLVIDA').reduce((a, x) => ({ quantidade: a.quantidade + x.quantidade, valor: a.valor + x.valor }), { quantidade: 0, valor: 0 });
  return { itens, total: { ...total, valor: r2(total.valor) }, cobertura_quantidade: pct(resolvida.quantidade, total.quantidade), cobertura_valor: pct(resolvida.valor, total.valor) };
}
function familia(linha) {
  const d = linha.detalhe || {};
  const texto = JSON.stringify(d).toLowerCase();
  const regime = String(linha.regime_cbs_emitente || linha.regime_cbs_adquirente || '').toUpperCase();
  // O campo de memória sempre existe. Só é monofasia quando o modo é uma
  // hipótese efetiva, nunca pela simples presença de "INDETERMINADO".
  const modoMonofasia = String(d.reconstrucao?.modo_reconstrucao_monofasia || d.modo_reconstrucao_monofasia || '').toUpperCase();
  if (['VALOR_REAL_DOCUMENTO','REGRA_ESPECIFICA_AD_VALOREM','REGRA_ESPECIFICA_AD_REM','ALIQUOTA_ZERO_REVENDA','PREMISSA_PERCENTUAL'].includes(modoMonofasia)) return 'MONOFASIA';
  if (texto.includes('governo') || texto.includes('autarquia')) return 'GOVERNO';
  if (regime.includes('MEI')) return 'MEI';
  if (regime.includes('SIMPLES')) return 'SIMPLES';
  if (texto.includes('importa')) return 'IMPORTACAO';
  if (texto.includes('exporta')) return 'EXPORTACAO';
  if (texto.includes('cooperativ')) return 'COOPERATIVAS';
  return 'OPERACAO_REGULAR';
}
function suporte(grupo) {
  const resultado = grupo.map((x) => x.dimensoes.resultado);
  if (!resultado.length) return 'NAO_IDENTIFICADO';
  if (resultado.some((x) => x === 'INDETERMINADO')) return 'IDENTIFICADO';
  if (resultado.some((x) => x === 'SUJEITO_VALIDACAO')) return 'CLASSIFICADO';
  // "SUPORTADO" é reservado para operação que percorreu o motor, gerou memória
  // e passou pela fotografia oficial; não é inferido só pelo catálogo.
  return 'SUPORTADO';
}

// Uma operação pode ter várias dimensões pendentes. A fila escolhe uma causa
// principal, em ordem de impedimento, para não contar o mesmo valor duas
// vezes e para entregar uma ação executável ao responsável pelo dado.
function pendenciaPrincipal(item) {
  const d = item.dimensoes || {};
  const candidatos = [
    ['classificacao', d.classificacao],
    ['reconstrucao', d.reconstrucao],
    ['tratamento', d.tratamento],
    ['credito', d.credito],
  ];
  const [dimensao, status] = candidatos.find(([, valor]) => !['DETERMINADO', 'SIMULADO_POR_PREMISSA', 'NAO_APLICAVEL'].includes(valor)) || [];
  const contexto = item.linha || {};
  const evidencia = [
    contexto.documento && `Documento: ${contexto.documento}`,
    contexto.cnpj && `CNPJ/CPF: ${contexto.cnpj}`,
    contexto.lc116 && `Item LC116: ${contexto.lc116}`,
    contexto.nbs && `NBS: ${contexto.nbs}`,
    contexto.ncm && `NCM: ${contexto.ncm}`,
    contexto.competencia && `Competência: ${contexto.competencia}`,
  ].filter(Boolean);
  const porDimensao = {
    classificacao: {
      causa: 'Classificação fiscal pendente ou requer validação.',
      fonte_minima: 'Descrição do item e documento; confirmar NBS, LC116 ou NCM quando aplicável.',
      acao: 'Revisar a classificação e confirmar o código fiscal aplicável.',
      destino_central: 'TRATAMENTO_DE_DADOS',
      natureza: 'EVIDENCIA_OU_VALIDACAO_FISCAL',
    },
    reconstrucao: {
      causa: 'Carga/base econômica atual sem evidência suficiente para reconstrução.',
      fonte_minima: 'XML, EFD-Contribuições, planilha/ERP ou cadastro fiscal com evidência aplicável.',
      acao: 'Enviar ou vincular a fonte fiscal/econômica disponível.',
      destino_central: 'IMPORTACOES_E_DADOS_COMPLEMENTARES',
      natureza: 'EVIDENCIA_EXTERNA',
    },
    tratamento: {
      causa: 'Tratamento fiscal não foi determinado pela evidência disponível.',
      fonte_minima: 'Documento fiscal ou regra/cadastro fiscal aplicável ao item e competência.',
      acao: 'Completar a evidência fiscal ou encaminhar para validação do tratamento.',
      destino_central: 'TRATAMENTO_DE_DADOS',
      natureza: 'VALIDACAO_FISCAL',
    },
    credito: {
      causa: 'Elegibilidade de crédito requer confirmação.',
      fonte_minima: 'Regime da contraparte e evidência da natureza/elegibilidade da operação.',
      acao: 'Completar o cadastro do parceiro ou anexar a evidência de elegibilidade.',
      destino_central: 'CADASTROS_E_TRATAMENTO_DE_DADOS',
      natureza: 'EVIDENCIA_OU_VALIDACAO_FISCAL',
    },
  };
  // Um XML pode ter trazido LC116, mas não NBS. Isso não é ausência de
  // documento: é uma chave de serviço incompleta e deve orientar a revisão
  // para o campo certo, sem esconder a evidência já disponível.
  const normalizacaoLc116SemNbs = dimensao === 'classificacao'
    && contexto.normalizacao_pendencia === 'LC116_IDENTIFICADO_SEM_NBS';
  const orientacao = normalizacaoLc116SemNbs ? {
    causa: 'Item LC116 identificado no XML, mas NBS não foi identificado; a chave do serviço está incompleta.',
    fonte_minima: contexto.normalizacao_evidencia || `Item LC116: ${contexto.lc116 || 'não identificado'} · descrição do serviço e documento.`,
    acao: 'Confirmar o NBS aplicável ao serviço e salvar a classificação neste lançamento.',
    destino_central: 'TRATAMENTO_DE_DADOS', natureza: 'NORMALIZACAO_DOCUMENTAL',
  } : porDimensao[dimensao];
  return {
    movimento_id: item.movimento_id,
    valor: r2(item.valor),
    sentido: item.sentido,
    dimensao: dimensao || 'resultado',
    status: status || item.dimensoes?.resultado || 'INDETERMINADO',
    ...orientacao,
    evidencia_disponivel: evidencia.length ? evidencia : ['Sem identificadores suficientes na fotografia.'],
    parceiro: contexto.parceiro || 'Não identificado',
    documento: contexto.documento || contexto.chave || 'Não identificado',
    descricao: contexto.descricao || 'Não identificada',
  };
}
function pendenciasOperacionais(avaliadas) {
  return avaliadas
    .filter((item) => !['DETERMINADO', 'SIMULADO_POR_PREMISSA', 'NAO_APLICAVEL'].includes(item.dimensoes?.resultado))
    .map(pendenciaPrincipal)
    .sort((a, b) => b.valor - a.valor || a.movimento_id - b.movimento_id);
}
function familias(avaliadas) {
  const mapa = new Map();
  for (const item of avaliadas) {
    const chave = familia(item.linha || item);
    const atual = mapa.get(chave) || [];
    atual.push(item); mapa.set(chave, atual);
  }
  const esperadas = ['OPERACAO_REGULAR','SIMPLES','MEI','GOVERNO','PRODUTOR_RURAL_CONTRIBUINTE','PRODUTOR_RURAL_NAO_CONTRIBUINTE','COOPERATIVAS','MONOFASIA','CREDITO_PRESUMIDO','REGIMES_DIFERENCIADOS','REGIMES_ESPECIFICOS','IMPORTACAO','EXPORTACAO','TRANSPORTE','SAUDE','EDUCACAO','MEDICAMENTOS','DISPOSITIVOS_MEDICOS','ALIMENTOS','AGROINSUMOS','TURISMO','HOTELARIA','BARES_RESTAURANTES','COMBUSTIVEIS','BENS_USADOS','RECICLAGEM','SETOR_IMOBILIARIO','SERVICOS_FINANCEIROS','PLANOS_SAUDE'];
  return esperadas.map((nome) => {
    const itens = mapa.get(nome) || [];
    const valor = r2(itens.reduce((s, x) => s + n(x.valor), 0));
    return { familia: nome, identificado: itens.length > 0, classificado: itens.some((x) => x.dimensoes.classificacao === 'DETERMINADO'),
      suportado: suporte(itens) === 'SUPORTADO', nivel_suporte: suporte(itens), quantidade: itens.length, valor,
      gap: !itens.length ? 'Sem ocorrência na fotografia ativa.' : suporte(itens) === 'SUPORTADO' ? null : 'Fatos ou regra específica ainda não comprovados; cálculo específico não foi criado.' };
  });
}
function mestres() {
  const contar = (tabela) => db.prepare(`SELECT COUNT(*) c FROM ${tabela}`).get().c;
  return {
    parceiros: { registros: contar('cadastro_parceiros_mestre'), operacional: contar('cadastro_parceiros_mestre') > 0, fonte: 'cadastro mestre derivado do cache CNPJ validado' },
    produtos: { registros: contar('cadastro_produtos_mestre'), operacional: contar('cadastro_produtos_mestre') > 0, catalogo: contar('base_ncm') },
    servicos: { registros: contar('cadastro_servicos_mestre'), operacional: contar('cadastro_servicos_mestre') > 0, catalogo: contar('base_servicos') },
    regras_enquadramento: { registros: contar('regras_enquadramento'), ativas: db.prepare("SELECT COUNT(*) c FROM regras_enquadramento WHERE status='ATIVA'").get().c },
    credito_presumido: { registros: contar('hipoteses_credito_presumido'), ativas: db.prepare("SELECT COUNT(*) c FROM hipoteses_credito_presumido WHERE status='ATIVA'").get().c },
  };
}
function popularCadastrosMestre() {
  const parceiros = db.prepare(`INSERT INTO cadastro_parceiros_mestre (cnpj,razao_social,tipo,regime_atual,regime_cbs,simples,mei,governo,perfil_credito,origem,evidencia,status,atualizado_em)
    SELECT cnpj, razao_social, CASE WHEN length(cnpj)=11 THEN 'PESSOA_FISICA' ELSE 'PESSOA_JURIDICA' END,
      regime_derivado, CASE WHEN optante_mei=1 THEN 'MEI' WHEN optante_simples=1 THEN 'SIMPLES_DAS' WHEN regime_derivado='regime_regular' THEN 'REGULAR' ELSE 'INDETERMINADO' END,
      optante_simples, optante_mei, 0, justificativa, fonte, justificativa, 'ATIVO', consultado_em FROM cnpj_cache
    WHERE cnpj<>'' ON CONFLICT(cnpj) DO UPDATE SET razao_social=excluded.razao_social,regime_atual=excluded.regime_atual,regime_cbs=excluded.regime_cbs,
      simples=excluded.simples,mei=excluded.mei,perfil_credito=excluded.perfil_credito,origem=excluded.origem,evidencia=excluded.evidencia,atualizado_em=excluded.atualizado_em`).run().changes;
  const produtos = db.prepare(`INSERT OR IGNORE INTO cadastro_produtos_mestre (chave,descricao,ncm,tratamento_conhecido,origem,evidencia)
    SELECT 'NCM:' || ncm, MAX(descricao), ncm, MAX(tratamento_efetivo_saida), 'CATALOGO_FISCAL', MAX(fundamento) FROM base_ncm WHERE ncm<>'' GROUP BY ncm`).run().changes;
  const servicos = db.prepare(`INSERT OR IGNORE INTO cadastro_servicos_mestre (chave,descricao,nbs,lc116,natureza_servico,tratamento_conhecido,origem,evidencia)
    SELECT 'NBS:' || nbs || ':LC:' || lc116, MAX(COALESCE(descricao_item,descricao_nbs)), nbs, lc116, MAX(operacao_pis_cofins), MAX(tratamento_efetivo_saida), 'CATALOGO_FISCAL', MAX(fundamento_cumulatividade)
    FROM base_servicos WHERE nbs<>'' OR lc116<>'' GROUP BY nbs,lc116`).run().changes;
  return { parceiros, produtos, servicos };
}
function fotografia(empresaId, opcoes = {}) {
  const q = qualidade.obter(empresaId, opcoes);
  const avaliadas = q.linhas.map((x) => ({ ...x, linha: (() => { try { return db.prepare(`SELECT r.detalhe,r.regime_cbs_emitente,r.regime_cbs_adquirente,
      m.documento,m.chave,m.descricao,m.nome AS parceiro,m.inscr_federal AS cnpj,m.competencia,m.ncm,m.nbs,m.lc116,m.cst,
      m.normalizacao_status,m.normalizacao_pendencia,m.normalizacao_evidencia
      FROM motor_resultados r LEFT JOIN movimentos m ON m.id=r.movimento_id AND m.empresa_id=r.empresa_id
      WHERE r.empresa_id=? AND r.movimento_id=? AND r.execucao_id=?`).get(empresaId, x.movimento_id, q.execucao?.id) || {}; } catch (_) { return {}; } })() })).map((x) => ({ ...x, linha: { ...x.linha, detalhe: (() => { try { return JSON.parse(x.linha.detalhe || '{}'); } catch (_) { return {}; } })() } }));
  const dimensoes = Object.fromEntries(['classificacao','tratamento','reconstrucao','credito','resultado'].map((k) => [k, matriz(q.matrizes[k] || {})]));
  const abertas = excecoes.listar(empresaId, { limite: 1000 });
  const agrupadas = Object.values(abertas.reduce((m, x) => { const k = `${x.codigo}:${x.categoria}`; const a = m[k] || { causa: x.codigo, categoria: x.categoria, quantidade: 0, valor: 0, impacto: 0, status: x.status }; a.quantidade++; a.valor += n(x.valor_envolvido); a.impacto += n(x.impacto_cbs_estimado); m[k] = a; return m; }, {})).map((x) => ({ ...x, valor: r2(x.valor), impacto: r2(x.impacto) })).sort((a,b) => b.valor - a.valor);
  const pendencias_operacionais = pendenciasOperacionais(avaliadas);
  return { empresa_id: Number(empresaId), execucao: q.execucao, fotografia: { total: q.total, por_sentido: q.por_sentido, cobertura: dimensoes, automacao: dimensoes.resultado, pendencias: q.pendencias, pendencias_operacionais },
    familias: familias(avaliadas), excecoes: { resumo: excecoes.resumo(empresaId), agrupadas }, mestres: mestres(), criado_em: new Date().toISOString() };
}
function registrarFotografia(empresaId, tipo = 'FASE_2A') { const dados = fotografia(empresaId); const r = db.prepare('INSERT INTO cobertura_fotografias (empresa_id,execucao_id,tipo,dados) VALUES (?,?,?,?)').run(empresaId, dados.execucao?.id || null, tipo, JSON.stringify(dados)); return { id: Number(r.lastInsertRowid), ...dados }; }
function listarFotografias(empresaId) { return db.prepare('SELECT id,execucao_id,tipo,criado_em FROM cobertura_fotografias WHERE empresa_id=? ORDER BY id DESC').all(empresaId); }

// Sincronização explícita da camada de conhecimento da Fase 2A. Ela nunca
// publica motor_resultados e não aciona qualquer cálculo/reprocessamento.
const TABELAS_MESTRE = {
  cadastro_parceiros_mestre: { chave: 'cnpj' },
  cadastro_produtos_mestre: { chave: 'chave' },
  cadastro_servicos_mestre: { chave: 'chave' },
  regras_enquadramento: { chave: 'id' },
  hipoteses_credito_presumido: { chave: 'hipotese_id' },
};
function colunas(tabela) { return db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name); }
function linhasLocais(tabela) { const cs = colunas(tabela); return db.prepare(`SELECT ${cs.join(',')} FROM ${tabela}`).all(); }
async function subirEmLotes(remoto, tabela, linhas, chave) {
  let gravadas = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    const { error } = await remoto.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: chave });
    if (error) throw new Error(`${tabela}: ${error.message}`);
    gravadas += Math.min(500, linhas.length - i);
  }
  return gravadas;
}
async function sincronizarMestresCompartilhados(empresaId = null) {
  if (!supabase.configurado()) throw new Error('Supabase não configurado no .env.');
  const remoto = supabase.admin(); const resultado = {};
  for (const [tabela, cfg] of Object.entries(TABELAS_MESTRE)) resultado[tabela] = await subirEmLotes(remoto, tabela, linhasLocais(tabela), cfg.chave);
  // Fotografia é auditável; evita duplicar a mesma fotografia lógica no reenvio.
  if (empresaId != null) {
    const fotos = db.prepare('SELECT empresa_id,execucao_id,tipo,dados,criado_em FROM cobertura_fotografias WHERE empresa_id=? ORDER BY id').all(empresaId);
    let fotografias = 0;
    for (const foto of fotos) {
      const { data: existente, error: leitura } = await remoto.from('cobertura_fotografias').select('id')
        .eq('empresa_id', foto.empresa_id).eq('execucao_id', foto.execucao_id).eq('tipo', foto.tipo).limit(1);
      if (leitura) throw new Error(`cobertura_fotografias: ${leitura.message}`);
      if (existente?.length) continue;
      const { error } = await remoto.from('cobertura_fotografias').insert({ ...foto, dados: JSON.parse(foto.dados) });
      if (error) throw new Error(`cobertura_fotografias: ${error.message}`);
      fotografias++;
    }
    resultado.cobertura_fotografias = fotografias;
  }
  return resultado;
}
async function baixarMestresCompartilhados() {
  if (!supabase.configurado()) throw new Error('Supabase não configurado no .env.');
  const remoto = supabase.admin(); const resultado = {};
  for (const [tabela, cfg] of Object.entries(TABELAS_MESTRE)) {
    const { data, error } = await remoto.from(tabela).select('*');
    if (error) throw new Error(`${tabela}: ${error.message}`);
    const cs = colunas(tabela);
    const sql = `INSERT INTO ${tabela} (${cs.join(',')}) VALUES (${cs.map(() => '?').join(',')}) ON CONFLICT(${cfg.chave}) DO UPDATE SET ${cs.filter((x) => x !== cfg.chave && x !== 'id').map((x) => `${x}=excluded.${x}`).join(',')}`;
    const salvar = db.prepare(sql);
    db.transaction(() => (data || []).forEach((x) => salvar.run(...cs.map((c) => x[c] ?? null))))();
    resultado[tabela] = (data || []).length;
  }
  return resultado;
}

module.exports = { fotografia, registrarFotografia, listarFotografias, popularCadastrosMestre, familias, matriz, mestres, pendenciaPrincipal, pendenciasOperacionais,
  sincronizarMestresCompartilhados, baixarMestresCompartilhados };
