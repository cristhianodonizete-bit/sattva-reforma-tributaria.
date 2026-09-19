/*
 * Audita (ou, com --aplicar, reconcilia) NFS-e já importadas contra
 * cancelamentos Questor que estavam guardados antes da chegada do XML.
 * Só altera quando número + modelo + data apontam para um único documento.
 */
require('dotenv').config();
const supabase = require('../src/services/supabase');

const aplicar = process.argv.includes('--aplicar');
const nomeEmpresa = 'RELOTEC COMÉRCIO LTDA';
const somenteDigitos = (v) => String(v || '').replace(/\D/g, '');
function identidadeDocumento(movimento) {
  const partes = String(movimento.documento || '').split('/');
  return {
    numero: somenteDigitos(partes.at(-1)),
    chave: movimento.chave || `doc:${movimento.documento}`,
  };
}

async function main() {
  if (!supabase.configurado()) throw new Error('Supabase não configurado.');
  const remoto = supabase.admin();
  const { data: empresas, error: erroEmpresa } = await remoto.from('empresas')
    .select('id,razao_social').ilike('razao_social', nomeEmpresa).limit(2);
  if (erroEmpresa) throw erroEmpresa;
  if (empresas?.length !== 1) throw new Error(`Empresa remota não localizada de forma única: ${nomeEmpresa}.`);
  const empresa = empresas[0];
  const [{ data: cancelamentos, error: erroCancelamentos }, { data: movimentos, error: erroMovimentos }] = await Promise.all([
    remoto.from('documentos_fiscais_cancelamentos').select('id,data_emissao,numero,modelo_documento_fiscal,serie,situacao,origem')
      .eq('empresa_id', empresa.id).eq('modelo_documento_fiscal', 'nfse').eq('situacao', 'CANCELADO'),
    remoto.from('movimentos').select('id,documento,chave,data_emissao,modelo_documento_fiscal,situacao_documento')
      .eq('empresa_id', empresa.id).eq('tipo', 'cliente').eq('modelo_documento_fiscal', 'nfse').limit(10000),
  ]);
  if (erroCancelamentos) throw erroCancelamentos;
  if (erroMovimentos) throw erroMovimentos;

  const ids = new Set();
  const detalhes = [];
  for (const cancelamento of cancelamentos || []) {
    const candidatos = (movimentos || []).filter((movimento) => {
      const id = identidadeDocumento(movimento);
      return id.numero === somenteDigitos(cancelamento.numero)
        && String(movimento.data_emissao || '').slice(0, 10) === String(cancelamento.data_emissao || '').slice(0, 10)
        && !['CANCELADO', 'DENEGADO', 'INUTILIZADO'].includes(String(movimento.situacao_documento || '').toUpperCase());
    });
    const documentos = new Set(candidatos.map((movimento) => identidadeDocumento(movimento).chave));
    if (documentos.size !== 1) {
      detalhes.push({ numero: cancelamento.numero, data: cancelamento.data_emissao, resultado: documentos.size ? 'AMBIGUO' : 'SEM_NOTA_ATIVA' });
      continue;
    }
    candidatos.forEach((movimento) => ids.add(movimento.id));
    detalhes.push({ numero: cancelamento.numero, data: cancelamento.data_emissao, resultado: 'PRONTO_PARA_CANCELAR', itens: candidatos.length });
  }

  const resumo = { empresa: empresa.razao_social, cancelamentos_questor: (cancelamentos || []).length, itens_para_cancelar: ids.size, detalhes };
  if (!aplicar || !ids.size) return console.log(JSON.stringify({ ...resumo, aplicado: false }, null, 2));

  const listaIds = [...ids];
  const { error: erroAtualizar } = await remoto.from('movimentos').update({
    situacao_documento: 'CANCELADO', cancelado_em: new Date().toISOString(),
    cancelamento_motivo: 'Cancelamento Questor conciliado retroativamente por número, modelo e data.',
    cancelamento_origem: 'QUESTOR_RELATORIO_CANCELADOS',
  }).in('id', listaIds);
  if (erroAtualizar) throw erroAtualizar;
  const { error: erroResultados } = await remoto.from('motor_resultados_operacionais')
    .update({ ativo: false }).eq('empresa_id', empresa.id).in('movimento_id', listaIds);
  if (erroResultados) throw erroResultados;
  console.log(JSON.stringify({ ...resumo, aplicado: true }, null, 2));
}

main().catch((erro) => { console.error(erro.message); process.exit(1); });
