/* =========================================================================
   SIMULAÇÃO DA CADEIA — composição 100% e migração entre grupos
   -------------------------------------------------------------------------
   A experiência principal não é "escolha o fornecedor que deseja modificar",
   e sim "escolha qual parte da composição das compras deseja simular".
   O detalhe continua acessível por drill-down, mas não é o ponto de partida.
   ========================================================================= */
(() => {
const A = App, S = App.S;
const M = window.MotorUI;

const CORES = ['#F2AC00', '#114866', '#5b8ba6', '#c98d00', '#7e8d97', '#b3261e', '#1c7a4d', '#16597e'];
const natTag = (n) => ({ CALCULADO: ['c', 'Calculado'], SIMULADO: ['b', 'Simulado'],
  INDETERMINADO: ['a', 'Não determinado'], REAL: ['c', 'Real'] }[n] || ['n', n || '—']);
const pp = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2).replace('.', ',')} p.p.`;

const est = () => (S.cache.sim = S.cache.sim || { lado: 'compras', dimensao: 'regime_fornecedor', cenarioId: null });

// =========================================================================
// BARRA DE COMPOSIÇÃO 100%
// =========================================================================
function barraComposicao(grupos, titulo) {
  const visiveis = grupos.filter((g) => g.participacao > 0.0001);
  const soma = visiveis.reduce((s, g) => s + g.participacao, 0);
  return `<div style="margin-bottom:6px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <b style="font-size:12.5px;color:var(--tinta-2)">${A.esc(titulo)}</b>
        <span class="mono mini">${A.pct(soma)}</span>
      </div>
      <div style="display:flex;height:26px;border-radius:6px;overflow:hidden;background:#eef1f3">
        ${visiveis.map((g, i) => `<div title="${A.esc(g.nome)} — ${A.pct(g.participacao)}"
          style="width:${g.participacao * 100}%;background:${CORES[i % CORES.length]};
                 display:flex;align-items:center;justify-content:center;overflow:hidden">
          ${g.participacao > 0.07 ? `<span style="font-size:10.5px;font-weight:700;color:#fff">${(g.participacao * 100).toFixed(0)}%</span>` : ''}
        </div>`).join('')}
      </div>
    </div>`;
}

function legenda(grupos, comparacao) {
  const visiveis = grupos.filter((g) => g.participacao > 0.0001 || (comparacao && comparacao[g.grupo]));
  return `<table class="compacta" style="margin-top:10px">
    <thead><tr><th></th><th>Grupo</th><th class="num">Valor</th>
      <th class="num">Participação</th>${comparacao ? '<th class="num">No cenário</th><th class="num">Variação</th>' : ''}
      <th class="num">Parceiros</th><th class="num">Crédito</th><th>Natureza</th></tr></thead>
    <tbody>${visiveis.map((g, i) => {
      const c = comparacao ? comparacao[g.grupo] : null;
      const delta = c ? c.participacao - g.participacao : 0;
      return `<tr>
        <td><span style="display:inline-block;width:11px;height:11px;border-radius:3px;background:${CORES[i % CORES.length]}"></span></td>
        <td>${A.esc(g.nome)}</td>
        <td class="num mono">${A.moeda(g.valor)}</td>
        <td class="num mono">${A.pct(g.participacao)}</td>
        ${c ? `<td class="num mono"><b>${A.pct(c.participacao)}</b></td>
               <td class="num mono ${delta > 0.0001 ? 'desce' : delta < -0.0001 ? 'sobe' : 'neutro'}">${Math.abs(delta) < 0.0001 ? '—' : pp(delta)}</td>` : ''}
        <td class="num mono">${g.entidades}</td>
        <td class="num mono">${A.moeda(g.creditoIbs + g.creditoCbs)}</td>
        <td><span class="tag ${natTag(g.natureza)[0]}">${natTag(g.natureza)[1]}</span></td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// =========================================================================
// TELA
// =========================================================================
async function simulacaoCadeia(el) {
  const e = est();
  const [{ cenarios }, dims, templates] = await Promise.all([
    A.api(`/empresas/${S.empresaId}/cenarios/lista`),
    A.api('/cenarios/dimensoes'),
    A.api('/cenarios/templates'),
  ]);
  const dimsLado = dims[e.lado] || [];
  if (!dimsLado.find((d) => d.chave === e.dimensao)) e.dimensao = dimsLado[0].chave;

  const hipoteses = cenarios.filter((c) => c.tipo === 'hipotese');
  if (e.cenarioId && !cenarios.find((c) => c.id === e.cenarioId)) e.cenarioId = null;

  el.innerHTML = M.seletorAno(() => A.ir('cenarios')) +
    `<div class="aviso bom" style="margin-bottom:16px"><b>Composição de cenário</b>
      <div class="acao">1. Crie uma hipótese · 2. selecione origem, destino e percentual · 3. aplique e recalcule · 4. compare Base × Cenário · 5. abra a memória até o documento. A hipótese comercial nunca substitui a classificação fiscal pendente.</div>
    </div>` +
    painelTemplates(templates.templates || []) +
    `<div class="cartao" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
      <label class="campo" style="margin:0;min-width:200px"><span>Cenário</span>
        <select id="selCenario">
          <option value="">Cenário base (fotografia atual)</option>
          ${hipoteses.map((c) => `<option value="${c.id}" ${e.cenarioId === c.id ? 'selected' : ''}>
            ${A.esc(c.nome)} · v${c.versao} · ${c.alocacoes} migração(ões)</option>`).join('')}
        </select></label>
      <label class="campo" style="margin:0"><span>Lado</span>
        <select id="selLado">
          <option value="compras" ${e.lado === 'compras' ? 'selected' : ''}>Compras</option>
          <option value="vendas" ${e.lado === 'vendas' ? 'selected' : ''}>Vendas</option>
        </select></label>
      <label class="campo" style="margin:0;min-width:240px"><span>Dimensão</span>
        <select id="selDim">${dimsLado.map((d) =>
          `<option value="${d.chave}" ${e.dimensao === d.chave ? 'selected' : ''}>${A.esc(d.nome)}</option>`).join('')}</select></label>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button class="btn" id="novoCenario">Criar simulação</button>
        ${e.cenarioId ? '<button class="btn vazio" id="duplicar">Duplicar</button>' : ''}
        ${e.cenarioId ? '<button class="btn vazio" id="compararBase">Comparar Base × cenário</button>' : ''}
        ${hipoteses.length >= 2 ? '<button class="btn vazio" id="comparar">Comparar vários</button>' : ''}
      </div>
    </div>
    <div id="corpoSim"><div class="carregando">Calculando composição…</div></div>`;

  document.getElementById('selCenario').onchange = (ev) => { e.cenarioId = Number(ev.target.value) || null; A.ir('cenarios'); };
  document.getElementById('selLado').onchange = (ev) => { e.lado = ev.target.value; e.dimensao = null; A.ir('cenarios'); };
  document.getElementById('selDim').onchange = (ev) => { e.dimensao = ev.target.value; A.ir('cenarios'); };
  document.getElementById('novoCenario').onclick = () => criarCenario(cenarios);
  document.querySelectorAll('[data-template]').forEach((b) => { b.onclick = () => criarTemplate(b.dataset.template); });
  const dup = document.getElementById('duplicar');
  if (dup) dup.onclick = () => criarCenario(cenarios, e.cenarioId);
  const cmpBase = document.getElementById('compararBase');
  if (cmpBase) cmpBase.onclick = () => compararCenarios(cenarios, [
    (cenarios.find((c) => c.tipo === 'base') || {}).id,
    e.cenarioId,
  ].filter(Boolean));
  const cmp = document.getElementById('comparar');
  if (cmp) cmp.onclick = () => compararCenarios(cenarios);

  await desenhar(document.getElementById('corpoSim'), e, dimsLado);
}

function painelTemplates(templates) {
  return `<div class="cartao" style="margin-bottom:16px"><h2>Cenários sugeridos A–H</h2>
    <p class="desc">São modelos de premissas editáveis — não são resultados prontos e nunca substituem a decisão do consultor.</p>
    <div class="grade g4">${templates.map((t) => `<div class="aviso" style="margin:0;display:flex;flex-direction:column;align-items:flex-start;gap:8px">
      <b>${A.esc(t.codigo)} — ${A.esc(t.nome)}</b><span class="mini">${A.esc(t.descricao)}</span>
      <button class="btn pq ${t.base ? 'vazio' : 'ouro'}" data-template="${A.esc(t.chave)}">${t.base ? 'Abrir referência' : 'Criar editável'}</button>
    </div>`).join('')}</div></div>`;
}

async function criarTemplate(chave) {
  const confirmar = chave === 'H_SIMPLES'
    ? window.confirm('Confirma que a comparação do Simples Nacional é juridicamente cabível para esta empresa e período?') : true;
  if (!confirmar) return;
  try {
    const r = await A.api(`/empresas/${S.empresaId}/cenarios/templates/${chave}`, { metodo: 'POST', corpo: {
      ano: M.anoAtual(), confirmar_simples: chave === 'H_SIMPLES' } });
    if (r.base) est().cenarioId = null; else est().cenarioId = r.id;
    A.toast(r.base ? 'Referência aberta' : 'Template criado como cenário editável', 'ok'); A.ir('cenarios');
  } catch (err) { A.toast(err.message, 'erro'); }
}

// -------------------------------------------------------------------------
async function desenhar(box, e, dimsLado) {
  const dim = dimsLado.find((d) => d.chave === e.dimensao);
  try {
    if (!e.cenarioId) {
      const d = await A.api(`/empresas/${S.empresaId}/cenarios/base?ano=${M.anoAtual()}`);
      const comp = d.composicao[e.lado][e.dimensao];
      box.innerHTML = kpisBase(d.indicadores, e.lado) +
        `<div class="cartao">
          <h2>Composição ${e.lado === 'compras' ? 'das compras' : 'das vendas'} — ${A.esc(comp.nome)}</h2>
          <p class="desc">${A.esc(comp.descricao || '')} Total analisado: ${A.moeda(comp.total)}.</p>
          ${barraComposicao(comp.grupos, 'Cenário base')}
          ${legenda(comp.grupos)}
        </div>
        ${cobertura(d.indicadores, e.lado)}
        <div class="aviso"><b>Este é o cenário base</b>
          A fotografia econômica atual, construída apenas com os dados importados. É imutável — toda
          hipótese é criada por cima dele.
          <div class="acao">Use "Criar simulação" para selecionar grupo de origem, grupo de destino e percentual.</div>
          <button class="btn ouro" id="criarDaBase" style="margin-top:10px">Criar hipótese de composição</button></div>`;
      box.querySelector('#criarDaBase').onclick = () => criarCenario([]);
      return;
    }

    const r = await A.api(`/cenarios/${e.cenarioId}/executar`, { metodo: 'POST' });
    const compBase = r.base.composicao[e.lado][e.dimensao];
    const compCen = r.composicao[e.lado][e.dimensao];
    const mapaCen = {}; compCen.grupos.forEach((g) => { mapaCen[g.grupo] = g; });

    box.innerHTML = kpisCenario(r, e.lado) +
      `<div class="cartao">
        <h2>Composição — ${A.esc(compCen.nome)}</h2>
        <p class="desc">${A.esc(compCen.descricao || '')}</p>
        ${barraComposicao(compBase.grupos, 'Cenário base')}
        <div style="height:10px"></div>
        ${barraComposicao(compCen.grupos, 'Cenário simulado')}
        ${legenda(compBase.grupos, mapaCen)}
      </div>
      ${await painelMigracao(e, compBase, dim)}
      ${efeitos(r, e)}
      ${cobertura(r.indicadores, e.lado)}
      <div class="cartao"><h2>Memória por grupo</h2>
        <p class="desc">Como o agregado foi construído. Clique para abrir o detalhe até o documento.</p>
        <div class="chips">${compCen.grupos.filter((g) => g.valor > 0 || (mapaCen[g.grupo] || {}).valor > 0)
          .map((g) => `<span class="chip" data-mem="${A.esc(g.grupo)}">${A.esc(g.nome)}</span>`).join('')}</div>
      </div>`;

    ligarMigracao(e);
    box.querySelectorAll('[data-mem]').forEach((c) => { c.onclick = () => memoria(e, c.dataset.mem); });
  } catch (err) {
    box.innerHTML = `<div class="aviso alto"><b>Não foi possível calcular</b>${A.esc(err.message)}</div>`;
  }
}

// -------------------------------------------------------------------------
function kpisBase(ind, lado) {
  const c = lado === 'compras';
  return `<div class="grade g4">
    ${A.kpi(c ? 'Compras analisadas' : 'Receita analisada', A.moeda(c ? ind.compras : ind.receita))}
    ${A.kpi(c ? 'Crédito recebido' : 'Crédito entregue', A.moeda(c ? ind.creditoRecebido : ind.creditoEntregue),
      c ? `taxa de recuperação ${A.pct(ind.taxaRecuperacao)}` : `${A.pct(ind.creditoEntregueSobreReceita)} da receita`)}
    ${A.kpi(c ? 'Exposição sem crédito' : 'Exposição comercial ao crédito',
      A.pct(c ? ind.exposicaoSemCredito : ind.exposicaoComercialCredito))}
    ${A.kpi('Cobertura cadastral', A.pct(c ? ind.coberturaCadastralFornecedores : ind.coberturaCadastralClientes),
      'do valor com perfil conhecido', 'destaque')}
  </div><div style="height:16px"></div>`;
}

function kpisCenario(r, lado) {
  const i = r.indicadores, b = r.base.indicadores;
  const c = lado === 'compras';
  const credI = c ? i.creditoRecebido : i.creditoEntregue;
  const credB = c ? b.creditoRecebido : b.creditoEntregue;
  const idx = r.indiceMudanca ? r.indiceMudanca[lado] : 0;
  return `<div class="grade g4">
    ${A.kpi(c ? 'Compras analisadas' : 'Receita analisada', A.moeda(c ? i.compras : i.receita))}
    ${A.kpi(c ? 'Crédito recebido' : 'Crédito entregue', A.moeda(credI), A.setaR$(credI - credB) + ' vs. base')}
    ${A.kpi('Custo efetivo das compras', A.moeda(i.custoEfetivoCompras),
      A.setaR$(i.custoEfetivoCompras - b.custoEfetivoCompras) + ' vs. base', 'destaque')}
    ${A.kpi('Carteira alterada por hipótese', A.pct(idx), 'grau de agressividade do cenário')}
  </div><div style="height:16px"></div>`;
}

function cobertura(ind, lado) {
  const d = lado === 'compras' ? ind.creditoRecebidoDetalhe : ind.creditoEntregueDetalhe;
  if (!d) return '';
  const linha = (k, rot) => {
    const x = d[k];
    if (!x || (!x.valor && !x.itens)) return '';
    const cred = x.credito === null ? '<b class="tag a">NÃO DETERMINADO</b>' : A.moeda(x.credito);
    return `<tr><td>${rot}</td><td class="num mono">${A.moeda(x.valor)}</td>
      <td class="num mono">${A.pct(x.participacao)}</td><td class="num">${cred}</td>
      <td class="mini">${A.esc(x.observacao || '')}</td></tr>`;
  };
  return `<div class="cartao"><h2>Crédito por natureza do dado</h2>
    <p class="desc">Ausência de informação nunca é convertida em zero. Zero apurado e não determinado
      são coisas diferentes, e a tela distingue as duas.</p>
    <table class="compacta"><thead><tr><th>Natureza</th><th class="num">Valor</th>
      <th class="num">Participação</th><th class="num">Crédito</th><th>Observação</th></tr></thead>
      <tbody>
        ${linha('confirmado', 'Confirmado')}
        ${linha('simulado', 'Simulado')}
        ${linha('semDireito', 'Sem direito (zero apurado)')}
        ${linha('indeterminado', 'Indeterminado')}
      </tbody></table>
    <div class="aviso ${d.cobertura < 0.5 ? 'atencao' : 'bom'}" style="margin-top:12px">
      <b>Cobertura da análise: ${A.pct(d.cobertura)}</b>
      ${d.cobertura < 0.5
        ? 'Boa parte do valor depende de informação que ainda não está no cadastro. O resultado é uma leitura parcial — e o sistema prefere dizer isso a exibir um número otimista.'
        : 'A maior parte do valor tem tratamento de crédito determinado.'}</div>
  </div>`;
}

function efeitos(r, e) {
  if (e.lado !== 'compras' || !r.efeitos) return '';
  const f = r.efeitos.compras;
  const linha = (rot, val, cls, nota) => `<tr><td>${rot}${nota ? `<div class="mini">${nota}</div>` : ''}</td>
    <td class="num mono ${cls || ''}">${A.moeda(val)}</td></tr>`;
  return `<div class="cartao"><h2>Decomposição do efeito</h2>
    <p class="desc">Premissa: <b>${f.premissaPadrao === 'BASE_ECONOMICA_CONSTANTE'
      ? 'base econômica constante — nenhuma alteração comercial negociada'
      : 'variação comercial informada pelo consultor'}</b></p>
    <table class="compacta">
      ${linha('Efeito comercial', f.efeitoComercial, '', 'variação da base econômica negociada')}
      ${linha('Efeito tributário', f.efeitoTributario, '', 'IBS/CBS que passa a incidir por fora')}
      ${linha('Efeito crédito', -f.efeitoCredito, '', 'variação do crédito recuperável (entra com sinal invertido)')}
      <tr style="background:var(--ouro-100)"><td><b>Efeito líquido no custo efetivo</b></td>
        <td class="num mono"><b class="${f.efeitoLiquido > 0 ? 'sobe' : 'desce'}">${A.moeda(f.efeitoLiquido)}</b></td></tr>
    </table>
    <div class="aviso ${f.efeitoLiquido > 0 ? 'atencao' : 'bom'}" style="margin-top:12px">${A.esc(f.leitura)}</div>
    ${f.efeitoLiquido > 0 && f.efeitoCredito > 0 ? `<div class="aviso"><b>Mais crédito não é automaticamente melhor</b>
      O crédito subiu, mas o tributo destacado subiu mais. O sistema mostra os dois efeitos separados
      justamente para que a decisão não seja tomada só pelo crédito.</div>` : ''}
  </div>`;
}

// =========================================================================
// PAINEL DE MIGRAÇÃO
// =========================================================================
async function painelMigracao(e, compBase, dim) {
  const { cenarios } = await A.api(`/empresas/${S.empresaId}/cenarios/lista`);
  const cen = cenarios.find((c) => c.id === e.cenarioId) || {};
  const grupos = compBase.grupos;
  const opt = (sel) => grupos.map((g) =>
    `<option value="${A.esc(g.grupo)}" ${sel === g.grupo ? 'selected' : ''}>${A.esc(g.nome)} — ${A.pct(g.participacao)}</option>`).join('');

  return `<div class="cartao"><h2>1. Compor a hipótese</h2>
    <p class="desc">Escolha qual parte da composição deseja simular. O percentual é do <b>grupo</b>,
      não do total — o sistema mostra a equivalência.</p>
    <div class="grade g4" style="align-items:end">
      <label class="campo" style="margin:0"><span>Grupo de origem</span>
        <select id="migOrigem">${opt(grupos[0] && grupos[0].grupo)}</select></label>
      <label class="campo" style="margin:0"><span>Migrar (% do grupo)</span>
        <input type="number" id="migPerc" min="0" max="100" step="1" value="40"></label>
      <label class="campo" style="margin:0"><span>Grupo de destino</span>
        <select id="migDestino">${opt(grupos[1] && grupos[1].grupo)}</select></label>
      <label class="campo" style="margin:0"><span>Alteração comercial (%)</span>
        <input type="number" id="migVar" step="0.5" value="0" placeholder="0 = base constante"></label>
    </div>
    <div class="aviso" id="migPrevia"></div>
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
      <input type="text" id="migJust" placeholder="Justificativa da hipótese (opcional)" style="flex:1;min-width:240px">
      <button class="btn ouro" id="migAplicar">Aplicar e recalcular</button>
    </div>
    ${cen.alocacoes ? `<hr class="sep"><h2 style="font-size:13px">Migrações deste cenário</h2>
      <div id="listaAloc"><div class="carregando">carregando…</div></div>` : ''}
  </div>`;
}

function ligarMigracao(e) {
  const org = document.getElementById('migOrigem');
  if (!org) return;
  const perc = document.getElementById('migPerc');
  const dst = document.getElementById('migDestino');
  const varr = document.getElementById('migVar');
  const previa = document.getElementById('migPrevia');

  const atualizar = () => {
    const txtO = org.options[org.selectedIndex].text;
    const partO = parseFloat((txtO.split('—')[1] || '0').replace('%', '').replace(',', '.')) / 100 || 0;
    const p = (Number(perc.value) || 0) / 100;
    const total = partO * p;
    const v = Number(varr.value) || 0;
    previa.innerHTML = `<b>Equivalência</b>
      O grupo de origem representa ${A.pct(partO)} do total. Migrar ${A.pct(p, 0)} dele equivale a
      <b>${A.pct(total)} do total analisado</b>.
      ${v ? `<div class="acao">Com alteração comercial de ${v > 0 ? '+' : ''}${v}%, a base econômica dos itens migrados é ajustada — o efeito comercial aparece separado do tributário.</div>`
          : '<div class="acao">Sem alteração comercial: base econômica constante, todo o efeito é tributário.</div>'}`;
  };
  [org, perc, dst, varr].forEach((x) => { x.oninput = atualizar; x.onchange = atualizar; });
  atualizar();

  document.getElementById('migAplicar').onclick = async () => {
    if (org.value === dst.value) return A.toast('Origem e destino não podem ser o mesmo grupo.', 'erro');
    const p = (Number(perc.value) || 0) / 100;
    if (!(p > 0 && p <= 1)) return A.toast('O percentual deve estar entre 1 e 100.', 'erro');
    try {
      const r = await A.api(`/cenarios/${e.cenarioId}/alocacoes`, { metodo: 'POST', corpo: {
        lado: e.lado, dimensao: e.dimensao, grupo_origem: org.value, grupo_destino: dst.value,
        percentual_grupo: p, variacao_preco: (Number(varr.value) || 0) / 100,
        justificativa: document.getElementById('migJust').value } });
      A.toast(`Migração aplicada — ${A.pct(r.percentualTotal || 0)} do total`, 'ok');
      A.ir('cenarios');
    } catch (err) { A.toast(err.message, 'erro'); }
  };

  const lista = document.getElementById('listaAloc');
  if (lista) carregarAlocacoes(e, lista);
}

async function carregarAlocacoes(e, box) {
  const r = await A.api(`/cenarios/${e.cenarioId}/executar`, { metodo: 'POST' });
  const alocs = await A.api(`/cenarios/${e.cenarioId}/alocacoes`).catch(() => ({ alocacoes: [] }));
  const lista = alocs.alocacoes || [];
  box.innerHTML = lista.length ? A.tabela([
    { t: 'Lado', r: (a) => `<span class="tag">${a.lado}</span>` },
    { t: 'Origem', r: (a) => A.esc(a.grupo_origem) },
    { t: '% do grupo', num: true, r: (a) => A.pct(a.percentual_grupo, 0) },
    { t: '% do total', num: true, r: (a) => A.pct(a.percentual_total || 0) },
    { t: 'Valor afetado', num: true, r: (a) => A.moeda(a.valor_afetado) },
    { t: 'Destino', r: (a) => A.esc(a.grupo_destino) },
    { t: 'Alteração comercial', num: true, r: (a) => a.variacao_preco ? A.pct(a.variacao_preco, 1) : '—' },
    { t: '', r: (a) => `<button class="btn pq perigo" data-del="${a.id}">Remover</button>` },
  ], lista) : '<p class="mini">Nenhuma migração aplicada.</p>';
  box.querySelectorAll('[data-del]').forEach((b) => { b.onclick = async () => {
    await A.api(`/cenarios/alocacoes/${b.dataset.del}`, { metodo: 'DELETE' }); A.ir('cenarios'); }; });
}

// =========================================================================
// MEMÓRIA E DRILL-DOWN
// =========================================================================
async function memoria(e, grupo) {
  const { memoria: m } = await A.api(`/cenarios/${e.cenarioId}/memoria/${e.lado}/${e.dimensao}/${grupo}`);
  A.modal({
    titulo: `Memória do grupo — ${m.nome}`, largura: 900, confirmar: null,
    descricao: 'Nível 1: como o agregado foi construído. Abra o detalhe para chegar ao documento.',
    corpo: `${m.base && m.cenario ? `<div class="grade g3">
        ${A.kpi('Valor no base', A.moeda(m.base.valor), A.pct(m.base.participacao))}
        ${A.kpi('Valor no cenário', A.moeda(m.cenario.valor), A.pct(m.cenario.participacao), 'destaque')}
        ${A.kpi('Variação', A.setaR$(m.variacao.valor), pp(m.variacao.participacao))}
      </div>` : ''}
      <h3 style="font-size:13px;margin-top:16px">Passos</h3>
      ${m.passos.map((p) => `<div class="aviso ${p.natureza === 'SIMULADO' ? 'atencao' : ''}">
        <b>${A.esc(p.etapa)} <span class="tag ${natTag(p.natureza)[0]}">${natTag(p.natureza)[1]}</span></b>
        ${A.esc(p.texto)}</div>`).join('')}
      ${m.cenario ? `<table class="compacta" style="margin-top:14px">
        <tr><td>Base econômica</td><td class="num mono">${A.moeda(m.cenario.baseEconomica)}</td></tr>
        <tr><td>IBS</td><td class="num mono">${A.moeda(m.cenario.ibs)}</td></tr>
        <tr><td>CBS</td><td class="num mono">${A.moeda(m.cenario.cbs)}</td></tr>
        <tr><td>Crédito total</td><td class="num mono">${A.moeda(m.cenario.creditoTotal)}</td></tr>
        <tr><td>Taxa de recuperação</td><td class="num mono">${A.pct(m.cenario.taxaRecuperacao)}</td></tr>
        <tr style="background:var(--ouro-100)"><td><b>Custo efetivo</b></td><td class="num mono"><b>${A.moeda(m.cenario.custoEfetivo)}</b></td></tr>
      </table>` : ''}
      <button class="btn vazio" id="btnDrill" style="margin-top:14px;width:100%">Abrir detalhe até o documento (${m.itens} linhas)</button>
      <div id="boxDrill"></div>`,
  });
  setTimeout(() => {
    const b = document.getElementById('btnDrill');
    if (b) b.onclick = () => drill(e, grupo);
  }, 0);
}

async function drill(e, grupo) {
  const box = document.getElementById('boxDrill');
  box.innerHTML = '<div class="carregando">Carregando detalhe…</div>';
  const { itens } = await A.api(`/cenarios/${e.cenarioId}/drilldown/${e.lado}/${e.dimensao}/${grupo}?limite=120`);
  box.innerHTML = `<hr class="sep"><h3 style="font-size:13px">Nível 2 — detalhe</h3>
    ${A.tabela([
      { t: 'Documento', r: (x) => `<span class="mini mono">${A.esc(x.documento || '—')}</span>` },
      { t: 'Contraparte', r: (x) => `${A.esc((x.contraparte || '').slice(0, 26))}<div class="mini">${A.esc((x.descricao || '').slice(0, 34))}</div>` },
      { t: 'Fração', num: true, r: (x) => x.fracao < 1 ? `<b class="tag b">${(x.fracao * 100).toFixed(0)}%</b>` : '100%' },
      { t: 'NCM/NBS', r: (x) => `<span class="mono mini">${A.esc(x.ncm || x.nbs || '—')}</span>` },
      { t: 'CST', r: (x) => `<span class="mono mini">${A.esc(x.cst || '—')}</span>` },
      { t: 'cClassTrib', r: (x) => `<span class="mono mini">${A.esc(x.cclasstrib || '—')}</span>` },
      { t: 'Preço', num: true, r: (x) => A.moeda(x.precoAtual) },
      { t: 'Base econ.', num: true, r: (x) => A.moeda(x.baseEconomica) },
      { t: 'IBS', num: true, r: (x) => A.moeda(x.ibs) },
      { t: 'CBS', num: true, r: (x) => A.moeda(x.cbs) },
      { t: 'Crédito', num: true, r: (x) => A.moeda(x.creditoIbs + x.creditoCbs) },
      { t: 'Natureza', r: (x) => `<span class="tag ${natTag(x.natureza)[0]}">${natTag(x.natureza)[1]}</span>` },
      { t: 'Regra vencedora', r: (x) => {
        const campos = Object.entries(x.resolucaoPremissas || {});
        return campos.length ? `<button class="btn pq vazio" data-res='${A.esc(JSON.stringify(x.resolucaoPremissas))}'>${campos.map(([c, r]) => `${A.esc(c)} · ${A.esc(r.nivel_precedencia_aplicado)}`).join('<br>')}</button>` : 'Original';
      } },
    ], itens)}
    <div class="mini" style="margin-top:8px">Mostrando ${itens.length} linhas. A fração indica a parte
      do lançamento que pertence a este grupo — a expansão proporcional preserva o mix tributário.</div>`;
  box.querySelectorAll('[data-res]').forEach((b) => { b.onclick = () => {
    const resolucoes = JSON.parse(b.dataset.res);
    const valor = (x) => x === null || x === undefined ? '—' : A.esc(String(x));
    A.modal({ titulo: 'Resolução das premissas', largura: 900, confirmar: null,
      descricao: 'individual > grupo > global > original. Os fatos do documento permanecem preservados.',
      corpo: A.tabela([
        { t: 'Campo', r: (x) => `<b>${A.esc(x.campo)}</b>` },
        { t: 'Original', r: (x) => valor(x.valor_original) },
        { t: 'Global', r: (x) => valor(x.premissa_global?.valor) },
        { t: 'Grupo', r: (x) => valor(x.premissa_grupo?.valor) },
        { t: 'Individual', r: (x) => valor(x.premissa_individual?.valor) },
        { t: 'Valor efetivo', r: (x) => `<b>${valor(x.valor_efetivo)}</b>` },
        { t: 'Regra vencedora', r: (x) => `<span class="tag b">${A.esc(x.nivel_precedencia_aplicado)}</span><div class="mini">${A.esc(x.origem_da_premissa || '')} · ${A.esc(x.natureza || '')}</div>` },
      ], Object.entries(resolucoes).map(([campo, r]) => ({ campo, ...r }))) });
  }; });
}

// =========================================================================
// CRIAR E COMPARAR
// =========================================================================
function criarCenario(cenarios, duplicarDe) {
  A.modal({
    titulo: duplicarDe ? 'Duplicar cenário' : 'Criar simulação',
    descricao: 'O cenário base permanece intacto. Toda hipótese é criada por cima dele.',
    corpo: A.campo('nome', 'Nome do cenário', duplicarDe
      ? `${(cenarios.find((c) => c.id === duplicarDe) || {}).nome} (cópia)` : '')
      + A.area('descricao', 'Premissas e contexto', '', 2),
    aoConfirmar: async (d) => {
      const r = await A.api(`/empresas/${S.empresaId}/cenarios`, { metodo: 'POST',
        corpo: { ...d, ano: M.anoAtual(), duplicar_de: duplicarDe || undefined } });
      est().cenarioId = r.id;
      A.toast('Cenário criado', 'ok'); A.ir('cenarios');
    },
  });
}

function compararCenarios(cenarios, preselecionados = null) {
  const e = est();
  const selecionado = (c) => preselecionados ? preselecionados.includes(c.id) : (c.tipo === 'base' || c.id === e.cenarioId);
  A.modal({
    titulo: preselecionados ? 'Base × cenário' : 'Comparar cenários', largura: 960, confirmar: 'Comparar',
    descricao: preselecionados ? 'A comparação usa a fotografia base imutável e a hipótese selecionada.' : 'Selecione de 2 a 5 cenários.',
    corpo: `<div class="lista-sel">${cenarios.map((c) => `<label class="it">
        <input type="checkbox" data-cmp="${c.id}" ${selecionado(c) ? 'checked' : ''}>
        <span><span class="nome">${A.esc(c.nome)}</span>
          <span class="txt mini">${c.tipo === 'base' ? 'cenário base' : `v${c.versao} · ${c.alocacoes} migração(ões)`}</span></span>
      </label>`).join('')}</div><div id="boxCmp" style="margin-top:14px"></div>`,
    aoConfirmar: async (_d, fundo) => {
      const ids = [...fundo.querySelectorAll('[data-cmp]:checked')].map((i) => Number(i.dataset.cmp));
      if (ids.length < 2) throw new Error('Selecione ao menos dois cenários.');
      if (ids.length > 5) throw new Error('Selecione no máximo cinco cenários.');
      const box = fundo.querySelector('#boxCmp');
      box.innerHTML = '<div class="carregando">Calculando…</div>';
      const { cenarios: linhas } = await A.api('/cenarios/comparar', { metodo: 'POST', corpo: { ids } });
      const linha = (rot, fn, fmt = A.moeda) => `<tr><td>${rot}</td>${linhas.map((c) =>
        `<td class="num mono">${fmt(fn(c))}</td>`).join('')}</tr>`;
      const n = (v) => v === null || v === undefined ? '<span class="tag a">INCOMPLETO</span>' : A.moeda(v);
      const comp = (c, lado, dim) => ((c.composicao[lado] || {})[dim] || {}).grupos || [];
      const resumoComp = (c, lado, dim) => comp(c, lado, dim).filter((g) => g.participacao > 0.0001)
        .map((g) => `${A.esc(g.nome)} ${A.pct(g.participacao)}`).join('<br>') || '—';
      box.innerHTML = `<div class="aviso"><b>Comparação reconciliada com o motor</b><div class="acao">Margem e caixa só aparecem quando existe formação de custo explícita e completa. Caixa = disponibilidade operacional antes de prazos; não representa fluxo financeiro contratado.</div></div>
        <div style="overflow:auto"><table class="compacta"><thead><tr><th>Indicador</th>
          ${linhas.map((c) => `<th class="num">${A.esc(c.nome.slice(0, 24))}</th>`).join('')}</tr></thead><tbody>
          ${linha('Compras', (c) => c.indicadores.compras)}
          ${linha('Receita', (c) => c.indicadores.receita)}
          ${linha('Preço médio projetado', (c) => c.indicadores.precoMedio)}
          ${linha('Base econômica — saídas', (c) => c.indicadores.baseEconomicaSaidas)}
          ${linha('Base econômica — entradas', (c) => c.indicadores.baseEconomicaEntradas)}
          ${linha('Crédito recebido', (c) => c.indicadores.creditoRecebido)}
          ${linha('Crédito entregue', (c) => c.indicadores.creditoEntregue)}
          ${linha('Custo efetivo das compras', (c) => c.indicadores.custoEfetivoCompras)}
          ${linha('Débito IBS', (c) => c.apuracao.ibs.debitos)}
          ${linha('Crédito IBS', (c) => c.apuracao.ibs.creditos)}
          ${linha('Débito CBS', (c) => c.apuracao.cbs.debitos)}
          ${linha('Crédito CBS', (c) => c.apuracao.cbs.creditos)}
          ${linha('Carga líquida', (c) => c.apuracao.cargaLiquida)}
          <tr><td>Margem econômica <div class="mini">cobertura de custo</div></td>${linhas.map((c) => `<td class="num mono">${n(c.indicadores.margem)}<div class="mini">${A.pct(c.indicadores.coberturaMargem || 0)}</div></td>`).join('')}</tr>
          <tr><td>Caixa operacional <div class="mini">antes de prazos</div></td>${linhas.map((c) => `<td class="num mono">${n(c.indicadores.caixaOperacional)}</td>`).join('')}</tr>
          ${linha('Taxa de recuperação', (c) => c.indicadores.taxaRecuperacao, A.pct)}
          ${linha('Cobertura de fornecedores', (c) => c.indicadores.coberturaCadastralFornecedores, A.pct)}
          ${linha('Carteira alterada (compras)', (c) => (c.indiceMudanca || {}).compras || 0, A.pct)}
          <tr><td>Composição de fornecedores</td>${linhas.map((c) => `<td class="mini">${resumoComp(c, 'compras', 'regime_fornecedor')}</td>`).join('')}</tr>
          <tr><td>Composição de clientes</td>${linhas.map((c) => `<td class="mini">${resumoComp(c, 'vendas', 'perfil_cliente')}</td>`).join('')}</tr>
        </tbody></table></div>
        <h3 style="font-size:14px;margin-top:16px">Efeito econômico versus referência</h3>
        <table class="compacta"><thead><tr><th>Cenário</th><th class="num">Crédito adicional</th><th class="num">Alteração do custo bruto</th><th class="num">Ganho/perda líquida no custo efetivo</th><th></th></tr></thead><tbody>
          ${linhas.map((c) => `<tr><td><b>${A.esc(c.nome)}</b></td><td class="num mono">${A.setaR$(c.efeitoEconomico.credito_adicional)}</td><td class="num mono">${A.setaR$(c.efeitoEconomico.alteracao_custo_bruto)}</td><td class="num mono">${A.setaR$(c.efeitoEconomico.ganho_perda_custo_efetivo)}</td><td><button class="btn pq vazio" data-drill-cenario="${c.id}">Drill-down</button></td></tr>`).join('')}
        </tbody></table>`;
      box.querySelectorAll('[data-drill-cenario]').forEach((b) => { b.onclick = () => drillComparacao(Number(b.dataset.drillCenario)); });
      return false;   // mantém o modal aberto com o resultado
    },
  });
}

async function drillComparacao(cenarioId) {
  const { itens } = await A.api(`/cenarios/${cenarioId}/drilldown/compras/regime_fornecedor/regular?limite=80`)
    .catch(() => ({ itens: [] }));
  A.modal({ titulo: 'Drill-down do cenário', largura: 1000, confirmar: null,
    descricao: 'Detalhe do cenário até documento/operação. Para outros grupos, abra a composição do cenário e use a memória por grupo.',
    corpo: itens.length ? A.tabela([
      { t: 'Documento', r: (x) => A.esc(x.documento || '—') }, { t: 'Contraparte', r: (x) => A.esc(x.contraparte || '—') },
      { t: 'NCM/NBS', r: (x) => A.esc(x.ncm || x.nbs || '—') }, { t: 'Base econômica', num: true, r: (x) => A.moeda(x.baseEconomica) },
      { t: 'CBS', num: true, r: (x) => A.moeda(x.cbs) }, { t: 'Crédito', num: true, r: (x) => A.moeda((x.creditoIbs || 0) + (x.creditoCbs || 0)) },
      { t: 'Natureza', r: (x) => A.esc(x.natureza) },
    ], itens) : '<div class="aviso">Não há itens no grupo regular para este cenário. Abra o cenário e escolha outro grupo na memória.</div>' });
}

// =========================================================================
// ETAPA 5 — INDICADORES, ALERTAS E MATRIZ FORNECEDORES × CLIENTES
// =========================================================================
async function indicadoresCadeia(el) {
  const { cenarios } = await A.api(`/empresas/${S.empresaId}/cenarios/lista`);
  const e = est();
  const padrao = e.cenarioId || (cenarios.find((c) => c.tipo === 'base') || {}).id;
  el.innerHTML = M.seletorAno(() => A.ir('cenarios')) + `<div class="cartao" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
    <label class="campo" style="margin:0;min-width:320px"><span>Cenário analisado</span>
      <select id="analiseCenario">${cenarios.map((c) => `<option value="${c.id}" ${Number(c.id) === Number(padrao) ? 'selected' : ''}>${A.esc(c.nome)}${c.tipo === 'base' ? ' · referência' : ''}</option>`).join('')}</select></label>
    <button class="btn" id="analiseAtualizar">Atualizar indicadores</button>
  </div><div id="corpoAnalise" style="margin-top:16px"><div class="carregando">Consolidando resultados oficiais…</div></div>`;
  const carregar = async () => {
    const id = Number(document.getElementById('analiseCenario').value);
    await desenharAnalise(document.getElementById('corpoAnalise'), id);
  };
  document.getElementById('analiseAtualizar').onclick = carregar;
  document.getElementById('analiseCenario').onchange = carregar;
  if (padrao) await carregar();
}

async function desenharAnalise(box, cenarioId) {
  try {
    const { cenario, analise } = await A.api(`/cenarios/${cenarioId}/analitica`);
    const inds = Object.values(analise.indicadores);
    const valor = (x) => x.valor === null || x.valor === undefined ? '<span class="tag a">INCOMPLETO</span>' : A.moeda(x.valor);
    const percentual = (x) => x.percentual === null || x.percentual === undefined ? '—' : A.pct(x.percentual);
    box.innerHTML = `<div class="aviso bom"><b>Indicadores derivados da memória do cenário</b><div class="acao">Fonte: ${A.esc(analise.origem)}. Nenhum indicador redistribui dados desconhecidos ou recalcula tributos.</div></div>
      <div class="grade g4" style="margin-top:16px">${inds.map((x) => A.kpi(x.nome, x.chave === 'indice_mudanca_cadeia' ? `${A.pct(x.compras)} compras · ${A.pct(x.vendas)} vendas` : valor(x), x.percentual !== undefined ? percentual(x) : x.descricao, x.chave === 'exposicao_credito_indeterminado' ? 'destaque' : '')).join('')}</div>
      <div class="cartao"><h2>Indicadores detalhados — ${A.esc(cenario.nome)}</h2><p class="desc">Clique em “Memória” para chegar ao grupo, parceiro e documento que sustentam cada número.</p>
        ${A.tabela([
          { t:'Indicador', r:(x) => `<b>${A.esc(x.nome)}</b><div class="mini">${A.esc(x.descricao)}</div>` },
          { t:'Valor', num:true, r:valor }, { t:'Participação', num:true, r:percentual },
          { t:'', r:(x) => x.drilldown?.grupos?.length ? `<button class="btn pq vazio" data-ind-drill='${A.esc(JSON.stringify(x.drilldown))}'>Memória</button>` : '—' },
        ], inds)}</div>
      ${painelAlertas(analise.alertas)}
      ${painelMatriz(analise.matriz)}`;
    box.querySelectorAll('[data-ind-drill]').forEach((b) => { b.onclick = () => {
      const d = JSON.parse(b.dataset.indDrill); memoria({ cenarioId, lado:d.lado, dimensao:d.dimensao }, d.grupos[0]);
    }; });
    box.querySelectorAll('[data-matriz-drill]').forEach((b) => { b.onclick = () => {
      const d = JSON.parse(b.dataset.matrizDrill); memoria({ cenarioId, lado:d.lado, dimensao:d.dimensao }, d.grupos[0]);
    }; });
  } catch (err) { box.innerHTML = `<div class="aviso alto"><b>Não foi possível consolidar a análise</b>${A.esc(err.message)}</div>`; }
}

function painelAlertas(alertas) {
  return `<div class="cartao"><h2>Alertas explicáveis</h2><p class="desc">Cada alerta informa o dado que o originou; não há recomendação automática sem memória.</p>
    ${alertas.length ? `<div class="grade g2">${alertas.map((a) => `<div class="aviso ${a.severidade === 'alto' ? 'alto' : a.severidade === 'bom' ? 'bom' : 'atencao'}"><b>${A.esc(a.titulo)}</b><div>${A.esc(a.texto)}</div>
      <div class="mini" style="margin-top:6px">Evidência: ${A.esc(JSON.stringify(a.evidencia))}</div>
      ${a.drilldown?.grupos?.length ? `<button class="btn pq vazio" data-ind-drill='${A.esc(JSON.stringify(a.drilldown))}' style="margin-top:8px">Abrir memória</button>` : ''}</div>`).join('')}</div>` : '<div class="aviso bom">Nenhum limiar de alerta foi atingido pelos resultados disponíveis.</div>'}
  </div>`;
}

function painelMatriz(matriz) {
  const cab = matriz.horizontais.map((h) => `<th class="num">${A.esc(h.nome)}</th>`).join('');
  return `<div class="cartao"><h2>Matriz estratégica — Fornecedores × Clientes</h2><p class="desc">${A.esc(matriz.observacao)}</p>
    <div style="overflow:auto"><table class="compacta"><thead><tr><th>Perfil de fornecedores</th>${cab}</tr></thead><tbody>
      ${matriz.linhas.map((l) => `<tr><td><b>${A.esc(l.nome)}</b><div class="mini">${A.pct(l.participacao)} das compras</div></td>${l.celulas.map((c) => `<td class="num" style="min-width:180px"><b>Exposição ${A.moeda(c.exposicaoEconomica)}</b><div class="mini">Margem: ${c.margem === null ? 'INCOMPLETO' : A.moeda(c.margem)}<br>Custo efetivo: ${A.moeda(c.custoEfetivo)}<br>Crédito recebido: ${A.moeda(c.creditoRecebido)}<br>Crédito entregue: ${A.moeda(c.creditoEntregue)}</div>
        <button class="btn pq vazio" data-matriz-drill='${A.esc(JSON.stringify(c.drilldown.compras))}'>Compras</button> <button class="btn pq vazio" data-matriz-drill='${A.esc(JSON.stringify(c.drilldown.vendas))}'>Vendas</button></td>`).join('')}</tr>`).join('')}
    </tbody></table></div></div>`;
}

// =========================================================================
// SAÍDA EXECUTIVA — apresentação e PDF derivados do cenário oficial
// =========================================================================
const execEstado = () => (S.cache.saidaExecutiva = S.cache.saidaExecutiva || { ids: [], relatorio: null });
const tagNatureza = (n) => `<span class="tag ${natTag(n)[0]}">${natTag(n)[1]}</span>`;
const valorExec = (v) => v === null || v === undefined ? '<span class="tag a">INCOMPLETO</span>' : A.moeda(v);

async function saidaExecutiva(el) {
  const estado = execEstado();
  let { cenarios } = await A.api(`/empresas/${S.empresaId}/cenarios/lista`);
  // A apresentação deve abrir a mesma fotografia oficial que a composição
  // de cenário. Se ainda não houver linha persistida, a rota a materializa a
  // partir do motor central; não cria um cálculo paralelo.
  const ano = Number(M.anoAtual()) || 2033;
  if (!cenarios.some((c) => c.tipo === 'base' && Number(c.ano) === ano)) {
    await A.api(`/empresas/${S.empresaId}/cenarios/base?ano=${ano}`);
    ({ cenarios } = await A.api(`/empresas/${S.empresaId}/cenarios/lista`));
  }
  const cenariosAno = cenarios.filter((c) => Number(c.ano) === ano);
  const base = cenariosAno.find((c) => c.tipo === 'base');
  if (!base) {
    el.innerHTML = '<div class="aviso atencao"><b>Crie ou abra o cenário base antes de gerar a saída executiva.</b></div>';
    return;
  }
  const hipoteses = cenariosAno.filter((c) => c.tipo !== 'base');
  estado.ids = estado.ids.filter((id) => hipoteses.some((x) => Number(x.id) === Number(id))).slice(0, 4);
  el.innerHTML = M.seletorAno(() => A.ir('cenarios')) + `<div class="aviso bom"><b>Saída executiva e entregáveis do diagnóstico</b>
    <div class="acao">A apresentação usa somente cenário base, cenários simulados, indicadores, alertas, matriz, waterfall e memória de cálculo. Nenhum tributo é recalculado nesta tela.</div></div>
    <div class="cartao"><h2>Selecionar cenários</h2><p class="desc">O cenário base sempre acompanha a apresentação. Selecione até quatro hipóteses para comparação.</p>
      <div class="grade g3"><label class="aviso" style="margin:0"><input type="checkbox" checked disabled> <b>${A.esc(base.nome)}</b><div class="mini">Referência oficial</div></label>
      ${hipoteses.map((c) => `<label class="aviso" style="margin:0"><input type="checkbox" class="execCenario" value="${c.id}" ${estado.ids.includes(Number(c.id)) ? 'checked' : ''}> <b>${A.esc(c.nome)}</b><div class="mini">${c.premissas || 0} premissa(s) · ${c.alocacoes || 0} migração(ões)</div></label>`).join('') || '<div class="mini">Ainda não há hipótese adicional criada.</div>'}</div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn ouro" id="gerarSaidaExec">Gerar análise executiva</button>
        <button class="btn vazio" id="baixarSaidaExec" ${estado.relatorio ? '' : 'disabled'}>Exportar PDF</button></div>
    </div><div id="corpoSaidaExec" style="margin-top:16px">${estado.relatorio ? renderSaidaExecutiva(estado.relatorio) : '<div class="aviso">Selecione os cenários e gere a apresentação.</div>'}</div>`;
  document.querySelectorAll('.execCenario').forEach((b) => b.onchange = () => {
    estado.ids = [...document.querySelectorAll('.execCenario:checked')].map((x) => Number(x.value)).slice(0, 4);
    if ([...document.querySelectorAll('.execCenario:checked')].length > 4) { b.checked = false; estado.ids = [...document.querySelectorAll('.execCenario:checked')].map((x) => Number(x.value)); A.toast('Selecione no máximo quatro hipóteses.', 'erro'); }
  });
  document.getElementById('gerarSaidaExec').onclick = async () => {
    estado.ids = [...document.querySelectorAll('.execCenario:checked')].map((x) => Number(x.value));
    const box = document.getElementById('corpoSaidaExec'); box.innerHTML = '<div class="carregando">Consolidando os resultados oficiais…</div>';
    try {
      const r = await A.api(`/empresas/${S.empresaId}/saida-executiva`, { metodo:'POST', corpo:{ cenario_ids:estado.ids, ano } });
      estado.relatorio = r.relatorio; box.innerHTML = renderSaidaExecutiva(r.relatorio); vincularMemoriaExecutiva(box, r.relatorio);
      document.getElementById('baixarSaidaExec').disabled = false;
    } catch (err) { box.innerHTML = `<div class="aviso alto"><b>Não foi possível gerar a apresentação</b><div>${A.esc(err.message)}</div></div>`; }
  };
  document.getElementById('baixarSaidaExec').onclick = async () => {
    const botao = document.getElementById('baixarSaidaExec'); const ids = estado.ids.join(',');
    try {
      botao.disabled = true; botao.textContent = 'Gerando PDF…';
      // A API usa Authorization; navegação direta/window.open não carrega esse
      // cabeçalho. Baixamos o blob autenticado sem colocar token na URL.
      const token = localStorage.getItem('sattva_token');
      const r = await fetch(`/api/empresas/${S.empresaId}/saida-executiva.pdf?ano=${encodeURIComponent(ano)}&cenarios=${encodeURIComponent(ids)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.erro || 'Não foi possível gerar o PDF.'); }
      const url = URL.createObjectURL(await r.blob()); const a = document.createElement('a'); a.href = url; a.download = 'diagnostico-executivo-cbs.pdf'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { A.toast(e.message, 'erro'); } finally { botao.disabled = false; botao.textContent = 'Exportar PDF'; }
  };
  if (estado.relatorio) vincularMemoriaExecutiva(document.getElementById('corpoSaidaExec'), estado.relatorio);
}

function cardExec(titulo, valor, natureza, sub, d) {
  return `<div class="kpi ${natureza === 'INDETERMINADO' || natureza === 'INCOMPLETO' ? 'destaque' : ''}"><span>${A.esc(titulo)}</span><b class="mono">${valorExec(valor)}</b><small>${tagNatureza(natureza)} ${A.esc(sub || '')}</small>${d ? `<button class="btn pq vazio" data-exec-mem='${A.esc(JSON.stringify(d))}'>Memória</button>` : ''}</div>`;
}
function listaEvidencias(lista, vazio) {
  return lista?.length ? `<div class="grade g2">${lista.map((a) => `<div class="aviso ${a.natureza === 'INDETERMINADO' || a.severidade === 'alto' ? 'alto' : a.severidade === 'bom' ? 'bom' : 'atencao'}"><b>${A.esc(a.titulo || a.cenario || 'Evidência')} ${tagNatureza(a.natureza || 'CALCULADO')}</b><div>${A.esc(a.texto || '')}</div>${a.memoria?.grupos?.length ? `<button class="btn pq vazio" data-exec-mem='${A.esc(JSON.stringify(a.memoria))}' style="margin-top:8px">Abrir memória</button>` : ''}</div>`).join('')}</div>` : `<div class="aviso">${A.esc(vazio)}</div>`;
}
function renderSaidaExecutiva(r) {
  const b = r.base, s = r.secoes, primeiraMatriz = s.matriz;
  return `<div class="topo"><div><div class="olho">Diagnóstico executivo</div><h1>${A.esc(r.titulo)}</h1><p>${A.esc(r.subtitulo)} · Fonte: ${A.esc(r.fonte)}</p></div></div>
    <div class="cartao"><h2>1. Resumo executivo</h2><div class="grade g3">${s.resumoExecutivo.fatos.map((x) => cardExec(x.rotulo, x.valor, x.natureza, 'resultado oficial', x.memoria)).join('')}</div></div>
    <div class="cartao"><h2>2. Qualidade e cobertura dos dados</h2><p class="desc">Cobertura é apresentada sem redistribuir dados desconhecidos.</p><div class="grade g3">${s.qualidade.indicadores.map((x) => cardExec(x.nome, x.valor, x.percentual === null ? 'INDETERMINADO' : 'CALCULADO', x.percentual === null ? 'não determinado' : A.pct(x.percentual), x.drilldown)).join('')}</div></div>
    <div class="cartao"><h2>3. Cenário base</h2><div class="grade g4">${cardExec('Receita atual',b.receita,b.natureza,'fotografia base',b.memoriaVendas)}${cardExec('Base econômica das saídas',b.baseEconomicaSaidas,b.natureza,'motor oficial',b.memoriaVendas)}${cardExec('CBS líquida projetada',b.cbsLiquida,b.natureza,'débito menos crédito',b.memoriaVendas)}${cardExec('Operações',b.operacoesCompras + b.operacoesVendas,b.natureza,'compras e vendas')}</div></div>
    <div class="cartao"><h2>4. Impacto nas compras</h2><div class="grade g4">${cardExec('Compras atuais',s.compras.valor,s.compras.natureza,'valor importado',s.compras.memoria)}${cardExec('Base econômica',s.compras.baseEconomica,s.compras.natureza,'motor oficial',s.compras.memoria)}${cardExec('Crédito CBS recebido',s.compras.credito,s.compras.natureza,'potencial aproveitável',s.compras.memoria)}${cardExec('Custo efetivo',b.custoEfetivo,b.natureza,'após crédito',s.compras.memoria)}</div></div>
    <div class="cartao"><h2>5. Impacto nas vendas</h2><div class="grade g4">${cardExec('Venda atual',s.vendas.valor,s.vendas.natureza,'valor importado',s.vendas.memoria)}${cardExec('Base econômica',s.vendas.baseEconomica,s.vendas.natureza,'motor oficial',s.vendas.memoria)}${cardExec('CBS da venda',s.vendas.cbs,s.vendas.natureza,'não depende do perfil do cliente',s.vendas.memoria)}${cardExec('Venda projetada',s.vendas.precoProjetado,s.vendas.natureza,'base + tributos',s.vendas.memoria)}</div></div>
    <div class="cartao"><h2>6. Crédito recebido e crédito entregue</h2><div class="grade g2">${cardExec('Crédito CBS recebido dos fornecedores',b.creditoRecebido,b.natureza,'reduz a CBS líquida quando aproveitável',b.memoriaCompras)}${cardExec('Crédito CBS entregue aos clientes',b.creditoEntregue,b.natureza,'indicador comercial; não reduz a CBS líquida do vendedor',b.memoriaVendas)}</div></div>
    <div class="cartao"><h2>7. Waterfall econômico</h2>${s.waterfall ? `<p class="desc">${A.esc(s.waterfall.leitura || 'Efeito consolidado da hipótese selecionada.')}</p><div class="grade g4">${cardExec('Base econômica - base',s.waterfall.baseEconomicaBase,s.waterfall.natureza,'compras')}${cardExec('Base econômica - cenário',s.waterfall.baseEconomicaCenario,s.waterfall.natureza,'compras')}${cardExec('Variação do crédito',s.waterfall.efeitoCredito,s.waterfall.natureza,'efeito econômico')}${cardExec('Variação do custo efetivo',s.waterfall.efeitoLiquido,s.waterfall.natureza,'efeito econômico')}</div>` : '<div class="aviso">O cenário base não possui hipótese para comparar; selecione uma simulação para visualizar o waterfall.</div>'}</div>
    <div class="cartao"><h2>8. Comparação Base × Cenário(s)</h2>${A.tabela([{t:'Cenário',r:x=>`<b>${A.esc(x.cenario)}</b> ${tagNatureza(x.natureza)}`},{t:'Receita projetada',num:true,r:x=>A.moeda(x.receitaProjetada)},{t:'CBS líquida',num:true,r:x=>A.moeda(x.cbsLiquida)},{t:'Δ CBS',num:true,r:x=>A.setaR$(x.deltaCbsLiquida)},{t:'Crédito recebido',num:true,r:x=>A.moeda(x.creditoRecebido)},{t:'Custo efetivo',num:true,r:x=>A.moeda(x.custoEfetivo)},{t:'Margem',num:true,r:x=>x.margem === null ? '<span class="tag a">INCOMPLETO</span>' : A.moeda(x.margem)}],r.comparacao)}</div>
    <div class="cartao"><h2>9. Matriz Fornecedores × Clientes</h2><p class="desc">${A.esc(primeiraMatriz.observacao)}</p>${painelMatriz(primeiraMatriz)}</div>
    <div class="cartao"><h2>10. Principais alertas</h2>${listaEvidencias(s.alertas,'Nenhum limiar de alerta foi atingido.')}</div>
    <div class="cartao"><h2>11. Oportunidades e pontos de atenção</h2><h3 style="font-size:14px">Oportunidades evidenciadas</h3>${listaEvidencias(s.oportunidades,'Nenhuma oportunidade é inferida sem evidência calculada.')}<h3 style="font-size:14px;margin-top:16px">Pontos de atenção</h3>${listaEvidencias(s.atencoes,'Nenhum ponto de atenção adicional pelos limiares configurados.')}</div>
    <div class="cartao"><h2>12. Premissas utilizadas</h2>${s.premissas.length ? A.tabela([{t:'Cenário',r:x=>A.esc(x.cenario)},{t:'Tipo',r:x=>A.esc(x.tipo)},{t:'Regra',r:x=>A.esc(x.campo || `${x.grupo_origem} → ${x.grupo_destino}`)},{t:'Valor',r:x=>A.esc(x.valor_simulado || A.pct(x.percentual_grupo))},{t:'Natureza',r:x=>tagNatureza(x.natureza)},{t:'Justificativa',r:x=>A.esc(x.justificativa || '—')}],s.premissas) : '<div class="aviso">Cenário base sem premissas simuladas.</div>'}</div>
    <div class="cartao"><h2>13. Limitações e dados indeterminados</h2>${listaEvidencias(s.limitacoes,'Nenhuma limitação adicional identificada na fotografia selecionada.')}</div>
    <div class="cartao"><h2>14. Memória e resumo metodológico</h2><p>${A.esc(s.metodologia.texto)}</p><div class="aviso"><b>Naturezas preservadas</b><div class="acao">${tagNatureza('REAL')} dado documental · ${tagNatureza('CALCULADO')} resultado do motor · ${tagNatureza('SIMULADO')} premissa de cenário · ${tagNatureza('INDETERMINADO')} ausência explícita de evidência.</div></div></div>`;
}
function vincularMemoriaExecutiva(box, r) {
  box.querySelectorAll('[data-exec-mem]').forEach((b) => b.onclick = () => {
    const d = JSON.parse(b.dataset.execMem); const grupo = d.grupos?.[0];
    if (grupo) memoria({ cenarioId:d.cenarioId || r.base.id, lado:d.lado, dimensao:d.dimensao }, grupo);
  });
}

// registra a aba na tela de Cenários, ao lado das que já existem
M.comAbas('cenarios', M.abasCenarios.concat([
  { id: 'simulacao', t: 'Composição de cenário', render: simulacaoCadeia },
  { id: 'indicadores', t: 'Indicadores e alertas', render: indicadoresCadeia },
  { id: 'saida_executiva', t: 'Saída executiva', render: saidaExecutiva },
]), 'simulacao');
})();

/* =========================================================================
   BASES ANUAIS DA RECEITA — Lucro Real / Presumido
   ========================================================================= */
(() => {
const A = App, S = App.S;
const M = window.MotorUI;

async function basesReceita(el) {
  const [e, pend] = await Promise.all([
    A.api('/base-regime'),
    S.empresaId ? A.api(`/empresas/${S.empresaId}/parceiros/pendencias-regime`) : Promise.resolve(null),
  ]);

  el.innerHTML = `<div class="aviso"><b>O que estas bases resolvem</b>
      Elas distinguem Lucro Real de Lucro Presumido. Isso <b>não</b> altera o crédito de IBS/CBS —
      os dois apuram pelo regime regular e creditam igual. O que melhora é a reconstrução da carga
      atual: sem o destaque de PIS/COFINS no documento, o motor estima por 9,25% (Real) ou 3,65%
      (Presumido), e errar aí distorce a base econômica.
      <div class="acao">Consulte o Simples primeiro — é ele que decide o crédito. Estas bases refinam o resto.</div></div>
    <div class="grade g4">
      ${A.kpi('Registros na base', (e.total || 0).toLocaleString('pt-BR'), e.totalCompartilhado !== null ? 'referência compartilhada' : 'cópia local')}
      ${e.porRegime.slice(0, 2).map((r) => A.kpi(A.regimeLabel(r.regime),
        r.c.toLocaleString('pt-BR'), `ano ${r.ano}`)).join('')}
      ${A.kpi('Parceiros sem regime', pend ? pend.total : '—', pend ? 'nesta empresa' : 'selecione uma empresa')}
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2>Importar relação anual</h2>
      <p class="desc">Selecione o CSV no seu computador. Ele é enviado temporariamente, importado em lotes na base compartilhada e removido do servidor ao final.</p>
      <div class="grade g4" style="align-items:end">
        <label class="campo" style="margin:0;grid-column:span 2"><span>Arquivo CSV</span><input type="file" id="brArquivo" accept=".csv,.txt"></label>
        <label class="campo" style="margin:0"><span>Regime</span>
          <select id="brRegime">${(e.regimesAceitos || []).map((r) =>
            `<option value="${r.chave}">${A.esc(r.nome)}</option>`).join('')}</select></label>
        <label class="campo" style="margin:0"><span>Ano-calendário</span>
          <input type="number" id="brAno" value="2024"></label>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <label style="display:flex;gap:6px;align-items:center;font-size:12.5px">
          <input type="checkbox" id="brSubst" checked> substituir o que já existe deste regime e ano</label>
        <button class="btn vazio" type="button" onclick="window.open('/api/base-regime/modelo')">Baixar modelo CSV</button>
        <button class="btn ouro" id="brImportar">Importar</button>
      </div>
      <div id="brStatus" style="margin-top:12px"></div>
    </div>
    ${S.empresaId ? `<div class="cartao">
      <h2>Refinar os parceiros desta empresa</h2>
      <p class="desc">Aplica as bases a quem já se sabe estar no regime regular. Não toca em quem é
        Simples ou MEI — essa informação tem precedência porque é ela que determina o crédito —
        nem no que foi definido à mão.</p>
      <button class="btn" id="brRefinar" ${e.total ? '' : 'disabled'}>
        ${e.total ? 'Refinar Real x Presumido' : 'Importe uma base primeiro'}</button>
      <div id="brRefStatus" style="margin-top:12px"></div>
    </div>` : ''}
    <div class="cartao"><h2>Importações realizadas</h2>
      ${A.tabela([
        { t: 'Arquivo', r: (i) => A.esc(i.arquivo) },
        { t: 'Regime', r: (i) => A.regimeLabel(i.regime) },
        { t: 'Ano', r: (i) => i.ano },
        { t: 'Linhas', num: true, r: (i) => (i.linhas || 0).toLocaleString('pt-BR') },
        { t: 'Importados', num: true, r: (i) => (i.importados || 0).toLocaleString('pt-BR') },
        { t: 'Inválidos', num: true, r: (i) => i.invalidos },
        { t: 'Duplicados', num: true, r: (i) => i.duplicados },
        { t: 'Tempo', num: true, r: (i) => `${i.segundos}s` },
        { t: 'Quando', r: (i) => `<span class="mini mono">${A.esc(i.criado_em)}</span>` },
      ], e.importacoes, { vazio: 'Nenhuma base importada.' })}
    </div>`;

  const arquivo = () => document.getElementById('brArquivo').files[0];
  const box = document.getElementById('brStatus');

  document.getElementById('brImportar').onclick = async () => {
    if (!arquivo()) return A.toast('Selecione o arquivo CSV.', 'erro');
    box.innerHTML = `<div class="aviso"><b>Importando e sincronizando…</b>Arquivos grandes podem levar alguns minutos.
      Não feche esta janela.</div><div class="barra-prog"><i style="width:45%"></i></div>`;
    try {
      const fd = new FormData(); fd.append('arquivo', arquivo()); fd.append('regime', document.getElementById('brRegime').value);
      fd.append('ano', String(Number(document.getElementById('brAno').value) || '')); fd.append('substituir', document.getElementById('brSubst').checked ? 'true' : '');
      const r = await A.api('/base-regime/upload', { metodo: 'POST', corpo: fd });
      box.innerHTML = `<div class="aviso bom"><b>${r.importados.toLocaleString('pt-BR')} CNPJs importados em ${r.segundos}s</b>
        ${r.linhas.toLocaleString('pt-BR')} linhas lidas${r.invalidos ? ` · ${r.invalidos} sem CNPJ válido` : ''}${r.duplicados ? ` · ${r.duplicados} repetidos` : ''}${r.semRegime ? ` · ${r.semRegime} com forma de tributação não reconhecida (ignoradas)` : ''}</div>
        ${Object.keys(r.porRegime || {}).length > 1 || (r.porAno && Object.keys(r.porAno).length > 1) ? `<table class="compacta"><thead><tr><th>Regime</th><th class="num">CNPJs</th></tr></thead>
          <tbody>${Object.entries(r.porRegime).map(([k, v]) => `<tr><td>${A.regimeLabel(k)}</td><td class="num mono">${v.toLocaleString('pt-BR')}</td></tr>`).join('')}</tbody></table>` : ''}
        ${r.compartilhada ? `<div class="mini" style="margin-top:8px">${r.compartilhada.enviados.toLocaleString('pt-BR')} registros sincronizados no Supabase.</div>` : ''}`;
      setTimeout(() => A.ir('bases'), 2000);
    } catch (err) { box.innerHTML = `<div class="aviso alto">${A.esc(err.message)}</div>`; }
  };

  const ref = document.getElementById('brRefinar');
  if (ref) ref.onclick = async () => {
    const b2 = document.getElementById('brRefStatus');
    b2.innerHTML = '<div class="carregando">Refinando…</div>';
    try {
      const r = await A.api(`/empresas/${S.empresaId}/parceiros/refinar-regime`, { metodo: 'POST',
        corpo: { ano: Number(document.getElementById('brAno').value) } });
      b2.innerHTML = `<div class="aviso ${r.refinados ? 'bom' : 'atencao'}">
          <b>${r.refinados} parceiros refinados</b> de ${r.alvos} candidatos ·
          ${r.semCorrespondencia} sem correspondência na base
          <div class="mini" style="margin-top:6px">Fonte consultada: ${A.esc(r.fonte || 'base local')}.</div></div>
        ${Object.keys(r.porRegime).length ? `<table class="compacta"><thead><tr><th>Regime</th><th class="num">Parceiros</th></tr></thead>
          <tbody>${Object.entries(r.porRegime).map(([k, v]) =>
            `<tr><td>${A.regimeLabel(k)}</td><td class="num mono">${v}</td></tr>`).join('')}</tbody></table>` : ''}
        ${r.porNivel && r.porNivel.raiz ? `<div class="mini" style="margin-top:8px">${r.porNivel.raiz} casaram pela raiz do CNPJ
          — a relação traz a matriz e o regime é da pessoa jurídica, não do estabelecimento.</div>` : ''}`;
    } catch (err) { b2.innerHTML = `<div class="aviso alto">${A.esc(err.message)}</div>`; }
  };
}

async function catalogoFiscal(el) {
  const estado = S.cache.catalogoFiscal || (S.cache.catalogoFiscal = { tipo: 'ncm', busca: '', pagina: 1 });
  const carregar = async () => {
    el.innerHTML = '<div class="carregando">Carregando catálogo fiscal…</div>';
    const r = await A.api(`/bases/catalogo?tipo=${estado.tipo}&pagina=${estado.pagina}&tamanho=50&busca=${encodeURIComponent(estado.busca)}`);
    const paginas = Math.max(1, Math.ceil(r.total / r.tamanho));
    const beneficio = (lista) => !lista?.length ? '<span class="tag n">Sem benefício específico</span>' : lista.map((b) => `<div style="margin-bottom:6px"><span class="tag c">Benefício governamental</span><div class="mini">${A.esc(b.tratamento || (b.aliquota_zero ? 'Alíquota zero' : 'Tratamento específico'))}${b.reducao != null ? ` · redução ${A.pct(b.reducao, 0)}` : ''}</div>${b.cst || b.cclasstrib ? `<div class="mono mini">CST ${A.esc(b.cst || '—')} · cClassTrib ${A.esc(b.cclasstrib || '—')}</div>` : ''}${b.ente_elegivel ? `<div class="mini">Ente: ${A.esc(b.ente_elegivel)}</div>` : ''}${b.condicoes ? `<div class="mini">${A.esc(b.condicoes)}</div>` : ''}</div>`).join('');
    const colunas = estado.tipo === 'ncm' ? [
      { t: 'NCM', r: (x) => `<b class="mono">${A.esc(x.ncm)}</b>` },
      { t: 'Descrição / classificação', r: (x) => `<b>${A.esc(x.descricao || '—')}</b><div class="mini">${A.esc(x.classificacao || '')}</div>` },
      { t: 'CST / cClassTrib', r: (x) => `<span class="mono mini">${A.esc(x.cst || '—')} · ${A.esc(x.cclasstrib || '—')}</span>` },
      { t: 'Redução geral', r: (x) => x.reducao_ibs != null || x.reducao_cbs != null ? `IBS ${x.reducao_ibs != null ? A.pct(x.reducao_ibs, 0) : '—'}<br>CBS ${x.reducao_cbs != null ? A.pct(x.reducao_cbs, 0) : '—'}` : '<span class="tag">integral</span>' },
      { t: 'Benefício governo/autarquia', r: (x) => beneficio(x.beneficios) },
    ] : [
      { t: 'NBS / LC 116', r: (x) => `<b class="mono">${A.esc(x.nbs || '—')}</b><div class="mini mono">LC 116 ${A.esc(x.lc116 || '—')}</div>` },
      { t: 'Serviço', r: (x) => `<b>${A.esc(x.descricao_nbs || x.descricao_item || '—')}</b><div class="mini">${A.esc(x.descricao_item || '')}</div>` },
      { t: 'cClassTrib / INDOP', r: (x) => `<span class="mono mini">${A.esc(x.cclasstrib || '—')} · ${A.esc(x.indop || '—')}</span>` },
      { t: 'Tratamento geral', r: (x) => `<span class="tag">${A.esc(x.reducao || 'integral')}</span><div class="mini">${A.esc(x.local_incidencia || '')}</div>` },
      { t: 'Benefício governo/autarquia', r: (x) => beneficio(x.beneficios) },
    ];
    el.innerHTML = `<div class="topo"><div><div class="olho">Bases fiscais</div><h1>Catálogo fiscal</h1><p>Consulta completa de NCMs e NBSs cadastrados, incluindo benefícios específicos para governo e autarquias.</p></div><button class="btn vazio" id="catalogoExportar">Baixar Excel completo</button></div><div class="cartao"><div class="filtros-carteira"><label>Base<select id="catalogoTipo"><option value="ncm" ${estado.tipo === 'ncm' ? 'selected' : ''}>Produtos — NCM</option><option value="servicos" ${estado.tipo === 'servicos' ? 'selected' : ''}>Serviços — NBS / LC 116</option></select></label><label style="flex:1">Buscar código ou descrição<input id="catalogoBusca" value="${A.esc(estado.busca)}" placeholder="Ex.: 30049099, 1.1502.10.00 ou medicamento"></label><button class="btn" id="catalogoBuscar">Buscar</button></div><div class="aviso"><b>${r.total.toLocaleString('pt-BR')} registro(s)</b> O benefício só é aplicado pelo motor após confirmar o destinatário como ente governamental.</div><div style="margin-top:14px">${A.tabela(colunas, r.itens, { vazio: 'Nenhum registro encontrado.' })}</div><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:14px"><span class="mini">Página ${r.pagina} de ${paginas}</span><div style="display:flex;gap:8px"><button class="btn pq vazio" id="catalogoAnterior" ${r.pagina <= 1 ? 'disabled' : ''}>Anterior</button><button class="btn pq vazio" id="catalogoProximo" ${r.pagina >= paginas ? 'disabled' : ''}>Próxima</button></div></div></div>`;
    el.querySelector('#catalogoTipo').onchange = (e) => { estado.tipo = e.target.value; estado.pagina = 1; carregar(); };
    const buscar = () => { estado.busca = el.querySelector('#catalogoBusca').value.trim(); estado.pagina = 1; carregar(); };
    el.querySelector('#catalogoBuscar').onclick = buscar;
    el.querySelector('#catalogoBusca').onkeydown = (e) => { if (e.key === 'Enter') buscar(); };
    el.querySelector('#catalogoExportar').onclick = async (e) => {
      const botao = e.currentTarget;
      botao.disabled = true;
      botao.textContent = 'Gerando Excel…';
      try {
        const token = localStorage.getItem('sattva_token');
        const resposta = await fetch('/api/bases/catalogo/exportar', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!resposta.ok) {
          const erro = await resposta.json().catch(() => ({}));
          throw new Error(erro.erro || 'Não foi possível gerar o Excel.');
        }
        const arquivo = await resposta.blob();
        const url = URL.createObjectURL(arquivo);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'catalogo-fiscal-ncm-nbs.xlsx';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (erro) { A.toast(erro.message, 'erro'); }
      finally { botao.disabled = false; botao.textContent = 'Baixar Excel completo'; }
    };
    el.querySelector('#catalogoAnterior').onclick = () => { estado.pagina -= 1; carregar(); };
    el.querySelector('#catalogoProximo').onclick = () => { estado.pagina += 1; carregar(); };
  };
  await carregar();
}

M.comAbas('bases', M.abasBases.concat([
  { id: 'catalogo_fiscal', t: 'Catálogo NCM / NBS', render: catalogoFiscal },
  { id: 'regime_receita', t: 'Bases da Receita (Real/Presumido)', render: basesReceita },
]), 'atual');
})();
