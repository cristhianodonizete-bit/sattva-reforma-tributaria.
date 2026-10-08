const db = require('../db');
const fila = require('./processamentoCarteira');
const staging = require('./motorStaging');
const supabase = require('./supabase');

const TIPO = 'MOTOR_COMPLETO';
const TIPO_INCREMENTAL = 'MOTOR_INCREMENTAL';
const json = (valor, padrao = null) => {
  if (valor === null || valor === undefined || valor === '') return padrao;
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
};

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

// Não reutiliza MOTOR_COMPLETO: uma alteração pontual do Razão não pode
// disparar preparação, reconciliação ou releitura da empresa inteira.
async function solicitarIncremental(empresaId, opcoes = {}) {
  const empresa = db.prepare('SELECT id FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const movimentoIds = [...new Set((opcoes.movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!movimentoIds.length) throw new Error('Informe ao menos um lançamento para o reprocessamento incremental.');
  const ano = String(Number(opcoes.ano) || 2027);
  // Não descarte uma segunda alteração enquanto há um job incremental
  // pendente. Unimos o novo recorte ao job existente, mantendo ambos os
  // conjuntos explicitamente autorizados e evitando que a última alteração
  // fique aguardando uma intervenção manual.
  const ativo=db.prepare(`SELECT * FROM jobs_carteira WHERE empresa_id=? AND competencia=? AND tipo_job=? AND status IN ('PENDENTE','PROCESSANDO') ORDER BY criado_em DESC LIMIT 1`)
    .get(Number(empresaId),ano,TIPO_INCREMENTAL);
  if (ativo) {
    let payload={}; try { payload=json(ativo.payload,{}) || {}; } catch (_) { payload={}; }
    const unidos=[...new Set([...(payload.movimento_ids || []),...movimentoIds].map(Number).filter(Number.isInteger))];
    if (unidos.length !== (payload.movimento_ids || []).length) {
      payload.movimento_ids=unidos;
      db.prepare('UPDATE jobs_carteira SET payload=? WHERE id=?').run(JSON.stringify(payload),ativo.id);
      if (supabase.configurado()) {
        const { error }=await supabase.admin().from('jobs_carteira').update({ payload }).eq('id',ativo.id).eq('status','PENDENTE');
        if (error) throw new Error(`Atualização da fila incremental: ${error.message}`);
      }
    }
    return { processamento_id:ativo.processamento_id, deduplicado:true, job:{ ...ativo, payload:JSON.stringify(payload) }, movimento_ids:unidos };
  }
  const processamento = await fila.iniciar({ empresas:[Number(empresaId)], competencia:ano, tipo:TIPO_INCREMENTAL, prioridade:10,
    payload:{ ano:Number(ano), movimento_ids:movimentoIds, modo:'INCREMENTAL_IDS_EXPLICITOS' }, iniciarWorker:false });
  const job = (processamento.jobs || []).find((x) => Number(x.empresa_id) === Number(empresaId) && x.tipo_job === TIPO_INCREMENTAL) || null;
  return { processamento_id:processamento.id, deduplicado:Boolean(processamento.deduplicado), job, movimento_ids:movimentoIds };
}

function etapas(job, foto) {
  if (!job) return [];
  const payload = json(job.payload, {});
  if (job.tipo_job === TIPO_INCREMENTAL) {
    const ids = [...new Set((payload.movimento_ids || []).map(Number).filter(Number.isInteger))];
    const concluido = job.status === 'CONCLUIDO';
    const falhou = job.status === 'FALHOU';
    return [
      { chave:'escopo', titulo:'Escopo autorizado', estado: falhou ? 'FALHOU' : concluido ? 'CONCLUIDO' : 'PROCESSANDO', detalhe:`${ids.length} lançamento(s) identificado(s) explicitamente; documentos, fontes e demais movimentos ficam fora desta execução.` },
      { chave:'calculo', titulo:'Cálculo incremental', estado: falhou ? 'FALHOU' : concluido ? 'CONCLUIDO' : 'PROCESSANDO', detalhe: concluido ? 'Resultados derivados dos IDs autorizados foram recalculados.' : 'Recalcula somente os resultados derivados do escopo autorizado.' },
    ];
  }
  const resultado = json(job.resultado);
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

function statusLocal(empresaId) {
  return db.prepare(`SELECT id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em
    FROM jobs_carteira WHERE empresa_id=? AND tipo_job IN (?,?) ORDER BY criado_em DESC LIMIT 1`).get(empresaId, TIPO, TIPO_INCREMENTAL);
}

async function status(empresaId) {
  let job = null;
  // O cache SQLite pode sobreviver a uma publicação ou ficar atrasado após
  // reinício. A fila compartilhada é a fonte de verdade inclusive quando há
  // uma cópia local; consultá-la primeiro impede a tela de manter um job
  // concluído como "na fila".
  if (supabase.configurado()) {
    const { data, error } = await supabase.admin().from('jobs_carteira')
      .select('id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em')
      .eq('empresa_id', Number(empresaId)).in('tipo_job', [TIPO, TIPO_INCREMENTAL])
      .order('criado_em', { ascending: false }).limit(1);
    if (error) throw new Error(`Status compartilhado do motor: ${error.message}`);
    job = data?.[0] || null;
  }
  if (!job) job = statusLocal(empresaId);
  if (!job) return null;
  const foto = staging.consultar(job.id);
  const resultado = json(job.resultado);
  return { ...job, resultado, staging: foto,
    estado: job.status, etapas: etapas(job, null) };
}

module.exports = { TIPO, TIPO_INCREMENTAL, solicitar, solicitarIncremental, status, etapas };
