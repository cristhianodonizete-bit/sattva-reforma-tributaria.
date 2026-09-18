const db = require('../db');
const fila = require('./processamentoCarteira');
const staging = require('./motorStaging');

const TIPO = 'MOTOR_COMPLETO';

async function solicitar(empresaId, opcoes = {}) {
  const empresa = db.prepare('SELECT id FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const ano = String(Number(opcoes.ano) || 2027);
  const processamento = await fila.iniciar({ empresas: [Number(empresaId)], competencia: ano, tipo: TIPO, prioridade: 10,
    payload: { ano: Number(ano), anexo: opcoes.anexo || null, modo: 'FOTOGRAFIA_ATOMICA',
      reconciliacao_documental: opcoes.reconciliacao_documental || null }, iniciarWorker: false });
  const job = (processamento.jobs || []).find((x) => Number(x.empresa_id) === Number(empresaId) && x.tipo_job === TIPO) || null;
  return { processamento_id: processamento.id, deduplicado: Boolean(processamento.deduplicado), job };
}

function etapas(job, foto) {
  if (!job) return [];
  const payload = job.payload ? JSON.parse(job.payload) : {};
  const resultado = job.resultado ? JSON.parse(job.resultado) : null;
  const fase = String(foto?.status || job.status || 'PENDENTE');
  const concluido = fase === 'CONCLUIDO' || job.status === 'CONCLUIDO';
  const falhou = fase === 'FALHOU' || job.status === 'FALHOU';
  const em = (...fases) => fases.includes(fase) && !falhou;
  const estado = (feito, emAndamento) => falhou ? 'FALHOU' : feito ? 'CONCLUIDO' : emAndamento ? 'PROCESSANDO' : 'AGUARDANDO';
  const fonte = payload.reconciliacao_documental;
  const quantidade = Number(resultado?.itens ?? foto?.quantidade_esperada ?? 0);
  return [
    // A execução concluída só é possível depois da conferência da fonte. Em
    // jobs reaproveitados o resumo pode não estar no payload local, mas isso
    // não pode deixar a primeira etapa visualmente como "Aguardando".
    { chave:'fonte', titulo:'Base fiscal e outras receitas', estado: estado(concluido || Boolean(fonte), em('AGUARDANDO','SINCRONIZANDO_CADASTRO')), detalhe: fonte ? `${fonte.movimentos || 0} item(ns) fiscal(is) conferido(s) na fonte compartilhada.` : concluido ? 'Fonte compartilhada conferida antes do processamento.' : 'Conferência da fonte compartilhada.' },
    { chave:'cadastro', titulo:'Cadastro e elegibilidade', estado: estado(concluido || ['CALCULANDO','PUBLICANDO'].includes(fase), em('SINCRONIZANDO_CADASTRO')), detalhe:'Atualiza confirmações societárias antes de avaliar regras condicionais, inclusive Anexo XI.' },
    { chave:'calculo', titulo:'Cálculo e classificação CBS/IBS', estado: estado(concluido || fase === 'PUBLICANDO', em('CALCULANDO')), detalhe: concluido ? `${quantidade} item(ns) processado(s), com classificação e regras fiscais aplicadas.` : 'Classifica produtos e serviços, aplica regras e consolida a base econômica.' },
    { chave:'publicacao', titulo:'Fotografia e módulos de análise', estado: estado(concluido, em('PUBLICANDO')), detalhe: concluido ? 'Fotografia publicada. Cadeias, impacto CBS, conformidade e perfil usam este resultado.' : 'Publica a fotografia atômica que abastece Cadeias, Impacto CBS, Conformidade e Perfil Tributário.' },
  ];
}

function status(empresaId) {
  const job = db.prepare(`SELECT id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em
    FROM jobs_carteira WHERE empresa_id=? AND tipo_job=? ORDER BY criado_em DESC LIMIT 1`).get(empresaId, TIPO);
  if (!job) return null;
  const foto = staging.consultar(job.id);
  return { ...job, resultado: job.resultado ? JSON.parse(job.resultado) : null, staging: foto,
    estado: foto?.status || job.status, etapas: etapas(job, foto) };
}

module.exports = { TIPO, solicitar, status, etapas };
