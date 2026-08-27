/**
 * Precificação e Margem independente.
 *
 * Não contém regra tributária: para cada saída e insumo cria apenas um fato
 * operacional mínimo e entrega-o ao motor fiscal homologado. A composição
 * permanece uma relação explícita cadastrada pelo usuário.
 */
const db = require('../db');
const motor = require('../engine/motor');

const n = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const r2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
const normalizar = (v) => String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const regimes = new Set(['lucro_real', 'lucro_presumido', 'regime_regular', 'simples_nacional', 'simples_regime_regular', 'mei', 'pessoa_fisica', 'imune_isento', 'orgao_publico']);
const tipos = new Set(['produto', 'servico', 'mao_de_obra', 'frete', 'energia', 'terceiros', 'software', 'locacao', 'indireto', 'outro']);

function fatoFiscal(linha, valor) {
  return {
    documento: `PREC-${linha.codigo || linha.id || 'ITEM'}`, item_numero: 1,
    descricao: linha.descricao, ncm: String(linha.ncm || '').replace(/\D/g, ''),
    nbs: String(linha.nbs || '').replace(/\D/g, ''), cfop: linha.nbs ? '' : '5102',
    valor: n(valor), quantidade: n(linha.quantidade) || 1,
    // A falta de PIS/Cofins é deliberada: reconstrução e catálogo decidem a
    // precedência. Nunca usamos preço - percentual comercial como atalho.
    pis: null, cofins: null, icms: null, iss: null,
    inscr_federal: String(linha.cnpj_fornecedor || ''), nome: linha.descricao,
  };
}

function projetarSaida(item, empresa, ano) {
  return motor.projetarItem(fatoFiscal(item, item.valor_venda_atual), {
    empresa, sentido: 'saida', ano, regimeContraparte: null,
    perfilDestinatario: item.perfil_cliente || null,
  });
}

function projetarSaidaPorPreco(item, empresa, ano, preco) {
  return motor.projetarItem(fatoFiscal(item, preco), {
    empresa, sentido: 'saida', ano, regimeContraparte: null, perfilDestinatario: item.perfil_cliente || null,
  });
}

// Resolve preço de origem usando exclusivamente o motor. A busca não contém
// fórmula tributária; ela apenas encontra o preço cujo resultado oficial atinge
// o alvo solicitado pelo modo comercial.
function resolverPreco(item, empresa, ano, alvo, campo) {
  let baixo = 0, alto = Math.max(n(item.valor_venda_atual) * 4, n(alvo) * 4, 1);
  for (let i = 0; i < 36; i += 1) {
    const meio = (baixo + alto) / 2; const r = projetarSaidaPorPreco(item, empresa, ano, meio);
    if (n(r[campo]) < n(alvo)) baixo = meio; else alto = meio;
  }
  return projetarSaidaPorPreco(item, empresa, ano, alto);
}

function projetarComponente(c, empresa, ano) {
  if (!c.regime_fornecedor) return {
    precoAtual: r2(n(c.quantidade) * n(c.custo_unitario_bruto) * (1 + n(c.perda_percentual))),
    creditoCbs: null, creditoIbs: null, natureza: 'INDETERMINADO',
    credito: { statusDeterminacao: 'INDETERMINADO', motivo: 'Regime do fornecedor não informado; crédito não foi presumido.' },
    classificacao: { status: 'REQUER_VALIDACAO' },
  };
  return motor.projetarItem(fatoFiscal(c, n(c.quantidade) * n(c.custo_unitario_bruto) * (1 + n(c.perda_percentual))), {
    empresa, sentido: 'entrada', ano, regimeContraparte: c.regime_fornecedor,
  });
}

function calcularEmpresa(empresaId, { ano = 2027, modo = 'REAJUSTE_LIVRE' } = {}) {
  const empresa = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) throw new Error('Empresa não encontrada.');
  const itens = [
    ...db.prepare("SELECT *, 'produto' AS natureza_item FROM pricing_products WHERE empresa_id=? AND ativo=1").all(empresaId),
    ...db.prepare("SELECT *, 'servico' AS natureza_item FROM pricing_services WHERE empresa_id=? AND ativo=1").all(empresaId),
  ];
  const porItem = db.prepare('SELECT * FROM pricing_components WHERE (produto_saida_id=? OR servico_saida_id=?) AND ativo=1 ORDER BY id');
  return itens.map((item) => {
    const componentes = porItem.all(item.id, item.id);
    const saida = projetarSaida(item, empresa, ano);
    const detalhes = componentes.map((c) => {
      const fiscal = projetarComponente(c, empresa, ano);
      const bruto = r2(n(c.quantidade) * n(c.custo_unitario_bruto) * (1 + n(c.perda_percentual)));
      const credito = fiscal.creditoCbs == null ? null : r2(fiscal.creditoCbs + n(fiscal.creditoIbs));
      return { componente: c, bruto, credito, custo_liquido: credito == null ? null : r2(bruto - credito), fiscal };
    });
    // Serviço pode não ter composição. Nesse caso só o custo direto informado
    // forma custo; produto sem composição continua incompleto por segurança.
    const incompleto = (item.natureza_item === 'produto' && !componentes.length) || detalhes.some((x) => x.custo_liquido == null);
    const custoFormado = incompleto ? null : r2(n(item.custo_direto) + detalhes.reduce((s, x) => s + x.custo_liquido, 0));
    const qtd = n(item.quantidade_producao);
    const custoUnitario = custoFormado == null || qtd <= 0 ? null : r2(custoFormado / qtd);
    const margem = custoFormado == null ? null : r2(saida.baseEconomica - custoFormado);
    const margemPct = margem == null || !saida.precoProjetado ? null : margem / saida.precoProjetado;
    const clienteCredito = saida.creditoCbs == null ? null : r2(saida.creditoCbs + n(saida.creditoIbs));
    return {
      item, modo, status: incompleto ? 'INCOMPLETO' : 'COMPLETO',
      saida: { valor_atual: saida.precoAtual, base_economica: saida.baseEconomica, ibs: saida.ibs, cbs: saida.cbs, valor_projetado: saida.precoProjetado, natureza: saida.natureza, classificacao: saida.classificacao, memoria: saida },
      custos: { custo_direto: r2(item.custo_direto), custo_formado: custoFormado, custo_unitario: custoUnitario, componentes: detalhes },
      margem: { valor: margem, percentual: margemPct },
      cliente: { credito_potencial_operacao: clienteCredito, custo_efetivo: clienteCredito == null ? null : r2(saida.precoProjetado - clienteCredito) },
      motivo: incompleto ? 'Composição ausente ou fornecedor/regime sem determinação suficiente; margem não foi estimada.' : null,
    };
  });
}

function simularEmpresa(empresaId, opcoes = {}) {
  const ano = Number(opcoes.ano) || 2027; const modo = opcoes.modo || 'REAJUSTE_LIVRE';
  const empresa = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId);
  const bases = calcularEmpresa(empresaId, { ano });
  return bases.map((base) => {
    const item = base.item; const atual = base.saida.memoria; const custo = base.custos.custo_formado;
    let projetado = atual; let bloqueio = null;
    if (modo === 'PRESERVAR_PRECO_FINAL') projetado = resolverPreco(item, empresa, ano, atual.precoAtual, 'precoProjetado');
    else if (modo === 'PRESERVAR_MARGEM') {
      if (custo == null) bloqueio = 'Formação de custo incompleta: não é possível preservar margem.';
      else projetado = resolverPreco(item, empresa, ano, base.margem.valor + custo, 'baseEconomica');
    } else if (modo === 'PRESERVAR_CUSTO_EFETIVO_CLIENTE') {
      const creditoAtual = atual.credito?.statusDeterminacao === 'DETERMINADO' ? n(atual.creditoCbs) + n(atual.creditoIbs) : null;
      if (creditoAtual == null) bloqueio = 'Crédito do cliente não determinado; B2B não autoriza presumir crédito.';
      else {
        const alvo = atual.precoAtual - creditoAtual;
        let baixo = 0, alto = Math.max(atual.precoAtual * 4, 1);
        for (let i = 0; i < 36; i += 1) { const meio=(baixo+alto)/2; const r=projetarSaidaPorPreco(item,empresa,ano,meio); const cr=r.credito?.statusDeterminacao==='DETERMINADO' ? n(r.creditoCbs)+n(r.creditoIbs):null; if (cr == null || n(r.precoProjetado)-cr < alvo) baixo=meio; else alto=meio; }
        projetado = projetarSaidaPorPreco(item, empresa, ano, alto);
      }
    } else if (modo === 'REAJUSTE_LIVRE') {
      const preco = opcoes.preco_alvo != null ? n(opcoes.preco_alvo) : r2(atual.precoAtual * (1 + n(opcoes.percentual_reajuste)));
      projetado = projetarSaidaPorPreco(item, empresa, ano, preco);
    }
    const creditoCliente = projetado.credito?.statusDeterminacao === 'DETERMINADO' ? r2(n(projetado.creditoCbs) + n(projetado.creditoIbs)) : null;
    const margemProjetada = custo == null || bloqueio ? null : r2(projetado.baseEconomica - custo);
    return {
      ...base, modo, status: bloqueio ? 'INCOMPLETO' : base.status,
      simulacao: {
        valor_venda_atual: atual.precoAtual, tributos_atuais_reconstruiveis: atual.reconstrucao.retiradosDaBase,
        base_economica: projetado.baseEconomica, ibs: projetado.ibs, cbs: projetado.cbs, preco_projetado: projetado.precoProjetado,
        margem_atual: base.margem.valor, margem_projetada: margemProjetada,
        credito_entregue_ao_cliente: creditoCliente,
        custo_efetivo_do_cliente: creditoCliente == null ? null : r2(projetado.precoProjetado - creditoCliente),
        natureza: projetado.natureza, origem: 'MOTOR_FISCAL_OFICIAL', memoria_fiscal: projetado,
      },
      waterfall: { custo: { componentes_brutos: r2(base.custos.componentes.reduce((s,x)=>s+x.bruto,0)), creditos_recuperaveis: base.custos.componentes.some(x=>x.credito==null) ? null : r2(base.custos.componentes.reduce((s,x)=>s+x.credito,0)), custo_liquido_formado: custo }, preco: { preco_atual: atual.precoAtual, tributos_atuais: atual.reconstrucao.retiradosDaBase, base_economica: projetado.baseEconomica, ibs: projetado.ibs, cbs: projetado.cbs, preco_projetado: projetado.precoProjetado }, cliente: { preco_projetado: projetado.precoProjetado, credito_aproveitavel: creditoCliente, custo_efetivo: creditoCliente == null ? null : r2(projetado.precoProjetado-creditoCliente) } },
      motivo: bloqueio || base.motivo,
    };
  });
}

function validarPlanilha({ produtos = [], servicos = [], componentes = [] }) {
  const erros = [];
  const saidas = [];
  const addSaida = (x, natureza, linha) => {
    const codigo = String(x.codigo || '').trim();
    if (!codigo || !String(x.descricao || '').trim()) erros.push({ aba: natureza === 'produto' ? 'Produtos_Saida' : 'Servicos_Saida', linha, erro: 'Código e descrição são obrigatórios.' });
    const ncm = String(x.ncm || '').replace(/\D/g, ''); const nbs = String(x.nbs || '').replace(/\D/g, '');
    if (natureza === 'produto' && ncm.length !== 8) erros.push({ aba: 'Produtos_Saida', linha, erro: 'NCM é obrigatório e deve ter 8 dígitos.' });
    if (natureza === 'servico' && !nbs && !String(x.lc116 || '').trim()) erros.push({ aba: 'Servicos_Saida', linha, erro: 'Informe NBS ou LC116 para serviço.' });
    if (nbs && nbs.length < 6) erros.push({ aba: natureza === 'produto' ? 'Produtos_Saida' : 'Servicos_Saida', linha, erro: 'NBS inválido.' });
    if (n(x.quantidade_producao) <= 0 || n(x.valor_venda_atual) < 0) erros.push({ aba: natureza === 'produto' ? 'Produtos_Saida' : 'Servicos_Saida', linha, erro: 'Quantidade de produção deve ser maior que zero e valor não pode ser negativo.' });
    saidas.push({ ...x, codigo, natureza_item: natureza });
  };
  produtos.forEach((x, i) => addSaida(x, 'produto', i + 2)); servicos.forEach((x, i) => addSaida(x, 'servico', i + 2));
  const codigos = new Set();
  saidas.forEach((x) => { const chave = `${x.natureza_item}:${x.codigo}`; if (codigos.has(chave)) erros.push({ aba: 'Saídas', linha: '', erro: `Código duplicado: ${x.codigo}.` }); codigos.add(chave); });
  const porCodigo = new Set(saidas.map((x) => x.codigo));
  componentes.forEach((x, i) => {
    if (!porCodigo.has(String(x.codigo_item_saida || '').trim())) erros.push({ aba: 'Composicao_Insumos', linha: i + 2, erro: 'Código do item de saída inexistente.' });
    if (!String(x.codigo_componente || '').trim() || !tipos.has(normalizar(x.tipo_componente).replace(/ /g, '_'))) erros.push({ aba: 'Composicao_Insumos', linha: i + 2, erro: 'Componente e tipo de componente válido são obrigatórios.' });
    if (n(x.quantidade) <= 0 || n(x.custo_unitario_bruto) < 0) erros.push({ aba: 'Composicao_Insumos', linha: i + 2, erro: 'Quantidade deve ser maior que zero e custo não pode ser negativo.' });
    if (x.regime_fornecedor && !regimes.has(normalizar(x.regime_fornecedor).replace(/ /g, '_'))) erros.push({ aba: 'Composicao_Insumos', linha: i + 2, erro: 'Regime do fornecedor inválido.' });
  });
  saidas.filter((x) => x.natureza_item === 'produto').forEach((x) => { if (!componentes.some((c) => String(c.codigo_item_saida || '').trim() === x.codigo)) erros.push({ aba: 'Composicao_Insumos', linha: '', erro: `Produto ${x.codigo} sem composição.` }); });
  return { erros, saidas };
}

function listarBase(empresaId) {
  const produtos = db.prepare('SELECT * FROM pricing_products WHERE empresa_id=? AND ativo=1 ORDER BY codigo').all(empresaId);
  const servicos = db.prepare('SELECT * FROM pricing_services WHERE empresa_id=? AND ativo=1 ORDER BY codigo').all(empresaId);
  const componentes = db.prepare('SELECT * FROM pricing_components WHERE empresa_id=? AND ativo=1 ORDER BY id').all(empresaId);
  const lotes = db.prepare('SELECT * FROM pricing_import_batches WHERE empresa_id=? ORDER BY id DESC LIMIT 20').all(empresaId);
  return { produtos, servicos, componentes, lotes };
}

module.exports = { calcularEmpresa, simularEmpresa, validarPlanilha, listarBase, r2 };
