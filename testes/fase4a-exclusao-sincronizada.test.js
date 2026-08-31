const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-exclusao-sync-'));
const { excluirEmpresa } = require('../scripts/sincronizar_gestao_supabase');

const chamadas = [];
const remoto = {
  from(tabela) {
    return {
      select() { return { eq: async (_campo, valor) => ({ data: tabela === 'empresas' && valor === 77 ? [{ id: 901, origem_local_id: 77 }] : [], error: null }) }; },
      delete() { return { eq: async (campo, valor) => { chamadas.push({ tabela, campo, valor }); return { error: null }; } }; },
    };
  },
};
(async () => {
  const resultado = await excluirEmpresa(77, remoto);
  assert.deepStrictEqual(resultado, { empresa: 1, dependencias: 7 });
  assert.deepStrictEqual(chamadas.at(-1), { tabela: 'empresas', campo: 'id', valor: 901 });
  assert(callsOnlyTarget(call => call.valor === 901 || call.valor === 77), 'a exclusão deve ficar restrita ao alvo remoto');
  assert(callsOnlyTarget(call => call.tabela !== 'empresas' || call.valor === 901), 'nenhuma outra empresa pode ser removida');
  console.log('fase4a-exclusao-sincronizada.test: remoção remota restrita e ordenada aprovada.');
})().catch((e) => { console.error(e); process.exitCode = 1; });
function callsOnlyTarget(verificar) { return chamadas.every(verificar); }
