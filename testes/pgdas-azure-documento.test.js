const assert = require('assert');
const sqlite = require('../src/sqlite');
const pgdas = require('../src/services/pgdasDocumentoIa');

const db = sqlite.abrir(':memory:');
db.exec(`
  CREATE TABLE empresas (id INTEGER PRIMARY KEY, regime TEXT);
  CREATE TABLE perfil_tributario (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, competencia TEXT, receita_bruta REAL, receita_mercadorias REAL, receita_servicos REAL, receita_exportacao REAL, pis REAL, cofins REAL, das REAL, origem TEXT);
  CREATE TABLE pgdas_documentos (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa_id INTEGER, nome_original TEXT, tipo_documento TEXT, mime_type TEXT, conteudo_original BLOB, hash_sha256 TEXT, competencia_detectada TEXT, data_processamento TEXT, metodo_extracao TEXT, status_processamento TEXT);
  CREATE TABLE pgdas_documento_campos (id INTEGER PRIMARY KEY AUTOINCREMENT, documento_id INTEGER, campo TEXT, valor_extraido TEXT, rotulo_original TEXT, pagina_ou_localizacao TEXT, confianca REAL, metodo_extracao TEXT, status_validacao TEXT);
  INSERT INTO empresas VALUES (1, 'simples_nacional'), (2, 'lucro_presumido');
`);

const campos = pgdas.normalizarTexto(`Competência: 02/2026\nReceita Bruta: R$ 12.500,00\nValor DAS: R$ 775,30\nPIS: R$ 12,00`, { localizacoes: [{ texto: 'Valor DAS: R$ 775,30', pagina: 2, confianca: .91 }] });
assert.strictEqual(campos.find((x) => x.campo === 'competencia').valor_extraido, '2026-02');
assert.strictEqual(campos.find((x) => x.campo === 'das').valor_extraido, 775.3);
assert.strictEqual(campos.find((x) => x.campo === 'cofins').valor_extraido, null, 'ausência não pode virar zero');
const r = pgdas.ingerir(db, 1, { nome_original: 'pgdas.pdf', tipo_documento: 'PDF', mime_type: 'application/pdf', conteudo_original: Buffer.from('pgdas fevereiro'), metodo_extracao: 'prebuilt-layout + NORMALIZACAO' }, campos);
assert.strictEqual(db.prepare('SELECT COUNT(*) c FROM perfil_tributario').get().c, 0, 'OCR pendente nunca entra no histórico antes da confirmação');
assert.strictEqual(pgdas.listar(db, 1)[0].campos_extraidos.length, 8);
const confirmado = pgdas.confirmar(db, 1, r.documento_id);
assert.strictEqual(confirmado.status_processamento, 'VALIDADO_USUARIO');
const perfil = db.prepare('SELECT * FROM perfil_tributario WHERE empresa_id=1').get();
assert.strictEqual(perfil.competencia, '2026-02');
assert.strictEqual(perfil.das, 775.3);
assert.strictEqual(perfil.cofins, null);
assert.throws(() => pgdas.ingerir(db, 2, { nome_original: 'x.pdf', tipo_documento: 'PDF', conteudo_original: Buffer.from('x'), metodo_extracao: 'teste' }, campos), /Simples Nacional/);
db.close();
console.log('PGDAS Azure: leitura determinística, revisão, confirmação e ausência preservada aprovadas.');
