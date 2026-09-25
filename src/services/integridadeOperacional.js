/* Conferência somente leitura: nunca recalcula, publica, corrige ou exclui. */
const fechamentoModulos = require('./fechamentoModulos');

const numero = (valor) => Number(valor || 0);

function auditar(db, empresaId) {
  const id = Number(empresaId);
  const empresa = db.prepare('SELECT id,razao_social,regime FROM empresas WHERE id=?').get(id);
  if (!empresa) throw new Error('Empresa não encontrada para conferência de integridade.');

  const documentos = db.prepare(`SELECT COUNT(*) quantidade, COALESCE(SUM(valor),0) valor,
    COUNT(DISTINCT competencia) competencias FROM movimentos WHERE empresa_id=?`).get(id);
  const saidas = db.prepare(`SELECT COUNT(*) quantidade, COALESCE(SUM(valor),0) valor,
    GROUP_CONCAT(DISTINCT competencia) competencias FROM movimentos
    WHERE empresa_id=? AND lower(COALESCE(sentido,''))='saida' AND COALESCE(situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO')`).get(id);
  const perfil = db.prepare(`SELECT COUNT(*) quantidade, COALESCE(SUM(receita_bruta),0) receita,
    GROUP_CONCAT(DISTINCT competencia) competencias FROM perfil_tributario WHERE empresa_id=? AND COALESCE(competencia,'')<>''`).get(id);
  const pgdas = db.prepare(`SELECT COUNT(*) quantidade, SUM(CASE WHEN status_processamento IN ('VALIDADO_USUARIO','VALIDADO_AUTOMATICAMENTE') THEN 1 ELSE 0 END) validados
    FROM pgdas_documentos WHERE empresa_id=?`).get(id);
  const apuracoes = db.prepare('SELECT COUNT(*) quantidade FROM pis_cofins_apuracao_documentos WHERE empresa_id=?').get(id);
  const execucao = db.prepare('SELECT id,itens,criado_em FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(id) || null;
  const resultados = execucao ? db.prepare('SELECT COUNT(*) quantidade FROM motor_resultados WHERE empresa_id=? AND execucao_id=?').get(id, execucao.id) : { quantidade:0 };
  const job = db.prepare(`SELECT id,status,tentativas,max_tentativas,erro,criado_em,finalizado_em
    FROM jobs_carteira WHERE empresa_id=? ORDER BY criado_em DESC LIMIT 1`).get(id) || null;
  const fechamento = fechamentoModulos.listar(id);
  const achados = [];
  const adicionar = (gravidade, codigo, mensagem) => achados.push({ gravidade, codigo, mensagem });

  if (numero(saidas.quantidade) > 0 && numero(perfil.quantidade) === 0) adicionar('ALTA', 'PERFIL_AUSENTE', 'Há vendas/documentos, mas não há competência no Perfil Tributário.');
  if (numero(documentos.quantidade) > 0 && !execucao) adicionar('ALTA', 'FOTOGRAFIA_AUSENTE', 'Há documentos fiscais, mas não há fotografia do motor.');
  if (execucao && numero(resultados.quantidade) !== numero(execucao.itens)) adicionar('ALTA', 'FOTOGRAFIA_INCOMPLETA', `A execução #${execucao.id} declara ${execucao.itens} item(ns), mas possui ${resultados.quantidade} resultado(s).`);
  if (empresa.regime === 'simples_nacional' && numero(saidas.quantidade) > 0 && !numero(pgdas.validados)) adicionar('MEDIA', 'PGDAS_NAO_VALIDADO', 'Empresa do Simples com vendas e sem PGDAS validado.');
  if (empresa.regime !== 'simples_nacional' && numero(saidas.quantidade) > 0 && !numero(apuracoes.quantidade)) adicionar('MEDIA', 'APURACAO_NAO_IMPORTADA', 'Empresa com vendas e sem documento de apuração PIS/Cofins importado.');
  if (job?.status === 'FALHOU') adicionar('MEDIA', 'ULTIMO_JOB_FALHOU', `O último job do motor falhou após ${job.tentativas || 0} tentativa(s).`);
  if (fechamento.modulos.some((m) => m.chave === 'perfil' && m.status === 'FECHADO') && achados.some((a) => a.gravidade === 'ALTA')) adicionar('ALTA', 'MODULO_FECHADO_COM_ALERTA', 'O Perfil está fechado apesar de alerta crítico na conferência.');

  return {
    natureza:'CONFERENCIA_SOMENTE_LEITURA', empresa:{ id:empresa.id, razao_social:empresa.razao_social, regime:empresa.regime },
    resumo:{ documentos:numero(documentos.quantidade), valor_documentos:numero(documentos.valor), saidas:numero(saidas.quantidade), valor_saidas:numero(saidas.valor), perfil_competencias:numero(perfil.quantidade), receita_perfil:numero(perfil.receita), pgdas_documentos:numero(pgdas.quantidade), pgdas_validados:numero(pgdas.validados), apuracoes:numero(apuracoes.quantidade), resultados_motor:numero(resultados.quantidade) },
    fotografia:execucao ? { execucao_id:execucao.id, itens_declarados:numero(execucao.itens), resultados:numero(resultados.quantidade), criado_em:execucao.criado_em } : null,
    fila:job, fechamento, achados,
    situacao:achados.some((a) => a.gravidade === 'ALTA') ? 'ATENCAO' : achados.length ? 'REVISAR' : 'INTEGRO',
  };
}

module.exports = { auditar };
