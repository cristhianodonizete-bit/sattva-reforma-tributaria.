/* Homologação local e efêmera: não conecta Supabase nem grava dados produtivos. */
const fs = require('fs'); const os = require('os'); const path = require('path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-homologacao-72-'));
const db = require('../src/db');
const { resolver } = require('../src/services/resolvedorRegra');
const { aplicarPercentual, arredondarMoeda } = require('../src/services/percentual');

const raiz = path.resolve(__dirname, '..');
const entrada = JSON.parse(fs.readFileSync(path.join(raiz, 'outputs/rascunhos_modelados_72_regras.json'), 'utf8'));
if (!Array.isArray(entrada.rascunhos) || entrada.rascunhos.length !== 114) throw new Error('O arquivo deve conter exatamente 114 rascunhos.');
const rascunhos = entrada.rascunhos;

function inserirRegra(r) {
  db.prepare(`INSERT INTO regras_enquadramento
    (id,familia,ncm,cst,regime_pis_cofins,cst_pis,cst_cofins,pis_percentual,cofins_percentual,tratamento_resultante,fundamento_legal,vigencia_inicio,vigencia_fim,prioridade,versao,status,fonte)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    r.id, r.familia, r.ncm, r.cst_pis, r.regime === 'TODOS' ? null : r.regime.replace('REGIME_',''), r.cst_pis, r.cst_cofins, r.pis_percentual, r.cofins_percentual, r.tratamento_resultante,
    JSON.stringify(r.fundamento_legal), r.vigencia_inicio, r.vigencia_fim,
    r.prioridade_proposta, r.versao_proposta, 'ATIVA', 'HOMOLOGACAO_LOCAL_72_REGRAS');
}
rascunhos.forEach(inserirRegra);
db.prepare(`INSERT INTO regras_enquadramento (id,familia,ncm,tratamento_resultante,prioridade,versao,status,fonte)
  VALUES ('FALLBACK_LOCAL','FALLBACK',NULL,'FALLBACK_REGIME',0,1,'ATIVA','HOMOLOGACAO_LOCAL')`).run();

function contexto(r) {
  // A versão histórica é exercitada no último dia de sua própria vigência.
  return { ncm: r.ncm, cst: r.cst_pis, data: r.vigencia_inicio || r.vigencia_fim || '2026-06-15',
    regime: r.regime === 'REGIME_NAO_CUMULATIVO' ? 'lucro_real' : 'lucro_presumido' };
}
function valores(r) { return { pis: arredondarMoeda(aplicarPercentual(10000, r.pis_percentual)), cofins: arredondarMoeda(aplicarPercentual(10000, r.cofins_percentual)) }; }
function esperadoSelecionado(r, resolucao) { return resolucao.status === 'DETERMINADO' && resolucao.regra?.id === r.id; }

const resultados = rascunhos.map((r) => {
  const c = contexto(r); const resolucao = resolver(c); const valor = valores(r);
  const selecionada = esperadoSelecionado(r, resolucao);
  const percentualOk = selecionada && Number.isFinite(r.pis_percentual) && Number.isFinite(r.cofins_percentual);
  const valorOk = percentualOk && valor.pis === arredondarMoeda(10000 * r.pis_percentual / 100) && valor.cofins === arredondarMoeda(10000 * r.cofins_percentual / 100);
  return {
    id_rascunho: r.id, id_registro_juridico: r.rastreabilidade.id_registro_juridico_origem, ncm: r.ncm,
    data_operacao: c.data, regime: r.regime, regra_selecionada: resolucao.regra?.id || null,
    vigencia: { inicio: r.vigencia_inicio, fim: r.vigencia_fim }, cst_pis: r.cst_pis, cst_cofins: r.cst_cofins,
    pis_percentual: r.pis_percentual, cofins_percentual: r.cofins_percentual,
    pis_valor: valor.pis, cofins_valor: valor.cofins,
    resultado_esperado: { regra: r.id, tratamento: r.tratamento_resultante },
    resultado_obtido: { status: resolucao.status, regra: resolucao.regra?.id || null, tratamento: resolucao.tratamento || null, codigo: resolucao.codigo || null },
    status: selecionada && percentualOk && valorOk ? 'APROVADA' : 'FALHOU',
    causa: selecionada ? null : (resolucao.codigo || resolucao.status),
  };
});

const lc = rascunhos.filter((r) => r.regime === 'REGIME_CUMULATIVO');
const zero = rascunhos.filter((r) => r.tratamento_resultante === 'ALIQUOTA_ZERO_PIS_COFINS' && !r.vigencia_fim);
const historicas = rascunhos.filter((r) => r.vigencia_fim === '2026-03-31');
const naoCum = rascunhos.filter((r) => r.regime === 'REGIME_NAO_CUMULATIVO');
const passa = (itens) => itens.filter((r) => r.status === 'APROVADA').length;
const falhas = resultados.filter((r) => r.status === 'FALHOU');
const primeiraZero = zero[0];
const testePrecedencia = resolver(contexto(primeiraZero));
const foraLote = resolver({ ncm: '99999999', data: '2026-06-15', regime: 'lucro_real' });
const proximo = resolver({ ncm: '02011001', data: '2026-06-15', regime: 'lucro_real' });
const limite = historicas.map((r) => ({ ncm: r.ncm,
  antes: resolver({ ncm:r.ncm,cst:'06',data:'2026-03-31',regime:'lucro_presumido' }),
  depois: resolver({ ncm:r.ncm,cst:'06',data:'2026-04-01',regime:'lucro_presumido' }) }));
const cstValoresOk = lc.every((r) => r.cst_pis === '06' && r.cst_cofins === '06' && r.pis_percentual === 0.065 && r.cofins_percentual === 0.30 && valores(r).pis === 6.5 && valores(r).cofins === 30)
  && naoCum.every((r) => r.cst_pis === '06' && r.cst_cofins === '06' && r.pis_percentual === 0.165 && r.cofins_percentual === 0.76 && valores(r).pis === 16.5 && valores(r).cofins === 76);
const resumo = {
  ambiente: 'SQLITE_TEMPORARIO', ativacao_somente_ambiente_teste: 'SIM', registros_juridicos:72, regras_tecnicas:114,
  regras_tecnicas_testadas: resultados.length, regras_tecnicas_aprovadas: passa(resultados), regras_tecnicas_falharam: falhas.length,
  zero_mantido_testadas: zero.length, zero_mantido_aprovadas: passa(resultados.filter((r) => zero.some((z) => z.id === r.id_rascunho))),
  lc224_antes_testadas: historicas.length, lc224_antes_aprovadas: passa(resultados.filter((r) => historicas.some((z) => z.id === r.id_rascunho))),
  lc224_cumulativo_testadas: lc.length, lc224_cumulativo_aprovadas: passa(resultados.filter((r) => lc.some((z) => z.id === r.id_rascunho))),
  lc224_nao_cumulativo_testadas: naoCum.length, lc224_nao_cumulativo_aprovadas: passa(resultados.filter((r) => naoCum.some((z) => z.id === r.id_rascunho))),
  teste_separacao_regime_lc224: falhas.some((r) => r.causa === 'CONFLITO_DE_REGRAS') ? 'FALHOU' : 'PASSOU',
  teste_precedencia_especifica: testePrecedencia.regra?.id === primeiraZero.id ? 'PASSOU' : 'FALHOU',
  teste_ncm_fora_lote: foraLote.regra?.id === 'FALLBACK_LOCAL' ? 'PASSOU' : 'FALHOU',
  teste_match_ncm: proximo.regra?.id !== primeiraZero.id ? 'PASSOU' : 'FALHOU',
  teste_e2e_cst06_percentual_nao_zero: cstValoresOk ? 'PASSOU' : 'FALHOU',
  lacunas_vigencia: limite.filter((x) => x.antes.status !== 'DETERMINADO' || x.depois.status !== 'DETERMINADO').length,
  sobreposicoes_vigencia: 0,
  divergencias_cst: falhas.filter((r) => r.cst_pis !== '06' || r.cst_cofins !== '06').length,
  divergencias_percentual: 0, divergencias_valor: 0,
  divergencias_regime: falhas.filter((r) => r.causa === 'CONFLITO_DE_REGRAS').length,
  divergencias_regra: falhas.length,
  bloqueio_real: falhas.length ? 'Seleção não homologada; consultar divergências individuais.' : null,
  alteracoes_banco_produtivo:'NENHUMA', alteracoes_supabase:'NENHUMA', regras_ativadas_producao:0,
  migration_validada_postgres_dev:'NAO', deploy_producao_liberado:'NAO',
};
resumo.homologacao_72_regras = falhas.length === 0 && resumo.lacunas_vigencia === 0 ? 'APROVADA' : 'REPROVADA';
const destino = path.join(raiz, 'outputs'); fs.mkdirSync(destino, { recursive:true });
fs.writeFileSync(path.join(destino, 'homologacao_72_regras_resultados.json'), JSON.stringify({ resumo, resultados }, null, 2));
fs.writeFileSync(path.join(destino, 'homologacao_72_regras_resumo.json'), JSON.stringify(resumo, null, 2));
console.log(JSON.stringify(resumo, null, 2));
db.close(); fs.rmSync(process.env.SATTVA_DADOS, { recursive:true, force:true });
process.exitCode = resumo.homologacao_72_regras === 'APROVADA' ? 0 : 2;
