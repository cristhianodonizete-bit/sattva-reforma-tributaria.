const assert=require('assert');
const fs=require('fs');
const path=require('path');

const raiz=path.resolve(__dirname,'..');
const api=fs.readFileSync(path.join(raiz,'src/routes/api.js'),'utf8');
const operacao=fs.readFileSync(path.join(raiz,'src/services/operacaoCompartilhada.js'),'utf8');

const inicio=api.indexOf("router.get('/empresas/:id/cadeia/:tipo'");
const fim=api.indexOf('\nrouter.', inicio + 1);
const rotaCadeia=api.slice(inicio, fim > inicio ? fim : inicio + 9000);
assert(inicio>=0,'rota GET da Cadeia não encontrada');
assert(rotaCadeia.includes('restaurarFotografiaMotorEmpresa'),'GET deve restaurar a fotografia materializada');
assert(!rotaCadeia.includes('renovarFotografiasItensEntradaManualSeNecessario'),'GET da Cadeia não pode renovar catálogo nem recalcular');
assert(!rotaCadeia.includes('solicitarIncremental'),'GET da Cadeia não pode enfileirar incremental');
assert(!rotaCadeia.includes('reprocessarIncremental'),'GET da Cadeia não pode reprocessar');

const fotoInicio=operacao.indexOf('async function restaurarFotografiaMotorEmpresa');
const fotoFim=operacao.indexOf('\nasync function ',fotoInicio + 1);
const restauracao=operacao.slice(fotoInicio, fotoFim > fotoInicio ? fotoFim : undefined);
assert(fotoInicio>=0,'restaurarFotografiaMotorEmpresa não encontrada');
assert(!restauracao.includes('motor_pendencias'),'restauração não pode criar pendência');
assert(restauracao.includes('buscarMovimentosDaFotografia'),'restauração deve buscar os movimentos canônicos da fotografia');
assert(restauracao.includes('hidratarMovimentosCanonicos'),'restauração deve hidratar o cache antes de restaurar estados');
assert(restauracao.includes('const estadosTraduzidos=estadosRemotos.map'),'estados só devem ser traduzidos após haver mapeamento local');
assert(restauracao.indexOf('hidratarMovimentosCanonicos') < restauracao.indexOf('const gravarEstado='),'hidratação deve ocorrer antes da restauração dos estados');

const parceirosInicio=operacao.indexOf('async function restaurarParceirosEmpresa');
const parceirosFim=operacao.indexOf('\nasync function ',parceirosInicio + 1);
const parceiros=operacao.slice(parceirosInicio, parceirosFim > parceirosInicio ? parceirosFim : undefined);
assert(parceirosInicio>=0,'restaurarParceirosEmpresa não encontrada');
assert(parceiros.includes("from('cadastros_cnpj')"),'parceiros deve consultar cadastro compartilhado');
assert(parceiros.includes('regime_derivado'),'parceiros deve usar regime derivado canônico');
assert(parceiros.includes('confirmacaoManualCanonica'),'manual só pode permanecer se canônico');

console.log('leitura-pura-cadeia-regime: GET sem job, hidratação canônica antes dos estados e regime canônico: OK');
