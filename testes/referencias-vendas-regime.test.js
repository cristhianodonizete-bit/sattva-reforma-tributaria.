const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-referencias-regime-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
require('../src/services/operacaoCompartilhada').publicar = async () => ({ publicado:false, teste:true });
const router = require('../src/routes/api');

async function executar() {
  const app = express(); app.use(express.json()); app.use(router);
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const criarEmpresa = (regime, cnpj) => Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)')
    .run(cnpj, `Empresa ${regime}`, regime).lastInsertRowid);
  const criarServico = (empresaId) => db.prepare(`INSERT INTO movimentos
    (empresa_id,tipo,documento,competencia,descricao,valor,nbs,lc116,origem,modelo_documento_fiscal)
    VALUES (?,'cliente','1','2026-07','Serviço regular',1000,'115013000','0107','planilha','nfse')`)
    .run(empresaId);
  const obter = async (empresaId) => {
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/empresas/${empresaId}/referencias-vendas`);
    assert.equal(r.status, 200);
    const corpo = await r.json(); assert.equal(corpo.ok, true); return corpo;
  };
  try {
    for (const [indice, [regime, esperado]] of [['simples_nacional', 2.5], ['lucro_presumido', 3.65], ['lucro_real', 9.25]].entries()) {
      const empresaId = criarEmpresa(regime, `00000000000${indice + 1}`.padEnd(14, '0'));
      criarServico(empresaId);
      const resposta = await obter(empresaId);
      assert.equal(resposta.pendentes.length, 0, `${regime} não pode exigir referência individual`);
      assert.equal(resposta.servicos.length, 0, `${regime} não pode aparecer na lista de exceções`);
      assert.equal(resposta.resumo_cobertura.regra_geral, 1);
      assert.equal(Number(resposta.resumo_cobertura.aliquota_regra_geral), esperado);
    }
  } finally {
    await new Promise((resolve, reject) => servidor.close((e) => e ? reject(e) : resolve()));
    db.close(); fs.rmSync(pasta, { recursive:true, force:true });
  }
  console.log('referências de vendas: regra geral do regime sem pendência individual: OK');
}

executar().catch((e) => { console.error(e); process.exitCode = 1; });
