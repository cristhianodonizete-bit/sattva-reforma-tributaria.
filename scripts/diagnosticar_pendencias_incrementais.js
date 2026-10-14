/* Diagnóstico somente leitura: confere se os IDs pendentes de motor_pendencias
 * existem na fonte canônica para a empresa. Não grava nada local nem remoto.
 * Uso: node scripts/diagnosticar_pendencias_incrementais.js <empresa_id_local> */
const empresaId = Number(process.argv[2]);
if (!Number.isInteger(empresaId) || empresaId <= 0) {
  console.error('Uso: node scripts/diagnosticar_pendencias_incrementais.js <empresa_id_local>');
  process.exit(2);
}
const db = require('../src/db');
const supabase = require('../src/services/supabase');

(async () => {
  const empresa = db.prepare('SELECT id,cnpj FROM empresas WHERE id=?').get(empresaId);
  if (!empresa?.cnpj) throw new Error('Empresa local não encontrada.');
  const cnpj = String(empresa.cnpj).replace(/\D/g, '');
  const remoto = supabase.admin();

  const { data: candidatas, error: erroEmpresa } = await remoto.from('empresas').select('id,cnpj,origem_local_id')
    .or(`origem_local_id.eq.${empresaId},cnpj.eq.${cnpj}`).limit(3);
  if (erroEmpresa) throw new Error(`Empresa remota: ${erroEmpresa.message}`);
  const remota = (candidatas || []).find((x) => Number(x.origem_local_id || x.id) === empresaId
    || String(x.cnpj || '').replace(/\D/g, '') === cnpj);
  if (!remota) throw new Error('Empresa remota não localizada.');

  // Leitura direta: não chama prepararFilaIncremental (que pode gravar).
  const pendentes = [...new Set(db.prepare('SELECT movimento_id FROM motor_pendencias WHERE empresa_id=?')
    .all(empresaId).map((x) => Number(x.movimento_id)).filter(Boolean))];

  const existentes = new Set();
  for (let de = 0; de < pendentes.length; de += 500) {
    const lote = pendentes.slice(de, de + 500);
    const { data, error } = await remoto.from('movimentos').select('id')
      .eq('empresa_id', Number(remota.id)).in('id', lote);
    if (error) throw new Error(`Consulta de movimentos na fonte: ${error.message}`);
    for (const linha of data || []) existentes.add(Number(linha.id));
  }
  const ausentes = pendentes.filter((id) => !existentes.has(id));

  console.log(JSON.stringify({
    empresa_local: empresaId,
    empresa_remota_id: Number(remota.id),
    pendentes_locais: pendentes.length,
    existentes_na_fonte: existentes.size,
    ausentes_na_fonte: ausentes.length,
    amostra_ausentes: ausentes.slice(0, 20),
  }, null, 2));
})().catch((erro) => { console.error(`DIAGNOSTICO_FALHOU: ${erro.message}`); process.exitCode = 1; });
