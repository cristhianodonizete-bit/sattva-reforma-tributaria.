/**
 * IMPORTAÇÃO DE XML FISCAL  (itens 2, 3 e 4)
 * ---------------------------------------------------------------------------
 * Converte NF-e, NFC-e, CT-e e NFS-e para a estrutura comum de análise,
 * preservando SEMPRE os valores originais do documento.
 *
 * Parser próprio, sem dependência externa: os XMLs fiscais brasileiros têm
 * estrutura previsível e o volume por lote é alto, então um leitor tolerante a
 * namespaces (`nfe:det`, `det`) e a variações de leiaute resolve melhor do que
 * uma biblioteca genérica.
 *
 * SENTIDO DA OPERAÇÃO (item 4): comparação do CNPJ da empresa analisada com
 * emitente e destinatário.
 *   empresa = destinatário → ENTRADA / fornecedor
 *   empresa = emitente     → SAÍDA / cliente
 *   nenhum dos dois        → REQUER VALIDAÇÃO
 */

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');
// A lista de serviços da LC 116 é persistida no formato operacional de quatro
// dígitos: 1.05 → 0105. Isso evita que a mesma evidência apareça como 105 em
// alguns XMLs e 0105 em outros.
const itemLc116 = (v) => {
  const d = soDigitos(v);
  return d ? d.slice(0, 4).padStart(4, '0') : '';
};
const numero = (v) => { const n = Number(String(v == null ? '' : v).replace(',', '.')); return Number.isFinite(n) ? n : 0; };

/** Remove o prefixo de namespace da tag: `nfe:det` → `det` */
const semNs = (t) => t.replace(/^[^:]+:/, '');

/** Extrai o conteúdo da PRIMEIRA ocorrência da tag dentro do escopo */
function tag(xml, nome) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nome}>`, 'i');
  const m = xml.match(re);
  return m ? m[1] : '';
}
/** Valor textual de uma tag folha, já sem CDATA */
function valor(xml, nome) {
  const t = tag(xml, nome);
  if (!t) return '';
  return t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
}
/** Primeiro valor encontrado entre vários nomes possíveis */
function primeiro(xml, nomes) {
  for (const n of nomes) { const v = valor(xml, n); if (v) return v; }
  return '';
}
/** Todas as ocorrências de um bloco */
function blocos(xml, nome) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${nome}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.-]+:)?${nome}>`, 'gi');
  const out = []; let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/** Identifica o tipo de documento pelo elemento raiz */
function identificar(xml) {
  if (/<(?:[\w.-]+:)?infNFe\b/i.test(xml)) return /<mod>65<\/mod>/i.test(xml) ? 'nfce' : 'nfe';
  if (/<(?:[\w.-]+:)?infCte\b/i.test(xml)) return 'cte';
  if (/<(?:[\w.-]+:)?infNFSe\b/i.test(xml) || /<(?:[\w.-]+:)?InfDPS\b/i.test(xml)
      || /<(?:[\w.-]+:)?NFSe\b/i.test(xml)) return 'nfse';
  if (/<(?:[\w.-]+:)?infNFCom\b/i.test(xml)) return 'nfcom';
  return 'desconhecido';
}

// ==========================================================================
// NF-e / NFC-e
// ==========================================================================
function lerNfe(xml) {
  const inf = tag(xml, 'infNFe') || xml;
  const ide = tag(inf, 'ide');
  const emit = tag(inf, 'emit');
  const dest = tag(inf, 'dest');
  const total = tag(tag(inf, 'total'), 'ICMSTot');

  const chaveM = xml.match(/Id="?NFe(\d{44})"?/i);
  const cabecalho = {
    tipo: 'nfe',
    chave: chaveM ? chaveM[1] : '',
    documento: `${valor(ide, 'serie') || '1'}/${valor(ide, 'nNF')}`,
    numero: valor(ide, 'nNF'),
    data_emissao: (valor(ide, 'dhEmi') || valor(ide, 'dEmi') || '').slice(0, 10),
    natureza_operacao: valor(ide, 'natOp'),
    tipo_operacao: valor(ide, 'tpNF'),          // 0 entrada, 1 saída (na ótica do emitente)
    emitente_cnpj: soDigitos(primeiro(emit, ['CNPJ', 'CPF'])),
    emitente_nome: valor(emit, 'xNome'),
    emitente_uf: valor(tag(emit, 'enderEmit'), 'UF'),
    emitente_crt: valor(emit, 'CRT'),           // 1 Simples, 2 Simples excesso, 3 Regime normal
    destinatario_cnpj: soDigitos(primeiro(dest, ['CNPJ', 'CPF'])),
    destinatario_nome: valor(dest, 'xNome'),
    destinatario_uf: valor(tag(dest, 'enderDest'), 'UF'),
    indIEDest: valor(dest, 'indIEDest'),         // 9 = não contribuinte
    valor_total: numero(valor(total, 'vNF')),
  };

  const itens = blocos(inf, 'det').map((det, i) => {
    const prod = tag(det, 'prod');
    const imp = tag(det, 'imposto');
    const icmsBloco = tag(imp, 'ICMS');
    const ipiBloco = tag(imp, 'IPI');
    const pisBloco = tag(imp, 'PIS');
    const cofinsBloco = tag(imp, 'COFINS');
    const numM = det.match(/nItem="?(\d+)"?/);

    return {
      item_numero: numM ? Number(numM[1]) : (i + 1),
      codigo_produto: valor(prod, 'cProd'),
      descricao: valor(prod, 'xProd'),
      ncm: soDigitos(valor(prod, 'NCM')),
      cfop: soDigitos(valor(prod, 'CFOP')),
      unidade: valor(prod, 'uCom'),
      quantidade: numero(valor(prod, 'qCom')),
      valor: numero(valor(prod, 'vProd')),
      frete: numero(valor(prod, 'vFrete')),
      seguro: numero(valor(prod, 'vSeg')),
      outras: numero(valor(prod, 'vOutro')),
      desconto: numero(valor(prod, 'vDesc')),
      cst: valor(icmsBloco, 'CST'),
      csosn: valor(icmsBloco, 'CSOSN'),
      base_calculo: numero(valor(icmsBloco, 'vBC')),
      icms: numero(valor(icmsBloco, 'vICMS')),
      icms_st: numero(valor(icmsBloco, 'vICMSST')),
      ipi: numero(valor(ipiBloco, 'vIPI')),
      pis: numero(valor(pisBloco, 'vPIS')),
      cofins: numero(valor(cofinsBloco, 'vCOFINS')),
      pis_cofins_documentado: Boolean(pisBloco || cofinsBloco),
      iss: 0,
    };
  });

  return { cabecalho, itens };
}

// ==========================================================================
// CT-e
// ==========================================================================
function lerCte(xml) {
  const inf = tag(xml, 'infCte') || xml;
  const ide = tag(inf, 'ide');
  const emit = tag(inf, 'emit');
  const dest = tag(inf, 'dest') || tag(inf, 'rem');
  const vPrest = tag(inf, 'vPrest');
  const icms = tag(tag(inf, 'imp'), 'ICMS');
  const chaveM = xml.match(/Id="?CTe(\d{44})"?/i);

  const cabecalho = {
    tipo: 'cte',
    chave: chaveM ? chaveM[1] : '',
    documento: `${valor(ide, 'serie') || '1'}/${valor(ide, 'nCT')}`,
    numero: valor(ide, 'nCT'),
    data_emissao: (valor(ide, 'dhEmi') || '').slice(0, 10),
    natureza_operacao: valor(ide, 'natOp') || 'Prestação de serviço de transporte',
    emitente_cnpj: soDigitos(primeiro(emit, ['CNPJ', 'CPF'])),
    emitente_nome: valor(emit, 'xNome'),
    emitente_uf: valor(tag(emit, 'enderEmit'), 'UF'),
    emitente_crt: valor(emit, 'CRT'),
    destinatario_cnpj: soDigitos(primeiro(dest, ['CNPJ', 'CPF'])),
    destinatario_nome: valor(dest, 'xNome'),
    valor_total: numero(valor(vPrest, 'vTPrest')),
  };
  const itens = [{
    item_numero: 1,
    descricao: `Serviço de transporte — CFOP ${valor(ide, 'CFOP')}`,
    ncm: '', nbs: '',
    cfop: soDigitos(valor(ide, 'CFOP')),
    quantidade: 1,
    valor: numero(valor(vPrest, 'vTPrest')),
    base_calculo: numero(valor(icms, 'vBC')),
    icms: numero(valor(icms, 'vICMS')),
    cst: valor(icms, 'CST'), csosn: '',
    icms_st: 0, ipi: 0, pis: 0, cofins: 0, iss: 0,
  }];
  return { cabecalho, itens };
}

// ==========================================================================
// NFS-e
// ==========================================================================
/**
 * Padrão NACIONAL (SefinNacional): estrutura infNFSe + DPS/infDPS.
 * Traz de bandeja o que em outros documentos precisa ser deduzido:
 *   cTribNac  → item da LC 116 (6 dígitos: 4 do item + 2 do desdobramento)
 *   cNBS      → código NBS, que fecha a chave composta de serviços
 *   CST e cClassTrib de IBS/CBS já preenchidos pelo emissor
 *   opSimpNac → 1 não optante, 2 MEI, 3 ME/EPP (regime do prestador)
 *   grupo IBSCBS com IBS e CBS já calculados nas alíquotas do ano
 *
 * O motor NÃO adota esses campos como verdade: guarda como DECLARADO PELO
 * EMISSOR e confronta com a própria classificação. Divergência vira
 * apontamento de conformidade, que é justamente o valor do diagnóstico —
 * em 2026 muitos emissores ainda estão calibrando esses campos.
 */
function lerNfseNacional(xml) {
  const inf = tag(xml, 'infNFSe');
  const emit = tag(inf, 'emit');
  const valores = tag(inf, 'valores');
  const dps = tag(tag(inf, 'DPS'), 'infDPS');
  const prest = tag(dps, 'prest');
  const toma = tag(dps, 'toma');
  const serv = tag(dps, 'serv');
  const cServ = tag(serv, 'cServ');
  const valDps = tag(dps, 'valores');
  const piscofins = tag(tag(tag(valDps, 'trib'), 'tribFed'), 'piscofins');
  const ibscbsDoc = tag(inf, 'IBSCBS');
  const totCibs = tag(ibscbsDoc, 'totCIBS');
  const ibscbsDps = tag(dps, 'IBSCBS');
  const gIbsCbs = tag(tag(tag(ibscbsDps, 'valores'), 'trib'), 'gIBSCBS');

  const chaveM = xml.match(/Id="?NFS(\d{40,50})"?/i);
  const vServ = numero(valor(tag(valDps, 'vServPrest'), 'vServ'));
  const vLiq = numero(valor(valores, 'vLiq'));

  const op = valor(tag(prest, 'regTrib'), 'opSimpNac');
  const regimePrestador = op === '2' ? 'mei' : op === '3' ? 'simples_nacional' : null;

  const cabecalho = {
    tipo: 'nfse',
    padrao: 'nacional',
    chave: chaveM ? chaveM[1] : '',
    documento: `${valor(dps, 'serie') || '1'}/${valor(inf, 'nNFSe')}`,
    numero: valor(inf, 'nNFSe'),
    data_emissao: (valor(dps, 'dhEmi') || valor(inf, 'dhProc') || '').slice(0, 10),
    competencia_doc: valor(dps, 'dCompet'),
    natureza_operacao: valor(inf, 'xTribNac') || 'Prestação de serviço',
    municipio_incidencia: valor(inf, 'xLocIncid'),
    emitente_cnpj: soDigitos(primeiro(emit, ['CNPJ', 'CPF'])),
    emitente_nome: valor(emit, 'xNome'),
    emitente_uf: valor(tag(emit, 'enderNac'), 'UF'),
    emitente_opSimpNac: op,
    destinatario_cnpj: soDigitos(primeiro(toma, ['CNPJ', 'CPF'])),
    destinatario_nome: valor(toma, 'xNome'),
    valor_total: vLiq || vServ,
    regimePrestador,
  };

  const declarado = {
    temGrupo: !!ibscbsDoc,
    cst: valor(gIbsCbs, 'CST'),
    cclasstrib: valor(gIbsCbs, 'cClassTrib'),
    cIndOp: valor(ibscbsDps, 'cIndOp'),
    indFinal: valor(ibscbsDps, 'indFinal'),
    baseIbsCbs: numero(valor(tag(ibscbsDoc, 'valores'), 'vBC')),
    ibs: numero(valor(tag(totCibs, 'gIBS'), 'vIBSTot')),
    cbs: numero(valor(tag(totCibs, 'gCBS'), 'vCBS')),
    municipioIncidencia: valor(ibscbsDoc, 'xLocalidadeIncid'),
  };

  const itens = [{
    item_numero: 1,
    codigo_produto: '',
    descricao: valor(cServ, 'xDescServ') || valor(inf, 'xTribNac') || 'Serviço prestado',
    ncm: '',
    nbs: soDigitos(valor(cServ, 'cNBS')),
    lc116: itemLc116(valor(cServ, 'ItemListaServico')),
    cst: soDigitos(valor(cServ, 'cTribNac')),
    cfop: '', csosn: '',
    quantidade: 1, unidade: '',
    valor: vServ,
    base_calculo: numero(valor(valores, 'vBC')) || vServ,
    deducao: numero(valor(tag(valDps, 'vDedRed'), 'vDR')),
    iss: numero(valor(valores, 'vISSQN')),
    pis: numero(valor(piscofins, 'vPis')),
    cofins: numero(valor(piscofins, 'vCofins')),
    pis_cofins_documentado: Boolean(piscofins),
    icms: 0, icms_st: 0, ipi: 0,
    frete: 0, seguro: 0, outras: 0, desconto: 0,
    declarado,
  }];

  return { cabecalho, itens, declarado };
}

/** Padrões municipais antigos (ABRASF e variações) */
function lerNfseMunicipal(xml) {
  const inf = tag(xml, 'InfNfse') || tag(xml, 'InfDPS') || xml;
  const prest = tag(inf, 'PrestadorServico') || tag(inf, 'Prestador') || tag(inf, 'prest');
  const tom = tag(inf, 'TomadorServico') || tag(inf, 'Tomador') || tag(inf, 'toma');
  const serv = tag(inf, 'Servico') || tag(inf, 'serv');
  const val = tag(serv, 'Valores') || tag(serv, 'valores') || serv;
  const vServ = numero(primeiro(val, ['ValorServicos', 'vServ', 'vServPrest']));

  const cabecalho = {
    tipo: 'nfse', padrao: 'municipal',
    chave: primeiro(inf, ['CodigoVerificacao', 'chNFSe']),
    documento: primeiro(inf, ['Numero', 'nNFSe', 'nDPS']),
    numero: primeiro(inf, ['Numero', 'nNFSe']),
    data_emissao: (primeiro(inf, ['DataEmissao', 'dhEmi', 'dhProc']) || '').slice(0, 10),
    natureza_operacao: 'Prestação de serviço',
    emitente_cnpj: soDigitos(primeiro(prest, ['Cnpj', 'CNPJ', 'CpfCnpj', 'CPF'])),
    emitente_nome: primeiro(prest, ['RazaoSocial', 'xNome', 'NomeFantasia']),
    destinatario_cnpj: soDigitos(primeiro(tom, ['Cnpj', 'CNPJ', 'CpfCnpj', 'CPF'])),
    destinatario_nome: primeiro(tom, ['RazaoSocial', 'xNome']),
    valor_total: vServ,
    regimePrestador: null,
  };
  const itens = [{
    item_numero: 1, codigo_produto: '',
    descricao: primeiro(serv, ['Discriminacao', 'xDescServ', 'xServ']) || 'Serviço prestado',
    ncm: '',
    nbs: soDigitos(primeiro(serv, ['cNBS', 'CodigoNBS'])),
    lc116: itemLc116(primeiro(serv, ['ItemListaServico'])),
    // Código municipal/nacional do XML é preservado separado do item LC116.
    cst: soDigitos(primeiro(serv, ['cTribNac', 'CodigoTributacaoMunicipio'])),
    cfop: '', csosn: '', quantidade: 1, unidade: '',
    valor: vServ,
    base_calculo: numero(primeiro(val, ['BaseCalculo', 'vBC'])) || vServ,
    iss: numero(primeiro(val, ['ValorIss', 'vISS', 'ValorIssRetido'])),
    pis: numero(primeiro(val, ['ValorPis', 'vPIS'])),
    cofins: numero(primeiro(val, ['ValorCofins', 'vCOFINS'])),
    icms: 0, icms_st: 0, ipi: 0, frete: 0, seguro: 0, outras: 0, desconto: 0,
  }];
  return { cabecalho, itens };
}

function lerNfse(xml) {
  if (/<(?:[\w.-]+:)?infNFSe\b/.test(xml)) return lerNfseNacional(xml);
  return lerNfseMunicipal(xml);
}

// ==========================================================================
// ORQUESTRAÇÃO
// ==========================================================================
/**
 * Lê um XML e devolve os itens já na estrutura comum, com o sentido resolvido.
 * @param {string} conteudo  XML
 * @param {string} cnpjEmpresa  CNPJ da empresa analisada (só dígitos)
 */
function lerXml(conteudo, cnpjEmpresa) {
  const tipo = identificar(conteudo);
  let doc;
  if (tipo === 'nfe' || tipo === 'nfce') doc = lerNfe(conteudo);
  else if (tipo === 'cte') doc = lerCte(conteudo);
  else if (tipo === 'nfse') doc = lerNfse(conteudo);
  else throw new Error('XML não reconhecido como NF-e, NFC-e, CT-e ou NFS-e.');

  const c = doc.cabecalho;
  const alvo = soDigitos(cnpjEmpresa);

  // --- sentido da operação (item 4)
  let sentido = 'requer_validacao', tipoParceiro = null, parceiro = {};
  if (alvo && c.destinatario_cnpj === alvo) {
    sentido = 'entrada'; tipoParceiro = 'fornecedor';
    parceiro = { cnpj: c.emitente_cnpj, nome: c.emitente_nome, uf: c.emitente_uf, crt: c.emitente_crt };
  } else if (alvo && c.emitente_cnpj === alvo) {
    sentido = 'saida'; tipoParceiro = 'cliente';
    parceiro = { cnpj: c.destinatario_cnpj, nome: c.destinatario_nome, uf: c.destinatario_uf, indIEDest: c.indIEDest };
  } else {
    parceiro = { cnpj: c.emitente_cnpj, nome: c.emitente_nome };
  }

  // --- regime sugerido pelo CRT do emitente (apenas sugestão; o cadastro manda)
  const regimeSugerido = sugerirRegime(c, parceiro, sentido);

  const itens = doc.itens.map((it) => ({
    ...it,
    tipo: tipoParceiro,
    sentido,
    documento: c.documento, chave: c.chave, data_emissao: c.data_emissao,
    competencia: (c.data_emissao || '').slice(0, 7),
    emitente_cnpj: c.emitente_cnpj, destinatario_cnpj: c.destinatario_cnpj,
    nome: parceiro.nome || '', inscr_federal: parceiro.cnpj || '',
    natureza_operacao: c.natureza_operacao,
    regime_sugerido: regimeSugerido,
    declarado: it.declarado || null,
  }));

  return { tipoDocumento: tipo, cabecalho: c, parceiro, sentido, regimeSugerido, itens };
}

/**
 * CRT da NF-e: 1 = Simples Nacional, 2 = Simples com excesso de sublimite,
 * 3 = Regime Normal, 4 = MEI. Só sugere o regime do EMITENTE.
 * Para saídas, o destinatário não traz o próprio regime no XML — daí o
 * indIEDest (9 = não contribuinte) ser a única pista, e ainda assim fraca.
 */
function sugerirRegime(cab, parceiro, sentido) {
  if (sentido === 'entrada') {
    // NFS-e nacional: o prestador declara o próprio enquadramento no DPS
    if (cab.regimePrestador) {
      return { regime: cab.regimePrestador, origem: 'opSimpNac declarado no DPS da NFS-e', confianca: 'alta' };
    }
    if (cab.padrao === 'nacional' && cab.emitente_opSimpNac === '1') {
      // Para IBS/CBS basta saber que está FORA do Simples: apura pelo regime
      // regular e gera crédito integral. A distinção Real x Presumido só
      // importaria para reconstruir o PIS/COFINS atual.
      return { regime: 'regime_regular', origem: 'opSimpNac = 1 (não optante) no DPS da NFS-e', confianca: 'alta' };
    }
    const crt = String(cab.emitente_crt || '');
    if (crt === '1' || crt === '2') return { regime: 'simples_nacional', origem: 'CRT do XML', confianca: 'alta' };
    if (crt === '4') return { regime: 'mei', origem: 'CRT do XML', confianca: 'alta' };
    if (crt === '3') return { regime: 'regime_regular', origem: 'CRT 3 (regime normal) — apura IBS/CBS pelo regime regular', confianca: 'alta' };
    return { regime: null, origem: 'CRT ausente no XML', confianca: 'nenhuma' };
  }
  const cnpj = String(parceiro.cnpj || '');
  if (cnpj.length === 11) return { regime: 'pessoa_fisica', origem: 'CPF no destinatário', confianca: 'alta' };
  if (String(cab.indIEDest) === '9') return { regime: null, origem: 'indIEDest 9 (não contribuinte de ICMS) — não determina o regime', confianca: 'parcial' };
  return { regime: null, origem: 'XML não informa o regime do destinatário', confianca: 'nenhuma' };
}

module.exports = { lerXml, identificar, lerNfe, lerCte, lerNfse, lerNfseNacional, lerNfseMunicipal };
