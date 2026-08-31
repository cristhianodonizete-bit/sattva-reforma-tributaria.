/**
 * IMPORTAÇÃO DE SPED  (item 2 da especificação)
 * ---------------------------------------------------------------------------
 * Converte EFD ICMS/IPI (SPED Fiscal) e EFD Contribuições para a MESMA
 * estrutura comum já usada pelo XML — nada de caminho paralelo.
 *
 * VANTAGEM SOBRE O XML: o SPED já traz o sentido da operação pronto no campo
 * IND_OPER do C100/A100/D100 (0 = entrada, 1 = saída, na perspectiva de quem
 * declara). Não é preciso deduzir pelo CNPJ.
 *
 * LIMITAÇÃO ESTRUTURAL, que o motor precisa saber: o SPED **não traz o regime
 * tributário do participante**. O registro 0150 tem nome, CNPJ e endereço, e
 * só isso. Enquanto o XML ao menos sugere o regime do emitente pelo CRT, aqui
 * não há nem essa pista — todo participante entra sem regime e vira apontamento
 * de conformidade até que o cadastro seja completado. Isso é característica do
 * leiaute, não falha da importação.
 *
 * REGISTROS LIDOS
 *
 *  0000  identificação do declarante e do período
 *  0150  cadastro de participantes (vira fornecedores/clientes)
 *  0200  cadastro de itens (é daqui que sai o NCM — o C170 não o traz)
 *  C100  documento fiscal de mercadoria (NF-e/NF)
 *  C170  itens do documento, com ICMS, IPI, PIS e COFINS por item
 *  C190  totais por CST/CFOP — usado quando o C170 não existe (perfil B)
 *  D100  conhecimento de transporte (CT-e)
 *  A100  documento de serviço (EFD Contribuições)
 *  A170  itens do documento de serviço
 *
 * O registro 0200 é lido ANTES dos documentos porque o C170 identifica o
 * produto só pelo COD_ITEM: sem o cruzamento, todo item ficaria sem NCM e,
 * por consequência, sem classificação.
 */

const soDigitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

/** Valores no SPED usam vírgula decimal e podem vir vazios */
const dec = (v) => {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** ddmmaaaa → aaaa-mm-dd */
function data(v) {
  const d = soDigitos(v);
  if (d.length !== 8) return '';
  return `${d.slice(4)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
}

/**
 * Arquivos de SPED são gerados em ISO-8859-1 na esmagadora maioria dos casos,
 * mas alguns emissores já usam UTF-8. Decodificar errado corrompe as descrições
 * dos produtos — que são justamente o que o consultor lê na tela.
 */
function decodificar(buffer) {
  const utf8 = buffer.toString('utf8');
  // U+FFFD indica byte inválido em UTF-8 → o arquivo é latin1
  if (utf8.includes('\uFFFD')) return buffer.toString('latin1');
  return utf8;
}

// ==========================================================================
// LEITURA
// ==========================================================================
/**
 * @param {Buffer} buffer   arquivo .txt do SPED
 * @param {string} cnpjEmpresa  CNPJ da empresa analisada (validação)
 */
function lerSped(buffer, cnpjEmpresa) {
  const texto = decodificar(buffer);
  const linhas = texto.split(/\r?\n/);

  const participantes = new Map();   // COD_PART → dados
  const produtos = new Map();        // COD_ITEM → { descricao, ncm, unidade }
  const itens = [];
  const avisos = [];
  let cabecalho = null;
  let tipoArquivo = null;

  let docAtual = null;               // C100/A100/D100 em curso
  let itensDoDoc = 0;

  for (const linha of linhas) {
    if (!linha || linha[0] !== '|') continue;
    const p = linha.split('|');
    const reg = p[1];

    switch (reg) {
      // -------------------------------------------------- identificação
      case '0000': {
        // Os dois leiautes têm campos em posições diferentes. No SPED Fiscal
        // o 4º campo é a data inicial; no Contribuições é o código da versão.
        const ehFiscal = /^\d{8}$/.test(String(p[4] || '').trim());
        if (ehFiscal) {
          tipoArquivo = 'efd_icms_ipi';
          cabecalho = { tipo: tipoArquivo, dt_ini: data(p[4]), dt_fin: data(p[5]),
            nome: (p[6] || '').trim(), cnpj: soDigitos(p[7]), uf: (p[9] || '').trim() };
        } else {
          tipoArquivo = 'efd_contribuicoes';
          cabecalho = { tipo: tipoArquivo, dt_ini: data(p[6]), dt_fin: data(p[7]),
            nome: (p[8] || '').trim(), cnpj: soDigitos(p[9]), uf: (p[10] || '').trim() };
        }
        break;
      }

      // -------------------------------------------------- participantes
      case '0150':
        participantes.set(p[2], {
          codigo: p[2], nome: (p[3] || '').trim(),
          cnpj: soDigitos(p[5]) || soDigitos(p[6]),   // CNPJ ou CPF
          uf: '', municipio: (p[8] || '').trim(),
        });
        break;

      // -------------------------------------------------- itens (traz o NCM)
      case '0200':
        produtos.set(p[2], {
          codigo: p[2], descricao: (p[3] || '').trim(),
          unidade: (p[6] || '').trim(), tipo_item: (p[7] || '').trim(),
          ncm: soDigitos(p[8]), cod_lst: soDigitos(p[11]),
        });
        break;

      // -------------------------------------------------- mercadorias
      case 'C100': {
        if (docAtual && itensDoDoc === 0 && docAtual.pendenteC190) {
          // documento anterior fechou sem itens; nada a fazer aqui
        }
        const part = participantes.get(p[4]) || { nome: p[4] || '', cnpj: '' };
        docAtual = {
          origem: 'C100',
          sentido: String(p[2]) === '0' ? 'entrada' : 'saida',
          participante: part,
          modelo: (p[5] || '').trim(),
          situacao: (p[6] || '').trim(),
          documento: `${(p[7] || '').trim()}/${(p[8] || '').trim()}`,
          chave: soDigitos(p[9]),
          data_emissao: data(p[10]),
          valor_documento: dec(p[12]),
          desconto: dec(p[14]),
          valor_mercadorias: dec(p[16]),
          frete: dec(p[18]), seguro: dec(p[19]), outras: dec(p[20]),
          pendenteC190: true,
        };
        itensDoDoc = 0;
        // documentos cancelados ou denegados não representam operação
        if (['02', '03', '04', '05'].includes(docAtual.situacao)) { docAtual = null; }
        break;
      }

      case 'C170': {
        if (!docAtual || docAtual.origem !== 'C100') break;
        const prod = produtos.get(p[3]) || {};
        itens.push({
          ...comum(docAtual, cabecalho),
          item_numero: Number(p[2]) || itensDoDoc + 1,
          codigo_produto: p[3] || '',
          descricao: (p[4] || '').trim() || prod.descricao || '',
          ncm: prod.ncm || '',
          nbs: '',
          quantidade: dec(p[5]),
          unidade: (p[6] || '').trim() || prod.unidade || '',
          valor: dec(p[7]),
          desconto: dec(p[8]),
          cst: (p[10] || '').trim(),
          cfop: soDigitos(p[11]),
          base_calculo: dec(p[13]),
          icms: dec(p[15]),
          icms_st: dec(p[18]),
          ipi: dec(p[24]),
          pis: dec(p[30]),
          cofins: dec(p[36]),
          iss: 0,
          frete: 0, seguro: 0, outras: 0,
        });
        itensDoDoc++;
        docAtual.pendenteC190 = false;
        break;
      }

      case 'C190': {
        // Perfil B não envia C170: o detalhe vem agregado por CST/CFOP.
        // Só usamos como fallback, e o item fica sem NCM — o que o motor
        // registra como "sem correspondência", corretamente.
        if (!docAtual || docAtual.origem !== 'C100' || !docAtual.pendenteC190) break;
        itens.push({
          ...comum(docAtual, cabecalho),
          item_numero: itensDoDoc + 1,
          codigo_produto: '',
          descricao: `Totalizador CST ${(p[2] || '').trim()} / CFOP ${soDigitos(p[3])}`,
          ncm: '', nbs: '',
          quantidade: 0, unidade: '',
          valor: dec(p[5]),
          cst: (p[2] || '').trim(),
          cfop: soDigitos(p[3]),
          base_calculo: dec(p[6]),
          icms: dec(p[7]),
          icms_st: dec(p[9]),
          ipi: dec(p[11]),
          pis: 0, cofins: 0, iss: 0,
          frete: 0, seguro: 0, outras: 0, desconto: 0,
          agregado: true,
        });
        itensDoDoc++;
        break;
      }

      // -------------------------------------------------- transporte
      case 'D100': {
        const part = participantes.get(p[4]) || { nome: p[4] || '', cnpj: '' };
        docAtual = {
          origem: 'D100',
          sentido: String(p[2]) === '0' ? 'entrada' : 'saida',
          participante: part,
          modelo: (p[5] || '').trim(),
          situacao: (p[6] || '').trim(),
          documento: `${(p[7] || '').trim()}/${(p[9] || '').trim()}`,
          chave: soDigitos(p[10]),
          data_emissao: data(p[11]),
          valor_documento: dec(p[15]),
        };
        if (['02', '03', '04', '05'].includes(docAtual.situacao)) { docAtual = null; break; }
        itens.push({
          ...comum(docAtual, cabecalho),
          item_numero: 1,
          codigo_produto: '',
          descricao: 'Serviço de transporte',
          ncm: '', nbs: '',
          quantidade: 1, unidade: '',
          valor: dec(p[18]) || dec(p[15]),
          base_calculo: dec(p[19]),
          icms: dec(p[20]),
          cst: '', cfop: '',
          icms_st: 0, ipi: 0, pis: 0, cofins: 0, iss: 0,
          frete: 0, seguro: 0, outras: 0, desconto: dec(p[16]),
        });
        docAtual = null;
        break;
      }

      // -------------------------------------------------- serviços
      case 'A100': {
        const part = participantes.get(p[4]) || { nome: p[4] || '', cnpj: '' };
        docAtual = {
          origem: 'A100',
          sentido: String(p[2]) === '0' ? 'entrada' : 'saida',
          participante: part,
          situacao: (p[5] || '').trim(),
          documento: `${(p[6] || '').trim()}/${(p[8] || '').trim()}`,
          chave: soDigitos(p[9]),
          data_emissao: data(p[10]),
          valor_documento: dec(p[12]),
          iss_documento: dec(p[21]),
        };
        itensDoDoc = 0;
        break;
      }

      case 'A170': {
        if (!docAtual || docAtual.origem !== 'A100') break;
        const prod = produtos.get(p[3]) || {};
        itens.push({
          ...comum(docAtual, cabecalho),
          item_numero: Number(p[2]) || itensDoDoc + 1,
          codigo_produto: p[3] || '',
          descricao: (p[4] || '').trim() || prod.descricao || 'Serviço',
          ncm: '',
          nbs: '',
          cst: prod.cod_lst || '',           // item da lista de serviços (LC 116)
          cfop: '',
          quantidade: 1, unidade: '',
          valor: dec(p[5]),
          desconto: dec(p[6]),
          base_calculo: dec(p[10]) || dec(p[5]),
          pis: dec(p[12]),
          cofins: dec(p[16]),
          // O ISS não é detalhado por item no A170: rateamos pelo valor do item
          iss: docAtual.valor_documento
            ? (docAtual.iss_documento || 0) * (dec(p[5]) / docAtual.valor_documento) : 0,
          icms: 0, icms_st: 0, ipi: 0,
          frete: 0, seguro: 0, outras: 0,
        });
        itensDoDoc++;
        break;
      }

      default: break;
    }
  }

  if (!cabecalho) throw new Error('Registro 0000 não encontrado — o arquivo não parece ser um SPED válido.');

  // --- validação do declarante
  const alvo = soDigitos(cnpjEmpresa);
  if (alvo && cabecalho.cnpj && cabecalho.cnpj !== alvo) {
    throw new Error(`Este SPED é da empresa ${cabecalho.nome} (CNPJ ${cabecalho.cnpj}), diferente da empresa em análise.`);
  }

  // --- avisos estruturais
  const semNcm = itens.filter((i) => !i.ncm && !i.nbs && i.origem !== 'A170').length;
  if (semNcm) avisos.push(`${semNcm} itens sem NCM. No SPED o NCM vem do registro 0200 — confira se o arquivo inclui o cadastro de itens completo.`);
  const agregados = itens.filter((i) => i.agregado).length;
  if (agregados) avisos.push(`${agregados} lançamentos vieram do registro C190 (totais por CST/CFOP), sem detalhe por produto. Escrituração de perfil B não traz o C170, então esses itens ficam sem NCM e sem classificação automática.`);
  if (!participantes.size) avisos.push('Nenhum participante no registro 0150 — fornecedores e clientes não puderam ser identificados.');
  avisos.push('O SPED não informa o regime tributário dos participantes. Todos entram sem regime e precisam ser completados no cadastro antes de a projeção de crédito ser confiável.');

  return {
    tipoArquivo, cabecalho,
    periodo: { inicio: cabecalho.dt_ini, fim: cabecalho.dt_fin },
    participantes: [...participantes.values()],
    produtos: produtos.size,
    itens,
    avisos,
    resumo: {
      documentos: new Set(itens.map((i) => `${i.origem}|${i.documento}`)).size,
      itens: itens.length,
      entradas: itens.filter((i) => i.sentido === 'entrada').length,
      saidas: itens.filter((i) => i.sentido === 'saida').length,
      valorEntradas: itens.filter((i) => i.sentido === 'entrada').reduce((s, i) => s + i.valor, 0),
      valorSaidas: itens.filter((i) => i.sentido === 'saida').reduce((s, i) => s + i.valor, 0),
    },
  };
}

/** Campos que todo item herda do documento */
function comum(doc, cab) {
  return {
    origem: doc.origem,
    sentido: doc.sentido,
    tipo: doc.sentido === 'entrada' ? 'fornecedor' : 'cliente',
    nome: doc.participante.nome,
    inscr_federal: doc.participante.cnpj,
    documento: doc.documento,
    chave: doc.chave || '',
    data_emissao: doc.data_emissao,
    competencia: (doc.data_emissao || cab.dt_ini || '').slice(0, 7),
    emitente_cnpj: doc.sentido === 'saida' ? cab.cnpj : doc.participante.cnpj,
    destinatario_cnpj: doc.sentido === 'saida' ? doc.participante.cnpj : cab.cnpj,
  };
}

/** Identifica rapidamente se um arquivo é SPED, sem processá-lo inteiro */
function ehSped(buffer) {
  const inicio = decodificar(buffer.subarray(0, 400));
  return /^\|0000\|/m.test(inicio);
}

function inspecionarCabecalho(buffer, cnpjEmpresa) {
  const linha = decodificar(buffer).split(/\r?\n/).find((x) => x.startsWith('|0000|'));
  if (!linha) throw new Error('Registro 0000 não encontrado — o arquivo não parece ser um SPED válido.');
  const p = linha.split('|');
  const fiscal = /^\d{8}$/.test(String(p[4] || '').trim());
  const tipoArquivo = fiscal ? 'efd_icms_ipi' : 'efd_contribuicoes';
  const inicio = fiscal ? data(p[4]) : data(p[6]); const fim = fiscal ? data(p[5]) : data(p[7]);
  const cnpj = soDigitos(fiscal ? p[7] : p[9]);
  if (soDigitos(cnpjEmpresa) && cnpj && cnpj !== soDigitos(cnpjEmpresa)) throw new Error('Arquivo SPED pertence a empresa diferente da empresa em análise.');
  return { tipoArquivo, periodo: { inicio, fim }, cabecalho: { cnpj } };
}

module.exports = { lerSped, ehSped, decodificar, inspecionarCabecalho };
