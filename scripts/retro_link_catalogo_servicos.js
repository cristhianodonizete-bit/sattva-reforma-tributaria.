/* Etapa 2Y — retro-link determinístico da base operacional ao Anexo VIII v1.00.00. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');
const limite = Math.max(1, Math.min(Number(process.argv[2] || 1739), 1739));

const CAMPOS = ['lc116', 'nbs', 'indop', 'onerosa', 'exterior', 'local_incidencia', 'cclasstrib'];
const texto = (v) => String(v ?? '').trim();
const digitos = (v) => texto(v).replace(/\D/g, '');
const normalizar = (v) => texto(v).toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]+/g, '');
const campo = (linha, nome) => {
  if (nome === 'lc116') return digitos(linha[nome]).padStart(4, '0').slice(0, 4);
  if (nome === 'nbs') return digitos(linha[nome]);
  if (nome === 'indop') return digitos(linha[nome]).replace(/^0+(?=\d)/, '') || '0';
  return normalizar(linha[nome]);
};
const canonico = (linha) => Object.fromEntries(CAMPOS.map((nome) => [nome, campo(linha, nome)]));
const hash = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex');

async function fotografia(client) {
  const { rows } = await client.query(`
    select count(*)::int resultados,
           coalesce(sum((dados->>'cbs')::numeric), 0)::text cbs
      from public.motor_resultados_operacionais
     where empresa_id=1 and execucao_id=14 and ativo=true
  `);
  return rows[0];
}

(async () => {
  if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL ausente.');
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const antes = await fotografia(client);
    const [versao, base, linhas] = await Promise.all([
      client.query(`select id,versao,arquivo_hash_sha256,status_versao from public.catalogo_versoes where dominio='NBS' and versao='1.00.00' and status_versao='VALIDADA'`),
      client.query(`select id,lc116,nbs,indop,onerosa,exterior,local_incidencia,cclasstrib from public.base_servicos where catalogo_linha_id is null order by id limit $1`, [limite]),
      client.query(`select id,catalogo_versao_id,linha_origem,campos_origem from public.catalogo_linhas_versoes where catalogo_versao_id=(select id from public.catalogo_versoes where dominio='NBS' and versao='1.00.00' and status_versao='VALIDADA')`)
    ]);
    if (versao.rows.length !== 1) throw new Error('Catálogo NBS v1.00.00 VALIDADA não encontrado de forma única.');
    const versaoId = versao.rows[0].id;
    const porChave = new Map();
    for (const linha of linhas.rows) {
      const oficial = linha.campos_origem?.campos_normalizados || {};
      const chave = JSON.stringify(canonico(oficial));
      if (!porChave.has(chave)) porChave.set(chave, []);
      porChave.get(chave).push({ id: linha.id, linha_origem: linha.linha_origem });
    }
    const decisoes = base.rows.map((linha) => {
      const chave = JSON.stringify(canonico(linha));
      const candidatos = porChave.get(chave) || [];
      if (candidatos.length !== 1) return { base_servicos_id: linha.id, status: candidatos.length ? 'MULTIPLOS_CANDIDATOS' : 'SEM_CORRESPONDENCIA', chave, candidatos };
      return { base_servicos_id: linha.id, status: 'LINK_EXATO', chave, candidatos };
    });
    const deterministicos = decisoes.filter((d) => d.status === 'LINK_EXATO');
    const naoDeterministicos = decisoes.filter((d) => d.status !== 'LINK_EXATO');

    await client.query('begin');
    {
      const registros = deterministicos.map((decisao) => {
        const catalogoLinhaId = decisao.candidatos[0].id;
        const chaveVariante = hash(JSON.parse(decisao.chave));
        const criterios = {
          metodo: 'ANEXO_VIII_V100_VARIANTE_CANONICA',
          campos: JSON.parse(decisao.chave),
          normalizacao_indop: 'NUMERICA_SEM_ZEROS_A_ESQUERDA',
          catalogo_versao: '1.00.00'
        };
        const hashDecisao = hash({ base_servicos_id: decisao.base_servicos_id, catalogo_versao_id: versaoId, catalogo_linha_id: catalogoLinhaId, criterios });
        return { base_servicos_id: decisao.base_servicos_id, catalogo_versao_id: versaoId, catalogo_linha_id: catalogoLinhaId, chave_variante: chaveVariante, criterios, hash_decisao: hashDecisao };
      });
      const payload = JSON.stringify(registros);
      await client.query(`
        with entrada as (
          select * from jsonb_to_recordset($1::jsonb) as x(
            base_servicos_id bigint, catalogo_versao_id bigint, catalogo_linha_id bigint,
            chave_variante text, criterios jsonb, hash_decisao text
          )
        )
        update public.base_servicos b
           set catalogo_versao_id=e.catalogo_versao_id,
               catalogo_linha_id=e.catalogo_linha_id,
               chave_variante_origem=coalesce(b.chave_variante_origem,e.chave_variante),
               dados_origem=coalesce(b.dados_origem,'{}'::jsonb) || jsonb_build_object('lineage_catalogo',jsonb_build_object('catalogo_versao_id',e.catalogo_versao_id,'catalogo_linha_id',e.catalogo_linha_id,'metodo','ANEXO_VIII_V100_VARIANTE_CANONICA','hash_decisao',e.hash_decisao))
          from entrada e
         where b.id=e.base_servicos_id
      `, [payload]);
      await client.query(`
        insert into public.base_servicos_catalogo_lineage(base_servicos_id,catalogo_versao_id,catalogo_linha_id,status,chave_variante,criterios,hash_decisao_sha256)
        select x.base_servicos_id,x.catalogo_versao_id,x.catalogo_linha_id,'LINK_EXATO',x.chave_variante,x.criterios,x.hash_decisao
          from jsonb_to_recordset($1::jsonb) as x(
            base_servicos_id bigint, catalogo_versao_id bigint, catalogo_linha_id bigint,
            chave_variante text, criterios jsonb, hash_decisao text
          )
        on conflict(base_servicos_id,catalogo_versao_id,catalogo_linha_id) do nothing
      `, [payload]);
    }
    await client.query('commit');
    const depois = await fotografia(client);
    const lineage = await client.query(`select count(*)::int total,count(*) filter(where catalogo_versao_id=$1 and catalogo_linha_id is not null)::int vinculadas from public.base_servicos`, [versaoId]);
    const output = {
      antes, depois, regressao_fiscal_preservada: JSON.stringify(antes) === JSON.stringify(depois), versao: versao.rows[0],
      decisoes: {
        link_exato: deterministicos.length,
        pendencias_tecnicas_lineage: naoDeterministicos.length,
        nao_deterministicas: naoDeterministicos.map((d) => ({ base_servicos_id: d.base_servicos_id, status: d.status, candidatos: d.candidatos.map((c) => c.id) }))
      },
      lineage: lineage.rows[0], lote_solicitado: limite
    };
    const destino = path.join(__dirname, '..', 'auditorias', 'etapa2y-retro-link-v100.json');
    fs.writeFileSync(destino, JSON.stringify(output, null, 2));
    console.log(JSON.stringify({ ...output, arquivo: destino }, null, 2));
  } catch (erro) {
    try { await client.query('rollback'); } catch (_) {}
    throw erro;
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });
