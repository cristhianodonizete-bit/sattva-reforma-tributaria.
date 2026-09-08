/* Persistência durável do pareamento e da fila Questor.
 * O SQLite continua atendendo o conector em baixa latência; Supabase é a
 * fonte de recuperação quando uma instância efêmera do Render é reiniciada. */
const db = require('../db');
const supabase = require('./supabase');

const colunasConector = ['id','nome','segredo_hash','usuario_id','segredo_cifrado','segredo_iv','segredo_salt','status','ultima_conexao_em','criado_em'];
const colunasTarefa = ['id','conector_id','empresa_id','tipo','payload_json','status','resultado_json','erro','criado_em','executado_em'];
const inserir = (tabela, colunas, linha) => db.prepare(`INSERT OR REPLACE INTO ${tabela} (${colunas.join(',')}) VALUES (${colunas.map(()=>'?').join(',')})`).run(...colunas.map((c)=>linha[c] ?? null));
const remoto = () => supabase.configurado() ? supabase.admin() : null;

async function publicarConector(linha) {
  const client=remoto(); if(!client) return;
  const {error}=await client.from('questor_conectores').upsert(colunasConector.reduce((o,c)=>(o[c]=linha[c] ?? null,o),{}),{onConflict:'id'});
  if(error) throw new Error(`Não foi possível preservar o pareamento: ${error.message}`);
}
async function publicarTarefa(linha) {
  const client=remoto(); if(!client) return;
  const {error}=await client.from('questor_conector_tarefas').upsert(colunasTarefa.reduce((o,c)=>(o[c]=linha[c] ?? null,o),{}),{onConflict:'id'});
  if(error) throw new Error(`Não foi possível preservar a solicitação: ${error.message}`);
}
async function recuperarConector(id) {
  const client=remoto(); if(!client) return db.prepare('SELECT * FROM questor_conectores WHERE id=?').get(id) || null;
  const {data,error}=await client.from('questor_conectores').select('*').eq('id',id).maybeSingle();
  if(error) throw new Error(`Não foi possível recuperar o pareamento: ${error.message}`);
  if(data) {
    inserir('questor_conectores',colunasConector,data);
    const {data:tarefas,error:erroTarefas}=await client.from('questor_conector_tarefas').select('*').eq('conector_id',id).order('id',{ascending:false}).limit(100);
    if(erroTarefas) throw new Error(`Não foi possível recuperar as solicitações: ${erroTarefas.message}`);
    (tarefas||[]).forEach((x)=>inserir('questor_conector_tarefas',colunasTarefa,x));
  }
  return data || db.prepare('SELECT * FROM questor_conectores WHERE id=?').get(id) || null;
}
async function sincronizarUsuario(usuarioId) {
  const client=remoto(); if(!client) return;
  const {data:conectores,error}=await client.from('questor_conectores').select('*').eq('usuario_id',usuarioId);
  if(error) throw new Error(`Não foi possível recuperar seus pareamentos: ${error.message}`);
  (conectores||[]).forEach((x)=>inserir('questor_conectores',colunasConector,x));
  const ids=(conectores||[]).map((x)=>x.id); if(!ids.length) return;
  const {data:tarefas,error:erroTarefas}=await client.from('questor_conector_tarefas').select('*').in('conector_id',ids).order('id',{ascending:false}).limit(100);
  if(erroTarefas) throw new Error(`Não foi possível recuperar as solicitações: ${erroTarefas.message}`);
  (tarefas||[]).forEach((x)=>inserir('questor_conector_tarefas',colunasTarefa,x));
}
module.exports={publicarConector,publicarTarefa,recuperarConector,sincronizarUsuario};
