/* Módulo 5 — Acompanhamento: previsto congelado x fotografia realizada. */
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') => `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1><p>${texto}</p></div><div class="acoes-topo">${acoes}</div></div>`;
const estado = (x) => `<span class="tag ${x === 'DIVERGENTE' ? 'a' : x === 'INCOMPLETO' ? 'b' : 'c'}">${A.esc(x || '—')}</span>`;
const valor = (n) => n === null || n === undefined ? '<span class="mini">INDETERMINADO</span>' : A.moeda(n);

Telas.acompanhamento = async (el) => {
  const d = await A.api(`/empresas/${S.empresaId}/acompanhamento`);
  const base = d.baselines[0], foto = d.snapshots[0];
  el.innerHTML = cab('Módulo 5 · acompanhamento', 'Previsto × realizado', 'O baseline aprovado permanece congelado. Cada fotografia posterior apenas evidencia desvios, causas e evidências.', '<button class="btn" id="novoBaseline">Congelar baseline</button><button class="btn vazio" id="novaFotografia">Registrar fotografia</button>') +
    `<div class="aviso"><b>Regra do módulo:</b> baseline aprovado + fotografia realizada = comparação. Nenhum resultado tributário, econômico ou de cenário é recalculado nesta tela.</div>` +
    `<div class="grade g4">
      ${A.kpi('Baselines aprovados', d.baselines.length, base ? `V${base.versao} é o mais recente` : 'nenhum baseline')}
      ${A.kpi('Fotografias realizadas', d.snapshots.length, foto ? foto.periodo : 'nenhuma fotografia')}
      ${A.kpi('Comparações', d.comparacoes.length, d.comparacoes[0]?.status || 'aguardando')}
      ${A.kpi('Desvios abertos', d.desvios.filter(x => x.status === 'DIVERGENTE').length, 'requerem validação')}
    </div>` +
    `<div class="grade g2"><div class="cartao"><h2>Baseline aprovado</h2>${base ? `<p><b>Versão ${base.versao}</b> · ${A.esc(base.origem)} · ${estado(base.natureza)}</p><p class="desc">${A.esc(base.descricao || 'Sem descrição adicional.')}</p><div class="mini">Aprovado em: ${A.esc(base.data_aprovacao)}</div>` : A.vazio('Nenhum baseline congelado', 'Crie a fotografia de referência aprovada antes de acompanhar o realizado.')}</div><div class="cartao"><h2>Fotografia realizada</h2>${foto ? `<p><b>${A.esc(foto.periodo)}</b> · ${A.esc(foto.origem)} · ${estado(foto.natureza)}</p><p class="desc">A ausência de dado é preservada como INDETERMINADO.</p>` : A.vazio('Nenhuma fotografia realizada', 'Registre um período posterior ou use os fatos oficiais já carregados.')}</div></div>` +
    `<div class="cartao"><div class="cabecalho-lista"><div><h2>Comparação previsto × realizado</h2><p class="desc">A comparação não altera o baseline e não substitui fatos originais.</p></div>${base && foto ? '<button class="btn" id="compararAcompanhamento">Comparar última baseline e fotografia</button>' : ''}</div>${d.comparacoes.length ? A.tabela([
      { t: 'Baseline', r: x => `V${x.baseline_versao}` }, { t: 'Realizado', r: x => A.esc(x.snapshot_periodo) }, { t: 'Status', r: x => estado(x.status) },
      { t: 'Memória', r: x => `<button class="btn pq vazio" data-comparacao="${x.id}">Ver desvios</button>` },
    ], d.comparacoes, { vazio: 'Nenhuma comparação ainda.' }) : A.vazio('Aguardando comparação', 'Selecione um baseline e uma fotografia realizada.')}</div>` +
    `<div class="cartao"><h2>Desvios e evidências</h2>${d.desvios.length ? A.tabela([
      { t: 'Métrica', r: x => A.esc(x.metrica) }, { t: 'Tipo', r: x => `<span class="mini mono">${A.esc(x.tipo)}</span>` },
      { t: 'Baseline', num: true, r: x => valor(x.baseline_valor) }, { t: 'Realizado', num: true, r: x => valor(x.realizado_valor) },
      { t: 'Diferença', num: true, r: x => x.diferenca_absoluta === null ? '<span class="mini">INDETERMINADO</span>' : A.setaR$(x.diferenca_absoluta) },
      { t: 'Status', r: x => estado(x.status) }, { t: '', r: x => `<button class="btn pq vazio" data-memoria-desvio="${x.id}">Memória</button>` },
    ], d.desvios, { vazio: 'Nenhum desvio registrado.' }) : A.vazio('Sem desvios para mostrar', 'Após comparar baseline e realizado, os desvios verificáveis aparecerão aqui.')}</div>`;

  document.getElementById('novoBaseline').onclick = () => A.modal({ titulo: 'Congelar baseline aprovado', descricao: 'Cria uma nova versão imutável a partir da consolidação oficial já disponível. Não recalcula tributos.', corpo: `${A.campo('descricao','Descrição do baseline','Baseline aprovado')}${A.campo('cenario_referencia','Cenário de referência','BASE')}`, confirmar: 'Criar baseline', aoConfirmar: async f => { await A.api(`/empresas/${S.empresaId}/acompanhamento/baselines`, { metodo:'POST', corpo:{ ...f, origem:'PERFIL_CBS_OFICIAL', natureza:'CALCULADO' } }); A.toast('Baseline congelado.','ok'); A.ir('acompanhamento'); } });
  document.getElementById('novaFotografia').onclick = () => A.modal({ titulo: 'Registrar fotografia realizada', descricao: 'A fotografia pode usar dados oficiais já carregados. Dados ausentes permanecem indeterminados.', corpo: `${A.campo('periodo','Período realizado','','month')}${A.selecao('origem','Origem',[{v:'PLATAFORMA',t:'Dados existentes na plataforma'},{v:'XML',t:'XML'},{v:'SPED',t:'SPED'},{v:'PLANILHA',t:'Planilha'}],'PLATAFORMA')}`, confirmar: 'Registrar fotografia', aoConfirmar: async f => { await A.api(`/empresas/${S.empresaId}/acompanhamento/snapshots`, { metodo:'POST', corpo:{...f,natureza:'CALCULADO'} }); A.toast('Fotografia registrada.','ok'); A.ir('acompanhamento'); } });
  document.querySelector('#compararAcompanhamento')?.addEventListener('click', async () => { await A.api(`/empresas/${S.empresaId}/acompanhamento/comparacoes`, { metodo:'POST', corpo:{ baseline_id:base.id, snapshot_id:foto.id } }); A.toast('Comparação atualizada.','ok'); A.ir('acompanhamento'); });
  el.querySelectorAll('[data-memoria-desvio]').forEach(b => b.onclick = async () => { const r = await A.api(`/acompanhamento/desvios/${b.dataset.memoriaDesvio}/memoria`); A.modal({ titulo:`Memória — ${r.desvio.metrica}`, descricao:'Rastreabilidade do desvio, sem recálculo.', corpo:`<pre class="memoria">${A.esc(JSON.stringify(r.memoria,null,2))}</pre>` }); });
};
})();
