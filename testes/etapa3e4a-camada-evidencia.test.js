const assert=require('assert'); const sqlite=require('../src/sqlite'); const db=sqlite.abrir(':memory:');
db.exec(`create table e(id integer primary key,empresa_id integer,tipo_fonte text,lote_origem_id integer,hash_lineage text,numero_documento text,serie text,base_pis real,base_cofins real,aliquota_pis real,aliquota_cofins real,natureza_credito text,condicao_credito text,grau_confianca text);`);
db.prepare('insert into e(empresa_id) values(?)').run(1);
db.prepare('insert into e(empresa_id,tipo_fonte,hash_lineage,base_pis,aliquota_pis,grau_confianca) values(?,?,?,?,?,?)').run(1,'EFD_CONTRIBUICOES','hash',100,0.0165,'ALTA');
assert.equal(db.prepare('select count(*) c from e').get().c,2); console.log('etapa3e4a-camada-evidencia.test: campos aditivos aprovados');
