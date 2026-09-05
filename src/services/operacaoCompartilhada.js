/* Cache operacional: Supabase é a fonte compartilhada; SQLite atende o motor local. */
const db = require('../db');
const supabase = require('./supabase');

const CAMPOS = {
  empresas: ['id','cnpj','razao_social','nome_fantasia','regime','uf','municipio','cnae','atividade','faturamento_anual','setor','reducao_padrao','codigo_questor','observacoes','criado_em'],
  empresa_servicos_fiscais: ['id','empresa_id','chave','nbs','descricao','pis_cofins','das_efetivo','iss_aliquota','ativo','origem','criado_em','atualizado_em'],
  parceiros: ['id','empresa_id','tipo','cnpj','descricao','regime','faturamento_anual','uf','municipio','origem','criado_em','regime_resolvido','perfil_economico','perfil_origem','sensibilidade_credito','sensibilidade_origem'],
  empresa_qsa: ['id','empresa_id','nome','documento','qualificacao','pais','percentual_participacao','brasileiro','fonte','consultado_em','origem','criado_em','atualizado_em'],
  lotes: ['id','empresa_id','tipo','arquivo','registros','ignorados','valor_total','mensagens','origem','criado_em'],
  movimentos: ['id','empresa_id','lote_id','tipo','nome','inscr_federal','descricao','ncm','nbs','lc116','normalizacao_status','normalizacao_pendencia','normalizacao_evidencia','cfop','cst','competencia','valor','base_calculo','icms','icms_st','ipi','pis','cofins','pis_cofins_documentado','iss','regime','reducao','aliq_especifica','cclasstrib','classificacao_origem','cst_declarado','cclasstrib_declarado','ibs_declarado','cbs_declarado','documento','item_numero','chave','emitente_cnpj','destinatario_cnpj','codigo_produto','quantidade','unidade','csosn','data_emissao','frete','seguro','outras','desconto','sentido','origem','criado_em'],
  perfil_tributario: ['id','empresa_id','competencia','receita_bruta','receita_mercadorias','receita_servicos','receita_exportacao','icms','iss','ipi','pis','cofins','das','creditos_tomados','origem','criado_em'],
  folhas_pagamento_competencias: ['id','empresa_id','competencia','valor_folha','pro_labore','origem','referencia_arquivo','status_validacao','criado_em','atualizado_em'],
  margens_operacionais_premissas: ['id','empresa_id','periodo_inicio','periodo_fim','margem_operacional_percentual','origem','natureza','status_validacao','criado_em','atualizado_em'],
  receitas_sem_dfe: ['id','empresa_id','competencia','tipo_receita','descricao','valor','origem','evidencia','status_validacao','chave_deduplicacao','criado_em','atualizado_em'],
  formacao_custo_itens: ['id','empresa_id','codigo','descricao','tipo','sku','gtin','ncm','nbs','unidade','centro_custo','despesas_variaveis','movimento_saida_id','ativo','status_formacao_custo','origem','criado_em','atualizado_em'],
  formacao_custo_componentes: ['id','item_formacao_id','movimento_id','codigo_origem','descricao_origem','relacionamento','criterio_rateio','percentual_rateio','quantidade','unidade','status_alocacao_credito','observacoes','criado_em','atualizado_em'],
  excecoes_motor: ['id','empresa_id','movimento_id','execucao_id','codigo','categoria','gravidade','status','natureza','origem','valor_envolvido','impacto_cbs_estimado','materialidade','detalhe','criado_em','atualizado_em','resolvido_em'],
  excecoes_motor_execucoes: ['id','empresa_id','execucao_id','movimento_id','codigo','categoria','gravidade','status','natureza','origem','valor_envolvido','impacto_cbs_estimado','materialidade','detalhe','criado_em'],
  telemetria_autonomia_execucoes: ['execucao_id','empresa_id','meta_autonomia','total_operacoes','operacoes_autonomas','operacoes_intervencao','taxa_autonomia','taxa_determinacao','taxa_simulacao','taxa_indeterminacao_automatica','taxa_intervencao_humana','taxa_autonomia_calculo_cbs_propria','taxa_autonomia_credito_entrada','taxa_autonomia_credito_cliente','taxa_autonomia_classificatoria','taxa_autonomia_diagnostico_completo','estados_json','dimensoes_json','criado_em','atualizado_em'],
  enriquecimento_servicos_evidencias: ['id','empresa_id','movimento_id','ctribnac_original','lc116_canonico','nbs_original','indop','onerosa','exterior','local_incidencia','descricao_estruturada','cclasstrib','origem_evidencia','status_validacao','criado_em'],
  enriquecimento_pis_cofins_evidencias: ['id','empresa_id','movimento_id','pis_documentado','cofins_documentada','cst_pis','cst_cofins','regime_incidencia','sped_referencia','referencia_fiscal_empresa_item','tratamento_especifico','vigencia_inicio','vigencia_fim','origem_evidencia','status_validacao','tipo_fonte','lote_origem_id','hash_lineage','numero_documento','serie','base_pis','base_cofins','aliquota_pis','aliquota_cofins','natureza_credito','condicao_credito','grau_confianca','criado_em'],
  pendencias_enriquecimento_fiscal: ['id','empresa_id','movimento_id','resultado_id','tipo_pendencia','evidencia_necessaria','prioridade','status','origem','detalhe','criado_em','resolvido_em'],
  processamentos_carteira: ['id','tipo','status','total_empresas','processadas','automaticas','com_premissas','com_excecoes','bloqueadas','iniciado_em','concluido_em','criado_em'],
  processamentos_carteira_itens: ['id','processamento_id','empresa_id','status','motivo','itens_processados','excecoes_abertas','iniciado_em','concluido_em'],
  perfil_cbs_competencias: ['id','empresa_id','competencia','receita_bruta','compras_brutas','base_economica_saidas','base_economica_entradas','cbs_debito','cbs_credito','cbs_liquida','aliquota_efetiva_cbs_saida','taxa_recuperacao_cbs_entrada','receita_tributacao_integral','receita_reducao_cbs','receita_aliquota_zero_cbs','receita_imunidade_cbs','receita_regime_especifico_cbs','receita_beneficio_governo_cbs','receita_tratamento_indeterminado_cbs','compras_credito_normal','compras_credito_limitado','compras_credito_simples','compras_credito_presumido','compras_sem_credito','compras_credito_indeterminado','cobertura_classificacao_cbs','cobertura_base_economica','cobertura_credito_cbs','percentual_real','percentual_calculado','percentual_simulado','percentual_indeterminado','quantidade_documentos','quantidade_operacoes','motor_execucao_id','atualizado_em'],
  base_ncm: ['id','ncm','descricao','cst','cclasstrib','classificacao','anexo','fundamento','reducao_ibs','reducao_cbs','regra','fonte','candidatos','reducao','operacao_pis_cofins','cst_pis_atual','cst_cofins_atual','pis_percentual','cofins_percentual','regime_pis_cofins_receita','tratamento_pis_cofins','papel_na_cadeia_necessario','papel_na_cadeia','tratamento_efetivo_saida','natureza_reconstrucao','percentual_reconstrucao_sugerido','regra_precedencia'],
  base_servicos: ['id','lc116','nbs','descricao_item','descricao_nbs','onerosa','exterior','indop','local_incidencia','cclasstrib','nome_cclasstrib','reducao','operacao_pis_cofins','cst_pis_atual','cst_cofins_atual','pis_percentual','cofins_percentual','cumulatividade_obrigatoria','grau_determinacao','hipotese_legal_cumulativa','pis_cumulativo_percentual','cofins_cumulativo_percentual','total_cumulativo_percentual','fundamento_cumulatividade','condicao_cumulatividade','regime_pis_cofins_receita','tratamento_pis_cofins','papel_na_cadeia_necessario','tratamento_efetivo_saida','natureza_reconstrucao','percentual_reconstrucao_sugerido','regra_precedencia'],
  regras_enquadramento: ['id','familia','subfamilia','tipo_operacao','direcao','perfil_fornecedor','perfil_adquirente','regime_fornecedor','regime_adquirente','regime_pis_cofins','ncm','nbs','lc116','cclasstrib','cst','cfop','papel_cadeia','unidade','condicoes_obrigatorias','condicoes_excludentes','tratamento_resultante','formula_id','fundamento_legal','vigencia_inicio','vigencia_fim','prioridade','versao','status','fonte','evidencia','cst_pis','cst_cofins','pis_percentual','cofins_percentual'],
  turmas: ['id','empresa_id','trilha','titulo','formato','data','carga_horaria','instrutor','limite_participantes','status','observacoes'],
  participantes: ['id','turma_id','empresa_id','nome','area','email','presenca','nota_avaliacao'],
  regras_governo: ['id','tipo','chave','lc116','nbs','ncm','descricao','tratamento','cst','cclasstrib','indop','reducao','aliquota_zero','ente_elegivel','condicoes','fundamento','vigencia','fonte','origem_linha'],
  param_naturezas_juridicas_anexo_xi: ['codigo_natureza_juridica','descricao','categoria','elegivel_200043','fonte','versao','vigencia_inicio','vigencia_fim','status','atualizado_em'],
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
const CONFIG_TABELAS = ['param_regras','param_aliquotas','param_tributos','param_regimes','param_reducoes','param_cfop','param_simples','param_naturezas_juridicas_anexo_xi','servicos','combos','combo_itens'];
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
function gravar(tabela, linhas, dentroDaTransacao = false) {
  if (!linhas.length) return 0;
  const campos = CAMPOS[tabela];
  // Exceções têm unicidade funcional por empresa + movimento + código; o ID
  // pode divergir entre cache e Supabase. Usar a chave errada interrompia uma
  // baixa antes da fotografia e deixava o cache local incompleto.
  const conflito = tabela === 'excecoes_motor' ? '(empresa_id,movimento_id,codigo)'
    : tabela === 'telemetria_autonomia_execucoes' ? '(execucao_id)'
      : tabela === 'param_naturezas_juridicas_anexo_xi' ? '(codigo_natureza_juridica)'
      : tabela === 'regras_governo' ? '(tipo,chave,cclasstrib)' : '(id)';
  const excluirAtualizacao = tabela === 'excecoes_motor' ? ['id','empresa_id','movimento_id','codigo']
    : tabela === 'telemetria_autonomia_execucoes' ? ['execucao_id']
      : tabela === 'param_naturezas_juridicas_anexo_xi' ? ['codigo_natureza_juridica']
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
  const persistir = () => linhas.forEach((x) => inserir.run(...campos.map((c) => valorLocal(x, c))));
  if (dentroDaTransacao) persistir(); else db.transaction(persistir)();
  return linhas.length;
}

function gravarEmpresas(linhas, dentroDaTransacao = false) {
  const inserir = db.prepare(`INSERT INTO empresas
    (id,cnpj,razao_social,nome_fantasia,regime,uf,municipio,cnae,atividade,faturamento_anual,setor,reducao_padrao,codigo_questor,observacoes,criado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET cnpj=excluded.cnpj,razao_social=excluded.razao_social,nome_fantasia=excluded.nome_fantasia,
      regime=CASE WHEN excluded.regime IS NULL OR excluded.regime='' THEN empresas.regime ELSE excluded.regime END,
      uf=excluded.uf,municipio=excluded.municipio,cnae=excluded.cnae,atividade=excluded.atividade,
      faturamento_anual=excluded.faturamento_anual,setor=excluded.setor,reducao_padrao=excluded.reducao_padrao,
      codigo_questor=excluded.codigo_questor,observacoes=excluded.observacoes,criado_em=excluded.criado_em`);
  const persistir = () => linhas.forEach((empresa) => {
    const id = Number(empresa.origem_local_id || empresa.id);
    if (!id) return;
    inserir.run(id, String(empresa.cnpj || '').replace(/\D/g, ''), empresa.razao_social || 'Empresa sem razão social',
      empresa.nome_fantasia || '', empresa.regime || '', empresa.uf || '', empresa.municipio || '', empresa.cnae || '',
      empresa.atividade || '', Number(empresa.faturamento_anual) || 0, empresa.setor || '', empresa.reducao_padrao || 'integral',
      empresa.codigo_questor || '', empresa.observacoes || '', empresa.criado_em || null);
  });
  if (dentroDaTransacao) persistir(); else db.transaction(persistir)();
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
function mapaEmpresasLocais(empresas = []) {
  // Projetos no Supabase apontam para o UUID remoto da empresa, enquanto o
  // cache SQLite trabalha com o ID local de origem. Nunca usar o UUID remoto
  // como empresa_id de contratacoes: isso faz o plano aprovado desaparecer
  // para a empresa selecionada após a restauração do cache.
  return new Map((empresas || []).map((empresa) => [
    String(empresa.id), Number(empresa.origem_local_id || empresa.id),
  ]).filter(([, id]) => Number.isInteger(id) && id > 0));
}

function normalizarEmpresaIdDoCache(tabela, linhas, empresaLocalPorRemota = new Map()) {
  if (!CAMPOS[tabela]?.includes('empresa_id')) return linhas;
  return (linhas || []).map((linha) => {
    const empresaId = empresaLocalPorRemota.get(String(linha.empresa_id));
    return empresaId ? { ...linha, empresa_id: empresaId } : linha;
  });
}

function gravarEmpresaQsa(linhas, dentroDaTransacao = false) {
  if (!linhas.length) return 0;
  // IDs de sócios no Supabase podem ser UUIDs; o cache local usa chave
  // numérica. A identidade estável é empresa + nome + documento +
  // qualificação, a mesma chave usada ao publicar o QSA.
  const colunas = ['empresa_id','nome','documento','qualificacao','pais','percentual_participacao','brasileiro','fonte','consultado_em','origem','criado_em','atualizado_em'];
  const inserir = db.prepare(`INSERT INTO empresa_qsa (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})
    ON CONFLICT(empresa_id,nome,documento,qualificacao) DO UPDATE SET
      pais=CASE WHEN empresa_qsa.origem='confirmacao_manual' THEN empresa_qsa.pais ELSE excluded.pais END,
      percentual_participacao=CASE WHEN empresa_qsa.origem='confirmacao_manual' THEN empresa_qsa.percentual_participacao ELSE COALESCE(excluded.percentual_participacao, empresa_qsa.percentual_participacao) END,
      brasileiro=CASE WHEN empresa_qsa.origem='confirmacao_manual' THEN empresa_qsa.brasileiro ELSE excluded.brasileiro END,
      fonte=CASE WHEN empresa_qsa.origem='confirmacao_manual' THEN empresa_qsa.fonte ELSE excluded.fonte END,
      consultado_em=CASE WHEN empresa_qsa.origem='confirmacao_manual' THEN empresa_qsa.consultado_em ELSE excluded.consultado_em END,
      origem=CASE WHEN empresa_qsa.origem='confirmacao_manual' THEN empresa_qsa.origem ELSE excluded.origem END,
      atualizado_em=excluded.atualizado_em`);
  const persistir = () => linhas.forEach((linha) => inserir.run(...colunas.map((c) => linha[c] ?? null)));
  if (dentroDaTransacao) persistir(); else db.transaction(persistir)();
  return linhas.length;
}

function gravarGestao(projetos, entregas, acompanhamentos, responsaveis = [], tarefas = [], checklist = [], empresas = []) {
  const comboPorNome = new Map(db.prepare('SELECT id,nome FROM combos').all().map((x) => [x.nome, x.id]));
  const empresaLocalPorRemota = mapaEmpresasLocais(empresas);
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
      const empresaId = empresaLocalPorRemota.get(String(p.empresa_id))
        || (Number.isInteger(Number(p.empresa_id)) ? Number(p.empresa_id) : null);
      if (!empresaId) continue;
      localPorRemoto.set(p.id, id);
      const escopo = Array.isArray(p.escopo) ? p.escopo : [];
      insProjeto.run(id, empresaId, comboPorNome.get(p.nome_plano) || null, JSON.stringify(escopo), 0, 0, 0,
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
    const insResp = db.prepare('INSERT OR REPLACE INTO projeto_responsaveis (id,contratacao_id,entrega_id,lado,usuario_id,nome,telefone,email,funcao,criado_em) VALUES (?,?,?,?,?,?,?,?,?,?)');
    const insTarefa = db.prepare('INSERT OR REPLACE INTO projeto_tarefas (id,contratacao_id,entrega_id,titulo,descricao,status,data_abertura,data_conclusao,envolve_cliente,pendencia_cliente,interacoes_cliente,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insChecklist = db.prepare(`INSERT OR REPLACE INTO projeto_checklist_implantacao
      (id,contratacao_id,entrega_id,escopo,chave,titulo,tipo_evidencia,status,responsavel_id,origem_tipo,origem_id,observacoes,ordem,origem,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of responsaveis) { const entregaId=entregaLocalPorRemota.get(r.entrega_id); const contratacaoId=localPorRemoto.get(r.projeto_id); const id=Number(r.origem_local_id); if(contratacaoId&&id) insResp.run(id,contratacaoId,entregaId||null,r.lado,r.usuario_id||null,r.nome,r.telefone||'',r.email||'',r.funcao||'',r.criado_em||null); }
    for (const t of tarefas) { const entregaId=entregaLocalPorRemota.get(t.entrega_id); const contratacaoId=localPorRemoto.get(t.projeto_id); const id=Number(t.origem_local_id); if(contratacaoId&&entregaId&&id) insTarefa.run(id,contratacaoId,entregaId,t.titulo,t.descricao||'',t.status,t.data_abertura||null,t.data_conclusao||null,t.envolve_cliente?1:0,t.pendencia_cliente||'',t.interacoes_cliente||'',t.criado_em||null,t.atualizado_em||null); }
    for (const i of checklist) { const contratacaoId=localPorRemoto.get(i.projeto_id); const entregaId=i.entrega_id ? entregaLocalPorRemota.get(i.entrega_id) : null; const id=Number(i.origem_local_id); if(contratacaoId&&id) insChecklist.run(id,contratacaoId,entregaId||null,i.escopo,i.chave,i.titulo,i.tipo_evidencia||null,i.status,null,i.origem_tipo||null,i.origem_id||null,i.observacoes||'',Number(i.ordem)||0,i.origem||'AUTOMATICO',i.criado_em||null,i.atualizado_em||null); }
  })();
  return { projetos: localPorRemoto.size, entregas: entregas.length, acompanhamentos: acompanhamentos.length, responsaveis: responsaveis.length, tarefas: tarefas.length, checklist: checklist.length };
}

// A fonte compartilhada preserva o histórico de exclusões. Um lote ou
// movimento de empresa já removida não pode abortar a restauração das demais
// empresas — nem reaparecer no cache como dado de outra carteira.
function filtrarOrfaosOperacionais(tabela, linhas, empresasValidas, lotesValidos) {
  if (tabela === 'lotes') return linhas.filter((x) => empresasValidas.has(Number(x.empresa_id)));
  if (tabela === 'movimentos') return linhas.filter((x) =>
    empresasValidas.has(Number(x.empresa_id)) && (x.lote_id == null || lotesValidos.has(Number(x.lote_id))));
  if (CAMPOS[tabela]?.includes('empresa_id')) return linhas.filter((x) => empresasValidas.has(Number(x.empresa_id)));
  return linhas;
}
async function baixar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {}, falhas = {};
  // A carteira é a âncora do cache efêmero. Ela precisa ser carregada antes
  // das bases auxiliares: uma falha isolada nunca pode fazer a interface
  // parecer que todas as empresas foram excluídas.
  // Estas duas tabelas referenciam a execução do motor. Carregá-las antes da
  // fotografia ativa viola FK em uma instância nova e deixava a carga-base
  // artificialmente parcial. Elas são restauradas logo após o motor.
  const dependentesDoMotor = ['excecoes_motor_execucoes', 'telemetria_autonomia_execucoes'];
  const tabelas = ['empresas', ...Object.keys(CAMPOS).filter((tabela) => tabela !== 'empresas' && !dependentesDoMotor.includes(tabela))];
  const empresasValidas = new Set(), lotesValidos = new Set();
  let empresaLocalPorRemota = new Map();
  for (const tabela of tabelas) {
    try {
      const origem = await buscarTudo(remoto, tabela);
      if (tabela === 'empresas') {
        empresaLocalPorRemota = mapaEmpresasLocais(origem);
        origem.forEach((x) => empresasValidas.add(empresaLocalPorRemota.get(String(x.id))));
      }
      const normalizadas = normalizarEmpresaIdDoCache(tabela, origem, empresaLocalPorRemota);
      const linhas = filtrarOrfaosOperacionais(tabela, normalizadas, empresasValidas, lotesValidos);
      if (tabela === 'lotes') linhas.forEach((x) => lotesValidos.add(Number(x.id)));
      if (origem.length !== linhas.length) resultado[`ignorados_${tabela}_orfos`] = origem.length - linhas.length;
    // Exceções são um espelho operacional completo do Supabase e possuem duas
    // chaves únicas (id técnico e chave funcional). Limpar somente esse
    // espelho antes da reposição elimina colisões entre IDs legados sem tocar
    // em qualquer fonte remota.
      if (tabela === 'excecoes_motor') db.prepare('DELETE FROM excecoes_motor').run();
    // Regras governamentais também são fotografia completa. A tabela possui
    // tanto id técnico quanto unicidade funcional; limpar o espelho evita que
    // um ID local legado colida com uma regra remota de chave diferente.
      if (tabela === 'regras_governo') db.prepare('DELETE FROM regras_governo').run();
      resultado[tabela] = tabela === 'empresas' ? gravarEmpresas(linhas)
        : tabela === 'empresa_qsa' ? gravarEmpresaQsa(linhas) : gravar(tabela, linhas);
    } catch (e) {
      falhas[tabela] = e.message;
    }
  }
  let motorCarregado = false;
  try { resultado.motor = await baixarResultadosMotor(remoto); motorCarregado = true; }
  catch (e) { falhas.motor = e.message; }
  if (motorCarregado) {
    for (const tabela of dependentesDoMotor) {
      try {
        const origem = await buscarTudo(remoto, tabela);
        const linhas = normalizarEmpresaIdDoCache(tabela, origem, empresaLocalPorRemota);
        resultado[tabela] = gravar(tabela, linhas);
      } catch (e) { falhas[tabela] = e.message; }
    }
  } else {
    for (const tabela of dependentesDoMotor) falhas[tabela] = 'Fotografia do motor indisponível; tabela dependente não foi carregada.';
  }
  try { Object.assign(resultado, await baixarConfiguracao(CONFIG_TABELAS, remoto)); }
  catch (e) { falhas.configuracao = e.message; }
  try { Object.assign(resultado, await baixarParametrosIrpjCsll(remoto)); }
  catch (e) { falhas.parametros_irpj_csll = e.message; }
  try { resultado.gestao = await baixarGestao(remoto); }
  catch (e) { falhas.gestao = e.message; }
  if (Object.keys(falhas).length) resultado.falhas = falhas;
  return resultado;
}
async function baixarRegrasEnquadramento(remotoInformado = null) {
  if (!supabase.configurado()) return { ativo: false };
  const linhas = await buscarTudo(remotoInformado || supabase.admin(), 'regras_enquadramento');
  return { regras_enquadramento: gravar('regras_enquadramento', linhas) };
}

// A trilha remota é a fonte de verdade para o delta. O marco só é avançado
// dentro da mesma transação SQLite que aplica todas as linhas do lote.
const CHAVE_SEQUENCIA_INCREMENTAL = 'operacao_compartilhada_sequencia';
const TABELAS_INCREMENTAIS_SEGURAS = new Set([
  'empresas', 'empresa_servicos_fiscais', 'parceiros', 'empresa_qsa', 'lotes',
  'movimentos', 'perfil_tributario', 'folhas_pagamento_competencias',
  'margens_operacionais_premissas', 'receitas_sem_dfe', 'formacao_custo_itens',
  'formacao_custo_componentes', 'excecoes_motor', 'excecoes_motor_execucoes',
  'telemetria_autonomia_execucoes', 'enriquecimento_servicos_evidencias',
  'enriquecimento_pis_cofins_evidencias', 'pendencias_enriquecimento_fiscal',
  'perfil_cbs_competencias', 'pricing_products', 'pricing_services',
  'pricing_components', 'pricing_import_batches', 'pricing_simulacoes',
]);
const PRIORIDADE_INCREMENTAL = [
  'empresas', 'lotes', 'parceiros', 'empresa_qsa', 'empresa_servicos_fiscais',
  'perfil_tributario', 'folhas_pagamento_competencias', 'margens_operacionais_premissas',
  'receitas_sem_dfe', 'movimentos', 'formacao_custo_itens', 'formacao_custo_componentes',
  'enriquecimento_servicos_evidencias', 'enriquecimento_pis_cofins_evidencias',
  'pendencias_enriquecimento_fiscal', 'excecoes_motor', 'excecoes_motor_execucoes',
  'telemetria_autonomia_execucoes', 'perfil_cbs_competencias', 'pricing_products',
  'pricing_services', 'pricing_components', 'pricing_import_batches', 'pricing_simulacoes',
];

function lerSequenciaIncremental() {
  const linha = db.prepare('SELECT valor FROM sincronizacao_operacional_estado WHERE chave=?').get(CHAVE_SEQUENCIA_INCREMENTAL);
  const sequencia = Number(linha?.valor || 0);
  return Number.isSafeInteger(sequencia) && sequencia >= 0 ? sequencia : 0;
}
function temSequenciaIncremental() {
  return Boolean(db.prepare('SELECT 1 FROM sincronizacao_operacional_estado WHERE chave=?').get(CHAVE_SEQUENCIA_INCREMENTAL));
}
function salvarSequenciaIncremental(sequencia) {
  db.prepare(`INSERT INTO sincronizacao_operacional_estado(chave,valor,atualizado_em) VALUES (?,?,datetime('now','localtime'))
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, atualizado_em=excluded.atualizado_em`).run(CHAVE_SEQUENCIA_INCREMENTAL, String(sequencia));
}
function chaveEvento(evento) {
  const chave = evento.chave && typeof evento.chave === 'object' ? evento.chave : JSON.parse(evento.chave || '{}');
  return Object.keys(chave).sort().map((campo) => `${campo}:${JSON.stringify(chave[campo])}`).join('|');
}
function reduzirEventosIncrementais(eventos = []) {
  const ultimos = new Map();
  for (const evento of eventos) ultimos.set(`${evento.tabela}|${chaveEvento(evento)}`, evento);
  return [...ultimos.values()].sort((a, b) => Number(a.sequencia) - Number(b.sequencia));
}
async function buscarEventosIncrementais(remoto, sequencia) {
  const eventos = []; const tamanho = 1000;
  for (let de = 0;; de += tamanho) {
    const { data, error } = await remoto.from('sincronizacao_operacional_eventos')
      .select('sequencia,tabela,operacao,chave,empresa_id,ocorrido_em')
      .gt('sequencia', sequencia).order('sequencia', { ascending: true }).range(de, de + tamanho - 1);
    if (error) throw new Error(`Trilha incremental: ${error.message}`);
    eventos.push(...(data || []));
    if (!data || data.length < tamanho) return eventos;
  }
}
async function maiorSequenciaIncremental(remoto) {
  const { data, error } = await remoto.from('sincronizacao_operacional_eventos')
    .select('sequencia').order('sequencia', { ascending: false }).limit(1);
  if (error) throw new Error(`Marco incremental: ${error.message}`);
  return Number(data?.[0]?.sequencia || 0);
}
async function buscarLinhaPorChave(remoto, tabela, chave) {
  let consulta = remoto.from(tabela).select('*');
  for (const [campo, valor] of Object.entries(chave)) consulta = consulta.eq(campo, valor);
  const { data, error } = await consulta.limit(2);
  if (error) throw new Error(`${tabela} por chave: ${error.message}`);
  if (!data || data.length !== 1) throw new Error(`${tabela}: esperada uma linha para a chave do evento; encontrado ${data?.length || 0}.`);
  return data[0];
}
function prioridadeIncremental(tabela) {
  const indice = PRIORIDADE_INCREMENTAL.indexOf(tabela);
  return indice >= 0 ? indice : PRIORIDADE_INCREMENTAL.length;
}
function validarEventoIncremental(evento) {
  if (!TABELAS_INCREMENTAIS_SEGURAS.has(evento.tabela)) return `tabela ${evento.tabela} ainda não possui aplicador incremental seguro`;
  const chave = evento.chave && typeof evento.chave === 'object' ? evento.chave : JSON.parse(evento.chave || '{}');
  const colunas = db.prepare(`PRAGMA table_info(${evento.tabela})`).all().map((x) => x.name);
  if (!Object.keys(chave).length || Object.keys(chave).some((campo) => !colunas.includes(campo))) return `chave incompatível para ${evento.tabela}`;
  // Uma exclusão de empresa ou de QSA pode remover relações locais que foram
  // confirmadas manualmente. A carga completa existente preserva essas
  // confirmações; portanto, o delta recusa o lote e faz fallback seguro.
  if (evento.operacao === 'DELETE' && ['empresas', 'empresa_qsa', 'contratos'].includes(evento.tabela)) return `exclusão sensível em ${evento.tabela}`;
  return null;
}
function apagarLinhaIncremental(evento) {
  const chave = evento.chave && typeof evento.chave === 'object' ? evento.chave : JSON.parse(evento.chave || '{}');
  const campos = Object.keys(chave);
  const sql = `DELETE FROM ${evento.tabela} WHERE ${campos.map((campo) => `${campo}=?`).join(' AND ')}`;
  return db.prepare(sql).run(...campos.map((campo) => chave[campo])).changes;
}

async function aplicarEventosIncrementais(remoto, eventos) {
  const reduzidos = reduzirEventosIncrementais(eventos);
  for (const evento of reduzidos) {
    const motivo = validarEventoIncremental(evento);
    if (motivo) return { fallback: true, motivo };
  }
  const precisaMapaEmpresas = reduzidos.some((evento) => evento.tabela !== 'empresas' && CAMPOS[evento.tabela]?.includes('empresa_id'));
  const empresasRemotas = precisaMapaEmpresas ? await buscarTudo(remoto, 'empresas') : [];
  const empresaLocalPorRemota = mapaEmpresasLocais(empresasRemotas);
  const inclusoes = [], exclusoes = [];
  for (const evento of reduzidos) {
    if (evento.operacao === 'DELETE') exclusoes.push(evento);
    else inclusoes.push({ evento, linha: await buscarLinhaPorChave(remoto, evento.tabela, evento.chave) });
  }
  inclusoes.sort((a, b) => prioridadeIncremental(a.evento.tabela) - prioridadeIncremental(b.evento.tabela));
  exclusoes.sort((a, b) => prioridadeIncremental(b.tabela) - prioridadeIncremental(a.tabela));
  let aplicadas = 0, removidas = 0;
  db.transaction(() => {
    for (const { evento, linha } of inclusoes) {
      if (CAMPOS[evento.tabela]?.includes('empresa_id') && !empresaLocalPorRemota.has(String(linha.empresa_id))) {
        throw new Error(`Empresa remota ausente para ${evento.tabela}; fotografia incremental recusada.`);
      }
      const normalizada = normalizarEmpresaIdDoCache(evento.tabela, [linha], empresaLocalPorRemota);
      if (evento.tabela === 'empresas') gravarEmpresas(normalizada, true);
      else if (evento.tabela === 'empresa_qsa') gravarEmpresaQsa(normalizada, true);
      else gravar(evento.tabela, normalizada, true);
      aplicadas += normalizada.length;
    }
    for (const evento of exclusoes) removidas += apagarLinhaIncremental(evento);
    salvarSequenciaIncremental(Math.max(...reduzidos.map((evento) => Number(evento.sequencia))));
  })();
  return { fallback: false, eventos: reduzidos.length, aplicadas, removidas };
}

async function sincronizarIncremental() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin();
  const sequencia = lerSequenciaIncremental();
  // A primeira instalação cria uma base íntegra e somente depois habilita o
  // delta. Eventos ocorridos durante a carga são reaplicados idempotentemente.
  if (!temSequenciaIncremental()) {
    const inicio = await maiorSequenciaIncremental(remoto);
    const completo = await baixar();
    if (completo.falhas) throw new Error(`Carga-base incremental incompleta: ${Object.entries(completo.falhas).map(([tabela, causa]) => `${tabela}: ${causa}`).join(' | ')}.`);
    const pendentes = await buscarEventosIncrementais(remoto, inicio);
    const aplicado = pendentes.length ? await aplicarEventosIncrementais(remoto, pendentes) : { fallback: false, eventos: 0, aplicadas: 0, removidas: 0 };
    let marcoAplicado = pendentes.at(-1)?.sequencia || inicio;
    if (aplicado.fallback) {
      const marcoCobertoPeloFallback = await maiorSequenciaIncremental(remoto);
      const recuperacao = await baixar();
      if (recuperacao.falhas) throw new Error(`Recuperação incremental incompleta: ${Object.entries(recuperacao.falhas).map(([tabela, causa]) => `${tabela}: ${causa}`).join(' | ')}.`);
      marcoAplicado = marcoCobertoPeloFallback;
    }
    // O marco não pode avançar além de um evento efetivamente aplicado. Eventos
    // que chegarem após esta leitura serão buscados no próximo ciclo.
    db.transaction(() => salvarSequenciaIncremental(marcoAplicado))();
    return { modo: 'carga_base', sequencia: Number(marcoAplicado), ...aplicado };
  }
  const eventos = await buscarEventosIncrementais(remoto, sequencia);
  if (!eventos.length) return { modo: 'incremental', eventos: 0, aplicadas: 0, removidas: 0, sequencia };
  const aplicado = await aplicarEventosIncrementais(remoto, eventos);
  if (!aplicado.fallback) return { modo: 'incremental', sequencia: lerSequenciaIncremental(), ...aplicado };
  // Fallback intencional: a tabela ainda não possui semântica incremental ou
  // o evento é sensível. Nada do lote foi aplicado antes desta decisão.
  const marcoCobertoPeloFallback = await maiorSequenciaIncremental(remoto);
  const completo = await baixar();
  if (completo.falhas) throw new Error(`Fallback incremental incompleto: ${Object.entries(completo.falhas).map(([tabela, causa]) => `${tabela}: ${causa}`).join(' | ')}.`);
  db.transaction(() => salvarSequenciaIncremental(marcoCobertoPeloFallback))();
  return { modo: 'fallback_completo', sequencia: Number(marcoCobertoPeloFallback), eventos: eventos.length, ...aplicado };
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
async function publicarResultadosMotor(empresaId = null, opcoes = {}) {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin();
  const filtro = empresaId == null ? '' : ' WHERE empresa_id=?';
  const parametros = empresaId == null ? [] : [empresaId];
  const execucoes = db.prepare(`SELECT * FROM motor_execucoes${filtro}`).all(...parametros)
    .map((x) => ({ id: x.id, empresa_id: x.empresa_id, dados: x }));
  const resultados = db.prepare(`SELECT * FROM motor_resultados${filtro}`).all(...parametros)
    .map((x) => ({ id: x.id, empresa_id: x.empresa_id, movimento_id: x.movimento_id, dados: x,
      // A tabela compartilhada usa "ativo=false" como padrão. Sem marcar a
      // nova fotografia explicitamente, o cálculo correto ficava gravado no
      // histórico, mas as telas continuavam lendo a fotografia antiga.
      ativo: opcoes.ativar !== false, execucao_id: x.execucao_id,
      tipo_credito: x.tipo_credito, modalidade_credito: x.modalidade_credito,
      status_credito_determinacao: x.status_credito_determinacao,
      regime_cbs_emitente: x.regime_cbs_emitente, regime_cbs_adquirente: x.regime_cbs_adquirente,
      movimento_hash: x.movimento_hash, regra_version: x.regra_version,
      catalogo_version: x.catalogo_version, parceiro_version: x.parceiro_version,
      parametro_version: x.parametro_version, motor_version: x.motor_version,
      estado_autonomia: x.estado_autonomia, codigo_causa: x.codigo_causa,
      origem_resolucao: x.origem_resolucao, requer_intervencao_humana: x.requer_intervencao_humana }));
  // A restrição remota garante um único resultado ativo por movimento. A
  // publicação sempre envia a fotografia local completa da empresa, portanto
  // a fotografia anterior precisa ser encerrada antes de ativar a substituta.
  const empresasDaFotografia = [...new Set(resultados.map((r) => Number(r.empresa_id)).filter(Boolean))];
  for (const idEmpresa of empresasDaFotografia) {
    if (opcoes.ativar === false) continue;
    const { error } = await remoto.from('motor_resultados_operacionais')
      .update({ ativo: false }).eq('empresa_id', idEmpresa).eq('ativo', true);
    if (error) throw new Error(`motor_resultados_operacionais preparação: ${error.message}`);
  }
  for (const [tabela, linhas] of [['motor_execucoes_operacionais', execucoes], ['motor_resultados_operacionais', resultados]]) {
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await remoto.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
  }
  const telemetrias = db.prepare(`SELECT * FROM telemetria_autonomia_execucoes${filtro}`).all(...parametros);
  const excecoesExecucao = db.prepare(`SELECT * FROM excecoes_motor_execucoes${filtro}`).all(...parametros);
  const avisos = [];
  if (telemetrias.length) {
    const { error } = await remoto.from('telemetria_autonomia_execucoes').upsert(telemetrias, { onConflict: 'execucao_id' });
    if (error) avisos.push(`telemetria_autonomia_execucoes: ${error.message}`);
  }
  if (excecoesExecucao.length) {
    for (let i = 0; i < excecoesExecucao.length; i += 500) {
      const { error } = await remoto.from('excecoes_motor_execucoes').upsert(excecoesExecucao.slice(i, i + 500), { onConflict: 'empresa_id,execucao_id,movimento_id,codigo' });
      if (error) { avisos.push(`excecoes_motor_execucoes: ${error.message}`); break; }
    }
  }
  return { execucoes: execucoes.length, resultados: resultados.length, telemetrias: telemetrias.length, excecoes_execucao: excecoesExecucao.length, avisos };
}
async function promoverFotografiaMotor(empresaId, execucaoId, quantidadeEsperada) {
  if (!ativo()) return { ativo: false };
  const { error } = await supabase.admin().rpc('promover_fotografia_motor', {
    p_empresa_id: Number(empresaId), p_execucao_id: Number(execucaoId), p_quantidade_esperada: Number(quantidadeEsperada),
  });
  if (error) throw new Error(`Promoção atômica da fotografia: ${error.message}`);
  return { promovida: true, empresa_id: Number(empresaId), execucao_id: Number(execucaoId), quantidade: Number(quantidadeEsperada) };
}
async function validarFotografiaAtivaMotor(empresaId, execucaoId, quantidadeEsperada) {
  if (!ativo()) return { ativo: false };
  const { data, error } = await supabase.admin().from('motor_resultados_operacionais')
    .select('execucao_id').eq('empresa_id', Number(empresaId)).eq('ativo', true);
  if (error) throw new Error(`Validação da fotografia ativa: ${error.message}`);
  const linhas = data || [];
  const execucoes = [...new Set(linhas.map((x) => Number(x.execucao_id)))];
  if (linhas.length !== Number(quantidadeEsperada) || execucoes.length !== 1 || execucoes[0] !== Number(execucaoId)) {
    throw new Error(`Promoção não confirmada: esperado execução ${execucaoId} com ${quantidadeEsperada} item(ns); ativo ${execucoes.join(',') || '—'} com ${linhas.length}.`);
  }
  return { confirmada: true, execucao_id: Number(execucaoId), quantidade: linhas.length };
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

// IRPJ/CSLL possui governança própria por vigência e não pode ser publicado
// pelo cache efêmero. A leitura substitui a fotografia local somente depois
// de obter a coleção remota completa com sucesso.
async function baixarParametrosIrpjCsll(remotoInformado = null) {
  if (!supabase.configurado()) return { ativo: false };
  const remoto = remotoInformado || supabase.admin();
  const linhas = await buscarTudo(remoto, 'param_irpj_csll_versionados');
  const colunas = db.prepare('PRAGMA table_info(param_irpj_csll_versionados)').all().map((x) => x.name);
  const inserir = db.prepare(`INSERT INTO param_irpj_csll_versionados (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})`);
  db.transaction(() => {
    db.prepare('DELETE FROM param_irpj_csll_versionados').run();
    for (const linha of linhas) inserir.run(...colunas.map((coluna) => linha[coluna] ?? null));
  })();
  return { parametros_irpj_csll: linhas.length };
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
  const [empresas, projetos, entregas, acompanhamentos, responsaveis, tarefas, checklist] = await Promise.all([
    buscarTudo(remoto, 'empresas'), buscarTudo(remoto, 'projetos'), buscarTudo(remoto, 'projeto_entregas'),
    buscarTudo(remoto, 'projeto_acompanhamentos'), buscarTudo(remoto, 'projeto_responsaveis'),
    buscarTudo(remoto, 'projeto_tarefas'), buscarTudo(remoto, 'projeto_checklist_implantacao'),
  ]);
  return gravarGestao(projetos, entregas, acompanhamentos, responsaveis, tarefas, checklist, empresas);
}
async function publicar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  for (const [tabela, campos] of Object.entries(CAMPOS)) {
    // Empresa e QSA têm identidade composta/remota e confirmação humana.
    // Publicá-los pelo espelho genérico do SQLite (por id local) causava uma
    // corrida com a sincronização explícita e podia reaplicar uma fotografia
    // antiga após o usuário salvar. Ambos são publicados somente pelos fluxos
    // específicos, com origem_local_id/chave societária estável.
    if (['empresas', 'empresa_qsa', 'regras_enquadramento'].includes(tabela)) continue;
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
module.exports = { ativo, baixar, baixarRegrasEnquadramento, sincronizarIncremental, baixarConfiguracao, publicarConfiguracao, baixarParametrosIrpjCsll, baixarGestao, publicar, mapaEmpresasLocais, normalizarEmpresaIdDoCache,
  baixarResultadosMotor, publicarResultadosMotor, promoverFotografiaMotor, validarFotografiaAtivaMotor, filtrarOrfaosOperacionais,
  reduzirEventosIncrementais, chaveEvento, validarEventoIncremental };
