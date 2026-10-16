/* Cache operacional: Supabase é a fonte compartilhada; SQLite atende o motor local. */
const db = require('../db');
const supabase = require('./supabase');
const { Client } = require('pg');
const crypto = require('crypto');
const baseRegimeReceita = require('./baseRegimeReceita');

const CAMPOS = {
  empresas: ['id','cnpj','razao_social','nome_fantasia','regime','regime_reconhecimento_simples','uf','municipio','cnae','atividade','cnaes_secundarios','data_abertura','faturamento_anual','setor','reducao_padrao','codigo_questor','observacoes','criado_em'],
  empresa_servicos_fiscais: ['id','empresa_id','chave','nbs','descricao','pis_cofins','das_efetivo','iss_aliquota','ativo','origem','criado_em','atualizado_em'],
  parceiros: ['id','empresa_id','tipo','cnpj','descricao','regime','faturamento_anual','uf','municipio','origem','criado_em','regime_resolvido','perfil_economico','perfil_origem','sensibilidade_credito','sensibilidade_origem','regime_origem','regime_versao','regime_confirmado_em'],
  empresa_qsa: ['id','empresa_id','nome','documento','qualificacao','pais','percentual_participacao','brasileiro','fonte','consultado_em','origem','criado_em','atualizado_em'],
  lotes: ['id','empresa_id','tipo','arquivo','registros','ignorados','valor_total','mensagens','origem','criado_em'],
  movimentos: ['id','empresa_id','lote_id','tipo','nome','inscr_federal','descricao','ncm','nbs','lc116','normalizacao_status','normalizacao_pendencia','normalizacao_evidencia','cfop','cst','competencia','valor','valor_produto','base_calculo','icms','icms_st','ipi','pis','cofins','pis_cofins_documentado','iss','regime','reducao','aliq_especifica','cclasstrib','classificacao_origem','cst_declarado','cclasstrib_declarado','ibs_declarado','cbs_declarado','modelo_documento_fiscal','documento','item_numero','chave','emitente_cnpj','destinatario_cnpj','codigo_produto','quantidade','unidade','csosn','data_emissao','frete','seguro','outras','desconto','sentido','situacao_documento','cancelado_em','cancelamento_motivo','cancelamento_origem','origem','criado_em','regime_fonte','regime_parceiro_versao','regime_confirmado_em'],
  documentos_fiscais_cancelamentos: ['id','empresa_id','data_emissao','numero','modelo_documento_fiscal','serie','situacao','origem','evidencia','criado_em','atualizado_em'],
  perfil_tributario: ['id','empresa_id','competencia','receita_bruta','receita_recebida','receita_mercadorias','receita_servicos','receita_exportacao','icms','iss','ipi','pis','cofins','das','creditos_tomados','origem','criado_em'],
  folhas_pagamento_competencias: ['id','empresa_id','competencia','valor_folha','pro_labore','origem','referencia_arquivo','status_validacao','criado_em','atualizado_em'],
  margens_operacionais_premissas: ['id','empresa_id','periodo_inicio','periodo_fim','margem_operacional_percentual','origem','natureza','status_validacao','criado_em','atualizado_em'],
  receitas_sem_dfe: ['id','empresa_id','competencia','tipo_receita','descricao','valor','origem','evidencia','classificacao_fiscal','subtipo','objeto_operacao','contrato_referencia','regra_atual','regra_reforma','status_comparabilidade','status_motor','regra_motor_id','regra_motor_versao','regra_motor_atual','regra_motor_reforma','cst_motor','cclasstrib_motor','fundamento_motor','pendencia_motor','processado_motor_em','identificador_origem','especie_questor','segregacao_apuracao','base_pis_cofins_atual','pis_atual','cofins_atual','criterio_tributacao_atual','tributacao_atual_origem','item_receita_chave','status_validacao','chave_deduplicacao','criado_em','atualizado_em'],
  catalogo_itens_receita: ['chave','nome','classificacao_fiscal','ativo','ordem','criado_em'],
  regras_itens_receita_regime: ['id','item_chave','regime_empresa','pis_percentual','cofins_percentual','tratamento_atual','tratamento_reforma','cst','cclasstrib','reducao_cbs','reducao_ibs','requer_classificacao','fundamento','vigencia_inicio','vigencia_fim','ativo'],
  regras_receitas_sem_dfe: ['id','classificacao_fiscal','subtipo','tratamento_atual','tratamento_reforma','cst','cclasstrib','fundamento','vigencia_inicio','vigencia_fim','prioridade','versao','status','fonte','evidencia','criado_em','atualizado_em'],
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
  pricing_itens: ['id','empresa_id','codigo','descricao','modalidade','natureza_item','ncm','nbs','lc116','unidade','perfil_cliente','preco_atual','margem_contribuicao','percentuais_por_dentro','ativo','origem','origem_tipo','origem_id','base_operacional_id','criado_em','atualizado_em'],
  pricing_premissas_comerciais: ['id','empresa_id','nome','margem_contribuicao','percentuais_por_dentro','cenario_operacional_id','ativo','padrao','criado_em','atualizado_em'],
  pricing_creditos_globais: ['id','empresa_id','descricao','natureza','valor','criterio_rateio','percentual_rateio','vigencia_inicio','vigencia_fim','evidencia','origem','ativo','criado_em','atualizado_em'],
  pricing_calculos: ['id','empresa_id','pricing_item_id','versao','status','modalidade','parametros_json','resultado_json','evidencia_json','origem','calculado_em','aprovado_em','vigente_em','substituido_por_id'],
  pricing_calculo_tratamentos: ['id','pricing_calculo_id','tratamento','aliquota_efetiva_cbs','preserva_credito','estorna_credito','resultado_json','status'],
  pricing_import_linhas: ['id','lote_id','linha','aba','codigo_item','status','erro','dados_json','pricing_item_id','criado_em'],
  pricing_base_operacional: ['id','empresa_id','codigo','descricao','modelo','ncm_compra','nbs_compra','lc116_compra','ncm_venda','nbs_venda','lc116_venda','classificacao_compra','classificacao_venda','classificacao_compra_detalhe','classificacao_venda_detalhe','fornecedor_cnpj','regime_fornecedor','pis','cofins','valor_aquisicao','prazo_depreciacao_meses','valor_residual','origem','evidencia','ativo','criado_em','atualizado_em'],
  pricing_base_estrutura: ['id','base_operacional_id','codigo_componente','descricao','tipo_componente','valor','pis','cofins','fornecedor_cnpj','regime_fornecedor','ncm','nbs','lc116','classificacao','classificacao_detalhe','origem','evidencia','criado_em'],
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
const CONFIG_TABELAS = ['param_regras','param_aliquotas','param_tributos','param_regimes','param_reducoes','param_cfop','param_simples','param_naturezas_juridicas_anexo_xi','catalogo_itens_receita','regras_itens_receita_regime','servicos','combos','combo_itens'];
const TABELAS_PRECIFICACAO = ['pricing_products','pricing_services','pricing_components','pricing_import_batches','pricing_itens','pricing_premissas_comerciais','pricing_creditos_globais','pricing_calculos','pricing_calculo_tratamentos','pricing_import_linhas','pricing_base_operacional','pricing_base_estrutura'];
const TABELAS_CONTRATOS = ['contratos','contrato_checklist','contrato_documentos','contrato_clausulas_extraidas','contrato_riscos_iniciais','contrato_precificacao_vinculos','contrato_recomendacoes','contrato_sugestoes_clausulas'];
const TABELAS_ACOMPANHAMENTO = ['monitoring_baselines','monitoring_snapshots','monitoring_comparisons','monitoring_deviations','monitoring_alerts','monitoring_actions'];
// Fatos volumosos e suas tabelas-filhas nunca entram na carga global do Web.
// Eles são materializados somente para a empresa selecionada. Manter o grupo
// completo evita tentar inserir filhos sem `movimentos` em uma instância nova.
const TABELAS_CACHE_POR_EMPRESA = new Set([
  'lotes','movimentos','parceiros','formacao_custo_itens','formacao_custo_componentes',
  'excecoes_motor','enriquecimento_servicos_evidencias',
  'enriquecimento_pis_cofins_evidencias','pendencias_enriquecimento_fiscal',
]);
const hidratacoesEmpresaRecentes = new Map();
const hidratacoesEmpresaEmAndamento = new Map();

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
async function aplicarExclusoesCanonicas(remoto) {
  const { data, error }=await remoto.from('sincronizacao_operacional_tombstones')
    .select('tabela,chave,sequencia_exclusao').is('restaurado_em',null);
  // Antes da migration a tabela não existe: mantém compatibilidade de leitura
  // durante o rollout, sem transformar o cache em fonte de verdade.
  if (error) {
    if (['PGRST205','42P01'].includes(error.code)) return { disponivel:false, removidas:0 };
    throw new Error(`Tombstones canônicos: ${error.message}`);
  }
  let removidas=0;
  db.transaction(() => {
    for (const tombstone of data || []) {
      if (!TABELAS_INCREMENTAIS_SEGURAS.has(tombstone.tabela)) continue;
      const chave=tombstone.chave && typeof tombstone.chave==='object' ? tombstone.chave : JSON.parse(tombstone.chave || '{}');
      const colunas=db.prepare(`PRAGMA table_info(${tombstone.tabela})`).all().map((x)=>x.name);
      if (!Object.keys(chave).length || Object.keys(chave).some((campo)=>!colunas.includes(campo))) continue;
      removidas+=apagarLinhaIncremental({ tabela:tombstone.tabela, chave });
    }
  })();
  return { disponivel:true, removidas };
}
// A carga completa possui muitas coleções independentes. Buscá-las uma a uma
// transforma uma lentidão pontual em dezenas de minutos de espera. O limite
// baixo protege a fonte remota e reduz o tempo total da primeira fotografia.
async function buscarColecoes(remoto, tabelas, concorrencia = 4) {
  const resultados = new Map();
  let proximo = 0;
  async function trabalhador() {
    while (proximo < tabelas.length) {
      const tabela = tabelas[proximo++];
      try { resultados.set(tabela, { linhas: await buscarTudo(remoto, tabela) }); }
      catch (erro) { resultados.set(tabela, { erro }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concorrencia, tabelas.length) }, trabalhador));
  return resultados;
}
function chaveConflitoTabela(tabela) {
  // Parceiro não é identificado pelo id técnico entre o cache efêmero e a
  // fonte compartilhada. O mesmo CNPJ pode ter IDs diferentes em cada lado,
  // mas só pode existir uma vez por empresa e tipo. Usar o id aqui fazia a
  // restauração tentar inserir uma segunda linha e abortar o motor pela
  // restrição UNIQUE(empresa_id,tipo,cnpj).
  if (tabela === 'parceiros') return { conflito:'(empresa_id,tipo,cnpj)', imutaveis:['id','empresa_id','tipo','cnpj'] };
  if (tabela === 'catalogo_itens_receita') return { conflito:'(chave)', imutaveis:['chave'] };
  if (tabela === 'excecoes_motor') return { conflito:'(empresa_id,movimento_id,codigo)', imutaveis:['id','empresa_id','movimento_id','codigo'] };
  if (tabela === 'telemetria_autonomia_execucoes') return { conflito:'(execucao_id)', imutaveis:['execucao_id'] };
  if (tabela === 'param_naturezas_juridicas_anexo_xi') return { conflito:'(codigo_natureza_juridica)', imutaveis:['codigo_natureza_juridica'] };
  if (tabela === 'regras_governo') return { conflito:'(tipo,chave,cclasstrib)', imutaveis:['id','tipo','chave','cclasstrib'] };
  return { conflito:'(id)', imutaveis:['id'] };
}
// PostgREST recebe a chave sem parênteses. O catálogo de itens de receita
// não possui coluna técnica `id`: sua identidade é a própria `chave`.
function chaveConflitoPublicacao(tabela) {
  return tabela === 'catalogo_itens_receita' ? 'chave' : 'id';
}
function normalizarIdsParceirosDoCache(linhas) {
  // IDs de parceiro pertencem ao banco que os gerou; não são identidade
  // compartilhável. Antes de restaurar, reaproveitamos o id local quando o
  // mesmo (empresa,tipo,CNPJ) já existe e soltamos um id remoto que colida
  // com outro parceiro local. A coluna id nula faz o SQLite gerar um novo id.
  const empresas=[...new Set((linhas || []).map((x)=>Number(x.empresa_id)).filter(Number.isInteger))];
  if (!empresas.length) return linhas;
  // `parceiros.id` é chave primária global no cache SQLite. Um id remoto de
  // outra empresa não pode ser reaproveitado, mesmo que a empresa sendo
  // restaurada ainda não tenha esse parceiro. A correspondência funcional
  // continua restrita à empresa, mas a reserva de ids precisa ver a tabela
  // inteira para evitar UNIQUE parceiros.id durante a preparação do worker.
  const locais=db.prepare('SELECT id,empresa_id,tipo,cnpj FROM parceiros').all();
  const porChave=new Map();
  const idsOcupados=new Set();
  for (const parceiro of locais) {
    idsOcupados.add(Number(parceiro.id));
    const cnpj=String(parceiro.cnpj || '').replace(/\D/g,'');
    if (empresas.includes(Number(parceiro.empresa_id)) && cnpj) porChave.set(`${parceiro.empresa_id}|${parceiro.tipo}|${cnpj}`,Number(parceiro.id));
  }
  return linhas.map((linha)=>{
    const cnpj=String(linha.cnpj || '').replace(/\D/g,'');
    const chave=cnpj ? `${linha.empresa_id}|${linha.tipo}|${cnpj}` : '';
    const idExistente=chave ? porChave.get(chave) : null;
    if (idExistente) return { ...linha, id:idExistente };
    const idRemoto=Number(linha.id);
    if (Number.isInteger(idRemoto) && idsOcupados.has(idRemoto)) return { ...linha, id:null };
    if (Number.isInteger(idRemoto)) idsOcupados.add(idRemoto);
    return linha;
  });
}

// A pessoa do Questor comprova identidade (nome/CNPJ), mas não o regime.
// Esses vínculos nascem com Simples apenas como premissa operacional. Quando
// a base oficial por CNPJ — ou pela raiz da filial — trouxer um regime, ela
// deve prevalecer tanto na leitura quanto antes de o motor calcular.
function aplicarRegimeBaseNosVinculosQuestor(empresaId) {
  // SQLite não permite referenciar a tabela-alvo dentro da subconsulta
  // correlacionada de UPDATE. Resolvemos primeiro por id no CTE e somente
  // então atualizamos o parceiro; assim o worker não aborta antes de
  // publicar a fotografia.
  const parceiros=db.prepare(`WITH candidatos AS (
      SELECT p.id, br.regime,
        ROW_NUMBER() OVER (PARTITION BY p.id ORDER BY CASE WHEN br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','') THEN 0 ELSE 1 END, br.ano DESC) AS posicao
      FROM parceiros p
      JOIN base_regime br ON br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')
        OR br.raiz=SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ',''),1,8)
      WHERE p.empresa_id=? AND p.tipo='fornecedor' AND COALESCE(p.cnpj,'')<>''
        AND UPPER(COALESCE(p.regime_origem,'')) NOT IN ('MANUAL_USUARIO','REGIME_CONFIRMADO_USUARIO')
    ), resolvidos AS (
      SELECT id,regime FROM candidatos WHERE posicao=1
    )
    UPDATE parceiros SET regime=(SELECT r.regime FROM resolvidos r WHERE r.id=parceiros.id)
    WHERE id IN (SELECT id FROM resolvidos WHERE regime IS NOT NULL)
      AND COALESCE(regime,'') IS NOT COALESCE((SELECT r.regime FROM resolvidos r WHERE r.id=parceiros.id),'')`).run(Number(empresaId)).changes;
  // O Razão também pode trazer o CNPJ já identificado no próprio lançamento,
  // sem que o parceiro tenha sido materializado pela rotina de pessoas. A
  // premissa inicial de Simples é apenas um fallback de importação; nunca
  // pode prevalecer sobre a base de regimes por CNPJ/raiz nessa situação.
  const movimentos=db.prepare(`WITH candidatos AS (
      SELECT m.id, br.regime,
        ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY CASE WHEN br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','') THEN 0 ELSE 1 END, br.ano DESC) AS posicao
      FROM movimentos m
      JOIN base_regime br ON br.cnpj=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
        OR br.raiz=SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ',''),1,8)
      WHERE m.empresa_id=? AND m.tipo='fornecedor'
        AND UPPER(COALESCE(m.regime_fonte,'')) NOT IN ('MANUAL_USUARIO','REGIME_CONFIRMADO_USUARIO')
        AND LENGTH(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''))=14
    ), resolvidos AS (
      SELECT id,regime FROM candidatos WHERE posicao=1
    )
    UPDATE movimentos SET regime=(SELECT r.regime FROM resolvidos r WHERE r.id=movimentos.id)
    WHERE id IN (SELECT id FROM resolvidos)
      AND COALESCE(regime,'') IS NOT COALESCE((SELECT r.regime FROM resolvidos r WHERE r.id=movimentos.id),'')`).run(Number(empresaId)).changes;
  return parceiros+movimentos;
}

async function hidratarBaseRegimeDaEmpresa(empresaId, opcoes = {}) {
  const limite=Math.max(1,Math.min(100,Number(opcoes.limite)||100));
  const depois=String(opcoes.depois_cnpj || '').replace(/\D/g,'');
  const cnpjs=db.prepare(`SELECT DISTINCT REPLACE(REPLACE(REPLACE(COALESCE(inscr_federal,''),'.',''),'/',''),'-','') cnpj
    FROM movimentos WHERE empresa_id=? AND tipo='fornecedor'
      AND LENGTH(REPLACE(REPLACE(REPLACE(COALESCE(inscr_federal,''),'.',''),'/',''),'-',''))=14
      AND REPLACE(REPLACE(REPLACE(COALESCE(inscr_federal,''),'.',''),'/',''),'-','')>?
    ORDER BY cnpj LIMIT ?`)
    .all(Number(empresaId),depois,limite).map((x)=>String(x.cnpj || '').replace(/\D/g,'')).filter(Boolean);
  const referencias=await baseRegimeReceita.consultarCompartilhada(cnpjs);
  const unicas=[...new Map([...referencias.values()].map((x)=>[`${x.cnpj}|${x.ano}`,x])).values()];
  const inserir=db.prepare(`INSERT INTO base_regime(cnpj,raiz,regime,ano,fonte) VALUES (?,?,?,?,?)
    ON CONFLICT(cnpj,ano) DO UPDATE SET raiz=excluded.raiz,regime=excluded.regime,fonte=excluded.fonte`);
  db.transaction(()=>unicas.forEach((x)=>inserir.run(x.cnpj,x.raiz,x.regime,x.ano,x.fonte)))();
  return unicas.length;
}

function gravar(tabela, linhas, dentroDaTransacao = false) {
  if (!linhas.length) return 0;
  if (tabela === 'parceiros') linhas=normalizarIdsParceirosDoCache(linhas);
  const campos = CAMPOS[tabela];
  // Exceções têm unicidade funcional por empresa + movimento + código; o ID
  // pode divergir entre cache e Supabase. Usar a chave errada interrompia uma
  // baixa antes da fotografia e deixava o cache local incompleto.
  const { conflito, imutaveis:excluirAtualizacao } = chaveConflitoTabela(tabela);
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

// A carga-base roda no mesmo processo HTTP. Uma coleção grande (sobretudo
// movimentos) não pode monopolizar o event loop por minutos e impedir até a
// entrega da página inicial após um deploy. Mantemos exatamente a mesma
// escrita e as mesmas chaves de conflito, mas liberamos o processo entre
// lotes pequenos. Isto não publica nem calcula dado algum.
const cederAoServidor = () => new Promise((resolver) => setImmediate(resolver));
async function gravarEmLotes(tabela, linhas, { tamanho = 250, qsa = false } = {}) {
  if (!linhas.length) return 0;
  let gravadas = 0;
  for (let inicio = 0; inicio < linhas.length; inicio += tamanho) {
    const lote = linhas.slice(inicio, inicio + tamanho);
    gravadas += qsa ? gravarEmpresaQsa(lote) : gravar(tabela, lote);
    // Permite que saúde, login e as telas já disponíveis sejam atendidos
    // enquanto a fotografia restante continua chegando da fonte compartilhada.
    await cederAoServidor();
  }
  return gravadas;
}

function gravarEmpresas(linhas, dentroDaTransacao = false) {
  // PostgREST devolve colunas json/jsonb como objetos. O cache local usa
  // TEXT para os campos do cadastro; sem esta conversão a próxima tela que
  // lê CNAEs secundários tenta fazer JSON.parse de "[object Object]".
  // Aceitamos também texto já serializado para manter compatibilidade com
  // cadastros criados antes da sincronização compartilhada.
  const textoPersistivel = (valor, padrao = '') => {
    if (valor === null || valor === undefined) return padrao;
    if (typeof valor === 'object' && !Buffer.isBuffer(valor) && !(valor instanceof Date)) return JSON.stringify(valor);
    return valor;
  };
  const inserir = db.prepare(`INSERT INTO empresas
    (id,cnpj,razao_social,nome_fantasia,regime,regime_reconhecimento_simples,uf,municipio,cnae,atividade,cnaes_secundarios,data_abertura,faturamento_anual,setor,reducao_padrao,codigo_questor,observacoes,criado_em)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET cnpj=excluded.cnpj,razao_social=excluded.razao_social,nome_fantasia=excluded.nome_fantasia,
      regime=CASE WHEN excluded.regime IS NULL OR excluded.regime='' THEN empresas.regime ELSE excluded.regime END,regime_reconhecimento_simples=COALESCE(excluded.regime_reconhecimento_simples,empresas.regime_reconhecimento_simples),
      uf=excluded.uf,municipio=excluded.municipio,cnae=excluded.cnae,atividade=excluded.atividade,cnaes_secundarios=excluded.cnaes_secundarios,data_abertura=excluded.data_abertura,
      faturamento_anual=excluded.faturamento_anual,setor=excluded.setor,reducao_padrao=excluded.reducao_padrao,
      codigo_questor=excluded.codigo_questor,observacoes=excluded.observacoes,criado_em=excluded.criado_em`);
  const persistir = () => linhas.forEach((empresa) => {
    const id = Number(empresa.origem_local_id || empresa.id);
    if (!id) return;
    inserir.run(id, String(empresa.cnpj || '').replace(/\D/g, ''), empresa.razao_social || 'Empresa sem razão social',
      textoPersistivel(empresa.nome_fantasia), textoPersistivel(empresa.regime), textoPersistivel(empresa.regime_reconhecimento_simples, 'competencia'), textoPersistivel(empresa.uf), textoPersistivel(empresa.municipio), textoPersistivel(empresa.cnae),
      textoPersistivel(empresa.atividade), textoPersistivel(empresa.cnaes_secundarios), textoPersistivel(empresa.data_abertura, null), Number(empresa.faturamento_anual) || 0, textoPersistivel(empresa.setor), textoPersistivel(empresa.reducao_padrao, 'integral'),
      textoPersistivel(empresa.codigo_questor), textoPersistivel(empresa.observacoes), textoPersistivel(empresa.criado_em, null));
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

function gravarGestao(projetos, entregas, acompanhamentos, responsaveis = [], tarefas = [], checklist = [], empresas = [], marcosSla = [], tarefasSla = []) {
  const comboPorNome = new Map(db.prepare('SELECT id,nome FROM combos').all().map((x) => [x.nome, x.id]));
  const empresaLocalPorRemota = mapaEmpresasLocais(empresas);
  const localPorRemoto = new Map();
  const entregaLocalPorRemota = new Map();
  const marcoLocalPorRemoto = new Map();
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
    const insTarefa = db.prepare('INSERT OR REPLACE INTO projeto_tarefas (id,contratacao_id,entrega_id,titulo,descricao,status,data_abertura,data_conclusao,envolve_cliente,pendencia_cliente,interacoes_cliente,obrigatoria,sla_marco_id,prazo_original,prorrogado_em,justificativa_prorrogacao,criado_em,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
    const insChecklist = db.prepare(`INSERT OR REPLACE INTO projeto_checklist_implantacao
      (id,contratacao_id,entrega_id,escopo,chave,titulo,tipo_evidencia,status,responsavel_id,origem_tipo,origem_id,observacoes,ordem,origem,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of responsaveis) { const entregaId=entregaLocalPorRemota.get(r.entrega_id); const contratacaoId=localPorRemoto.get(r.projeto_id); const id=Number(r.origem_local_id); if(contratacaoId&&id) insResp.run(id,contratacaoId,entregaId||null,r.lado,r.usuario_id||null,r.nome,r.telefone||'',r.email||'',r.funcao||'',r.criado_em||null); }
    for (const t of tarefas) { const entregaId=entregaLocalPorRemota.get(t.entrega_id); const contratacaoId=localPorRemoto.get(t.projeto_id); const id=Number(t.origem_local_id); if(contratacaoId&&entregaId&&id) insTarefa.run(id,contratacaoId,entregaId,t.titulo,t.descricao||'',t.status,t.data_abertura||null,t.data_conclusao||null,t.envolve_cliente?1:0,t.pendencia_cliente||'',t.interacoes_cliente||'',t.obrigatoria?1:0,(t.sla_marco_id && marcoLocalPorRemoto.get(t.sla_marco_id))||null,t.prazo_original||null,t.prorrogado_em||null,t.justificativa_prorrogacao||null,t.criado_em||null,t.atualizado_em||null); }
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

// A tela de cadeia é sensível ao regime do parceiro. A fotografia do motor
// pode continuar válida por meses, enquanto o cadastro de parceiros é
// enriquecido depois (por exemplo, quando a base RFB identifica Lucro Real ou
// Presumido). Restauramos somente os parceiros da empresa consultada: é uma
// leitura pequena, não recalcula tributos e impede que o cache efêmero exiba
// o antigo "REGULAR" no lugar do regime já comprovado na fonte canônica.
async function restaurarParceirosEmpresa(empresaId, remotoInformado = null) {
  if (!ativo()) return { ativo:false, parceiros:0 };
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.id) return { ativo:true, parceiros:0, motivo:'empresa_local_ausente' };
  const remoto = remotoInformado || supabase.admin();
  const cnpj = String(empresa.cnpj || '').replace(/\D/g, '');
  const { data: candidatas, error: erroEmpresa } = await remoto.from('empresas').select('id,origem_local_id,cnpj')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const empresaRemota = (candidatas || []).find((x) => Number(x.origem_local_id || x.id) === Number(empresaId)
    || String(x.cnpj || '').replace(/\D/g, '') === cnpj);
  if (!empresaRemota) return { ativo:true, parceiros:0, motivo:'empresa_remota_ausente' };
  // A cópia local é derivada. Registros arquivados na fonte canônica ficam
  // disponíveis apenas na auditoria remota e nunca devem ser restaurados no
  // cache nem ressuscitar fornecedores consolidados.
  const { data, error } = await remoto.from('parceiros').select('*')
    .eq('empresa_id', empresaRemota.id).eq('ativo', true);
  if (error) throw new Error(`Parceiros compartilhados: ${error.message}`);
  const linhas = normalizarEmpresaIdDoCache('parceiros', data || [], new Map([[String(empresaRemota.id), Number(empresaId)]]));
  // O cadastro compartilhado é a fonte canônica do regime. O parceiro é um
  // vínculo operacional e o SQLite é cache: uma confirmação manual local só
  // permanece válida se já coincidir com o regime publicado no cadastro.
  const normalizarCnpj=(valor)=>String(valor || '').replace(/\D/g,'');
  const cnpjs=[...new Set(linhas.map((linha)=>normalizarCnpj(linha.cnpj)).filter((x)=>x.length===14))];
  const cadastros=[];
  for(let inicio=0;inicio<cnpjs.length;inicio+=200){
    const lote=cnpjs.slice(inicio,inicio+200);
    const { data:linhasCadastro,error:erroCadastro }=await remoto.from('cadastros_cnpj')
      .select('cnpj,regime_derivado,fonte,consultado_em').in('cnpj',lote);
    if(erroCadastro) throw new Error(`Cadastro compartilhado de regime: ${erroCadastro.message}`);
    cadastros.push(...(linhasCadastro || []));
  }
  const cadastroPorCnpj=new Map(cadastros
    .filter((cadastro)=>normalizarCnpj(cadastro.cnpj).length===14 && String(cadastro.regime_derivado || '').trim()
      && String(cadastro.regime_derivado).toLowerCase()!=='indeterminado')
    .map((cadastro)=>[normalizarCnpj(cadastro.cnpj),cadastro]));
  const linhasCanonicas=linhas.map((parceiro)=>{
    const cadastro=cadastroPorCnpj.get(normalizarCnpj(parceiro.cnpj));
    if(!cadastro) return parceiro;
    const regime=String(cadastro.regime_derivado).trim();
    const confirmacaoManualCanonica=String(parceiro.regime_origem || '').toUpperCase().includes('MANUAL')
      && String(parceiro.regime || '').trim().toLowerCase()===regime.toLowerCase();
    return { ...parceiro, regime,
      regime_origem:confirmacaoManualCanonica ? parceiro.regime_origem : `CADASTRO_COMPARTILHADO:${cadastro.fonte || 'REGIME_DERIVADO'}`,
      regime_confirmado_em:confirmacaoManualCanonica ? parceiro.regime_confirmado_em : (cadastro.consultado_em || parceiro.regime_confirmado_em || null),
    };
  });
  const parceiros=gravar('parceiros', linhasCanonicas);
  const regimes_atualizados=aplicarRegimeBaseNosVinculosQuestor(empresaId);
  return { ativo:true, parceiros, regimes_atualizados, empresa_remota_id:empresaRemota.id };
}

async function garantirCacheOperacionalEmpresa(empresaId, opcoes = {}) {
  if (!ativo()) return { ativo:false };
  const id=Number(empresaId);
  if (!Number.isInteger(id)||id<=0) throw new Error('Empresa inválida para hidratação operacional.');
  const maxAgeMs=Math.max(5_000,Number(opcoes.maxAgeMs)||30_000);
  const recente=hidratacoesEmpresaRecentes.get(id);
  if (!opcoes.forcar&&recente&&Date.now()-recente<maxAgeMs) return { ativo:true,cache:'recente',empresa_id:id };
  if (hidratacoesEmpresaEmAndamento.has(id)) return hidratacoesEmpresaEmAndamento.get(id);
  const tarefa=(async()=>{
    const remoto=supabase.admin();
    const empresa=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(id);
    const cnpj=String(empresa?.cnpj || '').replace(/\D/g,'');
    // Após reinício, o SQLite pode ainda não ter a empresa-pai ou ter apenas
    // sua identidade mínima. A fonte compartilhada conhece a origem estável;
    // reidratamos a empresa antes de qualquer filho (período, movimentos,
    // parceiros ou estado de leitura) para nunca violar uma chave estrangeira.
    let consulta=remoto.from('empresas').select('*').or(`origem_local_id.eq.${id},id.eq.${id}`);
    if (cnpj) consulta=remoto.from('empresas').select('*')
      .or(`origem_local_id.eq.${id},id.eq.${id},cnpj.eq.${cnpj}`);
    const { data:candidatas,error:erroEmpresa }=await consulta.limit(10);
    if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
    const remota=(candidatas||[]).find((x)=>Number(x.origem_local_id||x.id)===id
      || (cnpj && String(x.cnpj||'').replace(/\D/g,'')===cnpj));
    if (!remota) throw new Error('Empresa compartilhada não localizada para hidratação operacional.');
    gravarEmpresas([remota]);
    const mapa=new Map([[String(remota.id),id]]);
    const buscarEmpresa=async(tabela)=>{
      const linhas=[];
      for(let de=0;;de+=1000){
        const { data,error }=await remoto.from(tabela).select('*').eq('empresa_id',Number(remota.id))
          .order('id',{ascending:true}).range(de,de+999);
        if(error) throw new Error(`${tabela} compartilhada: ${error.message}`);
        linhas.push(...(data||[]));
        if(!data||data.length<1000) break;
      }
      return normalizarEmpresaIdDoCache(tabela,linhas,mapa);
    };
    // Lotes são pais de movimentos e precisam existir antes da reconciliação.
    const lotes=await buscarEmpresa('lotes');
    gravar('lotes',lotes);
    const pendentesAntes=new Set(db.prepare('SELECT movimento_id FROM motor_pendencias WHERE empresa_id=?').all(id).map((x)=>Number(x.movimento_id)));
    const [movimentos,parceiros]=await Promise.all([
      reconciliarMovimentosEmpresa(id,{ forcar:true,maxAgeMs:0 }),
      restaurarParceirosEmpresa(id,remoto),
    ]);
    // Dependências do fato são repostas somente depois dos movimentos. A ordem
    // também mantém `formacao_custo_componentes` após seu item-pai.
    const auxiliares={};
    for(const tabela of ['formacao_custo_itens','excecoes_motor','enriquecimento_servicos_evidencias',
      'enriquecimento_pis_cofins_evidencias','pendencias_enriquecimento_fiscal']){
      const linhas=await buscarEmpresa(tabela);
      auxiliares[tabela]=gravar(tabela,linhas);
    }
    const itens=db.prepare('SELECT id FROM formacao_custo_itens WHERE empresa_id=?').all(id).map((x)=>Number(x.id));
    let componentes=[];
    for(let de=0;de<itens.length;de+=200){
      const lote=itens.slice(de,de+200);
      const { data,error }=await remoto.from('formacao_custo_componentes').select('*').in('item_formacao_id',lote);
      if(error) throw new Error(`formacao_custo_componentes compartilhada: ${error.message}`);
      componentes.push(...(data||[]));
    }
    auxiliares.formacao_custo_componentes=gravar('formacao_custo_componentes',componentes);
    const referenciasRegime=await hidratarBaseRegimeDaEmpresa(id);
    const regimesAtualizados=aplicarRegimeBaseNosVinculosQuestor(id);
    await restaurarFotografiaMotorEmpresa(id,remoto);
    // A restauração do cache dispara os mesmos gatilhos locais de uma edição.
    // Linhas já cobertas pela fotografia ativa não devem virar recálculo só
    // porque a tela foi aberta. Preservamos pendências anteriores e marcamos
    // novamente apenas snapshots cujo regime diverge da base canônica.
    const pendenciasCache=db.prepare(`SELECT mp.movimento_id FROM motor_pendencias mp
      JOIN motor_resultados mr ON mr.empresa_id=mp.empresa_id AND mr.movimento_id=mp.movimento_id
      WHERE mp.empresa_id=?`).all(id).map((x)=>Number(x.movimento_id)).filter((movimentoId)=>!pendentesAntes.has(movimentoId));
    if(pendenciasCache.length){
      for(let de=0;de<pendenciasCache.length;de+=500){
        const lote=pendenciasCache.slice(de,de+500);
        db.prepare(`DELETE FROM motor_pendencias WHERE empresa_id=? AND movimento_id IN (${lote.map(()=>'?').join(',')})`).run(id,...lote);
      }
    }
    // A auditoria de fotografia deve usar o regime já consolidado no vínculo
    // compartilhado do parceiro. `base_regime` é apenas uma evidência anual
    // auxiliar (e não cobre, por exemplo, Simples); usá-la aqui fazia a tela
    // recriar pendências logo após um reprocessamento correto.
    //
    // Também removemos somente marcas técnicas da versão anterior desta
    // auditoria. Pendências de classificação, documento ou regra fiscal não
    // são tocadas durante a abertura da tela.
    db.prepare(`DELETE FROM motor_pendencias
      WHERE empresa_id=? AND motivo LIKE 'REGIME_BASE_CANONICA_%'`).run(id);

    // A sincronização não pode comparar a empresa inteira numa única leitura.
    // Lê IDs em páginas determinísticas e calcula divergência apenas do lote.
    // Isso evita que a abertura de uma tela dispare materialização da carteira.
    const listarIdsFornecedor=db.prepare(`SELECT id FROM movimentos
      WHERE empresa_id=? AND tipo='fornecedor' AND id>? ORDER BY id LIMIT ?`);
    const divergentesDoLote=(ids)=>db.prepare(`WITH regime_cadastro AS (
        SELECT m.id movimento_id,p.regime,
          ROW_NUMBER() OVER (PARTITION BY m.id ORDER BY
            CASE WHEN REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','') THEN 0 ELSE 1 END,
            p.id DESC) posicao
        FROM movimentos m JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo='fornecedor'
          AND (REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
            OR SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ',''),1,8)=SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ',''),1,8))
        WHERE m.empresa_id=? AND m.id IN (${ids.map(()=>'?').join(',')})
          AND COALESCE(p.regime,'')<>'' AND LOWER(p.regime)<>'indeterminado'
      ) SELECT mr.movimento_id,rc.regime FROM motor_resultados mr
        JOIN fotografia_oficial fo ON fo.empresa_id=mr.empresa_id AND fo.execucao_id=mr.execucao_id
        JOIN regime_cadastro rc ON rc.movimento_id=mr.movimento_id AND rc.posicao=1
        WHERE mr.empresa_id=? AND LOWER(COALESCE(CASE WHEN json_valid(COALESCE(mr.detalhe,'')) THEN json_extract(mr.detalhe,'$.regimeEmitente') END,mr.regime_cbs_emitente,''))<>LOWER(rc.regime)`)
      .all(id,...ids,id);
    const marcar=db.prepare(`INSERT INTO motor_pendencias(empresa_id,movimento_id,motivo,atualizado_em)
      VALUES (?,?,?,datetime('now','localtime')) ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET motivo=excluded.motivo,atualizado_em=excluded.atualizado_em`);
    let cursorMovimento=0, totalDivergentes=0;
    for (;;) {
      const ids=listarIdsFornecedor.all(id,cursorMovimento,250).map((x)=>Number(x.id));
      if (!ids.length) break;
      const loteDivergente=divergentesDoLote(ids);
      db.transaction(()=>loteDivergente.forEach((x)=>marcar.run(id,x.movimento_id,`REGIME_CADASTRO_COMPARTILHADO_${String(x.regime).toUpperCase()}`)))();
      totalDivergentes+=loteDivergente.length;
      cursorMovimento=ids.at(-1);
      if (ids.length<250) break;
    }
    hidratacoesEmpresaRecentes.set(id,Date.now());
    return { ativo:true,cache:'hidratado',empresa_id:id,lotes:lotes.length,
      movimentos:movimentos.movimentos?.length||0,parceiros:parceiros.parceiros||0,auxiliares,
      referencias_regime:referenciasRegime,regimes_atualizados:regimesAtualizados,fotografias_regime_divergente:totalDivergentes };
  })().finally(()=>hidratacoesEmpresaEmAndamento.delete(id));
  hidratacoesEmpresaEmAndamento.set(id,tarefa);
  return tarefa;
}

async function baixar(remotoInformado = null, opcoes = {}) {
  if (!ativo()) return { ativo: false };
  const remoto = remotoInformado || supabase.admin(), resultado = {}, falhas = {};
  // A carteira é a âncora do cache efêmero. Ela precisa ser carregada antes
  // das bases auxiliares: uma falha isolada nunca pode fazer a interface
  // parecer que todas as empresas foram excluídas.
  // Estas duas tabelas referenciam a execução do motor. Carregá-las antes da
  // fotografia ativa viola FK em uma instância nova e deixava a carga-base
  // artificialmente parcial. Elas são restauradas logo após o motor.
  const dependentesDoMotor = ['excecoes_motor_execucoes', 'telemetria_autonomia_execucoes'];
  const segmentadoPorEmpresa=Boolean(opcoes.segmentadoPorEmpresa);
  const tabelas = Object.keys(CAMPOS).filter((tabela) => tabela !== 'empresas' && !dependentesDoMotor.includes(tabela)
    && (!segmentadoPorEmpresa || !TABELAS_CACHE_POR_EMPRESA.has(tabela)));
  const empresasValidas = new Set(), lotesValidos = new Set();
  let empresaLocalPorRemota = new Map();
  // A carteira é a única dependência para a navegação inicial. Ela é gravada
  // antes dos catálogos grandes, para que um deploy não entregue uma tela
  // vazia enquanto a fotografia complementar continua sendo baixada.
  try {
    const origemEmpresas = await buscarTudo(remoto, 'empresas');
    empresaLocalPorRemota = mapaEmpresasLocais(origemEmpresas);
    origemEmpresas.forEach((x) => empresasValidas.add(empresaLocalPorRemota.get(String(x.id))));
    resultado.empresas = gravarEmpresas(origemEmpresas);
    await cederAoServidor();
  } catch (e) { falhas.empresas = e.message; }
  const colecoes = await buscarColecoes(remoto, tabelas);
  for (const tabela of tabelas) {
    try {
      const carga = colecoes.get(tabela);
      if (carga?.erro) throw carga.erro;
      const origem = carga?.linhas || [];
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
      resultado[tabela] = await gravarEmLotes(tabela, linhas, { qsa:tabela === 'empresa_qsa' });
    } catch (e) {
      falhas[tabela] = e.message;
    }
  }
  let motorCarregado = false;
  if (segmentadoPorEmpresa) resultado.cache_empresa_segmentado=true;
  else {
    resultado.motor = await baixarResultadosMotor(remoto);
    motorCarregado = !resultado.motor?.desativada;
  }
  if (motorCarregado) {
    for (const tabela of dependentesDoMotor) {
      try {
        const origem = await buscarTudo(remoto, tabela);
        const linhas = normalizarEmpresaIdDoCache(tabela, origem, empresaLocalPorRemota);
        resultado[tabela] = gravar(tabela, linhas);
      } catch (e) { falhas[tabela] = e.message; }
    }
  } else if (!segmentadoPorEmpresa && !resultado.motor?.desativada) {
    for (const tabela of dependentesDoMotor) falhas[tabela] = 'Fotografia do motor indisponível; tabela dependente não foi carregada.';
  }
  try { Object.assign(resultado, await baixarConfiguracao(CONFIG_TABELAS, remoto)); }
  catch (e) { falhas.configuracao = e.message; }
  try { Object.assign(resultado, await baixarParametrosIrpjCsll(remoto)); }
  catch (e) { falhas.parametros_irpj_csll = e.message; }
  try { resultado.gestao = await baixarGestao(remoto); }
  catch (e) { falhas.gestao = e.message; }
  try { resultado.exclusoes_canonicas = await aplicarExclusoesCanonicas(remoto); }
  catch (e) { falhas.exclusoes_canonicas = e.message; }
  if (Object.keys(falhas).length) resultado.falhas = falhas;
  return resultado;
}
async function baixarRegrasEnquadramento(remotoInformado = null) {
  if (!supabase.configurado()) return { ativo: false };
  const linhas = await buscarTudo(remotoInformado || supabase.admin(), 'regras_enquadramento');
  return { regras_enquadramento: gravar('regras_enquadramento', linhas) };
}

// O worker do Render possui disco efêmero. Antes de calcular um job, ele
// recompõe somente a identidade da empresa e as referências fiscais usadas
// pelo motor. Não carrega documentos de outras empresas e não escreve na
// fonte compartilhada.
const TABELAS_MOTOR_DA_EMPRESA = [
  'empresa_servicos_fiscais', 'parceiros', 'empresa_qsa',
];
const TABELAS_MOTOR_APOS_DOCUMENTOS = ['enriquecimento_servicos_evidencias', 'enriquecimento_pis_cofins_evidencias'];
const REFERENCIAS_GLOBAIS_DO_MOTOR = ['base_ncm', 'base_servicos', 'regras_governo', 'param_naturezas_juridicas_anexo_xi'];

async function buscarPorValores(remoto, tabela, coluna, valores, empresaId = null) {
  const unicos=[...new Set((valores || []).map((x) => String(x || '').trim()).filter(Boolean))];
  const linhas=[];
  for (let inicio=0; inicio<unicos.length; inicio+=200) {
    let consulta=remoto.from(tabela).select('*').in(coluna,unicos.slice(inicio,inicio+200));
    if (empresaId != null) consulta=consulta.eq('empresa_id',Number(empresaId));
    const { data,error }=await consulta;
    if (error) throw new Error(`${tabela} incremental: ${error.message}`);
    linhas.push(...(data || []));
  }
  return linhas;
}

async function prepararReferenciasIncrementais(remoto, empresaRemota, empresaLocal, movimentos) {
  const contexto={ empresa:1,referencias:{},dados_empresa:{} };
  // Parâmetros versionados são pequenos e necessários a qualquer cálculo;
  // `baixarConfiguracao` já consulta somente as chaves do motor.
  Object.assign(contexto.referencias,await baixarConfiguracao(CONFIG_TABELAS,remoto));
  const ncm=movimentos.map((m)=>String(m.ncm||'').replace(/\D/g,'')).filter(Boolean);
  const nbs=movimentos.map((m)=>String(m.nbs||'').replace(/\D/g,'')).filter(Boolean);
  const lc116=movimentos.map((m)=>String(m.lc116||'').trim()).filter(Boolean);
  const [ncmLinhas,servicosNbs,servicosLc]=await Promise.all([
    buscarPorValores(remoto,'base_ncm','ncm',ncm),
    buscarPorValores(remoto,'base_servicos','nbs',nbs),
    buscarPorValores(remoto,'base_servicos','lc116',lc116),
  ]);
  const servicos=[...new Map([...servicosNbs,...servicosLc].map((x)=>[String(x.id),x])).values()];
  contexto.referencias.base_ncm=gravar('base_ncm',ncmLinhas);
  contexto.referencias.base_servicos=gravar('base_servicos',servicos);
  // Regras de governo só são relevantes às chaves presentes no lote; as
  // regras genéricas pertencem a param_regras já restaurada acima.
  const governo=[...await buscarPorValores(remoto,'regras_governo','ncm',ncm),
    ...await buscarPorValores(remoto,'regras_governo','nbs',nbs),
    ...await buscarPorValores(remoto,'regras_governo','lc116',lc116)];
  contexto.referencias.regras_governo=gravar('regras_governo',[...new Map(governo.map((x)=>[String(x.id),x])).values()]);
  const cnpjs=movimentos.map((m)=>String(m.inscr_federal||'').replace(/\D/g,'')).filter(Boolean);
  // CNPJ não é chave global do parceiro: a mesma contraparte pode existir em
  // várias empresas. Sem o escopo, uma linha de outra empresa preserva o
  // empresa_id remoto e viola a FK no SQLite recém-iniciado.
  const parceiros=await buscarPorValores(remoto,'parceiros','cnpj',cnpjs,empresaRemota.id);
  contexto.dados_empresa.parceiros=gravar('parceiros',normalizarEmpresaIdDoCache('parceiros',parceiros,new Map([[String(empresaRemota.id),empresaLocal]])));
  const { data:qsa,error:erroQsa }=await remoto.from('empresa_qsa').select('*').eq('empresa_id',empresaRemota.id);
  if (erroQsa) throw new Error(`empresa_qsa incremental: ${erroQsa.message}`);
  contexto.dados_empresa.empresa_qsa=gravarEmpresaQsa(normalizarEmpresaIdDoCache('empresa_qsa',qsa||[],new Map([[String(empresaRemota.id),empresaLocal]])));
  try { require('./regras').invalidar(); } catch (_) { /* cache opcional */ }
  return contexto;
}

async function prepararContextoMotorEmpresa(empresaId) {
  if (!ativo()) throw new Error('A fonte compartilhada não está configurada para preparar o worker.');
  const id = Number(empresaId);
  if (!Number.isInteger(id) || id <= 0) throw new Error('Empresa inválida para preparar o worker.');
  const remoto = supabase.admin();
  const { data: candidatas, error: erroEmpresa } = await remoto.from('empresas').select('*')
    .or(`origem_local_id.eq.${id},id.eq.${id}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa do worker: ${erroEmpresa.message}`);
  const empresas = (candidatas || []).filter((empresa) => Number(empresa.origem_local_id || empresa.id) === id);
  if (empresas.length !== 1) throw new Error(`Empresa compartilhada não identificada unicamente para o job ${id}.`);
  const empresaRemota = empresas[0];
  gravarEmpresas([empresaRemota]);
  const mapaEmpresa = new Map([[String(empresaRemota.id), id]]);
  const resultado = { empresa: 1, referencias: {}, dados_empresa: {} };
  Object.assign(resultado.referencias, await baixarConfiguracao(CONFIG_TABELAS, remoto));
  Object.assign(resultado.referencias, await baixarRegrasEnquadramento(remoto));
  for (const tabela of REFERENCIAS_GLOBAIS_DO_MOTOR) {
    const linhas = await buscarTudo(remoto, tabela);
    // A instância do worker pode conter a semente local destas regras. A
    // fotografia compartilhada é a referência; limpar somente o espelho
    // técnico evita colisão entre a chave id local e a unicidade funcional.
    // Não toca em documentos, movimentos ou qualquer dado compartilhado.
    if (tabela === 'regras_governo') db.prepare('DELETE FROM regras_governo').run();
    resultado.referencias[tabela] = gravar(tabela, linhas);
  }
  for (const tabela of TABELAS_MOTOR_DA_EMPRESA) {
    const { data, error } = await remoto.from(tabela).select('*').eq('empresa_id', empresaRemota.id);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    const linhas = normalizarEmpresaIdDoCache(tabela, data || [], mapaEmpresa);
    resultado.dados_empresa[tabela] = tabela === 'empresa_qsa' ? gravarEmpresaQsa(linhas) : gravar(tabela, linhas);
  }
  resultado.referencias.base_regime=await hidratarBaseRegimeDaEmpresa(id);
  resultado.dados_empresa.regimes_base_questor=aplicarRegimeBaseNosVinculosQuestor(id);
  try { require('./regras').invalidar(); } catch (_) { /* somente cache */ }
  return resultado;
}

// Um job incremental não pode depender do disco efêmero do worker. Os IDs
// enviados pela fila são IDs canônicos do Supabase; antes de calcular,
// reidratamos *somente* esses fatos e suas evidências. Esta rotina não publica,
// não remove e não reconcilia a base: o SQLite é apenas o cache descartável do
// worker.
async function prepararContextoMotorIncremental(empresaId, movimentoIds = []) {
  const id = Number(empresaId);
  const ids = [...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error('Preparação incremental sem movimentos explícitos.');
  const remoto = supabase.admin();
  // O cache precisa da identidade completa (sobretudo CNPJ) porque, ao fim
  // do lote, a publicação do estado da projeção resolve novamente a empresa
  // compartilhada. Trazer somente IDs fazia o cálculo terminar e falhar ao
  // publicar o estado final como se a empresa não existisse.
  const { data: candidatas, error: erroEmpresa } = await remoto.from('empresas').select('*')
    .or(`origem_local_id.eq.${id},id.eq.${id}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa do worker incremental: ${erroEmpresa.message}`);
  const empresaRemota = (candidatas || []).find((empresa) => Number(empresa.origem_local_id || empresa.id) === id);
  if (!empresaRemota) throw new Error(`Empresa compartilhada não identificada para o job incremental ${id}.`);
  // `movimentos.empresa_id` possui chave estrangeira no cache SQLite. Um
  // worker novo pode ter recebido o job antes de qualquer tela hidratar a
  // empresa; portanto a empresa-pai precisa existir antes do lote de fatos.
  // Sem essa ordem o primeiro INSERT do delta falha com FOREIGN KEY e deixa
  // uma decisão já confirmada apenas como atualização pendente.
  gravarEmpresas([empresaRemota]);
  const remotos=[];
  for (let de=0;de<ids.length;de+=500) {
    const { data, error } = await remoto.from('movimentos').select('*')
      .eq('empresa_id', Number(empresaRemota.id)).in('id', ids.slice(de,de+500));
    if (error) throw new Error(`Movimentos do job incremental: ${error.message}`);
    remotos.push(...(data || []));
  }
  if (remotos.length !== ids.length) throw new Error('Job incremental contém lançamento inexistente ou de outra empresa na fonte canônica.');
  const mapaEmpresa = new Map([[String(empresaRemota.id), id]]);
  const movimentos = normalizarEmpresaIdDoCache('movimentos', remotos || [], mapaEmpresa);
  const locaisConflitantes = db.prepare(`SELECT id,empresa_id FROM movimentos WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids).filter((linha) => Number(linha.empresa_id) !== id);
  if (locaisConflitantes.length) throw new Error('Colisão de identidade no cache do worker; a fotografia ativa foi preservada.');
  gravar('movimentos', movimentos);
  const contexto = await prepararReferenciasIncrementais(remoto,empresaRemota,id,movimentos);
  // No worker efêmero, o contexto da empresa é preparado antes de os
  // movimentos explícitos do lote existirem no cache. Como a base de regimes
  // é escopada pelos CNPJs desses movimentos, hidrate-a novamente após o lote
  // chegar e antes de qualquer cálculo.
  contexto.referencias.base_regime = await hidratarBaseRegimeDaEmpresa(id);
  contexto.dados_empresa.regimes_base_questor = aplicarRegimeBaseNosVinculosQuestor(id);
  const evidencias = {};
  for (const tabela of TABELAS_MOTOR_APOS_DOCUMENTOS) {
    const linhas=[];
    for (let de=0;de<ids.length;de+=500) {
      const { data, error } = await remoto.from(tabela).select('*').eq('empresa_id', Number(empresaRemota.id)).in('movimento_id', ids.slice(de,de+500));
      if (error) throw new Error(`${tabela} incremental: ${error.message}`);
      linhas.push(...(data || []));
    }
    evidencias[tabela] = gravar(tabela, normalizarEmpresaIdDoCache(tabela, linhas, mapaEmpresa));
  }
  return { ...contexto, movimentos: movimentos.length, evidencias };
}

// O worker pode iniciar em outra instância e só reconhece IDs canônicos da
// fonte compartilhada. Esta leitura não altera documentos nem fotografias.
async function listarMovimentosCanonicosEmpresa(empresaId) {
  if (!ativo()) throw new Error('A fonte compartilhada não está disponível para agendar o recálculo por parâmetro.');
  const idLocal = Number(empresaId);
  if (!Number.isInteger(idLocal) || idLocal <= 0) throw new Error('Empresa inválida para o recálculo por parâmetro.');
  const remoto = supabase.admin();
  const { data: empresas, error: erroEmpresa } = await remoto.from('empresas').select('id,origem_local_id')
    .or(`origem_local_id.eq.${idLocal},id.eq.${idLocal}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa do recálculo por parâmetro: ${erroEmpresa.message}`);
  const empresaRemota = (empresas || []).find((empresa) => Number(empresa.origem_local_id || empresa.id) === idLocal);
  if (!empresaRemota) throw new Error('Empresa compartilhada não identificada para o recálculo por parâmetro.');
  const movimento_ids = [];
  for (let de = 0;; de += 1000) {
    const { data, error } = await remoto.from('movimentos').select('id')
      .eq('empresa_id', Number(empresaRemota.id)).range(de, de + 999);
    if (error) throw new Error(`Movimentos do recálculo por parâmetro: ${error.message}`);
    movimento_ids.push(...(data || []).map((linha) => Number(linha.id)).filter(Number.isInteger));
    if (!data || data.length < 1000) break;
  }
  return { empresa_remota_id: Number(empresaRemota.id), movimento_ids: [...new Set(movimento_ids)] };
}

// Evidências apontam para movimentos fiscais. Elas só podem ser restauradas
// depois que a reconciliação da empresa inseriu os documentos no SQLite do
// worker; restaurá-las antes violaria FK e interromperia o job sem cálculo.
async function restaurarEvidenciasMotorAposDocumentos(empresaId) {
  if (!ativo()) throw new Error('A fonte compartilhada não está configurada para restaurar evidências do motor.');
  const id = Number(empresaId); const remoto = supabase.admin();
  const { data: candidatas, error: erroEmpresa } = await remoto.from('empresas').select('id,origem_local_id')
    .or(`origem_local_id.eq.${id},id.eq.${id}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa do worker: ${erroEmpresa.message}`);
  const empresaRemota = (candidatas || []).find((empresa) => Number(empresa.origem_local_id || empresa.id) === id);
  if (!empresaRemota) throw new Error(`Empresa compartilhada não identificada para restaurar evidências do job ${id}.`);
  const mapaEmpresa = new Map([[String(empresaRemota.id), id]]); const resultado = {};
  for (const tabela of TABELAS_MOTOR_APOS_DOCUMENTOS) {
    const { data, error } = await remoto.from(tabela).select('*').eq('empresa_id', empresaRemota.id);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    resultado[tabela] = gravar(tabela, normalizarEmpresaIdDoCache(tabela, data || [], mapaEmpresa));
  }
  return resultado;
}

// A composição do Perfil é uma leitura financeira: ela não pode usar uma
// linha residual do cache após uma importação, exclusão ou cancelamento já
// confirmado na base compartilhada. Esta reconciliação é deliberadamente
// restrita à empresa consultada e à tabela de movimentos; não altera a fonte
// remota e não exige nova consulta ao Questor.
function escopoCompetencias(opcoes = {}) {
  const inicio = String(opcoes.competenciaInicio || '');
  const fim = String(opcoes.competenciaFim || '');
  return /^\d{4}-\d{2}$/.test(inicio) && /^\d{4}-\d{2}$/.test(fim) && inicio <= fim
    ? { inicio, fim, chave: `${inicio}:${fim}` } : null;
}

async function carregarMovimentosCanonicos(empresa, opcoes = {}) {
  const cnpj = String(empresa.cnpj).replace(/\D/g, '');
  const escopo = escopoCompetencias(opcoes);
  // O worker já possui a API autenticada da fonte compartilhada. Priorizá-la
  // elimina a dependência de uma URL PostgreSQL direta para a leitura fiscal
  // do job, que pode variar entre Web e Worker sem afetar a fonte de verdade.
  if (ativo()) {
    const remoto = supabase.admin();
    const { data: empresasRemotas, error: erroEmpresa } = await remoto.from('empresas').select('id,cnpj,origem_local_id').eq('cnpj', cnpj).limit(2);
    if (erroEmpresa) throw erroEmpresa;
    if ((empresasRemotas || []).length !== 1) throw new Error('Não foi possível identificar unicamente a empresa compartilhada para a reconciliação documental.');
    const remota = empresasRemotas[0], linhas = [];
    for (let de = 0;; de += 1000) {
      let consulta = remoto.from('movimentos').select('*').eq('empresa_id', remota.id);
      if (escopo) consulta = consulta.gte('competencia', escopo.inicio).lte('competencia', escopo.fim);
      const { data, error } = await consulta.range(de, de + 999);
      if (error) throw error;
      linhas.push(...(data || []));
      if (!data || data.length < 1000) return { remota, linhas, origem: 'SUPABASE_API' };
    }
  }
  // Algumas instalações mantêm somente a URL PostgreSQL compartilhada. Para
  // uma leitura crítica, ela é uma fonte válida e evita que a ausência da
  // chave de serviço devolva uma composição antiga do SQLite.
  if (!process.env.SUPABASE_DB_URL) throw new Error('A fonte compartilhada dos documentos fiscais não está configurada; o Perfil não exibirá uma composição possivelmente desatualizada.');
  const banco = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await banco.connect();
  try {
    const empresas = await banco.query("SELECT id,cnpj,origem_local_id FROM empresas WHERE regexp_replace(cnpj,'[^0-9]','','g')=$1 LIMIT 2", [cnpj]);
    if (empresas.rows.length !== 1) throw new Error('Não foi possível identificar unicamente a empresa compartilhada para a reconciliação documental.');
    const remota = empresas.rows[0];
    const condicaoEscopo = escopo ? ' AND competencia >= $2 AND competencia <= $3' : '';
    const parametros = escopo ? [remota.id, escopo.inicio, escopo.fim] : [remota.id];
    const linhas = (await banco.query(`SELECT * FROM movimentos WHERE empresa_id=$1${condicaoEscopo}`, parametros)).rows;
    return { remota, linhas, origem: 'POSTGRES_COMPARTILHADO' };
  } finally { await banco.end(); }
}

// A leitura da Central de Dados pode disparar mais de uma rota quase ao mesmo
// tempo (lista, prontidão e Perfil). Consultar e regravar todos os movimentos
// remotos em cada uma delas faz a navegação escalar com o volume da empresa.
// Mantemos uma fotografia curta da última leitura canônica. O atalho não pode
// voltar ao SQLite local: ele existe apenas para reduzir chamadas consecutivas
// sem reintroduzir mistura de fontes na mesma tela.
const JANELA_RECONCILIACAO_MOVIMENTOS_MS = 8000;
const reconciliacoesRecentes = new Map();
const reconciliacoesEmAndamento = new Map();

function lerMovimentosLocais(empresaId, opcoes = {}) {
  const escopo = escopoCompetencias(opcoes);
  const ids=[...new Set((opcoes.movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (ids.length) return db.prepare(`SELECT * FROM movimentos WHERE empresa_id=? AND id IN (${ids.map(()=>'?').join(',')})`).all(Number(empresaId),...ids);
  if (!escopo) throw new Error('LEITURA_GLOBAL_PROIBIDA: reconciliação local exige competência ou movimento_ids explícitos.');
  return db.prepare('SELECT * FROM movimentos WHERE empresa_id=? AND competencia>=? AND competencia<=?').all(Number(empresaId), escopo.inicio, escopo.fim);
}

// A auditoria é a trilha durável das exclusões feitas pelo usuário. Algumas
// exclusões antigas ocorreram antes de a remoção canônica existir; portanto,
// mesmo que um registro residual ainda exista no compartilhado, ele jamais
// pode voltar a materializar-se no cache ou compor uma tela financeira.
async function chavesDocumentosExcluidosAuditados(remoto, empresaId, empresaRemotaId = null) {
  // A chave fiscal, isoladamente, não é evidência suficiente para suprimir
  // uma versão posterior do documento. Em bases antigas havia cópias
  // duplicadas com a mesma chave; a exclusão da cópia de quatro itens não
  // pode eliminar uma versão canônica posterior com dois itens.
  const chaves = new Map();
  for (let de = 0;; de += 1000) {
    const empresas=[...new Set([empresaId,empresaRemotaId].map(Number).filter(Number.isInteger))];
    const { data, error } = await remoto.from('auditoria').select('entidade_id,antes')
      .in('empresa_id', empresas).eq('acao', 'DOCUMENTO_FISCAL_EXCLUIDO')
      .eq('entidade', 'movimentos').range(de, de + 999);
    if (error) throw new Error(`Trilha de exclusões fiscais: ${error.message}`);
    for (const evento of (data || [])) {
      const chave = String(evento.entidade_id || '').replace(/^chave:/, '').trim();
      if (!chave) continue;
      const antes = evento.antes && typeof evento.antes === 'object' ? evento.antes : {};
      const itens = Number(antes.itens);
      const valor = Number(antes.valor);
      // Eventos sem a composição antiga permanecem conservadores: bloqueiam
      // pela chave, porque não existe evidência bastante para diferenciá-los.
      chaves.set(chave, {
        itens: Number.isFinite(itens) && itens > 0 ? itens : null,
        valor: Number.isFinite(valor) ? valor : null,
      });
    }
    if (!data || data.length < 1000) break;
  }
  return chaves;
}

function chavesQueDevemPermanecerExcluidas(linhas, exclusoes) {
  const porChave = new Map();
  for (const linha of linhas) {
    const chave = String(linha?.chave || '').trim();
    if (!chave || !exclusoes.has(chave)) continue;
    const atual = porChave.get(chave) || { itens: 0, valor: 0 };
    atual.itens += 1;
    atual.valor += Number(linha?.valor || 0);
    porChave.set(chave, atual);
  }
  const manter = new Set();
  for (const [chave, excluido] of exclusoes) {
    const atual = porChave.get(chave);
    // Sem memória quantitativa no evento, mantém a proteção legado. Quando
    // há quantidade e valor, a exclusão só vale para a mesma fotografia.
    if (!excluido?.itens || excluido?.valor == null
      || (atual && atual.itens === excluido.itens && Math.abs(atual.valor - excluido.valor) < 0.01)) {
      manter.add(chave);
    }
  }
  return manter;
}

function diagnosticarDivergenciaMovimentosCanonicos(normalizadas, locais, remover = []) {
  const camposComparacao=CAMPOS.movimentos.filter((campo)=>campo!=='criado_em');
  const normalizarComparacao=(linha)=>JSON.stringify(Object.fromEntries(camposComparacao.map((campo)=>{
    const valor=linha?.[campo];
    return [campo, valor && typeof valor === 'object' ? JSON.stringify(valor) : (valor ?? null)];
  })));
  const locaisPorId=new Map((locais || []).map((linha)=>[Number(linha.id),linha]));
  const divergentes=(normalizadas || []).filter((linha)=>normalizarComparacao(linha)!==normalizarComparacao(locaisPorId.get(Number(linha.id))));
  return { inclusoes_ou_alteracoes:divergentes.length, remocoes:(remover || []).length, bloqueia:Boolean(divergentes.length || (remover || []).length) };
}

async function reconciliarMovimentosEmpresa(empresaId, opcoes = {}) {
  const id = Number(empresaId);
  const escopo = escopoCompetencias(opcoes);
  const movimentoIds = [...new Set((opcoes.movimentoIds || []).map(Number).filter(Number.isInteger))];
  // Tela analítica não é sincronização integral. Sem recorte explícito, a
  // rotina preserva a fonte já materializada e informa estado pendente, sem
  // carregar carteiras locais/remotas em memória.
  if (!escopo && !movimentoIds.length) {
    return {
      ativo: ativo(), origem:'RECONCILIACAO_GLOBAL_BLOQUEADA', bloqueada:true,
      inseridos_ou_atualizados:0, removidos:0, sincronizado_em:Date.now(), movimentos:[],
      motivo:'LEITURA_GLOBAL_PROIBIDA: reconciliação exige competência ou movimento_ids explícitos.',
    };
  }
  // A importação feita nesta instância é persistida no SQLite local. Quando a
  // operação compartilhada não foi configurada, bloquear a leitura do Perfil
  // esconderia documentos recém-importados e induziria uma nova importação.
  // Neste cenário não há fonte canônica externa a consultar: a própria base
  // persistida é a fonte disponível, identificada explicitamente no retorno.
  if (!ativo() && !process.env.SUPABASE_DB_URL) {
    return {
      ativo: false,
      origem: 'BASE_LOCAL_PERSISTIDA',
      inseridos_ou_atualizados: 0,
      removidos: 0,
      sincronizado_em: Date.now(),
      movimentos: lerMovimentosLocais(id, opcoes),
    };
  }
  const agora = Date.now();
  const maxAgeMs = Number.isFinite(Number(opcoes.maxAgeMs))
    ? Number(opcoes.maxAgeMs)
    : JANELA_RECONCILIACAO_MOVIMENTOS_MS;
  const chaveCache = `${id}:${escopo?.chave || 'TODAS'}`;
  const recente = reconciliacoesRecentes.get(chaveCache);
  if (!opcoes.forcar && maxAgeMs > 0 && recente && agora - recente.sincronizadoEm < maxAgeMs) {
    return {
      ativo: true,
      origem: 'CACHE_CANONICO_RECENTE',
      inseridos_ou_atualizados: 0,
      removidos: 0,
      sincronizado_em: recente.sincronizadoEm,
      movimentos: recente.movimentos || [],
    };
  }
  if (!opcoes.forcar && reconciliacoesEmAndamento.has(chaveCache)) return reconciliacoesEmAndamento.get(chaveCache);

  const execucao = (async () => {
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(id);
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para reconciliação documental.');
  let leitura = await carregarMovimentosCanonicos(empresa, opcoes);
  let { remota, linhas, origem } = leitura;
  linhas = deduplicarMovimentosFiscais(linhas);
  let normalizadas = normalizarEmpresaIdDoCache('movimentos', linhas, new Map([[String(remota.id), id]]));
  const chavesExcluidas = await chavesDocumentosExcluidosAuditados(supabase.admin(), id);
  let chavesBloqueadas = chavesQueDevemPermanecerExcluidas(normalizadas, chavesExcluidas);
  normalizadas = normalizadas.filter((linha) => !chavesBloqueadas.has(String(linha.chave || '').trim()));
  let remotos = new Set(normalizadas.map((x) => Number(x.id)).filter(Number.isInteger));
  // Em leitura por competência, a reconciliação nunca toma decisões sobre
  // documentos de outros meses. Isso reduz volume e protege o histórico fora
  // da janela analisada contra qualquer atualização incidental do cache.
  const locais = lerMovimentosLocais(id, opcoes);
  // O id técnico local pode diferir do id da fonte comum. XML tem identidade
  // fiscal própria; nunca se devolve uma cópia local se a mesma nota já está
  // disponível na fonte canônica.
  // XML usa chave fiscal. Inclusões confirmadas pelo Questor usam a chave
  // estável gerada para a própria inclusão; o id SQLite não é compartilhado
  // entre Web e Worker e não pode decidir se uma entrada existe remotamente.
  const identidadeFiscal = (linha) => {
    const origem=String(linha?.origem || '').toUpperCase();
    if (origem === 'XML' && linha?.chave) return `xml:${linha.chave}:${linha.item_numero}`;
    if (['QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO'].includes(origem) && linha?.chave) return `questor:${origem}:${linha.chave}:${linha.item_numero}`;
    return null;
  };
  let identidadesRemotas = new Set(normalizadas.map(identidadeFiscal).filter(Boolean));
  const pendentes = locais.filter((linha) => !remotos.has(Number(linha.id))
    && !identidadesRemotas.has(identidadeFiscal(linha))
    && ['xml','sped'].includes(String(linha.origem || '').toLowerCase()));
  const pendentesQuestor=locais.filter((linha) => !remotos.has(Number(linha.id))
    && !identidadesRemotas.has(identidadeFiscal(linha))
    && ['QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO'].includes(String(linha.origem || '').toUpperCase()));
  // Reconciliação é estritamente leitura da fonte canônica. Um cache local
  // desatualizado jamais pode republicar documento que foi excluído na fonte
  // compartilhada; a publicação só ocorre nos fluxos explícitos de
  // importação/conciliação, antes de a tela ser liberada ao usuário.
  // Isso elimina o ciclo "exclui e volta" entre instâncias.
  // `pendentes` é mantido apenas para o diagnóstico da divergência; nunca
  // dispara publicação implícita a partir da leitura.
  const removerNormais = locais.filter((linha) => !remotos.has(Number(linha.id))
    && !identidadesRemotas.has(identidadeFiscal(linha))
    && !['xml','sped','questor_conciliacao_entrada','questor_razao'].includes(String(linha.origem || '').toLowerCase())).map((linha) => Number(linha.id));
  // Exclusão expressa sempre prevalece sobre a proteção normal de XML/SPED:
  // esta proteção existe para evitar perda acidental por falta de publicação,
  // não para desfazer uma remoção confirmada pelo usuário.
  const removerPorExclusao = locais.filter((linha) => chavesBloqueadas.has(String(linha.chave || '').trim()))
    .map((linha) => Number(linha.id));
  const remover = [...new Set([...removerNormais, ...removerPorExclusao])];
  // O motor geral jamais corrige a base fiscal. Em modo somente leitura,
  // qualquer diferença é um bloqueio explícito: não remove fatos locais e
  // não reimporta fatos canônicos, inclusive os que foram excluídos.
  const divergencia=diagnosticarDivergenciaMovimentosCanonicos(normalizadas, locais, remover);
  if (opcoes.somenteLeitura && divergencia.bloqueia) {
    throw new Error(`Fonte canônica e cache local divergem (${divergencia.inclusoes_ou_alteracoes} inclusão/alteração(ões), ${divergencia.remocoes} remoção(ões)). O motor foi bloqueado: sincronize ou revise os fatos explicitamente; ele não altera a base fiscal.`);
  }
  db.transaction(() => {
    if (remover.length) {
      const marcas = remover.map(() => '?').join(',');
      db.prepare(`DELETE FROM motor_resultados WHERE movimento_id IN (${marcas})`).run(...remover);
      db.prepare(`DELETE FROM movimentos WHERE empresa_id=? AND id IN (${marcas})`).run(id, ...remover);
    }
    gravar('movimentos', normalizadas, true);
  })();
    const sincronizadoEm = Date.now();
    reconciliacoesRecentes.set(chaveCache, { sincronizadoEm, movimentos: normalizadas });
    // A resposta é exclusivamente canônica. A cópia local só participa do
    // transporte de publicação e nunca da composição visual ou financeira.
    return { ativo: true, origem,
      inseridos_ou_atualizados: normalizadas.length, removidos: remover.length, sincronizado_em: sincronizadoEm, movimentos:normalizadas };
  })();
  reconciliacoesEmAndamento.set(chaveCache, execucao);
  try { return await execucao; }
  finally { reconciliacoesEmAndamento.delete(chaveCache); }
}

// A reconciliação recente existe apenas para desempenho. Depois de qualquer
// exclusão canônica ela não pode continuar abastecendo auditorias ou perfis.
function invalidarReconciliacaoMovimentosEmpresa(empresaId) {
  const prefixo=`${Number(empresaId)}:`;
  for (const chave of reconciliacoesRecentes.keys()) if (chave.startsWith(prefixo)) reconciliacoesRecentes.delete(chave);
}

// A trilha remota é a fonte de verdade para o delta. O marco só é avançado
// dentro da mesma transação SQLite que aplica todas as linhas do lote.
const CHAVE_SEQUENCIA_INCREMENTAL = 'operacao_compartilhada_sequencia';
const CHAVE_SEQUENCIA_INCREMENTAL_V2 = 'operacao_compartilhada_sequencia_v2';
const CHAVE_CONSUMIDOR_INCREMENTAL_V2 = 'operacao_compartilhada_consumidor_v2';
const SESSAO_CONSUMIDOR_INCREMENTAL_V2 = crypto.randomUUID();
const CHAVE_CONFIGURACAO_CERTIFICADA = 'configuracao_fiscal_certificada_v1';
const TABELAS_INCREMENTAIS_SEGURAS = new Set([
  'empresas', 'empresa_servicos_fiscais', 'parceiros', 'empresa_qsa', 'lotes',
  'movimentos', 'perfil_tributario', 'folhas_pagamento_competencias',
  'margens_operacionais_premissas', 'receitas_sem_dfe', 'regras_receitas_sem_dfe', 'catalogo_itens_receita', 'regras_itens_receita_regime', 'formacao_custo_itens',
  'formacao_custo_componentes', 'excecoes_motor', 'excecoes_motor_execucoes',
  'telemetria_autonomia_execucoes', 'enriquecimento_servicos_evidencias',
  'enriquecimento_pis_cofins_evidencias', 'pendencias_enriquecimento_fiscal',
  'perfil_cbs_competencias', 'pricing_products', 'pricing_services',
  'pricing_components', 'pricing_import_batches', 'pricing_itens', 'pricing_premissas_comerciais', 'pricing_creditos_globais', 'pricing_calculos', 'pricing_calculo_tratamentos', 'pricing_import_linhas', 'pricing_simulacoes', 'pricing_base_operacional', 'pricing_base_estrutura',
]);
const PRIORIDADE_INCREMENTAL = [
  'empresas', 'lotes', 'parceiros', 'empresa_qsa', 'empresa_servicos_fiscais',
  'perfil_tributario', 'folhas_pagamento_competencias', 'margens_operacionais_premissas',
  'catalogo_itens_receita', 'regras_itens_receita_regime', 'regras_receitas_sem_dfe', 'receitas_sem_dfe', 'movimentos', 'formacao_custo_itens', 'formacao_custo_componentes',
  'enriquecimento_servicos_evidencias', 'enriquecimento_pis_cofins_evidencias',
  'pendencias_enriquecimento_fiscal', 'excecoes_motor', 'excecoes_motor_execucoes',
  'telemetria_autonomia_execucoes', 'perfil_cbs_competencias', 'pricing_products',
    'pricing_services', 'pricing_components', 'pricing_import_batches', 'pricing_itens', 'pricing_premissas_comerciais', 'pricing_creditos_globais', 'pricing_calculos', 'pricing_calculo_tratamentos', 'pricing_import_linhas', 'pricing_simulacoes', 'pricing_base_operacional', 'pricing_base_estrutura',
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
function lerEstadoOperacional(chave) {
  return db.prepare('SELECT valor FROM sincronizacao_operacional_estado WHERE chave=?').get(chave)?.valor || null;
}
function salvarEstadoOperacional(chave, valor) {
  db.prepare(`INSERT INTO sincronizacao_operacional_estado(chave,valor,atualizado_em) VALUES (?,?,datetime('now','localtime'))
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, atualizado_em=excluded.atualizado_em`).run(chave, String(valor));
}
function consumidorIncrementalV2() {
  const configurado=String(process.env.SINCRONIZACAO_CONSUMIDOR_ID || '').trim();
  if (configurado) return configurado;
  const existente=lerEstadoOperacional(CHAVE_CONSUMIDOR_INCREMENTAL_V2);
  if (existente) return existente;
  // Persistido junto ao SQLite: reinício da mesma cópia mantém o consumidor;
  // uma instância nova ganha outra identidade e não disputa checkpoint alheio.
  const criado=`cache:${crypto.randomUUID()}`;
  salvarEstadoOperacional(CHAVE_CONSUMIDOR_INCREMENTAL_V2, criado);
  return criado;
}
function erroFilaV2Indisponivel(erro) {
  const texto=String(erro?.message || erro || '').toLowerCase();
  const funcaoFila=texto.includes('estado_fila_sincronizacao_operacional') || texto.includes('registrar_consumidor_sincronizacao_operacional');
  return texto.includes('pgrst202') || (funcaoFila && texto.includes('could not find the function'));
}
function linhaRpc(dados) { return Array.isArray(dados) ? dados[0] : dados; }
function erroRespostaRpc(nome, resposta) {
  const bruto=resposta?.error;
  const campos=bruto&&typeof bruto==='object' ? {
    code:bruto.code??null, message:bruto.message??null, details:bruto.details??null, hint:bruto.hint??null,
  } : { code:null, message:bruto==null?null:String(bruto), details:null, hint:null };
  const diagnostico={rpc:nome,status:resposta?.status??null,status_text:resposta?.statusText??null,error:campos};
  const erro=new Error(`${nome}: ${campos.message||`HTTP ${diagnostico.status??'desconhecido'}`}`);
  erro.rpc=diagnostico;
  return erro;
}
async function registrarConsumidorIncrementalV2(remoto, consumidor) {
  const resposta=await remoto.rpc('registrar_consumidor_sincronizacao_operacional', {
    p_consumidor_id:consumidor, p_sessao_id:SESSAO_CONSUMIDOR_INCREMENTAL_V2, p_lease_segundos:120,
  });
  if (resposta.error) throw erroRespostaRpc('registrar_consumidor_sincronizacao_operacional',resposta);
  return linhaRpc(resposta.data);
}
async function publicarEventosIncrementaisV2(remoto) {
  let publicados=0, ultimo=0;
  for (;;) {
    const resposta=await remoto.rpc('publicar_eventos_sincronizacao_operacional', { p_limite:1000 });
    if (resposta.error) throw erroRespostaRpc('publicar_eventos_sincronizacao_operacional',resposta);
    const lote=linhaRpc(resposta.data) || {};
    const quantidade=Number(lote.publicados || 0);
    publicados+=quantidade; ultimo=Number(lote.sequencia_final || ultimo);
    if (!quantidade) return { publicados, sequencia_final:ultimo };
  }
}
async function estadoFilaIncrementalV2(remoto) {
  const resposta=await remoto.rpc('estado_fila_sincronizacao_operacional');
  if (resposta.error) throw erroRespostaRpc('estado_fila_sincronizacao_operacional',resposta);
  const linha=linhaRpc(resposta.data) || {};
  return { corte_tecnico:Number(linha.corte_sequencia_tecnica || 0), sequencia_publicada:Number(linha.sequencia_publicada || 0) };
}
async function buscarEventosIncrementaisV2(remoto, sequencia) {
  const eventos=[]; const tamanho=1000;
  for (let de=0;; de+=tamanho) {
    const { data, error }=await remoto.from('sincronizacao_operacional_eventos')
      .select('sequencia,sequencia_consumo,tabela,operacao,chave,empresa_id,ocorrido_em')
      .gt('sequencia_consumo', sequencia).not('sequencia_consumo', 'is', null)
      .order('sequencia_consumo', { ascending:true }).range(de,de+tamanho-1);
    if (error) throw new Error(`Fila incremental v2: ${error.message}`);
    eventos.push(...(data || []).map((evento) => ({ ...evento, sequencia:Number(evento.sequencia_consumo) })));
    if (!data || data.length<tamanho) return eventos;
  }
}
async function confirmarCheckpointIncrementalV2(remoto, consumidor, sequencia, cargaBaseConcluida=false) {
  const resposta=await remoto.rpc('confirmar_checkpoint_sincronizacao_operacional', {
    p_consumidor_id:consumidor, p_sessao_id:SESSAO_CONSUMIDOR_INCREMENTAL_V2,
    p_sequencia:sequencia, p_carga_base_concluida:cargaBaseConcluida,
  });
  if (resposta.error) throw erroRespostaRpc('confirmar_checkpoint_sincronizacao_operacional',resposta);
  return linhaRpc(resposta.data);
}
function lerConfiguracaoCertificada() {
  const valor = db.prepare('SELECT valor FROM sincronizacao_operacional_estado WHERE chave=?').get(CHAVE_CONFIGURACAO_CERTIFICADA)?.valor;
  try { return valor ? JSON.parse(valor) : null; } catch (_) { return null; }
}
function salvarConfiguracaoCertificada(tabelas) {
  const anterior = lerConfiguracaoCertificada();
  const conjunto = new Set([...(anterior?.tabelas || []), ...tabelas]);
  const valor = JSON.stringify({ tabelas: [...conjunto].sort(), certificado_em: new Date().toISOString() });
  db.prepare(`INSERT INTO sincronizacao_operacional_estado(chave,valor,atualizado_em) VALUES (?,?,datetime('now','localtime'))
    ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor, atualizado_em=excluded.atualizado_em`).run(CHAVE_CONFIGURACAO_CERTIFICADA, valor);
  return JSON.parse(valor);
}
function configuracaoFiscalCertificada(tabelas = CONFIG_TABELAS) {
  const certificado = lerConfiguracaoCertificada();
  if (!certificado || !Array.isArray(certificado.tabelas)) return false;
  return tabelas.every((tabela) => certificado.tabelas.includes(tabela));
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

async function aplicarEventosIncrementais(remoto, eventos, opcoes = {}) {
  const todosReduzidos = reduzirEventosIncrementais(eventos);
  // DELETE é sempre seguro: se a empresa não estiver materializada é no-op;
  // se estiver, impede que um tombstone fique visível até a próxima hidratação.
  const ignoradosSegmentados=opcoes.segmentadoPorEmpresa
    ? todosReduzidos.filter((evento)=>TABELAS_CACHE_POR_EMPRESA.has(evento.tabela)
      && String(evento.operacao||'').toUpperCase()!=='DELETE') : [];
  const reduzidos=opcoes.segmentadoPorEmpresa
    ? todosReduzidos.filter((evento)=>!TABELAS_CACHE_POR_EMPRESA.has(evento.tabela)
      || String(evento.operacao||'').toUpperCase()==='DELETE') : todosReduzidos;
  if (!reduzidos.length) {
    const chaveCheckpoint=opcoes.chaveCheckpoint||CHAVE_SEQUENCIA_INCREMENTAL;
    salvarEstadoOperacional(chaveCheckpoint,Math.max(...todosReduzidos.map((evento)=>Number(evento.sequencia))));
    return { fallback:false,eventos:todosReduzidos.length,aplicadas:0,removidas:0,adiadas_por_empresa:ignoradosSegmentados.length };
  }
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
    const chaveCheckpoint=opcoes.chaveCheckpoint || CHAVE_SEQUENCIA_INCREMENTAL;
    salvarEstadoOperacional(chaveCheckpoint, Math.max(...reduzidos.map((evento) => Number(evento.sequencia))));
  })();
  return { fallback: false, eventos: todosReduzidos.length, aplicadas, removidas, adiadas_por_empresa:ignoradosSegmentados.length };
}

async function sincronizarIncrementalV2(remoto, opcoes = {}) {
  const consumidor=consumidorIncrementalV2();
  let remotoConsumidor;
  try { remotoConsumidor=await registrarConsumidorIncrementalV2(remoto, consumidor); }
  catch (erro) {
    if (erroFilaV2Indisponivel(erro)) return { disponivel:false };
    const contexto=erro?.message||String(erro);
    const falha=new Error(`Registro do consumidor v2: ${contexto}`); falha.rpc=erro?.rpc||null; throw falha;
  }
  await publicarEventosIncrementaisV2(remoto);
  const marcoInicial=await estadoFilaIncrementalV2(remoto);
  const checkpointRemoto=Number(remotoConsumidor?.sequencia_confirmada || 0);
  const requerCargaBase=Boolean(remotoConsumidor?.requer_carga_base) || !lerEstadoOperacional(CHAVE_SEQUENCIA_INCREMENTAL_V2);
  if (requerCargaBase) {
    // O checkpoint v1 não é promovido: sua ordem de commit não é comprovável.
    // A carga-base fornece uma fotografia canônica e a sobreposição posterior
    // é aplicada de forma idempotente pela fila publicada.
    const completo=await baixar(remoto,opcoes);
    validarCargaBase(completo, 'Carga-base da fila v2');
    await publicarEventosIncrementaisV2(remoto);
    const pendentes=await buscarEventosIncrementaisV2(remoto, marcoInicial.sequencia_publicada);
    const aplicado=pendentes.length
      ? await aplicarEventosIncrementais(remoto, pendentes, { ...opcoes,chaveCheckpoint:CHAVE_SEQUENCIA_INCREMENTAL_V2 })
      : { fallback:false, eventos:0, aplicadas:0, removidas:0 };
    let marcoAplicado=pendentes.length
      ? Math.max(...pendentes.map((evento) => Number(evento.sequencia)))
      : marcoInicial.sequencia_publicada;
    if (aplicado.fallback) {
      // O marco é fechado antes da nova fotografia. Assim, qualquer evento
      // publicado enquanto a carga estiver em andamento continuará pendente.
      await publicarEventosIncrementaisV2(remoto);
      marcoAplicado=(await estadoFilaIncrementalV2(remoto)).sequencia_publicada;
      const recuperacao=await baixar(remoto,opcoes);
      validarCargaBase(recuperacao, 'Recuperação da fila v2');
    }
    // Publica o que chegou durante a aplicação, mas não inclui essas novas
    // sequências no checkpoint: elas ainda não foram aplicadas ao SQLite e
    // serão consumidas no próximo ciclo.
    await publicarEventosIncrementaisV2(remoto);
    // O SQLite já foi confirmado acima; só agora a retenção poderá considerar
    // este consumidor coberto. Uma falha aqui só provoca repetição segura.
    await confirmarCheckpointIncrementalV2(remoto, consumidor, marcoAplicado, true);
    salvarEstadoOperacional(CHAVE_SEQUENCIA_INCREMENTAL_V2, marcoAplicado);
    return { disponivel:true, modo:'carga_base_v2', consumidor, sequencia:marcoAplicado, ...aplicado };
  }
  const eventos=await buscarEventosIncrementaisV2(remoto, checkpointRemoto);
  if (!eventos.length) {
    await confirmarCheckpointIncrementalV2(remoto, consumidor, checkpointRemoto, false);
    return { disponivel:true, modo:'incremental_v2', consumidor, eventos:0, aplicadas:0, removidas:0, sequencia:checkpointRemoto };
  }
  const aplicado=await aplicarEventosIncrementais(remoto, eventos, { ...opcoes,chaveCheckpoint:CHAVE_SEQUENCIA_INCREMENTAL_V2 });
  if (aplicado.fallback) {
    await publicarEventosIncrementaisV2(remoto);
    const marcoCobertoPeloFallback=(await estadoFilaIncrementalV2(remoto)).sequencia_publicada;
    const completo=await baixar(remoto,opcoes);
    validarCargaBase(completo, 'Fallback da fila v2');
    // Eventos que surgirem durante a fotografia ficam acima deste marco.
    await publicarEventosIncrementaisV2(remoto);
    await confirmarCheckpointIncrementalV2(remoto, consumidor, marcoCobertoPeloFallback, true);
    salvarEstadoOperacional(CHAVE_SEQUENCIA_INCREMENTAL_V2, marcoCobertoPeloFallback);
    return { disponivel:true, modo:'fallback_completo_v2', consumidor, sequencia:marcoCobertoPeloFallback, eventos:eventos.length, ...aplicado };
  }
  const fim=Math.max(...eventos.map((evento) => Number(evento.sequencia)));
  await confirmarCheckpointIncrementalV2(remoto, consumidor, fim, false);
  return { disponivel:true, modo:'incremental_v2', consumidor, sequencia:fim, ...aplicado };
}

async function sincronizarIncremental(opcoes = {}) {
  if (!ativo()) return { ativo: false };
  const remoto = opcoes.remoto || supabase.admin({ prazoMs: opcoes.prazoMs });
  if (!opcoes.forcarLegado) {
    const v2=await sincronizarIncrementalV2(remoto,opcoes);
    if (v2.disponivel) return v2;
  }
  const sequencia = lerSequenciaIncremental();
  // A primeira instalação cria uma base íntegra e somente depois habilita o
  // delta. Eventos ocorridos durante a carga são reaplicados idempotentemente.
  if (!temSequenciaIncremental()) {
    const inicio = await maiorSequenciaIncremental(remoto);
    const completo = await baixar(remoto,opcoes);
    validarCargaBase(completo, 'Carga-base incremental');
    const pendentes = await buscarEventosIncrementais(remoto, inicio);
    const aplicado = pendentes.length ? await aplicarEventosIncrementais(remoto, pendentes,opcoes) : { fallback: false, eventos: 0, aplicadas: 0, removidas: 0 };
    let marcoAplicado = pendentes.at(-1)?.sequencia || inicio;
    if (aplicado.fallback) {
      const marcoCobertoPeloFallback = await maiorSequenciaIncremental(remoto);
      const recuperacao = await baixar(remoto,opcoes);
      validarCargaBase(recuperacao, 'Recuperação incremental');
      marcoAplicado = marcoCobertoPeloFallback;
    }
    // O marco não pode avançar além de um evento efetivamente aplicado. Eventos
    // que chegarem após esta leitura serão buscados no próximo ciclo.
    db.transaction(() => salvarSequenciaIncremental(marcoAplicado))();
    return { modo: 'carga_base', sequencia: Number(marcoAplicado), ...aplicado };
  }
  const eventos = await buscarEventosIncrementais(remoto, sequencia);
  if (!eventos.length) return { modo: 'incremental', eventos: 0, aplicadas: 0, removidas: 0, sequencia };
  const aplicado = await aplicarEventosIncrementais(remoto, eventos,opcoes);
  if (!aplicado.fallback) return { modo: 'incremental', sequencia: lerSequenciaIncremental(), ...aplicado };
  // Fallback intencional: a tabela ainda não possui semântica incremental ou
  // o evento é sensível. Nada do lote foi aplicado antes desta decisão.
  const marcoCobertoPeloFallback = await maiorSequenciaIncremental(remoto);
  const completo = await baixar(remoto,opcoes);
  validarCargaBase(completo, 'Fallback incremental');
  db.transaction(() => salvarSequenciaIncremental(marcoCobertoPeloFallback))();
  return { modo: 'fallback_completo', sequencia: Number(marcoCobertoPeloFallback), eventos: eventos.length, ...aplicado };
}

// A fotografia do motor (resultados CBS e telemetria) é uma camada derivada.
// Se ela estiver temporariamente indisponível no Supabase, não se pode
// bloquear a operação fiscal primária — empresas, documentos e PGDAS — nem
// induzir o usuário a repetir uma consulta paga ao Serpro. A carga continua
// sendo rejeitada para qualquer falha da base-fonte; somente as três tabelas
// derivadas são degradáveis e ficam registradas como aviso técnico.
const TABELAS_FOTOGRAFIA_MOTOR = new Set([
  'motor', 'excecoes_motor_execucoes', 'telemetria_autonomia_execucoes',
]);
function validarCargaBase(resultado, contexto) {
  const falhas = Object.entries(resultado?.falhas || {});
  const criticas = falhas.filter(([tabela]) => !TABELAS_FOTOGRAFIA_MOTOR.has(tabela));
  const derivadas = falhas.filter(([tabela]) => TABELAS_FOTOGRAFIA_MOTOR.has(tabela));
  if (derivadas.length) {
    resultado.avisos = (resultado.avisos || []).concat(
      derivadas.map(([tabela, causa]) => `Fotografia do motor adiada (${tabela}): ${causa}`),
    );
    console.warn(`  ${contexto}: fotografia do motor indisponível; operação fiscal liberada.`);
  }
  if (criticas.length) {
    throw new Error(`${contexto} incompleta: ${criticas.map(([tabela, causa]) => `${tabela}: ${causa}`).join(' | ')}.`);
  }
}

// Fotografia técnica compartilhada: reiniciar uma instância não pode significar
// recalcular toda a carteira. O motor só roda novamente após importação,
// alteração de regra ou pedido explícito de recálculo.
function gravarLinhasComColunas(tabela, linhas, dentroDaTransacao = false) {
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name);
  if (!colunas.length || !linhas.length) return 0;
  const inserir = db.prepare(`INSERT OR REPLACE INTO ${tabela} (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})`);
  // PostgREST entrega JSON/JSONB já desserializado. O SQLite, porém, usa
  // TEXT para campos como `detalhe` e `resumo`; passar o objeto diretamente
  // faz o driver persistir "[object Object]", quebrando a próxima leitura da
  // fotografia com JSON.parse. A fronteira Supabase -> SQLite deve sempre
  // materializar esses valores como JSON textual.
  const serializarValor = (valor) => {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'object' && !Buffer.isBuffer(valor) && !(valor instanceof Date)) return JSON.stringify(valor);
    return valor;
  };
  const gravar = () => linhas.forEach((x) => inserir.run(...colunas.map((c) => serializarValor(x[c]))));
  if (dentroDaTransacao) gravar(); else db.transaction(gravar)();
  return linhas.length;
}

// A fotografia compartilhada carrega dois identificadores: o id físico da
// linha no Supabase (único globalmente) e o id que existia no SQLite do
// worker que calculou o resultado. Este último reinicia em 1 a cada worker e
// nunca pode ser usado como chave no cache de outra instância. Conservamos os
// dados de cálculo do payload, mas usamos as chaves canônicas da operação
// compartilhada ao restaurar o espelho local.
function execucaoCompartilhadaLocal(linha, empresaId = null) {
  const dados=(linha?.dados && typeof linha.dados==='object') ? linha.dados : {};
  const jsonTextoSeguro = (valor, padrao = '{}') => {
    if (valor === null || valor === undefined || valor === '') return padrao;
    if (typeof valor === 'object' && !Buffer.isBuffer(valor) && !(valor instanceof Date)) return JSON.stringify(valor);
    if (typeof valor !== 'string') return padrao;
    try { JSON.parse(valor); return valor; } catch (_) { return padrao; }
  };
  return {
    ...(linha || {}),
    ...dados,
    id: Number(linha?.id),
    resumo:jsonTextoSeguro(dados.resumo ?? linha?.resumo),
    ...(empresaId == null ? {} : { empresa_id:Number(empresaId) }),
  };
}

// A execução é pai de fotografias e de tabelas legadas do SQLite local.
// DELETE e INSERT OR REPLACE removem fisicamente o pai antes de recriá-lo,
// podendo violar uma FK já existente. A restauração web deve atualizar a
// execução ativa sem trocar a sua identidade.
function gravarExecucaoCompartilhadaSemReplace(linha, empresaId) {
  const dados = execucaoCompartilhadaLocal(linha, empresaId);
  const colunas = db.prepare('PRAGMA table_info(motor_execucoes)').all()
    .map((coluna) => coluna.name)
    .filter((coluna) => Object.hasOwn(dados, coluna));
  const atualizaveis = colunas.filter((coluna) => coluna !== 'id');
  const sql = `INSERT INTO motor_execucoes (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${atualizaveis.map((coluna) => `${coluna}=excluded.${coluna}`).join(',')}`;
  const serializarValor = (valor) => {
    if (valor === null || valor === undefined) return null;
    if (typeof valor === 'object' && !Buffer.isBuffer(valor) && !(valor instanceof Date)) return JSON.stringify(valor);
    return valor;
  };
  db.prepare(sql).run(...colunas.map((coluna) => serializarValor(dados[coluna])));
}

function resultadoCompartilhadoLocal(linha, empresaId = null, execucaoId = null) {
  const dados=(linha?.dados && typeof linha.dados==='object') ? linha.dados : {};
  const jsonTextoSeguro = (valor, padrao = '{}') => {
    if (valor === null || valor === undefined || valor === '') return padrao;
    if (typeof valor === 'object' && !Buffer.isBuffer(valor) && !(valor instanceof Date)) return JSON.stringify(valor);
    if (typeof valor !== 'string') return padrao;
    try { JSON.parse(valor); return valor; } catch (_) { return padrao; }
  };
  return {
    ...(linha || {}),
    ...dados,
    id: Number(linha?.id),
    detalhe:jsonTextoSeguro(dados.detalhe ?? linha?.detalhe),
    movimento_id:Number(linha?.movimento_id ?? dados.movimento_id),
    execucao_id:Number(execucaoId == null ? linha?.execucao_id : execucaoId),
    ...(empresaId == null ? {} : { empresa_id:Number(empresaId) }),
  };
}

// Estados remotos podem ser armazenados em colunas diretas ou no payload
// `dados`. O restante da aplicação recebe sempre a forma local canônica.
function estadoCompartilhadoLocal(linha, empresaId = null) {
  const dados=(linha?.dados && typeof linha.dados==='object') ? linha.dados : {};
  return {
    ...(linha || {}),
    ...dados,
    movimento_id:Number(linha?.movimento_id ?? dados.movimento_id),
    ...(empresaId == null ? {} : { empresa_id:Number(empresaId) }),
    assinatura_origem:linha?.assinatura_origem ?? dados.assinatura_origem ?? null,
    versao_origem:linha?.versao_origem ?? dados.versao_origem ?? null,
    assinatura_calculada:linha?.assinatura_calculada ?? dados.assinatura_calculada ?? null,
    versao_calculada:linha?.versao_calculada ?? dados.versao_calculada ?? null,
    situacao:linha?.situacao ?? dados.situacao ?? null,
    motivo:linha?.motivo ?? dados.motivo ?? null,
    job_id:linha?.job_id ?? dados.job_id ?? null,
    atualizado_em:linha?.atualizado_em ?? dados.atualizado_em ?? null,
  };
}

// Comparador sem efeitos colaterais. A validação de uma fotografia não se
// limita a contagens: cada movimento, resultado e estado precisa corresponder
// antes de uma tela poder assumir a cópia local como oficial.
function compararFotografiaMotor({ resultadosRemotos = [], resultadosLocais = [], estadosRemotos = [], estadosLocais = [] }) {
  const amostra=[]; let total=0; const registrar=(tipo,dados)=>{ total+=1; if(amostra.length<50) amostra.push({ tipo,...dados }); };
  const numeroIgual=(remoto,local)=>{
    if(remoto == null || remoto === '' || local == null || local === '') return String(remoto ?? '')===String(local ?? '');
    const a=Number(remoto), b=Number(local);
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a-b)<=1e-6;
  };
  const textoIgual=(remoto,local)=>String(remoto ?? '')===String(local ?? '');
  const chave=(x)=>String(Number(x?.movimento_id));
  const mapa=(linhas,tipo)=>{
    const saida=new Map();
    for(const linha of linhas){ const k=chave(linha); if(saida.has(k)) registrar(`${tipo}_DUPLICADO`,{movimento_id:Number(linha.movimento_id)}); else saida.set(k,linha); }
    return saida;
  };
  const remotos=mapa(resultadosRemotos,'RESULTADO_REMOTO'), locais=mapa(resultadosLocais,'RESULTADO_LOCAL');
  const camposResultadoNumericos=['preco_atual','base_economica','cbs','ibs','credito_cbs'];
  const camposResultadoTextuais=['status_classificacao','status_credito'];
  for(const [movimentoId,remoto] of remotos){
    const local=locais.get(movimentoId);
    if(!local){ registrar('RESULTADO_AUSENTE_LOCAL',{movimento_id:Number(remoto.movimento_id)}); continue; }
    for(const campo of camposResultadoNumericos) if(!numeroIgual(remoto[campo],local[campo])) registrar('RESULTADO_DIVERGENTE',{movimento_id:Number(remoto.movimento_id),campo,remoto:String(remoto[campo] ?? ''),local:String(local[campo] ?? '')});
    for(const campo of camposResultadoTextuais) if(!textoIgual(remoto[campo],local[campo])) registrar('RESULTADO_DIVERGENTE',{movimento_id:Number(remoto.movimento_id),campo,remoto:String(remoto[campo] ?? ''),local:String(local[campo] ?? '')});
  }
  for(const [movimentoId,local] of locais) if(!remotos.has(movimentoId)) registrar('RESULTADO_EXTRA_LOCAL',{movimento_id:Number(local.movimento_id)});
  const estadosR=mapa(estadosRemotos,'ESTADO_REMOTO'), estadosL=mapa(estadosLocais,'ESTADO_LOCAL');
  const camposEstadoTextuais=['situacao','assinatura_origem'];
  for(const [movimentoId,remoto] of estadosR){
    const local=estadosL.get(movimentoId);
    if(!local){ registrar('ESTADO_AUSENTE_LOCAL',{movimento_id:Number(remoto.movimento_id)}); continue; }
    for(const campo of camposEstadoTextuais) if(!textoIgual(remoto[campo],local[campo])) registrar('ESTADO_DIVERGENTE',{movimento_id:Number(remoto.movimento_id),campo,remoto:String(remoto[campo] ?? ''),local:String(local[campo] ?? '')});
    if(!numeroIgual(remoto.versao_origem,local.versao_origem)) registrar('ESTADO_DIVERGENTE',{movimento_id:Number(remoto.movimento_id),campo:'versao_origem',remoto:String(remoto.versao_origem ?? ''),local:String(local.versao_origem ?? '')});
  }
  for(const [movimentoId,local] of estadosL) if(!estadosR.has(movimentoId)) registrar('ESTADO_EXTRA_LOCAL',{movimento_id:Number(local.movimento_id)});
  return { ok:total===0, total, amostra };
}

function garantirColunasEstadoFotografia() {
  const colunas=new Set(db.prepare('PRAGMA table_info(projecoes_movimentos_estado)').all().map((x)=>x.name));
  const ausentes=['assinatura_origem','versao_origem'].filter((campo)=>!colunas.has(campo));
  if(ausentes.length) throw new Error(`Estado de projeção incompatível: faltam colunas ${ausentes.join(', ')}. Restauração cancelada.`);
}

function resultadosLocaisFotografia(empresaId,execucaoId) {
  const linhas=[]; let cursor=0;
  const ler=db.prepare(`SELECT id,movimento_id,preco_atual,base_economica,cbs,ibs,credito_cbs,status_classificacao,status_credito
    FROM motor_resultados WHERE empresa_id=? AND execucao_id=? AND id>? ORDER BY id LIMIT ?`);
  for(;;){ const lote=ler.all(Number(empresaId),Number(execucaoId),cursor,1000); if(!lote.length) break; linhas.push(...lote); cursor=Number(lote.at(-1).id); if(lote.length<1000) break; }
  return linhas;
}

function estadosLocaisFotografia(empresaId) {
  const linhas=[]; let cursor=0;
  const ler=db.prepare(`SELECT movimento_id,situacao,assinatura_origem,versao_origem
    FROM projecoes_movimentos_estado WHERE empresa_id=? AND movimento_id>? ORDER BY movimento_id LIMIT ?`);
  for(;;){ const lote=ler.all(Number(empresaId),cursor,1000); if(!lote.length) break; linhas.push(...lote); cursor=Number(lote.at(-1).movimento_id); if(lote.length<1000) break; }
  return linhas;
}
async function baixarResultadosMotor() {
  // O motor nunca é um canal de publicação de fatos fiscais.
  // A carga global apagava e recriava a carteira local. Ela é incompatível
  // com o cache por empresa e pode cruzar identidades de execuções distintas.
  // Restaurações somente podem ocorrer por empresa e por comando explícito.
  return { desativada:true, status:'DESATIVADA', motivo:'Carga global desativada no web; a fotografia é restaurada por empresa.' };
}

// A cadeia é uma leitura executiva: nunca pode trocar a fotografia canônica
// por uma parcela que tenha sobrevivido no disco efêmero do Render. Esta
// restauração é restrita à empresa aberta (não recarrega a carteira inteira)
// e é chamada depois de os movimentos canônicos já estarem no cache local.
// Apenas lê: a gravação local acontece depois, dentro da transação final.
async function buscarMovimentosDaFotografia(remoto,empresaRemota,empresaLocal,ids) {
  const linhas=[];
  for (let de=0;de<ids.length;de+=500) {
    const {data,error}=await remoto.from('movimentos').select('*')
      .eq('empresa_id',Number(empresaRemota.id)).in('id',ids.slice(de,de+500));
    if (error) throw new Error(`Movimentos da fotografia compartilhada: ${error.message}`);
    linhas.push(...(data || []));
  }
  const mapa=new Map([[String(empresaRemota.id),Number(empresaLocal)]]);
  return normalizarEmpresaIdDoCache('movimentos',linhas,mapa);
}

function movimentosLocaisExistentes(empresaId,ids) {
  const existentes=new Set();
  for (let de=0;de<ids.length;de+=500) {
    const lote=ids.slice(de,de+500);
    if (!lote.length) continue;
    const marcadores=lote.map(()=>'?').join(',');
    for (const linha of db.prepare(`SELECT id FROM movimentos WHERE empresa_id=? AND id IN (${marcadores})`).all(Number(empresaId),...lote)) {
      existentes.add(Number(linha.id));
    }
  }
  return existentes;
}

const esperarFotografia=(ms)=>new Promise((resolve)=>setTimeout(resolve,ms));

// A paginação por chave evita que o PostgREST reexecute offsets cada vez mais
// caros em fotografias grandes. Uma página só é incorporada depois de chegar
// completa; falhas transitórias não trocam a fotografia local por um recorte.
async function lerResultadosAtivosPorChave(remoto, empresaRemotaId, opcoes = {}) {
  const tamanhoPagina=Math.min(500,Math.max(1,Number(opcoes.tamanhoPagina) || 500));
  const tentativas=Math.min(3,Math.max(1,Number(opcoes.tentativas) || 3));
  const esperar=opcoes.esperar || esperarFotografia;
  const linhas=[]; let ultimoId=0;
  for (;;) {
    let pagina=null; let ultimoErro=null;
    for(let tentativa=1;tentativa<=tentativas;tentativa++) {
      const resposta=await remoto.from('motor_resultados_operacionais').select('*')
        .eq('empresa_id',Number(empresaRemotaId)).eq('ativo',true)
        .gt('id',ultimoId).order('id',{ascending:true}).limit(tamanhoPagina);
      if(!resposta.error) { pagina=resposta.data || []; break; }
      ultimoErro=resposta.error;
      if(tentativa<tentativas) await esperar(50);
    }
    if(!pagina) throw new Error(`Fotografia compartilhada da empresa: ${ultimoErro?.message || 'falha ao ler página após três tentativas'}`);
    if(!pagina.length) return linhas;
    const proximoId=Number(pagina.at(-1)?.id);
    if(!Number.isFinite(proximoId) || proximoId<=ultimoId) throw new Error('Fotografia compartilhada inválida: paginação por id não avançou.');
    linhas.push(...pagina);
    ultimoId=proximoId;
    if(pagina.length<tamanhoPagina) return linhas;
  }
}

async function restaurarFotografiaMotorEmpresa(empresaId, remotoInformado = null) {
  if (!ativo()) return { ativo:false, resultados:0, execucoes:0 };
  garantirColunasEstadoFotografia();
  const id=Number(empresaId);
  const empresa=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(id);
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para restaurar a fotografia do motor.');
  const remoto=remotoInformado || supabase.admin();
  const cnpj=String(empresa.cnpj).replace(/\D/g,'');
  const { data:candidatas, error:erroEmpresa }=await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${id},cnpj.eq.${cnpj}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const remota=(candidatas || []).find((x)=>Number(x.origem_local_id || x.id)===id || String(x.cnpj || '').replace(/\D/g,'')===cnpj);
  if (!remota) throw new Error('Empresa compartilhada não localizada para restaurar a fotografia.');
  // A Cadeia só pode consolidar uma fotografia integral. A contagem vem da
  // fonte canônica antes da paginação para que uma falha de rede/página não
  // pareça uma carteira vazia no cache efêmero do serviço web.
  const { count:quantidadeRemota, error:erroContagem }=await remoto.from('motor_resultados_operacionais').select('id',{ count:'exact', head:true })
    .eq('empresa_id',Number(remota.id)).eq('ativo',true);
  if (erroContagem || quantidadeRemota == null) throw new Error(`Fotografia canônica indisponível: não foi possível confirmar a quantidade ativa (${erroContagem?.message || 'contagem ausente'}).`);
  const resultados=await lerResultadosAtivosPorChave(remoto,Number(remota.id));
  if (resultados.length !== Number(quantidadeRemota)) {
    throw new Error(`Fotografia canônica parcial: esperado ${quantidadeRemota} resultado(s) ativo(s), restaurado(s) ${resultados.length}. A Cadeia não será consolidada.`);
  }
  // Os estados também são uma fotografia integral por empresa. A contagem
  // antecede qualquer escrita local: falha de rede jamais pode apagar um
  // estado válido e substituir a tela por uma versão parcial. Estados e
  // resultados referenciam movimentos, por isso os dois entram na união abaixo.
  const { count:quantidadeEstadosRemota, error:erroContagemEstados }=await remoto.from('projecoes_movimentos_estado').select('movimento_id',{ count:'exact', head:true })
    .eq('empresa_id',Number(remota.id));
  if (erroContagemEstados || quantidadeEstadosRemota == null) throw new Error(`Estados canônicos indisponíveis: não foi possível confirmar a quantidade (${erroContagemEstados?.message || 'contagem ausente'}).`);
  const estadosRemotos=[];
  for (let de=0;;de+=1000) {
    const {data,error}=await remoto.from('projecoes_movimentos_estado').select('*')
      .eq('empresa_id',Number(remota.id)).order('movimento_id',{ascending:true}).range(de,de+999);
    if (error) throw new Error(`Estado compartilhado da projeção: ${error.message}`);
    estadosRemotos.push(...(data || []));
    if (!data || data.length<1000) break;
  }
  if (estadosRemotos.length !== Number(quantidadeEstadosRemota)) {
    throw new Error(`Estados canônicos parciais: esperado ${quantidadeEstadosRemota}, restaurado(s) ${estadosRemotos.length}. A Cadeia não será consolidada.`);
  }
  const movimentoIds=[...new Set([
    ...resultados.map((x)=>Number(x.movimento_id)),
    ...estadosRemotos.map((x)=>Number(x.movimento_id)),
  ].filter(Number.isInteger))];
  // A execução é a indicada pelas linhas ativas, nunca a última execução da
  // empresa. Usar a mais recente misturava uma foto histórica com metadados
  // de outro cálculo e permitia que uma reexecução falha parecesse publicada.
  const execucaoIdsAtivos=[...new Set(resultados.map((x)=>Number(x.execucao_id)).filter(Number.isInteger))];
  if (!execucaoIdsAtivos.length) {
    throw new Error('Não há fotografia do motor para esta empresa. Nenhuma execução ativa foi encontrada na fonte compartilhada; importe a movimentação e execute o motor somente quando desejar gerar a análise.');
  }
  if (execucaoIdsAtivos.length > 1) throw new Error('Fotografia canônica inconsistente: resultados ativos pertencem a mais de uma execução. A cópia local foi preservada.');
  const {data:execucoes,error:erroExecucao}=await remoto.from('motor_execucoes_operacionais').select('*')
    .eq('empresa_id',Number(remota.id)).in('id',execucaoIdsAtivos).limit(2);
  if (erroExecucao) throw new Error(`Execução da fotografia compartilhada: ${erroExecucao.message}`);
  if (!execucoes?.length) throw new Error('Fotografia canônica sem execução compartilhada para a empresa.');
  const execucaoAtiva=execucoes[0];
  const execucaoAtivaLocal=execucaoCompartilhadaLocal(execucaoAtiva,id);
  const resultadosTraduzidos=resultados.map((linha)=>resultadoCompartilhadoLocal(linha,id,execucaoAtiva.id));
  const estadosTraduzidos=estadosRemotos.map((linha)=>estadoCompartilhadoLocal(linha,id));
  // A restauração da fotografia não pode alterar fatos fiscais. A carteira
  // precisa ter sido hidratada pelo fluxo operacional próprio antes da leitura
  // da Cadeia; se faltar movimento, preservamos o cache e falhamos de forma
  // explícita em vez de recriar gatilhos e pendências durante um GET.
  const locais=movimentosLocaisExistentes(id,movimentoIds);
  const ausentes=movimentoIds.filter((movimentoId)=>!locais.has(movimentoId));
  if (ausentes.length) throw new Error(`Fotografia canônica requer ${ausentes.length} movimento(s) ausente(s) no cache local. Atualize a carteira operacional; a abertura da Cadeia não altera movimentos.`);
  db.transaction(()=>{
    // `motor_execucoes.id` é hoje uma chave global no SQLite. Enquanto a
    // separação definitiva entre id local e id remoto não estiver migrada,
    // uma fotografia remota jamais pode assumir a execução de outra empresa.
    const donoLocal=db.prepare('SELECT empresa_id FROM motor_execucoes WHERE id=?').get(Number(execucaoAtiva.id));
    if(donoLocal && Number(donoLocal.empresa_id)!==id){
      throw new Error(`Colisão de id de execução: ${execucaoAtiva.id} já pertence à empresa local ${donoLocal.empresa_id}. Restauração cancelada sem alterações.`);
    }
    // Dependências da execução são cache derivado no disco efêmero. Algumas
    // bases SQLite antigas não possuem ON DELETE CASCADE; removê-las antes da
    // execução evita uma FK quebrada ao abrir a Cadeia.
    db.prepare('DELETE FROM cadeia_fotografias WHERE empresa_id=?').run(id);
    db.prepare('DELETE FROM telemetria_autonomia_execucoes WHERE empresa_id=?').run(id);
    db.prepare('DELETE FROM excecoes_motor_execucoes WHERE empresa_id=?').run(id);
    // Não remova a execução-pai: instalações anteriores podem ter referências
    // válidas a ela. Substituímos somente os resultados da foto ativa.
    db.prepare('DELETE FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').run(id, Number(execucaoAtiva.id));
    // A projeção é uma fotografia canônica por movimento. O cache efêmero
    // pode conter versões antigas sem unicidade; mantê-las multiplicaria a
    // Cadeia. Substituímos integralmente o escopo da empresa pela foto remota.
    db.prepare('DELETE FROM projecoes_movimentos_estado WHERE empresa_id=?').run(id);
    gravarExecucaoCompartilhadaSemReplace(execucaoAtiva, id);
    gravarLinhasComColunas('motor_resultados',resultadosTraduzidos.map((linha)=>({ ...linha,execucao_id:Number(execucaoAtiva.id) })),true);
    const gravarEstado=db.prepare(`INSERT INTO projecoes_movimentos_estado
      (empresa_id,movimento_id,assinatura_origem,versao_origem,assinatura_calculada,versao_calculada,situacao,motivo,job_id,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET assinatura_origem=excluded.assinatura_origem,
      versao_origem=excluded.versao_origem,assinatura_calculada=excluded.assinatura_calculada,
      versao_calculada=excluded.versao_calculada,situacao=excluded.situacao,motivo=excluded.motivo,
      job_id=excluded.job_id,atualizado_em=excluded.atualizado_em`);
    estadosTraduzidos.forEach((x)=>gravarEstado.run(id,x.movimento_id,x.assinatura_origem,x.versao_origem,
      x.assinatura_calculada,x.versao_calculada,x.situacao,x.motivo,x.job_id,x.atualizado_em));
    const gravados=Number(db.prepare('SELECT COUNT(*) quantidade FROM motor_resultados WHERE empresa_id=? AND execucao_id=?')
      .get(id,Number(execucaoAtiva.id))?.quantidade || 0);
    const estadosGravados=Number(db.prepare('SELECT COUNT(*) quantidade FROM projecoes_movimentos_estado WHERE empresa_id=?')
      .get(id)?.quantidade || 0);
    if(gravados!==resultados.length || estadosGravados!==estadosRemotos.length){
      throw new Error(`Fotografia canônica gravada parcialmente: resultados ${gravados}/${resultados.length}; estados ${estadosGravados}/${estadosRemotos.length}.`);
    }
    const comparacao=compararFotografiaMotor({ resultadosRemotos:resultadosTraduzidos,
      resultadosLocais:resultadosLocaisFotografia(id,Number(execucaoAtiva.id)),
      estadosRemotos:estadosTraduzidos,estadosLocais:estadosLocaisFotografia(id) });
    if(!comparacao.ok) throw new Error(`Fotografia canônica divergente após restauração: ${JSON.stringify(comparacao.amostra)}`);
    db.prepare(`INSERT INTO fotografia_oficial
      (empresa_id,execucao_id,empresa_remota_id,execucao_remota_id,quantidade_resultados,quantidade_estados,execucao_criada_em,sincronizado_em)
      VALUES (?,?,?,?,?,?,?,datetime('now'))
      ON CONFLICT(empresa_id) DO UPDATE SET execucao_id=excluded.execucao_id,
        empresa_remota_id=excluded.empresa_remota_id,execucao_remota_id=excluded.execucao_remota_id,
        quantidade_resultados=excluded.quantidade_resultados,quantidade_estados=excluded.quantidade_estados,
        execucao_criada_em=excluded.execucao_criada_em,sincronizado_em=excluded.sincronizado_em`)
      .run(id,Number(execucaoAtiva.id),Number(remota.id),Number(execucaoAtiva.id),resultados.length,estadosRemotos.length,execucaoAtivaLocal.criado_em || null);
  })();
  return { ativo:true, resultados:resultados.length, execucoes:1, empresa_remota_id:Number(remota.id), execucao_remota_id:Number(execucaoAtiva.id) };
}

// Valida uma fotografia já presente no SQLite contra a fonte compartilhada e
// publica somente o ponteiro local. Não baixa movimentos, não recalcula e não
// substitui resultado algum. É o caminho seguro para a Relotec já restaurada.
async function validarFotografiaLocalEmpresa(empresaId, remotoInformado = null) {
  if (!ativo()) throw new Error('Fonte compartilhada não configurada.');
  garantirColunasEstadoFotografia();
  const id=Number(empresaId);
  const empresa=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(id);
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para validar a fotografia local.');
  const remoto=remotoInformado || supabase.admin();
  const cnpj=String(empresa.cnpj).replace(/\D/g,'');
  const {data:candidatas,error:erroEmpresa}=await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${id},cnpj.eq.${cnpj}`).limit(3);
  if(erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const remota=(candidatas || []).find((x)=>Number(x.origem_local_id || x.id)===id || String(x.cnpj || '').replace(/\D/g,'')===cnpj);
  if(!remota) throw new Error('Empresa compartilhada não localizada para validar a fotografia.');
  const {count:quantidadeResultados,error:erroResultados}=await remoto.from('motor_resultados_operacionais').select('id',{count:'exact',head:true})
    .eq('empresa_id',Number(remota.id)).eq('ativo',true);
  if(erroResultados || quantidadeResultados==null) throw new Error(`Fotografia canônica indisponível: ${erroResultados?.message || 'contagem ausente'}.`);
  const linhasResultadosRemotas=await lerResultadosAtivosPorChave(remoto,Number(remota.id));
  const execucaoIds=new Set(linhasResultadosRemotas.map((x)=>Number(x.execucao_id)).filter(Number.isInteger));
  if(linhasResultadosRemotas.length!==Number(quantidadeResultados)) throw new Error(`Fotografia canônica parcial: resultados ${linhasResultadosRemotas.length}/${quantidadeResultados}.`);
  if(execucaoIds.size!==1) throw new Error(`Fotografia canônica inconsistente: ${execucaoIds.size} execuções ativas encontradas.`);
  const execucaoRemotaId=[...execucaoIds][0];
  const resultadosRemotos=linhasResultadosRemotas.map((linha)=>resultadoCompartilhadoLocal(linha,id,execucaoRemotaId));
  const {data:execucoes,error:erroExecucao}=await remoto.from('motor_execucoes_operacionais').select('*')
    .eq('empresa_id',Number(remota.id)).eq('id',execucaoRemotaId).limit(2);
  if(erroExecucao || execucoes?.length!==1) throw new Error(`Execução canônica indisponível: ${erroExecucao?.message || 'execução não localizada'}.`);
  const {count:quantidadeEstados,error:erroEstados}=await remoto.from('projecoes_movimentos_estado').select('movimento_id',{count:'exact',head:true})
    .eq('empresa_id',Number(remota.id));
  if(erroEstados || quantidadeEstados==null) throw new Error(`Estados canônicos indisponíveis: ${erroEstados?.message || 'contagem ausente'}.`);
  const estadosRemotos=[];
  for(let de=0;;de+=1000){
    const {data,error}=await remoto.from('projecoes_movimentos_estado').select('*').eq('empresa_id',Number(remota.id)).order('movimento_id',{ascending:true}).range(de,de+999);
    if(error) throw new Error(`Estados da fotografia compartilhada: ${error.message}`);
    estadosRemotos.push(...(data || []).map((linha)=>estadoCompartilhadoLocal(linha,id))); if(!data || data.length<1000) break;
  }
  if(estadosRemotos.length!==Number(quantidadeEstados)) throw new Error(`Estados canônicos parciais: ${estadosRemotos.length}/${quantidadeEstados}.`);
  const execucaoLocal=db.prepare('SELECT id FROM motor_execucoes WHERE id=? AND empresa_id=?').get(execucaoRemotaId,id);
  if(!execucaoLocal) throw new Error(`Execução remota ${execucaoRemotaId} não existe como execução local da empresa ${id}. Use a restauração explícita após a Etapa 2 de identidades.`);
  const resultadosLocais=resultadosLocaisFotografia(id,execucaoRemotaId);
  const estadosLocais=estadosLocaisFotografia(id);
  const comparacao=compararFotografiaMotor({ resultadosRemotos,resultadosLocais,estadosRemotos,estadosLocais });
  if(!comparacao.ok) throw new Error(`Fotografia local divergente: ${JSON.stringify(comparacao.amostra)}`);
  db.transaction(()=>db.prepare(`INSERT INTO fotografia_oficial
    (empresa_id,execucao_id,empresa_remota_id,execucao_remota_id,quantidade_resultados,quantidade_estados,execucao_criada_em,sincronizado_em)
    VALUES (?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(empresa_id) DO UPDATE SET execucao_id=excluded.execucao_id,
      empresa_remota_id=excluded.empresa_remota_id,execucao_remota_id=excluded.execucao_remota_id,
      quantidade_resultados=excluded.quantidade_resultados,quantidade_estados=excluded.quantidade_estados,
      execucao_criada_em=excluded.execucao_criada_em,sincronizado_em=excluded.sincronizado_em`)
    .run(id,execucaoRemotaId,Number(remota.id),execucaoRemotaId,resultadosLocais.length,estadosLocais.length,execucaoCompartilhadaLocal(execucoes[0],id).criado_em || null))();
  return {empresa_id:id,empresa_remota_id:Number(remota.id),execucao_id:execucaoRemotaId,resultados:resultadosLocais.length,estados:estadosLocais.length,status:'VALIDADA'};
}

// Persiste somente o estado de validade da projeção. Não publica fatos nem
// resultados financeiros: a fonte canônica continua em parceiros/movimentos.
async function publicarEstadosProjecoes(empresaId, movimentoIds = []) {
  if (!ativo()) return { ativo:false, estados:0 };
  const ids=[...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return { ativo:true, estados:0 };
  // Estado de projeção pertence à fonte compartilhada. O SQLite do worker é
  // descartável e não pode ser requisito para localizar a empresa ao fim de
  // um job; `origem_local_id` é a identidade canônica desta ponte.
  const empresa=db.prepare('SELECT cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  const remoto=supabase.admin(); const cnpj=String(empresa?.cnpj || '').replace(/\D/g,'');
  let consultaEmpresa=remoto.from('empresas').select('id,cnpj,origem_local_id').eq('origem_local_id',Number(empresaId));
  if (cnpj) consultaEmpresa=remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`);
  const { data:empresas,error:erroEmpresa }=await consultaEmpresa.limit(3);
  if (erroEmpresa) throw new Error(`Empresa compartilhada para projeção: ${erroEmpresa.message}`);
  const empresaRemota=(empresas || []).find((x)=>Number(x.origem_local_id || x.id)===Number(empresaId) || (cnpj && String(x.cnpj || '').replace(/\D/g,'')===cnpj));
  if (!empresaRemota) throw new Error('Empresa compartilhada não localizada para publicar estado de projeção.');
  const marcadores=ids.map(()=>'?').join(',');
  const estados=db.prepare(`SELECT empresa_id,movimento_id,assinatura_origem,versao_origem,assinatura_calculada,versao_calculada,situacao,motivo,job_id,atualizado_em
    FROM projecoes_movimentos_estado WHERE empresa_id=? AND movimento_id IN (${marcadores})`).all(Number(empresaId),...ids)
    .map((x)=>({ ...x,empresa_id:Number(empresaRemota.id) }));
  if (!estados.length) return { ativo:true, estados:0 };
  const { error }=await remoto.from('projecoes_movimentos_estado').upsert(estados,{ onConflict:'empresa_id,movimento_id' });
  if (error) throw new Error(`Estado compartilhado da projeção: ${error.message}`);
  return { ativo:true, estados:estados.length,empresa_remota_id:Number(empresaRemota.id) };
}
async function publicarResultadosMotor(empresaId = null, opcoes = {}) {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin();
  const execucaoId = Number(opcoes.execucao_id);
  const publicacaoPorExecucao = Number.isInteger(execucaoId) && execucaoId > 0;
  const movimentoIds=[...new Set((opcoes.movimento_ids || []).map(Number).filter(Number.isInteger))];
  // Uma fotografia só pode ser transportada como lote fechado de uma
  // execução identificada. Publicar "a empresa inteira" misturava linhas
  // antigas com a execução nova e, pior, desativava a fotografia vigente
  // antes de haver substituta validada.
  if (!publicacaoPorExecucao) {
    throw new Error('Publicação da fotografia rejeitada: informe a execução completa e a quantidade esperada.');
  }
  const empresasRemotas = await buscarTudo(remoto, 'empresas');
  const empresaRemotaPorOrigem = new Map((empresasRemotas || []).map((empresa) => [
    Number(empresa.origem_local_id || empresa.id), Number(empresa.id),
  ]).filter(([origem, remotoId]) => origem > 0 && remotoId > 0));
  const empresaRemota = (id) => empresaRemotaPorOrigem.get(Number(id)) || Number(id);
  // O worker publica a fotografia que acabou de calcular, nunca o histórico
  // inteiro da empresa. Além de reduzir memória e tempo de rede, isto mantém
  // a chave usada na promoção exatamente igual ao lote que foi gravado.
  const clausulas = []; const parametros = [];
  if (empresaId != null) { clausulas.push('empresa_id=?'); parametros.push(empresaId); }
  if (publicacaoPorExecucao) { clausulas.push('id=?'); parametros.push(execucaoId); }
  const filtroExecucoes = clausulas.length ? ` WHERE ${clausulas.join(' AND ')}` : '';
  const execucoes = db.prepare(`SELECT * FROM motor_execucoes${filtroExecucoes}`).all(...parametros);
  if (publicacaoPorExecucao && execucoes.length !== 1) {
    throw new Error(`Fotografia do motor não localizada para empresa ${empresaId} e execução ${execucaoId}.`);
  }
  const clausulasResultados = []; const parametrosResultados = [];
  if (empresaId != null) { clausulasResultados.push('empresa_id=?'); parametrosResultados.push(empresaId); }
  if (publicacaoPorExecucao) { clausulasResultados.push('execucao_id=?'); parametrosResultados.push(execucaoId); }
  // A execução incremental contém somente o delta. Nunca materialize a
  // execução inteira para publicar um lote já autorizado pelo worker.
  if (movimentoIds.length) {
    clausulasResultados.push(`movimento_id IN (${movimentoIds.map(() => '?').join(',')})`);
    parametrosResultados.push(...movimentoIds);
  }
  const filtroResultados = clausulasResultados.length ? ` WHERE ${clausulasResultados.join(' AND ')}` : '';
  const resultadosLocais = db.prepare(`SELECT * FROM motor_resultados${filtroResultados}`).all(...parametrosResultados);
  if (publicacaoPorExecucao && resultadosLocais.length !== Number(opcoes.quantidade_esperada)) {
    throw new Error(`Fotografia local incompleta para execução ${execucaoId}: esperado ${opcoes.quantidade_esperada}, encontrado ${resultadosLocais.length}.`);
  }
  // A execução e cada resultado recebem ID do PostgreSQL. Nunca reutilizamos
  // IDs do SQLite, que são locais a uma instância e podiam colidir no remoto.
  const execucaoLocal=execucoes[0];
  const { data:execucaoRemota, error:erroExecucaoRemota }=await remoto.from('motor_execucoes_operacionais')
    .insert({ empresa_id:empresaRemota(execucaoLocal.empresa_id), dados:{ ...execucaoLocal, integridade:opcoes.integridade || null } }).select('id').single();
  if (erroExecucaoRemota) throw new Error(`Execução remota do motor: ${erroExecucaoRemota.message}`);
  const execucaoRemotaId=Number(execucaoRemota.id);
  const resultados = resultadosLocais
    .map((x) => ({ empresa_id: empresaRemota(x.empresa_id), movimento_id: x.movimento_id, dados: { ...x, execucao_id:execucaoRemotaId, execucao_local_id:x.execucao_id },
      // A nova foto sempre chega inativa. Só a RPC de promoção, depois de
      // conferir a quantidade completa, troca a fotografia visível.
      ativo: false, execucao_id: execucaoRemotaId,
      tipo_credito: x.tipo_credito, modalidade_credito: x.modalidade_credito,
      status_credito_determinacao: x.status_credito_determinacao,
      regime_cbs_emitente: x.regime_cbs_emitente, regime_cbs_adquirente: x.regime_cbs_adquirente,
      movimento_hash: x.movimento_hash, regra_version: x.regra_version,
      catalogo_version: x.catalogo_version, parceiro_version: x.parceiro_version,
      parametro_version: x.parametro_version, motor_version: x.motor_version,
      assinatura_origem: x.assinatura_origem, versao_origem: x.versao_origem,
      estado_autonomia: x.estado_autonomia, codigo_causa: x.codigo_causa,
      origem_resolucao: x.origem_resolucao, requer_intervencao_humana: x.requer_intervencao_humana }));
  // 100 linhas evita que uma foto grande gere uma requisição PostgREST lenta
  // ou ultrapasse a memória do worker. É transporte de resultado derivado;
  // nenhuma linha-fonte fiscal é alterada aqui.
  const tamanhoLote = Math.max(25, Math.min(250, Number(process.env.PUBLICACAO_MOTOR_LOTE) || 100));
  for (let i = 0; i < resultados.length; i += tamanhoLote) {
      const { error } = await remoto.from('motor_resultados_operacionais').insert(resultados.slice(i, i + tamanhoLote));
      if (error) throw new Error(`Resultados remotos do motor: ${error.message}`);
  }
  const filtroTelemetrias = publicacaoPorExecucao ? ' WHERE empresa_id=? AND execucao_id=?' : (empresaId == null ? '' : ' WHERE empresa_id=?');
  const parametrosTelemetrias = publicacaoPorExecucao ? [empresaId, execucaoId] : (empresaId == null ? [] : [empresaId]);
  const telemetrias = db.prepare(`SELECT * FROM telemetria_autonomia_execucoes${filtroTelemetrias}`).all(...parametrosTelemetrias);
  const excecoesExecucao = db.prepare(`SELECT * FROM excecoes_motor_execucoes${filtroTelemetrias}`).all(...parametrosTelemetrias);
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
  return { execucoes: 1, resultados: resultados.length, telemetrias: telemetrias.length, excecoes_execucao: excecoesExecucao.length, avisos, execucao_id: execucaoRemotaId,
    // A fotografia é gravada com a identidade remota da empresa. Quem a
    // promove precisa usar essa mesma identidade; o id SQLite pode diferir.
    empresa_remota_id: empresaId == null ? null : empresaRemota(empresaId) };
}
async function promoverFotografiaMotor(empresaId, execucaoId, quantidadeEsperada) {
  if (!ativo()) return { ativo: false };
  const { error } = await supabase.admin().rpc('promover_fotografia_motor', {
    p_empresa_id: Number(empresaId), p_execucao_id: Number(execucaoId), p_quantidade_esperada: Number(quantidadeEsperada),
  });
  if (error) throw new Error(`Promoção atômica da fotografia: ${error.message}`);
  return { promovida: true, empresa_id: Number(empresaId), execucao_id: Number(execucaoId), quantidade: Number(quantidadeEsperada) };
}
// A execução incremental contém somente as linhas autorizadas. A RPC cria a
// próxima fotografia completa no banco: copia a foto ativa, troca o recorte e
// só então faz a comutação. Assim a tela nunca lê um mosaico de execuções e um
// erro mantém a fotografia anterior intacta.
async function promoverFotografiaMotorIncremental(empresaId, execucaoId, quantidadeSubstituta, movimentoIds) {
  if (!ativo()) return { ativo: false };
  const ids=[...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error('Promoção incremental sem movimentos explicitamente autorizados.');
  const { data, error } = await supabase.admin().rpc('promover_fotografia_motor_incremental', {
    p_empresa_id:Number(empresaId),p_execucao_id:Number(execucaoId),p_quantidade_substituta:Number(quantidadeSubstituta),p_movimento_ids:ids,
  });
  if (error) throw new Error(`Promoção incremental atômica da fotografia: ${error.message}`);
  const quantidade = Number(data);
  if (!Number.isInteger(quantidade) || quantidade <= 0) throw new Error('Promoção incremental não retornou uma fotografia completa válida.');
  return { promovida: true, empresa_id: Number(empresaId), execucao_id: Number(execucaoId), quantidade };
}
async function validarFotografiaAtivaMotor(empresaId, execucaoId, quantidadeEsperada) {
  if (!ativo()) return { ativo: false };
  // Contagem no servidor via API, sem transferir a fotografia (inclusive para
  // empresas com 100 mil itens) e sem depender da conexão PostgreSQL direta.
  const { count, error } = await supabase.admin().from('motor_resultados_operacionais')
    .select('id', { count: 'exact', head: true }).eq('empresa_id', Number(empresaId)).eq('execucao_id', Number(execucaoId)).eq('ativo', true);
  if (error || Number(count) !== Number(quantidadeEsperada)) throw new Error(`Validação da fotografia ativa: ${error?.message || `esperado ${quantidadeEsperada}, encontrado ${count || 0}`}`);
  return { confirmada: true, execucao_id: Number(execucaoId), quantidade: Number(count) };
}
async function integridadeFotografiaAtivaMotor(empresaId) {
  if (!ativo()) return null;
  const remoto=supabase.admin();
  // Esta função pode ser chamada antes da publicação, portanto não pode usar
  // o resolvedor local de `publicarResultadosMotor`. Resolva a empresa na
  // própria fonte compartilhada para que a guarda de determinismo nunca
  // interrompa o job por causa de escopo de variável.
  const idLocal=Number(empresaId);
  const { data:empresas, error:erroEmpresa }=await remoto.from('empresas').select('id,origem_local_id')
    .or(`origem_local_id.eq.${idLocal},id.eq.${idLocal}`).limit(3);
  if (erroEmpresa) throw new Error(`Integridade da fotografia ativa: ${erroEmpresa.message}`);
  const empresaRemota=(empresas || []).find((empresa) => Number(empresa.origem_local_id || empresa.id) === idLocal);
  if (!empresaRemota) throw new Error(`Integridade da fotografia ativa: empresa compartilhada ${idLocal} não encontrada.`);
  const empresaIdRemota=Number(empresaRemota.id);
  const { data:linhas, error:erroLinhas }=await remoto.from('motor_resultados_operacionais')
    .select('execucao_id').eq('empresa_id',empresaIdRemota).eq('ativo',true).limit(2);
  if (erroLinhas) throw new Error(`Integridade da fotografia ativa: ${erroLinhas.message}`);
  const execucoes=[...new Set((linhas || []).map((x)=>Number(x.execucao_id)).filter(Number.isInteger))];
  if (!execucoes.length) return null;
  if (execucoes.length !== 1) throw new Error('Integridade da fotografia ativa: há mais de uma execução ativa para a empresa.');
  const { data:execucao, error:erroExecucao }=await remoto.from('motor_execucoes_operacionais')
    .select('id,dados').eq('empresa_id',empresaIdRemota).eq('id',execucoes[0]).limit(1);
  if (erroExecucao) throw new Error(`Integridade da execução ativa: ${erroExecucao.message}`);
  return execucao?.[0]?.dados?.integridade || null;
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
  // A tabela também abriga fotografias de configurações que não participam
  // deste cálculo. Trazer tudo fazia o worker incremental materializar dados
  // de outros módulos antes mesmo de chegar aos poucos documentos solicitados.
  const { data: configuracoes, error } = await remoto.from('parametros_operacionais').select('chave,dados')
    .eq('tabela', 'configuracao').in('chave', tabelas);
  if (error && !String(error.message).includes('does not exist')) throw error;
  const porChave = new Map((configuracoes || []).map((x) => [x.chave, x.dados]));
  const resultado = {};
  const aplicadas = [];
  for (const tabela of tabelas) {
    const dados = porChave.get(tabela);
    if (Array.isArray(dados)) { gravarConfiguracao(tabela, dados); resultado[`config_${tabela}`] = dados.length; aplicadas.push(tabela); }
  }
  // O certificado só é emitido após cada fotografia solicitada chegar por
  // completo da fonte compartilhada. Ele permite reinício rápido sem aceitar
  // SQLite não confirmado como parâmetro fiscal vigente.
  if (aplicadas.length === tabelas.length) resultado.configuracao_certificada = salvarConfiguracaoCertificada(aplicadas).certificado_em;
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
  const [empresas, projetos, entregas, acompanhamentos, responsaveis, tarefas, checklist, marcosSla, tarefasSla] = await Promise.all([
    buscarTudo(remoto, 'empresas'), buscarTudo(remoto, 'projetos'), buscarTudo(remoto, 'projeto_entregas'),
    buscarTudo(remoto, 'projeto_acompanhamentos'), buscarTudo(remoto, 'projeto_responsaveis'),
    buscarTudo(remoto, 'projeto_tarefas'), buscarTudo(remoto, 'projeto_checklist_implantacao'), buscarTudo(remoto, 'sla_marcos'), buscarTudo(remoto, 'sla_tarefas'),
  ]);
  return gravarGestao(projetos, entregas, acompanhamentos, responsaveis, tarefas, checklist, empresas, marcosSla, tarefasSla);
}
async function publicar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  // O SQLite conserva o ID de origem da empresa; no Supabase a empresa pode
  // ter recebido outro ID técnico ao ser criada. Nunca publicar documentos
  // usando o ID local diretamente, pois isso cria vínculos órfãos e faz dados
  // fiscais "sumirem" da empresa selecionada após uma sincronização.
  const empresasRemotas = await buscarTudo(remoto, 'empresas');
  const empresaRemotaPorOrigem = new Map((empresasRemotas || []).map((empresa) => [
    Number(empresa.origem_local_id || empresa.id), Number(empresa.id),
  ]).filter(([origem, remotoId]) => origem > 0 && remotoId > 0));
  const paraEmpresaRemota = (tabela, linha) => {
    if (!CAMPOS[tabela]?.includes('empresa_id')) return linha;
    const empresaRemota = empresaRemotaPorOrigem.get(Number(linha.empresa_id));
    return empresaRemota ? { ...linha, empresa_id: empresaRemota } : linha;
  };
  for (const [tabela, campos] of Object.entries(CAMPOS)) {
    // Empresa e QSA têm identidade composta/remota e confirmação humana.
    // Publicá-los pelo espelho genérico do SQLite (por id local) causava uma
    // corrida com a sincronização explícita e podia reaplicar uma fotografia
    // antiga após o usuário salvar. Ambos são publicados somente pelos fluxos
    // específicos, com origem_local_id/chave societária estável.
    if (['empresas', 'empresa_qsa', 'regras_enquadramento', 'documentos_fiscais_cancelamentos'].includes(tabela)) continue;
    if (TABELAS_PRECIFICACAO.includes(tabela) || TABELAS_CONTRATOS.includes(tabela)) continue;
    const linhas = db.prepare(`SELECT ${campos.join(',')} FROM ${tabela}`).all().map((linha) => paraEmpresaRemota(tabela, linha));
    const conflito = chaveConflitoPublicacao(tabela);
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await remoto.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: conflito });
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
    const empresaRemota = empresaRemotaPorOrigem.get(Number(empresaId)) || empresaId;
    for (const tabela of ['pricing_components','pricing_import_batches','pricing_products','pricing_services']) {
      const { error } = await remoto.from(tabela).delete().eq('empresa_id', empresaRemota);
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
    for (const tabela of ['pricing_products','pricing_services','pricing_components','pricing_import_batches']) {
      const campos = CAMPOS[tabela];
      const linhas = db.prepare(`SELECT ${campos.join(',')} FROM ${tabela} WHERE empresa_id=?`).all(empresaId).map((linha) => paraEmpresaRemota(tabela, linha));
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
  for (const empresa of empresas) await publicarContratos(remoto, empresa.id, empresaRemotaPorOrigem.get(Number(empresa.id)) || empresa.id);
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
async function publicarContratos(remoto, empresaId, empresaRemotaId = empresaId) {
  const contratos = db.prepare(`SELECT ${CAMPOS.contratos.join(',')} FROM contratos WHERE empresa_id=?`).all(empresaId);
  // A exclusão fica restrita à empresa da fotografia e o FK em cascata remove
  // apenas as dependências daqueles contratos, nunca dados de outras empresas.
  const { error: apagar } = await remoto.from('contratos').delete().eq('empresa_id', empresaRemotaId);
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
    // Apenas as tabelas que carregam empresa_id precisam da troca de chave;
    // contratos filhos continuam apontando para o mesmo contrato técnico.
    if (CAMPOS[tabela].includes('empresa_id')) linhas = linhas.map((linha) => ({ ...linha, empresa_id: empresaRemotaId }));
    for (let i = 0; i < linhas.length; i += 250) {
      const { error } = await remoto.from(tabela).insert(linhas.slice(i, i + 250).map((x) => linhaRemotaContrato(tabela, x)));
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
  }
  return { contratos: contratos.length };
}

// Importações fiscais precisam chegar à fonte canônica antes de qualquer
// leitura que reconcilie a empresa. Publicar toda a base após cada SPED era
// lento e podia levar configurações não relacionadas junto; este caminho é
// restrito aos fatos operacionais da empresa importada e preserva os IDs que
// dão rastreabilidade ao lote, movimento e evidência C175.
function identidadeMovimentoFiscal(linha) {
  if (String(linha?.origem || '').toLowerCase() === 'planilha_saida_manual' && linha?.chave) {
    return `planilha_saida_manual:${linha.chave}:${linha.item_numero == null ? '__SEM_ITEM__' : String(linha.item_numero)}`;
  }
  if (String(linha?.origem || '').toLowerCase() === 'xml' && String(linha?.modelo_documento_fiscal || '').toLowerCase() === 'nfse') {
    // A mesma NFS-e pode ser exportada pelo município com o código de
    // verificação curto e pelo padrão nacional com chave longa. A chave muda,
    // mas prestador, tomador, data, número da nota e item permanecem iguais.
    const numero = String(linha.documento || '').split('/').pop().replace(/\D/g, '');
    const emissao = String(linha.data_emissao || '').slice(0, 10);
    const emitente = String(linha.emitente_cnpj || '').replace(/\D/g, '');
    const destinatario = String(linha.destinatario_cnpj || '').replace(/\D/g, '');
    if (numero && emissao && emitente && destinatario) {
      return `xml:nfse:${emitente}:${destinatario}:${emissao}:${numero}:${linha.item_numero == null ? '__SEM_ITEM__' : String(linha.item_numero)}`;
    }
  }
  if (String(linha?.origem || '').toLowerCase() === 'xml' && linha?.chave) {
    return `xml:${linha.chave}:${linha.item_numero == null ? '__SEM_ITEM__' : String(linha.item_numero)}`;
  }
  return `id:${linha?.id}`;
}

function qualidadeMovimentoFiscal(linha) {
  return (linha?.modelo_documento_fiscal ? 16 : 0)
    + (linha?.descricao ? 8 : 0)
    + (linha?.ncm || linha?.nbs || linha?.lc116 ? 4 : 0)
    + (linha?.valor != null ? 2 : 0)
    + (linha?.data_emissao ? 1 : 0);
}

function deduplicarMovimentosFiscais(linhas) {
  const porIdentidade = new Map();
  for (const linha of linhas) {
    const identidade = identidadeMovimentoFiscal(linha);
    const anterior = porIdentidade.get(identidade);
    // Entre cópias técnicas do mesmo item, a mais completa prevalece. Em
    // empate, o maior id é determinístico. A consolidação existe apenas nas
    // leituras e no envio: nenhum documento é apagado por esta função.
    if (!anterior || qualidadeMovimentoFiscal(linha) > qualidadeMovimentoFiscal(anterior)
      || (qualidadeMovimentoFiscal(linha) === qualidadeMovimentoFiscal(anterior) && Number(linha.id) >= Number(anterior.id))) {
      porIdentidade.set(identidade, linha);
    }
  }
  return [...porIdentidade.values()];
}

function deduplicarXmlParaPublicacao(linhas) {
  return deduplicarMovimentosFiscais(linhas);
}

function chaveParceiroCanonico(linha = {}) {
  const cnpj=String(linha.cnpj || '').replace(/\D/g,'');
  if (cnpj) return `CNPJ|${String(linha.tipo || '').toLowerCase()}|${cnpj}`;
  return `GENERICO|${String(linha.tipo || '').toLowerCase()}|${String(linha.origem || '').trim().toUpperCase()}|${String(linha.regime || '').trim().toLowerCase()}|${String(linha.descricao || '').trim().replace(/\s+/g,' ').toUpperCase()}`;
}

// A fonte compartilhada é a verdade do cadastro. A publicação vinda de um
// SQLite de trabalho jamais atualiza um parceiro canônico já existente: ela
// só cria uma identidade ainda ausente. Isso impede que cache defasado
// reverta regime, nome ou origem confirmados na canônica.
async function publicarParceirosNovosCanonicos(remoto, empresaRemotaId, linhas = []) {
  const unicos=new Map();
  for (const linha of linhas) unicos.set(chaveParceiroCanonico(linha),linha);
  if (!unicos.size) return { inseridos:0, existentes:0 };
  const { data:existentes, error }=await remoto.from('parceiros').select('id,tipo,cnpj,descricao,regime,origem,ativo')
    .eq('empresa_id',Number(empresaRemotaId)).eq('ativo',true);
  if (error) throw new Error(`Fornecedores canônicos: ${error.message}`);
  const porChave=new Map((existentes || []).map((linha)=>[chaveParceiroCanonico(linha),linha]));
  let inseridos=0, existentesAtuais=0, indice=0;
  for (const [chave,linha] of unicos) {
    if (porChave.has(chave)) { existentesAtuais++; continue; }
    const { id,empresa_id,...dados }=linha;
    // A tabela legada não possui DEFAULT para id. Este id temporal só é usado
    // na primeira inserção; nas leituras seguintes, a identidade de negócio
    // (não o id) controla a publicação.
    const { error:erroInserir }=await remoto.from('parceiros').insert({ ...dados, empresa_id:Number(empresaRemotaId), ativo:true, id:Date.now()+(indice++) });
    if (erroInserir) throw new Error(`Novo fornecedor canônico: ${erroInserir.message}`);
    inseridos++;
  }
  return { inseridos, existentes:existentesAtuais };
}

async function publicarOperacaoEmpresa(empresaId) {
  if (!ativo()) return { ativo:false };
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para publicar a importação fiscal.');
  const remoto = supabase.admin();
  const cnpj=String(empresa.cnpj).replace(/\D/g,'');
  const { data: candidatas, error: erroEmpresa } = await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const empresas=(candidatas || []).filter((x) => Number(x.origem_local_id) === Number(empresaId) || String(x.cnpj || '').replace(/\D/g,'') === cnpj);
  if (empresas.length !== 1) throw new Error('Empresa compartilhada não localizada de forma única; a importação local foi preservada.');
  const empresaRemotaId=Number(empresas[0].id);
  // Exclusões confirmadas vencem qualquer cache de outra instância. Sem esta
  // guarda, uma publicação administrativa posterior poderia recriar uma
  // nota que o usuário já removeu da fonte canônica.
  const exclusoes=await chavesDocumentosExcluidosAuditados(remoto, Number(empresaId), empresaRemotaId);
  const foiExcluido=(linha)=>exclusoes.has(String(linha?.chave || '').trim());
  const tabelas=['lotes','parceiros','movimentos','enriquecimento_pis_cofins_evidencias'];
  const resultado={ empresa_id:empresaRemotaId };
  for (const tabela of tabelas) {
    const campos=CAMPOS[tabela];
    const linhas=db.prepare(`SELECT ${campos.join(',')} FROM ${tabela} WHERE empresa_id=?`).all(Number(empresaId))
      .filter((linha)=>tabela !== 'movimentos' || !foiExcluido(linha))
      .map((linha) => ({ ...linha, empresa_id:empresaRemotaId }));
    if (tabela === 'parceiros') {
      resultado[tabela]=await publicarParceirosNovosCanonicos(remoto, empresaRemotaId, linhas);
      continue;
    }
    // IDs SQLite não são globais: outra instância pode gerar o mesmo número
    // para outro XML. Em documento XML a chave eletrônica + item é a
    // identidade fiscal estável e impede que uma publicação substitua outra.
    const grupos = tabela === 'movimentos'
      ? [
        { linhas:deduplicarXmlParaPublicacao(linhas.filter((linha) => ['xml','planilha_saida_manual'].includes(String(linha.origem || '').toLowerCase()) && linha.chave))
          .map(({ id, ...linha }) => linha), conflito:'empresa_id,chave,item_numero' },
        { linhas:linhas.filter((linha) => !(['xml','planilha_saida_manual'].includes(String(linha.origem || '').toLowerCase()) && linha.chave)), conflito:'id' },
      ]
      : [{ linhas, conflito:'id' }];
    for (const grupo of grupos) for (let inicio=0; inicio<grupo.linhas.length; inicio+=500) {
      const { error } = await remoto.from(tabela).upsert(grupo.linhas.slice(inicio,inicio+500), { onConflict:grupo.conflito });
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
    resultado[tabela]=linhas.length;
  }
  // Não basta registrar o lote remoto: para importações volumosas, a origem
  // só é considerada publicada quando cada movimento local também pode ser
  // localizado na fotografia compartilhada. Isso evita o estado enganoso
  // "lote importado" com NFC-e ausente nas telas de documentos e cadeias.
  const locais = db.prepare('SELECT id,lote_id,chave,item_numero,origem FROM movimentos WHERE empresa_id=?').all(Number(empresaId))
    .filter((linha)=>!foiExcluido(linha));
  const identidadesRemotas = new Set();
  for (let inicio = 0;; inicio += 1000) {
    const { data, error } = await remoto.from('movimentos').select('id,lote_id,chave,item_numero,origem').eq('empresa_id', empresaRemotaId).range(inicio, inicio + 999);
    if (error) throw new Error(`verificação de movimentos: ${error.message}`);
    (data || []).forEach((linha) => identidadesRemotas.add(['xml','planilha_saida_manual'].includes(String(linha.origem || '').toLowerCase()) && linha.chave
      ? `${String(linha.origem || '').toLowerCase()}:${linha.chave}:${linha.item_numero}` : `id:${linha.id}`));
    if (!data || data.length < 1000) break;
  }
  const ausentes = locais.filter((linha) => !identidadesRemotas.has(['xml','planilha_saida_manual'].includes(String(linha.origem || '').toLowerCase()) && linha.chave
    ? `${String(linha.origem || '').toLowerCase()}:${linha.chave}:${linha.item_numero}` : `id:${linha.id}`));
  if (ausentes.length) {
    const porLote = new Map();
    ausentes.forEach((linha) => porLote.set(linha.lote_id || 'sem_lote', (porLote.get(linha.lote_id || 'sem_lote') || 0) + 1));
    throw new Error(`Publicação incompleta: ${ausentes.length} movimento(s) não chegaram à fonte compartilhada (${[...porLote.entries()].map(([lote,quantidade]) => `lote ${lote}: ${quantidade}`).join(', ')}).`);
  }
  resultado.verificacao = { movimentos_locais: locais.length, movimentos_confirmados: locais.length };
  return resultado;
}

// Uma reclassificação altera somente campos derivados do item fiscal. Reenviar
// toda a empresa depois de cada lote de medicamentos tornava a confirmação
// lenta e deixava o resultado local sujeito a ser sobrescrito pela próxima
// leitura compartilhada. Publicamos apenas os movimentos alterados, usando a
// chave fiscal + item como identidade estável.
async function publicarClassificacoesMovimentos(empresaId, movimentoIds = []) {
  if (!ativo()) return { ativo:false, publicados:0, pendentes:movimentoIds.length };
  const ids=[...new Set(movimentoIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return { ativo:true, publicados:0, pendentes:0 };
  const empresa=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para publicar a classificação.');
  const remoto=supabase.admin(); const cnpj=String(empresa.cnpj).replace(/\D/g,'');
  const { data:candidatas, error:erroEmpresa }=await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const empresas=(candidatas || []).filter((x)=>Number(x.origem_local_id)===Number(empresaId) || String(x.cnpj || '').replace(/\D/g,'')===cnpj);
  if (empresas.length !== 1) throw new Error('Empresa compartilhada não localizada de forma única; a classificação local foi preservada.');
  const marcas=ids.map(()=>'?').join(',');
  const campos=CAMPOS.movimentos;
  const locais=db.prepare(`SELECT ${campos.join(',')} FROM movimentos WHERE empresa_id=? AND id IN (${marcas})`).all(Number(empresaId),...ids);
  const publicaveis=deduplicarXmlParaPublicacao(locais.filter((x)=>String(x.origem || '').toLowerCase()==='xml' && String(x.chave || '').trim()));
  for (let inicio=0; inicio<publicaveis.length; inicio+=500) {
    const linhas=publicaveis.slice(inicio,inicio+500).map(({id,...linha})=>({ ...linha, empresa_id:Number(empresas[0].id) }));
    const { error }=await remoto.from('movimentos').upsert(linhas,{onConflict:'empresa_id,chave,item_numero'});
    if (error) throw new Error(`Classificações compartilhadas: ${error.message}`);
  }
  return { ativo:true, publicados:publicaveis.length, pendentes:ids.length-publicaveis.length };
}

// A conferência de CFOP não altera o XML: ela acrescenta ao fato fiscal a
// evidência contábil devolvida pelo Questor. A rastreabilidade lê a fonte
// compartilhada diretamente; publicar somente esses campos evita que a tela
// fique defasada e também evita reenviar toda a fotografia operacional.
async function publicarCfopsQuestorConciliados(empresaId, movimentoIds = []) {
  if (!ativo()) return { ativo:false, publicados:0, pendentes:movimentoIds.length };
  const ids=[...new Set(movimentoIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return { ativo:true, publicados:0, pendentes:0 };
  const empresa=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para publicar os CFOPs conciliados.');
  const remoto=supabase.admin();
  const cnpj=String(empresa.cnpj).replace(/\D/g,'');
  const { data:candidatas, error:erroEmpresa }=await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const empresas=(candidatas || []).filter((x)=>Number(x.origem_local_id)===Number(empresaId) || String(x.cnpj || '').replace(/\D/g,'')===cnpj);
  if (empresas.length!==1) throw new Error('Empresa compartilhada não localizada de forma única; os CFOPs locais foram preservados.');
  const marcas=ids.map(()=>'?').join(',');
  const locais=db.prepare(`SELECT id,chave,item_numero,normalizacao_status,normalizacao_evidencia FROM movimentos
    WHERE empresa_id=? AND id IN (${marcas})`).all(Number(empresaId),...ids)
    .filter((x)=>String(x.chave || '').trim());
  let publicados=0, naoLocalizados=0;
  for (const movimento of locais) {
    let consulta=remoto.from('movimentos').update({
      normalizacao_status:movimento.normalizacao_status,
      normalizacao_evidencia:movimento.normalizacao_evidencia,
    }).eq('empresa_id',Number(empresas[0].id)).eq('chave',movimento.chave);
    consulta=movimento.item_numero === null || movimento.item_numero === undefined
      ? consulta.is('item_numero',null)
      : consulta.eq('item_numero',movimento.item_numero);
    const { data, error }=await consulta.select('id');
    if (error) throw new Error(`CFOPs conciliados compartilhados: ${error.message}`);
    if (!data?.length) { naoLocalizados++; continue; }
    publicados+=data.length;
  }
  return { ativo:true, publicados, nao_localizados:naoLocalizados, pendentes:ids.length-locais.length };
}

// Entradas incluídas após a conciliação, pelo Razão ou manualmente não são
// XMLs. Elas não podem depender da publicação genérica por id local: esse id
// é efêmero entre instâncias. A chave estável do lançamento permite publicar
// somente esses fatos confirmados, sem reenviar a fotografia inteira.
async function publicarEntradasQuestorConciliadasDireto(empresaId, movimentoIds = []) {
  if (!ativo()) return { ativo:false, publicados:0, pendentes:movimentoIds.length };
  const ids=[...new Set(movimentoIds.map(Number).filter(Number.isInteger))];
  if (!ids.length) return { ativo:true, publicados:0, pendentes:0 };
  const empresa=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para publicar as entradas conciliadas.');
  const remoto=supabase.admin();
  const cnpj=String(empresa.cnpj).replace(/\D/g,'');
  const { data:candidatas, error:erroEmpresa }=await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const empresas=(candidatas || []).filter((x)=>Number(x.origem_local_id)===Number(empresaId) || String(x.cnpj || '').replace(/\D/g,'')===cnpj);
  if (empresas.length!==1) throw new Error('Empresa compartilhada não localizada de forma única; as entradas locais foram preservadas.');
  const marcas=ids.map(()=>'?').join(',');
  const locais=db.prepare(`SELECT ${CAMPOS.movimentos.join(',')} FROM movimentos WHERE empresa_id=? AND origem IN ('QUESTOR_CONCILIACAO_ENTRADA','QUESTOR_RAZAO','MANUAL_ENTRADA') AND id IN (${marcas})`).all(Number(empresaId),...ids);
  const chaves=locais.map((x)=>String(x.chave || '')).filter(Boolean);
  if (!chaves.length) return { ativo:true, publicados:0, pendentes:0 };
  // A entrada do Razão pode ter acabado de criar o fornecedor a partir do
  // cadastro de pessoas Questor. Publique-o antes do movimento: o worker
  // remoto então encontra o mesmo CNPJ ao recompor a cadeia e o regime, em
  // vez de voltar a exibir "Fornecedor genérico" após uma nova instância.
  const cnpjs=[...new Set(locais.map((x)=>String(x.inscr_federal || '').replace(/\D/g,'')).filter(Boolean))];
  if (cnpjs.length) {
    const marcasCnpj=cnpjs.map(()=>'?').join(',');
    const parceiros=db.prepare(`SELECT ${CAMPOS.parceiros.join(',')} FROM parceiros
      WHERE empresa_id=? AND tipo='fornecedor' AND cnpj IN (${marcasCnpj})`).all(Number(empresaId),...cnpjs);
    const publicaveis=parceiros.map(({ id, empresa_id, ...parceiro })=>({ ...parceiro, empresa_id:Number(empresas[0].id) }));
    if (publicaveis.length) {
      // A fonte canônica vence o cache. A conciliação pode criar somente uma
      // identidade que ainda não existe; nunca altera cadastro já confirmado.
      await publicarParceirosNovosCanonicos(remoto, Number(empresas[0].id), publicaveis);
    }
  }
  const { data:existentes, error:erroExistentes }=await remoto.from('movimentos').select('chave,nome,inscr_federal,normalizacao_evidencia').eq('empresa_id',Number(empresas[0].id)).in('chave',chaves);
  if (erroExistentes) throw new Error(`Entradas conciliadas compartilhadas: ${erroExistentes.message}`);
  const porChaveRemota=new Map((existentes || []).map((x)=>[String(x.chave),x]));
  const jaPublicadas=new Set(porChaveRemota.keys());
  const linhas=locais.map(({ id, ...linha })=>({ ...linha, empresa_id:Number(empresas[0].id) }));
  const novas=linhas.filter((x)=>!jaPublicadas.has(String(x.chave)));
  if (novas.length) {
    const { error }=await remoto.from('movimentos').insert(novas);
    if (error) throw new Error(`Entradas conciliadas compartilhadas: ${error.message}`);
  }
  // Uma correção de fornecedor/regime em um lançamento já publicado precisa
  // alcançar a fonte canônica. Antes deste update, a existência da chave
  // fazia a publicação pular a linha e o motor remoto continuava sem regime.
  const existentesLocais=linhas.filter((x)=>jaPublicadas.has(String(x.chave)));
  const evidenciasFornecedor=(linha)=>{
    try { return JSON.parse(linha?.normalizacao_evidencia || '{}').fornecedor_vinculado || {}; }
    catch (_) { return {}; }
  };
  const cnpjValido=(linha)=>String(linha?.inscr_federal || '').replace(/\D/g,'').length===14;
  const fornecedorGenerico=(linha)=>!cnpjValido(linha) && (/^Fornecedor genérico\s+—/i.test(String(linha?.nome || '')) || evidenciasFornecedor(linha).origem==='FORNECEDOR_GENERICO_SIMPLES');
  const fornecedorConfirmado=(linha)=>cnpjValido(linha) && !fornecedorGenerico(linha)
    && ['CONTRAPARTIDA_QUESTOR','HISTORICO_NOME_QUESTOR','HISTORICO_ALIAS_QUESTOR','AJUSTE_USUARIO'].includes(String(evidenciasFornecedor(linha).origem || ''));
  let preservadosRemotamente=0;
  for (const linha of existentesLocais) {
    const remotoExistente=porChaveRemota.get(String(linha.chave));
    // Uma instância com cache antigo pode ainda carregar o fornecedor padrão.
    // Ela jamais deve apagar uma identificação já confirmada por outra
    // instância na fonte canônica. A atualização incremental trará o vínculo
    // confirmado de volta para o cache local no próximo ciclo.
    if (fornecedorGenerico(linha) && fornecedorConfirmado(remotoExistente)) {
      preservadosRemotamente++;
      continue;
    }
    const { error }=await remoto.from('movimentos').update(linha)
      .eq('empresa_id',Number(empresas[0].id)).eq('chave',String(linha.chave));
    if (error) throw new Error(`Atualização de entrada conciliada compartilhada: ${error.message}`);
  }
  // A fila do motor roda em outra instância e só pode receber as identidades
  // canônicas. O id SQLite é efêmero e pode apontar para outro fato (ou para
  // nenhum) depois de um deploy. Resolva os ids pela chave estável somente
  // depois de concluir inserts e updates na fonte compartilhada.
  const { data:canonicos, error:erroCanonicos }=await remoto.from('movimentos').select('id,chave')
    .eq('empresa_id',Number(empresas[0].id)).in('chave',chaves);
  if (erroCanonicos) throw new Error(`Identidades canônicas das entradas conciliadas: ${erroCanonicos.message}`);
  const movimentoIdsCanonicos=[...new Set((canonicos || []).map((x)=>Number(x.id)).filter(Number.isInteger))];
  if (movimentoIdsCanonicos.length!==new Set(chaves).size) throw new Error('Nem todas as entradas publicadas receberam identidade canônica; o motor não foi enfileirado.');
  return { ativo:true, empresa_remota_id:Number(empresas[0].id), publicados:novas.length, atualizados:existentesLocais.length-preservadosRemotamente,
    preservados_remotamente:preservadosRemotamente, ja_publicados:locais.length-novas.length, pendentes:0,
    movimento_ids_canonicos:movimentoIdsCanonicos };
}
// Exclusão de documento fiscal precisa ocorrer na fonte canônica antes de
// atingir o cache. Caso contrário, a próxima reconciliação restaura o XML e
// a tela transmite a impressão de que o botão não funcionou.
async function excluirDocumentoFiscalCanonico(empresaId, { chave = null, chaves = [], movimentoIds = [] } = {}) {
  if (!ativo()) throw new Error('A fonte compartilhada não está disponível; o documento não foi removido para evitar que reapareça depois.');
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para excluir o documento fiscal.');
  const remoto = supabase.admin();
  const cnpj = String(empresa.cnpj).replace(/\D/g, '');
  const { data: empresas, error: erroEmpresa } = await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const candidatas = (empresas || []).filter((x) => Number(x.origem_local_id) === Number(empresaId) || String(x.cnpj || '').replace(/\D/g, '') === cnpj);
  if (candidatas.length !== 1) throw new Error('Não foi possível localizar unicamente a empresa compartilhada; o documento foi preservado.');
  const empresaRemotaId = candidatas[0].id;
  const chavesUnicas=[...new Set([chave,...chaves].map((x)=>String(x || '').trim()).filter(Boolean))];
  const idsSolicitados=[...new Set(movimentoIds.map(Number).filter(Number.isInteger))];
  if (!chavesUnicas.length && !idsSolicitados.length) throw new Error('Identidade do documento fiscal ausente.');
  const consultas=[];
  if (chavesUnicas.length) consultas.push(remoto.from('movimentos').select('id').eq('empresa_id', empresaRemotaId).in('chave', chavesUnicas));
  if (idsSolicitados.length) consultas.push(remoto.from('movimentos').select('id').eq('empresa_id', empresaRemotaId).in('id', idsSolicitados));
  const resultados=await Promise.all(consultas);
  const falha=resultados.find((x)=>x.error);
  if (falha) throw new Error(`Documento fiscal compartilhado: ${falha.error.message}`);
  const ids=[...new Set(resultados.flatMap((x)=>x.data || []).map((x) => Number(x.id)).filter(Number.isInteger))];
  if (!ids.length) throw new Error('Documento fiscal não localizado na fonte compartilhada; a cópia local foi preservada.');
  // Resultados do motor dependem do item fiscal. Eles são retirados junto com
  // o documento; uma nova execução gerará a próxima fotografia sem a nota.
  const { error: erroResultados } = await remoto.from('motor_resultados_operacionais').delete().in('movimento_id', ids);
  if (erroResultados) throw new Error(`Resultados do motor vinculados ao documento: ${erroResultados.message}`);
  const { error: erroExcluir } = await remoto.from('movimentos').delete().in('id', ids);
  if (erroExcluir) throw new Error(`Documento fiscal compartilhado: ${erroExcluir.message}`);
  invalidarReconciliacaoMovimentosEmpresa(empresaId);
  return { empresa_remota_id: empresaRemotaId, excluidos: ids.length, movimento_ids: ids };
}
async function restaurarLinhaCanonica(tabela, linha, justificativa, remotoInformado = null) {
  if (!ativo()) throw new Error('A fonte compartilhada não está disponível; restauração canônica recusada.');
  if (!linha || typeof linha!=='object' || !String(justificativa || '').trim()) throw new Error('Linha e justificativa são obrigatórias para restauração canônica.');
  const remoto=remotoInformado || supabase.admin();
  const { error }=await remoto.rpc('restaurar_linha_sincronizacao_operacional', {
    p_tabela:tabela, p_linha:linha, p_justificativa:String(justificativa).trim(),
  });
  if (error) throw new Error(`Restauração canônica: ${error.message}`);
  return { tabela, restaurada:true };
}

// Confirma, por chave, quais entradas Questor existem na fonte. Usa a mesma
// resolução de empresa do publicador: sem empresa única, nada é confirmado.
async function confirmarEntradasQuestorNaFonte(empresaId, identidades = []) {
  const presentes = new Set();
  const pedidos = new Set(identidades.map((x) => `${String(x.chave)}|${Number(x.item_numero ?? 0)}`));
  const lista = [...new Set(identidades.map((x) => String(x.chave)).filter(Boolean))];
  if (!lista.length || !ativo()) return presentes;
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para confirmar as entradas.');
  const remoto = supabase.admin();
  const cnpj = String(empresa.cnpj).replace(/\D/g,'');
  const { data:candidatas, error:erroEmpresa } = await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(10);
  if (erroEmpresa) throw new Error(`Empresa compartilhada: ${erroEmpresa.message}`);
  const empresas = (candidatas || []).filter((x) => Number(x.origem_local_id)===Number(empresaId) || String(x.cnpj || '').replace(/\D/g,'')===cnpj);
  if (empresas.length!==1) throw new Error('Empresa compartilhada não localizada de forma única; confirmação indisponível.');
  const { data, error } = await remoto.from('movimentos').select('chave,item_numero').eq('empresa_id', Number(empresas[0].id)).in('chave', lista);
  if (error) throw new Error(`Confirmação de entradas: ${error.message}`);
  // Identidade composta: a mesma chave com outro item na fonte não confirma o item local.
  for (const x of data || []) {
    const id = `${String(x.chave)}|${Number(x.item_numero ?? 0)}`;
    if (pedidos.has(id)) presentes.add(id);
  }
  return presentes;
}

// Toda publicação de entradas Questor passa pela outbox: a decisão de sucesso
// por item vem da própria fonte (chave presente), não da contagem do lote.
async function publicarEntradasQuestorConciliadas(empresaId, movimentoIds = []) {
  return require('./entradasQuestorOutbox').executarPublicacao(
    empresaId, movimentoIds,
    () => publicarEntradasQuestorConciliadasDireto(empresaId, movimentoIds),
    (identidades) => confirmarEntradasQuestorNaFonte(empresaId, identidades),
  );
}

module.exports = { confirmarEntradasQuestorNaFonte, ativo, baixar, baixarRegrasEnquadramento, restaurarParceirosEmpresa, garantirCacheOperacionalEmpresa, reconciliarMovimentosEmpresa, invalidarReconciliacaoMovimentosEmpresa, excluirDocumentoFiscalCanonico, restaurarLinhaCanonica, sincronizarIncremental, baixarConfiguracao, publicarConfiguracao, baixarParametrosIrpjCsll, baixarGestao, publicar, publicarOperacaoEmpresa, publicarClassificacoesMovimentos, publicarCfopsQuestorConciliados, publicarEntradasQuestorConciliadas, deduplicarXmlParaPublicacao, deduplicarMovimentosFiscais, configuracaoFiscalCertificada, mapaEmpresasLocais, normalizarEmpresaIdDoCache, buscarColecoes, chaveConflitoTabela, chaveConflitoPublicacao,
  baixarResultadosMotor, restaurarFotografiaMotorEmpresa, validarFotografiaLocalEmpresa, publicarEstadosProjecoes, publicarResultadosMotor, promoverFotografiaMotor, promoverFotografiaMotorIncremental, validarFotografiaAtivaMotor, integridadeFotografiaAtivaMotor, prepararContextoMotorEmpresa, prepararContextoMotorIncremental, listarMovimentosCanonicosEmpresa, restaurarEvidenciasMotorAposDocumentos, filtrarOrfaosOperacionais, execucaoCompartilhadaLocal,
  compararFotografiaMotor, resultadoCompartilhadoLocal, lerResultadosAtivosPorChave, reduzirEventosIncrementais, chaveEvento, validarEventoIncremental, diagnosticarDivergenciaMovimentosCanonicos,
  chavesQueDevemPermanecerExcluidas };
