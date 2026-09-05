/*
 * Estrutura rascunhos juridicamente validados para futura homologação.
 * Não abre banco, não conecta Supabase e não ativa regra alguma.
 */
const fs = require('fs');
const path = require('path');

const STATUS_PRONTOS = new Set(['VALIDADA_ZERO_MANTIDO', 'VALIDADA_COM_REDUCAO_LC224']);
const PRIORIDADE_REGRA_ESPECIFICA = 50; // mesma convenção das regras específicas existentes
const DATA_CORTE_LC224 = '2026-04-01';
const DATA_FIM_HISTORICA = '2026-03-31';

function idSeguro(...partes) {
  return partes.join('_').replace(/[^A-Za-z0-9_]/g, '_');
}

function fundamento(registro, modificador = false) {
  const original = {
    lei: registro.lei, artigo: registro.artigo, inciso: registro.inciso,
    alinea_item: registro.alinea || null, texto: registro.fundamento_legal_original,
  };
  return {
    original,
    modificador_lc224: modificador ? { lei: 'LC 224/2025', texto: registro.fundamento_lc224, vigencia_inicio: DATA_CORTE_LC224 } : null,
  };
}

function base(registro, sufixo, { vigencia_inicio, vigencia_fim = null, regime = 'TODOS', pis_percentual, cofins_percentual, tratamento_resultante, modificador = false }) {
  return {
    id: idSeguro('RASCUNHO', registro.id_proposto, sufixo, regime),
    status: 'RASCUNHO',
    familia: registro.familia_legal,
    tipo_chave: 'NCM', ncm: registro.ncm, nbs: null,
    tipo_operacao: null, direcao: null,
    // Campo que a futura importação poderá mapear para regime_fornecedor,
    // sem criar nova coluna nem alterar a tabela nesta etapa.
    regime,
    regime_fornecedor: regime === 'REGIME_CUMULATIVO' ? 'CUMULATIVO' : regime === 'REGIME_NAO_CUMULATIVO' ? 'NAO_CUMULATIVO' : null,
    tratamento_resultante, cst_pis: registro.cst_pis, cst_cofins: registro.cst_cofins,
    pis_percentual, cofins_percentual,
    vigencia_inicio, vigencia_fim,
    fundamento_legal: fundamento(registro, modificador),
    prioridade_proposta: PRIORIDADE_REGRA_ESPECIFICA,
    prioridade_convencao: 'REGRA_ESPECIFICA > REGRA_GERAL_RESIDUAL',
    versao_proposta: modificador ? 2 : 1,
    origem: 'MAPEAMENTO_LEGAL_76_DIRETAS',
    rastreabilidade: {
      id_registro_juridico_origem: registro.id_proposto,
      ncm: registro.ncm, fonte_matriz: 'outputs/mapeamento_legal_76_diretas.json',
      fontes_oficiais_utilizadas: registro.fontes_oficiais,
      status_validacao_juridica: registro.status_validacao,
      data_estruturacao: new Date().toISOString(),
    },
  };
}

function modelar(registro) {
  if (registro.status_validacao === 'VALIDADA_ZERO_MANTIDO') {
    return [base(registro, 'ZERO', {
      vigencia_inicio: null, pis_percentual: 0, cofins_percentual: 0,
      tratamento_resultante: 'ALIQUOTA_ZERO_PIS_COFINS',
    })];
  }
  if (registro.status_validacao === 'VALIDADA_COM_REDUCAO_LC224') {
    return [
      base(registro, 'HISTORICA_ZERO', {
        vigencia_inicio: null, vigencia_fim: DATA_FIM_HISTORICA, pis_percentual: 0, cofins_percentual: 0,
        tratamento_resultante: 'ALIQUOTA_ZERO_PIS_COFINS',
      }),
      base(registro, 'LC224', {
        vigencia_inicio: DATA_CORTE_LC224, regime: 'REGIME_CUMULATIVO',
        pis_percentual: registro.pis_cumulativo, cofins_percentual: registro.cofins_cumulativo,
        tratamento_resultante: 'BENEFICIO_REDUZIDO_LC224', modificador: true,
      }),
      base(registro, 'LC224', {
        vigencia_inicio: DATA_CORTE_LC224, regime: 'REGIME_NAO_CUMULATIVO',
        pis_percentual: registro.pis_nao_cumulativo, cofins_percentual: registro.cofins_nao_cumulativo,
        tratamento_resultante: 'BENEFICIO_REDUZIDO_LC224', modificador: true,
      }),
    ];
  }
  return [];
}

function sobrepoe(a, b) {
  if (a.ncm !== b.ncm || a.regime !== b.regime) return false;
  const ai = a.vigencia_inicio || '0000-01-01'; const af = a.vigencia_fim || '9999-12-31';
  const bi = b.vigencia_inicio || '0000-01-01'; const bf = b.vigencia_fim || '9999-12-31';
  return ai <= bf && bi <= af;
}

function validar(registros, rascunhos, totalProntos) {
  const condicionais = registros.filter((r) => r.status_validacao === 'RECLASSIFICADA_COMO_CONDICIONAL').map((r) => r.id_proposto);
  const revisao = registros.filter((r) => r.status_validacao === 'PRECISA_REVISAO_JURIDICA').map((r) => r.id_proposto);
  const sobrepostas = [];
  for (let i = 0; i < rascunhos.length; i += 1) for (let j = i + 1; j < rascunhos.length; j += 1) if (sobrepoe(rascunhos[i], rascunhos[j])) sobrepostas.push([rascunhos[i].id, rascunhos[j].id]);
  const foraContrato = rascunhos.filter((r) => !Number.isFinite(r.pis_percentual) || !Number.isFinite(r.cofins_percentual) || r.pis_percentual < 0 || r.cofins_percentual < 0 || r.pis_percentual > 100 || r.cofins_percentual > 100);
  const lc224Ncms = registros.filter((r) => r.status_validacao === 'VALIDADA_COM_REDUCAO_LC224').map((r) => r.ncm);
  const lc224Incompletos = lc224Ncms.filter((ncm) => {
    const rs = rascunhos.filter((r) => r.ncm === ncm);
    return !rs.some((r) => r.vigencia_fim === DATA_FIM_HISTORICA) || !rs.some((r) => r.regime === 'REGIME_CUMULATIVO' && r.vigencia_inicio === DATA_CORTE_LC224) || !rs.some((r) => r.regime === 'REGIME_NAO_CUMULATIVO' && r.vigencia_inicio === DATA_CORTE_LC224);
  });
  const incluidos = new Set(rascunhos.map((r) => r.rastreabilidade.id_registro_juridico_origem));
  return {
    registros_prontos_esperados: totalProntos, registros_modelados: incluidos.size,
    condicionais_indevidamente_incluidos: condicionais.filter((id) => incluidos.has(id)),
    revisao_juridica_indevidamente_incluida: revisao.filter((id) => incluidos.has(id)),
    regras_ativas: rascunhos.filter((r) => r.status === 'ATIVA').length,
    vigencias_sobrepostas: sobrepostas, percentuais_fora_do_contrato: foraContrato.map((r) => r.id),
    lc224_incompletos: lc224Incompletos,
  };
}

function executar(arquivo, destino) {
  const entrada = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const registros = entrada.registros || [];
  const prontos = registros.filter((r) => STATUS_PRONTOS.has(r.status_validacao));
  if (prontos.length !== 72) throw new Error(`Esperados 72 registros juridicamente prontos; encontrados ${prontos.length}.`);
  const rascunhos = prontos.flatMap(modelar);
  const validacao = validar(registros, rascunhos, prontos.length);
  const resumo = {
    modo: 'SOMENTE_LEITURA_LOCAL', gerado_em: new Date().toISOString(),
    registros_juridicos_prontos: prontos.length, registros_modelados: new Set(rascunhos.map((r) => r.rastreabilidade.id_registro_juridico_origem)).size,
    regras_modeladas: rascunhos.length,
    zero_mantido_modelados: prontos.filter((r) => r.status_validacao === 'VALIDADA_ZERO_MANTIDO').length,
    lc224_modelados: prontos.filter((r) => r.status_validacao === 'VALIDADA_COM_REDUCAO_LC224').length,
    regras_historicas_ate_20260331: rascunhos.filter((r) => r.vigencia_fim === DATA_FIM_HISTORICA).length,
    regras_desde_20260401: rascunhos.filter((r) => r.vigencia_inicio === DATA_CORTE_LC224).length,
    ...validacao,
    alteracoes_banco: 'NENHUMA', alteracoes_supabase: 'NENHUMA', migration_aplicada_producao: 'NAO',
  };
  if (validacao.condicionais_indevidamente_incluidos.length || validacao.revisao_juridica_indevidamente_incluida.length || validacao.regras_ativas || validacao.vigencias_sobrepostas.length || validacao.percentuais_fora_do_contrato.length || validacao.lc224_incompletos.length) throw new Error(`Validação dos rascunhos falhou: ${JSON.stringify(validacao)}`);
  fs.mkdirSync(destino, { recursive: true });
  const arquivoRascunhos = path.join(destino, 'rascunhos_modelados_72_regras.json');
  const arquivoResumo = path.join(destino, 'rascunhos_modelados_72_regras_resumo.json');
  fs.writeFileSync(arquivoRascunhos, JSON.stringify({ resumo, rascunhos }, null, 2));
  fs.writeFileSync(arquivoResumo, JSON.stringify(resumo, null, 2));
  return { resumo, arquivoRascunhos, arquivoResumo, rascunhos };
}

if (require.main === module) {
  const raiz = path.resolve(__dirname, '..');
  console.log(JSON.stringify(executar(path.join(raiz, 'outputs/mapeamento_legal_76_diretas.json'), path.join(raiz, 'outputs')), null, 2));
}
module.exports = { executar, modelar, validar, sobrepoe };
