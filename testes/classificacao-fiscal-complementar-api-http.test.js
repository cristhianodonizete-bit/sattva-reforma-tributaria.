const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-cfc-api-'));
process.env.SATTVA_DADOS = pasta;
const db = require('../src/db');
// Este teste nunca publica: neutraliza a publicação assíncrona antes de carregar as rotas.
require('../src/services/operacaoCompartilhada').publicar = async () => ({ publicado:false, teste:true });
const router = require('../src/routes/api');
const identidade = require('../src/services/identidadeProduto');

async function executar() {
  const empresa = db.prepare("INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)").run('00000000000191', 'Empresa API').lastInsertRowid;
  const outra = db.prepare("INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)").run('00000000000192', 'Outra API').lastInsertRowid;
  const produto = identidade.resolver({ empresa_id:Number(empresa), tipo_origem:'CADASTRO', codigo_origem:'API-01', ncm:'30049099', descricao:'Produto API' });
  const produtoOutra = identidade.resolver({ empresa_id:Number(outra), tipo_origem:'CADASTRO', codigo_origem:'API-01', ncm:'30049099', descricao:'Produto outra API' });
  const app = express(); app.use(express.json()); app.use(router);
  const servidor = await new Promise((resolve) => { const s=app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const post = async (caminho, corpo) => {
    const resposta = await fetch(`http://127.0.0.1:${servidor.address().port}${caminho}`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(corpo) });
    return { status:resposta.status, corpo:await resposta.json() };
  };
  try {
    // criação individual sem código e com identidade interna.
    let r=await post(`/empresas/${empresa}/classificacao-fiscal-complementar/fatos`, { produto_empresa_id:produto.produto_empresa_id, fato:'importador', valor:'SIM', vigencia_inicio:'2026-01-01', vigencia_fim:'2026-12-31' });
    assert.equal(r.status,200); assert.equal(r.corpo.ok,true);
    // código divergente não substitui a identidade interna.
    r=await post(`/empresas/${empresa}/classificacao-fiscal-complementar/fatos`, { produto_empresa_id:produto.produto_empresa_id, codigo_produto:'DIVERGENTE', fato:'importador', valor:'NÃO', vigencia_inicio:'2027-01-01' });
    assert.equal(r.status,200);
    assert.equal(db.prepare('SELECT produto_empresa_id FROM empresa_produto_fiscal WHERE id=?').get(r.corpo.cadastro.id).produto_empresa_id,produto.produto_empresa_id);
    // produto de outra empresa e campo tributário são rejeitados.
    r=await post(`/empresas/${empresa}/classificacao-fiscal-complementar/fatos`, { produto_empresa_id:produtoOutra.produto_empresa_id, fato:'revendedor', valor:'SIM' });
    assert.equal(r.status,400); assert.match(r.corpo.erro,/não pertence/i);
    r=await post(`/empresas/${empresa}/classificacao-fiscal-complementar/fatos`, { produto_empresa_id:produto.produto_empresa_id, fato:'revendedor', valor:'SIM', cst_pis:'01' });
    assert.equal(r.status,400); assert.match(r.corpo.erro,/não pode ser alterado/i);
    // pendência e resposta são ancoradas pela pendência/produto interno, não pelo código recebido.
    r=await post(`/empresas/${empresa}/classificacao-fiscal-complementar/pendencias`, { produto_empresa_id:produto.produto_empresa_id, fato_faltante:'revendedor', familia_regra:'API', regra_id:'API-1' });
    assert.equal(r.status,200); const pendenciaId=r.corpo.pendencia.id;
    r=await post(`/empresas/${empresa}/classificacao-fiscal-complementar/pendencias/${pendenciaId}/responder`, { resposta:'SIM', codigo_produto:'DIVERGENTE', produto_empresa_id:produto.produto_empresa_id });
    assert.equal(r.status,200); assert.equal(r.corpo.status,'RESPONDIDA');
    assert.equal(db.prepare('SELECT revendedor FROM empresa_produto_fiscal WHERE produto_empresa_id=? ORDER BY id DESC LIMIT 1').get(produto.produto_empresa_id).revendedor,1);
  } finally {
    await new Promise((resolve,reject)=>servidor.close((e)=>e?reject(e):resolve()));
    db.close(); fs.rmSync(pasta,{recursive:true,force:true});
  }
  console.log('classificacao-fiscal-complementar API HTTP: 6 contratos aprovados');
}
executar().catch((e)=>{ console.error(e); process.exitCode=1; });
