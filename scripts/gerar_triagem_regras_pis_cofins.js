/*
 * Triagem operacional exclusivamente local.
 * Não conecta banco, Supabase ou motor; lê a consolidação e grava relatórios JSON.
 */
const fs = require('fs');
const path = require('path');

const texto = (v) => String(v ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').toLowerCase();
const temPapel = (r) => ['sim', 'indeterminado'].includes(texto(r.papel_cadeia_necessario));
const semBloqueio = (r) => !r.bloqueios_para_ativacao?.length;
const objetivo = (r) => Boolean(r.cst_pis && r.cst_cofins && r.pis_percentual !== null && r.pis_percentual !== undefined && r.cofins_percentual !== null && r.cofins_percentual !== undefined);
const geralResidual = (r) => texto(r.tratamento_resultante_proposto) === 'normal'
  && texto(r.operacao_pis_cofins_fonte) === 'tributado - regra geral da receita'
  && texto(r.regime_pis_cofins_receita) === 'conforme cadastro da empresa/receita'
  // A observação genérica do catálogo não é condição fiscal estruturável.
  && !r.marcador_condicional && !temPapel(r);

function classificar(registro) {
  if (registro.classificacao === 'INCONSISTENTE' || !(registro.ncm || registro.nbs)) return 'INCONSISTENTE';
  if (temPapel(registro)) return 'PAPEL_CADEIA';
  if (geralResidual(registro)) return 'REGRA_GERAL_RESIDUAL';
  if (registro.classificacao === 'REGRA_CONDICIONAL' || registro.marcador_condicional) return 'REGRA_CONDICIONAL';
  if (!semBloqueio(registro) || registro.condicao_textual_fonte || !objetivo(registro)) return 'REGRA_ESPECIFICA_PENDENTE_ESTRUTURACAO';
  return 'REGRA_ESPECIFICA_DIRETA_EXECUTAVEL';
}
function prontidao(classificacao) {
  return {
    REGRA_GERAL_RESIDUAL: 'NAO_NECESSITA_REGRA_ESPECIFICA',
    REGRA_ESPECIFICA_DIRETA_EXECUTAVEL: 'PRONTO_PARA_VALIDACAO_JURIDICA_DIRETA',
    REGRA_ESPECIFICA_PENDENTE_ESTRUTURACAO: 'PRECISA_ESTRUTURAR_CONDICAO',
    REGRA_CONDICIONAL: 'PRECISA_ESTRUTURAR_CONDICAO',
    PAPEL_CADEIA: 'PRECISA_ESTRUTURAR_PAPEL_CADEIA',
    INCONSISTENTE: 'INCONSISTENTE'
  }[classificacao];
}
function executar(arquivoEntrada, pastaSaida) {
  const entrada = JSON.parse(fs.readFileSync(arquivoEntrada, 'utf8'));
  const registros = entrada.registros_consolidados.map((original) => {
    const classificacao_operacional = classificar(original);
    return {
      ...original,
      classificacao_operacional,
      prontidao_operacional: prontidao(classificacao_operacional),
      elegivel_para_rascunho_operacional: classificacao_operacional === 'REGRA_ESPECIFICA_DIRETA_EXECUTAVEL'
    };
  });
  const classes = ['REGRA_GERAL_RESIDUAL', 'REGRA_ESPECIFICA_DIRETA_EXECUTAVEL', 'REGRA_ESPECIFICA_PENDENTE_ESTRUTURACAO', 'REGRA_CONDICIONAL', 'PAPEL_CADEIA', 'INCONSISTENTE'];
  const estatisticas = Object.fromEntries(classes.map((classe) => [classe, registros.filter((r) => r.classificacao_operacional === classe).length]));
  const inconsistentes = registros.filter((r) => r.classificacao_operacional === 'INCONSISTENTE').map((r) => ({
    nbs: r.nbs, lc116: r.lc116, descricao: r.descricao, origens: r.origens,
    motivo: r.bloqueios_para_ativacao?.length ? r.bloqueios_para_ativacao : ['CHAVE_FISCAL_AUSENTE_OU_INVALIDA']
  }));
  const porId = new Map();
  registros.forEach((r) => {
    if (porId.has(r.id_proposto)) throw new Error(`Registro em duas classes: ${r.id_proposto}`);
    porId.set(r.id_proposto, r.classificacao_operacional);
  });
  const diretasComBloqueio = registros.filter((r) => r.classificacao_operacional === 'REGRA_ESPECIFICA_DIRETA_EXECUTAVEL' && (!semBloqueio(r) || !objetivo(r))).length;
  const residuaisElegiveis = registros.filter((r) => r.classificacao_operacional === 'REGRA_GERAL_RESIDUAL' && r.elegivel_para_rascunho_operacional).length;
  const resultado = {
    resumo: {
      total_consolidado: registros.length, soma_classificacoes: Object.values(estatisticas).reduce((a, b) => a + b, 0),
      registros_duplicados_entre_classes: 0, diretas_com_bloqueio: diretasComBloqueio,
      residuais_elegiveis_regra_especifica: residuaisElegiveis,
      alteracoes_banco: 'NENHUMA', alteracoes_supabase: 'NENHUMA', alteracoes_motor: 'NENHUMA'
    },
    registros_consolidados: registros,
    inconsistentes,
    estatisticas
  };
  fs.mkdirSync(pastaSaida, { recursive: true });
  fs.writeFileSync(path.join(pastaSaida, 'consolidacao_regras_pis_cofins_triagem_final.json'), JSON.stringify(resultado, null, 2));
  fs.writeFileSync(path.join(pastaSaida, 'lote_validacao_juridica_direta.json'), JSON.stringify(registros.filter((r) => r.classificacao_operacional === 'REGRA_ESPECIFICA_DIRETA_EXECUTAVEL'), null, 2));
  fs.writeFileSync(path.join(pastaSaida, 'lote_estruturacao_condicoes.json'), JSON.stringify(registros.filter((r) => ['REGRA_ESPECIFICA_PENDENTE_ESTRUTURACAO', 'REGRA_CONDICIONAL'].includes(r.classificacao_operacional)), null, 2));
  fs.writeFileSync(path.join(pastaSaida, 'lote_estruturacao_papel_cadeia.json'), JSON.stringify(registros.filter((r) => r.classificacao_operacional === 'PAPEL_CADEIA'), null, 2));
  return resultado;
}
if (require.main === module) {
  const raiz = path.resolve(__dirname, '..');
  const resultado = executar(process.argv[2] || path.join(raiz, 'outputs/consolidacao_regras_pis_cofins.json'), process.argv[3] || path.join(raiz, 'outputs'));
  console.log(JSON.stringify({ ...resultado.resumo, ...resultado.estatisticas }, null, 2));
}
module.exports = { classificar, prontidao, geralResidual, objetivo, executar };
