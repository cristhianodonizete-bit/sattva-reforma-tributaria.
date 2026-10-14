/* Valida uma fotografia já presente no SQLite e grava somente seu ponteiro. */
const empresaId=Number(process.argv[2]);
if(!Number.isInteger(empresaId) || empresaId<=0) {
  console.error('Uso: node scripts/validar_fotografia_local.js <empresa_id_local>');
  process.exit(2);
}
require('../src/services/operacaoCompartilhada').validarFotografiaLocalEmpresa(empresaId)
  .then((resultado)=>console.log(JSON.stringify(resultado,null,2)))
  .catch((erro)=>{ console.error(`VALIDACAO_REJEITADA: ${erro.message}`); process.exitCode=1; });
