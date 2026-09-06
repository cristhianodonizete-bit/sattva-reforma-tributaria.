require('dotenv').config();
const path = require('path');
const express = require('express');
const compression = require('compression');
const autenticacao = require('./src/services/autenticacao');
const supabase = require('./src/services/supabase');
const performanceTelemetry = require('./src/services/performanceTelemetry');

const app = express();
// O processo HTTP não deve aguardar uma carga-base remota para abrir a porta.
// Em uma instância sem fotografia local, as APIs operacionais ficam
// temporariamente indisponíveis (503) até a sincronização íntegra terminar;
// isto evita entregar uma carteira vazia ou disparar cálculo sobre base parcial.
const estadoOperacao = {
  ativa: false,
  pronta: false,
  possuiBaseLocal: false,
  sincronizando: false,
  erro: null,
};
// Plataformas como Render fornecem a porta em PORT; PORTA mantém a execução
// local compatível com a configuração já usada no Windows.
const PORTA = process.env.PORT || process.env.PORTA || 3200;

// Respostas de leitura com muitos itens (cadeias e auditorias) são JSON e
// podem ultrapassar alguns megabytes. A compressão é transparente: não muda
// o conteúdo, os cálculos nem qualquer dado persistido.
app.use(compression());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', require('./src/routes/auth'));
app.use('/api', (_req, res, next) => {
  if (!estadoOperacao.ativa || estadoOperacao.pronta || estadoOperacao.possuiBaseLocal) return next();
  return res.status(503).json({
    ok: false,
    erro: 'Base operacional em sincronização inicial. Tente novamente em instantes.',
    codigo: 'BASE_OPERACIONAL_INDISPONIVEL',
  });
});
app.use('/api', autenticacao.validar, require('./src/routes/api'));

app.use((err, _req, res, _next) => {
  console.error('[erro]', err.message);
  res.status(500).json({ ok: false, erro: err.message });
});

// Após a carga inicial, roda o motor uma vez para que Classificações e
// Conformidade já apareçam preenchidas. As demais telas calculam ao vivo.
function prepararMotor() {
  try {
    const db = require('./src/db');
    // dimensões da simulação de cadeia: semeadas com o banco já pronto
    if (db.prepare('SELECT COUNT(*) c FROM cenario_dimensoes').get().c === 0) {
      require('./src/services/dimensoes').semear();
      console.log('  dimensões de cenário semeadas');
    }
    const temEmpresa = db.prepare('SELECT COUNT(*) c FROM empresas').get().c;
    const temExecucao = db.prepare('SELECT COUNT(*) c FROM motor_execucoes').get().c;
    if (temEmpresa && !temExecucao) {
      const motorExec = require('./src/services/motorExec');
      const e = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
      const r = motorExec.executar(e.id, { ano: 2027 });
      console.log(`  motor executado: ${r.resumo.itens} itens projetados para 2033`);
    }
    // Nenhuma consulta cadastral é disparada na inicialização. Consultas de
    // CNPJ/QSA são decisões explícitas do operador, nunca efeito colateral de
    // reinício, importação ou reprocessamento.
  } catch (e) { console.error('  motor não pôde ser executado na inicialização:', e.message); }
}

function possuiBaseOperacionalLocal() {
  try {
    const db = require('./src/db');
    return Number(db.prepare('SELECT COUNT(*) AS total FROM empresas').get()?.total || 0) > 0;
  } catch (_) {
    return false;
  }
}

async function iniciarOperacao() {
  let sincronizacaoConcluida = false;
  try {
    const operacao = require('./src/services/operacaoCompartilhada');
    if (operacao.ativo()) {
      estadoOperacao.ativa = true;
      estadoOperacao.possuiBaseLocal = possuiBaseOperacionalLocal();
      estadoOperacao.sincronizando = true;
      let dados = {};
      try {
        dados = await operacao.sincronizarIncremental();
        sincronizacaoConcluida = true;
      }
      catch (e) {
        estadoOperacao.erro = e.message;
        console.error('  sincronização operacional incremental falhou:', e.message);
      }
      try { await operacao.baixarRegrasEnquadramento(); }
      catch (e) { console.error('  sincronização de regras condicionais falhou:', e.message); }
      const intervaloRegras = setInterval(() => operacao.baixarRegrasEnquadramento()
        .catch((e) => console.error('  atualização de regras condicionais falhou:', e.message)), 60_000);
      intervaloRegras.unref?.();
      // Na primeira instalação há uma carga-base completa; nos reinícios
      // seguintes, somente eventos posteriores ao marco local são aplicados.
      console.log(`  operação compartilhada carregada: ${JSON.stringify(dados)}`);
      const db = require('./src/db');
      const bases = require('./src/services/basesReforma');
      const motorExec = require('./src/services/motorExec');
      const baseRegime = require('./src/services/baseRegimeReceita');
      for (const empresa of db.prepare('SELECT id FROM empresas').all()) {
        // Reiniciar o Render não é uma alteração fiscal. Portanto, não pode
        // disparar recálculo de toda a carteira. Uma importação, mudança de
        // regra ou recálculo explícito já agenda a execução correspondente.
        const existeResultado = db.prepare('SELECT 1 FROM motor_resultados WHERE empresa_id=? LIMIT 1').get(empresa.id);
        if (existeResultado) continue;
        // Somente empresas ainda sem fotografia materializada são preparadas
        // na inicialização. Isso preserva capacidade para centenas de empresas.
        const refinamento = await baseRegime.refinarParceiros(empresa.id);
        bases.classificarMovimentos(empresa.id);
        motorExec.executar(empresa.id, { ano: 2027 });
        console.log(`  primeira execução da empresa ${empresa.id}: ${refinamento.refinados} parceiro(s) refinado(s)`);
      }
      console.log('  resultados CBS preservados; somente empresas sem execução foram processadas');
      // Jobs sobrevivem a reinícios: recupera claims abandonados e retoma a fila
      // durável sem depender da memória da instância anterior do Render.
      const fila = require('./src/services/processamentoCarteira');
      await fila.recuperarAbandonados();
      fila.executar().catch((e) => console.error('  fila de carteira:', e.message));
    }
  } catch (e) {
    estadoOperacao.erro = e.message;
    console.error('  não foi possível carregar a operação compartilhada:', e.message);
  } finally {
    // Uma falha de sincronização sem fotografia local não pode liberar uma
    // base vazia como se estivesse pronta.
    estadoOperacao.pronta = !estadoOperacao.ativa || sincronizacaoConcluida;
    estadoOperacao.sincronizando = false;
    if (estadoOperacao.pronta || estadoOperacao.possuiBaseLocal) prepararMotor();
  }
}

function iniciar() {
  // Define a guarda antes de expor a porta. Assim, uma requisição que chegue
  // no primeiro milissegundo do processo não observa uma base ainda vazia.
  try {
    const operacao = require('./src/services/operacaoCompartilhada');
    estadoOperacao.ativa = operacao.ativo();
    estadoOperacao.possuiBaseLocal = estadoOperacao.ativa && possuiBaseOperacionalLocal();
  } catch (e) {
    estadoOperacao.erro = e.message;
  }
  app.listen(PORTA, () => {
    console.log('');
    console.log('  ███  SATTVA — IMPLEMENTAÇÃO DA REFORMA TRIBUTÁRIA');
    console.log('  ---------------------------------------------------');
    console.log(`  Sistema no ar em http://localhost:${PORTA}`);
    console.log(`  Banco de dados: ${process.env.SATTVA_DADOS || path.join(__dirname, 'dados')}`);
    console.log('  sincronização operacional iniciada em segundo plano');
    console.log('');
  });
  setInterval(() => {
    if (supabase.configurado()) performanceTelemetry.persistir(supabase.admin()).catch((e) => console.error('  telemetria de performance:', e.message));
  }, 60_000).unref();
  // Não aguardar: Render pode considerar a instância indisponível enquanto a
  // primeira carga-base baixa dezenas de coleções.
  iniciarOperacao().catch((e) => console.error('  inicialização operacional não concluída:', e.message));
}
iniciar();
