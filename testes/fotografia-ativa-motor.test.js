const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-fotografia-ativa-'));
process.env.SATTVA_DADOS = dir;
const { promoverFotografiaAtiva } = require('../src/services/operacaoCompartilhada');

const chamadas = [];
const remoto = {
  from(tabela) {
    const filtros = [];
    const cadeia = {
      update(valores) { chamadas.push({ tabela, valores, filtros }); return cadeia; },
      eq(campo, valor) {
        filtros.push([campo, valor]);
        return filtros.some(([nome]) => nome === 'ativo') ? Promise.resolve({ error: null }) : cadeia;
      },
      contains(campo, valor) {
        filtros.push([campo, valor]);
        return Promise.resolve({ error: null });
      },
    };
    return cadeia;
  },
};

(async () => {
  await promoverFotografiaAtiva(remoto, 1, 16);
  assert.deepEqual(chamadas.map((x) => [x.tabela, x.valores, x.filtros]), [
    ['motor_resultados_operacionais', { ativo: false }, [['empresa_id', 1], ['ativo', true]]],
    ['motor_resultados_operacionais', { ativo: true }, [['empresa_id', 1], ['dados', { execucao_id: 16 }]]],
  ]);
  console.log('fotografia-ativa-motor: execução mais recente promovida com segurança: OK');
  try { require('../src/db').close?.(); } catch (_) { /* noop */ }
  fs.rmSync(dir, { recursive: true, force: true });
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
