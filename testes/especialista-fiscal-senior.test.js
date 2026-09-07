const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-especialista-fiscal-'));
const db = require('../src/db');
const ia = require('../src/services/ia');
const rag = require('../src/services/rag');
const especialista = require('../src/services/especialistaFiscalSenior');

const empresa = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social,regime) VALUES ('12345678000190','Empresa teste','lucro_presumido')").run().lastInsertRowid);
const configOriginal = ia.config;
const chamarOriginal = ia.chamar;
const ragOriginal = rag.montarContexto;

(async () => {
  ia.salvarConfig({ modelo: 'teste', especialista_fiscal_ativo: true });
  assert.equal(ia.config().especialistaFiscalAtivo, true);
  ia.salvarConfig({ modelo: 'teste', especialista_fiscal_ativo: false });
  assert.equal(ia.config().especialistaFiscalAtivo, false);
  ia.config = () => ({ ativo: false, especialistaFiscalAtivo: false, modelo: 'teste' });
  await assert.rejects(() => especialista.perguntar({ pergunta: 'Como analisar CBS?', empresaId: empresa }), /desligado/);

  ia.config = () => ({ ativo: true, especialistaFiscalAtivo: true, modelo: 'teste' });
  ia.chamar = async () => ({ texto: 'Conclusão técnica\n[F1] Regra consultiva.', uso: { input_tokens: 1 } });
  rag.montarContexto = () => ({ texto: '[F1] Fonte oficial\nTrecho certificado', trechos: [{ marcador: 'F1', titulo: 'Fonte oficial', fonte: 'https://fonte.gov.br' }] });
  const r = await especialista.perguntar({ pergunta: 'Como analisar CBS?', empresaId: empresa, usuarioId: 'usuario' });
  assert.equal(r.fontes.length, 1);
  assert.equal(especialista.historico({ empresaId: empresa }).length, 1);
  assert.match(db.prepare('SELECT resposta FROM especialista_fiscal_interacoes WHERE id=?').get(r.id).resposta, /Conclusão/);
  console.log('especialista-fiscal-senior: chave de ativação, resposta fundamentada e auditoria validadas');
})().finally(() => {
  ia.config = configOriginal; ia.chamar = chamarOriginal; rag.montarContexto = ragOriginal;
  db.close(); fs.rmSync(process.env.SATTVA_DADOS, { recursive: true, force: true });
});
