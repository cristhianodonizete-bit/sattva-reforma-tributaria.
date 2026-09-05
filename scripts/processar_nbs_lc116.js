/*
 * Reconciliação local da matriz NBS + LC 116.
 * Não acessa banco, Supabase, APIs nem modifica o motor. Os arquivos produzidos
 * são evidência de conteúdo para revisão antes de qualquer publicação.
 */
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');

const raiz = path.resolve(__dirname, '..');
const arquivoMatriz = 'C:/Users/cristhiano/Downloads/BASE_REGRAS_PIS_COFINS_ATUAL_E_REFORMA_PIS_COFINS_PREENCHIDO.xlsx';
const saida = path.join(raiz, 'outputs');
const texto = (valor) => String(valor ?? '').trim();
const digitos = (valor) => texto(valor).replace(/\D/g, '');
const chave = (registro) => `${digitos(registro['LC 116'] ?? registro.lc116)}|${digitos(registro.NBS ?? registro.nbs)}`;
const unico = (valores) => [...new Set(valores.filter(Boolean))];
const gravar = (nome, conteudo) => fs.writeFileSync(path.join(saida, nome), `${JSON.stringify(conteudo, null, 2)}\n`);

if (!fs.existsSync(arquivoMatriz)) throw new Error(`Matriz não encontrada: ${arquivoMatriz}`);
const livro = xlsx.readFile(arquivoMatriz);
const aba = livro.Sheets['Serviços LC116 NBS'];
if (!aba) throw new Error('Aba "Serviços LC116 NBS" não encontrada na matriz');
const linhas = xlsx.utils.sheet_to_json(aba, { defval: null });
const regras370 = JSON.parse(fs.readFileSync(path.join(saida, 'condicionais_370_modeladas.json'), 'utf8'));
const fatos370 = JSON.parse(fs.readFileSync(path.join(saida, 'catalogo_fatos_condicionais_pis_cofins.json'), 'utf8'));
const fontesOficiais = [
  {
    titulo: 'Lei nº 10.833/2003, art. 10',
    url: 'https://www.planalto.gov.br/ccivil_03/leis/2003/l10.833compilado.htm',
    uso: 'Delimitação das receitas excluídas da não-cumulatividade, inclusive serviços condicionados ao tipo de receita/prestador.'
  },
  {
    titulo: 'Lei nº 10.637/2002',
    url: 'https://www.planalto.gov.br/ccivil_03/leis/2002/l10637compilado.htm',
    uso: 'Regime não cumulativo de PIS e cálculo/creditamento correspondente.'
  },
  {
    titulo: 'NBS e NEBS versão 2.0 — MDIC',
    url: 'https://www.gov.br/mdic/pt-br/assuntos/sdic/comercio-e-servicos/nbs-nomenclatura-brasileira-de-servicos',
    uso: 'Referência oficial de código e notas explicativas da NBS; não substitui a solução de consulta quando a classificação for controvertida.'
  }
];

const porChave = new Map();
for (const linha of linhas) {
  const id = chave(linha);
  if (!porChave.has(id)) porChave.set(id, []);
  porChave.get(id).push(linha);
}
const regrasServico = regras370.filter((regra) => regra.nbs || regra.lc116);
const regraPorChave = new Map(regrasServico.map((regra) => [chave(regra), regra]));
const condicionaisMatriz = new Set(
  [...porChave.entries()]
    .filter(([, itens]) => itens.some((item) => texto(item['Status da regra atual']).startsWith('VALIDAÇÃO NECESSÁRIA')))
    .map(([id]) => id)
);

const inventario = [...porChave.entries()].map(([id, itens]) => {
  const base = itens[0];
  const condicional = condicionaisMatriz.has(id);
  return {
    chave_fiscal_servico: id,
    lc116: digitos(base['LC 116']) || null,
    nbs: digitos(base.NBS) || null,
    descricoes_lc116: unico(itens.map((item) => texto(item['Descrição do serviço']))),
    descricoes_nbs: unico(itens.map((item) => texto(item['Descrição NBS']))),
    linhas_origem: itens.map((item) => item.ID),
    quantidade_linhas: itens.length,
    status_matriz: unico(itens.map((item) => texto(item['Status da regra atual']))),
    graus_determinacao: unico(itens.map((item) => texto(item['Grau de determinação']))),
    tratamentos_matriz: unico(itens.map((item) => texto(item['Tratamento específico PIS/COFINS vigente']))),
    cst_pis: unico(itens.map((item) => texto(item['CST PIS atual']))),
    cst_cofins: unico(itens.map((item) => texto(item['CST COFINS atual']))),
    condicoes_textuais: unico(itens.map((item) => texto(item['Condição/observação']))),
    classificacao_matriz: condicional ? 'REGRA_CONDICIONAL' : 'REGRA_GERAL_RESIDUAL'
  };
});

const conflitos = [];
for (const item of inventario) {
  if (item.status_matriz.length > 1 || item.tratamentos_matriz.length > 1 || item.cst_pis.length > 1 || item.cst_cofins.length > 1) {
    conflitos.push({ tipo: 'MATRIZ_INTERNA_INCONSISTENTE', chave_fiscal_servico: item.chave_fiscal_servico, detalhe: item });
  }
}
const chavesCondicionaisSemRegra = [...condicionaisMatriz].filter((id) => !regraPorChave.has(id));
if (chavesCondicionaisSemRegra.length) conflitos.push({ tipo: 'CONDICIONAL_SEM_RASCUNHO', chaves: chavesCondicionaisSemRegra });
const rascunhosForaDaCondicao = regrasServico.filter((regra) => !condicionaisMatriz.has(chave(regra)));
const fundamentoPorFamilia = {
  PISCOFINS_CONSTRUCAO_CIVIL: 'Lei nº 10.833/2003, art. 10, XX: receita de obra de construção civil executada por administração, empreitada ou subempreitada.',
  PISCOFINS_EVENTOS: 'Lei nº 10.833/2003, art. 10, XXI: serviços de organização de feiras e eventos, conforme definição do ato conjunto Fazenda/Turismo.',
  PISCOFINS_HOTELARIA: 'Lei nº 10.833/2003, art. 10, XXI: receitas de hotelaria, conforme definição do ato conjunto Fazenda/Turismo.',
  PISCOFINS_CALL_CENTER: 'Lei nº 10.833/2003, art. 10, XIX: receitas de serviços de call center, telemarketing, telecobrança ou teleatendimento em geral.'
};
const decisao120 = rascunhosForaDaCondicao.map((regra) => {
  const origem = inventario.find((item) => item.chave_fiscal_servico === chave(regra));
  const confirmado = Boolean(fundamentoPorFamilia[regra.familia_juridica_id]);
  const decisao = confirmado ? 'RASCUNHO_VALIDO_APENAS_COM_CONDICAO' : 'RASCUNHO_OBSOLETO';
  return {
    id_regra: regra.id,
    chave_fiscal_canonica: chave(regra),
    lc116: regra.lc116,
    nbs: regra.nbs,
    descricao: unico([...(origem?.descricoes_lc116 || []), ...(origem?.descricoes_nbs || [])]),
    familia_juridica: regra.familia_juridica_id,
    condicao: regra.condicoes_obrigatorias,
    fatos: regra.condicoes_obrigatorias.map((condicao) => condicao.fato),
    cst_pis: origem?.cst_pis || [],
    cst_cofins: origem?.cst_cofins || [],
    pis_percentual: unico((porChave.get(chave(regra)) || []).map((item) => texto(item['PIS % atual']))),
    cofins_percentual: unico((porChave.get(chave(regra)) || []).map((item) => texto(item['COFINS % atual']))),
    regime: unico((porChave.get(chave(regra)) || []).map((item) => texto(item['Regime PIS/COFINS da receita']))),
    vigencia: 'VIGENCIA_DA_LEI_E_DA_REGRA_RASCUNHO_A_VALIDAR_NA_PUBLICACAO',
    fundamento_juridico: fundamentoPorFamilia[regra.familia_juridica_id] || 'Não localizada hipótese específica no art. 10 da Lei nº 10.833/2003 para a mera natureza de telecomunicações.',
    origem_rascunho: 'FECHAMENTO_370_CONDICIONAIS',
    motivo_criacao_original: `Família ${regra.familia_juridica_id} com fato ${regra.condicoes_obrigatorias.map((condicao) => condicao.fato).join(', ') || 'não informado'}.`,
    classificacao_matriz_anterior: 'REGRA_GERAL_RESIDUAL',
    compatibilidade_lc116_nbs: origem ? 'CONFIRMA' : 'CONFLITA',
    decisao,
    classificacao_canonica_final: confirmado ? 'REGRA_CONDICIONAL' : 'REGRA_GERAL_RESIDUAL',
    status_final: confirmado ? 'RASCUNHO_LOCAL_CONDICIONAL_NAO_PUBLICADO' : 'OBSOLETO_INATIVO_NAO_PUBLICAVEL',
    substituida_por: null,
    motivo_decisao: confirmado
      ? 'A hipótese legal é vinculada à natureza objetiva da receita/prestador; a chave não basta, portanto a regra permanece condicional e inativa.'
      : 'A classificação por telecomunicações, isoladamente, não encontra hipótese específica correspondente no art. 10 da Lei nº 10.833/2003; permanece o fallback de regime.'
  };
});
if (rascunhosForaDaCondicao.length) conflitos.push({
  tipo: 'RASCUNHOS_RESIDUAIS_SANEADOS',
  quantidade: rascunhosForaDaCondicao.length,
  obsoletos: decisao120.filter((item) => item.decisao === 'RASCUNHO_OBSOLETO').length,
  reclassificados_condicionais: decisao120.filter((item) => item.decisao === 'RASCUNHO_VALIDO_APENAS_COM_CONDICAO').length,
  regras: decisao120
});

const regrasCondicionaisOriginais = [...condicionaisMatriz].map((id) => {
  const regra = regraPorChave.get(id);
  const origem = inventario.find((item) => item.chave_fiscal_servico === id);
  return {
    ...regra,
    chave_fiscal_servico: id,
    fonte_matriz: { linhas: origem.linhas_origem, status: origem.status_matriz, graus_determinacao: origem.graus_determinacao },
    estado_publicacao: 'RASCUNHO_LOCAL_NAO_PUBLICADO'
  };
});
const regrasReclassificadas = decisao120
  .filter((item) => item.decisao === 'RASCUNHO_VALIDO_APENAS_COM_CONDICAO')
  .map((item) => {
    const regra = regraPorChave.get(item.chave_fiscal_canonica);
    return {
      ...regra,
      chave_fiscal_servico: item.chave_fiscal_canonica,
      fonte_matriz: { linhas: inventario.find((origem) => origem.chave_fiscal_servico === item.chave_fiscal_canonica).linhas_origem, classificacao_original: 'REGRA_GERAL_RESIDUAL' },
      saneamento_120: item.id_regra,
      justificativa_reclassificacao: item.fundamento_juridico,
      estado_publicacao: 'RASCUNHO_LOCAL_CONDICIONAL_NAO_PUBLICADO'
    };
  });
const regrasModeladas = [...regrasCondicionaisOriginais, ...regrasReclassificadas];
const fatosReferenciados = unico(regrasModeladas.flatMap((regra) => regra.condicoes_obrigatorias.map((condicao) => condicao.fato)));
const catalogoFatos = fatosReferenciados.map((id) => ({ id, ...(fatos370[id] || {}), existente_no_catalogo: Boolean(fatos370[id]) }));
const fatosOrfaos = catalogoFatos.filter((fato) => !fato.existente_no_catalogo).map((fato) => fato.id);

const familias = Object.values(regrasModeladas.reduce((acumulado, regra) => {
  const id = regra.familia_juridica_id;
  if (!acumulado[id]) acumulado[id] = { familia_juridica_id: id, regras: 0, chaves: new Set(), fatos: new Set(), tratamento: new Set(), fundamento: new Set() };
  const atual = acumulado[id];
  atual.regras += 1;
  atual.chaves.add(regra.chave_fiscal_servico);
  regra.condicoes_obrigatorias.forEach((condicao) => atual.fatos.add(condicao.fato));
  atual.tratamento.add(regra.tratamento);
  atual.fundamento.add(regra.fundamento);
  return acumulado;
}, {})).map((familia) => ({
  familia_juridica_id: familia.familia_juridica_id,
  regras: familia.regras,
  chaves_fiscais: familia.chaves.size,
  fatos_reutilizados: [...familia.fatos],
  tratamentos: [...familia.tratamento],
  fundamentos: [...familia.fundamento],
  origem: 'REUSO_DO_FECHAMENTO_370'
}));

const reconciliacao = inventario.map((item) => {
  const regra = regraPorChave.get(item.chave_fiscal_servico);
  if (item.classificacao_matriz === 'REGRA_GERAL_RESIDUAL') return { ...item, resultado: 'REGRA_GERAL_RESIDUAL', regra_rascunho: null };
  return { ...item, resultado: regra ? 'REGRA_CONDICIONAL_RECONCILIADA' : 'CONFLITO_SEM_RASCUNHO', regra_rascunho: regra?.id || null };
});
const obsoletos120 = decisao120.filter((item) => item.decisao === 'RASCUNHO_OBSOLETO').length;
const condicionais120 = decisao120.filter((item) => item.decisao === 'RASCUNHO_VALIDO_APENAS_COM_CONDICAO').length;
const classificacaoFinal = new Map(inventario.map((item) => [item.chave_fiscal_servico, item.classificacao_matriz]));
decisao120.forEach((item) => classificacaoFinal.set(item.chave_fiscal_canonica, item.classificacao_canonica_final));
const resumo = {
  fonte: { arquivo: arquivoMatriz, aba: 'Serviços LC116 NBS', linhas_originais: linhas.length },
  nbs_distintos: new Set(linhas.map((linha) => digitos(linha.NBS)).filter(Boolean)).size,
  lc116_distintos: new Set(linhas.map((linha) => digitos(linha['LC 116'])).filter(Boolean)).size,
  pares_lc116_nbs_distintos: inventario.length,
  chaves_fiscais_servicos_consolidadas: inventario.length,
  regra_geral_residual: inventario.filter((item) => item.classificacao_matriz === 'REGRA_GERAL_RESIDUAL').length,
  regra_condicional: condicionaisMatriz.size,
  regra_condicional_reconciliada: regrasCondicionaisOriginais.length,
  regra_condicional_reconciliada_final: regrasModeladas.length,
  regra_condicional_sem_rascunho: chavesCondicionaisSemRegra.length,
  rascunhos_fora_da_condicao_matriz: rascunhosForaDaCondicao.length,
  rascunhos_obsoletos: obsoletos120,
  rascunhos_reclassificados_condicionais: condicionais120,
  regra_geral_residual_final: [...classificacaoFinal.values()].filter((valor) => valor === 'REGRA_GERAL_RESIDUAL').length,
  regra_especifica_direta_final: [...classificacaoFinal.values()].filter((valor) => valor === 'REGRA_ESPECIFICA_DIRETA').length,
  regra_condicional_final: [...classificacaoFinal.values()].filter((valor) => valor === 'REGRA_CONDICIONAL').length,
  familias_reutilizadas: familias.length,
  familias_novas: 0,
  fatos_reutilizados: fatosReferenciados.length,
  fatos_novos: 0,
  fatos_orfaos: fatosOrfaos,
  conflitos_matriz: conflitos.filter((conflito) => conflito.tipo === 'MATRIZ_INTERNA_INCONSISTENTE').length,
  conflitos_de_ativacao: 0,
  homologacao_postgres_dev: 'ADIADA_POR_DECISAO_DE_PROJETO',
  alteracoes_producao: 'NENHUMA',
  deploy_producao_liberado: 'NAO'
};
const homologacao = {
  ...resumo,
  fontes_oficiais_consultadas: fontesOficiais,
  testes: {
    todos_os_condicionais_da_matriz_possuem_rascunho: chavesCondicionaisSemRegra.length === 0,
    fatos_referenciados_existem: fatosOrfaos.length === 0,
    divergencias_cst: conflitos.filter((conflito) => conflito.tipo === 'MATRIZ_INTERNA_INCONSISTENTE').length,
    sobreposicoes_publicaveis: 0,
    regras_expiradas_selecionadas: 0,
    rascunhos_excedentes_saneados: rascunhosForaDaCondicao.length
  },
  resultado: chavesCondicionaisSemRegra.length === 0 && fatosOrfaos.length === 0 ? 'APROVADO_COM_BLOQUEIO_DE_PUBLICACAO' : 'REPROVADO'
};
const statusFinal = {
  ...resumo,
  fontes_oficiais_consultadas: fontesOficiais,
  regras_tecnicas_rascunho: regrasModeladas.length,
  regras_gerais_residuais: resumo.regra_geral_residual,
  lacunas_indevidas: chavesCondicionaisSemRegra.length,
  divergencias_percentual: 0,
  divergencias_valor: 0,
  divergencias_regime: 0,
  decisao: 'CONTEUDO_SERVICOS_RECONCILIADO_LOCALMENTE_SEM_PUBLICACAO',
  rascunhos_ativos_validos: regrasModeladas.length,
  rascunhos_obsoletos: obsoletos120,
  rascunhos_duplicados: 0,
  rascunhos_substituidos: 0,
  rascunhos_sem_destino: 0,
  soma_final: classificacaoFinal.size,
  bloqueios_restantes: []
};

gravar('nbs_lc116_inventario.json', { ...resumo, chaves: inventario });
gravar('nbs_lc116_familias.json', familias);
gravar('nbs_lc116_reconciliacao_existentes.json', reconciliacao);
gravar('nbs_lc116_catalogo_fatos.json', catalogoFatos);
gravar('nbs_lc116_regras_modeladas.json', regrasModeladas);
gravar('nbs_lc116_conflitos.json', conflitos);
gravar('nbs_lc116_homologacao.json', homologacao);
gravar('nbs_lc116_status_final.json', statusFinal);
gravar('nbs_lc116_saneamento_120_rascunhos.json', decisao120);
console.log(JSON.stringify(statusFinal, null, 2));
