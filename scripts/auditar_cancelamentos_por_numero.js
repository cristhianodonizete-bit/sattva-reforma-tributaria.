/* Auditoria pontual: compara números informados pelo operador com o
 * cancelamento Questor e com o documento que permanece na fonte compartilhada.
 * Não altera nenhum registro. Uso: node scripts/auditar_cancelamentos_por_numero.js 502 498
 */
require('dotenv').config();
const supabase = require('../src/services/supabase');

const numeros = process.argv.slice(2).map((n) => String(n).replace(/\D/g, '')).filter(Boolean);
const digitos = (v) => String(v || '').replace(/\D/g, '');

async function main() {
  if (!numeros.length) throw new Error('Informe ao menos um número de nota.');
  if (!supabase.configurado()) throw new Error('Supabase não configurado.');
  const remoto = supabase.admin();
  const { data: empresas, error: erroEmpresa } = await remoto.from('empresas')
    .select('id,razao_social').ilike('razao_social', 'RELOTEC COMÉRCIO LTDA').limit(2);
  if (erroEmpresa) throw erroEmpresa;
  if (empresas?.length !== 1) throw new Error('Empresa Relotec não localizada de forma única.');
  const empresaId = empresas[0].id;
  const [{ data: movimentos, error: erroMovimentos }, { data: cancelamentos, error: erroCancelamentos }] = await Promise.all([
    remoto.from('movimentos').select('id,documento,chave,tipo,data_emissao,modelo_documento_fiscal,situacao_documento,cancelado_em,cancelamento_origem')
      .eq('empresa_id', empresaId).limit(10000),
    remoto.from('documentos_fiscais_cancelamentos').select('numero,data_emissao,modelo_documento_fiscal,serie,situacao,origem')
      .eq('empresa_id', empresaId).eq('situacao', 'CANCELADO'),
  ]);
  if (erroMovimentos) throw erroMovimentos;
  if (erroCancelamentos) throw erroCancelamentos;
  const resultado = numeros.map((numero) => ({
    numero,
    cancelamentos_questor: (cancelamentos || []).filter((c) => digitos(c.numero) === numero),
    documentos: (movimentos || []).filter((m) => digitos(String(m.documento || '').split('/').at(-1)) === numero),
  }));
  console.log(JSON.stringify({ empresa: empresas[0].razao_social, resultado }, null, 2));
}

main().catch((erro) => { console.error(erro.message); process.exit(1); });
