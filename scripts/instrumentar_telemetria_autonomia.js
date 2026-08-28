/*
 * Instrumenta a fotografia já calculada. Não chama o motor tributário e não
 * muda nenhum campo fiscal: apenas adiciona telemetria e snapshots de exceção
 * vinculados à execução ativa.
 */
require('dotenv').config();
const telemetria = require('../src/services/autonomiaTelemetry');
const excecoes = require('../src/services/excecoesMotor');
const supabase = require('../src/services/supabase');

const CAMPOS_TELEMETRIA = ['autonomia', 'estado_autonomia', 'codigo_causa', 'origem_resolucao',
  'evidencia_utilizada', 'regra_vencedora', 'requer_intervencao_humana', 'motivo_intervencao'];
const semTelemetria = (dados = {}) => {
  const limpo = { ...dados };
  CAMPOS_TELEMETRIA.forEach((campo) => delete limpo[campo]);
  return limpo;
};

async function executar(empresaId = 1) {
  if (!supabase.configurado()) throw new Error('Supabase não configurado.');
  const remoto = supabase.admin();
  const { data: linhas, error } = await remoto.from('motor_resultados_operacionais').select('*').eq('empresa_id', empresaId).eq('ativo', true);
  if (error) throw error;
  if (!linhas?.length) throw new Error('Não existe resultado ativo para instrumentar.');
  const execucaoId = Number(linhas[0].dados?.execucao_id || linhas[0].execucao_id);
  if (!execucaoId || linhas.some((x) => Number(x.dados?.execucao_id || x.execucao_id) !== execucaoId)) throw new Error('Fotografia ativa não possui uma execução única.');
  const atualizacoes = linhas.map((registro) => {
    // A telemetria é persistida em colunas próprias: não altera o JSON fiscal,
    // para preservar a assinatura e a memória técnica original.
    const linha = { ...semTelemetria(registro.dados || {}), detalhe: registro.dados?.detalhe || {} };
    const a = telemetria.avaliar(linha);
    return { id: registro.id, empresa_id: registro.empresa_id, movimento_id: registro.movimento_id, dados: linha,
      estado_autonomia: a.estado_autonomia, codigo_causa: a.codigo_causa, origem_resolucao: a.origem_resolucao,
      evidencia_utilizada: a.evidencia_utilizada, regra_vencedora: a.regra_vencedora,
      requer_intervencao_humana: Boolean(a.requer_intervencao_humana), motivo_intervencao: a.motivo_intervencao };
  });
  const resumo = telemetria.consolidar(atualizacoes.map((x) => x.dados));
  for (let i = 0; i < atualizacoes.length; i += 500) {
    const { error: erroAtualizacao } = await remoto.from('motor_resultados_operacionais').upsert(atualizacoes.slice(i, i + 500), { onConflict: 'id' });
    if (erroAtualizacao) throw erroAtualizacao;
  }
  const { error: erroResumo } = await remoto.from('telemetria_autonomia_execucoes').upsert({
    execucao_id: execucaoId, empresa_id: empresaId, meta_autonomia: resumo.meta_autonomia, total_operacoes: resumo.total_operacoes,
    operacoes_autonomas: resumo.operacoes_autonomas, operacoes_intervencao: resumo.operacoes_intervencao,
    taxa_autonomia: resumo.taxa_autonomia, taxa_determinacao: resumo.taxa_determinacao, taxa_simulacao: resumo.taxa_simulacao,
    taxa_indeterminacao_automatica: resumo.taxa_indeterminacao_automatica, taxa_intervencao_humana: resumo.taxa_intervencao_humana,
    estados_json: resumo.estados, atualizado_em: new Date().toISOString(),
  }, { onConflict: 'execucao_id' });
  if (erroResumo) throw erroResumo;
  const fotos = [];
  for (const registro of atualizacoes) {
    for (const x of excecoes.candidatas(registro.dados)) {
      const valor = Math.abs(Number(registro.dados.preco_atual) || 0);
      const impacto = Math.abs(Number(registro.dados.cbs) || 0) + Math.abs(Number(registro.dados.credito_cbs) || 0);
      fotos.push({ empresa_id: empresaId, execucao_id: execucaoId, movimento_id: registro.movimento_id, codigo: x.codigo,
        categoria: x.categoria, gravidade: x.gravidade, status: 'ABERTA', natureza: registro.dados.natureza || 'INDETERMINADO', origem: x.origem,
        valor_envolvido: valor, impacto_cbs_estimado: impacto, materialidade: Math.max(valor, impacto),
        detalhe: { mensagem: x.texto, motor_resultado_id: registro.id, status_classificacao: registro.dados.status_classificacao, status_credito: registro.dados.status_credito_determinacao || registro.dados.status_credito } });
    }
  }
  for (let i = 0; i < fotos.length; i += 500) {
    const { error: erroFoto } = await remoto.from('excecoes_motor_execucoes').upsert(fotos.slice(i, i + 500), { onConflict: 'empresa_id,execucao_id,movimento_id,codigo' });
    if (erroFoto) throw erroFoto;
  }
  return { execucao_id: execucaoId, excecoes_ativas: fotos.length, ...resumo };
}

if (require.main === module) executar(Number(process.argv[2]) || 1).then((r) => console.log(JSON.stringify(r, null, 2))).catch((e) => { console.error(e.stack || e.message); process.exit(1); });
module.exports = { executar };
