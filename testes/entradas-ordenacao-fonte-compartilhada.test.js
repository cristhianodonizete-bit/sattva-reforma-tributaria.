const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');

const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-entradas-ordem-'));
process.env.SATTVA_DADOS = pasta;
process.env.SUPABASE_DB_URL = 'postgres://teste-local-sem-conexao';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://teste.invalid';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'teste';
process.env.LEITURA_DOCUMENTOS_COMPARTILHADA_ATIVA = 'true';
const db = require('../src/db');
require('../src/services/operacaoCompartilhada').publicar = async () => ({ publicado:false, teste:true });
const compartilhados = require('../src/services/documentosFiscaisCompartilhados');

// Fonte compartilhada simulada: ordena e pagina no "SQL", como a implementação real.
const remotos = [
  { referencia:'r-10', documento:'10', origem:'XML', valor:10, data_emissao:'2026-03-01', competencia:'2026-03', item_id:1 },
  { referencia:'r-30', documento:'30', origem:'XML', valor:30, data_emissao:'2026-02-01', competencia:'2026-02', item_id:2 },
  { referencia:'r-20', documento:'20', origem:'XML', valor:20, data_emissao:'2026-01-01', competencia:'2026-01', item_id:3 },
];
const chamadas = [];
compartilhados.listar = async (cnpj, filtros = {}, opcoes = {}) => {
  chamadas.push({ cnpj, filtros, opcoes });
  const asc = String(filtros.ordem || '').toUpperCase() === 'ASC';
  const ordenados = [...remotos].sort((a, b) => (asc ? a.valor - b.valor : b.valor - a.valor));
  const limite = Number(filtros.limite) || 100;
  const pagina = Number(filtros.pagina) || 1;
  return { documentos: ordenados.slice((pagina - 1) * limite, pagina * limite), total: remotos.length, limitado: true };
};

const router = require('../src/routes/api');

async function executar() {
  const empresa = Number(db.prepare("INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)").run('00000000000193', 'Empresa Ordem').lastInsertRowid);
  // Pendente Questor já publicado na fonte: não pode ser somado de novo na leitura compartilhada.
  db.prepare("INSERT INTO movimentos (empresa_id,tipo,sentido,competencia,valor,origem,descricao) VALUES (?,?,?,?,?,?,?)")
    .run(empresa, 'fornecedor', 'fornecedor', '2026-01', 5, 'QUESTOR_RAZAO', 'razao-local');

  const app = express(); app.use(express.json()); app.use(router);
  const servidor = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const get = async (query) => {
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/empresas/${empresa}/documentos-fiscais?${query}`);
    return { status: r.status, corpo: await r.json() };
  };
  try {
    const p1 = await get('sentido=fornecedor&ordenar_por=valor&ordem=ASC&limite=2&pagina=1');
    const p2 = await get('sentido=fornecedor&ordenar_por=valor&ordem=ASC&limite=2&pagina=2');
    assert.equal(p1.status, 200); assert.equal(p2.status, 200);
    assert.equal(p1.corpo.total, 3, 'total não pode ser inflado pelo pendente local');
    assert.equal(p2.corpo.total, 3);
    const refs1 = p1.corpo.documentos.map((d) => d.referencia);
    const refs2 = p2.corpo.documentos.map((d) => d.referencia);
    assert.deepEqual(refs1, ['r-10', 'r-20'], 'página 1 segue a ordenação SQL por valor ASC');
    assert.deepEqual(refs2, ['r-30'], 'página 2 segue a ordenação SQL e não repete itens');
    assert.ok(!refs1.concat(refs2).includes('razao-local-1'), 'pendente local não é somado à leitura compartilhada');
    assert.equal(typeof p1.corpo.leitura_metricas.entradas_questor_pendencias, 'object', 'resumo vem da outbox, nunca de contagem de movimentos');
    assert.ok(chamadas.every((c) => c.filtros.ordenar_por === 'valor' && c.filtros.ordem === 'ASC'), 'ordenação chega à fonte compartilhada');
    console.log('ok entradas-ordenacao-fonte-compartilhada');
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
  }
}

executar().catch((e) => { console.error(e); process.exit(1); });
