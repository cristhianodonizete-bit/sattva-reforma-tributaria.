/*
 * Relatório jurídico conservador e somente-leitura.
 * Sem fundamento original NCM a NCM, nenhuma alíquota pós-LC 224 é presumida.
 */
const fs = require('fs');
const path = require('path');

const FONTES_GERAIS = [
  { titulo: 'LC 224/2025, art. 4º, §§ 2º, 3º, 4º, I, e 8º', url: 'https://anttlegis.antt.gov.br/action/ActionDatalegis.php?acao=abrirTextoAto&cod_menu=7145&cod_modulo=420&desItem=&desItemFim=&nomeTitulo=codigos&numeroAto=00000224&orgao=NI&seqAto=000&tipo=LCP&valorAno=2025' },
  { titulo: 'RFB — Perguntas e Respostas, redução dos incentivos e benefícios, questão 34.1', url: 'https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/beneficios-fiscais/perguntas-e-respostas-reducao-dos-incentivos-e-beneficios-tributarios.pdf/%40%40download/file' },
  { titulo: 'Lei 10.925/2004, art. 1º', url: 'https://planalto.gov.br/ccivil_03/_ato2004-2006/2004/lei/l10.925.htm' }
];

function validar(registro) {
  return {
    id_proposto: registro.id_proposto,
    ncm: registro.ncm,
    descricao: registro.descricao,
    tratamento_matriz: registro.tratamento_resultante_proposto,
    fundamento_legal_original: null,
    lei: null,
    artigo: null,
    inciso: null,
    alinea_item: null,
    vigencia_original_inicio: null,
    vigencia_original_fim: '2026-03-31',
    impacto_lc224: 'INDETERMINADO',
    fundamento_impacto_lc224: 'LC 224/2025, art. 4º, § 4º, I, e § 8º — aplicação e exceção dependem do fundamento original e do cruzamento oficial do NCM.',
    tratamento_ate_2026_03_31: 'ALÍQUOTA ZERO — informação histórica da matriz; fundamento legal original pendente de identificação.',
    tratamento_desde_2026_04_01: 'INDETERMINADO — não calcular nem presumir sem fundamento legal original e verificação de exceção expressa.',
    cst_pis_desde_2026_04_01: null,
    cst_cofins_desde_2026_04_01: null,
    pis_cumulativo_desde_2026_04_01: null,
    cofins_cumulativo_desde_2026_04_01: null,
    pis_nao_cumulativo_desde_2026_04_01: null,
    cofins_nao_cumulativo_desde_2026_04_01: null,
    exige_inf_ad_fisco_lc224: null,
    status_validacao_juridica: 'PRECISA_REVISAO_JURIDICA',
    fontes: FONTES_GERAIS,
    observacoes: 'A LC 224/2025 prevê 10% das alíquotas-padrão para isenção/alíquota zero alcançada (art. 4º, §4º, I), preservando as exceções do §8º. A fonte da matriz não contém o dispositivo originário por NCM nem o cruzamento oficial com Anexo I/XV da LC 214/2025; por segurança, não se conclui alcance, exceção, CST ou percentual efetivo.'
  };
}
function executar(arquivoEntrada, pastaSaida) {
  const lote = JSON.parse(fs.readFileSync(arquivoEntrada, 'utf8'));
  if (lote.length !== 76) throw new Error(`Lote esperado de 76 registros; recebido: ${lote.length}`);
  const registros = lote.map(validar);
  const resumo = {
    registros_analisados: registros.length,
    zero_mantido_2026: 0,
    alcancados_lc224: 0,
    outro_tratamento: 0,
    precisa_revisao_juridica: registros.length,
    com_vigencia_dividida_2026: 0,
    cst06_com_percentual_nao_zero: 0,
    exigem_infadfisco_lc224: 0,
    fundamento_legal_identificado: 0,
    fundamento_legal_nao_identificado: registros.length,
    registros_prontos_para_modelagem: 0,
    registros_nao_prontos: registros.length,
    alteracoes_banco: 'NENHUMA',
    alteracoes_supabase: 'NENHUMA',
    alteracoes_motor: 'NENHUMA'
  };
  fs.mkdirSync(pastaSaida, { recursive: true });
  fs.writeFileSync(path.join(pastaSaida, 'validacao_juridica_76_diretas.json'), JSON.stringify({ resumo, registros }, null, 2));
  fs.writeFileSync(path.join(pastaSaida, 'validacao_juridica_76_diretas_resumo.json'), JSON.stringify({ resumo, criterio: 'Sem dispositivo originário e cruzamento oficial NCM–exceção, a regra fica em PRECISA_REVISAO_JURIDICA.', fontes_gerais: FONTES_GERAIS }, null, 2));
  return resumo;
}
if (require.main === module) {
  const raiz = path.resolve(__dirname, '..');
  console.log(JSON.stringify(executar(process.argv[2] || path.join(raiz, 'outputs/lote_validacao_juridica_direta.json'), process.argv[3] || path.join(raiz, 'outputs')), null, 2));
}
module.exports = { validar, executar };
