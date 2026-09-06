const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-analista-ia-'));
process.env.SATTVA_DADOS = pasta;
const assistente = require('../src/services/analistaTributarioIa');

assert.equal(assistente.validarPergunta('Quais premissas alteram a recomendação?'), 'Quais premissas alteram a recomendação?');
assert.throws(() => assistente.validarPergunta('  '), /Digite uma pergunta/);
assert.throws(() => assistente.validarPergunta('x'.repeat(3001)), /3.000 caracteres/);

const contexto = assistente.contextoSeguro({
  analise:{ id:7, titulo:'Estudo', status:'EM_REVISAO' },
  snapshot:{ id:12, versao:2, dados:{ congelado_em:'2026-09-06T00:00:00Z', necessidades_coleta:[] } },
  empresas:[{ id:3, razao_social:'Cliente', regime:'lucro_real', cnpj:'nao-deve-ser-enviado' }],
  premissas:[{ campo:'estrategia_preco', valor:'MANTER_PRECO', origem:'PREMISSA_MANUAL', tipo:'MARGEM' }],
  resultados:[{ resultado:{ cenario:'lucro_real', status:'COMPLETO', confianca:'MEDIA', receita_total:1000, tributos_total:100,
    empresas:[{ empresa:{ id:3, nome:'Cliente', cnpj:'nao-deve-ser-enviado' }, resultado:{ status:'COMPLETO', tributos_estimados:100, pendencias:[] } }] } }],
});
assert.equal(contexto.estudo.snapshot_versao, 2);
assert.equal(contexto.resultados[0].empresas[0].resultado, undefined);
assert.equal(contexto.resultados[0].empresas[0].empresa.cnpj, undefined);
assert.equal(contexto.resultados[0].empresas[0].tributos_estimados, 100);

(async () => {
  const db = require('../src/db');
  const planejamento = require('../src/services/planejamentoTributario');
  const ia = require('../src/services/ia');
  const empresaId = Number(db.prepare('INSERT INTO empresas (cnpj,razao_social,regime) VALUES (?,?,?)').run('10000000000003', 'Cliente IA', 'simples_nacional').lastInsertRowid);
  const estudo = planejamento.criar({ titulo:'Estudo IA', empresa_ids:[empresaId], usuario_id:'usuario-teste' });
  planejamento.executar(estudo.analise.id, 'usuario-teste');
  const chamarOriginal = ia.chamar;
  ia.chamar = async () => ({ texto:'Resposta baseada na fotografia.', uso:{ input_tokens:10, output_tokens:5 } });
  try {
    const resposta = await assistente.perguntar(estudo.analise.id, 'Quais pendências existem?', 'usuario-teste');
    assert.equal(resposta.resposta, 'Resposta baseada na fotografia.');
    assert.equal(db.prepare('SELECT COUNT(*) total FROM planejamento_assistente_interacoes WHERE analise_id=?').get(estudo.analise.id).total, 1);
    assert.equal(db.prepare("SELECT COUNT(*) total FROM planejamento_eventos WHERE analise_id=? AND acao='assistant_consulted'").get(estudo.analise.id).total, 1);
  } finally {
    ia.chamar = chamarOriginal;
    db.close();
    fs.rmSync(pasta, { recursive:true, force:true });
  }
  console.log('analista-tributario-ia.test.js: OK');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
