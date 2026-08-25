/* =========================================================================
   CONFIGURAÇÕES — todas as regras de cálculo num só lugar
   -------------------------------------------------------------------------
   Cada aba corresponde a uma família de regras. Tudo que aparece aqui é lido
   pelos motores em tempo de execução: alterar um valor muda o resultado da
   próxima projeção, sem tocar em código.
   ========================================================================= */
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') =>
  `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
   <div class="acoes-topo">${acoes}</div></div>`;

async function recalcularProjeto() {
  const r = await A.api('/config/processamentos-carteira', { metodo: 'POST' });
  const p = r.processamento;
  A.toast(`Processamento da carteira iniciado: ${p.total_empresas} empresa(s). Acompanhe no Controle do projeto.`, 'ok');
  return r;
}

const ABAS = [
  { id: 'controle', t: 'Controle do projeto' },
  { id: 'aliquotas', t: 'Alíquotas e transição' },
  { id: 'tributos', t: 'Forma de cálculo' },
  { id: 'regimes', t: 'Regimes e crédito' },
  { id: 'reducoes', t: 'Reduções' },
  { id: 'simples', t: 'Simples Nacional' },
  { id: 'cfop', t: 'Natureza por CFOP' },
  { id: 'limiares', t: 'Limiares e padrões' },
  { id: 'ensaio', t: 'Ensaio de regra' },
  { id: 'historico', t: 'Histórico' },
];

Telas.configuracoes = async (el) => {
  const d = await A.api('/config/regras');
  const aba = S.aba.config || 'controle';

  el.innerHTML = cab('Configurações', 'Controle e regras do projeto',
    'Comece pelo controle: ele mostra pendências e inconsistências antes de recalcular. As demais abas concentram todas as regras usadas pelo motor — nenhuma fica escondida no código.',
    '<button class="btn" id="recalcularProjeto">Recalcular projeto</button>') +
    `<div class="abas">${ABAS.map((a) =>
      `<button data-c="${a.id}" class="${aba === a.id ? 'ativo' : ''}">${a.t}</button>`).join('')}</div>
     <div id="corpoConfig"></div>`;

  el.querySelectorAll('[data-c]').forEach((b) => { b.onclick = () => { S.aba.config = b.dataset.c; A.ir('configuracoes'); }; });
  document.getElementById('recalcularProjeto').onclick = () => A.confirmar(
    'Recalcular todas as empresas? Isso atualiza Classificações e itens salvos de Precificação com as regras atuais.',
    async () => {
      await recalcularProjeto();
      A.ir('configuracoes');
    });
  const box = document.getElementById('corpoConfig');
  ({ controle, aliquotas, tributos, regimes, reducoes, simples, cfop, limiares, ensaio, historico }[aba])(box, d);
};

async function controle(box) {
  box.innerHTML = '<div class="carregando">Verificando o projeto…</div>';
  const d = await A.api('/config/controle');
  const carteira = (await A.api('/config/processamentos-carteira')).processamento;
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);
  box.innerHTML = `<div class="grade g4">
      ${A.kpi('Clientes a identificar', d.total.clientesPendentes, 'cadastro e perfil pendentes', d.total.clientesPendentes ? 'destaque' : '')}
      ${A.kpi('Receita sem perfil confirmado', A.moeda(d.total.receitaPendente), 'prioridade do enriquecimento', d.total.receitaPendente ? 'destaque' : '')}
      ${A.kpi('Classificações a revisar', d.total.classificacoesPendentes, 'NCM/NBS ou cClassTrib pendente', d.total.classificacoesPendentes ? 'destaque' : '')}
      ${A.kpi('Serviços sem referência fiscal', d.total.servicosSemReferencia, A.moeda(d.total.vendasSemReferencia) + ' em vendas', d.total.servicosSemReferencia ? 'destaque' : '')}
      ${A.kpi('Exceções abertas', d.total.excecoesAbertas || 0, A.moeda(d.total.valorExcecoes || 0) + ' priorizados por materialidade', d.total.excecoesAbertas ? 'destaque' : '')}
    </div>
    <div class="cartao" style="margin-top:16px"><h2>Ações do projeto</h2>
      <p class="desc">O enriquecimento consulta apenas CNPJs pendentes e respeita a ordem de custo: fontes abertas antes da Casa dos Dados.</p>
      <button class="btn" id="ctrlEnriquecer">Enriquecer pendências agora</button>
      <button class="btn vazio" id="ctrlRecalcular">Recalcular todo o projeto</button>
      <div id="ctrlStatus" style="margin-top:12px"></div></div>
    ${carteira ? `<div class="cartao" style="margin-top:16px"><h2>Processamento da carteira</h2>
      <p class="desc"><b>${A.esc(carteira.status)}</b> · ${carteira.processadas}/${carteira.total_empresas} empresa(s) · ${carteira.automaticas} automática(s) · ${carteira.com_premissas} com premissas · ${carteira.com_excecoes} com exceções · ${carteira.bloqueadas} bloqueada(s).</p>
      ${carteira.status === 'EXECUTANDO' || carteira.status === 'AGENDADO' ? '<button class="btn vazio" id="atualizarCarteira">Atualizar acompanhamento</button>' : ''}
    </div>` : ''}
    <div class="cartao" style="margin-top:16px"><h2>Inconsistências por empresa</h2>
      ${A.tabela([
        { t: 'Empresa', r: (x) => `<b>${A.esc(x.razao_social)}</b>` },
        { t: 'Clientes pendentes', num: true, r: (x) => x.clientesPendentes },
        { t: 'Receita exposta', num: true, r: (x) => A.moeda(x.receitaPendente) },
        { t: 'Classificações pendentes', num: true, r: (x) => x.classificacoesPendentes },
        { t: 'Serviços sem referência', num: true, r: (x) => `${x.servicosSemReferencia}<div class="mini">${A.moeda(x.vendasSemReferencia)}</div>` },
        { t: 'Exceções', num: true, r: (x) => x.excecoes?.abertas ? `<b>${x.excecoes.abertas}</b><div class="mini">${A.moeda(x.excecoes.valor_envolvido)}</div>` : '<span class="tag c">nenhuma</span>' },
        { t: 'Enriquecimento', r: (x) => x.enriquecimento ? `<span class="tag b">${A.esc(x.enriquecimento.status)}</span>` : '<span class="tag n">sem fila</span>' },
        { t: 'Último motor', r: (x) => x.ultimaExecucao ? `${A.esc(x.ultimaExecucao.data || '—')}${ibsAtivo ? ` · ${x.ultimaExecucao.ano}` : ' · CBS'}` : 'não executado' },
        { t: '', r: (x) => x.excecoes?.abertas ? `<button class="btn pq vazio" data-excecoes="${x.id}" data-empresa="${A.esc(x.razao_social)}">Ver exceções</button>` : (x.clientesPendentes || x.classificacoesPendentes || x.servicosSemReferencia) ? `<button class="btn pq vazio" data-corrigir="${x.id}" data-destino="${x.servicosSemReferencia || x.clientesPendentes ? 'dados' : 'bases'}">Corrigir</button>` : '<span class="tag c">sem pendências</span>' },
      ], d.empresas)}</div>`;
  document.getElementById('ctrlEnriquecer').onclick = async () => {
    const r = await A.api('/config/controle/enriquecer', { metodo: 'POST' });
    document.getElementById('ctrlStatus').innerHTML = `<div class="aviso bom"><b>${r.filas.length} fila(s) iniciada(s)</b> O processamento ocorre em segundo plano; esta tela mostra o status ao atualizar.</div>`;
  };
  document.getElementById('ctrlRecalcular').onclick = () => document.getElementById('recalcularProjeto').click();
  document.getElementById('atualizarCarteira')?.addEventListener('click', () => A.ir('configuracoes'));
  box.querySelectorAll('[data-corrigir]').forEach((botao) => { botao.onclick = async () => {
    localStorage.setItem('sattva_empresa', botao.dataset.corrigir); await A.carregarEmpresas();
    if (botao.dataset.destino === 'dados') S.aba.dados = 'cliente';
    if (botao.dataset.destino === 'bases') S.aba.bases = 'classificacoes';
    A.ir(botao.dataset.destino);
  }; });
  box.querySelectorAll('[data-excecoes]').forEach((botao) => { botao.onclick = async () => {
    const r = await A.api(`/empresas/${botao.dataset.excecoes}/excecoes?limite=100`);
    A.modal({ titulo: `Exceções — ${botao.dataset.empresa}`, confirmar: null,
      descricao: 'Somente casos não resolvidos automaticamente. A ordem é materialidade, não ordem de importação.',
      corpo: A.tabela([
        { t: 'Exceção', r: (x) => `<b>${A.esc(x.categoria)}</b><div class="mini">${A.esc(x.detalhe?.mensagem || x.codigo)}</div>` },
        { t: 'Gravidade', r: (x) => `<span class="tag ${x.gravidade === 'alta' ? 'a' : 'n'}">${A.esc(x.gravidade)}</span>` },
        { t: 'Valor envolvido', num: true, r: (x) => A.moeda(x.valor_envolvido) },
        { t: 'Impacto CBS', num: true, r: (x) => A.moeda(x.impacto_cbs_estimado) },
      ], r.excecoes || []),
    });
  }; });
}

const salvar = async (caminho, corpo, msg) => {
  try { await A.api(caminho, { metodo: 'PUT', corpo }); await A.carregarParametros(); A.toast(msg || 'Regra atualizada', 'ok'); A.ir('configuracoes'); }
  catch (e) { A.toast(e.message, 'erro'); }
};

// -------------------------------------------------------------- ALÍQUOTAS
function aliquotas(box, d) {
  const ibsAtivo = d.aliquotas.some((a) => Number(a.calcular_ibs) === 1);
  const aud = d.auditoria || {};
  const auditoria = `<details class="aviso neutro" style="margin-bottom:16px"><summary><b>Auditoria da fonte da alíquota</b> · verificação técnica</summary><div style="margin-top:10px" class="mini">
    <div><b>Cache usado pelo Render:</b> ${aud.cache_render ? `CBS ${A.pct(aud.cache_render.cbs)} · IBS ${A.pct(aud.cache_render.ibs)} · ano ${A.esc(aud.cache_render.ano)}` : 'não encontrado'}</div>
    <div><b>Fonte Supabase:</b> ${aud.fonte_supabase ? `CBS ${A.pct(aud.fonte_supabase.cbs)} · IBS ${A.pct(aud.fonte_supabase.ibs)} · ano ${A.esc(aud.fonte_supabase.ano)}` : (aud.supabase_configurado ? 'sem registro de alíquota' : 'indisponível: chave de serviço não configurada')}</div>
    <div><b>Sincronização operacional:</b> ${aud.modo_operacao_compartilhada ? 'habilitada' : 'desabilitada'} · <b>Commit do Render:</b> ${A.esc(aud.commit_render || 'não informado')}</div>
    ${aud.erro_supabase ? `<div class="erro"><b>Erro ao consultar Supabase:</b> ${A.esc(aud.erro_supabase)}</div>` : ''}
  </div></details>`;
  if (!ibsAtivo) {
    const a = d.aliquotas.find((x) => Number(x.ano) === 2027) || d.aliquotas[0];
    box.innerHTML = `${auditoria}<div class="aviso bom"><b>Análise CBS</b> A projeção não é anual nesta etapa. A CBS abaixo é a única referência do motor.</div>
      <div class="cartao"><h2>Configuração da projeção CBS</h2><div class="grade g2">
        ${A.campo('cbs_unica','Alíquota CBS de referência',a.cbs,'number','step="0.0001"')}
        <div><label class="rotulo">Análise IBS</label><label class="check"><input type="checkbox" id="habilitarIbs"> Habilitar visão IBS e transição anual</label><p class="mini">Só habilite quando esta etapa for iniciada.</p></div>
      </div><button class="btn" id="salvarCbsUnica">Salvar configuração CBS</button></div>`;
    box.querySelector('#salvarCbsUnica').onclick = () => salvar(`/config/aliquotas/${a.ano}`, { ibs:a.ibs, cbs:box.querySelector('[name="cbs_unica"]').value, calcular_ibs:box.querySelector('#habilitarIbs').checked, fator_icms_iss:a.fator_icms_iss, fator_pis_cofins:a.fator_pis_cofins, fator_ipi:a.fator_ipi, compensavel:a.compensavel, simulacao:a.simulacao, fonte:a.fonte, nota:a.nota }, 'Configuração CBS atualizada');
    return;
  }
  box.innerHTML = `${auditoria}<div class="aviso atencao"><b>Estas alíquotas ainda dependem de definição legal</b>
      Enquanto a coluna “simulação” estiver marcada, o sistema rotula todo resultado derivado como
      ALÍQUOTA PARAMETRIZADA PARA SIMULAÇÃO e nunca como alíquota definitiva.</div>
    <div class="cartao"><h2>CBS e parâmetros da transição</h2>
      <p class="desc">Os fatores indicam quanto de cada tributo antigo ainda é devido no ano. 1 = integral, 0 = extinto.</p>
      ${A.tabela([
        { t: 'Ano', r: (a) => `<b class="mono">${a.ano}</b>` },
        { t: 'IBS', num: true, r: (a) => `<input type="number" step="0.0001" value="${a.ibs}" data-f="ibs" data-ano="${a.ano}" style="width:92px;text-align:right">` },
        { t: 'Calcular IBS', r: (a) => `<input type="checkbox" data-f="calcular_ibs" data-ano="${a.ano}" ${a.calcular_ibs ? 'checked' : ''}>` },
        { t: 'CBS', num: true, r: (a) => `<input type="number" step="0.0001" value="${a.cbs}" data-f="cbs" data-ano="${a.ano}" style="width:92px;text-align:right">` },
        { t: 'ICMS/ISS', num: true, r: (a) => `<input type="number" step="0.1" value="${a.fator_icms_iss}" data-f="fator_icms_iss" data-ano="${a.ano}" style="width:74px;text-align:right">` },
        { t: 'PIS/COFINS', num: true, r: (a) => `<input type="number" step="0.1" value="${a.fator_pis_cofins}" data-f="fator_pis_cofins" data-ano="${a.ano}" style="width:74px;text-align:right">` },
        { t: 'IPI', num: true, r: (a) => `<input type="number" step="0.1" value="${a.fator_ipi}" data-f="fator_ipi" data-ano="${a.ano}" style="width:70px;text-align:right">` },
        { t: 'Compensável', r: (a) => `<input type="checkbox" data-f="compensavel" data-ano="${a.ano}" ${a.compensavel ? 'checked' : ''}>` },
        { t: 'Simulação', r: (a) => `<input type="checkbox" data-f="simulacao" data-ano="${a.ano}" ${a.simulacao ? 'checked' : ''}>` },
        { t: 'Marco do ano', r: (a) => `<span class="mini">${A.esc((a.nota || '').slice(0, 70))}</span>` },
        { t: '', r: (a) => `<button class="btn pq" data-sa="${a.ano}">Salvar</button>` },
      ], d.aliquotas)}
    </div>`;
  box.querySelectorAll('[data-sa]').forEach((b) => { b.onclick = () => {
    const ano = b.dataset.sa;
    const v = (f) => { const el = box.querySelector(`[data-f="${f}"][data-ano="${ano}"]`);
      return el.type === 'checkbox' ? el.checked : el.value; };
    const orig = d.aliquotas.find((x) => String(x.ano) === ano);
    salvar(`/config/aliquotas/${ano}`, { ibs: v('ibs'), cbs: v('cbs'), calcular_ibs: v('calcular_ibs'), fator_icms_iss: v('fator_icms_iss'),
      fator_pis_cofins: v('fator_pis_cofins'), fator_ipi: v('fator_ipi'),
      compensavel: v('compensavel'), simulacao: v('simulacao'), fonte: orig.fonte, nota: orig.nota },
      `Alíquotas de ${ano} atualizadas`);
  }; });
}

// ---------------------------------------------------------- FORMA DE CÁLCULO
function tributos(box, d) {
  box.innerHTML = `<div class="aviso"><b>A regra mais importante do motor</b>
      É esta tabela que decide o que sai do preço na volta à base econômica. Tributo <b>por dentro</b>
      integra o preço e precisa ser retirado; tributo <b>por fora</b> soma ao preço e nunca esteve dentro
      dele — retirá-lo produziria base menor que a real.</div>
    <div class="cartao"><h2>Forma de cálculo de cada tributo atual</h2>
      ${A.tabela([
        { t: 'Tributo', r: (t) => `<b>${A.esc(t.label)}</b>` },
        { t: 'Forma de cálculo', r: (t) => `<select data-f="forma" data-c="${t.chave}">
            <option value="dentro" ${t.forma === 'dentro' ? 'selected' : ''}>Por dentro — integra o preço</option>
            <option value="fora" ${t.forma === 'fora' ? 'selected' : ''}>Por fora — soma ao preço</option></select>` },
        { t: 'Sai da base econômica', r: (t) => `<input type="checkbox" data-f="sai" data-c="${t.chave}" ${t.saiDaBase ? 'checked' : ''}>` },
        { t: 'Substituído por IBS/CBS', r: (t) => `<input type="checkbox" data-f="sub" data-c="${t.chave}" ${t.substituido ? 'checked' : ''}>` },
        { t: 'Nota técnica', r: (t) => `<span class="mini">${A.esc(t.descricao || '')}</span>` },
        { t: '', r: (t) => `<button class="btn pq" data-st="${t.chave}">Salvar</button>` },
      ], d.tributos)}
    </div>`;
  box.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => {
    const c = b.dataset.st;
    const t = d.tributos.find((x) => x.chave === c);
    salvar(`/config/tributos/${c}`, {
      forma: box.querySelector(`[data-f="forma"][data-c="${c}"]`).value,
      saiDaBase: box.querySelector(`[data-f="sai"][data-c="${c}"]`).checked,
      substituido: box.querySelector(`[data-f="sub"][data-c="${c}"]`).checked,
      descricao: t.descricao,
    }, `${t.label} atualizado`);
  }; });
}

// ------------------------------------------------------------------ REGIMES
function regimes(box, d) {
  const au = d.auditoriaRegimeSimples || {};
  const aud = `<details class="aviso neutro" style="margin-bottom:16px"><summary><b>Auditoria do crédito CBS do Simples</b> · verificação técnica</summary><div class="mini" style="margin-top:10px"><div><b>Cache usado pelo Render:</b> ${au.cache_render ? `referência CBS ${A.pct(au.cache_render.credito_cbs_simples_referencia)} · PIS/COFINS atual ${A.pct(au.cache_render.pis_cofins)}` : 'não encontrado'}</div><div><b>Fonte Supabase:</b> ${au.fonte_supabase ? `referência CBS ${A.pct(au.fonte_supabase.credito_cbs_simples_referencia)} · PIS/COFINS atual ${A.pct(au.fonte_supabase.pis_cofins)}` : (au.supabase_configurado ? 'sem registro' : 'indisponível')}</div>${au.erro_supabase ? `<div><b>Erro:</b> ${A.esc(au.erro_supabase)}</div>` : ''}</div></details>`;
  box.innerHTML = `<div class="aviso"><b>Quem gera crédito e quem aproveita</b>
      Para IBS/CBS o que importa é estar dentro ou fora do Simples. As colunas de PIS/COFINS servem
      apenas para reconstruir a carga atual quando o documento não traz o valor destacado —
      deixe em branco para não estimar.</div>${aud}
    <div class="cartao"><h2>Regimes tributários</h2>
      ${A.tabela([
        { t: 'Regime', r: (r) => `<b>${A.esc(r.label)}</b>` },
        { t: 'PIS/COFINS atual – fallback', num: true, r: (r) => `<input title="Percentual de referência usado apenas quando não houver evidência fiscal superior. Pode representar média ou premissa configurada." type="number" step="0.0001" value="${r.pisCofins === null ? '' : r.pisCofins}" placeholder="não estimar" data-f="pc" data-c="${r.chave}" style="width:92px;text-align:right">` },
        { t: 'Crédito CBS Simples – referência %', num: true, r: (r) => r.chave === 'simples_nacional' ? `<input title="Percentual usado somente quando a CBS efetiva do Simples não puder ser determinada. O resultado é simulado." type="number" step="0.0001" value="${r.creditoCbsSimplesReferencia === null ? '' : r.creditoCbsSimplesReferencia}" placeholder="opcional" data-f="ccs" data-c="${r.chave}" style="width:92px;text-align:right">` : '—' },
        { t: 'Credita IBS/CBS', r: (r) => `<input type="checkbox" data-f="cn" data-c="${r.chave}" ${r.creditaNovo ? 'checked' : ''}>` },
        { t: 'Gera crédito IBS/CBS', r: (r) => `<input type="checkbox" data-f="gn" data-c="${r.chave}" ${r.geraCreditoNovo ? 'checked' : ''}>` },
        { t: 'Recolhe no DAS', r: (r) => `<input type="checkbox" data-f="das" data-c="${r.chave}" ${r.noDas ? 'checked' : ''}>` },
        { t: 'Credita ICMS hoje', r: (r) => `<input type="checkbox" data-f="cai" data-c="${r.chave}" ${r.creditaAtualIcms ? 'checked' : ''}>` },
        { t: 'Credita PIS/COFINS hoje', r: (r) => `<input type="checkbox" data-f="cap" data-c="${r.chave}" ${r.creditaAtualPisCofins ? 'checked' : ''}>` },
        { t: '', r: (r) => `<button class="btn pq" data-sr="${r.chave}">Salvar</button>` },
      ], d.regimes)}
    </div>
    <div class="cartao"><h2>Notas técnicas dos regimes</h2>
      ${d.regimes.filter((r) => r.obs).map((r) => `<div class="aviso"><b>${A.esc(r.label)}</b>${A.esc(r.obs)}</div>`).join('')}
    </div>`;
  box.querySelectorAll('[data-sr]').forEach((b) => { b.onclick = () => {
    const c = b.dataset.sr;
    const r = d.regimes.find((x) => x.chave === c);
    const chk = (f) => box.querySelector(`[data-f="${f}"][data-c="${c}"]`).checked;
    salvar(`/config/regimes/${c}`, {
      pisCofins: box.querySelector(`[data-f="pc"][data-c="${c}"]`).value,
      creditoCbsSimplesReferencia: box.querySelector(`[data-f="ccs"][data-c="${c}"]`)?.value,
      creditaNovo: chk('cn'), geraCreditoNovo: chk('gn'), noDas: chk('das'),
      creditaAtualIcms: chk('cai'), creditaAtualPisCofins: chk('cap'),
      creditaAtualIpi: r.creditaAtualIpi, geraCreditoAtualIcms: r.geraCreditoAtualIcms,
      geraCreditoAtualPisCofins: r.geraCreditoAtualPisCofins, geraCreditoAtualIpi: r.geraCreditoAtualIpi,
      obs: r.obs,
    }, `${r.label} atualizado`);
  }; });
}

// ----------------------------------------------------------------- REDUÇÕES
function reducoes(box, d) {
  box.innerHTML = `<div class="aviso"><b>Percentual de redução da alíquota</b>
      0,60 significa reduzir a alíquota em 60%. As bases de NCM e NBS podem trazer percentuais próprios
      por item — quando trazem, eles têm precedência sobre o valor aqui.</div>
    <div class="cartao"><h2>Regimes diferenciados</h2>
      ${A.tabela([
        { t: 'Enquadramento', r: (r) => `<input type="text" value="${A.esc(r.label)}" data-f="lb" data-c="${r.chave}" style="width:340px">` },
        { t: 'Redução', num: true, r: (r) => `<input type="number" step="0.01" value="${r.reducao}" data-f="rd" data-c="${r.chave}" style="width:90px;text-align:right">` },
        { t: 'Alíquota efetiva', num: true, r: (r) => `<span class="mono">${A.pct(0.265 * (1 - r.reducao))}</span>` },
        { t: 'Chave interna', r: (r) => `<span class="mono mini">${A.esc(r.chave)}</span>` },
        { t: '', r: (r) => `<button class="btn pq" data-sd="${r.chave}">Salvar</button>` },
      ], d.reducoes)}
      <div class="mini" style="margin-top:8px">A coluna de alíquota efetiva usa 26,5% como referência apenas para leitura.</div>
    </div>
    <div class="cartao"><h2>O que cada enquadramento abrange</h2>
      ${d.reducoes.map((r) => `<div class="aviso"><b>${A.esc(r.label)}</b>${A.esc(r.desc || '')}</div>`).join('')}
    </div>`;
  box.querySelectorAll('[data-sd]').forEach((b) => { b.onclick = () => {
    const c = b.dataset.sd;
    salvar(`/config/reducoes/${c}`, {
      label: box.querySelector(`[data-f="lb"][data-c="${c}"]`).value,
      reducao: box.querySelector(`[data-f="rd"][data-c="${c}"]`).value,
      descricao: (d.reducoes.find((x) => x.chave === c) || {}).desc,
    });
  }; });
}

// ----------------------------------------------------------------- SIMPLES
function simples(box, d) {
  const anexos = [...new Set(d.simples.map((s) => s.anexo))];
  box.innerHTML = `<div class="aviso"><b>Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12</b>
      A repartição define quanto da alíquota efetiva vira crédito de IBS/CBS para o adquirente:
      a parcela de PIS e COFINS alimenta a CBS, a de ICMS/ISS alimenta o IBS. IRPJ, CSLL e CPP não geram crédito.</div>
    ${anexos.map((ax) => {
      const faixas = d.simples.filter((s) => s.anexo === ax);
      return `<div class="cartao"><h2>${A.esc(faixas[0].anexo_nome || 'Anexo ' + ax)}</h2>
        ${A.tabela([
          { t: 'Faixa', r: (f) => `<b class="mono">${f.faixa}</b>` },
          { t: 'Limite RBT12', num: true, r: (f) => `<input type="number" step="1000" value="${f.limite}" data-f="lim" data-k="${ax}-${f.faixa}" style="width:120px;text-align:right">` },
          { t: 'Alíquota nominal', num: true, r: (f) => `<input type="number" step="0.0001" value="${f.aliquota_nominal}" data-f="al" data-k="${ax}-${f.faixa}" style="width:96px;text-align:right">` },
          { t: 'Parcela a deduzir', num: true, r: (f) => `<input type="number" step="10" value="${f.parcela_deduzir}" data-f="pd" data-k="${ax}-${f.faixa}" style="width:110px;text-align:right">` },
          { t: 'Rep. COFINS', num: true, r: (f) => `<input type="number" step="0.0001" value="${f.rep_cofins}" data-f="rc" data-k="${ax}-${f.faixa}" style="width:88px;text-align:right">` },
          { t: 'Rep. PIS', num: true, r: (f) => `<input type="number" step="0.0001" value="${f.rep_pis}" data-f="rp" data-k="${ax}-${f.faixa}" style="width:88px;text-align:right">` },
          { t: 'Rep. ICMS/ISS', num: true, r: (f) => `<input type="number" step="0.001" value="${f.rep_icms_iss}" data-f="ri" data-k="${ax}-${f.faixa}" style="width:96px;text-align:right">` },
          { t: '', r: (f) => `<button class="btn pq" data-ss="${ax}-${f.faixa}">Salvar</button>` },
        ], faixas)}</div>`;
    }).join('')}`;
  box.querySelectorAll('[data-ss]').forEach((b) => { b.onclick = () => {
    const k = b.dataset.ss; const [ax, fx] = k.split('-');
    const v = (f) => box.querySelector(`[data-f="${f}"][data-k="${k}"]`).value;
    salvar(`/config/simples/${ax}/${fx}`, { limite: v('lim'), aliquota_nominal: v('al'),
      parcela_deduzir: v('pd'), rep_cofins: v('rc'), rep_pis: v('rp'), rep_icms_iss: v('ri') },
      `Anexo ${ax}, faixa ${fx} atualizada`);
  }; });
}

// -------------------------------------------------------------------- CFOP
function cfop(box, d) {
  const naturezas = ['venda', 'aquisicao', 'devolucao', 'remessa', 'transferencia',
    'exportacao', 'importacao', 'ativo_consumo'];
  const porPrioridade = [1, 2, 3].map((p) => d.cfop.filter((c) => (c.prioridade || 2) === p));
  const rotulo = ['1 — primeiro dígito (avaliado primeiro)', '2 — grupo de três dígitos', '3 — sentido geral'];
  box.innerHTML = `<div class="aviso"><b>A ordem de avaliação importa</b>
      O primeiro dígito do CFOP indica operação com o exterior e precisa ser avaliado antes dos grupos:
      5102 é venda interna, 3102 é importação — os três últimos dígitos são iguais. Por isso cada regra
      tem uma prioridade.</div>
    ${porPrioridade.map((lista, i) => lista.length ? `<div class="cartao">
      <h2>Prioridade ${rotulo[i]}</h2>
      ${A.tabela([
        { t: 'Prefixo', r: (c) => `<span class="mono">${A.esc(c.prefixo || '—')}</span>` },
        { t: 'Grupo', r: (c) => `<span class="mono">${A.esc(c.grupo || '—')}</span>` },
        { t: 'Natureza da operação', r: (c) => `<select data-f="nat" data-i="${c.id}">
            ${naturezas.map((n) => `<option value="${n}" ${c.natureza === n ? 'selected' : ''}>${n}</option>`).join('')}</select>` },
        { t: 'Descrição', r: (c) => `<span class="mini">${A.esc(c.descricao || '')}</span>` },
        { t: '', r: (c) => `<button class="btn pq" data-sc="${c.id}">Salvar</button>` },
      ], lista)}</div>` : '').join('')}
    <div class="cartao"><h2>Testar um CFOP</h2>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <label class="campo" style="margin:0"><span>CFOP</span>
          <input type="text" id="testeCfop" placeholder="5102" style="width:120px"></label>
        <button class="btn vazio" id="btnCfop">Ver natureza</button>
        <div id="resCfop" style="align-self:center"></div>
      </div>
    </div>`;
  box.querySelectorAll('[data-sc]').forEach((b) => { b.onclick = () => {
    const id = b.dataset.sc;
    const c = d.cfop.find((x) => String(x.id) === id);
    salvar(`/config/cfop/${id}`, { natureza: box.querySelector(`[data-f="nat"][data-i="${id}"]`).value, descricao: c.descricao });
  }; });
  document.getElementById('btnCfop').onclick = () => {
    const c = String(document.getElementById('testeCfop').value || '').replace(/\D/g, '');
    if (c.length !== 4) { document.getElementById('resCfop').innerHTML = '<span class="tag a">informe 4 dígitos</span>'; return; }
    const grupo = c.slice(1);
    let achou = null;
    for (const p of [1, 2, 3]) {
      achou = d.cfop.find((l) => (l.prioridade || 2) === p &&
        ((l.grupo && l.grupo === grupo) || (l.prefixo && !l.grupo && c.startsWith(l.prefixo))));
      if (achou) break;
    }
    document.getElementById('resCfop').innerHTML = achou
      ? `<span class="tag c">${A.esc(achou.natureza)}</span> <span class="mini">por ${achou.grupo ? 'grupo ' + achou.grupo : 'prefixo ' + achou.prefixo}</span>`
      : '<span class="tag b">sem regra cadastrada</span>';
  };
}

// -------------------------------------------------------- LIMIARES E PADRÕES
function limiares(box, d) {
  const tabela = (lista, grupo) => A.tabela([
    { t: 'Regra', r: (r) => `<b>${A.esc(r.label || r.chave)}</b><div class="mini">${A.esc(r.descricao || '')}</div>` },
    { t: 'Valor', num: true, r: (r) => `<input type="number" step="0.0001" value="${r.valor}" data-f="v" data-k="${grupo}|${r.chave}" style="width:110px;text-align:right">` },
    { t: 'Unidade', r: (r) => `<span class="mini">${A.esc(r.unidade || '')}</span>` },
    { t: 'Chave', r: (r) => `<span class="mono mini">${A.esc(r.chave)}</span>` },
    { t: '', r: (r) => `<button class="btn pq" data-sl="${grupo}|${r.chave}">Salvar</button>` },
  ], lista);

  box.innerHTML = `<div class="cartao"><h2>Limiares de leitura</h2>
      <p class="desc">Definem quando o sistema classifica um resultado como alto, médio ou baixo. Não alteram o cálculo do tributo — alteram o julgamento sobre ele.</p>
      ${tabela(d.limiares, 'limiares')}</div>
    <div class="cartao"><h2>Padrões de estimativa</h2>
      <p class="desc">Usados apenas quando o documento não traz o valor. Todo resultado derivado de estimativa é marcado como tal nos relatórios.</p>
      ${tabela(d.padroes, 'padroes')}</div>
    <div class="cartao"><h2>Capacitação</h2><p class="desc">Valor sugerido ao programar novas turmas. O limite de uma turma já criada continua podendo ser ajustado individualmente.</p>${tabela(d.capacitacao || [], 'capacitacao')}</div>`;

  box.querySelectorAll('[data-sl]').forEach((b) => { b.onclick = () => {
    const [grupo, chave] = b.dataset.sl.split('|');
    salvar(`/config/regras/${grupo}/${chave}`,
      { valor: box.querySelector(`[data-f="v"][data-k="${grupo}|${chave}"]`).value });
  }; });
}

// ------------------------------------------------------------------ ENSAIO
function ensaio(box) {
  box.innerHTML = `<div class="aviso"><b>Confira a regra antes de confiar nela</b>
      Informe uma operação qualquer e veja exatamente como a volta à base econômica acontece com as
      regras atualmente configuradas — tributo a tributo, com a forma de cálculo de cada um.</div>
    <div class="grade g2">
      <div class="cartao"><h2>Operação de ensaio</h2>
        <div class="grade g2">
          ${A.campo('valor', 'Valor da operação', 60000, 'number', 'step=0.01')}
          ${A.selecao('tipo', 'Natureza', [{ v: 'mercadoria', t: 'Mercadoria' }, { v: 'servico', t: 'Serviço' }], 'mercadoria')}
        </div>
        ${A.selecao('regime', 'Regime do emitente', A.opcoesRegime(), 'lucro_real')}
        <div class="grade g3">
          ${A.campo('icms', 'ICMS', 10800, 'number', 'step=0.01')}
          ${A.campo('pis', 'PIS', 990, 'number', 'step=0.01')}
          ${A.campo('cofins', 'COFINS', 4560, 'number', 'step=0.01')}
        </div>
        <div class="grade g3">
          ${A.campo('ipi', 'IPI', 3000, 'number', 'step=0.01')}
          ${A.campo('iss', 'ISS', 0, 'number', 'step=0.01')}
          ${A.campo('icms_st', 'ICMS-ST', 0, 'number', 'step=0.01')}
        </div>
        <button class="btn ouro" id="rodarEnsaio" style="width:100%">Reconstruir a base</button>
      </div>
      <div id="resEnsaio"></div>
    </div>`;

  const rodar = async () => {
    const o = {};
    box.querySelectorAll('[name]').forEach((i) => { o[i.name] = i.type === 'number' ? Number(i.value) : i.value; });
    try {
      const { reconstrucao: r } = await A.api('/config/simular', { metodo: 'POST', corpo: o });
      document.getElementById('resEnsaio').innerHTML = `<div class="cartao">
        <h2>Resultado com as regras atuais</h2>
        <p class="desc">Status da reconstrução: <span class="tag ${r.status === 'reconstruida' ? 'c' : 'b'}">${A.esc(r.status)}</span></p>
        <div class="mono mini" style="background:#f4f7f9;padding:10px;border-radius:6px;margin-bottom:12px">${A.esc(r.formula)}</div>
        ${A.tabela([
          { t: 'Tributo', r: (p) => p.tributo },
          { t: 'Forma', r: (p) => `<span class="tag ${p.forma === 'por fora' ? 'b' : 'n'}">${p.forma}</span>` },
          { t: 'Origem', r: (p) => `<span class="mini">${A.esc(p.origem)}</span>` },
          { t: 'Valor', num: true, r: (p) => A.moeda(p.valor) },
        ], r.passos)}
        <table style="margin-top:12px">
          <tr><td>Preço da operação</td><td class="num mono">${A.moeda(r.precoAtual)}</td></tr>
          <tr><td>(−) Tributos que saem da base</td><td class="num mono">${A.moeda(r.retiradosDaBase)}</td></tr>
          <tr><td>Tributos por fora (permanecem)</td><td class="num mono">${A.moeda(r.foraDaBase)}</td></tr>
          <tr style="background:var(--ouro-100)"><td><b>= Base econômica</b></td><td class="num mono"><b>${A.moeda(r.baseEconomica)}</b></td></tr>
          <tr><td>Carga atual sobre o preço</td><td class="num mono">${A.pct(r.cargaAtual)}</td></tr>
        </table>
        ${(r.pendencias || []).map((p) => `<div class="aviso atencao">${A.esc(p)}</div>`).join('')}
      </div>`;
    } catch (e) { A.toast(e.message, 'erro'); }
  };
  document.getElementById('rodarEnsaio').onclick = rodar;
  rodar();
}

// --------------------------------------------------------------- HISTÓRICO
function historico(box, d) {
  box.innerHTML = `<div class="cartao"><h2>Alterações de regra</h2>
    <p class="desc">Toda mudança fica registrada. É o que permite explicar, meses depois, por que um número mudou entre duas versões do diagnóstico.</p>
    ${A.tabela([
      { t: 'Quando', r: (h) => `<span class="mono mini">${A.esc(h.criado_em)}</span>` },
      { t: 'Grupo', r: (h) => `<span class="tag">${A.esc(h.grupo)}</span>` },
      { t: 'Regra', r: (h) => `<span class="mono mini">${A.esc(h.chave)}</span>` },
      { t: 'De', r: (h) => `<span class="mono mini">${A.esc(h.valor_anterior || '—')}</span>` },
      { t: 'Para', r: (h) => `<span class="mono mini"><b>${A.esc(h.valor_novo || '—')}</b></span>` },
      { t: 'Usuário', r: (h) => `<span class="mini">${A.esc(h.usuario || 'sistema')}</span>` },
    ], d.historico, { vazio: 'Nenhuma regra foi alterada — o sistema está com os valores de fábrica.' })}
  </div>`;
}
})();
