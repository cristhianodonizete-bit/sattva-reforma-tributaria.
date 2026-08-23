require('dotenv').config();
const path = require('path');
const express = require('express');
const autenticacao = require('./src/services/autenticacao');

const app = express();
// Plataformas como Render fornecem a porta em PORT; PORTA mantém a execução
// local compatível com a configuração já usada no Windows.
const PORTA = process.env.PORT || process.env.PORTA || 3200;

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/auth', require('./src/routes/auth'));
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
      const r = motorExec.executar(e.id, { ano: 2033 });
      console.log(`  motor executado: ${r.resumo.itens} itens projetados para 2033`);
    }
    // Cadastro novo ou pendente é enriquecido em segundo plano: não bloqueia
    // a abertura do sistema nem exige que o consultor lembre de uma ação.
    const empresas = db.prepare('SELECT id FROM empresas').all();
    const receita = require('./src/services/cnpjReceita');
    for (const empresa of empresas) {
      const pendentes = db.prepare(`SELECT COUNT(*) c FROM parceiros
        WHERE empresa_id = ? AND cnpj <> '' AND (regime IS NULL OR regime = '' OR regime = 'indeterminado')`).get(empresa.id).c;
      if (pendentes) {
        receita.agendarEnriquecimento(empresa.id);
        console.log(`  ${pendentes} CNPJ(s) pendentes enviados ao enriquecimento automático`);
      }
    }
  } catch (e) { console.error('  motor não pôde ser executado na inicialização:', e.message); }
}

async function iniciar() {
  try {
    const operacao = require('./src/services/operacaoCompartilhada');
    if (operacao.ativo()) {
      const dados = await operacao.baixar();
      console.log(`  operação compartilhada carregada: ${JSON.stringify(dados)}`);
      const db = require('./src/db');
      const bases = require('./src/services/basesReforma');
      const motorExec = require('./src/services/motorExec');
      const baseRegime = require('./src/services/baseRegimeReceita');
      for (const empresa of db.prepare('SELECT id FROM empresas').all()) {
        // A RFB é consultada diretamente no Supabase. Assim, a classificação
        // Real/Presumido não depende do disco efêmero do Render nem de ação
        // manual depois de uma nova publicação.
        const refinamento = await baseRegime.refinarParceiros(empresa.id);
        bases.classificarMovimentos(empresa.id);
        motorExec.executar(empresa.id, { ano: 2033 });
        console.log(`  RFB compartilhada: empresa ${empresa.id}, ${refinamento.refinados} parceiro(s) refinado(s)`);
      }
      console.log('  classificações IBS/CBS recalculadas a partir das bases compartilhadas');
    }
  } catch (e) {
    console.error('  não foi possível carregar a operação compartilhada:', e.message);
  }
  app.listen(PORTA, () => {
  console.log('');
  console.log('  ███  SATTVA — IMPLEMENTAÇÃO DA REFORMA TRIBUTÁRIA');
  console.log('  ---------------------------------------------------');
  console.log(`  Sistema no ar em http://localhost:${PORTA}`);
  console.log(`  Banco de dados: ${process.env.SATTVA_DADOS || path.join(__dirname, 'dados')}`);
  prepararMotor();
  console.log('');
  });
}
iniciar();
