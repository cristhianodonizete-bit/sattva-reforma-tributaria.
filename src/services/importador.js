/**
 * IMPORTAÇÃO DE PLANILHAS (xlsx / xls / csv)
 * ---------------------------------------------------------------------------
 * Reconhece as colunas pelo NOME do cabeçalho (não pela posição), aceitando
 * variações de acento, caixa e espaçamento. Isso evita o problema clássico de
 * "a planilha ganhou uma coluna nova e o importador quebrou".
 */
const XLSX = require('xlsx');
const P = require('../config/parametros');

const normalizar = (s) => String(s == null ? '' : s)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

// Sinônimos aceitos por campo
const CAMPOS_PARCEIRO = {
  cnpj: ['cnpj', 'cpfcnpj', 'cnpjcpf', 'inscrfederal', 'inscricaofederal', 'documento', 'cpf'],
  descricao: ['descricao', 'nome', 'razaosocial', 'nomefornecedor', 'nomecliente', 'participante', 'fantasia'],
  regime: ['regimetributario', 'regime', 'tributacao', 'enquadramento'],
  uf: ['uf', 'estado'],
  municipio: ['municipio', 'cidade'],
};

const CAMPOS_MOVIMENTO = {
  nome: ['nomefornecedor', 'nomecliente', 'nome', 'razaosocial', 'participante', 'fornecedor', 'cliente'],
  inscr_federal: ['inscrfederalfornecedor', 'inscrfederalcliente', 'inscrfederal', 'inscricaofederal', 'cnpj', 'cpfcnpj', 'cnpjcpf', 'documento'],
  descricao: ['descricaoproduto', 'descricao', 'produto', 'servico', 'item', 'historico'],
  ncm: ['ncm', 'ncmsh', 'codigoncm'],
  nbs: ['nbs', 'codigonbs'],
  cfop: ['cfop'],
  cst: ['cst', 'csosn', 'situacaotributaria'],
  competencia: ['competencia', 'periodo', 'mesano', 'data', 'dataemissao'],
  valor: ['valor', 'valortotal', 'valoroperacao', 'vlrtotal', 'total', 'valorcontabil'],
  base_calculo: ['basecalculo', 'basedecalculo', 'basecalc', 'bc', 'baseicms', 'basecalculoicms'],
  icms: ['icms', 'valoricms', 'vlricms'],
  icms_st: ['icmsst', 'valoricmsst', 'st', 'substituicaotributaria'],
  ipi: ['ipi', 'valoripi'],
  pis: ['pis', 'valorpis'],
  cofins: ['cofins', 'valorcofins'],
  iss: ['iss', 'valoriss', 'issqn'],
  impostos: ['impostos', 'totalimpostos', 'tributos', 'valorimpostos'],
  reducao: ['reducao', 'enquadramentoiva', 'regimeiva', 'reducaoaliquota'],
};

// Sinônimos de regime tributário no texto da planilha
const REGIME_ALIASES = {
  lucro_real: ['lucroreal', 'real', 'lr'],
  lucro_presumido: ['lucropresumido', 'presumido', 'lp'],
  simples_nacional: ['simplesnacional', 'simples', 'sn', 'optantesimples'],
  simples_regime_regular: ['simplesregimeregular', 'simplesregular', 'snregular'],
  mei: ['mei', 'microempreendedorindividual'],
  produtor_rural_pf: ['produtorrural', 'ruralpf', 'produtorruralpf', 'pfrural'],
  imune_isento: ['imune', 'isento', 'imuneisento', 'terceirosetor'],
  pessoa_fisica: ['pessoafisica', 'pf', 'consumidorfinal', 'fisica'],
  orgao_publico: ['orgaopublico', 'publico', 'entepublico', 'administracaopublica', 'governo'],
  exterior: ['exterior', 'exportacao', 'importacao', 'estrangeiro'],
};

function resolverRegime(valor, padrao = 'lucro_real') {
  const n = normalizar(valor);
  if (!n) return padrao;
  if (P.REGIMES[valor]) return valor;
  for (const [chave, alias] of Object.entries(REGIME_ALIASES)) {
    if (alias.some((a) => n === a || n.includes(a))) return chave;
  }
  return padrao;
}

function resolverReducao(valor) {
  const n = normalizar(valor);
  if (!n) return 'integral';
  if (P.REDUCOES[valor]) return valor;
  if (n.includes('60')) return 'reducao_60';
  if (n.includes('30')) return 'reducao_30';
  if (n.includes('zero') || n.includes('cesta') || n.includes('100')) return 'reducao_100';
  if (n.includes('imune') || n.includes('export')) return 'imune';
  if (n.includes('especif') || n.includes('monofas')) return 'especifico';
  return 'integral';
}

function numeroBR(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[R$\s]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

function lerPlanilha(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true, raw: false });
  const nome = wb.SheetNames[0];
  const linhas = XLSX.utils.sheet_to_json(wb.Sheets[nome], { defval: '', raw: false });
  return { aba: nome, abas: wb.SheetNames, linhas };
}

/** Constrói o mapa cabeçalho-real -> campo-canônico */
function mapearColunas(linha, dicionario) {
  const mapa = {};
  for (const cabecalho of Object.keys(linha)) {
    const n = normalizar(cabecalho);
    for (const [campo, alias] of Object.entries(dicionario)) {
      if (mapa[campo]) continue;
      if (alias.includes(n)) { mapa[campo] = cabecalho; break; }
    }
  }
  // segunda passada: correspondência parcial (cabeçalhos longos)
  for (const cabecalho of Object.keys(linha)) {
    const n = normalizar(cabecalho);
    for (const [campo, alias] of Object.entries(dicionario)) {
      if (mapa[campo]) continue;
      if (alias.some((a) => a.length >= 4 && n.includes(a))) { mapa[campo] = cabecalho; break; }
    }
  }
  return mapa;
}

/** Importa cadastro de clientes/fornecedores */
function importarParceiros(buffer, tipo) {
  const { linhas, aba } = lerPlanilha(buffer);
  if (!linhas.length) return { registros: [], mensagens: ['Planilha vazia.'], aba, mapa: {} };
  const mapa = mapearColunas(linhas[0], CAMPOS_PARCEIRO);
  const mensagens = [];
  if (!mapa.cnpj) mensagens.push('Coluna de CNPJ não encontrada — verifique o cabeçalho (aceita "CNPJ", "Inscr Federal", "Documento").');
  if (!mapa.regime) mensagens.push('Coluna de regime tributário não encontrada — todos os registros assumirão Lucro Real. Corrija antes de rodar o diagnóstico.');

  const registros = [];
  let ignorados = 0;
  for (const l of linhas) {
    const cnpj = soDigitos(mapa.cnpj ? l[mapa.cnpj] : '');
    const descricao = String(mapa.descricao ? l[mapa.descricao] : '').trim();
    if (!cnpj && !descricao) { ignorados++; continue; }
    registros.push({
      tipo, cnpj,
      descricao: descricao || cnpj,
      regime: resolverRegime(mapa.regime ? l[mapa.regime] : ''),
      uf: mapa.uf ? String(l[mapa.uf]).trim().toUpperCase().slice(0, 2) : '',
      municipio: mapa.municipio ? String(l[mapa.municipio]).trim() : '',
    });
  }
  return { registros, ignorados, mensagens, aba, mapa, colunas: Object.keys(linhas[0]) };
}

/** Importa movimentação (entradas de fornecedores ou saídas para clientes) */
function importarMovimentos(buffer, tipo) {
  const { linhas, aba } = lerPlanilha(buffer);
  if (!linhas.length) return { registros: [], mensagens: ['Planilha vazia.'], aba, mapa: {} };
  const mapa = mapearColunas(linhas[0], CAMPOS_MOVIMENTO);
  const mensagens = [];
  if (!mapa.valor) mensagens.push('Coluna de VALOR não encontrada — a importação não terá base para cálculo.');
  if (!mapa.inscr_federal) mensagens.push('Coluna de inscrição federal (CNPJ/CPF) não encontrada — não será possível cruzar com o cadastro de regimes.');
  const semImposto = !mapa.icms && !mapa.pis && !mapa.cofins && !mapa.iss && !mapa.impostos;
  if (semImposto) mensagens.push('Nenhuma coluna de imposto encontrada — o sistema vai ESTIMAR os tributos pelo regime do parceiro (marcado como estimativa nos relatórios).');

  const registros = [];
  let ignorados = 0;
  for (const l of linhas) {
    const valor = numeroBR(mapa.valor ? l[mapa.valor] : 0);
    const insc = soDigitos(mapa.inscr_federal ? l[mapa.inscr_federal] : '');
    const nome = String(mapa.nome ? l[mapa.nome] : '').trim();
    if (!valor && !insc && !nome) { ignorados++; continue; }

    let icms = numeroBR(mapa.icms ? l[mapa.icms] : 0);
    let pis = numeroBR(mapa.pis ? l[mapa.pis] : 0);
    let cofins = numeroBR(mapa.cofins ? l[mapa.cofins] : 0);
    let iss = numeroBR(mapa.iss ? l[mapa.iss] : 0);
    const ipi = numeroBR(mapa.ipi ? l[mapa.ipi] : 0);
    const icmsSt = numeroBR(mapa.icms_st ? l[mapa.icms_st] : 0);

    // Coluna única "impostos": rateio proporcional entre PIS/COFINS e ICMS ou ISS
    if (!icms && !pis && !cofins && !iss && mapa.impostos) {
      const total = numeroBR(l[mapa.impostos]);
      if (total) {
        const eServico = !mapa.ncm || !String(l[mapa.ncm] || '').trim();
        pis = total * 0.08; cofins = total * 0.37;
        if (eServico) iss = total - pis - cofins; else icms = total - pis - cofins;
      }
    }

    registros.push({
      tipo, nome: nome || insc, inscr_federal: insc,
      descricao: String(mapa.descricao ? l[mapa.descricao] : '').trim(),
      ncm: soDigitos(mapa.ncm ? l[mapa.ncm] : ''),
      nbs: String(mapa.nbs ? l[mapa.nbs] : '').trim(),
      cfop: soDigitos(mapa.cfop ? l[mapa.cfop] : ''),
      cst: String(mapa.cst ? l[mapa.cst] : '').trim(),
      competencia: String(mapa.competencia ? l[mapa.competencia] : '').trim(),
      valor,
      base_calculo: numeroBR(mapa.base_calculo ? l[mapa.base_calculo] : 0) || valor,
      icms, icms_st: icmsSt, ipi, pis, cofins, iss,
      reducao: resolverReducao(mapa.reducao ? l[mapa.reducao] : ''),
    });
  }
  return { registros, ignorados, mensagens, aba, mapa, colunas: Object.keys(linhas[0]) };
}

/** Gera os modelos de planilha para download */
function gerarModelo(tipo) {
  const wb = XLSX.utils.book_new();
  let dados = [], nomeAba = 'Modelo';

  if (tipo === 'parceiros') {
    nomeAba = 'Cadastro';
    dados = [
      { 'CNPJ': '12.345.678/0001-90', 'Descrição': 'FORNECEDOR EXEMPLO LTDA', 'Regime Tributário': 'Lucro Real', 'UF': 'MG', 'Município': 'Uberlândia' },
      { 'CNPJ': '98.765.432/0001-10', 'Descrição': 'PRESTADOR EXEMPLO ME', 'Regime Tributário': 'Simples Nacional', 'UF': 'SP', 'Município': 'São Paulo' },
      { 'CNPJ': '11.222.333/0001-44', 'Descrição': 'CLIENTE INDUSTRIA SA', 'Regime Tributário': 'Lucro Presumido', 'UF': 'MG', 'Município': 'Uberaba' },
    ];
  } else if (tipo === 'referencias_servicos') {
    nomeAba = 'Referências fiscais';
    dados = [
      { 'Descrição do serviço': 'CONSULTORIA TRIBUTÁRIA', 'NBS': '111032200', 'PIS/COFINS': '9,25%', 'DAS efetivo': '', 'ISS': '2,00%' },
      { 'Descrição do serviço': 'SUPORTE OPERACIONAL', 'NBS': '', 'PIS/COFINS': '', 'DAS efetivo': '6,50%', 'ISS': '2,00%' },
    ];
  } else {
    nomeAba = tipo === 'movimento_cliente' ? 'Saidas' : 'Entradas';
    const rotulo = tipo === 'movimento_cliente' ? 'Cliente' : 'Fornecedor';
    dados = [
      { [`Nome ${rotulo}`]: 'FORNECEDOR EXEMPLO LTDA', [`InscrFederal ${rotulo}`]: '12.345.678/0001-90',
        'Descrição Produto': 'MATERIA PRIMA X', 'NCM': '39269090', 'Competência': '2026-01',
        'Valor': 10000, 'Base de Cálculo': 10000, 'ICMS': 1800, 'ICMS ST': 0, 'IPI': 0,
        'PIS': 165, 'COFINS': 760, 'ISS': 0, 'Redução': 'Integral' },
      { [`Nome ${rotulo}`]: 'PRESTADOR EXEMPLO ME', [`InscrFederal ${rotulo}`]: '98.765.432/0001-10',
        'Descrição Produto': 'SERVICO DE MANUTENCAO', 'NCM': '', 'Competência': '2026-01',
        'Valor': 5000, 'Base de Cálculo': 5000, 'ICMS': 0, 'ICMS ST': 0, 'IPI': 0,
        'PIS': 0, 'COFINS': 0, 'ISS': 150, 'Redução': 'Integral' },
    ];
  }

  const ws = XLSX.utils.json_to_sheet(dados);
  ws['!cols'] = Object.keys(dados[0]).map((k) => ({ wch: Math.max(16, k.length + 4) }));
  XLSX.utils.book_append_sheet(wb, ws, nomeAba);

  // Aba de instruções
  const instr = [
    { Campo: 'Regime Tributário', 'Valores aceitos': 'Lucro Real, Lucro Presumido, Simples Nacional, Simples Regime Regular, MEI, Produtor Rural PF, Imune/Isento, Pessoa Física, Órgão Público, Exterior' },
    { Campo: 'Redução', 'Valores aceitos': 'Integral, Redução 30%, Redução 60%, Alíquota Zero, Imune, Específico' },
    { Campo: 'Valores', 'Valores aceitos': 'Aceita 1.234,56 ou 1234.56' },
    { Campo: 'Colunas', 'Valores aceitos': 'A ordem não importa. O sistema identifica pelo nome do cabeçalho e ignora acentos e maiúsculas.' },
    { Campo: 'Impostos', 'Valores aceitos': 'Se não houver colunas de imposto, o sistema estima pelo regime. Uma coluna única "Impostos" também é aceita.' },
    ...(tipo === 'referencias_servicos' ? [{ Campo: 'Referências fiscais', 'Valores aceitos': 'Informe Descrição do serviço e ao menos PIS/COFINS ou DAS efetivo. As alíquotas aceitam 9,25% ou 0,0925. NBS é opcional.' }] : []),
  ];
  const wsI = XLSX.utils.json_to_sheet(instr);
  wsI['!cols'] = [{ wch: 24 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(wb, wsI, 'Instruções');

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

module.exports = { importarParceiros, importarMovimentos, gerarModelo, resolverRegime, resolverReducao, numeroBR, soDigitos, lerPlanilha };
