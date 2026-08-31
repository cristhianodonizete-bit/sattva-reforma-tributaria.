/*
 * Auditoria somente leitura da Etapa 2B. Não grava classificação, não chama
 * motor e não usa descrição como identidade. O arquivo produzido é uma
 * fotografia de evidências para aprovação antes de qualquer automação.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const supabase = require('../src/services/supabase');

const LIMPAR = (v) => String(v || '').trim();
const DIGITOS = (v) => LIMPAR(v).replace(/\D/g, '');
const parse = (v) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || {}); } catch (_) { return {}; } };
const pagina = async (remoto, tabela, filtro = (q) => q) => {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await filtro(remoto.from(tabela).select('*')).range(de, de + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data || []));
    if (!data || data.length < 1000) return linhas;
  }
};
const valor = (x) => Number(x?.precoAtual ?? x?.valor ?? 0) || 0;

function tipoDeterministico(mov, detalhe) {
  const tipo = String(detalhe?.tipo || mov?.tipo || '').toLowerCase();
  if (['servico', 'serviços', 'serviços'].includes(tipo)) return 'SERVICO';
  if (['produto', 'mercadoria'].includes(tipo)) return 'PRODUTO';
  if (DIGITOS(mov?.ncm).length === 8) return 'PRODUTO';
  if (LIMPAR(mov?.nbs) || LIMPAR(detalhe?.nbs)) return 'SERVICO';
  return 'INDETERMINADO';
}

(async () => {
  if (!supabase.configurado()) throw new Error('Supabase não configurado.');
  const remoto = supabase.admin(); const empresaId = Number(process.argv[2] || 1);
  const [resultados, movimentos, produtos, servicos, referencias] = await Promise.all([
    pagina(remoto, 'motor_resultados_operacionais', (q) => q.eq('empresa_id', empresaId)),
    pagina(remoto, 'movimentos', (q) => q.eq('empresa_id', empresaId)),
    pagina(remoto, 'cadastro_produtos_mestre'),
    pagina(remoto, 'cadastro_servicos_mestre'),
    pagina(remoto, 'empresa_servicos_fiscais', (q) => q.eq('empresa_id', empresaId).eq('ativo', 1)),
  ]);
  const ativos = resultados.filter((x) => x.ativo === true || x.ativo === 1);
  const execucaoId = Math.max(...ativos.map((x) => Number(x.execucao_id || x.dados?.execucao_id || 0)));
  const alvo = ativos.filter((x) => Number(x.execucao_id || x.dados?.execucao_id || 0) === execucaoId)
    .filter((x) => ['REQUER_VALIDACAO', 'SEM_CORRESPONDENCIA'].includes(String(x.dados?.status_classificacao || '').toUpperCase()));
  const porMovimento = new Map(movimentos.map((x) => [Number(x.id), x]));

  // Histórico só é elegível se a identidade estruturada for o mesmo código da
  // empresa. Descrição/contraparte não entram nesta chave por segurança.
  const historicoPorCodigo = new Map();
  for (const r of resultados) {
    const m = porMovimento.get(Number(r.movimento_id)); const d = r.dados || {};
    const codigo = LIMPAR(m?.codigo_produto);
    const status = String(d.status_classificacao || '').toUpperCase();
    const c = d.classificacao || {};
    if (!codigo || !['CLASSIFICADO', 'DETERMINADO'].includes(status)) continue;
    const chave = `${m?.empresa_id}|${codigo}|${tipoDeterministico(m, d.detalhe || {})}`;
    const atual = historicoPorCodigo.get(chave) || [];
    atual.push({ ncm: LIMPAR(m?.ncm), nbs: LIMPAR(m?.nbs), cst: c.cst || null, cclasstrib: c.cclasstrib || null, movimento_id: m?.id, execucao_id: r.execucao_id || d.execucao_id });
    historicoPorCodigo.set(chave, atual);
  }

  const itens = alvo.map((r) => {
    const m = porMovimento.get(Number(r.movimento_id)) || {};
    const d = r.dados || {}; const mem = parse(d.detalhe); const cls = mem.classificacao || d.classificacao || {};
    const tipo = tipoDeterministico(m, mem);
    const codigo = LIMPAR(m.codigo_produto);
    const ncm = LIMPAR(m.ncm || mem.ncm);
    const nbs = LIMPAR(m.nbs || mem.nbs);
    const lc116 = LIMPAR(mem.lc116 || m.lc116);
    const identidadesProduto = produtos.filter((x) => codigo && [x.chave, x.sku, x.gtin].map(LIMPAR).includes(codigo) && LIMPAR(x.ncm));
    const identidadesServico = servicos.filter((x) => codigo && [x.chave, x.codigo_interno].map(LIMPAR).includes(codigo) && LIMPAR(x.nbs));
    const identidadesReferencia = referencias.filter((x) => codigo && LIMPAR(x.chave) === codigo && LIMPAR(x.nbs));
    const cadastro = tipo === 'PRODUTO' ? identidadesProduto : tipo === 'SERVICO' ? [...identidadesServico, ...identidadesReferencia] : [];
    const chaveHistorico = `${empresaId}|${codigo}|${tipo}`;
    const historico = codigo ? (historicoPorCodigo.get(chaveHistorico) || []) : [];
    const valoresCadastro = [...new Set(cadastro.map((x) => tipo === 'PRODUTO' ? LIMPAR(x.ncm) : LIMPAR(x.nbs)).filter(Boolean))];
    const valoresHistorico = [...new Set(historico.map((x) => tipo === 'PRODUTO' ? x.ncm : x.nbs).filter(Boolean))];
    const conflitos = valoresCadastro.length > 1 || valoresHistorico.length > 1 || (valoresCadastro[0] && valoresHistorico[0] && valoresCadastro[0] !== valoresHistorico[0]);
    const documentoCompleto = (tipo === 'PRODUTO' && DIGITOS(ncm).length === 8) || (tipo === 'SERVICO' && Boolean(nbs && lc116));
    const evidencias = [];
    if (documentoCompleto) evidencias.push({ tipo: 'DOCUMENTO_ESTRUTURADO', valor: tipo === 'PRODUTO' ? ncm : `${lc116}|${nbs}` });
    if (valoresCadastro.length === 1) evidencias.push({ tipo: 'CADASTRO_MESTRE_IDENTIDADE_EXATA', valor: valoresCadastro[0] });
    if (valoresHistorico.length === 1) evidencias.push({ tipo: 'HISTORICO_ITEM_CONFIRMADO', valor: valoresHistorico[0] });
    let classificacaoPotencial = 'HUMANO_NECESSARIO';
    let tentativa = 'SEM_EVIDENCIA';
    if (conflitos) { classificacaoPotencial = 'HUMANO_NECESSARIO'; tentativa = 'CLASSIFICACAO_CONFLITANTE'; }
    else if (evidencias.length) { classificacaoPotencial = 'AUTOMATIZAVEL_COM_SEGURANCA'; tentativa = evidencias[0].tipo.replace('_ESTRUTURADO', '').replace('_IDENTIDADE_EXATA', ''); }
    // Uma NBS sem o item LC 116, ou um serviço sem identidade de cadastro,
    // não é um enriquecimento automático pendente: ainda requer que alguém
    // complemente evidência oficial. Não promovemos essa lacuna a automação.
    else { classificacaoPotencial = 'HUMANO_NECESSARIO'; tentativa = 'EVIDENCIA_INSUFICIENTE'; }
    // cClassTrib isolado não é candidato de identidade fiscal. Para aparecer
    // como sugestão, o catálogo precisa ao menos apontar uma chave material
    // (NCM, NBS ou LC 116) que o usuário possa conferir.
    const candidatosCatalogo = (cls.candidatos || []).filter((x) => x.lc116 || x.nbs || x.ncm)
      .map((x) => ({ ncm: x.ncm || null, nbs: x.nbs || null, lc116: x.lc116 || null, cclasstrib: x.cclasstrib || null }));
    if (classificacaoPotencial === 'HUMANO_NECESSARIO' && candidatosCatalogo.length) classificacaoPotencial = 'APENAS_SUGESTAO';
    return {
      movimento_id: Number(r.movimento_id), resultado_id: Number(r.id), empresa_id: empresaId,
      empresa: 'Truston Segurança da Informação', sentido: m.sentido || d.sentido || mem.sentido || null,
      natureza_item: tipo, codigo_interno_item: codigo || null, descricao_original: m.descricao || mem.descricao || null,
      cnpj_contraparte: m.inscr_federal || m.emitente_cnpj || mem.cnpj || null,
      documento: m.documento || mem.documento || null, modelo_documento: m.origem || mem.origem || null,
      chave_documento: m.chave || null, ncm_original: ncm || null, nbs_original: nbs || null, lc116_original: lc116 || null,
      historico_existente: historico, cadastro_mestre_encontrado: cadastro.map((x) => ({ chave: x.chave, codigo_interno: x.codigo_interno || null, ncm: x.ncm || null, nbs: x.nbs || null, origem: x.origem || null, evidencia: x.evidencia || null })),
      candidatos_apenas_sugestao: candidatosCatalogo, possiveis_evidencias: evidencias,
      status_atual: d.status_classificacao, motivo_atual: cls.fundamentos || [],
      valor_operacao: Number(m.valor) || valor(d) || valor(mem),
      resultado_tentativa: tentativa, classificacao_potencial: classificacaoPotencial,
    };
  });
  const contar = (predicado) => itens.filter(predicado);
  const por = (campo) => Object.fromEntries(Object.entries(itens.reduce((m, x) => { m[x[campo]] = (m[x[campo]] || 0) + 1; return m; }, {})).sort());
  const resumo = {
    execucao_ativa: execucaoId, operacoes_ncm_nbs_ausente: itens.length,
    automatizavel_com_seguranca: contar((x) => x.classificacao_potencial === 'AUTOMATIZAVEL_COM_SEGURANCA').length,
    automatizavel_apos_enriquecimento: contar((x) => x.classificacao_potencial === 'AUTOMATIZAVEL_APOS_ENRIQUECIMENTO').length,
    apenas_sugestao: contar((x) => x.classificacao_potencial === 'APENAS_SUGESTAO').length,
    humano_necessario: contar((x) => x.classificacao_potencial === 'HUMANO_NECESSARIO').length,
      fontes_encontradas: {
      documento: contar((x) => x.possiveis_evidencias.some((e) => e.tipo === 'DOCUMENTO_ESTRUTURADO')).length,
      cadastro_mestre: contar((x) => x.possiveis_evidencias.some((e) => e.tipo === 'CADASTRO_MESTRE_IDENTIDADE_EXATA')).length,
      historico_confirmado: contar((x) => x.possiveis_evidencias.some((e) => e.tipo === 'HISTORICO_ITEM_CONFIRMADO')).length,
      conflito: contar((x) => x.resultado_tentativa === 'CLASSIFICACAO_CONFLITANTE').length,
      // Nenhuma das sugestões de catálogo equivale a evidência suficiente.
      // "sem_evidencia" mede ausência de evidência determinística, ainda que
      // haja candidato exibível para validação humana.
      sem_evidencia: contar((x) => !x.possiveis_evidencias.length).length,
      evidencia_parcial_nao_deterministica: contar((x) => x.classificacao_potencial === 'APENAS_SUGESTAO').length,
    },
    por_natureza_item: por('natureza_item'), por_resultado_tentativa: por('resultado_tentativa'), por_classificacao_potencial: por('classificacao_potencial'),
    autonomia_potencial_pos_2b: Number(((663 + contar((x) => x.classificacao_potencial === 'AUTOMATIZAVEL_COM_SEGURANCA').length) / 816).toFixed(4)),
  };
  const relatorio = { gerado_em: new Date().toISOString(), escopo: 'LEITURA_APENAS', resumo, itens };
  const destino = path.join(__dirname, '..', 'auditorias', 'etapa2b_inventario_execucao14_20260828.json');
  fs.writeFileSync(destino, `${JSON.stringify(relatorio, null, 2)}\n`);
  console.log(JSON.stringify({ ...resumo, arquivo: destino }, null, 2));
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });
