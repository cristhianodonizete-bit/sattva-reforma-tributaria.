// Certificação isolada: delega os cenários já independentes a processos Node.
const { spawnSync } = require('child_process');
const path = require('path');
const cenarios = [
  ['CORE_SOMBRA_PENDENCIA_RESPOSTA', 'e2e-motor-condicional-sombra.test.js'],
  ['IDENTIDADE_XML_SPED', 'e2e-identidade-importadores.test.js'],
  ['CADASTRO_HISTORICO_VIGENCIA_LOTE', 'cadastro-fiscal-complementar.test.js'],
  ['API_RESPOSTA_LOTE', 'classificacao-fiscal-complementar-api-http.test.js'],
  ['INTERFACE_SELECAO', 'classificacao-fiscal-complementar-api-interface.test.js'],
  ['MOTOR_CONDICIONAL', 'motor-condicional-pis-cofins.test.js'],
];
const resultado = {};
for (const [nome, arquivo] of cenarios) {
  const r = spawnSync(process.execPath, [path.join(__dirname, arquivo)], { encoding:'utf8', env:{...process.env, PIS_COFINS_CONDICIONAL_SHADOW:'true'} });
  resultado[nome] = r.status === 0 ? 'PASSOU' : 'FALHOU';
  if (r.status !== 0) console.error(`${nome}: ${r.stderr || r.stdout}`);
}
const aprovados = Object.values(resultado).filter(x=>x==='PASSOU').length;
console.log(JSON.stringify({ resultados:resultado, executados:cenarios.length, aprovados, falharam:cenarios.length-aprovados, E2E_FINAL_CONCLUIDO:aprovados===cenarios.length?'SIM':'NAO' }, null, 2));
process.exitCode = aprovados === cenarios.length ? 0 : 1;
