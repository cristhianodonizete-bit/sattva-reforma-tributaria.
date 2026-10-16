/** Fila durável da carteira: Supabase é a fonte de verdade do job. */
const crypto = require('crypto');
const db = require('../db');
const supabase = require('./supabase');
const bases = require('./basesReforma');
const motorExec = require('./motorExec');
const excecoesMotor = require('./excecoesMotor');
const motorStaging = require('./motorStaging');
const { exigePublicacaoFotografia } = require('./tipoProcessamentoMotor');
const lotesIncrementais = require('./lotesIncrementais');
const integridadeMotor = require('./integridadeMotor');

// Parâmetros de referência não podem nascer dentro de uma execução depois da
// assinatura da entrada. A matriz do Anexo XI era inicializada sob demanda na
// calculadora, alterando a própria fonte durante o primeiro job e fazendo a
// verificação de integridade descartar uma fotografia correta.
function prepararParametrosEstaveisMotor() {
  require('./elegibilidadeAnexoXi').garantirMatrizLocal();
}

const workerId = `${process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || 'local'}-${process.pid}`;
const id = () => crypto.randomUUID();
const agora = () => new Date().toISOString();
const proximaTentativa = (tentativas) => new Date(Date.now() + Math.min(60_000, 1_000 * (2 ** Math.max(0, Number(tentativas) - 1)))).toISOString();
// Cálculo fiscal pode carregar milhares de itens. Um job por vez é o padrão
// conservador para a instância de 512 MB; aumento de concorrência é decisão
// explícita de capacidade, nunca efeito de um deploy.
const concorrencia = () => Math.max(1, Math.min(8, Number(process.env.PROCESSAMENTO_CARTEIRA_CONCORRENCIA) || 1));

async function espelharJob(job) {
  if (!supabase.configurado()) return job;
  const empresaLocal=db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(job.empresa_id));
  if (!empresaLocal) throw new Error('Empresa local do job não encontrada.');
  const cnpj=String(empresaLocal.cnpj||'').replace(/\D/g,'');
  const { data:empresas,error:erroEmpresa }=await supabase.admin().from('empresas').select('id,origem_local_id,cnpj')
    .or(`origem_local_id.eq.${Number(empresaLocal.id)},cnpj.eq.${cnpj}`).limit(3);
  if(erroEmpresa) throw new Error(`Empresa compartilhada do job: ${erroEmpresa.message}`);
  const empresaRemota=(empresas||[]).find((x)=>Number(x.origem_local_id||x.id)===Number(empresaLocal.id)
    || String(x.cnpj||'').replace(/\D/g,'')===cnpj);
  if(!empresaRemota) throw new Error('Empresa compartilhada do job não localizada.');
  // processamento_id organiza a execução somente no SQLite da instância. Ele
  // pode voltar a 1 após um reinício e, por isso, não é identidade global; o
  // UUID do job é a chave durável usada no Supabase.
  const payload=JSON.parse(job.payload || '{}');
  // A função canônica faz insert-or-merge sob o mesmo lock do índice parcial.
  // Assim, duas instâncias nunca transformam uma dupla solicitação em erro de
  // chave única; o segundo pedido incorpora seus IDs ao job ativo.
  const remotoApi=supabase.admin();
  const { data:existente,error:erroExistente }=await remotoApi.from('jobs_carteira')
    .select('id,status,payload').eq('id',job.id).maybeSingle();
  if (erroExistente) throw new Error(`Consulta do job compartilhado: ${erroExistente.message}`);
  // Cache local pode sobreviver a um job remoto terminal. Esse UUID não pode
  // ser reaproveitado: a retomada cria outro job e preserva o histórico.
  const jobPublicavel=existente && !['PENDENTE','PROCESSANDO'].includes(String(existente.status))
    ? { ...job,id:id(),criado_em:agora() } : job;
  if (existente && ['PENDENTE','PROCESSANDO'].includes(String(existente.status))) {
    const anterior=JSON.parse(existente.payload || '{}');
    const ids=[...new Set([...(anterior.movimento_ids || []),...(payload.movimento_ids || [])].map(Number).filter(Number.isInteger))];
    const payloadUnido={ ...anterior,...payload,movimento_ids:ids,identidade_movimento:'SUPABASE_CANONICA_V1' };
    const { data:atualizado,error:erroAtualizar }=await remotoApi.from('jobs_carteira').update({ payload:payloadUnido })
      .eq('id',existente.id).in('status',['PENDENTE','PROCESSANDO']).select('*').maybeSingle();
    if (erroAtualizar) throw new Error(`Atualização do job compartilhado: ${erroAtualizar.message}`);
    if (atualizado) return atualizado;
  }
  const { data:enfileirado,error:erroEnfileirar }=await remotoApi.rpc('enfileirar_job_carteira',{ 
    p_id:jobPublicavel.id,p_processamento_id:jobPublicavel.processamento_id,p_grupo_id:jobPublicavel.grupo_id,
    p_empresa_id:Number(empresaRemota.id),p_competencia:job.competencia,p_tipo_job:job.tipo_job,
    p_prioridade:jobPublicavel.prioridade,p_payload:payload,p_criado_em:jobPublicavel.criado_em,
  });
  if (!erroEnfileirar) return Array.isArray(enfileirado) ? (enfileirado[0] || jobPublicavel) : (enfileirado || jobPublicavel);
  // Compatibilidade durante a implantação: se a migration ainda não chegou,
  // não expomos colisão de job à tela. Reutilizamos o ativo remoto existente.
  const { error } = await remotoApi.from('jobs_carteira').upsert({ ...jobPublicavel, empresa_id:Number(empresaRemota.id),payload }, { onConflict: 'id' });
  if (!error) return jobPublicavel;
  if (!/ux_jobs_carteira_ativo|duplicate key|23505/i.test(String(error.message || ''))) throw new Error(`Fila Supabase: ${error.message}`);
  const { data:ativos,error:erroAtivos }=await supabase.admin().from('jobs_carteira')
    .select('*').eq('empresa_id',Number(empresaRemota.id)).eq('competencia',job.competencia).eq('tipo_job',job.tipo_job)
    .in('status',['PENDENTE','PROCESSANDO']).order('criado_em',{ascending:false}).limit(1);
  if (erroAtivos || !ativos?.[0]) throw new Error(`Fila Supabase: ${(erroAtivos || error).message}`);
  return ativos[0];
}

async function normalizarEmpresaJobRemoto(job,remotoApi){
  if(!job) return job;
  const { data:empresa,error }=await remotoApi.from('empresas').select('id,origem_local_id,cnpj').eq('id',Number(job.empresa_id)).maybeSingle();
  if(error) throw new Error(`Empresa do job remoto: ${error.message}`);
  if(!empresa) throw new Error(`Empresa canônica ${job.empresa_id} do job não encontrada.`);
  const origem=Number(empresa.origem_local_id);
  // O SQLite do worker é um cache efêmero e pode nascer sem nenhuma empresa.
  // Quando a fonte canônica informa origem_local_id, esse é o identificador
  // usado para hidratar a empresa antes do cálculo; a linha não precisa existir.
  let empresaLocalId=Number.isInteger(origem)&&origem>0 ? origem : null;
  if(!empresaLocalId){
    const cnpj=String(empresa.cnpj||'').replace(/\D/g,'');
    const local=db.prepare(`SELECT id FROM empresas WHERE REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(cnpj,''),'.',''),'/',''),'-',''),' ','')=?`).get(cnpj);
    empresaLocalId=Number(local?.id)||null;
  }
  if(!empresaLocalId) throw new Error(`Empresa local do job canônico ${job.empresa_id} não pôde ser identificada.`);
  return { ...job,empresa_id:empresaLocalId,empresa_remota_id:Number(empresa.id) };
}

async function iniciar(opcoes = {}) {
  const empresas = opcoes.empresas || db.prepare('SELECT id FROM empresas ORDER BY id').all().map((x) => x.id);
  const competencia = String(opcoes.competencia || '2027');
  const tipo = opcoes.tipo || 'RECALCULO_INCREMENTAL';
  const grupoId = String(opcoes.grupo_id || id());
  // A mesma empresa/competência/tipo não pode receber dois jobs ativos. Se
  // já existir, o pedido apenas reaproveita o processamento em curso.
  const ativo = empresas.map((empresaId) => db.prepare(`SELECT * FROM jobs_carteira
    WHERE empresa_id=? AND competencia=? AND tipo_job=? AND status IN ('PENDENTE','PROCESSANDO')`).get(empresaId, competencia, tipo)).filter(Boolean);
  if (ativo.length === empresas.length && ativo.length) {
    const processamento = consultarLocal(ativo[0].processamento_id);
    return { ...(processamento || {}), grupo_id: ativo[0].grupo_id || null, deduplicado: true, jobs: ativo };
  }
  const cab = db.prepare(`INSERT INTO processamentos_carteira (grupo_id,tipo,status,total_empresas,iniciado_em)
    VALUES (? ,?,'AGENDADO',?,datetime('now','localtime'))`).run(grupoId, tipo, empresas.length);
  const processamentoId = Number(cab.lastInsertRowid);
  const inserirItem = db.prepare("INSERT INTO processamentos_carteira_itens (processamento_id,empresa_id,status) VALUES (?,?,'AGENDADA')");
  const inserirJob = db.prepare(`INSERT INTO jobs_carteira (id,processamento_id,grupo_id,empresa_id,competencia,tipo_job,prioridade,status,payload,criado_em)
    VALUES (?,?,?,?,?,?,?, 'PENDENTE',?,?)`);
  const jobs = empresas.filter((empresaId) => !ativo.some((j) => Number(j.empresa_id) === Number(empresaId))).map((empresaId) => ({ id: id(), processamento_id: processamentoId, grupo_id: grupoId, empresa_id: empresaId,
    competencia, tipo_job: tipo, prioridade: Number(opcoes.prioridade) || 0,
    status: 'PENDENTE', tentativas: 0, max_tentativas: 3, payload: JSON.stringify(opcoes.payload || { incremental: true }), criado_em: agora() }));
  db.transaction(() => jobs.forEach((j) => { inserirItem.run(processamentoId, j.empresa_id); inserirJob.run(j.id, j.processamento_id, j.grupo_id, j.empresa_id, j.competencia, j.tipo_job, j.prioridade, j.payload, j.criado_em); }))();
  for (const job of jobs) {
    const remoto=await espelharJob(job);
    if (String(remoto?.id || job.id)!==String(job.id)) db.prepare("UPDATE jobs_carteira SET status='CANCELADO',finalizado_em=?,erro=? WHERE id=? AND status='PENDENTE'")
      .run(agora(),`Deduplicado pelo job canônico ${remoto.id}.`,job.id);
  }
  // O serviço HTTP apenas registra trabalho na fila durável. Consumir a fila
  // neste processo fazia um clique do usuário disputar CPU e memória com as
  // telas, além de tornar o resultado dependente da instância web atual. A
  // execução só é permitida por chamada explícita do processo worker (ou por
  // ferramentas locais de manutenção que optem por iniciarWorker=true).
  if (opcoes.iniciarWorker === true) executar(processamentoId).catch((e) => console.error('[fila carteira]', e.message));
  return { ...consultarLocal(processamentoId), grupo_id: grupoId };
}

async function recuperarAbandonados() {
  const limite = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  db.prepare("UPDATE jobs_carteira SET status='PENDENTE',worker_id=NULL,heartbeat=NULL,erro=COALESCE(erro || char(10),'') || 'Worker sem heartbeat; retomado.' WHERE status='PROCESSANDO' AND heartbeat<? AND tentativas<max_tentativas").run(limite);
  db.prepare("UPDATE jobs_carteira SET status='FALHOU',finalizado_em=?,erro=COALESCE(erro || char(10),'') || 'Máximo de tentativas.' WHERE status='PROCESSANDO' AND heartbeat<? AND tentativas>=max_tentativas").run(agora(), limite);
  if (supabase.configurado()) {
    const { error } = await supabase.admin().rpc('recuperar_jobs_carteira_abandonados', { p_minutos: 10 });
    if (error) throw new Error(`Recuperação da fila: ${error.message}`);
  }
}

async function claim(processamentoId = null) {
  if (supabase.configurado()) {
    // Um consumidor de contingência do Web conhece o processamento que acabou
    // de criar. Para ele, não usamos a RPC genérica (que poderia escolher
    // outro job); a atualização condicional abaixo continua sendo o claim
    // atômico na fonte compartilhada. O worker separado segue usando a RPC.
    const remotoApi = supabase.admin();
    let erroRpc = null;
    if (!processamentoId) {
      const { data, error } = await remotoApi.rpc('claim_job_carteira', { p_worker_id: workerId });
      erroRpc = error;
      if (!error && data?.length) {
        const remoto = data[0];
        db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=?,heartbeat=? WHERE id=?").run(workerId, remoto.tentativas, remoto.heartbeat, remoto.id);
        const normalizado=await normalizarEmpresaJobRemoto(remoto,remotoApi);
        return { ...normalizado, payload: JSON.stringify(remoto.payload || {}) };
      }
    }
    // Algumas versões da função RPC não enxergam imediatamente o job recém
    // publicado. Não deixamos a empresa presa na fila: o fallback faz uma
    // atualização condicional no próprio Supabase, que continua atômica entre
    // instâncias e só permite que uma delas assuma o mesmo UUID.
    const local = db.prepare(`SELECT * FROM jobs_carteira WHERE status='PENDENTE' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=?)${processamentoId ? ' AND processamento_id=?' : ''} ORDER BY prioridade DESC,criado_em LIMIT 1`).get(agora(), ...(processamentoId ? [processamentoId] : []));
    if (!local) {
      if (erroRpc) throw new Error(`Claim da fila: ${erroRpc.message}`);
      return null;
    }
    const momento = agora();
    const tentativa = Number(local.tentativas || 0) + 1;
    const { data: assumidos, error: erroFallback } = await remotoApi.from('jobs_carteira')
      .update({ status:'PROCESSANDO', worker_id:workerId, tentativas:tentativa, iniciado_em:local.iniciado_em || momento, heartbeat:momento })
      .eq('id', local.id).eq('status', 'PENDENTE').select('*');
    if (erroFallback) throw new Error(`Claim alternativo da fila: ${erroFallback.message}`);
    if (!assumidos?.length) return null;
    const assumido = assumidos[0];
    db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=?,iniciado_em=COALESCE(iniciado_em,?),heartbeat=? WHERE id=? AND status='PENDENTE'")
      .run(workerId, tentativa, momento, momento, local.id);
    const normalizado=await normalizarEmpresaJobRemoto(assumido,remotoApi);
    return { ...local,...normalizado,payload:JSON.stringify(assumido.payload||local.payload||{}) };
  }
  const job = db.prepare(`SELECT * FROM jobs_carteira WHERE status='PENDENTE' AND (proxima_tentativa_em IS NULL OR proxima_tentativa_em<=?)${processamentoId ? ' AND processamento_id=?' : ''} ORDER BY prioridade DESC,criado_em LIMIT 1`).get(agora(), ...(processamentoId ? [processamentoId] : []));
  if (!job) return null;
  db.prepare("UPDATE jobs_carteira SET status='PROCESSANDO',worker_id=?,tentativas=tentativas+1,iniciado_em=COALESCE(iniciado_em,?),heartbeat=? WHERE id=? AND status='PENDENTE'").run(workerId, agora(), agora(), job.id);
  return db.prepare('SELECT * FROM jobs_carteira WHERE id=?').get(job.id);
}

async function finalizar(job, status, erro = null, dados = {}) {
  const fim = agora();
  db.prepare('UPDATE jobs_carteira SET status=?,heartbeat=?,erro=?,resultado=?,finalizado_em=? WHERE id=?').run(status, fim, erro, JSON.stringify(dados || {}), fim, job.id);
  if (supabase.configurado()) {
    const { error } = await supabase.admin().from('jobs_carteira').update({ status, heartbeat: fim, erro, resultado: dados || {}, finalizado_em: fim }).eq('id', job.id);
    if (error) throw new Error(`Conclusão da fila: ${error.message}`);
  }
  const excecoes = dados.excecoes || { abertas: 0 };
  const statusItem = status === 'CONCLUIDO' ? (excecoes.abertas ? 'COM_EXCECOES' : 'AUTOMATICA') : 'BLOQUEADA';
  db.prepare("UPDATE processamentos_carteira_itens SET status=?,motivo=?,itens_processados=?,excecoes_abertas=?,concluido_em=datetime('now','localtime') WHERE processamento_id=? AND empresa_id=?")
    .run(statusItem, erro || (excecoes.abertas ? 'Casos enviados à Central de Exceções' : 'Processado automaticamente'), dados.itens || 0, excecoes.abertas || 0, job.processamento_id, job.empresa_id);
  const campo = status === 'CONCLUIDO' ? (excecoes.abertas ? 'com_excecoes' : 'automaticas') : 'bloqueadas';
  db.prepare(`UPDATE processamentos_carteira SET processadas=processadas+1, ${campo}=${campo}+1 WHERE id=?`).run(job.processamento_id);
}

// O processo pode ser encerrado pelo runtime antes de alcançar o catch (por
// exemplo, em OOM). Registrar a etapa antes de cada operação custosa preserva
// a causa operacional no job compartilhado sem depender de memória/log local.
async function registrarEtapaIncremental(job, payload, etapa, lote = null) {
  const atualizado={ ...(payload || {}), etapa, etapa_em:agora(), ...(lote == null ? {} : { lote_atual:lote }) };
  db.prepare('UPDATE jobs_carteira SET payload=?,heartbeat=? WHERE id=?').run(JSON.stringify(atualizado),agora(),job.id);
  if (supabase.configurado()) {
    const { error }=await supabase.admin().from('jobs_carteira').update({ payload:atualizado,heartbeat:agora() })
      .eq('id',job.id).eq('status','PROCESSANDO');
    if (error) throw new Error(`Checkpoint de etapa incremental: ${error.message}`);
  }
  return atualizado;
}

async function processarUm(processamentoId = null) {
  for (;;) {
    const job = await claim(processamentoId);
    if (!job) break;
    try {
      db.prepare('UPDATE jobs_carteira SET heartbeat=? WHERE id=?').run(agora(), job.id);
      if (exigePublicacaoFotografia(job.tipo_job)) {
        const payload = JSON.parse(job.payload || '{}');
        const cnpj = require('./cnpjReceita');
        const operacao = require('./operacaoCompartilhada');
        // A conferência de documentos, período, PGDAS/apurações e receitas é
        // pesada e pertence ao worker. Ela é restrita à empresa e à janela
        // analisada do job; a requisição HTTP apenas enfileira o pedido.
        const preparado = await require('./preparacaoMotor').preparar(job.empresa_id);
        // Em um worker recém-iniciado a empresa só existe no SQLite depois
        // da preparação. Criar o staging antes disso violava a FK e abortava
        // o job antes do cálculo; a fotografia ativa remota permanecia certa,
        // mas o trabalho nunca chegava ao motor.
        motorStaging.criar(job.id, job.empresa_id);
        motorStaging.atualizar(job.id, 'SINCRONIZANDO_CADASTRO');
        await cnpj.sincronizarConfirmacoesManuaisQsa(Number(job.empresa_id));
        // A fotografia candidata fica vinculada à entrada exata do cálculo.
        // Nada é promovido se qualquer fato, cadastro ou parâmetro mudar entre
        // este ponto e a publicação.
        prepararParametrosEstaveisMotor();
        const entradaMotor = integridadeMotor.assinarEntrada(job.empresa_id);
        motorStaging.atualizar(job.id, 'CALCULANDO');
        const resultado = motorExec.executar(job.empresa_id, { ano: Number(payload.ano) || Number(job.competencia) || 2027, anexoSimples: payload.anexo, publicarAssincrona: false });
        const execucao = motorExec.ultimaExecucao(job.empresa_id);
        const quantidade = resultado.resumo.itens;
        const resultadoMotor = integridadeMotor.assinarResultado(job.empresa_id, execucao.id);
        if (resultadoMotor.itens !== quantidade) throw new Error(`Integridade do motor: esperado ${quantidade} resultado(s), encontrado ${resultadoMotor.itens}.`);
        const entradaAntesDePublicar = integridadeMotor.assinarEntrada(job.empresa_id);
        integridadeMotor.exigirMesmaEntrada(entradaMotor, entradaAntesDePublicar);
        const integridadeAtiva = await operacao.integridadeFotografiaAtivaMotor(job.empresa_id);
        if (integridadeAtiva?.entrada?.assinatura === entradaMotor.assinatura
          && integridadeAtiva?.resultado?.assinatura !== resultadoMotor.assinatura) {
          throw new Error('Não determinismo detectado: a mesma fonte e as mesmas regras produziram uma saída diferente. A fotografia anterior foi preservada; a execução requer investigação.');
        }
        motorStaging.atualizar(job.id, 'PUBLICANDO', { execucao_id: execucao.id, quantidade_esperada: quantidade, resumo: resultado.resumo });
        const publicacao = await operacao.publicarResultadosMotor(job.empresa_id, {
          ativar: false, execucao_id: execucao.id, quantidade_esperada: quantidade,
          integridade: { entrada:entradaMotor, resultado:resultadoMotor },
        });
        // O resultado é publicado com o id da empresa compartilhada. Em
        // instalações em que este difere do id local, promover com o id local
        // encontrava zero itens e descartava uma fotografia já gravada.
        const empresaFotografia = Number(publicacao.empresa_remota_id || job.empresa_id);
        const execucaoFotografia = Number(publicacao.execucao_id);
        const entradaAntesDePromover = integridadeMotor.assinarEntrada(job.empresa_id);
        integridadeMotor.exigirMesmaEntrada(entradaMotor, entradaAntesDePromover);
        await operacao.promoverFotografiaMotor(empresaFotografia, execucaoFotografia, quantidade);
        await operacao.validarFotografiaAtivaMotor(empresaFotografia, execucaoFotografia, quantidade);
        motorStaging.atualizar(job.id, 'CONCLUIDO');
        await finalizar(job, 'CONCLUIDO', null, { itens: quantidade, execucao_id: execucao.id, periodo: preparado.periodo, reconciliacao_documental: {
          movimentos: preparado.reconciliacao.inseridos_ou_atualizados, removidos: preparado.reconciliacao.removidos, origem: preparado.reconciliacao.origem,
        }, excecoes: excecoesMotor.resumo(job.empresa_id),
        // Métrica observacional; não é usada para promover fotografia nem para
        // decidir classificação. Ela torna o experimento consultável no
        // acompanhamento durável do próprio job.
        telemetria_reuso_classificacao: resultado.resumo.telemetria_reuso_classificacao });
        continue;
      }
      if (job.tipo_job === 'MOTOR_INCREMENTAL') {
        let payload = JSON.parse(job.payload || '{}');
        const solicitados = [...new Set((payload.movimento_ids || []).map(Number).filter(Number.isInteger))];
        if (!solicitados.length) throw new Error('Job incremental sem lançamentos explícitos.');
        const operacao = require('./operacaoCompartilhada');
        const tamanhoLote=Math.max(25,Math.min(250,Number(process.env.MOTOR_INCREMENTAL_LOTE_ITENS)||100));
        const lotes=lotesIncrementais.dividir(solicitados,tamanhoLote);
        let proximo=Math.max(0,Math.min(lotes.length,Number(payload.proximo_lote)||0));
        let ultimaPromovida=null; let ultimaExecucao=null;
        for (;proximo<lotes.length;proximo++) {
          const lote=lotes[proximo];
          // O worker recompõe e calcula somente um lote por vez. Cada promoção
          // produz uma fotografia completa e válida; o checkpoint no payload
          // permite retomar no lote seguinte após reinício sem repetir os já
          // confirmados nem manter todo o delta no heap.
          payload=await registrarEtapaIncremental(job,payload,'PREPARANDO_CONTEXTO',proximo+1);
          await operacao.prepararContextoMotorIncremental(job.empresa_id,lote);
          payload=await registrarEtapaIncremental(job,payload,'ASSINANDO_ORIGEM',proximo+1);
          prepararParametrosEstaveisMotor();
          const entradaMotor=integridadeMotor.assinarEntrada(job.empresa_id,{ movimentoIds:lote });
          payload=await registrarEtapaIncremental(job,payload,'CALCULANDO_DELTA',proximo+1);
          const resultado=motorExec.reprocessarIncremental(job.empresa_id,{ ano:Number(payload.ano)||Number(job.competencia)||2027,movimentoIds:lote });
          if (Number(resultado.reprocessados)!==lote.length) throw new Error('Execução incremental incompleta; a fotografia anterior foi preservada.');
          const execucao=motorExec.ultimaExecucao(job.empresa_id);
          if (!execucao?.id) throw new Error('Execução incremental não materializou uma execução local.');
          const resultadoMotor=integridadeMotor.assinarResultado(job.empresa_id,execucao.id,{movimentoIds:lote});
          const quantidadeProduzida=Number(resultado.resultado?.entradas?.length||0)+Number(resultado.resultado?.saidas?.length||0);
          if (resultadoMotor.itens!==quantidadeProduzida) throw new Error('Integridade incremental: quantidade materializada diferente dos resultados produzidos pelo motor.');
          integridadeMotor.exigirMesmaEntrada(entradaMotor,integridadeMotor.assinarEntrada(job.empresa_id,{ movimentoIds:lote }));
          payload=await registrarEtapaIncremental(job,payload,'PUBLICANDO_CANDIDATA',proximo+1);
          const publicacao=await operacao.publicarResultadosMotor(job.empresa_id,{ ativar:false,execucao_id:execucao.id,quantidade_esperada:resultadoMotor.itens,movimento_ids:lote,
            integridade:{ entrada:entradaMotor,resultado:resultadoMotor,modo:'INCREMENTAL_IDS_EXPLICITOS',lote:proximo+1,total_lotes:lotes.length } });
          payload=await registrarEtapaIncremental(job,payload,'PROMOVENDO_FOTOGRAFIA',proximo+1);
          ultimaPromovida=await operacao.promoverFotografiaMotorIncremental(Number(publicacao.empresa_remota_id||job.empresa_id),Number(publicacao.execucao_id),resultadoMotor.itens,lote);
          await operacao.validarFotografiaAtivaMotor(Number(publicacao.empresa_remota_id||job.empresa_id),Number(publicacao.execucao_id),ultimaPromovida.quantidade);
          ultimaExecucao=publicacao.execucao_id;
          payload.proximo_lote=proximo+1; payload.total_lotes=lotes.length; payload.tamanho_lote=tamanhoLote;
          db.prepare('UPDATE jobs_carteira SET payload=?,heartbeat=? WHERE id=?').run(JSON.stringify(payload),agora(),job.id);
          if (supabase.configurado()) {
            const { error:erroProgresso }=await supabase.admin().from('jobs_carteira').update({ payload,heartbeat:agora() }).eq('id',job.id).eq('status','PROCESSANDO');
            if (erroProgresso) throw new Error(`Checkpoint incremental: ${erroProgresso.message}`);
          }
        }
        const excecoes = excecoesMotor.resumo(job.empresa_id);
        // A promoção terminou; somente agora a assinatura do resultado pode
        // ser marcada como vigente. Antes disso, a leitura permanece pendente.
        require('./projecoesMovimentos').reconciliar(db,job.empresa_id,solicitados);
        await operacao.publicarEstadosProjecoes(job.empresa_id,solicitados);
        await finalizar(job,'CONCLUIDO',null,{ itens:solicitados.length,movimento_ids:solicitados,modo:'INCREMENTAL_IDS_EXPLICITOS_EM_LOTES',
          lotes:lotes.length,tamanho_lote:tamanhoLote,execucao_id:ultimaExecucao,fotografia_itens:ultimaPromovida?.quantidade||null,excecoes });
        continue;
      }
      bases.classificarMovimentos(job.empresa_id);
      const resultado = motorExec.reprocessarIncremental(job.empresa_id, { ano: Number(job.competencia) || 2027 });
      const excecoes = excecoesMotor.resumo(job.empresa_id);
      await finalizar(job, 'CONCLUIDO', null, { itens: resultado.reprocessados, excecoes });
    } catch (e) {
      if (job.tipo_job === 'MOTOR_INCREMENTAL') {
        let ids=[]; try { ids=JSON.parse(job.payload || '{}').movimento_ids || []; } catch (_) { /* payload inválido já será registrado no job */ }
        require('./projecoesMovimentos').marcar(db,job.empresa_id,ids,'FALHOU',`Atualização incremental falhou: ${e.message}`,job.id);
        try { await require('./operacaoCompartilhada').publicarEstadosProjecoes(job.empresa_id,ids); }
        catch (erroEstado) { console.error('[projeção] não foi possível publicar estado de falha:', erroEstado.message); }
      }
      if (exigePublicacaoFotografia(job.tipo_job)) motorStaging.atualizar(job.id, 'FALHOU', { erro: e.message });
      const atual = db.prepare('SELECT tentativas,max_tentativas FROM jobs_carteira WHERE id=?').get(job.id) || job;
      const status = Number(atual.tentativas) < Number(atual.max_tentativas) ? 'PENDENTE' : 'FALHOU';
      const proxima = status === 'PENDENTE' ? proximaTentativa(atual.tentativas) : null;
      db.prepare('UPDATE jobs_carteira SET status=?,erro=?,heartbeat=?,proxima_tentativa_em=? WHERE id=?').run(status, e.message, agora(), proxima, job.id);
      if (supabase.configurado()) await supabase.admin().from('jobs_carteira').update({ status, erro: e.message, heartbeat: agora(), proxima_tentativa_em: proxima }).eq('id', job.id);
      if (status === 'FALHOU') await finalizar(job, 'FALHOU', e.message);
    }
  }
}

async function executar(processamentoId = null) {
  await recuperarAbandonados();
  await Promise.all(Array.from({ length: concorrencia() }, () => processarUm(processamentoId)));
  if (processamentoId) db.prepare("UPDATE processamentos_carteira SET status='CONCLUIDO',concluido_em=datetime('now','localtime') WHERE id=? AND processadas>=total_empresas").run(processamentoId);
}

async function cancelar(idJob) {
  const job = db.prepare("SELECT * FROM jobs_carteira WHERE id=? AND status IN ('PENDENTE','PROCESSANDO')").get(idJob);
  if (!job) return { cancelado: false, motivo: 'Job não encontrado ou já finalizado.' };
  db.prepare("UPDATE jobs_carteira SET status='CANCELADO',finalizado_em=?,erro='Cancelado pelo usuário.' WHERE id=?").run(agora(), idJob);
  if (supabase.configurado()) {
    const { error } = await supabase.admin().from('jobs_carteira').update({ status: 'CANCELADO', finalizado_em: agora(), erro: 'Cancelado pelo usuário.' }).eq('id', idJob).in('status', ['PENDENTE','PROCESSANDO']);
    if (error) throw new Error(`Cancelamento da fila: ${error.message}`);
  }
  return { cancelado: true, job_id: idJob };
}

function consultarLocal(idProcessamento) {
  const cabecalho = db.prepare('SELECT * FROM processamentos_carteira WHERE id=?').get(idProcessamento);
  if (!cabecalho) return null;
  const itens = db.prepare('SELECT * FROM processamentos_carteira_itens WHERE processamento_id=? ORDER BY id').all(idProcessamento);
  const jobs = db.prepare('SELECT * FROM jobs_carteira WHERE processamento_id=? ORDER BY prioridade DESC,criado_em').all(idProcessamento);
  return { ...cabecalho, itens, jobs };
}

const json = (valor, padrao = {}) => {
  if (valor === null || valor === undefined || valor === '') return padrao;
  return typeof valor === 'string' ? JSON.parse(valor) : valor;
};

function resumirGrupo(grupoId, jobs = []) {
  const normalizados = jobs.map((job) => ({ ...job, resultado: json(job.resultado) }));
  const total = normalizados.length;
  const emExecucao = normalizados.some((job) => job.status === 'PROCESSANDO');
  const pendentes = normalizados.some((job) => job.status === 'PENDENTE');
  const finalizados = normalizados.filter((job) => ['CONCLUIDO','FALHOU','CANCELADO'].includes(job.status));
  const comExcecoes = normalizados.filter((job) => job.status === 'CONCLUIDO' && Number(job.resultado?.excecoes?.abertas || 0) > 0);
  const automaticas = normalizados.filter((job) => job.status === 'CONCLUIDO' && Number(job.resultado?.excecoes?.abertas || 0) === 0);
  const bloqueadas = normalizados.filter((job) => ['FALHOU','CANCELADO'].includes(job.status));
  const status = emExecucao ? 'EXECUTANDO' : pendentes ? 'AGENDADO' : finalizados.length === total ? 'CONCLUIDO' : 'AGENDADO';
  const itens = normalizados.map((job) => ({
    empresa_id: job.empresa_id,
    status: job.status === 'CONCLUIDO' ? (Number(job.resultado?.excecoes?.abertas || 0) ? 'COM_EXCECOES' : 'AUTOMATICA') : job.status,
    motivo: job.erro || null,
    itens_processados: Number(job.resultado?.itens || 0),
    excecoes_abertas: Number(job.resultado?.excecoes?.abertas || 0),
    iniciado_em: job.iniciado_em || null,
    concluido_em: job.finalizado_em || null,
    job_id: job.id,
  }));
  return {
    id: null, grupo_id: grupoId, tipo: normalizados[0]?.tipo_job || null, status,
    total_empresas: total, processadas: finalizados.length, automaticas: automaticas.length,
    com_premissas: 0, com_excecoes: comExcecoes.length, bloqueadas: bloqueadas.length,
    iniciado_em: normalizados.map((job) => job.iniciado_em).filter(Boolean).sort()[0] || null,
    concluido_em: finalizados.length === total ? normalizados.map((job) => job.finalizado_em).filter(Boolean).sort().at(-1) || null : null,
    criado_em: normalizados.map((job) => job.criado_em).filter(Boolean).sort()[0] || null,
    itens, jobs: normalizados,
  };
}

async function consultarCompartilhado(grupoId) {
  if (!grupoId || !supabase.configurado()) return null;
  const { data, error } = await supabase.admin().from('jobs_carteira')
    .select('id,grupo_id,empresa_id,competencia,tipo_job,prioridade,status,tentativas,max_tentativas,erro,resultado,criado_em,iniciado_em,finalizado_em')
    .eq('grupo_id', grupoId).order('prioridade', { ascending: false }).order('criado_em', { ascending: true });
  if (error) throw new Error(`Acompanhamento compartilhado da fila: ${error.message}`);
  return data?.length ? resumirGrupo(grupoId, data) : null;
}

async function consultar(identificador) {
  const texto = String(identificador || '');
  const local = /^\d+$/.test(texto) ? consultarLocal(Number(texto)) : null;
  const grupoId = local?.grupo_id || (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(texto) ? texto : null);
  try {
    const compartilhado = await consultarCompartilhado(grupoId);
    return compartilhado || local;
  } catch (erro) {
    // Status é observabilidade. Uma indisponibilidade transitória não pode
    // transformar a tela de controle em erro 502, nem autoriza alterar jobs.
    console.error('[fila] acompanhamento compartilhado indisponível:', erro.message);
    return local;
  }
}

async function ultimo() {
  try {
    if (supabase.configurado()) {
      const { data, error } = await supabase.admin().from('jobs_carteira').select('grupo_id')
        .not('grupo_id', 'is', null).order('criado_em', { ascending: false }).limit(1);
      if (error) throw new Error(`Último processamento compartilhado: ${error.message}`);
      if (data?.[0]?.grupo_id) return consultarCompartilhado(data[0].grupo_id);
    }
  } catch (erro) {
    console.error('[fila] último processamento compartilhado indisponível:', erro.message);
  }
  const x = db.prepare('SELECT id FROM processamentos_carteira ORDER BY id DESC LIMIT 1').get();
  return x ? consultarLocal(x.id) : null;
}

module.exports = { iniciar, executar, recuperarAbandonados, consultar, ultimo, cancelar, claim, workerId, resumirGrupo, espelharJob };
