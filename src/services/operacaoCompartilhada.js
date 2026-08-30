/* Cache operacional: Supabase é a fonte compartilhada; SQLite atende o motor local. */
const db = require('../db');
const supabase = require('./supabase');

const CAMPOS = {
  empresas: ['id','cnpj','razao_social','nome_fantasia','regime','uf','municipio','cnae','atividade','faturamento_anual','setor','reducao_padrao','codigo_questor','observacoes','criado_em'],
  empresa_servicos_fiscais: ['id','empresa_id','chave','nbs','descricao','pis_cofins','das_efetivo','iss_aliquota','ativo','origem','criado_em','atualizado_em'],
  parceiros: ['id','empresa_id','tipo','cnpj','descricao','regime','faturamento_anual','uf','municipio','origem','criado_em','regime_resolvido','perfil_economico','perfil_origem','sensibilidade_credito','sensibilidade_origem'],
  lotes: ['id','empresa_id','tipo','arquivo','registros','ignorados','valor_total','mensagens','origem','criado_em'],
  movimentos: ['id','empresa_id','lote_id','tipo','nome','inscr_federal','descricao','ncm','nbs','cfop','cst','competencia','valor','base_calculo','icms','icms_st','ipi','pis','cofins','pis_cofins_documentado','iss','regime','reducao','aliq_especifica','cclasstrib','classificacao_origem','cst_declarado','cclasstrib_declarado','ibs_declarado','cbs_declarado','documento','item_numero','chave','emitente_cnpj','destinatario_cnpj','codigo_produto','quantidade','unidade','csosn','data_emissao','frete','seguro','outras','desconto','sentido','origem','criado_em'],
  perfil_tributario: ['id','empresa_id','competencia','receita_bruta','receita_mercadorias','receita_servicos','receita_exportacao','icms','iss','ipi','pis','cofins','das','creditos_tomados','origem','criado_em'],
  formacao_custo_itens: ['id','empresa_id','codigo','descricao','tipo','sku','gtin','ncm','nbs','unidade','centro_custo','despesas_variaveis','movimento_saida_id','ativo','status_formacao_custo','origem','criado_em','atualizado_em'],
  formacao_custo_componentes: ['id','item_formacao_id','movimento_id','codigo_origem','descricao_origem','relacionamento','criterio_rateio','percentual_rateio','quantidade','unidade','status_alocacao_credito','observacoes','criado_em','atualizado_em'],
  excecoes_motor: ['id','empresa_id','movimento_id','execucao_id','codigo','categoria','gravidade','status','natureza','origem','valor_envolvido','impacto_cbs_estimado','materialidade','detalhe','criado_em','atualizado_em','resolvido_em'],
  excecoes_motor_execucoes: ['id','empresa_id','execucao_id','movimento_id','codigo','categoria','gravidade','status','natureza','origem','valor_envolvido','impacto_cbs_estimado','materialidade','detalhe','criado_em'],
  telemetria_autonomia_execucoes: ['execucao_id','empresa_id','meta_autonomia','total_operacoes','operacoes_autonomas','operacoes_intervencao','taxa_autonomia','taxa_determinacao','taxa_simulacao','taxa_indeterminacao_automatica','taxa_intervencao_humana','taxa_autonomia_calculo_cbs_propria','taxa_autonomia_credito_entrada','taxa_autonomia_credito_cliente','taxa_autonomia_classificatoria','taxa_autonomia_diagnostico_completo','estados_json','dimensoes_json','criado_em','atualizado_em'],
  enriquecimento_servicos_evidencias: ['id','empresa_id','movimento_id','ctribnac_original','lc116_canonico','nbs_original','indop','onerosa','exterior','local_incidencia','descricao_estruturada','cclasstrib','origem_evidencia','status_validacao','criado_em'],
  enriquecimento_pis_cofins_evidencias: ['id','empresa_id','movimento_id','pis_documentado','cofins_documentada','cst_pis','cst_cofins','regime_incidencia','sped_referencia','referencia_fiscal_empresa_item','tratamento_especifico','vigencia_inicio','vigencia_fim','origem_evidencia','status_validacao','criado_em'],
  pendencias_enriquecimento_fiscal: ['id','empresa_id','movimento_id','resultado_id','tipo_pendencia','evidencia_necessaria','prioridade','status','origem','detalhe','criado_em','resolvido_em'],
  processamentos_carteira: ['id','tipo','status','total_empresas','processadas','automaticas','com_premissas','com_excecoes','bloqueadas','iniciado_em','concluido_em','criado_em'],
  processamentos_carteira_itens: ['id','processamento_id','empresa_id','status','motivo','itens_processados','excecoes_abertas','iniciado_em','concluido_em'],
  perfil_cbs_competencias: ['id','empresa_id','competencia','receita_bruta','compras_brutas','base_economica_saidas','base_economica_entradas','cbs_debito','cbs_credito','cbs_liquida','aliquota_efetiva_cbs_saida','taxa_recuperacao_cbs_entrada','receita_tributacao_integral','receita_reducao_cbs','receita_aliquota_zero_cbs','receita_imunidade_cbs','receita_regime_especifico_cbs','receita_beneficio_governo_cbs','receita_tratamento_indeterminado_cbs','compras_credito_normal','compras_credito_limitado','compras_credito_simples','compras_credito_presumido','compras_sem_credito','compras_credito_indeterminado','cobertura_classificacao_cbs','cobertura_base_economica','cobertura_credito_cbs','percentual_real','percentual_calculado','percentual_simulado','percentual_indeterminado','quantidade_documentos','quantidade_operacoes','motor_execucao_id','atualizado_em'],
  base_ncm: ['id','ncm','descricao','cst','cclasstrib','classificacao','anexo','fundamento','reducao_ibs','reducao_cbs','regra','fonte','candidatos','reducao','operacao_pis_cofins','cst_pis_atual','cst_cofins_atual','pis_percentual','cofins_percentual','regime_pis_cofins_receita','tratamento_pis_cofins','papel_na_cadeia_necessario','papel_na_cadeia','tratamento_efetivo_saida','natureza_reconstrucao','percentual_reconstrucao_sugerido','regra_precedencia'],
  base_servicos: ['id','lc116','nbs','descricao_item','descricao_nbs','onerosa','exterior','indop','local_incidencia','cclasstrib','nome_cclasstrib','reducao','operacao_pis_cofins','cst_pis_atual','cst_cofins_atual','pis_percentual','cofins_percentual','cumulatividade_obrigatoria','grau_determinacao','hipotese_legal_cumulativa','pis_cumulativo_percentual','cofins_cumulativo_percentual','total_cumulativo_percentual','fundamento_cumulatividade','condicao_cumulatividade','regime_pis_cofins_receita','tratamento_pis_cofins','papel_na_cadeia_necessario','tratamento_efetivo_saida','natureza_reconstrucao','percentual_reconstrucao_sugerido','regra_precedencia'],
  turmas: ['id','empresa_id','trilha','titulo','formato','data','carga_horaria','instrutor','limite_participantes','status','observacoes'],
  participantes: ['id','turma_id','empresa_id','nome','area','email','presenca','nota_avaliacao'],
  regras_governo: ['id','tipo','chave','lc116','nbs','ncm','descricao','tratamento','cst','cclasstrib','indop','reducao','aliquota_zero','ente_elegivel','condicoes','fundamento','vigencia','fonte','origem_linha'],
  // Precificação é uma base própria, mas não pode ficar restrita ao disco
  // efêmero do Render. Estas tabelas são sincronizadas como fatos
  // operacionais; nenhum dado fiscal é inferido ou compartilhado por NCM/NBS.
  pricing_products: ['id','empresa_id','codigo','descricao','ncm','unidade','quantidade_producao','valor_venda_atual','custo_direto','perfil_cliente','ativo','origem','criado_em','atualizado_em'],
  pricing_services: ['id','empresa_id','codigo','descricao','lc116','nbs','unidade','quantidade_producao','valor_venda_atual','custo_direto','perfil_cliente','ativo','origem','criado_em','atualizado_em'],
  pricing_components: ['id','empresa_id','produto_saida_id','servico_saida_id','codigo_componente','descricao','tipo_componente','ncm','nbs','lc116','cnpj_fornecedor','regime_fornecedor','quantidade','custo_unitario_bruto','perda_percentual','ativo','origem','criado_em','atualizado_em'],
  pricing_import_batches: ['id','empresa_id','arquivo','status','resumo','criado_em'],
  // Fotografia imutável do simulador, lida por Contratos somente mediante
  // vínculo explícito. Ela é sincronizada como resultado já produzido.
  pricing_simulacoes: ['id','empresa_id','modo','parametros_json','resultados_json','origem','natureza','criado_em'],
  // Contratos é uma base documental compartilhada. Seus fatos não passam por
  // motor tributário: a sincronização preserva original, extração, risco,
  // recomendação e rascunho como camadas diferentes.
  contratos: ['id','empresa_id','tipo','contraparte','cnpj_contraparte','regime_contraparte','objeto','valor','vigencia_inicio','vigencia_fim','reajuste','preco_com_tributo','status','risco','parecer','criado_em','nome','moeda','periodicidade_reajuste','tipo_relacao','renovacao','observacoes','arquivo_origem','status_analise','natureza_contrato','natureza_contrato_origem','natureza_contrato_evidencia'],
  contrato_checklist: ['id','contrato_id','clausula_id','situacao','observacao'],
  contrato_documentos: ['id','empresa_id','contrato_id','nome_original','mime_type','tipo_origem','conteudo_original','hash_original','tamanho_bytes','texto_extraido','status_extracao','observacao_extracao','criado_em'],
  contrato_clausulas_extraidas: ['id','documento_id','contrato_id','ordem','texto_original','localizacao','pagina','secao','tema','confianca','natureza','criado_em'],
  contrato_riscos_iniciais: ['id','documento_id','contrato_id','clausula_id','codigo','risco','evidencia','impacto_potencial','nivel','fundamento','natureza','status','criado_em'],
  contrato_precificacao_vinculos: ['id','contrato_id','tipo_item','item_precificacao_id','pricing_simulacao_id','status','origem','observacoes','confirmado_em','criado_em'],
  contrato_recomendacoes: ['id','contrato_id','risco_id','clausula_id','recomendacao','evidencia','impacto_potencial','prioridade','fundamento','natureza','origem','criado_em'],
  contrato_sugestoes_clausulas: ['id','contrato_id','risco_id','clausula_original','sugestao_redacao','motivo','impacto_esperado','fundamento','natureza','status','criado_em'],
  monitoring_baselines: ['id','empresa_id','versao','data_aprovacao','origem','descricao','cenario_referencia','premissas_aprovadas','indicadores_aprovados','composicao_fornecedores','composicao_clientes','classificacoes_esperadas','recomendacoes_aprovadas','natureza','memoria','criado_em'],
  monitoring_snapshots: ['id','empresa_id','periodo','origem','natureza','indicadores_realizados','composicao_fornecedores','composicao_clientes','classificacoes_reais','cobertura_dados','memoria','criado_em'],
  monitoring_comparisons: ['id','empresa_id','baseline_id','snapshot_id','status','memoria','criado_em'],
  monitoring_deviations: ['id','comparison_id','metrica','tipo','baseline_valor','realizado_valor','diferenca_absoluta','diferenca_percentual','status','causa','evidencia','acao_sugerida','natureza','memoria','criado_em'],
  monitoring_alerts: ['id','empresa_id','desvio_id','titulo','mensagem','prioridade','impacto','evidencia','natureza','status','criado_em'],
  monitoring_actions: ['id','empresa_id','desvio_id','acao','responsavel','prazo','prioridade','status','evidencia','origem','criado_em','atualizado_em'],
};
const CONFIG_TABELAS = ['param_regras','param_aliquotas','param_tributos','param_regimes','param_reducoes','param_cfop','param_simples','servicos','combos','combo_itens'];
const TABELAS_PRECIFICACAO = ['pricing_products','pricing_services','pricing_components','pricing_import_batches'];
const TABELAS_CONTRATOS = ['contratos','contrato_checklist','contrato_documentos','contrato_clausulas_extraidas','contrato_riscos_iniciais','contrato_precificacao_vinculos','contrato_recomendacoes','contrato_sugestoes_clausulas'];
const TABELAS_ACOMPANHAMENTO = ['monitoring_baselines','monitoring_snapshots','monitoring_comparisons','monitoring_deviations','monitoring_alerts','monitoring_actions'];

function ativo() { return supabase.configurado() && process.env.SUPABASE_OPERACAO_COMPARTILHADA !== 'false'; }
async function buscarTudo(remoto, tabela) {
  const linhas = []; const tamanho = 1000;
  for (let de = 0;; de += tamanho) {
    const { data, error } = await remoto.from(tabela).select('*').range(de, de + tamanho - 1);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if (!data || data.length < tamanho) return linhas;
  }
}
function gravar(tabela, linhas) {
  if (!linhas.length) return 0;
  const campos = CAMPOS[tabela];
  // Exceções têm unicidade funcional por empresa + movimento + código; o ID
  // pode divergir entre cache e Supabase. Usar a chave errada interrompia uma
  // baixa antes da fotografia e deixava o cache local incompleto.
  const conflito = tabela === 'excecoes_motor' ? '(empresa_id,movimento_id,codigo)'
    : tabela === 'telemetria_autonomia_execucoes' ? '(execucao_id)'
      : tabela === 'regras_governo' ? '(tipo,chave,cclasstrib)' : '(id)';
  const excluirAtualizacao = tabela === 'excecoes_motor' ? ['id','empresa_id','movimento_id','codigo']
    : tabela === 'telemetria_autonomia_execucoes' ? ['execucao_id']
      : tabela === 'regras_governo' ? ['id','tipo','chave','cclasstrib'] : ['id'];
  const sql = `INSERT INTO ${tabela} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})
    ON CONFLICT${conflito} DO UPDATE SET ${campos.filter((x) => !excluirAtualizacao.includes(x)).map((x) => `${x}=excluded.${x}`).join(',')}`;
  const inserir = db.prepare(sql);
  const valorLocal = (x, c) => {
    const v = x[c];
    // PostgREST representa bytea como texto hexadecimal. Recuperar o Buffer
    // garante que o download entregue exatamente o original preservado.
    if (tabela === 'contrato_documentos' && c === 'conteudo_original' && typeof v === 'string' && v.startsWith('\\x')) return Buffer.from(v.slice(2), 'hex');
    // O PostgREST materializa json/jsonb como objeto. SQLite armazena estes
    // campos em TEXT; serializá-los preserva integralmente a fotografia e
    // impede que um objeto interrompa a reposição transacional do cache.
    if (v && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date)) return JSON.stringify(v);
    return v ?? null;
  };
  db.transaction(() => linhas.forEach((x) => inserir.run(...campos.map((c) => valorLocal(x, c)))))();
  return linhas.length;
}
function gravarConfiguracao(tabela, linhas) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name);
  if (!colunas.length) return;
  db.transaction(() => {
    if (!linhas.length) return;
    const inserir = db.prepare(`INSERT OR REPLACE INTO ${tabela} (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})`);
    linhas.forEach((linha) => inserir.run(...colunas.map((c) => linha[c] ?? null)));
  })();
}
function gravarGestao(projetos, entregas, acompanhamentos, responsaveis = [], tarefas = []) {
  const comboPorNome = new Map(db.prepare('SELECT id,nome FROM combos').all().map((x) => [x.nome, x.id]));
  const localPorRemoto = new Map();
  const entregaLocalPorRemota = new Map();
  const insProjeto = db.prepare(`INSERT INTO contratacoes (id,empresa_id,combo_id,servicos_json,valor_bruto,desconto,valor_final,status,observacoes,criado_em,aprovado_em,competencia_referencia,acompanhamento_meses,modulos_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET empresa_id=excluded.empresa_id,combo_id=excluded.combo_id,servicos_json=excluded.servicos_json,status=excluded.status,aprovado_em=excluded.aprovado_em,competencia_referencia=excluded.competencia_referencia,acompanhamento_meses=excluded.acompanhamento_meses,modulos_json=excluded.modulos_json`);
  const insEntrega = db.prepare(`INSERT INTO projeto_entregas (id,contratacao_id,chave,titulo,status,concluido_em,observacoes) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET contratacao_id=excluded.contratacao_id,chave=excluded.chave,titulo=excluded.titulo,status=excluded.status,concluido_em=excluded.concluido_em,observacoes=excluded.observacoes`);
  const insAcomp = db.prepare(`INSERT INTO projeto_acompanhamentos (id,contratacao_id,competencia,nome,status,observacoes,criado_em) VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET contratacao_id=excluded.contratacao_id,competencia=excluded.competencia,nome=excluded.nome,status=excluded.status,observacoes=excluded.observacoes`);
  db.transaction(() => {
    for (const p of projetos) {
      const id = Number(p.origem_local_contratacao_id);
      if (!id) continue;
      localPorRemoto.set(p.id, id);
      const escopo = Array.isArray(p.escopo) ? p.escopo : [];
      insProjeto.run(id, p.empresa_id, comboPorNome.get(p.nome_plano) || null, JSON.stringify(escopo), 0, 0, 0,
        p.status || 'rascunho', '', p.criado_em || null, p.aprovado_em || null, p.competencia_referencia || null,
        Number(p.acompanhamento_meses) || 0, JSON.stringify(escopo));
    }
    for (const e of entregas) {
      const contratacaoId = localPorRemoto.get(e.projeto_id); const id = Number(e.origem_local_id);
      if (contratacaoId && id) { insEntrega.run(id, contratacaoId, e.chave, e.titulo, e.status, e.concluido_em || null, e.observacoes || null); entregaLocalPorRemota.set(e.id, id); }
    }
    for (const a of acompanhamentos) {
      const contratacaoId = localPorRemoto.get(a.projeto_id); const id = Number(a.origem_local_id);
      if (contratacaoId && id) insAcomp.run(id, contratacaoId, a.competencia, a.nome || '', a.status, a.observacoes || '', a.criado_em || null);
    }
    const insResp = db.prepare('INSERT OR REPLACE INTO projeto_responsaveis (id,contratacao_id,entrega_id,lado,nome,telefone,email,funcao,criado_em) VALUES (?,?,?,?,?,?,?,?,?)');
    const insTarefa = db.prepare('INSERT OR REPLACE INTO projeto_tarefas (id,contratacao_id,entrega_id,titulo,descricao,status,data_abertura,data_conclusao,envolve_cliente,pendencia_cliente,interacoes_cliente,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    for (const r of responsaveis) { const entregaId=entregaLocalPorRemota.get(r.entrega_id); const contratacaoId=localPorRemoto.get(r.projeto_id); const id=Number(r.origem_local_id); if(contratacaoId&&id) insResp.run(id,contratacaoId,entregaId||null,r.lado,r.nome,r.telefone||'',r.email||'',r.funcao||'',r.criado_em||null); }
    for (const t of tarefas) { const entregaId=entregaLocalPorRemota.get(t.entrega_id); const contratacaoId=localPorRemoto.get(t.projeto_id); const id=Number(t.origem_local_id); if(contratacaoId&&entregaId&&id) insTarefa.run(id,contratacaoId,entregaId,t.titulo,t.descricao||'',t.status,t.data_abertura||null,t.data_conclusao||null,t.envolve_cliente?1:0,t.pendencia_cliente||'',t.interacoes_cliente||'',t.criado_em||null,t.atualizado_em||null); }
  })();
  return { projetos: localPorRemoto.size, entregas: entregas.length, acompanhamentos: acompanhamentos.length, responsaveis: responsaveis.length, tarefas: tarefas.length };
}
async function baixar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  // Acompanhamento é uma fotografia operacional: o cache não pode manter
  // registros já excluídos da fonte compartilhada. Primeiro lemos todo o
  // conjunto; somente após essa leitura bem-sucedida substituímos o espelho
  // local em ordem segura. Assim uma falha de rede não apaga o cache.
  const acompanhamentoRemoto = {};
  for (const tabela of TABELAS_ACOMPANHAMENTO) acompanhamentoRemoto[tabela] = await buscarTudo(remoto, tabela);
  db.transaction(() => {
    ['monitoring_actions','monitoring_alerts','monitoring_deviations','monitoring_comparisons','monitoring_snapshots','monitoring_baselines']
      .forEach((tabela) => db.prepare(`DELETE FROM ${tabela}`).run());
  })();
  for (const tabela of Object.keys(CAMPOS)) {
    const linhas = TABELAS_ACOMPANHAMENTO.includes(tabela) ? acompanhamentoRemoto[tabela] : await buscarTudo(remoto, tabela);
    // Exceções são um espelho operacional completo do Supabase e possuem duas
    // chaves únicas (id técnico e chave funcional). Limpar somente esse
    // espelho antes da reposição elimina colisões entre IDs legados sem tocar
    // em qualquer fonte remota.
    if (tabela === 'excecoes_motor') db.prepare('DELETE FROM excecoes_motor').run();
    // Regras governamentais também são fotografia completa. A tabela possui
    // tanto id técnico quanto unicidade funcional; limpar o espelho evita que
    // um ID local legado colida com uma regra remota de chave diferente.
    if (tabela === 'regras_governo') db.prepare('DELETE FROM regras_governo').run();
    resultado[tabela] = gravar(tabela, linhas);
  }
  resultado.motor = await baixarResultadosMotor(remoto);
  Object.assign(resultado, await baixarConfiguracao(CONFIG_TABELAS, remoto));
  resultado.gestao = await baixarGestao(remoto);
  return resultado;
}

// Fotografia técnica compartilhada: reiniciar uma instância não pode significar
// recalcular toda a carteira. O motor só roda novamente após importação,
// alteração de regra ou pedido explícito de recálculo.
function gravarLinhasComColunas(tabela, linhas, dentroDaTransacao = false) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name);
  if (!colunas.length || !linhas.length) return 0;
  const inserir = db.prepare(`INSERT OR REPLACE INTO ${tabela} (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})`);
  const gravar = () => linhas.forEach((x) => inserir.run(...colunas.map((c) => x[c] ?? null)));
  if (dentroDaTransacao) gravar(); else db.transaction(gravar)();
  return linhas.length;
}
async function baixarResultadosMotor(remotoInformado = null) {
  const remoto = remotoInformado || supabase.admin();
  const execucoes = await buscarTudo(remoto, 'motor_execucoes_operacionais');
  // O histórico permanece no Supabase, mas o SQLite que atende as telas deve
  // receber exclusivamente a fotografia ativa. Sem este filtro, uma execução
  // anterior seria somada novamente após qualquer reinício da instância.
  const resultados = [];
  for (let de = 0;; de += 1000) {
    const { data, error } = await remoto.from('motor_resultados_operacionais').select('*').eq('ativo', true).range(de, de + 999);
    if (error) throw new Error(`motor_resultados_operacionais: ${error.message}`);
    resultados.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  // Validação obrigatória antes de apagar a fotografia local. Uma fotografia
  // operacional não pode referenciar movimento que ainda não chegou à base
  // local; anteriormente o delete ocorria antes dessa checagem e uma falha
  // de chave estrangeira deixava o cache sem resultados.
  const locais = new Set(db.prepare('SELECT id FROM movimentos').all().map((x) => Number(x.id)));
  const ausentes = resultados.map((x) => Number(x.movimento_id)).filter((id) => !locais.has(id));
  if (ausentes.length) throw new Error(`Fotografia compartilhada referencia ${ausentes.length} movimento(s) ausente(s) no cache local: ${ausentes.slice(0, 20).join(', ')}. Sincronize a operação antes de substituir a fotografia.`);
  const gravarExecucoes = (execs) => gravarLinhasComColunas('motor_execucoes', execs.map((x) => x.dados || x), true);
  const gravarResultados = (itens) => gravarLinhasComColunas('motor_resultados', itens.map((x) => x.dados || x), true);
  let quantidadeExecucoes = 0, quantidadeResultados = 0;
  db.transaction(() => {
    db.prepare('DELETE FROM motor_resultados').run(); db.prepare('DELETE FROM motor_execucoes').run();
    quantidadeExecucoes = gravarExecucoes(execucoes); quantidadeResultados = gravarResultados(resultados);
  })();
  return {
    execucoes: quantidadeExecucoes,
    resultados: quantidadeResultados,
  };
}
async function publicarResultadosMotor(empresaId = null) {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin();
  const filtro = empresaId == null ? '' : ' WHERE empresa_id=?';
  const parametros = empresaId == null ? [] : [empresaId];
  const execucoes = db.prepare(`SELECT * FROM motor_execucoes${filtro}`).all(...parametros)
    .map((x) => ({ id: x.id, empresa_id: x.empresa_id, dados: x }));
  const resultados = db.prepare(`SELECT * FROM motor_resultados${filtro}`).all(...parametros)
    .map((x) => ({ id: x.id, empresa_id: x.empresa_id, movimento_id: x.movimento_id, dados: x,
      tipo_credito: x.tipo_credito, modalidade_credito: x.modalidade_credito,
      status_credito_determinacao: x.status_credito_determinacao,
      regime_cbs_emitente: x.regime_cbs_emitente, regime_cbs_adquirente: x.regime_cbs_adquirente,
      estado_autonomia: x.estado_autonomia, codigo_causa: x.codigo_causa,
      origem_resolucao: x.origem_resolucao, requer_intervencao_humana: x.requer_intervencao_humana }));
  for (const [tabela, linhas] of [['motor_execucoes_operacionais', execucoes], ['motor_resultados_operacionais', resultados]]) {
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await remoto.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
  }
  const telemetrias = db.prepare(`SELECT * FROM telemetria_autonomia_execucoes${filtro}`).all(...parametros);
  const excecoesExecucao = db.prepare(`SELECT * FROM excecoes_motor_execucoes${filtro}`).all(...parametros);
  if (telemetrias.length) {
    const { error } = await remoto.from('telemetria_autonomia_execucoes').upsert(telemetrias, { onConflict: 'execucao_id' });
    if (error) throw new Error(`telemetria_autonomia_execucoes: ${error.message}`);
  }
  if (excecoesExecucao.length) {
    for (let i = 0; i < excecoesExecucao.length; i += 500) {
      const { error } = await remoto.from('excecoes_motor_execucoes').upsert(excecoesExecucao.slice(i, i + 500), { onConflict: 'empresa_id,execucao_id,movimento_id,codigo' });
      if (error) throw new Error(`excecoes_motor_execucoes: ${error.message}`);
    }
  }
  return { execucoes: execucoes.length, resultados: resultados.length, telemetrias: telemetrias.length, excecoes_execucao: excecoesExecucao.length };
}
// Parâmetros fiscais e de cálculo podem ser restaurados isoladamente do resto
// do cache. É usado antes de a aplicação entregar qualquer alíquota à tela ou
// ao motor, evitando que uma instância recém-iniciada use valor antigo.
async function baixarConfiguracao(tabelas = CONFIG_TABELAS, remotoInformado = null) {
  // Parâmetros fiscais nunca dependem da chave que habilita/desabilita a
  // sincronização operacional completa. Com as credenciais presentes, a fonte
  // compartilhada é obrigatória para impedir divergência de alíquotas.
  if (!supabase.configurado()) return { ativo: false };
  const remoto = remotoInformado || supabase.admin();
  const { data: configuracoes, error } = await remoto.from('parametros_operacionais').select('chave,dados').eq('tabela', 'configuracao');
  if (error && !String(error.message).includes('does not exist')) throw error;
  const porChave = new Map((configuracoes || []).map((x) => [x.chave, x.dados]));
  const resultado = {};
  for (const tabela of tabelas) {
    const dados = porChave.get(tabela);
    if (Array.isArray(dados)) { gravarConfiguracao(tabela, dados); resultado[`config_${tabela}`] = dados.length; }
  }
  return resultado;
}
async function publicarConfiguracao(tabelas = CONFIG_TABELAS) {
  if (!supabase.configurado()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  for (const tabela of tabelas) {
    const linhas = db.prepare(`SELECT * FROM ${tabela}`).all();
    const { error } = await remoto.from('parametros_operacionais').upsert({ tabela: 'configuracao', chave: tabela, dados: linhas }, { onConflict: 'tabela,chave' });
    if (error) throw new Error(`${tabela}: ${error.message}`);
    resultado[`config_${tabela}`] = linhas.length;
  }
  return resultado;
}
// A gestão tem prioridade operacional: ela não pode deixar de ser restaurada
// só porque uma base auxiliar de diagnóstico apresentou alguma falha na carga.
async function baixarGestao(remotoInformado = null) {
  if (!ativo()) return { ativo: false };
  const remoto = remotoInformado || supabase.admin();
  return gravarGestao(await buscarTudo(remoto, 'projetos'), await buscarTudo(remoto, 'projeto_entregas'), await buscarTudo(remoto, 'projeto_acompanhamentos'), await buscarTudo(remoto, 'projeto_responsaveis'), await buscarTudo(remoto, 'projeto_tarefas'));
}
async function publicar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  for (const [tabela, campos] of Object.entries(CAMPOS)) {
    if (TABELAS_PRECIFICACAO.includes(tabela) || TABELAS_CONTRATOS.includes(tabela)) continue;
    const linhas = db.prepare(`SELECT ${campos.join(',')} FROM ${tabela}`).all();
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await remoto.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
    resultado[tabela] = linhas.length;
  }
  // A importação de Precificação substitui a base inteira da empresa. Upsert
  // por ID não propaga exclusões e pode manter componentes apontando para IDs
  // de uma instância efêmera anterior do Render. Replicar a fotografia da
  // empresa, na ordem de dependência, preserva a relação econômica explícita.
  const empresas = db.prepare('SELECT id FROM empresas').all();
  for (const empresa of empresas) {
    const empresaId = empresa.id;
    for (const tabela of ['pricing_components','pricing_import_batches','pricing_products','pricing_services']) {
      const { error } = await remoto.from(tabela).delete().eq('empresa_id', empresaId);
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
    for (const tabela of ['pricing_products','pricing_services','pricing_components','pricing_import_batches']) {
      const campos = CAMPOS[tabela];
      const linhas = db.prepare(`SELECT ${campos.join(',')} FROM ${tabela} WHERE empresa_id=?`).all(empresaId);
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await remoto.from(tabela).insert(linhas.slice(i, i + 500));
        if (error) throw new Error(`${tabela}: ${error.message}`);
      }
      resultado[tabela] = (resultado[tabela] || 0) + linhas.length;
    }
  }
  // Contratos usam uma fotografia por empresa porque uma exclusão local deve
  // também remover somente o mesmo contrato remoto. A ordem preserva todas as
  // chaves estrangeiras; o original binário é serializado como bytea hex.
  for (const empresa of empresas) await publicarContratos(remoto, empresa.id);
  // Parâmetros fiscais não acompanham esta publicação genérica. O banco local
  // do Render pode iniciar com valores padrão e jamais pode sobrescrever a
  // configuração compartilhada por causa de uma alteração operacional (por
  // exemplo, importação, tarefa ou cadastro). Eles são publicados apenas por
  // suas rotas específicas, depois de uma alteração explícita do consultor.
  return resultado;
}

function linhaRemotaContrato(tabela, linha) {
  if (tabela !== 'contrato_documentos' || !Buffer.isBuffer(linha.conteudo_original)) return linha;
  return { ...linha, conteudo_original: `\\x${linha.conteudo_original.toString('hex')}` };
}
async function publicarContratos(remoto, empresaId) {
  const contratos = db.prepare(`SELECT ${CAMPOS.contratos.join(',')} FROM contratos WHERE empresa_id=?`).all(empresaId);
  // A exclusão fica restrita à empresa da fotografia e o FK em cascata remove
  // apenas as dependências daqueles contratos, nunca dados de outras empresas.
  const { error: apagar } = await remoto.from('contratos').delete().eq('empresa_id', empresaId);
  if (apagar) throw new Error(`contratos: ${apagar.message}`);
  const porContrato = contratos.map((x) => x.id);
  if (!porContrato.length) return { contratos: 0 };
  for (const tabela of TABELAS_CONTRATOS) {
    let linhas;
    if (tabela === 'contratos') linhas = contratos;
    else if (tabela === 'contrato_documentos') linhas = db.prepare(`SELECT ${CAMPOS[tabela].join(',')} FROM ${tabela} WHERE empresa_id=?`).all(empresaId);
    else {
      const campoContrato = tabela === 'contrato_checklist' ? 'contrato_id' : 'contrato_id';
      linhas = db.prepare(`SELECT ${CAMPOS[tabela].join(',')} FROM ${tabela} WHERE ${campoContrato} IN (${porContrato.map(() => '?').join(',')})`).all(...porContrato);
    }
    for (let i = 0; i < linhas.length; i += 250) {
      const { error } = await remoto.from(tabela).insert(linhas.slice(i, i + 250).map((x) => linhaRemotaContrato(tabela, x)));
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
  }
  return { contratos: contratos.length };
}
module.exports = { ativo, baixar, baixarConfiguracao, publicarConfiguracao, baixarGestao, publicar,
  baixarResultadosMotor, publicarResultadosMotor };
