/* =========================================================================
   MOTOR DE PROJEÇÃO — camada de apresentação
   -------------------------------------------------------------------------
   Não redesenha nada: envolve as telas que já existem com uma barra de abas
   e acrescenta a visão de projeção ao lado da análise atual. As funções
   originais continuam intactas e são chamadas como estavam.
   ========================================================================= */
(() => {
const A = App, S = App.S;
const nat = (n) => `<span class="tag ${n === 'SIMULADO' ? 'b' : n === 'REAL' ? 'c' : 'n'}">${n || '—'}</span>`;
const stCls = (s) => ({ CLASSIFICADO: ['c', 'Classificado'], REQUER_VALIDACAO: ['b', 'Requer validação'],
  SEM_CORRESPONDENCIA: ['a', 'Sem correspondência'] }[s] || ['n', s || '—']);
const stCred = (s) => ({ PROJETADO: ['c', 'Projetado'], PROJETADO_LIMITADO: ['b', 'Limitado ao DAS'],
  SUJEITO_VALIDACAO: ['b', 'Sujeito a validação'], SEM_DIREITO: ['n', 'Sem direito'],
  DADOS_INSUFICIENTES: ['a', 'Dados insuficientes'] }[s] || ['n', s || '—']);
const sens = (s) => ({ ALTA: ['a', 'Alta'], MEDIA: ['b', 'Média'], BAIXA: ['c', 'Baixa'],
  NAO_APLICAVEL: ['n', 'Não aplicável'], REQUER_VALIDACAO: ['b', 'Requer validação'] }[s] || ['n', s || '—']);
const perfil = (p) => ({ b2b: 'B2B', b2c_pf: 'B2C — pessoa física', b2c_pj: 'B2C — pessoa jurídica',
  governo: 'Governo', requer_validacao: 'Requer validação' }[p] || p || '—');

const anoAtual = () => S.cache.motorAno || 2033;

/** Barra de abas que envolve uma tela existente sem alterá-la */
function comAbas(nome, abas, padrao) {
  const orig = Telas[nome];
  Telas[nome] = async (el) => {
    const ativa = S.aba[nome] || padrao;
    const barra = `<div class="abas" id="abasMotor">${abas.map((a) =>
      `<button data-t="${a.id}" class="${ativa === a.id ? 'ativo' : ''}">${a.t}</button>`).join('')}</div>`;
    if (ativa === 'atual') {
      await orig(el);
      el.insertAdjacentHTML('afterbegin', barra);
    } else {
      el.innerHTML = barra + '<div class="carregando">Carregando projeção…</div>';
      const alvo = document.createElement('div');
      el.appendChild(alvo);
      el.querySelector('.carregando').remove();
      const fn = abas.find((a) => a.id === ativa);
      try { await fn.render(alvo); }
      catch (e) { alvo.innerHTML = `<div class="aviso alto"><b>Não foi possível projetar</b>${A.esc(e.message)}</div>`; }
    }
    document.querySelectorAll('#abasMotor button').forEach((b) => {
      b.onclick = () => { S.aba[nome] = b.dataset.t; A.ir(nome); };
    });
  };
}

/** Seletor de ano da transição, comum a todas as visões do motor */
function seletorAno(aoTrocar) {
  if (!S.params.modoAnalise?.ibsAtivo) return `<div class="cartao" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <b style="font-size:13px">Projeção CBS</b><span class="mini">Análise única, sem segmentação anual. A visão por anos será liberada na etapa de IBS.</span></div>`;
  const anos = (S.params.anos || []);
  const html = `<div class="cartao" style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
    <b style="font-size:13px">Ano analisado</b>
    <div class="chips" id="chipsAno">${anos.map((a) =>
      `<span class="chip ${a === anoAtual() ? 'on' : ''}" data-a="${a}">${a}</span>`).join('')}</div>
    <span class="mini" style="margin-left:auto">Alíquotas vindas dos parâmetros do sistema, não do código</span>
  </div>`;
  setTimeout(() => {
    document.querySelectorAll('#chipsAno .chip').forEach((c) => {
      c.onclick = () => { S.cache.motorAno = Number(c.dataset.a); aoTrocar(); };
    });
  }, 0);
  return html;
}

// =========================================================================
// PROJEÇÃO — FORNECEDORES (itens 9 a 14 e 34)
// =========================================================================
async function projFornecedores(el) {
  const d = await A.api(`/empresas/${S.empresaId}/motor/fornecedores?ano=${anoAtual()}`);
  const r = d.resumo;
  el.innerHTML = seletorAno(() => A.ir('fornecedores')) +
    `<div class="grade g4">
      ${A.kpi('Compras analisadas', A.moeda(r.comprasAnalisadas), `${r.entradas} itens`)}
      ${A.kpi('Base econômica reconstruída', A.moeda(r.baseEconomicaEntradas), 'sem os tributos substituídos')}
      ${A.kpi('Crédito IBS/CBS projetado', A.moeda(r.apuracao.ibs.creditos + r.apuracao.cbs.creditos), `IBS ${A.moeda(r.apuracao.ibs.creditos)} · CBS ${A.moeda(r.apuracao.cbs.creditos)}`, 'destaque')}
      ${A.kpi('Itens a validar', r.requerValidacao + r.semCorrespondencia, `${r.classificados} classificados`)}
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2>Projeção por fornecedor</h2>
      <p class="desc">Dois fornecedores com preço bruto parecido podem custar muito diferente depois do crédito. É essa diferença que a coluna de custo líquido mostra.</p>
      ${A.tabela([
        { t: 'Fornecedor', r: (l) => `${A.esc(l.fornecedor)}<div class="mini mono">${A.cnpjFmt(l.cnpj)}</div>` },
        { t: 'Regime', r: (l) => l.regime ? `<span class="tag">${A.regimeLabel(l.regime)}</span>` : '<span class="tag a">desconhecido</span>' },
        { t: 'Compras', num: true, r: (l) => A.moeda(l.comprasAtuais) },
        { t: 'Base econômica', num: true, r: (l) => A.moeda(l.baseEconomica) },
        { t: 'IBS', num: true, r: (l) => A.moeda(l.ibs) },
        { t: 'CBS', num: true, r: (l) => A.moeda(l.cbs) },
        { t: 'Crédito', num: true, r: (l) => `<b>${A.moeda(l.creditoTotal)}</b>` },
        { t: 'Custo líquido', num: true, r: (l) => `<b>${A.moeda(l.custoLiquido)}</b>` },
        { t: '% do preço', num: true, r: (l) => l.comprasAtuais ? A.pct(l.custoLiquido / l.comprasAtuais) : '—' },
        { t: 'Pendências', num: true, r: (l) => l.pendencias ? `<span class="tag b">${l.pendencias}</span>` : '—' },
      ], d.linhas, { vazio: 'Sem entradas importadas. Importe XMLs ou planilhas na etapa de cadastros.' })}
    </div>
    ${(d.cenariosSimples || []).length ? `<div class="cartao">
      <h2>Crédito potencial estimado por faixa do Simples</h2>
      <p class="desc">Quando o faturamento do fornecedor é desconhecido, o motor não arbitra uma alíquota: simula as faixas. Todo número abaixo é <b>simulado</b>, não apurado.</p>
      ${d.cenariosSimples.map((c) => `<div style="margin-bottom:16px">
        <b class="mono">${A.esc(c.fornecedor)}</b> <span class="tag b">SIMULADO</span>
        <span class="mini"> · ${A.esc(c.anexo ? 'Anexo ' + c.anexo : '')}</span>
        ${A.tabela([
          { t: 'Cenário', r: (x) => `${x.rotulo}<div class="mini">RBT12 ${A.moeda(x.rbt12)}</div>` },
          { t: 'Alíq. efetiva', num: true, r: (x) => A.pct(x.aliquotaEfetiva) },
          { t: 'IBS', num: true, r: (x) => A.moeda(x.ibs) },
          { t: 'CBS', num: true, r: (x) => A.moeda(x.cbs) },
          { t: 'Crédito transmitido', num: true, r: (x) => `<b>${A.moeda(x.creditoTotal)}</b>` },
          { t: 'Custo líquido', num: true, r: (x) => A.moeda(x.custoLiquido) },
        ], c.cenarios)}
        ${c.amplitude ? `<div class="aviso atencao"><b>Amplitude entre as faixas</b>
          O crédito varia de ${A.moeda(c.amplitude.creditoMin)} a ${A.moeda(c.amplitude.creditoMax)} conforme a faixa —
          diferença de ${A.moeda(c.amplitude.creditoMax - c.amplitude.creditoMin)}. Conhecer o faturamento real do fornecedor elimina essa incerteza.</div>` : ''}
        ${c.hibrido ? `<div class="aviso"><b>${A.esc(c.hibrido.rotulo)}</b>
          Se este fornecedor apurasse IBS/CBS pelo regime regular: crédito de ${A.moeda(c.hibrido.creditoTotal)} e custo líquido de ${A.moeda(c.hibrido.custoLiquido)}.
          <div class="acao">${A.esc(c.hibrido.observacao)}</div></div>` : ''}
      </div>`).join('')}
    </div>` : ''}`;
}

// =========================================================================
// PROJEÇÃO — CLIENTES (itens 15 a 24 e 35)
// =========================================================================
async function projClientes(el) {
  const d = await A.api(`/empresas/${S.empresaId}/motor/clientes?ano=${anoAtual()}`);
  const r = d.resumo;
  el.innerHTML = seletorAno(() => A.ir('clientes')) +
    `<div class="grade g4">
      ${A.kpi('Faturamento analisado', A.moeda(r.faturamentoAnalisado), `${r.saidas} itens`)}
      ${A.kpi('Base econômica', A.moeda(r.baseEconomicaSaidas))}
      ${A.kpi('Débito IBS/CBS projetado', A.moeda(r.apuracao.ibs.debitos + r.apuracao.cbs.debitos), `IBS ${A.moeda(r.apuracao.ibs.debitos)} · CBS ${A.moeda(r.apuracao.cbs.debitos)}`, 'destaque')}
      ${A.kpi('Crédito entregue aos clientes', A.moeda(d.linhas.reduce((s, l) => s + l.creditoEntregue, 0)))}
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2>Projeção por cliente</h2>
      <p class="desc">A mesma venda pesa diferente conforme quem compra. A coluna de importância do crédito é projeção econômica — não afirma que o cliente vai exigir crédito.</p>
      ${A.tabela([
        { t: 'Cliente', r: (l) => `${A.esc(l.cliente)}<div class="mini mono">${A.cnpjFmt(l.cnpj)}</div>` },
        { t: 'Perfil', r: (l) => `<span class="tag">${perfil(l.perfil)}</span>` },
        { t: 'Regime', r: (l) => l.regime ? A.regimeLabel(l.regime) : '<span class="tag a">desconhecido</span>' },
        { t: 'Faturamento', num: true, r: (l) => A.moeda(l.faturamento) },
        { t: 'Base econômica', num: true, r: (l) => A.moeda(l.baseEconomica) },
        { t: 'IBS', num: true, r: (l) => A.moeda(l.ibs) },
        { t: 'CBS', num: true, r: (l) => A.moeda(l.cbs) },
        { t: 'Crédito entregue', num: true, r: (l) => A.moeda(l.creditoEntregue) },
        { t: 'Custo líq. p/ cliente', num: true, r: (l) => `<b>${A.moeda(l.custoLiquidoCliente)}</b>` },
        { t: 'Importância do crédito', r: (l) => `<span class="tag ${sens(l.sensibilidade)[0]}">${sens(l.sensibilidade)[1]}</span>` },
      ], d.linhas, { vazio: 'Sem saídas importadas.' })}
      <button class="btn vazio pq" id="comparar" style="margin-top:12px">Comparar perfis na mesma venda</button>
    </div>`;

  const b = document.getElementById('comparar');
  if (b) b.onclick = async () => {
    const { movimentos } = await A.api(`/empresas/${S.empresaId}/movimentos?tipo=cliente&limite=50`);
    if (!movimentos.length) return A.toast('Não há saídas importadas para comparar.', 'erro');
    A.modal({
      titulo: 'Comparador de perfis de cliente', largura: 860, confirmar: null,
      descricao: 'A mesma operação projetada para cada perfil de destinatário.',
      corpo: A.selecao('mov', 'Operação', movimentos.map((m) => ({ v: m.id, t: `${m.descricao || m.nome} — ${A.moeda(m.valor)}` })), movimentos[0].id) +
        '<div id="boxComp"><div class="carregando">Calculando…</div></div>',
    });
    setTimeout(() => {
      const sel = document.querySelector('.modal [name="mov"]');
      const rodar = async () => {
        const box = document.getElementById('boxComp');
        box.innerHTML = '<div class="carregando">Calculando…</div>';
        const c = await A.api(`/empresas/${S.empresaId}/motor/comparar`, { metodo: 'POST',
          corpo: { movimento_id: Number(sel.value), ano: anoAtual() } });
        box.innerHTML = A.tabela([
          { t: 'Perfil do cliente', r: (x) => `<b>${A.esc(x.rotulo)}</b><div class="mini">${A.esc(x.detalhe)}</div>` },
          { t: 'IBS', num: true, r: (x) => A.moeda(x.ibs) },
          { t: 'CBS', num: true, r: (x) => A.moeda(x.cbs) },
          { t: 'Preço projetado', num: true, r: (x) => A.moeda(x.precoProjetado) },
          { t: 'Crédito', num: true, r: (x) => A.moeda(x.creditoTotal) },
          { t: 'Custo líquido', num: true, r: (x) => `<b>${A.moeda(x.custoLiquido)}</b>` },
          { t: 'Importância do crédito', r: (x) => `<span class="tag ${sens(x.sensibilidade)[0]}">${sens(x.sensibilidade)[1]}</span>` },
        ], c.comparativo) +
        c.comparativo.map((x) => `<div class="aviso ${x.sensibilidade === 'ALTA' ? 'atencao' : ''}"><b>${A.esc(x.rotulo)}</b>${A.esc(x.leitura)}</div>`).join('');
      };
      sel.onchange = rodar; rodar();
    }, 0);
  };
}

// =========================================================================
// SIMULAÇÕES TRIBUTÁRIAS (item 38) — dentro de Cenários
// =========================================================================
async function projSimulacoes(el) {
  const d = await A.api(`/empresas/${S.empresaId}/motor/simulacoes?ano=${anoAtual()}`);
  const r = d.resumo, a = d.apuracao, c = r.comparacao;
  el.innerHTML = seletorAno(() => A.ir('cenarios')) +
    `<div class="grade g4">
      ${A.kpi('Faturamento analisado', A.moeda(r.faturamentoAnalisado))}
      ${A.kpi('Compras analisadas', A.moeda(r.comprasAnalisadas))}
      ${A.kpi('Carga IBS/CBS projetada', A.moeda(c.cargaProjetada), `${A.pct(c.percentualSobreBase)} da base econômica`, 'destaque')}
      ${A.kpi('Carga atual identificada', A.moeda(c.cargaAtual), c.diferencaPerc !== null ? `${A.setaPct(c.diferencaPerc)} de variação` : 'sem base de comparação')}
    </div>
    <div class="grade g2" style="margin-top:16px">
      <div class="cartao"><h2>Apuração simulada — IBS</h2>
        <p class="desc">Saldo credor de IBS não compensa débito de CBS. São apurações separadas.</p>
        <table>
          <tr><td>Débitos das saídas</td><td class="num mono">${A.moeda(a.ibs.debitos)}</td></tr>
          <tr><td>(−) Créditos das entradas</td><td class="num mono">${A.moeda(a.ibs.creditos)}</td></tr>
          <tr style="background:var(--ouro-100)"><td><b>= Saldo IBS projetado</b></td><td class="num mono"><b>${A.moeda(a.ibs.saldo)}</b></td></tr>
        </table>
      </div>
      <div class="cartao"><h2>Apuração simulada — CBS</h2>
        <p class="desc">&nbsp;</p>
        <table>
          <tr><td>Débitos das saídas</td><td class="num mono">${A.moeda(a.cbs.debitos)}</td></tr>
          <tr><td>(−) Créditos das entradas</td><td class="num mono">${A.moeda(a.cbs.creditos)}</td></tr>
          <tr style="background:var(--ouro-100)"><td><b>= Saldo CBS projetado</b></td><td class="num mono"><b>${A.moeda(a.cbs.saldo)}</b></td></tr>
        </table>
      </div>
    </div>
    <div class="cartao" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <b style="font-size:13px">Relatório técnico</b>
      <span class="mini" style="flex:1">Sumário, projeção por fornecedor e cliente, classificação item a item com rastreabilidade e conformidade.</span>
      <button class="btn ouro" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/tecnico?ano=${anoAtual()}')">Exportar Excel</button>
    </div>
    <div class="cartao"><h2>Carga atual identificada nos documentos</h2>
      <p class="desc">${A.esc(r.cargaAtual.saidas.observacao)}</p>
      ${A.tabela([
        { t: 'Tributo', r: (x) => x[0] },
        { t: 'Saídas', num: true, r: (x) => A.moeda(r.cargaAtual.saidas[x[1]]) },
        { t: 'Entradas', num: true, r: (x) => A.moeda(r.cargaAtual.entradas[x[1]]) },
      ], [['ICMS', 'icms'], ['ISS', 'iss'], ['IPI', 'ipi'], ['PIS', 'pis'], ['COFINS', 'cofins'], ['ICMS-ST', 'icms_st'], ['Total', 'total']])}
      <div class="aviso" style="margin-top:12px"><b>Comparação atual × reforma</b>
        Carga atual ${A.moeda(c.cargaAtual)} · carga projetada ${A.moeda(c.cargaProjetada)} · diferença ${A.setaR$(c.diferenca)}.
        <div class="acao">${A.esc(c.observacao)}</div></div>
      ${r.simulados ? `<div class="aviso atencao"><b>${r.simulados} itens com resultado simulado</b>
        Dependem de hipótese (alíquota parametrizada, faixa do Simples ou base estimada) e não devem ser apresentados como valor apurado.</div>` : ''}
    </div>`;
}


// =========================================================================
// MAPA DE RISCOS — dentro de Projeção de cenários
// =========================================================================
const nivelTag = (n) => ({ alta: ['a', 'Alta'], media: ['b', 'Média'], baixa: ['c', 'Baixa'] }[n] || ['n', n]);

async function projRiscos(el) {
  const d = await A.api(`/empresas/${S.empresaId}/motor/riscos?ano=${anoAtual()}`);
  const s = d.sintese;
  el.innerHTML = seletorAno(() => A.ir('cenarios')) +
    `<div class="grade g4">
      ${A.kpi('Riscos identificados', s.total, `${s.dimensoes.length} dimensões`)}
      ${A.kpi('Nível alto', s.alta, '', s.alta ? 'destaque' : '')}
      ${A.kpi('Nível médio', s.media)}
      ${A.kpi('Valor exposto', A.moeda(s.exposicaoTotal), 'soma das exposições')}
    </div>
    <div class="cartao" style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <b style="font-size:13px">Levar os riscos para o plano de adequação</b>
      <span class="mini" style="flex:1">Cria uma ação por risco, sem duplicar o que já existe no plano.</span>
      <button class="btn ouro" id="paraPlano">Gerar ações</button>
      <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/riscos?ano=${anoAtual()}')">Exportar Excel</button>
    </div>
    <div id="statusPlano"></div>
    ${d.riscos.map((r) => `<div class="cartao">
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:6px">
        <span class="tag ${nivelTag(r.nivel)[0]}">${nivelTag(r.nivel)[1]}</span>
        <span class="tag n">${A.esc(r.dimensao)}</span>
        <b style="flex:1;font-size:14.5px;color:var(--navy-900)">${A.esc(r.titulo)}</b>
        <span class="mono">${A.moeda(r.exposicao)}${r.participacao ? ` · ${A.pct(r.participacao, 1)}` : ''}</span>
      </div>
      <p style="margin:0 0 8px;color:var(--tinta-2);font-size:13.5px">${A.esc(r.descricao)}</p>
      <div class="aviso ${r.nivel === 'alta' ? 'alto' : 'atencao'}"><b>Impacto</b>${A.esc(r.impacto)}
        <div class="acao">${A.esc(r.acao)}</div></div>
      ${(r.evidencias || []).length ? `<details class="clausula" style="border:none;padding:0">
        <summary class="mini">Ver ${r.evidencias.length} evidências${r.itens > r.evidencias.length ? ` de ${r.itens} itens` : ''}</summary>
        ${A.tabela([
          { t: 'Contraparte', r: (e) => `${A.esc(e.contraparte || '')}<div class="mini mono">${A.cnpjFmt(e.cnpj || '')}</div>` },
          { t: 'Item', r: (e) => `<span class="mini">${A.esc((e.item || '').slice(0, 45))}</span>` },
          { t: 'NCM/NBS', r: (e) => `<span class="mono mini">${A.esc(e.ncm || '—')}</span>` },
          { t: 'Documento', r: (e) => `<span class="mini">${A.esc(e.documento || '—')}</span>` },
          { t: 'Valor', num: true, r: (e) => A.moeda(e.valor) },
          { t: 'Detalhe', r: (e) => `<span class="mini">${A.esc((e.detalhe || '').slice(0, 70))}</span>` },
        ], r.evidencias)}
      </details>` : ''}
    </div>`).join('')}
    <div class="aviso"><b>Como ler este mapa</b>${A.esc(d.observacao)}</div>`;

  document.getElementById('paraPlano').onclick = async () => {
    const box = document.getElementById('statusPlano');
    box.innerHTML = '<div class="carregando">Gerando ações…</div>';
    try {
      const r = await A.api(`/empresas/${S.empresaId}/motor/riscos/plano`, { metodo: 'POST', corpo: { ano: anoAtual() } });
      box.innerHTML = `<div class="aviso bom"><b>${r.criadas} ações criadas${r.ignoradas ? ` · ${r.ignoradas} já existiam` : ''}</b>
        <div class="acao">Abra o Plano de adequação para atribuir responsáveis e prazos.</div></div>`;
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  };
}

// =========================================================================
// CLASSIFICAÇÕES (item 36) e CONFORMIDADE (item 37) — dentro de Bases
// =========================================================================
async function projClassificacoes(el) {
  const d = await A.api(`/empresas/${S.empresaId}/motor/classificacoes?limite=400`);
  const ibsAtivo = d.itens.some((i) => Number(i.detalhe?.aliquotas?.parametros?.calcular_ibs) === 1);
  el.innerHTML = seletorAno(() => A.ir('bases')) +
    `<div class="cartao">
      <h2>Classificação item a item</h2>
      <p class="desc">${ibsAtivo ? 'Resultado do motor IBS/CBS.' : 'Análise CBS: IBS não está habilitado nesta configuração.'} Clique numa linha para ver a rastreabilidade completa: de onde veio cada número.</p>
      ${A.tabela([
        { t: 'Sentido', r: (i) => `<span class="tag">${i.sentido === 'entrada' ? 'Entrada' : 'Saída'}</span>` },
        { t: 'Contraparte', r: (i) => `${A.esc(i.detalhe.contraparte || '')}<div class="mini">${A.esc((i.detalhe.descricao || '').slice(0, 40))}</div>` },
        { t: 'NCM/NBS', r: (i) => `<span class="mono mini">${A.esc(i.detalhe.ncm || i.detalhe.nbs || '—')}</span>` },
        { t: 'CFOP', r: (i) => `<span class="mono mini">${A.esc(i.detalhe.cfop || '—')}</span>` },
        { t: 'CST atual', r: (i) => `<span class="mono mini">${A.esc(i.detalhe.cstAtual || i.detalhe.csosn || '—')}</span>` },
        { t: 'Declarado no XML', r: (i) => `<span class="mono mini">CST ${A.esc(i.detalhe.classificacao?.declarado?.cst || '—')}<br>cCT ${A.esc(i.detalhe.classificacao?.declarado?.cclasstrib || '—')}</span>` },
        { t: 'Recomendado pela base', r: (i) => `<span class="mono mini">CST ${A.esc(i.cst || '—')}<br>cCT ${A.esc(i.cclasstrib || '—')}</span>` },
        { t: 'Tratamento', r: (i) => `<span class="mini">${A.esc((i.tratamento || '').slice(0, 42))}</span>` },
        { t: 'Base econômica', num: true, r: (i) => A.moeda(i.base_economica) },
        ...(ibsAtivo ? [{ t: 'IBS', num: true, r: (i) => A.moeda(i.ibs) }] : []),
        { t: 'CBS', num: true, r: (i) => A.moeda(i.cbs) },
        { t: 'Crédito', num: true, r: (i) => A.moeda(i.credito_ibs + i.credito_cbs) },
        { t: 'Status', r: (i) => `<span class="tag ${stCls(i.status_classificacao)[0]}">${stCls(i.status_classificacao)[1]}</span>` },
        { t: '', r: (i) => `<button class="btn pq vazio" data-rastro="${i.id}">Rastro</button>` },
      ], d.itens, { vazio: 'Execute o motor para gerar as classificações.' })}
    </div>`;

  el.querySelectorAll('[data-rastro]').forEach((b) => { b.onclick = () => {
    const i = d.itens.find((x) => x.id === Number(b.dataset.rastro));
    rastreabilidade(i.detalhe);
  }; });
}

/** Item 40 — de onde veio este número */
function rastreabilidade(x) {
  const rec = x.reconstrucao || {}, cls = x.classificacao || {}, al = x.aliquotas || {};
  A.modal({
    titulo: 'Rastreabilidade do cálculo', largura: 900, confirmar: null,
    descricao: `${A.esc(x.descricao || '')} · documento ${A.esc(x.documento || '—')} item ${x.item_numero || '—'}`,
    corpo: `<div class="grade g3">
        ${A.kpi('Preço atual', A.moeda(x.precoAtual), 'valor original do documento')}
        ${A.kpi('Base econômica', A.moeda(x.baseEconomica), rec.status)}
        ${A.kpi('Preço projetado', A.moeda(x.precoProjetado), nat(x.natureza), 'destaque')}
      </div>
      <h3 style="font-size:13px;margin-top:16px">1. Reconstrução da base econômica</h3>
      <div class="aviso"><b>Fórmula aplicada</b><span class="mono" style="font-size:12px">${A.esc(rec.formula || '')}</span></div>
      ${A.tabela([
        { t: 'Tributo', r: (p) => p.tributo },
        { t: 'Forma de cálculo', r: (p) => `<span class="tag ${p.forma === 'por fora' ? 'b' : ''}">${p.forma}</span>` },
        { t: 'Origem', r: (p) => `<span class="mini">${A.esc(p.origem)}</span>` },
        { t: 'Valor', num: true, r: (p) => A.moeda(p.valor) },
        { t: 'Observação', r: (p) => `<span class="mini">${A.esc(p.observacao || p.formula || '')}</span>` },
      ], rec.passos || [])}
      <h3 style="font-size:13px;margin-top:16px">2. Classificação</h3>
      <table>
        <tr><td>Status</td><td><span class="tag ${stCls(cls.status)[0]}">${stCls(cls.status)[1]}</span></td></tr>
        <tr><td>Origem da regra</td><td>${A.esc(cls.origemRegra || '—')}</td></tr>
        <tr><td>Declarado no XML</td><td class="mono">CST ${A.esc(cls.declarado?.cst || '—')} · cClassTrib ${A.esc(cls.declarado?.cclasstrib || '—')}</td></tr>
        <tr><td>Recomendado pela base (motor)</td><td class="mono">CST ${A.esc(cls.cst || '—')} · cClassTrib ${A.esc(cls.cclasstrib || '—')}</td></tr>
        <tr><td>Tratamento</td><td>${A.esc(cls.tratamento || '—')}</td></tr>
        <tr><td>Fundamento legal</td><td>${A.esc(cls.fundamentoLegal || '—')}${cls.anexo ? ` · Anexo ${A.esc(cls.anexo)}` : ''}</td></tr>
        ${cls.localIncidencia ? `<tr><td>Local de incidência</td><td>${A.esc(cls.localIncidencia)}</td></tr>` : ''}
        ${cls.natureza ? `<tr><td>Natureza pelo CFOP</td><td>${A.esc(cls.natureza)}</td></tr>` : ''}
      </table>
      ${(cls.fundamentos || []).map((f) => `<div class="mini" style="margin-top:4px">• ${A.esc(f)}</div>`).join('')}
      <h3 style="font-size:13px;margin-top:16px">3. Alíquota</h3>
      ${A.tabela([
        { t: 'Etapa', r: (t) => t.etapa },
        { t: 'IBS', num: true, r: (t) => A.pct(t.ibs) },
        { t: 'CBS', num: true, r: (t) => A.pct(t.cbs) },
        { t: 'Origem', r: (t) => `<span class="mini">${A.esc(t.origem || '')}</span>` },
      ], al.trilha || [])}
      ${al.simulacao ? `<div class="aviso atencao"><b>${A.esc(al.rotulo)}</b>
        Este percentual é parâmetro de simulação, não alíquota legal definitiva.</div>` : ''}
      <h3 style="font-size:13px;margin-top:16px">4. Tributo e crédito</h3>
      <table>
        <tr><td>IBS projetado</td><td class="num mono">${A.moeda(x.ibs)}</td></tr>
        <tr><td>CBS projetada</td><td class="num mono">${A.moeda(x.cbs)}</td></tr>
        <tr><td>Crédito IBS</td><td class="num mono">${A.moeda(x.creditoIbs)}</td></tr>
        <tr><td>Crédito CBS</td><td class="num mono">${A.moeda(x.creditoCbs)}</td></tr>
        <tr><td>Status do crédito</td><td><span class="tag ${stCred(x.credito && x.credito.status)[0]}">${stCred(x.credito && x.credito.status)[1]}</span></td></tr>
        <tr><td>Motivo</td><td class="mini">${A.esc((x.credito && x.credito.motivo) || '')}</td></tr>
        <tr style="background:var(--ouro-100)"><td><b>Custo líquido projetado</b></td><td class="num mono"><b>${A.moeda(x.custoLiquido)}</b></td></tr>
      </table>
      ${(rec.pendencias || []).length ? `<h3 style="font-size:13px;margin-top:16px">Pendências</h3>
        ${rec.pendencias.map((p) => `<div class="aviso atencao">${A.esc(p)}</div>`).join('')}` : ''}`,
  });
}

async function projConformidade(el) {
  let d;
  try { d = await A.api(`/empresas/${S.empresaId}/motor/conformidade`); }
  catch (e) {
    el.innerHTML = `<div class="cartao">${A.vazio('Motor ainda não executado',
      'Rode o motor na aba de projeção de fornecedores ou clientes para gerar os apontamentos de conformidade.')}</div>`;
    return;
  }
  const total = d.conformidade.reduce((s, c) => s + c.itens, 0);
  el.innerHTML = `<div class="grade g3">
      ${A.kpi('Apontamentos', total, `${d.conformidade.length} tipos`)}
      ${A.kpi('Gravidade alta', d.conformidade.filter((c) => c.gravidade === 'alta').reduce((s, c) => s + c.itens, 0), '', 'destaque')}
      ${A.kpi('Valor envolvido', A.moeda(d.conformidade.reduce((s, c) => s + c.valor, 0)), `execução de ${A.esc(d.executadoEm || '')}`)}
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2>Apontamentos de conformidade</h2>
      <p class="desc">Cada apontamento é um dado que falta para a projeção ficar segura — não uma acusação de erro.</p>
      ${d.conformidade.map((c) => `<div class="cartao" style="box-shadow:none;margin-bottom:10px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <span class="tag ${c.gravidade === 'alta' ? 'a' : 'b'}">${c.gravidade}</span>
          <b style="flex:1">${A.esc(c.rotulo)}</b>
          <span class="mono">${c.itens} itens · ${A.moeda(c.valor)}</span>
        </div>
        <details class="clausula" style="border:none;padding:0;margin-top:8px">
          <summary class="mini">Ver itens afetados</summary>
          ${A.tabela([
            { t: 'Parceiro', r: (x) => A.esc(x.parceiro || '') },
            { t: 'Item', r: (x) => `<span class="mini">${A.esc((x.item || '').slice(0, 45))}</span>` },
            { t: 'NCM/NBS', r: (x) => `<span class="mono mini">${A.esc(x.ncm || x.nbs || '—')}</span>` },
            { t: 'Documento', r: (x) => `<span class="mini">${A.esc(x.documento || '—')}</span>` },
            { t: 'Valor', num: true, r: (x) => A.moeda(x.valor) },
          ], c.exemplos)}
          ${c.itens > c.exemplos.length ? `<div class="mini">…e mais ${c.itens - c.exemplos.length} itens.</div>` : ''}
        </details>
      </div>`).join('') || A.vazio('Sem apontamentos', 'Todos os itens foram classificados com dados suficientes.')}
    </div>`;
}

// =========================================================================
// IMPORTAÇÃO DE XML — dentro da etapa de cadastros
// =========================================================================
async function projImportacaoXml(el) {
  const ex = await A.api(`/empresas/${S.empresaId}/motor`);
  el.innerHTML = `<div class="grade g2">
      <div class="cartao">
        <h2>Importar XML fiscal</h2>
        <p class="desc">NF-e, NFC-e, CT-e e NFS-e. O sentido da operação é resolvido comparando o CNPJ da empresa com emitente e destinatário — entradas viram fornecedores, saídas viram clientes.</p>
        <div class="dropzone" id="zonaXml"><b>Solte os XMLs aqui</b>
          <div class="mini">pode selecionar vários de uma vez · até 500 arquivos</div></div>
        <div id="statusXml" style="margin-top:12px"></div>
        <hr class="sep">
        <h2>Importar SPED</h2>
        <p class="desc">EFD ICMS/IPI e EFD Contribuições. Aqui o sentido já vem pronto no campo IND_OPER — não precisa ser deduzido. O NCM é cruzado com o registro 0200.</p>
        <div class="dropzone" id="zonaSped"><b>Solte os arquivos de SPED aqui</b>
          <div class="mini">.txt · até 60 arquivos por vez</div></div>
        <div id="statusSped" style="margin-top:12px"></div>
      </div>
      <div class="cartao">
        <h2>Executar o motor</h2>
        <p class="desc">Classifica cada item, reconstrói a base econômica e projeta IBS/CBS, débitos e créditos.</p>
        ${ex.execucao ? `<div class="aviso bom"><b>Última execução: ${A.esc(ex.execucao.criado_em)}</b>
          Ano ${ex.execucao.ano} · ${ex.execucao.itens} itens · ${ex.execucao.classificados} classificados ·
          ${ex.execucao.requer_validacao} a validar · ${ex.execucao.sem_correspondencia} sem correspondência</div>`
          : '<div class="aviso atencao"><b>Motor ainda não executado</b>Importe a movimentação e rode o motor.</div>'}
        ${A.selecao('anoMotor', 'Ano da projeção', A.opcoesAno(), anoAtual())}
        <button class="btn ouro" id="rodarMotor" style="width:100%">Executar motor</button>
        <div id="statusMotor" style="margin-top:12px"></div>
      </div>
    </div>`;

  const z = document.getElementById('zonaXml');
  const i = document.createElement('input');
  i.type = 'file'; i.accept = '.xml'; i.multiple = true; i.style.display = 'none';
  z.appendChild(i);
  z.onclick = () => i.click();
  z.ondragover = (e) => { e.preventDefault(); z.classList.add('sobre'); };
  z.ondragleave = () => z.classList.remove('sobre');
  z.ondrop = (e) => { e.preventDefault(); z.classList.remove('sobre'); enviar(e.dataTransfer.files); };
  i.onchange = () => { enviar(i.files); i.value = ''; };

  async function enviar(files) {
    if (!files || !files.length) return;
    const box = document.getElementById('statusXml');
    box.innerHTML = `<div class="aviso">Lendo ${files.length} arquivo(s)…</div>`;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('arquivos', f));
    try {
      const r = await A.api(`/empresas/${S.empresaId}/importar/xml`, { metodo: 'POST', corpo: fd });
      box.innerHTML = `<div class="grade g3" style="margin-bottom:10px">
          ${A.kpi('Documentos lidos', r.documentos)}
          ${A.kpi('Itens', r.itens, `${r.entradas} entradas · ${r.saidas} saídas`)}
          ${A.kpi('Regimes sugeridos', r.regimesSugeridos, 'pelo CRT do XML')}
        </div>
        ${r.requerValidacao ? `<div class="aviso atencao"><b>${r.requerValidacao} documentos requerem validação</b>
          O CNPJ da empresa não aparece como emitente nem destinatário — confira se o XML pertence a esta empresa.</div>` : ''}
        ${r.classificacao ? `<div class="aviso bom"><b>Classificação automática</b>
          ${r.classificacao.porNcm} por NCM · ${r.classificacao.porNbs} por NBS · ${r.classificacao.requerDecisao} requerem decisão</div>` : ''}
        ${r.erros.length ? `<details class="clausula"><summary class="mini">${r.erros.length} avisos de leitura</summary>
          ${r.erros.slice(0, 20).map((e) => `<div class="mini">• ${A.esc(e)}</div>`).join('')}</details>` : ''}
        <div class="aviso"><b>Regimes precisam de conferência</b>
          O XML informa o CRT do emitente, que distingue Simples de regime normal — mas não separa Lucro Real de Presumido.
          Confira o cadastro de parceiros antes de confiar nos créditos projetados.</div>`;
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  }

  // ---- SPED ----
  const zs = document.getElementById('zonaSped');
  const is = document.createElement('input');
  is.type = 'file'; is.accept = '.txt,.SPED'; is.multiple = true; is.style.display = 'none';
  zs.appendChild(is);
  zs.onclick = () => is.click();
  zs.ondragover = (e) => { e.preventDefault(); zs.classList.add('sobre'); };
  zs.ondragleave = () => zs.classList.remove('sobre');
  zs.ondrop = (e) => { e.preventDefault(); zs.classList.remove('sobre'); enviarSped(e.dataTransfer.files); };
  is.onchange = () => { enviarSped(is.files); is.value = ''; };

  async function enviarSped(files) {
    if (!files || !files.length) return;
    const box = document.getElementById('statusSped');
    box.innerHTML = `<div class="aviso">Lendo ${files.length} arquivo(s) de SPED…</div>`;
    const fd = new FormData();
    [...files].forEach((f) => fd.append('arquivos', f));
    try {
      const r = await A.api(`/empresas/${S.empresaId}/importar/sped`, { metodo: 'POST', corpo: fd });
      box.innerHTML = `<div class="grade g3" style="margin-bottom:10px">
          ${A.kpi('Itens', r.itens, `${r.entradas} entradas · ${r.saidas} saídas`)}
          ${A.kpi('Participantes', r.participantes, `${r.produtos} itens no cadastro 0200`)}
          ${A.kpi('Sem regime', r.parceirosSemRegime, 'precisam de cadastro', r.parceirosSemRegime ? 'destaque' : '')}
        </div>
        ${A.tabela([
          { t: 'Arquivo', r: (p) => `${A.esc(p.arquivo)}<div class="mini">${p.tipo === 'efd_icms_ipi' ? 'EFD ICMS/IPI' : 'EFD Contribuições'}</div>` },
          { t: 'Período', r: (p) => `<span class="mono mini">${A.esc(p.inicio)} a ${A.esc(p.fim)}</span>` },
          { t: 'Documentos', num: true, r: (p) => p.documentos },
          { t: 'Itens', num: true, r: (p) => p.itens },
          { t: 'Entradas', num: true, r: (p) => A.moeda(p.valorEntradas) },
          { t: 'Saídas', num: true, r: (p) => A.moeda(p.valorSaidas) },
        ], r.periodos)}
        ${r.classificacao ? `<div class="aviso bom" style="margin-top:10px"><b>Classificação automática</b>
          ${r.classificacao.porNcm} por NCM · ${r.classificacao.porNbs} por NBS · ${r.classificacao.requerDecisao} requerem decisão · ${r.classificacao.naoEncontrado} sem correspondência</div>` : ''}
        ${r.avisos.map((a) => `<div class="aviso atencao">${A.esc(a)}</div>`).join('')}
        ${r.erros.length ? `<details class="clausula"><summary class="mini">${r.erros.length} arquivos com erro</summary>
          ${r.erros.map((e) => `<div class="mini">• ${A.esc(e)}</div>`).join('')}</details>` : ''}`;
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  }

  document.getElementById('rodarMotor').onclick = async () => {
    const box = document.getElementById('statusMotor');
    const ano = Number(document.querySelector('[name="anoMotor"]').value);
    S.cache.motorAno = ano;
    box.innerHTML = '<div class="carregando">Classificando e projetando…</div>';
    try {
      const r = await A.api(`/empresas/${S.empresaId}/motor/executar`, { metodo: 'POST', corpo: { ano } });
      const s = r.resumo;
      box.innerHTML = `<div class="grade g2" style="margin-bottom:10px">
          ${A.kpi('Itens processados', s.itens, `${s.entradas} entradas · ${s.saidas} saídas`)}
          ${A.kpi('Classificados', s.classificados, `${s.requerValidacao} a validar · ${s.semCorrespondencia} sem correspondência`)}
        </div>
        <div class="aviso bom"><b>Projeção concluída para ${s.ano}</b>
          Saldo IBS ${A.moeda(s.apuracao.ibs.saldo)} · saldo CBS ${A.moeda(s.apuracao.cbs.saldo)}</div>
        ${s.simulados ? `<div class="aviso atencao"><b>${s.simulados} itens com resultado simulado</b>
          Dependem de hipótese e não devem ser apresentados como valor apurado.</div>` : ''}`;
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  };
}

// =========================================================================
// LIGAÇÃO COM AS TELAS EXISTENTES
// =========================================================================
comAbas('fornecedores', [
  { id: 'atual', t: 'Análise atual' },
  { id: 'motor', t: 'Projeção IBS/CBS', render: projFornecedores },
], 'atual');

comAbas('clientes', [
  { id: 'atual', t: 'Análise atual' },
  { id: 'motor', t: 'Projeção IBS/CBS', render: projClientes },
], 'atual');

// Exposto para telas6/telas7 registrarem abas nas mesmas telas, sem duplicar
// a mecânica de navegação.
window.MotorUI = { comAbas, seletorAno, anoAtual, nat, stCls, stCred, sens, perfil, rastreabilidade,
  abasCenarios: [
    { id: 'atual', t: 'Projeção de cenários' },
    { id: 'simulacoes', t: 'Simulações tributárias', render: projSimulacoes },
    { id: 'riscos', t: 'Mapa de riscos', render: projRiscos },
  ] };

window.MotorUI.abasBases = [
  { id: 'atual', t: 'Bases carregadas' },
  { id: 'classificacoes', t: 'Classificações', render: projClassificacoes },
  { id: 'conformidade', t: 'Conformidade', render: projConformidade },
];

comAbas('dados', [
  { id: 'atual', t: 'Planilhas' },
  { id: 'xml', t: 'XML, SPED e motor', render: projImportacaoXml },
], 'atual');
})();
