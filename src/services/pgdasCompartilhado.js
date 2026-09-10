/* Fonte durável do PGDAS. SQLite é apenas cache; PDF e evidências residem no Supabase. */
const { Client } = require('pg');
const db = require('../db');

async function comCliente(acao) {
  if (!process.env.SUPABASE_DB_URL) return { ativo:false };
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
module.exports = { publicar };
