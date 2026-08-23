/* Copia a camada de gestão do SQLite local para o Supabase, sem duplicar. */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const db = require('../src/db');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.');
const supabase = createClient(url, key, { auth: { persistSession: false } });
async function upsert(tabela, linhas, chave = 'origem_local_id') {
  if (!linhas.length) return;
  const { error } = await supabase.from(tabela).upsert(linhas, { onConflict: chave });
  if (error) throw new Error(`${tabela}: ${error.message}`);
}
async function executar() {
  const empresas = db.prepare('SELECT id, cnpj, razao_social, nome_fantasia FROM empresas').all();
  await upsert('empresas', empresas.map((e) => ({ origem_local_id: e.id, cnpj: e.cnpj, razao_social: e.razao_social, nome_fantasia: e.nome_fantasia || null })));
  const { data: remotas, error } = await supabase.from('empresas').select('id,origem_local_id');
  if (error) throw error;
  const mapaEmpresa = new Map(remotas.map((e) => [Number(e.origem_local_id), e.id]));
  const contratos = db.prepare(`SELECT c.*, co.nome combo_nome FROM contratacoes c LEFT JOIN combos co ON co.id=c.combo_id`).all();
  const projetos = contratos.map((c) => ({
    origem_local_contratacao_id: c.id, empresa_id: mapaEmpresa.get(c.empresa_id), nome_plano: c.combo_nome || 'Escopo personalizado',
    escopo: JSON.parse(c.modulos_json || '[]'), status: c.aprovado_em ? (c.status === 'concluido' ? 'concluido' : 'em_execucao') : 'aguardando_aprovacao',
    acompanhamento_meses: Number(c.acompanhamento_meses) || 0, competencia_referencia: c.competencia_referencia || null, aprovado_em: c.aprovado_em || null,
  })).filter((p) => p.empresa_id);
  await upsert('projetos', projetos, 'origem_local_contratacao_id');
  const { data: remotosProjetos, error: erroProjetos } = await supabase.from('projetos').select('id,origem_local_contratacao_id');
  if (erroProjetos) throw erroProjetos;
  const mapaProjeto = new Map(remotosProjetos.map((p) => [Number(p.origem_local_contratacao_id), p.id]));
  const entregas = db.prepare('SELECT * FROM projeto_entregas').all().map((e) => ({ origem_local_id: e.id, projeto_id: mapaProjeto.get(e.contratacao_id), chave: e.chave, titulo: e.titulo, status: e.status, concluido_em: e.concluido_em || null, observacoes: e.observacoes || null })).filter((e) => e.projeto_id);
  const acompanhamentos = db.prepare('SELECT * FROM projeto_acompanhamentos').all().map((a) => ({ origem_local_id: a.id, projeto_id: mapaProjeto.get(a.contratacao_id), competencia: a.competencia, nome: a.nome || null, status: a.status, observacoes: a.observacoes || null })).filter((a) => a.projeto_id);
  await upsert('projeto_entregas', entregas);
  await upsert('projeto_acompanhamentos', acompanhamentos);
  console.log(JSON.stringify({ empresas: empresas.length, projetos: projetos.length, entregas: entregas.length, acompanhamentos: acompanhamentos.length }));
}
if (require.main === module) executar().catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; });
module.exports = { executar };
