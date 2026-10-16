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

// O worker dedicado continua sendo o consumidor preferencial. Porém, um
// deploy sem esse serviço não pode deixar uma correção aprovada parada na
// fila. O Web consome apenas o processamento que acabou de receber; o claim
// condicional no Supabase garante que nunca dispute o mesmo job com o worker.
function iniciarConsumidorContingencia(processamentoId, habilitado = true) {
  if (!habilitado || !processamentoId) return;
  setImmediate(() => fila.executar(processamentoId)
    .catch((erro) => console.error('[fila contingência web]', erro.message)));
}

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
    let remotoAtivo = true;
    if (supabase.configurado()) {
      const { data, error } = await supabase.admin().from('jobs_carteira')
        .select('status').eq('id', ativo.id).maybeSingle();
      if (error) throw new Error(`Consulta da fila incremental: ${error.message}`);
      remotoAtivo = Boolean(data && ['PENDENTE','PROCESSANDO'].includes(String(data.status)));
    }
    if (!remotoAtivo) {
      payload = { ano:Number(ano), movimento_ids:movimentoIds,
        identidade_movimento:'SUPABASE_CANONICA_V1', modo:'INCREMENTAL_IDS_EXPLICITOS' };
    }
    // Jobs anteriores transportavam ids do SQLite efêmero. Ao receber a
    // primeira solicitação com o contrato canônico, substituímos esse recorte
    // inválido. Depois da marca, alterações concorrentes voltam a ser unidas.
    const idsAnteriores=remotoAtivo && payload.identidade_movimento==='SUPABASE_CANONICA_V1' ? (payload.movimento_ids || []) : [];
    const unidos=[...new Set([...idsAnteriores,...movimentoIds].map(Number).filter(Number.isInteger))];
    if (payload.identidade_movimento!=='SUPABASE_CANONICA_V1' || unidos.length !== (payload.movimento_ids || []).length) {
      payload.movimento_ids=unidos;
      payload.identidade_movimento='SUPABASE_CANONICA_V1';
      db.prepare('UPDATE jobs_carteira SET payload=? WHERE id=?').run(JSON.stringify(payload),ativo.id);
      if (supabase.configurado()) {
        const { error }=await supabase.admin().from('jobs_carteira').update({ payload }).eq('id',ativo.id).eq('status','PENDENTE');
        if (error) throw new Error(`Atualização da fila incremental: ${error.message}`);
      }
    }
    // Um cache local pode sobreviver ao reinício enquanto o job remoto foi
    // concluído, cancelado ou nunca chegou à fila. Espelhar de novo é
    // idempotente no RPC e impede que uma solicitação fique "deduplicada"
    // apenas no SQLite, sem trabalho disponível ao worker do Render.
    const remoto = await fila.espelharJob({ ...ativo, payload:JSON.stringify(payload) });
    if (String(remoto?.id || ativo.id) !== String(ativo.id)) db.prepare("UPDATE jobs_carteira SET status='CANCELADO',finalizado_em=?,erro=? WHERE id=? AND status IN ('PENDENTE','PROCESSANDO')")
      .run(new Date().toISOString(),`Deduplicado pelo job canônico ${remoto.id}.`,ativo.id);
    iniciarConsumidorContingencia(ativo.processamento_id, opcoes.iniciarWorker !== false);
    return { processamento_id:ativo.processamento_id, deduplicado:true, job:{ ...ativo, ...remoto, payload:JSON.stringify(payload) }, movimento_ids:unidos };
  }
  const processamento = await fila.iniciar({ empresas:[Number(empresaId)], competencia:ano, tipo:TIPO_INCREMENTAL, prioridade:10,
    payload:{ ano:Number(ano), movimento_ids:movimentoIds, identidade_movimento:'SUPABASE_CANONICA_V1', modo:'INCREMENTAL_IDS_EXPLICITOS' }, iniciarWorker:false });
  const job = (processamento.jobs || []).find((x) => Number(x.empresa_id) === Number(empresaId) && x.tipo_job === TIPO_INCREMENTAL) || null;
  iniciarConsumidorContingencia(processamento.id, opcoes.iniciarWorker !== false);
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
    FROM jobs_carteira WHERE empresa_id=? AND tipo_job IN (?,?)
    ORDER BY CASE WHEN status IN ('PENDENTE','PROCESSANDO') THEN 0 WHEN status='FALHOU' THEN 2 ELSE 1 END, criado_em DESC LIMIT 1`).get(empresaId, TIPO, TIPO_INCREMENTAL);
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
      .in('status',['PENDENTE','PROCESSANDO']).order('criado_em', { ascending: false }).limit(1);
    if (error) throw new Error(`Status compartilhado do motor: ${error.message}`);
    job = data?.[0] || null;
    if (!job) {
      const { data: historico, error: erroHistorico } = await supabase.admin().from('jobs_carteira')
        .select('id,empresa_id,competencia,tipo_job,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em')
        .eq('empresa_id', Number(empresaId)).in('tipo_job', [TIPO, TIPO_INCREMENTAL])
        .order('criado_em', { ascending: false }).limit(1);
      if (erroHistorico) throw new Error(`Status compartilhado do motor: ${erroHistorico.message}`);
      job = historico?.[0] || null;
    }
  }
  if (!job) job = statusLocal(empresaId);
  if (!job) return null;
  const foto = staging.consultar(job.id);
  const resultado = json(job.resultado);
  return { ...job, resultado, staging: foto,
    estado: job.status, etapas: etapas(job, null) };
}

module.exports = { TIPO, TIPO_INCREMENTAL, solicitar, solicitarIncremental, status, etapas };
