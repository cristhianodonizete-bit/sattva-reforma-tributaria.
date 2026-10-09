/* Homologação em PostgreSQL descartável. Exige SUPABASE_HOMOLOG_DB_URL distinta da produção. */
require('dotenv').config();
const fs=require('fs'); const path=require('path'); const { Client }=require('pg');
const url=process.env.SUPABASE_HOMOLOG_DB_URL;
if (!url) throw new Error('SUPABASE_HOMOLOG_DB_URL não configurada. Produção não é aceita.');
if (url === process.env.SUPABASE_DB_URL) throw new Error('A URL de homologação não pode ser a URL de produção.');
const ler=(nome)=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',nome),'utf8');
async function q(c,sql,params=[]){ return c.query(sql,params); }
async function main(){
  const c=new Client({ connectionString:url, ssl:{rejectUnauthorized:false} }); await c.connect();
  try {
    // A base precisa ser descartável: o teste remove somente seus próprios objetos.
    await q(c,`DROP TABLE IF EXISTS public.sync_probe CASCADE;
      DROP TABLE IF EXISTS public.sincronizacao_operacional_consumidores CASCADE;
      DROP TABLE IF EXISTS public.sincronizacao_operacional_estado CASCADE;
      DROP TABLE IF EXISTS public.sincronizacao_operacional_eventos CASCADE;`);
    await q(c,ler('20260917_trilha_incremental_operacional.sql'));
    await q(c,'CREATE TABLE public.sync_probe (id bigint primary key, empresa_id text, valor text, updated_at timestamptz)');
    await q(c,"CREATE TRIGGER trg_sync_operacional_evento AFTER INSERT OR UPDATE OR DELETE ON public.sync_probe FOR EACH ROW EXECUTE FUNCTION public.registrar_evento_sincronizacao_operacional()");
    await q(c,ler('20261015_sincronizacao_operacional_v2_homologacao.sql'));
    await q(c,"INSERT INTO public.sync_probe VALUES (1,'1','A',clock_timestamp())");
    await q(c,"UPDATE public.sync_probe SET valor='A' WHERE id=1");
    await q(c,'UPDATE public.sync_probe SET updated_at=clock_timestamp() WHERE id=1');
    await q(c,"UPDATE public.sync_probe SET valor='B' WHERE id=1");
    await q(c,'DELETE FROM public.sync_probe WHERE id=1');
    await q(c,"INSERT INTO public.sync_probe VALUES (1,'1','B',clock_timestamp())");
    const antes=(await q(c,'SELECT count(*)::int total FROM public.sincronizacao_operacional_eventos')).rows[0].total;
    const publicado=(await q(c,'SELECT * FROM public.publicar_eventos_sincronizacao_operacional(1000)')).rows[0];
    const fila=(await q(c,'SELECT sequencia_consumo,operacao FROM public.sincronizacao_operacional_eventos ORDER BY sequencia_consumo')).rows;
    if (antes !== 4 || fila.map(x=>x.operacao).join(',') !== 'INSERT,UPDATE,DELETE,INSERT') throw new Error('Filtro de evento ou operações v2 inesperados.');
    await q(c,"SELECT * FROM public.registrar_consumidor_sincronizacao_operacional('a','sa',120)");
    await q(c,"SELECT * FROM public.registrar_consumidor_sincronizacao_operacional('b','sb',120)");
    await q(c,"SELECT * FROM public.confirmar_checkpoint_sincronizacao_operacional('a','sa',$1,true)",[publicado.sequencia_final]);
    await q(c,"SELECT * FROM public.confirmar_checkpoint_sincronizacao_operacional('b','sb',$1,true)",[publicado.sequencia_final]);
    let leaseBloqueado=false; try { await q(c,"SELECT * FROM public.registrar_consumidor_sincronizacao_operacional('a','outra',120)"); } catch (_) { leaseBloqueado=true; }
    if (!leaseBloqueado) throw new Error('Lease concorrente não bloqueou segunda sessão.');
    const longa=new Client({connectionString:url,ssl:{rejectUnauthorized:false}}); const rapida=new Client({connectionString:url,ssl:{rejectUnauthorized:false}});
    await longa.connect(); await rapida.connect();
    try { await q(longa,'BEGIN'); await q(longa,"INSERT INTO public.sync_probe VALUES (2,'1','lenta',clock_timestamp())"); await q(rapida,"INSERT INTO public.sync_probe VALUES (3,'1','rápida',clock_timestamp())"); await q(c,'SELECT * FROM public.publicar_eventos_sincronizacao_operacional(1000)'); await q(longa,'COMMIT'); await q(c,'SELECT * FROM public.publicar_eventos_sincronizacao_operacional(1000)'); }
    finally { try { await longa.query('ROLLBACK'); } catch (_) {} await longa.end(); await rapida.end(); }
    const concorrentes=(await q(c,"SELECT chave,sequencia,sequencia_consumo FROM public.sincronizacao_operacional_eventos WHERE chave->>'id' IN ('2','3') ORDER BY sequencia_consumo")).rows;
    if (!(Number(concorrentes[0].sequencia)>Number(concorrentes[1].sequencia) && Number(concorrentes[0].sequencia_consumo)<Number(concorrentes[1].sequencia_consumo))) throw new Error('Commit invertido não foi serializado na fila publicada.');
    const inicio=Date.now(); await q(c,"INSERT INTO public.sync_probe SELECT 1000+g,'1','x',clock_timestamp() FROM generate_series(1,5000) g"); await q(c,'SELECT * FROM public.publicar_eventos_sincronizacao_operacional(10000)');
    const base=(await q(c,'SELECT count(*)::int total FROM public.sincronizacao_operacional_eventos')).rows[0].total;
    await q(c,'UPDATE public.sync_probe SET updated_at=clock_timestamp() WHERE id>=1001');
    const semMudanca=(await q(c,'SELECT count(*)::int total FROM public.sincronizacao_operacional_eventos')).rows[0].total-base;
    await q(c,"UPDATE public.sync_probe SET valor='y' WHERE id>=1001");
    const reais=(await q(c,'SELECT count(*)::int total FROM public.sincronizacao_operacional_eventos')).rows[0].total-base;
    if (semMudanca!==0 || reais!==5000) throw new Error(`Medição inválida: técnicos=${semMudanca}, reais=${reais}`);
    console.log(JSON.stringify({ homologacao:'isolada', operacoes:fila.map(x=>x.operacao), consumidores:2, lease:leaseBloqueado, commit_invertido:'ok', eventos_sem_mudanca:semMudanca, eventos_reais:reais, tempo_ms:Date.now()-inicio },null,2));
  } finally { await c.end(); }
}
main().catch(e=>{ console.error(e.stack||e.message); process.exitCode=1; });
