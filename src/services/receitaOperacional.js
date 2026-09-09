// Receita analisada não é sinônimo de toda saída fiscal. Remessas,
// transferências, devoluções e movimentações de ativo/consumo podem sair da
// empresa, mas não representam faturamento. A decisão usa o CFOP cadastrado
// em Configurações; quando o documento de serviço não possui CFOP, aceita-se
// somente a evidência explícita de serviço.
let regras = null;

function ehSaida(movimento = {}) {
  return movimento.sentido === 'saida' || movimento.tipo === 'cliente';
}

function natureza(movimento = {}) {
  const cfop=String(movimento.cfop || '').replace(/\D/g,'');
  try {
    regras ||= require('./regras');
    return regras.naturezaCfop(cfop) || null;
  } catch (_) {
    // Mantém a semântica-base em contextos de leitura isolada/teste sem a
    // base de parâmetros. Na aplicação, a tabela param_cfop prevalece.
    if (!/^\d{4}$/.test(cfop)) return null;
    if (cfop.startsWith('7')) return 'exportacao';
    if (['901','902','903','904','905','906','907','908','909','910','911','912','913','914','915','916','917','920','921','922','923','924','925'].includes(cfop.slice(1))) return 'remessa';
    if (['201','202','208','209','210','410','411','412','413','503','553'].includes(cfop.slice(1))) return 'devolucao';
    if (['151','152','153','154','408','409','658','659'].includes(cfop.slice(1))) return 'transferencia';
    if (['406','407','551','552','556','557'].includes(cfop.slice(1))) return 'ativo_consumo';
    return ['5','6'].includes(cfop[0]) ? 'venda' : null;
  }
}

function compoeReceita(movimento = {}) {
  if (!ehSaida(movimento)) return false;
  const porCfop = natureza(movimento);
  if (porCfop) return porCfop === 'venda' || porCfop === 'exportacao';
  const modelo=String(movimento.modelo_documento_fiscal || '').toLowerCase();
  // NF-e/NFC-e é documento de mercadoria: sem CFOP de venda não há prova de
  // faturamento, mesmo que algum campo textual pareça serviço.
  if (['nfe','nfce'].includes(modelo)) return false;
  if (['nfse','cte','nfcom'].includes(modelo)) return true;
  // NFS-e não usa CFOP; NBS, LC 116 ou ISS são a evidência de prestação.
  return Boolean(String(movimento.nbs || '').trim() || String(movimento.lc116 || '').trim() || Number(movimento.iss || 0));
}

function motivo(movimento = {}) {
  if (!ehSaida(movimento)) return 'ENTRADA';
  const porCfop = natureza(movimento);
  if (porCfop === 'venda') return 'VENDA_CFOP';
  if (porCfop === 'exportacao') return 'EXPORTACAO_CFOP';
  if (porCfop) return `FORA_RECEITA_${porCfop.toUpperCase()}`;
  const modelo=String(movimento.modelo_documento_fiscal || '').toUpperCase();
  if (modelo === 'NFE' || modelo === 'NFCE') return 'MERCADORIA_SEM_CFOP_DE_VENDA';
  if (['NFSE','CTE','NFCOM'].includes(modelo)) return `SERVICO_${modelo}`;
  if (compoeReceita(movimento)) return 'SERVICO_SEM_CFOP';
  return 'OPERACAO_SEM_EVIDENCIA_DE_VENDA';
}

module.exports = { ehSaida, natureza, compoeReceita, motivo };
