const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const { Client } = require('pg');
const { avaliarCredito } = require('../src/engine/motor');

const inteiro = (valor) => Number(valor || 0);

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query(`
      select r.id, r.dados, r.autonomia_calculo_cbs_propria,
        r.autonomia_credito_cliente, r.autonomia_classificatoria,
        r.autonomia_diagnostico_completo, m.sentido, e.regime as regime_emitente
      from public.motor_resultados_operacionais r
      join public.movimentos m on m.id=r.movimento_id
      join public.empresas e on e.id=r.empresa_id
      where r.empresa_id=1 and r.execucao_id=14 and r.ativo=true and m.sentido='saida'
        and r.autonomia_calculo_cbs_propria=true
        and r.autonomia_credito_cliente=false
        and r.autonomia_diagnostico_completo=false
        and r.autonomia_classificatoria in ('DETERMINADA','PARCIAL')
    `);
    const total = await client.query(`
      select count(*) filter (where autonomia_diagnostico_completo=true)::int as completos,
        count(*)::int as resultados
      from public.motor_resultados_operacionais
      where empresa_id=1 and execucao_id=14 and ativo=true
    `);

    const decisoes = rows.map((linha) => {
      const dados = typeof linha.dados === 'string' ? JSON.parse(linha.dados) : (linha.dados || {});
      const detalhe = typeof dados.detalhe === 'string' ? JSON.parse(dados.detalhe) : (dados.detalhe || dados);
      const decisaoClassificatoria = {
        impactoTributarioMaterial: false,
        classificacaoFiscalmenteEquivalente: linha.autonomia_classificatoria === 'PARCIAL',
        autonomiaClassificatoria: linha.autonomia_classificatoria,
      };
      const credito = avaliarCredito({
        regimeAdquirente: detalhe.regimeAdquirente,
        regimeFornecedor: linha.regime_emitente,
        cls: detalhe.classificacao,
        sentido: linha.sentido,
        decisaoClassificatoria,
      });
      return { linha, detalhe, credito };
    });
    const liberadas = decisoes.filter((x) => x.credito.statusDeterminacao === 'DETERMINADO');
    const bloqueadas = decisoes.length - liberadas.length;
    const completosAntes = inteiro(total.rows[0].completos);
    const resultados = inteiro(total.rows[0].resultados);
    const cbsAntes = decisoes.reduce((s, x) => s + Number(x.detalhe.cbs || 0), 0);
    const cbsDepois = decisoes.reduce((s, x) => s + Number(x.detalhe.cbs || 0), 0);
    console.log(JSON.stringify({
      operacoes_shadow: decisoes.length,
      liberadas: liberadas.length,
      ainda_bloqueadas: bloqueadas,
      bloqueadas_por_divergencia_material: decisoes.filter((x) => x.credito.statusDeterminacao === 'SUJEITO_VALIDACAO').length,
      diagnostico_completo_antes: `${completosAntes}/${resultados}`,
      diagnostico_completo_depois: `${completosAntes + liberadas.length}/${resultados}`,
      autonomia_diagnostico_completo_depois: Number(((completosAntes + liberadas.length) / resultados * 100).toFixed(2)),
      cbs_propria_antes: Number(cbsAntes.toFixed(2)),
      cbs_propria_depois: Number(cbsDepois.toFixed(2)),
      cbs_propria_preservada: cbsAntes === cbsDepois,
      resultados_oficiais_modificados: false,
    }, null, 2));
  } finally {
    await client.end();
  }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });
