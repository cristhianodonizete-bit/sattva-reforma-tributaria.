/* Cache operacional: Supabase é a fonte compartilhada; SQLite atende o motor local. */
const db = require('../db');
const supabase = require('./supabase');

const CAMPOS = {
  empresas: ['id','cnpj','razao_social','nome_fantasia','regime','uf','municipio','cnae','atividade','faturamento_anual','setor','reducao_padrao','codigo_questor','observacoes','criado_em'],
  parceiros: ['id','empresa_id','tipo','cnpj','descricao','regime','faturamento_anual','uf','municipio','origem','criado_em','regime_resolvido','perfil_economico','perfil_origem','sensibilidade_credito','sensibilidade_origem'],
  lotes: ['id','empresa_id','tipo','arquivo','registros','ignorados','valor_total','mensagens','origem','criado_em'],
  movimentos: ['id','empresa_id','lote_id','tipo','nome','inscr_federal','descricao','ncm','nbs','cfop','cst','competencia','valor','base_calculo','icms','icms_st','ipi','pis','cofins','iss','regime','reducao','aliq_especifica','cclasstrib','classificacao_origem','cst_declarado','cclasstrib_declarado','ibs_declarado','cbs_declarado','documento','item_numero','chave','emitente_cnpj','destinatario_cnpj','codigo_produto','quantidade','unidade','csosn','data_emissao','frete','seguro','outras','desconto','sentido','origem','criado_em'],
  perfil_tributario: ['id','empresa_id','competencia','receita_bruta','receita_mercadorias','receita_servicos','receita_exportacao','icms','iss','ipi','pis','cofins','das','creditos_tomados','origem','criado_em'],
  base_ncm: ['id','ncm','descricao','cst','cclasstrib','classificacao','anexo','fundamento','reducao_ibs','reducao_cbs','regra','fonte','candidatos','reducao'],
  base_servicos: ['id','lc116','nbs','descricao_item','descricao_nbs','onerosa','exterior','indop','local_incidencia','cclasstrib','nome_cclasstrib','reducao'],
  turmas: ['id','empresa_id','trilha','titulo','formato','data','carga_horaria','instrutor','limite_participantes','status','observacoes'],
  participantes: ['id','turma_id','empresa_id','nome','area','email','presenca','nota_avaliacao'],
};
const CONFIG_TABELAS = ['param_regras','param_aliquotas','param_tributos','param_regimes','param_reducoes','param_cfop','param_simples','servicos','combos','combo_itens'];

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
  const sql = `INSERT INTO ${tabela} (${campos.join(',')}) VALUES (${campos.map(() => '?').join(',')})
    ON CONFLICT(id) DO UPDATE SET ${campos.filter((x) => x !== 'id').map((x) => `${x}=excluded.${x}`).join(',')}`;
  const inserir = db.prepare(sql);
  db.transaction(() => linhas.forEach((x) => inserir.run(...campos.map((c) => x[c] ?? null))))();
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
  for (const tabela of Object.keys(CAMPOS)) resultado[tabela] = gravar(tabela, await buscarTudo(remoto, tabela));
  const { data: configuracoes, error: erroConfiguracoes } = await remoto.from('parametros_operacionais').select('chave,dados').eq('tabela', 'configuracao');
  if (erroConfiguracoes && !String(erroConfiguracoes.message).includes('does not exist')) throw erroConfiguracoes;
  const porChave = new Map((configuracoes || []).map((x) => [x.chave, x.dados]));
  for (const tabela of CONFIG_TABELAS) if (Array.isArray(porChave.get(tabela))) gravarConfiguracao(tabela, porChave.get(tabela));
  resultado.gestao = gravarGestao(await buscarTudo(remoto, 'projetos'), await buscarTudo(remoto, 'projeto_entregas'), await buscarTudo(remoto, 'projeto_acompanhamentos'), await buscarTudo(remoto, 'projeto_responsaveis'), await buscarTudo(remoto, 'projeto_tarefas'));
  return resultado;
}
async function publicar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  for (const [tabela, campos] of Object.entries(CAMPOS)) {
    const linhas = db.prepare(`SELECT ${campos.join(',')} FROM ${tabela}`).all();
    for (let i = 0; i < linhas.length; i += 500) {
      const { error } = await remoto.from(tabela).upsert(linhas.slice(i, i + 500), { onConflict: 'id' });
      if (error) throw new Error(`${tabela}: ${error.message}`);
    }
    resultado[tabela] = linhas.length;
  }
  for (const tabela of CONFIG_TABELAS) {
    const linhas = db.prepare(`SELECT * FROM ${tabela}`).all();
    const { error } = await remoto.from('parametros_operacionais').upsert({ tabela: 'configuracao', chave: tabela, dados: linhas }, { onConflict: 'tabela,chave' });
    if (error) throw new Error(`${tabela}: ${error.message}`);
    resultado[`config_${tabela}`] = linhas.length;
  }
  return resultado;
}
module.exports = { ativo, baixar, publicar };
