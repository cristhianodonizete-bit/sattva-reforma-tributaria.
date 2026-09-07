const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-sombra-sucessor-'));
process.env.SATTVA_DADOS = dir;
const db = require('../src/db');
const { importarArquivo } = require('../src/services/correlacoesHistoricasNcm');
const { sombraSucessoresHistoricosNcm, triagemEvidenciasSucessoresHistoricosNcm } = require('../src/services/auditoriaMatrizFiscal');

const arquivo = path.join(dir, 'correlacoes.json');
fs.writeFileSync(arquivo, JSON.stringify({ relacoes: [
  { codigo_origem: '11111111', codigo_destino: '22222222', tipo_relacao: 'DIRETA', fonte: 'MDIC', hash_origem: 'a'.repeat(64) },
  { codigo_origem: '33333333', codigo_destino: '44444444', tipo_relacao: 'DIRETA', fonte: 'MDIC', hash_origem: 'a'.repeat(64) },
  { codigo_origem: '55555555', codigo_destino: '66666666', tipo_relacao: 'DIRETA', fonte: 'MDIC', hash_origem: 'a'.repeat(64) },
] }));
importarArquivo({ arquivo, aplicar: true, db });
db.prepare(`INSERT INTO base_ncm (ncm,cst,cclasstrib,reducao,pis_percentual,cofins_percentual)
 VALUES ('11111111','010','000001','0',1.65,7.6),('22222222','010','000001','0',1.65,7.6),
 ('33333333','020','000002','60',0,0),('44444444','010','000002','60',0,0),
 ('55555555','010','000003','0',1.65,7.6)`).run();
const resultado = sombraSucessoresHistoricosNcm({ db });
assert.equal(resultado.resumo.EQUIVALENTE_SEM_PROMOCAO_AUTOMATICA, 1);
assert.equal(resultado.resumo.DIVERGENTE_BLOQUEADA, 1);
assert.equal(resultado.resumo.SEM_REGRA_OPERACIONAL_DESTINO, 1);
assert.deepEqual(resultado.itens.find((x) => x.ncm_historico === '33333333').campos_divergentes, ['cst']);
assert.equal(resultado.itens.find((x) => x.ncm_historico === '55555555').decisao, 'MANTER_PENDENTE_SEM_COPIAR_REGRA');
const triagem = triagemEvidenciasSucessoresHistoricosNcm({ db });
assert.equal(triagem.total, 3);
assert.ok(triagem.itens.find((x) => x.ncm_historico === '55555555').evidencia_minima.includes('REGRA_OPERACIONAL_VERSIONADA_DO_SUCESSOR'));
assert.equal(triagem.itens.every((x) => x.coleta_automatica_autorizada === false), true);
console.log('sombra-sucessores-historicos-ncm: equivalência, divergência e ausência bloqueadas com segurança');
db.close();
fs.rmSync(dir, { recursive: true, force: true });
