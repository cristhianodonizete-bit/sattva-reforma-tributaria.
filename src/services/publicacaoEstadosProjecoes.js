/*
 * Publicação mínima do estado de uma projeção.
 *
 * Não depende de operacaoCompartilhada: esse módulo reúne sincronizações
 * amplas e não pode ser carregado por uma migração de estado ou por um
 * checkpoint do worker. Aqui trafegam somente IDs explícitos e as colunas de
 * validade, nunca movimentos, resultados ou JSONs do motor.
 */
const supabase = require('./supabase');

async function publicar(db, empresaId, movimentoIds = []) {
  const ids = [...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return { ativo: supabase.configurado(), estados: 0 };
  if (!supabase.configurado()) throw new Error('Fonte compartilhada não configurada para publicar estados de projeção.');
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!empresa?.cnpj) throw new Error('Empresa não encontrada para publicar estado de projeção.');
  const remoto = supabase.admin();
  const cnpj = String(empresa.cnpj).replace(/\D/g, '');
  const { data: empresas, error: erroEmpresa } = await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa compartilhada para projeção: ${erroEmpresa.message}`);
  const empresaRemota = (empresas || []).find((x) => Number(x.origem_local_id || x.id) === Number(empresaId)
    || String(x.cnpj || '').replace(/\D/g, '') === cnpj);
  if (!empresaRemota) throw new Error('Empresa compartilhada não localizada para publicar estado de projeção.');
  const marcas = ids.map(() => '?').join(',');
  const estados = db.prepare(`SELECT empresa_id,movimento_id,assinatura_origem,versao_origem,assinatura_calculada,versao_calculada,situacao,motivo,job_id,atualizado_em
    FROM projecoes_movimentos_estado WHERE empresa_id=? AND movimento_id IN (${marcas})`)
    .all(Number(empresaId), ...ids).map((x) => ({ ...x, empresa_id:Number(empresaRemota.id) }));
  if (!estados.length) return { ativo:true, estados:0, empresa_remota_id:Number(empresaRemota.id) };
  const { error } = await remoto.from('projecoes_movimentos_estado').upsert(estados, { onConflict:'empresa_id,movimento_id' });
  if (error) throw new Error(`Estado compartilhado da projeção: ${error.message}`);
  return { ativo:true, estados:estados.length, empresa_remota_id:Number(empresaRemota.id) };
}

module.exports = { publicar };
