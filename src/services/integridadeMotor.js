// A fotografia do motor só é confiável se puder ser reproduzida a partir da
// mesma entrada. Esta assinatura não altera nenhuma fonte: ela apenas resume
// os fatos, cadastros e parâmetros efetivamente consultados pelo motor.
const crypto = require('crypto');
const db = require('../db');

const FONTES_EMPRESA = [
  'empresas', 'empresa_periodo_analisado', 'movimentos', 'parceiros',
  'empresa_servicos_fiscais', 'empresa_qsa', 'cnpj_cache',
  'apuracoes_pis_cofins', 'pgdas_declaracoes', 'outras_receitas',
];
const FONTES_GLOBAIS = [
  'regras_governo', 'base_ncm', 'base_servicos', 'param_aliquotas',
  'param_simples', 'param_naturezas_juridicas_anexo_xi',
];
const CAMPOS_TECNICOS = new Set(['id', 'criado_em', 'atualizado_em', 'origem_local_id']);

function existeTabela(nome) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(nome));
}
function normalizar(valor) {
  if (valor == null) return null;
  if (typeof valor === 'number') return Number.isFinite(valor) ? Number(valor.toFixed(8)) : String(valor);
  if (typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(normalizar);
  return Object.keys(valor).sort().reduce((saida, chave) => {
    if (!CAMPOS_TECNICOS.has(chave)) saida[chave] = normalizar(valor[chave]);
    return saida;
  }, {});
}
function hash(valor) {
  return crypto.createHash('sha256').update(JSON.stringify(normalizar(valor))).digest('hex');
}
function linhasDaTabela(tabela, empresaId) {
  if (!existeTabela(tabela)) return [];
  const colunas = db.prepare(`PRAGMA table_info(${tabela})`).all().map((x) => x.name);
  if (colunas.includes('empresa_id')) return db.prepare(`SELECT * FROM ${tabela} WHERE empresa_id=?`).all(empresaId);
  if (tabela === 'empresas') return db.prepare('SELECT * FROM empresas WHERE id=?').all(empresaId);
  return db.prepare(`SELECT * FROM ${tabela}`).all();
}
function ordenar(linhas) {
  return linhas.map(normalizar).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
function assinarEntrada(empresaId) {
  const fontes = {};
  for (const tabela of [...FONTES_EMPRESA, ...FONTES_GLOBAIS]) fontes[tabela] = ordenar(linhasDaTabela(tabela, empresaId));
  return { algoritmo:'sha256-v1', assinatura:hash(fontes), fontes: Object.fromEntries(Object.entries(fontes).map(([nome, linhas]) => [nome, linhas.length])) };
}
function assinarResultado(empresaId, execucaoId) {
  const linhas = db.prepare(`SELECT movimento_id,sentido,ano,status_classificacao,status_credito,natureza,preco_atual,base_economica,ibs,cbs,credito_ibs,credito_cbs,tipo_credito,modalidade_credito,status_credito_determinacao,movimento_hash,regra_version,catalogo_version,parceiro_version,parametro_version,motor_version,regime_cbs_emitente,regime_cbs_adquirente,preco_projetado,custo_liquido,cst,cclasstrib,tratamento,perfil_destinatario,sensibilidade,estado_autonomia,codigo_causa,origem_resolucao,evidencia_utilizada,regra_vencedora,requer_intervencao_humana,motivo_intervencao,detalhe FROM motor_resultados WHERE empresa_id=? AND execucao_id=?`).all(empresaId, execucaoId);
  const distintos = new Set(linhas.map((x) => String(x.movimento_id))).size;
  if (distintos !== linhas.length) throw new Error('Integridade do motor: a execução contém mais de um resultado para o mesmo item fiscal.');
  return { algoritmo:'sha256-v1', assinatura:hash(ordenar(linhas)), itens:linhas.length };
}
function exigirMesmaEntrada(antes, depois) {
  if (antes.assinatura !== depois.assinatura) throw new Error('A fonte fiscal, cadastro ou regra mudou durante o cálculo. A nova fotografia foi descartada e a anterior continua ativa. Execute novamente após concluir as alterações.');
}

module.exports = { assinarEntrada, assinarResultado, exigirMesmaEntrada };
