/* Restauração explícita por empresa. Nunca é chamada por abertura de tela. */
const empresaId=Number(process.argv[2]);
if(!Number.isInteger(empresaId) || empresaId<=0) {
  console.error('Uso: node scripts/restaurar_fotografia.js <empresa_id_local>');
  process.exit(2);
}
require('../src/services/operacaoCompartilhada').restaurarFotografiaMotorEmpresa(empresaId)
  .then((resultado)=>console.log(JSON.stringify(resultado,null,2)))
  .catch((erro)=>{ console.error(`RESTAURACAO_REJEITADA: ${erro.message}`); process.exitCode=1; });
