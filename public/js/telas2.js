/* =========================================================================
   TELAS — Módulos 2 a 4 e gestão do produto
   ========================================================================= */
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') =>
  `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
   <div class="acoes-topo">${acoes}</div></div>`;

// ===========================================================================
// MÓDULO 2 — PRECIFICAÇÃO E MARGEM
// ===========================================================================
Telas.precificacao = async (el) => {
  const { itens } = await A.api(`/empresas/${S.empresaId}/precificacao`);
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);
  el.innerHTML = cab('Módulo 2', 'Precificação e margem',
    `Receita (-) impostos (-) custos = margem bruta. ${ibsAtivo ? 'Se o preço não mudar, quanto de margem some?' : 'A simulação atual considera a CBS em uma referência única.'}`,
    `<button class="btn" id="simular">Simular item</button>
     <button class="btn vazio" id="importarItens">Importar planilha</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/precificacao')">Exportar Excel</button>`) +
    (itens.length ? resumoPreco(itens) : '') +
    `<div class="cartao"><h2>Itens simulados</h2>
      ${A.tabela([
        { t: 'Item', r: (i) => `${A.esc(i.descricao || '—')}<div class="mini mono">${A.esc(i.ncm || '')}</div>` },
        ...(ibsAtivo ? [{ t: 'Ano', r: (i) => `<span class="mono">${i.ano}</span>` }] : []),
        { t: 'Preço hoje', num: true, r: (i) => A.moeda(i.r.hoje.preco) },
        { t: 'Sem imposto', num: true, r: (i) => A.moeda(i.r.hoje.precoSemImposto) },
        { t: 'Margem hoje', num: true, r: (i) => `${A.moeda(i.r.hoje.margem)}<div class="mini">${A.pct(i.r.hoje.margemPerc)}</div>` },
        { t: 'Margem s/ reajuste', num: true, r: (i) => `${A.moeda(i.r.precoCongelado.margem)}<div class="mini ${A.sinal(i.r.precoCongelado.variacaoMargem)}">${A.pct(i.r.precoCongelado.margemPerc)}</div>` },
        { t: 'Perda', num: true, r: (i) => A.setaR$(i.r.precoCongelado.variacaoMargem) },
        { t: 'Preço neutro', num: true, r: (i) => `<b>${A.moeda(i.r.precoNeutro.preco)}</b>` },
        { t: 'Reajuste', num: true, r: (i) => A.setaPct(i.r.precoNeutro.reajusteNecessario) },
        { t: 'Cliente credita', r: (i) => `<span class="tag ${i.r.cliente.credita ? 'c' : 'a'}">${i.r.cliente.credita ? 'Sim' : 'Não'}</span>` },
        { t: '', r: (i) => `<button class="btn pq vazio" data-vi="${i.id}">Detalhar</button>
          <button class="btn pq perigo" data-ri="${i.id}">Remover</button>` },
      ], itens.map((i) => ({ ...i, r: i.resultado })), { vazio: 'Nenhum item simulado. Comece por um produto ou serviço representativo.' })}
    </div>`;

  document.getElementById('simular').onclick = () => abrirSimulacao();
  document.getElementById('importarItens').onclick = () => A.modal({
    titulo: 'Importar itens para precificação', confirmar: null,
    descricao: `Colunas aceitas: Descrição, NCM, Tipo, Preço Venda, Custo Compra, Despesas Variáveis, Regime Fornecedor, Perfil Cliente, Redução${ibsAtivo ? ', Ano' : ''}.`,
    corpo: A.dropzone('zonaPreco', '<b>Solte a planilha aqui</b><div class="mini">ou clique para escolher</div>', async (f) => {
      const fd = new FormData(); fd.append('arquivo', f);
      try { const r = await A.api(`/empresas/${S.empresaId}/precificacao/importar`, { metodo: 'POST', corpo: fd });
        A.toast(`${r.importados} itens importados`, 'ok'); A.ir('precificacao'); } catch (e) { A.toast(e.message, 'erro'); }
    }),
  });

  el.querySelectorAll('[data-ri]').forEach((b) => { b.onclick = async () => { await A.api(`/precificacao/${b.dataset.ri}`, { metodo: 'DELETE' }); A.ir('precificacao'); }; });
  el.querySelectorAll('[data-vi]').forEach((b) => { b.onclick = () => {
    const i = itens.find((x) => x.id === Number(b.dataset.vi));
    detalharItem(i.resultado);
  }; });

  function abrirSimulacao() {
    A.modal({
      titulo: 'Simular precificação', confirmar: 'Salvar item', largura: 820,
      descricao: ibsAtivo ? 'O sistema volta a base do preço e do custo, aplica o IVA por fora e devolve o preço que preserva a margem.' : 'O sistema volta a base do preço e do custo, aplica a CBS por fora e devolve o preço que preserva a margem.',
      corpo: `<div class="grade g2">${A.campo('descricao', 'Produto ou serviço')}${A.campo('ncm', 'NCM (se houver)')}</div>
        <div class="grade g3">
          ${A.campo('precoVenda', 'Preço de venda hoje (R$)', 1000, 'number', 'step=0.01')}
          ${A.campo('custoCompra', 'Custo de aquisição hoje (R$)', 600, 'number', 'step=0.01')}
          ${A.campo('despesasVariaveis', 'Despesas variáveis (0,05 = 5%)', 0, 'number', 'step=0.001')}
        </div>
        <div class="grade g3">
          ${A.selecao('tipo', 'Natureza', [{ v: 'mercadoria', t: 'Mercadoria' }, { v: 'servico', t: 'Serviço' }], 'mercadoria')}
          ${A.selecao('regimeFornecedor', 'Regime do fornecedor', A.opcoesRegime(), S.empresa?.regime || 'lucro_real')}
          ${A.selecao('perfilCliente', 'Perfil do cliente', A.opcoesRegime(), 'lucro_real')}
        </div>
        <div class="grade g3">
          ${A.selecao('reducao', `Enquadramento no ${ibsAtivo ? 'IVA' : 'CBS'} (venda)`, A.opcoesReducao(), 'integral')}
          ${ibsAtivo ? A.selecao('ano', 'Ano do cenário', A.opcoesAno(), 2033) : '<input type="hidden" name="ano" value="2033">'}
          ${A.campo('aliqEspecifica', 'Alíquota específica (opcional)', '', 'number', 'step=0.0001')}
        </div>
        <button class="btn vazio" id="previa" style="width:100%">Ver prévia sem salvar</button>
        <div id="previaBox" style="margin-top:14px"></div>`,
      aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/precificacao`, { metodo: 'POST', corpo: d }); A.toast('Item salvo', 'ok'); A.ir('precificacao'); },
    });
    setTimeout(() => {
      const btn = document.getElementById('previa');
      if (!btn) return;
      btn.onclick = async () => {
        const d = {}; btn.closest('.modal').querySelectorAll('[name]').forEach((i) => { d[i.name] = i.value; });
        try {
          const { resultado } = await A.api('/precificacao/simular', { metodo: 'POST', corpo: { ...d, empresa_id: S.empresaId } });
          document.getElementById('previaBox').innerHTML = blocoResultado(resultado);
        } catch (e) { A.toast(e.message, 'erro'); }
      };
    }, 0);
  }

  function detalharItem(r) { A.modal({ titulo: r.item.descricao || 'Item', largura: 820, corpo: blocoResultado(r) }); }
};

function blocoResultado(r) {
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);
  return `<div class="grade g3">
      ${A.kpi('Margem hoje', A.moeda(r.hoje.margem), A.pct(r.hoje.margemPerc))}
      ${A.kpi(`Margem ${ibsAtivo ? `em ${r.item.ano}` : 'CBS'} sem reajuste`, A.moeda(r.precoCongelado.margem), A.setaR$(r.precoCongelado.variacaoMargem))}
      ${A.kpi('Preço neutro', A.moeda(r.precoNeutro.preco), A.setaPct(r.precoNeutro.reajusteNecessario) + ' de reajuste', 'destaque')}
    </div>
    <table style="margin-top:14px">
      <tr><th>Composição</th><th class="num">Hoje</th><th class="num">Preço congelado</th><th class="num">Preço neutro</th></tr>
      <tr><td>Preço</td><td class="num mono">${A.moeda(r.hoje.preco)}</td><td class="num mono">${A.moeda(r.precoCongelado.preco)}</td><td class="num mono">${A.moeda(r.precoNeutro.preco)}</td></tr>
      <tr><td>(-) Tributos</td><td class="num mono">${A.moeda(r.hoje.tributos)}</td><td class="num mono">${A.moeda(r.precoCongelado.tributos)}</td><td class="num mono">${A.moeda(r.precoNeutro.tributos)}</td></tr>
      <tr><td>(-) Custo efetivo</td><td class="num mono">${A.moeda(r.hoje.custoLiquido)}</td><td class="num mono">${A.moeda(r.precoCongelado.custoLiquido)}</td><td class="num mono">${A.moeda(r.precoCongelado.custoLiquido)}</td></tr>
      <tr style="background:var(--ouro-100)"><td><b>= Margem bruta</b></td><td class="num mono"><b>${A.moeda(r.hoje.margem)}</b></td><td class="num mono"><b>${A.moeda(r.precoCongelado.margem)}</b></td><td class="num mono"><b>${A.moeda(r.precoNeutro.margem)}</b></td></tr>
      <tr><td>Carga efetiva</td><td class="num mono">${A.pct(r.hoje.cargaEfetiva)}</td><td class="num mono">${A.pct(r.precoCongelado.cargaEfetiva)}</td><td class="num mono">${A.pct(r.precoNeutro.cargaEfetiva)}</td></tr>
      <tr><td>Preço sem imposto</td><td class="num mono">${A.moeda(r.hoje.precoSemImposto)}</td><td class="num mono">—</td><td class="num mono">—</td></tr>
    </table>
    <hr class="sep">
    <div class="aviso ${r.cliente.credita ? 'bom' : 'atencao'}"><b>Cliente: ${A.esc(r.cliente.label)}</b>${A.esc(r.cliente.leitura)}
      <div class="acao">Custo para o cliente: ${A.moeda(r.cliente.custoHoje)} → ${A.moeda(r.cliente.custoNovo)} (${A.pct(r.cliente.variacaoPerc)})</div></div>
    ${A.avisos(r.recomendacoes)}`;
}

function resumoPreco(itens) {
  const rs = itens.map((i) => i.resultado);
  const perda = rs.reduce((s, r) => s + r.precoCongelado.variacaoMargem, 0);
  const reajusteMedio = rs.reduce((s, r) => s + r.precoNeutro.reajusteNecessario, 0) / rs.length;
  const semCredito = rs.filter((r) => !r.cliente.credita).length;
  const grupos = Object.values(itens.reduce((mapa, item) => {
    const chave = item.tipo === 'servico' ? 'servico' : 'mercadoria';
    const r = item.resultado;
    const grupo = mapa[chave] || { grupo: chave === 'servico' ? 'Serviços' : 'Mercadorias', itens: 0, margemHoje: 0, margemCongelada: 0, perda: 0, reajuste: 0, semCredito: 0 };
    grupo.itens++; grupo.margemHoje += r.hoje.margem; grupo.margemCongelada += r.precoCongelado.margem;
    grupo.perda += r.precoCongelado.variacaoMargem; grupo.reajuste += r.precoNeutro.reajusteNecessario;
    if (!r.cliente.credita) grupo.semCredito++;
    mapa[chave] = grupo; return mapa;
  }, {})).map((g) => ({ ...g, reajuste: g.reajuste / g.itens }));
  const faixa = (reajuste) => reajuste >= 0.07 ? ['a', 'Reajuste prioritário'] : reajuste >= 0.02 ? ['b', 'Reajuste planejado'] : ['c', 'Monitorar'];
  return `<div class="grade g4">
    ${A.kpi('Itens simulados', itens.length)}
    ${A.kpi('Margem em risco', A.setaR$(perda), 'se nenhum preço for ajustado')}
    ${A.kpi('Reajuste médio necessário', A.setaPct(reajusteMedio), 'para preservar a margem', 'destaque')}
    ${A.kpi('Itens com cliente que não credita', semCredito, 'repasse comercialmente sensível')}
  </div><div class="grade g2 resumo-precificacao">
    <div class="cartao"><h2>Margem consolidada da carteira</h2><p class="desc">Compara a margem atual com a margem mantida em preço congelado.</p>
      ${A.tabela([
        { t: 'Visão', r: (x) => x.grupo }, { t: 'Itens', num: true, r: (x) => x.itens },
        { t: 'Margem hoje', num: true, r: (x) => A.moeda(x.margemHoje) },
        { t: 'Margem sem reajuste', num: true, r: (x) => A.moeda(x.margemCongelada) },
        { t: 'Variação', num: true, r: (x) => A.setaR$(x.perda) },
      ], grupos.concat([{ grupo: 'Carteira total', itens: itens.length, margemHoje: rs.reduce((s, r) => s + r.hoje.margem, 0), margemCongelada: rs.reduce((s, r) => s + r.precoCongelado.margem, 0), perda }]))}
    </div>
    <div class="cartao"><h2>Régua de reposicionamento</h2><p class="desc">Orientação comercial por grupo, a partir do reajuste necessário para preservar a margem.</p>
      ${grupos.map((g) => { const f = faixa(g.reajuste); return `<div class="regua-preco"><div><b>${g.grupo}</b><span>${g.itens} itens · ${g.semCredito} sem crédito econômico</span></div><div><span class="tag ${f[0]}">${f[1]}</span><strong>${A.pct(g.reajuste)}</strong></div></div>`; }).join('')}
    </div>
  </div><div style="height:16px"></div>`;
}

// ===========================================================================
// MÓDULO 3 — CONTRATOS
// ===========================================================================
Telas.contratos = async (el) => {
  const { contratos, clausulas } = await A.api(`/empresas/${S.empresaId}/contratos`);
  const risco = (c) => `<span class="tag ${c.risco === 'alto' ? 'a' : c.risco === 'medio' ? 'b' : c.risco === 'baixo' ? 'c' : 'n'}">${c.risco.replace('_', ' ')}</span>`;
  const eixos = [
    { id: 'carga', titulo: 'Carga tributária e crédito', descricao: 'Preço líquido, reequilíbrio e crédito aproveitável.', clausulas: ['preco_liquido', 'reequilibrio', 'repasse_credito'] },
    { id: 'responsabilidade', titulo: 'Responsabilidade das partes', descricao: 'Regime declarado, classificação correta e reparação.', clausulas: ['regime_fornecedor', 'responsabilidade_solidaria'] },
    { id: 'preco', titulo: 'Reajuste, repasse e preço', descricao: 'Separação entre inflação, tributação e transição.', clausulas: ['reajuste_indice', 'contratos_longa_duracao'] },
    { id: 'adequacao', titulo: 'Adequação ao novo modelo', descricao: 'Split payment, devoluções e contratos públicos.', clausulas: ['split_payment', 'devolucoes', 'orgao_publico'] },
  ];
  const clausulaCard = (c) => `<details class="clausula">
    <summary>${A.esc(c.titulo)} ${risco(c)}</summary>
    <p style="margin:10px 0 0;color:var(--tinta-2)">${A.esc(c.problema)}</p>
    <div class="texto">${A.esc(c.texto)}</div>
    <div class="mini" style="margin-top:8px">Aplicável a: ${c.aplicacao.join(', ')}</div>
  </details>`;

  el.innerHTML = cab('Módulo 3', 'Revisão de contratos',
    'Contrato sem cláusula de tributo é contrato que decide sozinho quem paga a conta da transição.',
    `<button class="btn" id="novoContrato">Cadastrar contrato</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/contratos')">Exportar Excel</button>`) +
    `<div class="cartao"><h2>Carteira contratual</h2>
      ${A.tabela([
        { t: 'Tipo', r: (c) => `<span class="tag">${A.esc(c.tipo)}</span>` },
        { t: 'Contraparte', r: (c) => `${A.esc(c.contraparte)}<div class="mini mono">${A.cnpjFmt(c.cnpj_contraparte)}</div>` },
        { t: 'Regime', r: (c) => A.regimeLabel(c.regime_contraparte) },
        { t: 'Objeto', r: (c) => `<span class="mini">${A.esc((c.objeto || '').slice(0, 60))}</span>` },
        { t: 'Valor', num: true, r: (c) => A.moeda(c.valor) },
        { t: 'Vigência', r: (c) => `<span class="mini mono">${A.esc(c.vigencia_inicio || '')} → ${A.esc(c.vigencia_fim || '')}</span>` },
        { t: 'Preço c/ tributo', r: (c) => c.preco_com_tributo ? '<span class="tag b">incluso</span>' : '<span class="tag c">líquido</span>' },
        { t: 'Risco', r: risco },
        { t: 'Status', r: (c) => `<span class="tag n">${A.esc(c.status)}</span>` },
        { t: '', r: (c) => `<button class="btn pq ouro" data-rev="${c.id}">Revisar</button>
          <button class="btn pq vazio" data-ec="${c.id}">Editar</button>
          <button class="btn pq perigo" data-rc="${c.id}">Excluir</button>` },
      ], contratos, { vazio: 'Nenhum contrato cadastrado. Comece pelos contratos de maior valor e maior prazo.' })}
    </div>
    <div class="cartao biblioteca-eixos"><h2>Biblioteca de cláusulas por eixo</h2>
      <p class="desc">Texto sugerido organizado pelos quatro eixos da revisão. Adapte ao caso concreto antes de usar.</p>
      ${eixos.map((eixo) => `<section class="eixo-contratual"><div class="eixo-cabecalho"><div><h3>${eixo.titulo}</h3><p>${eixo.descricao}</p></div><span class="tag">${eixo.clausulas.length} cláusulas</span></div>
        ${eixo.clausulas.map((id) => clausulas.find((c) => c.id === id)).filter(Boolean).map(clausulaCard).join('')}
      </section>`).join('')}
    </div>`;

  const formContrato = (c = {}) => `<div class="grade g2">
      ${A.selecao('tipo', 'Tipo de contrato', [{ v: 'compra', t: 'Compra' }, { v: 'fornecimento', t: 'Fornecimento' }, { v: 'venda', t: 'Venda' }, { v: 'servico', t: 'Serviço' }], c.tipo || 'compra')}
      ${A.campo('contraparte', 'Contraparte', c.contraparte)}</div>
    <div class="grade g2">${A.campo('cnpj_contraparte', 'CNPJ', c.cnpj_contraparte)}
      ${A.selecao('regime_contraparte', 'Regime da contraparte', A.opcoesRegime(), c.regime_contraparte || 'lucro_real')}</div>
    ${A.area('objeto', 'Objeto', c.objeto, 2)}
    <div class="grade g3">${A.campo('valor', 'Valor (R$)', c.valor, 'number', 'step=0.01')}
      ${A.campo('vigencia_inicio', 'Início', c.vigencia_inicio, 'date')}${A.campo('vigencia_fim', 'Fim', c.vigencia_fim, 'date')}</div>
    <div class="grade g2">${A.campo('reajuste', 'Índice de reajuste', c.reajuste)}
      ${A.selecao('preco_com_tributo', 'Preço pactuado', [{ v: '1', t: 'Com tributos inclusos' }, { v: '', t: 'Líquido de tributos' }], c.preco_com_tributo ? '1' : '')}</div>
    ${A.area('parecer', 'Parecer técnico', c.parecer, 3)}`;

  document.getElementById('novoContrato').onclick = () => A.modal({
    titulo: 'Cadastrar contrato', corpo: formContrato(), largura: 760,
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/contratos`, { metodo: 'POST', corpo: d }); A.ir('contratos'); },
  });
  el.querySelectorAll('[data-ec]').forEach((b) => { b.onclick = () => {
    const c = contratos.find((x) => x.id === Number(b.dataset.ec));
    A.modal({ titulo: 'Editar contrato', largura: 760, corpo: formContrato(c) + A.selecao('status', 'Status',
      [{ v: 'pendente', t: 'Pendente' }, { v: 'em_revisao', t: 'Em revisão' }, { v: 'revisado', t: 'Revisado' }, { v: 'renegociado', t: 'Renegociado' }], c.status),
      aoConfirmar: async (d) => { await A.api(`/contratos/${c.id}`, { metodo: 'PUT', corpo: { ...d, risco: c.risco } }); A.ir('contratos'); } });
  }; });
  el.querySelectorAll('[data-rc]').forEach((b) => { b.onclick = () => A.confirmar('Excluir este contrato?', async () => {
    await A.api(`/contratos/${b.dataset.rc}`, { metodo: 'DELETE' }); A.ir('contratos'); }); });

  el.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = async () => {
    const c = contratos.find((x) => x.id === Number(b.dataset.rev));
    const aplicaveis = clausulas.filter((cl) => cl.aplicacao.includes(c.tipo));
    const sit = (id) => (c.checklist.find((k) => k.clausula_id === id) || {}).situacao || 'ausente';
    const obs = (id) => (c.checklist.find((k) => k.clausula_id === id) || {}).observacao || '';
    let diagnostico;
    try { diagnostico = await A.api(`/contratos/${c.id}/impacto-diagnostico`); }
    catch (e) { diagnostico = { encontrado: false, motivo: 'Não foi possível consultar o diagnóstico desta contraparte.' }; }
    const impacto = diagnostico.encontrado ? diagnostico.impacto : null;
    A.modal({
      titulo: `Revisar — ${c.contraparte}`, largura: 860, confirmar: 'Salvar revisão',
      descricao: 'Marque a situação de cada cláusula. O risco do contrato é recalculado automaticamente.',
      corpo: `${impacto ? `<section class="impacto-contrato"><div><span class="olho">VÍNCULO COM O DIAGNÓSTICO</span><strong>Impacto projetado da contraparte</strong><p>${impacto.movimentos} lançamento(s) vinculados ao CNPJ deste contrato.</p></div><div class="grade g3">${A.kpi('Movimentação analisada', A.moeda(impacto.valor))}${A.kpi('CBS projetada', A.moeda(impacto.cbs))}${A.kpi('Crédito projetado', A.moeda(impacto.credito), '', 'destaque')}</div></section>` : `<div class="aviso atencao"><b>Vínculo com o diagnóstico indisponível</b>${A.esc(diagnostico.motivo || '')}</div>`}` + aplicaveis.map((cl) => `<div class="cartao" style="box-shadow:none;margin-bottom:10px">
          <h2 style="font-size:13.5px">${A.esc(cl.titulo)} <span class="tag ${cl.risco === 'alto' ? 'a' : 'b'}">${cl.risco}</span></h2>
          <p class="desc">${A.esc(cl.problema)}</p>
          <div class="chips" data-cl="${cl.id}">
            ${[['ausente', 'Ausente'], ['parcial', 'Parcial'], ['adequada', 'Adequada'], ['na', 'Não se aplica']].map(([v, t]) =>
              `<span class="chip ${sit(cl.id) === v ? 'on' : ''}" data-v="${v}">${t}</span>`).join('')}
          </div>
          <input type="text" data-obs="${cl.id}" placeholder="Observação" value="${A.esc(obs(cl.id))}" style="margin-top:9px">
          <details class="clausula" style="margin-top:9px;border:none;padding:0">
            <summary class="mini">Ver texto sugerido</summary><div class="texto">${A.esc(cl.texto)}</div></details>
        </div>`).join(''),
      aoConfirmar: async (_d, fundo) => {
        const itens = aplicaveis.map((cl) => ({
          clausula_id: cl.id,
          situacao: (fundo.querySelector(`[data-cl="${cl.id}"] .chip.on`) || { dataset: { v: 'ausente' } }).dataset.v,
          observacao: fundo.querySelector(`[data-obs="${cl.id}"]`).value,
        }));
        const r = await A.api(`/contratos/${c.id}/checklist`, { metodo: 'PUT', corpo: { itens } });
        A.toast(`Revisão salva — risco ${r.risco}`, r.risco === 'alto' ? 'erro' : 'ok');
        A.ir('contratos');
      },
    });
    setTimeout(() => {
      document.querySelectorAll('.chips[data-cl] .chip').forEach((ch) => { ch.onclick = () => {
        ch.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); ch.classList.add('on'); }; });
    }, 0);
  }; });
};

// ===========================================================================
// MÓDULO 4 — CAPACITAÇÃO
// ===========================================================================
Telas.capacitacao = async (el) => {
  const [{ turmas, trilhas }, acesso] = await Promise.all([
    A.api(`/empresas/${S.empresaId}/turmas`), A.api(`/empresas/${S.empresaId}/acesso`),
  ]);
  const chaveTrilha = { workshop_boas_praticas: 'treinamento_boas_praticas', workshop_pratico: 'capacitacao_operacional' };
  const trilhasLiberadas = trilhas.filter((t) => acesso.trilhas.includes(chaveTrilha[t.id]));
  const participantes = turmas.reduce((total, turma) => total + turma.participantes.length, 0);
  const presencas = turmas.reduce((total, turma) => total + turma.participantes.filter((p) => p.presenca).length, 0);
  const realizadas = turmas.filter((turma) => turma.status === 'realizada').length;
  el.innerHTML = cab('Módulo 4', 'Capacitação do time',
    'Controle de entrega: agenda, participantes e presença. O conteúdo das capacitações não é operado dentro da ferramenta.',
    `<button class="btn" id="novaTurma" ${trilhasLiberadas.length ? '' : 'disabled'}>Programar turma</button>`) +
    `${trilhasLiberadas.length ? `<div class="aviso bom"><b>Capacitações liberadas no plano:</b> ${trilhasLiberadas.map((t) => A.esc(t.titulo)).join(' · ')}</div>` : '<div class="aviso atencao"><b>Nenhuma capacitação liberada no plano aprovado.</b> Aprove o plano com Treinamento Boas Práticas ou Capacitação Operacional para liberar agenda e participantes.</div>'}
    <div class="grade g4 resumo-capacitacao">
      ${A.kpi('Turmas programadas', turmas.length, `${realizadas} realizadas`)}
      ${A.kpi('Participantes', participantes, 'pessoas inscritas')}
      ${A.kpi('Presenças confirmadas', presencas, participantes ? `${A.pct(presencas / participantes, 0)} da lista` : 'sem lista de presença')}
      ${A.kpi('Trilhas liberadas', trilhasLiberadas.length, 'conforme plano aprovado', 'destaque')}
    </div>
    <div class="cartao turmas-lista"><div class="cabecalho-lista"><div><h2>Agenda de entrega</h2><p class="desc">Controle as turmas, os participantes e a presença. O conteúdo não é executado dentro da ferramenta.</p></div><span class="tag">${turmas.length} turmas</span></div>
      ${turmas.length ? turmas.map((t) => `<article class="turma-card">
          <div class="turma-data"><b>${A.esc(t.data || '—')}</b><span>${t.carga_horaria}h</span></div><div class="turma-conteudo">
            <div><b>${A.esc(t.titulo)}</b><div class="mini">${A.esc(t.formato)} · ${A.esc(t.instrutor || 'instrutor a definir')}</div></div>
            <div class="turma-acoes">
              <span class="tag ${t.status === 'realizada' ? 'c' : 'n'}">${A.esc(t.status)}</span>
              <button class="btn pq vazio" data-part="${t.id}">Participantes (${t.participantes.length})</button>
              <button class="btn pq vazio" data-et="${t.id}">Editar</button>
              <button class="btn pq perigo" data-rt="${t.id}">Excluir</button>
            </div>
            ${t.participantes.length ? `<div class="mini turma-presenca">Presença: ${t.participantes.filter((p) => p.presenca).length}/${t.participantes.length}</div>` : ''}
          </div>
        </article>`).join('') : A.vazio('Nenhuma turma programada', 'Escolha uma trilha acima e programe a primeira turma.')}
    </div>`;

  const form = (t = {}) => `<div class="grade g2">${A.campo('titulo', 'Título', t.titulo)}
      ${A.selecao('trilha', 'Tipo contratado', trilhasLiberadas.map((x) => ({ v: x.id, t: x.titulo })), t.trilha)}</div>
    <div class="grade g3">${A.campo('data', 'Data', t.data, 'date')}
      ${A.campo('carga_horaria', 'Carga horária', t.carga_horaria || 4, 'number', 'step=0.5')}
      ${A.selecao('formato', 'Formato', [{ v: 'presencial', t: 'Presencial' }, { v: 'online', t: 'Online' }, { v: 'hibrido', t: 'Híbrido' }], t.formato || 'presencial')}</div>
    <div class="grade g2">${A.campo('instrutor', 'Instrutor', t.instrutor)}
      ${A.selecao('status', 'Status', [{ v: 'planejada', t: 'Planejada' }, { v: 'realizada', t: 'Realizada' }, { v: 'cancelada', t: 'Cancelada' }], t.status || 'planejada')}</div>
    ${A.area('observacoes', 'Observações', t.observacoes, 2)}`;

  const abrir = (t) => A.modal({ titulo: t ? 'Editar turma' : 'Programar turma', corpo: form(t || {}),
    aoConfirmar: async (d) => { if (t) await A.api(`/turmas/${t.id}`, { metodo: 'PUT', corpo: d });
      else await A.api(`/empresas/${S.empresaId}/turmas`, { metodo: 'POST', corpo: d }); A.ir('capacitacao'); } });

  document.getElementById('novaTurma').onclick = () => { if (trilhasLiberadas.length) abrir(null); };
  el.querySelectorAll('[data-et]').forEach((b) => { b.onclick = () => abrir(turmas.find((x) => x.id === Number(b.dataset.et))); });
  el.querySelectorAll('[data-rt]').forEach((b) => { b.onclick = () => A.confirmar('Excluir a turma e seus participantes?', async () => {
    await A.api(`/turmas/${b.dataset.rt}`, { metodo: 'DELETE' }); A.ir('capacitacao'); }); });

  el.querySelectorAll('[data-part]').forEach((b) => { b.onclick = () => {
    const t = turmas.find((x) => x.id === Number(b.dataset.part));
    A.modal({ titulo: `Participantes — ${t.titulo}`, largura: 720, confirmar: null,
      corpo: `<div style="display:flex;gap:8px;margin-bottom:14px">
          <input type="text" id="pNome" placeholder="Nome"><input type="text" id="pArea" placeholder="Área">
          <button class="btn pq" id="pAdd">Incluir</button></div>
        ${A.dropzone('zonaPart', '<b>Importar lista de participantes</b><div class="mini">colunas: Nome, Área, E-mail</div>', async (f) => {
          const fd = new FormData(); fd.append('arquivo', f);
          try { const r = await A.api(`/turmas/${t.id}/importar`, { metodo: 'POST', corpo: fd }); A.toast(`${r.importados} participantes`, 'ok'); A.ir('capacitacao'); }
          catch (e) { A.toast(e.message, 'erro'); } })}
        <div style="margin-top:14px">${A.tabela([
          { t: 'Nome', r: (p) => A.esc(p.nome) },
          { t: 'Área', r: (p) => A.esc(p.area || '—') },
          { t: 'Presença', r: (p) => `<input type="checkbox" data-pres="${p.id}" ${p.presenca ? 'checked' : ''}>` },
          { t: '', r: (p) => `<button class="btn pq perigo" data-rpa="${p.id}">Remover</button>` },
        ], t.participantes, { vazio: 'Nenhum participante.' })}</div>`,
    });
    setTimeout(() => {
      const add = document.getElementById('pAdd');
      if (add) add.onclick = async () => {
        const nome = document.getElementById('pNome').value.trim(); if (!nome) return;
        await A.api(`/turmas/${t.id}/participantes`, { metodo: 'POST', corpo: { nome, area: document.getElementById('pArea').value } });
        A.ir('capacitacao');
      };
      document.querySelectorAll('[data-pres]').forEach((c) => { c.onchange = async () => {
        const p = t.participantes.find((x) => x.id === Number(c.dataset.pres));
        await A.api(`/participantes/${p.id}`, { metodo: 'PUT', corpo: { ...p, presenca: c.checked } });
      }; });
      document.querySelectorAll('[data-rpa]').forEach((c) => { c.onclick = async () => {
        await A.api(`/participantes/${c.dataset.rpa}`, { metodo: 'DELETE' }); A.ir('capacitacao'); }; });
    }, 0);
  }; });
};

// ===========================================================================
// PLANO DE ADEQUAÇÃO
// ===========================================================================
Telas.plano = async (el) => {
  const { acoes } = await A.api(`/empresas/${S.empresaId}/acoes`);
  el.innerHTML = cab('Entregável', 'Plano de adequação',
    'O que precisa ser feito, por quem e até quando. É o entregável que transforma o diagnóstico em execução.',
    `<button class="btn" id="novaAcao">Nova ação</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/plano')">Exportar Excel</button>`) +
    `<div class="cartao">${A.tabela([
      { t: 'Prioridade', r: (a) => `<span class="tag ${a.prioridade === 'alta' ? 'a' : a.prioridade === 'media' ? 'b' : 'n'}">${a.prioridade}</span>` },
      { t: 'Ação', r: (a) => `<b>${A.esc(a.titulo)}</b><div class="mini">${A.esc(a.descricao || '')}</div>` },
      { t: 'Origem', r: (a) => `<span class="mini">${A.esc(a.origem)}</span>` },
      { t: 'Responsável', r: (a) => A.esc(a.responsavel || '—') },
      { t: 'Prazo', r: (a) => `<span class="mono mini">${A.esc(a.prazo || '—')}</span>` },
      { t: 'Status', r: (a) => `<span class="tag ${a.status === 'concluida' ? 'c' : 'n'}">${A.esc(a.status)}</span>` },
      { t: '', r: (a) => `<button class="btn pq vazio" data-ea="${a.id}">Editar</button><button class="btn pq perigo" data-ra="${a.id}">Excluir</button>` },
    ], acoes, { vazio: 'Nenhuma ação registrada. Use os riscos apontados no diagnóstico como ponto de partida.' })}</div>`;

  const form = (a = {}) => A.campo('titulo', 'Ação', a.titulo) + A.area('descricao', 'Descrição', a.descricao, 2) +
    `<div class="grade g2">${A.campo('responsavel', 'Responsável', a.responsavel)}${A.campo('prazo', 'Prazo', a.prazo, 'date')}</div>
     <div class="grade g2">${A.selecao('prioridade', 'Prioridade', [{ v: 'alta', t: 'Alta' }, { v: 'media', t: 'Média' }, { v: 'baixa', t: 'Baixa' }], a.prioridade || 'media')}
     ${A.selecao('status', 'Status', [{ v: 'aberta', t: 'Aberta' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluida', t: 'Concluída' }], a.status || 'aberta')}</div>`;

  document.getElementById('novaAcao').onclick = () => A.modal({ titulo: 'Nova ação', corpo: form(),
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/acoes`, { metodo: 'POST', corpo: d }); A.ir('plano'); } });
  el.querySelectorAll('[data-ea]').forEach((b) => { b.onclick = () => {
    const a = acoes.find((x) => x.id === Number(b.dataset.ea));
    A.modal({ titulo: 'Editar ação', corpo: form(a), aoConfirmar: async (d) => { await A.api(`/acoes/${a.id}`, { metodo: 'PUT', corpo: d }); A.ir('plano'); } }); }; });
  el.querySelectorAll('[data-ra]').forEach((b) => { b.onclick = async () => { await A.api(`/acoes/${b.dataset.ra}`, { metodo: 'DELETE' }); A.ir('plano'); }; });
};

// ===========================================================================
// SERVIÇOS E COMBOS
// ===========================================================================
Telas.servicos = async (el) => {
  const dados = await A.api('/servicos');
  const nomesLegados = new Set(['diagnóstico completo', 'implementação integral', 'essencial', 'margem protegida', 'blindagem contratual', 'time preparado']);
  const servicos = dados.servicos.filter((s) => !nomesLegados.has(String(s.nome || '').trim().toLowerCase()));
  const combos = dados.combos.filter((c) => !nomesLegados.has(String(c.nome || '').trim().toLowerCase()));
  const sel = S.cache.selServ || [];
  const modulos = [...new Set(servicos.map((s) => s.modulo))];

  el.innerHTML = cab('Escopo do projeto', 'Serviços e combos',
    'Defina exclusivamente o que será entregue ao cliente. A aprovação posterior congela esse escopo e libera os módulos correspondentes.') +
    `<div class="grade g3">${combos.map((c) => `<div class="cartao ${c.destaque ? '' : ''}" style="${c.destaque ? 'border-left:3px solid var(--ouro)' : ''}">
        <h2>${A.esc(c.nome)}</h2><p class="desc">${A.esc(c.descricao)}</p>
        <div class="mini">${c.servicos.length} serviços · ${c.acompanhamento_meses || 0} mês(es) de acompanhamento</div>
        <button class="btn vazio pq" style="margin-top:11px" data-combo="${c.id}">Selecionar combo</button>
      </div>`).join('')}</div>
    <div class="grade g2" style="margin-top:16px">
      <div>
        ${modulos.map((m) => `<div class="cartao"><h2>${A.esc(m)}</h2>
          <div class="lista-sel">${servicos.filter((s) => s.modulo === m).map((s) => `
            <label class="it ${sel.includes(s.id) ? 'on' : ''}">
              <input type="checkbox" data-serv="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}>
              <span><span class="nome">${A.esc(s.nome)}</span>
                <span class="txt">${A.esc(s.descricao)}</span>
              <span class="txt mini"><b>Entregáveis:</b> ${A.esc(s.entregaveis)}</span></span>
              <span class="mini">${s.prazo_dias} dias</span>
            </label>`).join('')}</div></div>`).join('')}
      </div>
      <div>
        <div class="cartao" style="position:sticky;top:20px"><h2>Escopo selecionado</h2><p class="desc">Resumo das entregas que serão registradas para aprovação.</p>
          <div id="resumoEscopo"><p class="mini">Selecione os serviços ao lado.</p></div>
        </div>
      </div>
    </div>`;

  const recalcular = async () => {
    const box = document.getElementById('resumoEscopo');
    if (!sel.length) { box.innerHTML = '<p class="mini">Selecione os serviços ao lado.</p>'; return; }
    const itens = servicos.filter((s) => sel.includes(s.id));
    const combo = combos.filter((c) => c.servicos.length && c.servicos.every((id) => sel.includes(id)))[0] || null;
    box.innerHTML = `${itens.map((i) => `<div style="padding:6px 0;border-bottom:1px solid #eef1f3;font-size:13px">${A.esc(i.nome)}</div>`).join('')}
      <div class="aviso" style="margin-top:12px"><b>${combo ? A.esc(combo.nome) : 'Escopo personalizado'}</b>${combo ? ` · ${combo.acompanhamento_meses || 0} mês(es) de acompanhamento` : ''}</div>
      <button class="btn ouro" style="width:100%;margin-top:12px" id="gravarProposta" ${S.empresaId ? '' : 'disabled'}>
        ${S.empresaId ? 'Registrar escopo para aprovação' : 'Selecione uma empresa'}</button>`;
    const g = document.getElementById('gravarProposta');
    if (g) g.onclick = async () => {
      await A.api(`/empresas/${S.empresaId}/contratacoes`, { metodo: 'POST', corpo: { combo_id: combo ? combo.id : null,
        servicos: sel, valor_bruto: 0, desconto: 0, valor_final: 0 } });
      A.toast('Escopo registrado', 'ok');
    };
  };

  el.querySelectorAll('[data-serv]').forEach((c) => { c.onchange = () => {
    const id = Number(c.dataset.serv);
    if (c.checked) { if (!sel.includes(id)) sel.push(id); } else { const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); }
    S.cache.selServ = sel;
    c.closest('.it').classList.toggle('on', c.checked);
    recalcular();
  }; });
  el.querySelectorAll('[data-combo]').forEach((b) => { b.onclick = () => {
    const c = combos.find((x) => x.id === Number(b.dataset.combo));
    S.cache.selServ = [...c.servicos]; A.ir('servicos'); }; });
  recalcular();
};

// ===========================================================================
// INTEGRAÇÃO QUESTOR
// ===========================================================================
Telas.questor = async (el) => {
  const { config } = await A.api('/questor/config');
  const { log } = await A.api('/questor/log');
  el.innerHTML = cab('Integração', 'Questor · nWeb',
    'Busca cadastros e movimentação direto do Questor Tributário, sem planilha. O nWeb roda na máquina do servidor Questor, porta 8080 por padrão.') +
    `<div class="grade g2">
      <div class="cartao"><h2>Conexão</h2><p class="desc">Endereço do serviço nWeb e token, quando exigido</p>
        ${A.campo('base_url', 'URL base do nWeb', config.baseUrl)}
        ${A.campo('token', 'Token (opcional)', config.token)}
        <label class="campo"><span>Integração ativa</span>
          <select name="ativo"><option value="1" ${config.ativo ? 'selected' : ''}>Ativa</option><option value="" ${config.ativo ? '' : 'selected'}>Inativa</option></select></label>
        <div style="display:flex;gap:8px">
          <button class="btn" id="salvarQ">Salvar</button>
          <button class="btn vazio" id="testarQ">Testar conexão</button>
        </div>
        <div id="resultadoQ" style="margin-top:14px"></div>
      </div>
      <div class="cartao"><h2>Buscar dados da empresa</h2>
        <p class="desc">${S.empresa ? `${A.esc(S.empresa.razao_social)} · código Questor: <b class="mono">${A.esc(S.empresa.codigo_questor || 'não informado')}</b>` : 'Selecione uma empresa'}</p>
        <div class="grade g2">${A.campo('inicio', 'Data inicial', '', 'date')}${A.campo('fim', 'Data final', '', 'date')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn vazio pq" data-q="participantes" data-tipo="fornecedor">Importar fornecedores</button>
          <button class="btn vazio pq" data-q="participantes" data-tipo="cliente">Importar clientes</button>
          <button class="btn vazio pq" data-q="movimentacao" data-tipo="fornecedor">Importar entradas</button>
          <button class="btn vazio pq" data-q="movimentacao" data-tipo="cliente">Importar saídas</button>
        </div>
        <hr class="sep">
        <h2 style="font-size:13px">Chamada livre</h2>
        <p class="desc">Para descobrir ou validar endpoints da sua instalação</p>
        ${A.campo('rawPath', 'Caminho', '/TnWebDMDadosGerais/PegarVersaoQuestor')}
        <button class="btn vazio pq" id="rawBtn">Executar</button>
        <pre id="rawOut" class="mini" style="max-height:220px;overflow:auto;background:#f4f7f9;padding:10px;border-radius:8px;margin-top:10px"></pre>
      </div>
    </div>
    <div class="cartao"><h2>Mapa de endpoints</h2>
      <p class="desc">Caminhos, parâmetros e de-para de campos. Ajuste conforme a versão do seu Questor — o sistema não depende de código para isso.</p>
      <textarea id="endpoints" rows="16" class="mono" style="font-size:12px">${A.esc(JSON.stringify(config.endpoints, null, 2))}</textarea>
      <button class="btn vazio pq" id="salvarEnd" style="margin-top:10px">Salvar mapa</button>
    </div>
    <div class="cartao"><h2>Histórico de chamadas</h2>
      ${A.tabela([
        { t: 'Quando', r: (l) => `<span class="mini mono">${A.esc(l.criado_em)}</span>` },
        { t: 'Endpoint', r: (l) => `<span class="mono mini">${A.esc(l.endpoint)}</span>` },
        { t: 'Status', r: (l) => `<span class="tag ${l.status === 'ok' ? 'c' : 'a'}">${A.esc(l.status)}</span>` },
        { t: 'Registros', num: true, r: (l) => l.registros },
        { t: 'Mensagem', r: (l) => `<span class="mini">${A.esc(l.mensagem)}</span>` },
      ], log, { vazio: 'Nenhuma chamada registrada.' })}
    </div>`;

  const val = (n) => (el.querySelector(`[name="${n}"]`) || {}).value || '';
  document.getElementById('salvarQ').onclick = async () => {
    await A.api('/questor/config', { metodo: 'POST', corpo: { base_url: val('base_url'), token: val('token'), ativo: !!val('ativo'), endpoints: config.endpoints } });
    A.toast('Conexão salva', 'ok');
  };
  document.getElementById('salvarEnd').onclick = async () => {
    try {
      const eps = JSON.parse(document.getElementById('endpoints').value);
      await A.api('/questor/config', { metodo: 'POST', corpo: { base_url: val('base_url'), token: val('token'), ativo: !!val('ativo'), endpoints: eps } });
      A.toast('Mapa de endpoints salvo', 'ok');
    } catch (e) { A.toast('JSON inválido: ' + e.message, 'erro'); }
  };
  document.getElementById('testarQ').onclick = async () => {
    const box = document.getElementById('resultadoQ');
    box.innerHTML = '<div class="carregando">Testando…</div>';
    try {
      const r = await A.api('/questor/testar', { metodo: 'POST' });
      box.innerHTML = r.resultados.map((x) => `<div class="aviso ${x.ok ? 'bom' : 'alto'}"><b>${A.esc(x.path)}</b>
        ${x.ok ? A.esc(JSON.stringify(x.resposta).slice(0, 200)) : A.esc(x.erro)}</div>`).join('');
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  };
  document.getElementById('rawBtn').onclick = async () => {
    const out = document.getElementById('rawOut'); out.textContent = 'Chamando…';
    try { const r = await A.api('/questor/raw', { metodo: 'POST', corpo: { path: val('rawPath') } });
      out.textContent = JSON.stringify(r.resposta, null, 2).slice(0, 4000); }
    catch (e) { out.textContent = e.message; }
  };
  el.querySelectorAll('[data-q]').forEach((b) => { b.onclick = async () => {
    if (!S.empresaId) return A.toast('Selecione uma empresa', 'erro');
    b.disabled = true;
    try {
      const r = await A.api(`/empresas/${S.empresaId}/questor/${b.dataset.q}`, { metodo: 'POST',
        corpo: { tipo: b.dataset.tipo, inicio: val('inicio'), fim: val('fim') } });
      A.toast(`${r.importados} registros importados`, 'ok');
    } catch (e) { A.toast(e.message, 'erro'); } finally { b.disabled = false; }
  }; });
};
})();
