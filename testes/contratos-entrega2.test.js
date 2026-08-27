const assert = require('assert');
const entrega1 = require('../src/services/contratosEntrega1');
const entrega2 = require('../src/services/contratosEntrega2');

const alto = entrega1.analisarTexto('CLÁUSULA 1 — PREÇO\nO preço é fixo e irreajustável. A contratada arcará com os impostos.');
const riscos = alto.riscos.map((r, i) => ({ ...r, id: i + 1, clausula_id: r.clausula_ordem ? 11 : null }));
const clausulas = alto.clausulas.map((c, i) => ({ ...c, id: c.ordem === 1 ? 11 : i + 20 }));
const resultado = entrega2.gerar({ riscos, clausulas });
assert(resultado.recomendacoes.some((r) => r.prioridade === 'ALTA'));
assert(resultado.sugestoes.length > 0);
assert(resultado.sugestoes.every((s) => s.natureza === 'SUGERIDO' && s.status === 'RASCUNHO'));
assert(resultado.sugestoes.every((s) => s.clausula_original || s.clausula_original.includes('Ausência objetiva')));

// Cláusula tributária existente, detalhada e com transição não deve disparar
// ausência nem rascunho sem risco correspondente.
const seguro = entrega1.analisarTexto('CLÁUSULA 1 — TRIBUTOS\nHavendo alteração legislativa relativa a IBS e CBS, as partes documentarão o repasse tributário e o reequilíbrio econômico-financeiro. Cada parte responde por suas obrigações tributárias.');
assert(!seguro.riscos.some((r) => r.codigo === 'AUSENCIA_CLAUSULA_TRIBUTARIA'));
assert.strictEqual(entrega2.gerar({ riscos: [], clausulas: [] }).recomendacoes.length, 0);

// Sem evidência, recomendação é bloqueada mesmo que alguém forneça um código.
assert.strictEqual(entrega2.recomendacaoDeRisco({ codigo: 'PRECO_FIXO_SEM_REVISAO', nivel: 'alto', evidencia: '' }, new Map()), null);

// Integração econômica: somente fotografia explícita é aceita; o item contém
// resultado já calculado pela Precificação e não é submetido ao motor aqui.
const item = { item: { id: 7, natureza_item: 'produto', descricao: 'Produto vinculado' }, simulacao: {
  valor_venda_atual: 100, preco_projetado: 112, margem_atual: 30, margem_projetada: 25,
  credito_entregue_ao_cliente: 10, custo_efetivo_do_cliente: 102,
} };
const eco = entrega2.gerar({ itensPrecificacao: [item] });
assert.strictEqual(eco.recomendacoes.length, 1);
assert.equal(eco.recomendacoes[0].origem, 'PRECIFICACAO_VINCULO_EXPLICITO');
assert(eco.recomendacoes[0].evidencia.includes('Fotografia oficial de Precificação'));
assert.strictEqual(entrega2.gerar({ itensPrecificacao: [] }).recomendacoes.length, 0);

console.log('Contratos Entrega 2: riscos, rascunhos, bloqueio sem evidência e vínculo econômico explícito aprovados.');
