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
async function espelharEmpresas(empresas, remoto = supabase) {
  const { data: existentes, error } = await remoto.from('empresas').select('id,origem_local_id,cnpj');
  if (error) throw error;
  const porOrigem = new Map((existentes || []).filter((e) => e.origem_local_id != null).map((e) => [Number(e.origem_local_id), e]));
  // A origem local normaliza CNPJ para dígitos; integrações históricas podem
  // conservar máscara. Comparar a chave canônica evita uma segunda empresa
  // remota e mantém a exclusão sincronizada restrita ao mesmo cadastro.
  const cnpjCanonico = (valor) => String(valor || '').replace(/\D/g, '');
  const porCnpj = new Map((existentes || []).filter((e) => cnpjCanonico(e.cnpj)).map((e) => [cnpjCanonico(e.cnpj), e]));
  for (const empresa of empresas) {
    const linha = { origem_local_id: empresa.id, cnpj: empresa.cnpj, razao_social: empresa.razao_social, nome_fantasia: empresa.nome_fantasia || null };
    // A publicação operacional legada já podia ter criado a empresa pelo ID
    // local. Reaproveitamos essa mesma linha e materializamos a chave de
    // gestão, evitando uma segunda empresa pelo mesmo CNPJ.
    const existente = porOrigem.get(Number(empresa.id)) || porCnpj.get(cnpjCanonico(empresa.cnpj));
    const resposta = existente
      ? await remoto.from('empresas').update(linha).eq('id', existente.id)
      : await remoto.from('empresas').insert(linha);
    if (resposta.error) throw new Error(`empresas: ${resposta.error.message}`);
  }
}

async function excluirEmpresa(empresaLocalId, remoto = supabase) {
  const origem = Number(empresaLocalId);
  if (!Number.isInteger(origem) || origem <= 0) throw new Error('Empresa inválida para exclusão sincronizada.');
  let consulta = await remoto.from('empresas').select('id,origem_local_id').eq('origem_local_id', origem);
  if (consulta.error) throw new Error(`empresas: ${consulta.error.message}`);
  // Instâncias anteriores podiam ter publicado a empresa somente pelo ID.
  // O fallback é limitado ao mesmo identificador local; nunca procura por
  // nome nem varre outras empresas.
  if (!consulta.data?.length) {
    consulta = await remoto.from('empresas').select('id,origem_local_id').eq('id', origem);
    if (consulta.error) throw new Error(`empresas: ${consulta.error.message}`);
  }
  if (!consulta.data?.length) return { empresa: 0, dependencias: 0 };
  if (consulta.data.length !== 1) throw new Error('Mais de uma empresa remota corresponde ao alvo local; exclusão cancelada.');
  const empresaId = consulta.data[0].id;
  // Estas tabelas restringem a remoção da empresa no schema compartilhado.
  // Dependências com ON DELETE CASCADE (projetos, checklist, contratos etc.)
  // permanecem sob responsabilidade das FKs, preservando a política atual
  // de hard delete da aplicação local.
  const dependencias = [
    'pendencias_enriquecimento_fiscal', 'enriquecimento_pis_cofins_evidencias',
    'enriquecimento_servicos_evidencias', 'evidencias_decisao', 'decisoes_memoria',
    'empresas_usuarios', 'grupos_empresas_itens',
  ];
  for (const tabela of dependencias) {
    const { error } = await remoto.from(tabela).delete().eq('empresa_id', empresaId);
    if (error) throw new Error(`${tabela}: ${error.message}`);
  }
  const { error } = await remoto.from('empresas').delete().eq('id', empresaId);
  if (error) throw new Error(`empresas: ${error.message}`);
  return { empresa: 1, dependencias: dependencias.length };
}
async function executar() {
  const empresas = db.prepare('SELECT id, cnpj, razao_social, nome_fantasia FROM empresas').all();
  await espelharEmpresas(empresas);
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
  const { data: entregasRemotas, error: erroEntregas } = await supabase.from('projeto_entregas').select('id,origem_local_id,projeto_id');
  if (erroEntregas) throw erroEntregas;
  const mapaEntrega = new Map(entregasRemotas.map((e) => [Number(e.origem_local_id), e]));
  const responsaveis = db.prepare('SELECT * FROM projeto_responsaveis').all().map((r) => {
    const entrega = r.entrega_id ? mapaEntrega.get(Number(r.entrega_id)) : null;
    const projeto = entrega?.projeto_id || mapaProjeto.get(r.contratacao_id);
    return { origem_local_id:r.id, projeto_id:projeto, entrega_id:entrega?.id || null, lado:r.lado, nome:r.nome, telefone:r.telefone||null, email:r.email||null, funcao:r.funcao||null, criado_em:r.criado_em||null };
  }).filter((r) => r.projeto_id);
  const tarefas = db.prepare('SELECT * FROM projeto_tarefas').all().map((t) => {
    const entrega = mapaEntrega.get(Number(t.entrega_id)); const projeto = entrega?.projeto_id || mapaProjeto.get(t.contratacao_id);
    return { origem_local_id:t.id, projeto_id:projeto, entrega_id:entrega?.id, titulo:t.titulo, descricao:t.descricao||null, status:t.status, data_abertura:t.data_abertura||null, data_conclusao:t.data_conclusao||null, envolve_cliente:!!t.envolve_cliente, pendencia_cliente:t.pendencia_cliente||null, interacoes_cliente:t.interacoes_cliente||null, criado_em:t.criado_em||null, atualizado_em:t.atualizado_em||null };
  }).filter((t) => t.projeto_id && t.entrega_id);
  const responsaveisRemotos = await supabase.from('projeto_responsaveis').select('id,origem_local_id,projeto_id');
  if (responsaveisRemotos.error) throw responsaveisRemotos.error;
  const mapaResponsavel = new Map((responsaveisRemotos.data || []).map((r) => [Number(r.origem_local_id), r]));
  const checklist = db.prepare('SELECT * FROM projeto_checklist_implantacao').all().map((i) => {
    const entrega = i.entrega_id ? mapaEntrega.get(Number(i.entrega_id)) : null;
    const projeto = entrega?.projeto_id || mapaProjeto.get(i.contratacao_id);
    const responsavel = i.responsavel_id ? mapaResponsavel.get(Number(i.responsavel_id)) : null;
    return { origem_local_id: i.id, projeto_id: projeto, entrega_id: entrega?.id || null, escopo: i.escopo, chave: i.chave,
      titulo: i.titulo, tipo_evidencia: i.tipo_evidencia || null, status: i.status, responsavel_id: responsavel?.id || null,
      origem_tipo: i.origem_tipo || null, origem_id: i.origem_id || null, observacoes: i.observacoes || null,
      ordem: Number(i.ordem) || 0, origem: i.origem || 'AUTOMATICO', criado_em: i.criado_em || null, atualizado_em: i.atualizado_em || null };
  }).filter((i) => i.projeto_id);
  await upsert('projeto_responsaveis', responsaveis);
  await upsert('projeto_tarefas', tarefas);
  await upsert('projeto_checklist_implantacao', checklist);
  console.log(JSON.stringify({ empresas: empresas.length, projetos: projetos.length, entregas: entregas.length, acompanhamentos: acompanhamentos.length, responsaveis: responsaveis.length, tarefas: tarefas.length, checklist: checklist.length }));
}
if (require.main === module) executar().catch((e) => { console.error('ERRO:', e.message); process.exitCode = 1; });
module.exports = { executar, excluirEmpresa, espelharEmpresas };
