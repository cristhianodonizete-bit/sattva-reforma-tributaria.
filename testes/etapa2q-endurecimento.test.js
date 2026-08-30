const assert = require('assert');
const catalogo = require('../src/services/catalogoFiscal');
const { reconstruir } = require('../src/engine/reconstrucao');
const fila = require('../src/services/pendenciasEnriquecimento');

// Sem catálogo não pode cair na alíquota geral do regime.
const semCatalogo = catalogo.resolver({ valor: 1000, ncm: '99999999' });
assert.equal(semCatalogo.percentual, null);
assert.equal(semCatalogo.natureza, 'INDETERMINADO');
assert.equal(semCatalogo.continuar, false);
assert.ok(['SEM_CATALOGO', 'MULTIPLOS_CANDIDATOS'].includes(semCatalogo.motivoIndeterminacao));

const rec = reconstruir({ valor: 1000, tipo: 'mercadoria', regime: 'lucro_presumido', ncm: '99999999' });
assert.equal(rec.memoriaPisCofins.carga_atual_pis_cofins_valor, null);
assert.ok(['SEM_CATALOGO', 'MULTIPLOS_CANDIDATOS'].includes(rec.memoriaPisCofins.motivo_indeterminacao));
assert.equal(rec.status, 'parcialmente_determinada');

// Documento continua tendo precedência e não é bloqueado pelo catálogo.
const documento = reconstruir({ valor: 1000, tipo: 'mercadoria', regime: 'lucro_presumido', pis: 6.5, cofins: 30, pis_cofins_documentado: true });
assert.equal(documento.memoriaPisCofins.carga_atual_pis_cofins_origem, 'DOCUMENTO');
assert.equal(documento.memoriaPisCofins.carga_atual_pis_cofins_valor, 36.5);

const p = fila.pendenciaDaIndeterminacao({ empresaId: 1, movimentoId: 10, resultadoId: 20, motivo: 'MULTIPLOS_CANDIDATOS', tipo: 'SERVICO' });
assert.deepEqual(p.evidencia_necessaria, ['INDOP', 'ONEROSIDADE', 'EXTERIOR', 'LOCAL_INCIDENCIA', 'CCLASSTRIB']);
assert.equal(fila.normalizarMotivo('qualquer'), 'SEM_EVIDENCIA');
assert.equal(fila.motivoDaLinha({ status_classificacao: 'REQUER_VALIDACAO', detalhe: JSON.stringify({ classificacao: { candidatos: [{}, {}] } }) }), 'MULTIPLOS_CANDIDATOS');
assert.equal(fila.motivoDaLinha({ detalhe: JSON.stringify({ reconstrucao: { status: 'insuficiente' } }) }), 'SEM_BASE_PIS_COFINS');

console.log('Etapa 2Q: endurecimento e fila de enriquecimento aprovados.');
