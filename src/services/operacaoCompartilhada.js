/* Cache operacional: Supabase é a fonte compartilhada; SQLite atende o motor local. */
const db = require('../db');
const supabase = require('./supabase');

const CAMPOS = {
  empresas: ['id','cnpj','razao_social','nome_fantasia','regime','uf','municipio','cnae','atividade','faturamento_anual','setor','reducao_padrao','codigo_questor','observacoes','criado_em'],
  parceiros: ['id','empresa_id','tipo','cnpj','descricao','regime','faturamento_anual','uf','municipio','origem','criado_em','regime_resolvido','perfil_economico','perfil_origem','sensibilidade_credito','sensibilidade_origem'],
  lotes: ['id','empresa_id','tipo','arquivo','registros','ignorados','valor_total','mensagens','origem','criado_em'],
  movimentos: ['id','empresa_id','lote_id','tipo','nome','inscr_federal','descricao','ncm','nbs','cfop','cst','competencia','valor','base_calculo','icms','icms_st','ipi','pis','cofins','iss','regime','reducao','aliq_especifica','cclasstrib','classificacao_origem','cst_declarado','cclasstrib_declarado','ibs_declarado','cbs_declarado','documento','item_numero','chave','emitente_cnpj','destinatario_cnpj','codigo_produto','quantidade','unidade','csosn','data_emissao','frete','seguro','outras','desconto','sentido','origem','criado_em'],
  perfil_tributario: ['id','empresa_id','competencia','receita_bruta','receita_mercadorias','receita_servicos','receita_exportacao','icms','iss','ipi','pis','cofins','das','creditos_tomados','origem','criado_em'],
};

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
async function baixar() {
  if (!ativo()) return { ativo: false };
  const remoto = supabase.admin(), resultado = {};
  for (const tabela of Object.keys(CAMPOS)) resultado[tabela] = gravar(tabela, await buscarTudo(remoto, tabela));
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
  return resultado;
}
module.exports = { ativo, baixar, publicar };
