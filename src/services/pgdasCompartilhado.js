/* Fonte durável do PGDAS. SQLite é apenas cache; PDF e evidências residem no Supabase. */
const { Client } = require('pg');
const db = require('../db');

async function comCliente(acao) {
  // Nunca aceite sucesso local para evidência fiscal. Sem esta conexão a
  // instância do Render perderia o PDF no reinício; interromper é obrigatório.
  if (!process.env.SUPABASE_DB_URL) throw new Error('Persistência PGDAS indisponível: configure SUPABASE_DB_URL no Render antes de baixar ou confirmar documentos.');
  const client = new Client({ connectionString:process.env.SUPABASE_DB_URL, ssl:{ rejectUnauthorized:false } });
  await client.connect();
  try { return await acao(client); } finally { await client.end(); }
}
async function empresaRemota(client, empresaLocalId) {
  const r = await client.query('SELECT id FROM public.empresas WHERE origem_local_id=$1 OR id=$1 ORDER BY id LIMIT 2', [empresaLocalId]);
  if (r.rows.length !== 1) throw new Error('Empresa remota não localizada de forma única para persistir PGDAS.');
  return r.rows[0].id;
}
async function publicar(empresaLocalId, documentoLocalId) {
  const documento = db.prepare('SELECT * FROM pgdas_documentos WHERE id=? AND empresa_id=?').get(documentoLocalId, empresaLocalId);
  if (!documento) throw new Error('Documento PGDAS local não encontrado para publicação.');
  const campos = db.prepare('SELECT * FROM pgdas_documento_campos WHERE documento_id=?').all(documentoLocalId);
  return comCliente(async (client) => {
    const empresaId = await empresaRemota(client, empresaLocalId);
    await client.query('BEGIN');
    try {
      const q = await client.query(`INSERT INTO public.pgdas_documentos (empresa_id,origem_local_id,nome_original,tipo_documento,mime_type,conteudo_original,hash_sha256,competencia_detectada,data_processamento,metodo_extracao,status_processamento)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (empresa_id,hash_sha256) DO UPDATE SET origem_local_id=EXCLUDED.origem_local_id,nome_original=EXCLUDED.nome_original,mime_type=EXCLUDED.mime_type,competencia_detectada=EXCLUDED.competencia_detectada,data_processamento=EXCLUDED.data_processamento,metodo_extracao=EXCLUDED.metodo_extracao,status_processamento=EXCLUDED.status_processamento
        RETURNING id`, [empresaId,documento.id,documento.nome_original,documento.tipo_documento,documento.mime_type,documento.conteudo_original,documento.hash_sha256,documento.competencia_detectada,documento.data_processamento,documento.metodo_extracao,documento.status_processamento]);
      const remotoId = q.rows[0].id;
      for (const c of campos) await client.query(`INSERT INTO public.pgdas_documento_campos (documento_id,campo,valor_extraido,rotulo_original,pagina_ou_localizacao,confianca,metodo_extracao,status_validacao)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (documento_id,campo) DO UPDATE SET valor_extraido=EXCLUDED.valor_extraido,rotulo_original=EXCLUDED.rotulo_original,pagina_ou_localizacao=EXCLUDED.pagina_ou_localizacao,confianca=EXCLUDED.confianca,metodo_extracao=EXCLUDED.metodo_extracao,status_validacao=EXCLUDED.status_validacao`, [remotoId,c.campo,c.valor_extraido,c.rotulo_original,c.pagina_ou_localizacao,c.confianca,c.metodo_extracao,c.status_validacao]);
      await client.query('COMMIT'); return { publicado:true, documento_id:remotoId, campos:campos.length };
    } catch (e) { await client.query('ROLLBACK'); throw e; }
  });
}
async function restaurar(empresaLocalId) {
  // Não usar "há algum documento no cache" como critério de restauração. Em
  // uma instância nova o SQLite pode conter somente parte da empresa; esse
  // atalho era justamente o que fazia a lista e os botões divergirem.
  return comCliente(async (client) => {
    const empresaId = await empresaRemota(client, empresaLocalId);
    const docs = await client.query('SELECT * FROM public.pgdas_documentos WHERE empresa_id=$1 ORDER BY id', [empresaId]);
    const camposPorDocumento = new Map();
    for (const remoto of docs.rows) {
      const campos = await client.query('SELECT * FROM public.pgdas_documento_campos WHERE documento_id=$1 ORDER BY id', [remoto.id]);
      camposPorDocumento.set(remoto.id, campos.rows);
    }
    const inserirDocumento = db.prepare(`INSERT INTO pgdas_documentos (empresa_id,nome_original,tipo_documento,mime_type,conteudo_original,hash_sha256,competencia_detectada,data_processamento,metodo_extracao,status_processamento) VALUES (?,?,?,?,?,?,?,?,?,?)`);
    const inserirCampo = db.prepare(`INSERT INTO pgdas_documento_campos (documento_id,campo,valor_extraido,rotulo_original,pagina_ou_localizacao,confianca,metodo_extracao,status_validacao) VALUES (?,?,?,?,?,?,?,?)`);
    let restaurados = 0;
    db.transaction(() => {
      for (const remoto of docs.rows) {
        if (db.prepare('SELECT 1 FROM pgdas_documentos WHERE empresa_id=? AND hash_sha256=?').get(empresaLocalId, remoto.hash_sha256)) continue;
        const local = inserirDocumento.run(empresaLocalId, remoto.nome_original, remoto.tipo_documento, remoto.mime_type, remoto.conteudo_original, remoto.hash_sha256, remoto.competencia_detectada, remoto.data_processamento, remoto.metodo_extracao, remoto.status_processamento);
        for (const campo of camposPorDocumento.get(remoto.id) || []) inserirCampo.run(local.lastInsertRowid, campo.campo, campo.valor_extraido, campo.rotulo_original, campo.pagina_ou_localizacao, campo.confianca, campo.metodo_extracao, campo.status_validacao);
        restaurados += 1;
      }
    })();
    return { restaurados };
  });
}
async function localizarLocal(empresaLocalId, referencia) {
  const ref=String(referencia || '');
  const porReferencia=()=>db.prepare(`SELECT * FROM pgdas_documentos
    WHERE empresa_id=? AND (hash_sha256=? OR CAST(id AS TEXT)=?) ORDER BY id DESC LIMIT 1`).get(empresaLocalId,ref,ref);
  let documento=porReferencia();
  if(documento)return documento;
  // A restauração idempotente por hash traz todos os PDFs persistidos e cobre
  // reinício, troca de instância e cache local parcial.
  await restaurar(empresaLocalId);
  documento=porReferencia();
  if(documento)return documento;
  // Compatibilidade com páginas já abertas que ainda enviem o antigo id local:
  // origem_local_id no Supabase aponta para aquele id e permite localizar seu
  // hash estável antes de qualquer operação.
  return comCliente(async(client)=>{
    const empresaId=await empresaRemota(client,empresaLocalId);
    const remoto=await client.query(`SELECT hash_sha256 FROM public.pgdas_documentos
      WHERE empresa_id=$1 AND (CAST(id AS TEXT)=$2 OR CAST(origem_local_id AS TEXT)=$2) ORDER BY id DESC LIMIT 1`,[empresaId,ref]);
    if(!remoto.rows[0])return null;
    return db.prepare('SELECT * FROM pgdas_documentos WHERE empresa_id=? AND hash_sha256=?').get(empresaLocalId,remoto.rows[0].hash_sha256)||null;
  });
}
module.exports = { publicar, restaurar, localizarLocal };
