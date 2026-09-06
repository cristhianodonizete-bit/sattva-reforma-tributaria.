/* =========================================================================
   NÚCLEO — estado, navegação, chamadas à API e componentes reutilizáveis
   ========================================================================= */
const App = (() => {
  const S = { empresas: [], empresaId: null, empresa: null, params: null, tela: 'painel', aba: {}, cache: {} };

  // ---------- API ----------
  async function api(caminho, opcoes = {}) {
    const token = localStorage.getItem('sattva_token');
    const headers = opcoes.corpo instanceof FormData ? {} : { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch('/api' + caminho, {
      method: opcoes.metodo || 'GET',
      headers,
      body: opcoes.corpo instanceof FormData ? opcoes.corpo : (opcoes.corpo ? JSON.stringify(opcoes.corpo) : undefined),
    });
    const j = await r.json().catch(() => ({ ok: false, erro: 'Resposta inválida do servidor.' }));
    if (r.status === 401) {
      localStorage.removeItem('sattva_token');
      if (!String(location.hash || '').includes('access_token=')) {
        location.hash = '';
        setTimeout(() => location.reload(), 20);
      }
      throw new Error('Sua sessão expirou. Entre novamente para continuar.');
    }
    if (!j.ok) throw new Error(j.erro || 'Falha na requisição.');
    return j;
  }

  // Downloads protegidos não podem usar window.open: a nova aba não recebe o
  // bearer token da sessão. Esta função baixa o arquivo pela sessão ativa.
  async function baixarArquivo(caminho, nomePadrao = 'modelo.xlsx') {
    const token = localStorage.getItem('sattva_token');
    const r = await fetch('/api' + caminho, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!r.ok) {
      const erro = await r.json().catch(() => ({}));
      throw new Error(erro.erro || 'Não foi possível baixar o arquivo.');
    }
    const cabecalho = r.headers.get('content-disposition') || '';
    const nome = cabecalho.match(/filename[^;=\n]*=(?:UTF-8''|\")?([^;\n\"]+)/i)?.[1] || nomePadrao;
    const url = URL.createObjectURL(await r.blob());
    const link = document.createElement('a'); link.href = url; link.download = decodeURIComponent(nome.trim());
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- FORMATAÇÃO ----------
  const moeda = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const num = (n, d = 2) => (Number(n) || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const pct = (n, d = 2) => `${((Number(n) || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d })}%`;
  const sinal = (n) => (Number(n) > 0 ? 'sobe' : Number(n) < 0 ? 'desce' : 'neutro');
  const setaPct = (n, d = 2) => `<span class="${sinal(n)} mono">${Number(n) > 0 ? '+' : ''}${pct(n, d)}</span>`;
  const setaR$ = (n) => `<span class="${sinal(n)} mono">${Number(n) > 0 ? '+' : ''}${moeda(n)}</span>`;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cnpjFmt = (c) => { const d = String(c || '').replace(/\D/g, ''); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : (c || ''); };
  const regimeLabel = (k) => { const r = (S.params?.regimes || []).find((x) => x.chave === k); return r ? r.label : (k || '—'); };

  function toast(msg, tipo = '') {
    const d = document.createElement('div');
    d.className = 'aviso-toast ' + tipo; d.textContent = msg;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 4200);
  }

  // ---------- MODAL ----------
  function modal({ titulo, descricao, corpo, confirmar = 'Salvar', aoConfirmar, aoAbrir, largura, podeFechar = () => true }) {
    const fundo = document.createElement('div');
    fundo.className = 'modal-fundo';
    fundo.innerHTML = `<div class="modal" ${largura ? `style="max-width:${largura}px"` : ''}>
      <h3>${esc(titulo)}</h3>${descricao ? `<p class="desc">${descricao}</p>` : ''}
      <div class="modal-corpo">${corpo}</div>
      <div class="modal-rodape">
        <button class="btn vazio" data-x>Cancelar</button>
        ${aoConfirmar ? `<button class="btn" data-ok>${esc(confirmar)}</button>` : ''}
      </div></div>`;
    document.getElementById('modais').appendChild(fundo);
    let esc2;
    const fechar = () => { fundo.remove(); document.removeEventListener('keydown', esc2); };
    const tentarFechar = () => {
      const permitido = podeFechar();
      if (permitido !== false) fechar();
    };
    fundo.querySelector('[data-x]').onclick = tentarFechar;
    fundo.onclick = (e) => { if (e.target === fundo) tentarFechar(); };
    esc2 = (e) => { if (e.key === 'Escape') tentarFechar(); };
    document.addEventListener('keydown', esc2);
    const okBtn = fundo.querySelector('[data-ok]');
    if (okBtn) okBtn.onclick = async () => {
      const dados = {};
      fundo.querySelectorAll('[name]').forEach((el) => {
        dados[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      });
      try { okBtn.disabled = true; const r = await aoConfirmar(dados, fundo); if (r !== false) fechar(); }
      catch (e) { toast(e.message, 'erro'); } finally { okBtn.disabled = false; }
    };
    if (typeof aoAbrir === 'function') aoAbrir(fundo);
    return { fundo, fechar };
  }

  function confirmar(texto, aoSim) {
    modal({ titulo: 'Confirmar', corpo: `<p>${esc(texto)}</p>`, confirmar: 'Confirmar', largura: 460, aoConfirmar: aoSim });
  }

  // ---------- CAMPOS ----------
  const campo = (nome, rotulo, valor = '', tipo = 'text', extra = '') =>
    `<label class="campo"><span>${rotulo}</span><input type="${tipo}" name="${nome}" value="${esc(valor)}" ${extra}></label>`;
  const area = (nome, rotulo, valor = '', linhas = 3) =>
    `<label class="campo"><span>${rotulo}</span><textarea name="${nome}" rows="${linhas}">${esc(valor)}</textarea></label>`;
  const selecao = (nome, rotulo, opcoes, valor) =>
    `<label class="campo"><span>${rotulo}</span><select name="${nome}">${opcoes.map((o) =>
      `<option value="${esc(o.v)}" ${String(o.v) === String(valor) ? 'selected' : ''}>${esc(o.t)}</option>`).join('')}</select></label>`;
  const opcoesRegime = () => (S.params?.regimes || []).map((r) => ({ v: r.chave, t: r.label }));
  const opcoesReducao = () => (S.params?.reducoes || []).map((r) => ({ v: r.chave, t: r.label }));
  const opcoesAno = () => (S.params?.anos || []).map((a) => ({ v: a, t: String(a) }));

  const kpi = (rot, val, pe = '', classe = '') =>
    `<div class="kpi ${classe}"><div class="rot">${rot}</div><div class="val">${val}</div>${pe ? `<div class="pe">${pe}</div>` : ''}</div>`;

  const avisos = (lista) => (lista || []).map((a) => `<div class="aviso ${a.nivel || ''}">
      ${a.titulo ? `<b>${esc(a.titulo)}</b>` : ''}${esc(a.texto)}
      ${a.acao ? `<div class="acao">${esc(a.acao)}</div>` : ''}</div>`).join('');

  const vazio = (titulo, texto, botao) => `<div class="vazio-estado"><h3>${esc(titulo)}</h3><p>${esc(texto)}</p>${botao || ''}</div>`;

  // ---------- RÉGUA DA TRANSIÇÃO (elemento-assinatura) ----------
  function regua(anoSel, aoTrocar) {
    const cron = S.params.cronograma;
    const anos = S.params.anos;
    const maxCarga = Math.max(...anos.map((a) => cron[a].cbs + cron[a].ibs + (cron[a].fatorIcmsIss * 0.21) + (cron[a].fatorPisCofins * 0.0925)));
    const html = `<div class="regua">
      <div class="rot">Régua da transição · 2026 → 2033</div>
      <div class="regua-trilho">
        ${anos.map((a) => {
          const c = cron[a];
          const velho = (c.fatorIcmsIss * 0.21 + c.fatorPisCofins * 0.0925 + c.fatorIpi * 0.02);
          const novo = c.compensavel ? 0.002 : (c.cbs + c.ibs);
          const alt = (v) => Math.max(2, Math.round((v / maxCarga) * 70));
          return `<div class="regua-ano ${a === anoSel ? 'sel' : ''}" data-ano="${a}" title="${esc(c.nota)}">
            <div class="regua-barra" style="height:${alt(velho) + alt(novo)}px">
              <div class="barra-velho" style="height:${alt(velho)}px"></div>
              <div class="barra-iva" style="height:${alt(novo)}px"></div>
            </div><div class="ano">${a}</div></div>`;
        }).join('')}
      </div>
      <div class="regua-legenda">
        <span><i class="barra-iva" style="background:var(--ouro)"></i>IBS + CBS</span>
        <span><i style="background:#3d6a86"></i>ICMS · ISS · PIS/COFINS · IPI</span>
        <span>Alíquota de referência: CBS ${pct(S.params.aliquotaReferencia.cbs)} · IBS ${pct(S.params.aliquotaReferencia.ibs)}</span>
      </div>
      <div class="regua-nota" id="reguaNota">${esc(cron[anoSel] ? cron[anoSel].nota : '')}</div>
    </div>`;
    setTimeout(() => {
      document.querySelectorAll('.regua-ano').forEach((el) => {
        el.onclick = () => { if (aoTrocar) aoTrocar(Number(el.dataset.ano)); };
      });
    }, 0);
    return html;
  }

  // ---------- TABELA ----------
  function tabela(colunas, linhas, opcoes = {}) {
    if (!linhas.length) return `<div class="vazio-estado"><p>${esc(opcoes.vazio || 'Nenhum registro.')}</p></div>`;
    return `<div class="tabela-rolagem"><table><thead><tr>${colunas.map((c) =>
      `<th class="${c.num ? 'num' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>
      ${linhas.map((l) => `<tr>${colunas.map((c) =>
        `<td class="${c.num ? 'num' : ''}">${c.r(l)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---------- NAVEGAÇÃO ----------
  const MENU = [
    { id: 'visao-geral', titulo: 'Visão geral', itens: [
      { id: 'painel', t: 'Painel do projeto', i: '◈' },
      { id: 'dashboardOperacao', t: 'Dashboard operacional', i: '◷' },
      { id: 'gestaoProjetos', t: 'Escopos e entregas', i: '▣' },
    ] },
    { id: 'planejamento', titulo: 'Planejamento tributário', itens: [
      { id: 'planejamento', t: 'Análises e regimes', i: '◫' },
    ] },
    { id: 'dados', titulo: 'Central de Dados', itens: [
      { tipo: 'titulo', t: 'Importações' },
      { id: 'dados', t: 'Documentos fiscais', i: '⇧', centralGrupo: 'documentos' },
      { id: 'dados', t: 'Folha', i: '⇧', centralGrupo: 'folha' },
      { id: 'dados', t: 'Outras receitas', i: '⇧', centralGrupo: 'receitas' },
      { id: 'dados', t: 'Apurações', i: '⇧', centralGrupo: 'apuracoes' },
      { id: 'dados', t: 'Margem operacional', i: '⇧', centralGrupo: 'margem' },
      { tipo: 'titulo', t: 'Cadastros' },
      { id: 'empresas', t: 'Empresas e estabelecimentos', i: '▦' },
      { id: 'cadastrosCnpj', t: 'Cadastros compartilhados', i: '⌘' },
      { tipo: 'titulo', t: 'Bases e classificações' },
      { id: 'bases', t: 'Bases, catálogos e classificações', i: '⌘' },
    ] },
    { id: 'motor', titulo: 'Motor tributário', itens: [
      { id: 'coberturaDiagnostico', t: 'Cobertura do diagnóstico', i: '◌' },
      { id: 'classificacaoFiscalComplementar', t: 'Classificação fiscal complementar', i: '✓' },
    ] },
    { id: 'diagnostico', titulo: 'Módulo 1 · Diagnóstico', itens: [
      { id: 'perfil', t: 'Perfil Tributário', i: '◉' }, { id: 'fornecedores', t: 'Cadeia de fornecedores', i: '↙' },
      { id: 'clientes', t: 'Cadeia de clientes', i: '↗' }, { id: 'impactoFinalCbs', t: 'Impacto Final CBS', i: '≋' }, { id: 'cenarios', t: 'Projeção de cenários', i: '⌁' },
      { id: 'calculadora', t: 'Calculadora da reforma', i: '∑' }, { id: 'conformidadeDocumental', t: 'Conformidade documental', i: '▤' }, { id: 'pendenciasDiagnostico', t: 'Pendências do diagnóstico', i: '!' }, { id: 'tarefasDiagnostico', t: 'Tarefas', i: '✓' },
    ] },
    { id: 'precificacao', titulo: 'Módulo 2 · Precificação', itens: [
      { id: 'precificacao', t: 'Precificação e margem', i: '◫' }, { id: 'formacaoCusto', t: 'Base de formação de custo', i: '⊕' }, { id: 'tarefasPrecificacao', t: 'Tarefas', i: '✓' },
    ] },
    { id: 'contratos', titulo: 'Módulo 3 · Contratos', itens: [
      { id: 'contratos', t: 'Revisão de contratos', i: '▤' }, { id: 'analise', t: 'Análise de contrato (IA)', i: '✦' }, { id: 'tarefasContratos', t: 'Tarefas', i: '✓' },
    ] },
    { id: 'capacitacao', titulo: 'Módulo 4 · Capacitação', itens: [
      { id: 'capacitacao', t: 'Capacitação do time', i: '◌' }, { id: 'tarefasCapacitacao', t: 'Tarefas', i: '✓' },
    ] },
    { id: 'acompanhamento', titulo: 'Módulo 5 · Acompanhamento', itens: [
      { id: 'acompanhamento', t: 'Baseline e realizado', i: '◷' },
    ] },
    { id: 'empresa-operacao', titulo: 'Gestão da empresa', itens: [
      { id: 'servicos', t: 'Escopo contratado', i: '⊞' },
      { id: 'plano', t: 'Plano de adequação', i: '✓' },
    ] },
    { id: 'gestao', titulo: 'Gestão do produto', itens: [
      { tipo: 'titulo', t: 'Escopos e combos' },
      { id: 'servicosCatalogo', t: 'Serviços e combos', i: '⊞' }, { id: 'configComercial', t: 'Configurar combos', i: '⚙' },
      { tipo: 'titulo', t: 'Conhecimento e integrações' },
      { id: 'conhecimento', t: 'Base de conhecimento', i: '◰' }, { id: 'questor', t: 'Integração Questor', i: '↔' },
      { tipo: 'titulo', t: 'Configuração técnica' },
      { id: 'configuracoes', t: 'Regras e parâmetros do motor', i: '⚙' },
      { id: 'controleProjeto', t: 'Controle operacional da carteira', i: '◌' },
      { id: 'acessos', t: 'Usuários e acessos', i: '♙' },
    ] },
  ];
  const TELAS_MENU = MENU.flatMap((grupo) => grupo.itens.filter((item) => item.id));
  const PERMISSAO_TELA = {
    painel: 'visao_geral', empresas: 'visao_geral', dashboardOperacao: 'visao_geral',
    dados: 'diagnostico', bases: 'diagnostico', coberturaDiagnostico: 'diagnostico', classificacaoFiscalComplementar: 'diagnostico', pendenciasDiagnostico: 'diagnostico', conformidadeDocumental: 'diagnostico', perfil: 'diagnostico', fornecedores: 'diagnostico', clientes: 'diagnostico', impactoFinalCbs: 'diagnostico', cenarios: 'diagnostico', calculadora: 'diagnostico', plano: 'diagnostico', tarefasDiagnostico: 'diagnostico',
    precificacao: 'precificacao', formacaoCusto: 'precificacao', tarefasPrecificacao: 'precificacao', contratos: 'contratos', analise: 'contratos', tarefasContratos: 'contratos', capacitacao: 'capacitacao', tarefasCapacitacao: 'capacitacao', acompanhamento: 'gestao_projetos',
    planejamento: 'gestao_projetos',
    servicos: 'gestao_projetos', servicosCatalogo: 'gestao_projetos', gestaoProjetos: 'visao_geral', configComercial: 'configuracoes', cadastrosCnpj: 'configuracoes', conhecimento: 'configuracoes', atualizacoesReforma: 'visao_geral', documentacaoSistema: 'visao_geral', configuracoes: 'configuracoes', controleProjeto: 'gestao_projetos', questor: 'configuracoes', acessos: 'acessos',
  };
  const pode = (tela, acao = 'ver') => {
    const permissoes = S.usuario?.permissoes;
    if (!S.usuario || !permissoes) return true; // compatibilidade até todos os usuários receberem um perfil
    return Boolean(permissoes[PERMISSAO_TELA[tela] || tela]?.[acao]);
  };
  const TAREFAS_POR_TELA = {
    tarefasDiagnostico: ['diagnostico', 'Diagnóstico'], tarefasPrecificacao: ['precificacao', 'Precificação'],
    tarefasContratos: ['contratos', 'Contratos'], tarefasCapacitacao: ['capacitacao', 'Capacitação'],
  };

  async function telaTarefasModulo(el, chave, titulo) {
    el.innerHTML = `<div class="topo"><div><div class="olho">GESTÃO DO MÓDULO</div><h1>Tarefas — ${esc(titulo)}</h1><p>Planeje, registre pendências do cliente e acompanhe a execução deste módulo.</p></div></div>`;
    const host = document.createElement('div'); host.className = 'tarefas-modulo-host'; el.appendChild(host);
    await tarefasModulo(host, chave, titulo);
  }

  function desenharMenu() {
    const menu = document.getElementById('menu');
    menu.innerHTML = MENU.map((grupo) => {
      const itens = grupo.itens.filter((item) => item.tipo === 'titulo' || pode(item.id));
      if (!itens.length) return '';
      const chave = `sattva_menu_grupo_${grupo.id}`;
      const aberto = localStorage.getItem(chave) === 'aberto';
      return `<section class="nav-grupo ${aberto ? 'aberto' : ''}" data-grupo="${grupo.id}">
        <button class="grupo-titulo" type="button" aria-expanded="${aberto}">${grupo.titulo}<span>${aberto ? '⌃' : '⌄'}</span></button>
        <div class="grupo-itens">${itens.map((item) => item.tipo === 'titulo'
          ? `<div class="menu-subtitulo">${item.t}</div>`
          : `<a data-tela="${item.id}" ${item.centralGrupo ? `data-central-grupo="${item.centralGrupo}"` : ''} title="${item.t}" class="${S.tela === item.id && (!item.centralGrupo || (S.aba.centralDados || 'documentos') === item.centralGrupo) ? 'ativo' : ''}"><i aria-hidden="true">${item.i}</i><span>${item.t}</span></a>`).join('')}</div>
      </section>`;
    }).join('') + (S.usuario ? `<section class="nav-grupo sessao aberto"><div class="grupo-titulo">${esc(S.usuario.nome || S.usuario.email)}</div><div class="grupo-itens"><a data-sair title="Sair"><i aria-hidden="true">↪</i><span>Sair</span></a></div></section>` : '');
    menu.querySelectorAll('[data-tela]').forEach((a) => { a.onclick = () => {
      if (a.dataset.centralGrupo) {
        S.aba.centralDados = a.dataset.centralGrupo;
        S.aba.dadosMotor = 'atual';
      }
      ir(a.dataset.tela);
    }; });
    const sair = menu.querySelector('[data-sair]');
    if (sair) sair.onclick = () => { localStorage.removeItem('sattva_token'); location.reload(); };
    menu.querySelectorAll('.grupo-titulo[type="button"]').forEach((botao) => {
      botao.onclick = () => {
        const bloco = botao.closest('.nav-grupo'); const aberto = bloco.classList.toggle('aberto');
        botao.setAttribute('aria-expanded', String(aberto)); botao.querySelector('span').textContent = aberto ? '⌃' : '⌄';
        localStorage.setItem(`sattva_menu_grupo_${bloco.dataset.grupo}`, aberto ? 'aberto' : 'fechado');
      };
    });
  }

  async function ir(tela) {
    if (!pode(tela)) { toast('Seu perfil não possui acesso a esta área.', 'erro'); return; }
    S.tela = tela;
    location.hash = tela;
    desenharMenu();
    const itemMenu = TELAS_MENU.find((item) => item.id === tela);
    const tituloContexto = document.getElementById('tituloContexto');
    if (tituloContexto) tituloContexto.textContent = itemMenu?.t || 'Visão geral';
    const alvo = document.getElementById('tela');
    alvo.innerHTML = '<div class="carregando">Carregando…</div>';
    try {
      const tarefasDaTela = TAREFAS_POR_TELA[tela];
      const fn = tarefasDaTela ? ((host) => telaTarefasModulo(host, ...tarefasDaTela)) : Telas[tela];
      if (!fn) { alvo.innerHTML = vazio('Tela não encontrada', 'Escolha uma opção no menu.'); return; }
      const semEmpresa = ['empresas', 'dashboardOperacao', 'planejamento', 'servicosCatalogo', 'gestaoProjetos', 'configComercial', 'cadastrosCnpj', 'conhecimento', 'atualizacoesReforma', 'documentacaoSistema', 'questor', 'bases', 'configuracoes', 'controleProjeto', 'acessos'];
      if (!semEmpresa.includes(tela) && !S.empresaId) {
        alvo.innerHTML = vazio('Selecione uma empresa', 'Este módulo trabalha sobre os dados de uma empresa. Cadastre ou selecione uma no topo do menu.',
          '<button class="btn" onclick="App.ir(\'empresas\')">Ir para empresas</button>');
        return;
      }
      // O catálogo é configurável, mas uma vez que o plano é aprovado só os
      // módulos presentes naquela fotografia ficam disponíveis ao projeto.
      const moduloPorTela = {
        dados: 'diagnostico', bases: 'diagnostico', coberturaDiagnostico: 'diagnostico', perfil: 'diagnostico', fornecedores: 'diagnostico',
        clientes: 'diagnostico', cenarios: 'diagnostico', calculadora: 'diagnostico', plano: 'diagnostico', tarefasDiagnostico: 'diagnostico',
        precificacao: 'precificacao', tarefasPrecificacao: 'precificacao', contratos: 'contratos', analise: 'contratos', tarefasContratos: 'contratos', capacitacao: 'capacitacao', tarefasCapacitacao: 'capacitacao',
      };
      if (S.empresaId && moduloPorTela[tela]) {
        const acesso = await api(`/empresas/${S.empresaId}/acesso`);
        const chave = moduloPorTela[tela];
        if (!acesso.aprovado || !acesso.telas[chave]) {
          alvo.innerHTML = vazio(!acesso.aprovado ? 'Plano ainda não aprovado' : 'Módulo não contratado',
            !acesso.aprovado
              ? 'Aprove o plano em “Escopo e entregas” para liberar o escopo e o acompanhamento.'
              : 'Este módulo não faz parte do plano aprovado para esta empresa.',
            '<button class="btn" onclick="App.ir(\'gestaoProjetos\')">Ver escopo e entregas</button>');
          return;
        }
      }
      await fn(alvo);
    } catch (e) {
      alvo.innerHTML = `<div class="aviso alto"><b>Não foi possível carregar</b>${esc(e.message)}</div>`;
    }
  }

  async function carregarEmpresas() {
    const { empresas } = await api('/empresas');
    S.empresas = empresas;
    const sel = document.getElementById('seletorEmpresa');
    const selHeader = document.getElementById('seletorEmpresaHeader');
    sel.innerHTML = empresas.length
      ? empresas.map((e) => `<option value="${e.id}">${esc(e.razao_social)}</option>`).join('')
      : '<option value="">— nenhuma empresa cadastrada —</option>';
    if (empresas.length) {
      const salva = Number(localStorage.getItem('sattva_empresa'));
      S.empresaId = empresas.some((e) => e.id === salva) ? salva : empresas[0].id;
      sel.value = S.empresaId;
      S.empresa = empresas.find((e) => e.id === S.empresaId);
    } else { S.empresaId = null; S.empresa = null; }
    const selecionarEmpresa = (valor) => {
      S.empresaId = Number(valor) || null;
      S.empresa = S.empresas.find((e) => e.id === S.empresaId) || null;
      localStorage.setItem('sattva_empresa', S.empresaId);
      // Os dois controles representam a mesma empresa em análise. Atualizá-
      // los antes da navegação impede que uma tela seja aberta com contexto
      // diferente daquele exibido no cabeçalho ou na lateral.
      sel.value = S.empresaId == null ? '' : String(S.empresaId);
      if (selHeader) selHeader.value = sel.value;
      ir(S.tela);
    };
    sel.onchange = () => selecionarEmpresa(sel.value);
    if (selHeader) {
      selHeader.innerHTML = sel.innerHTML;
      selHeader.value = sel.value;
      selHeader.onchange = () => selecionarEmpresa(selHeader.value);
    }
  }

  async function carregarParametros() {
    S.params = await api('/parametros');
    return S.params;
  }

  async function atualizarNotificacoesReforma() {
    const badge = document.getElementById('badgeAtualizacoes');
    if (!badge) return;
    try {
      const resposta = await api('/atualizacoes-reforma');
      const novas = (resposta.atualizacoes || resposta.itens || []).filter((x) => x.status === 'NOVA').length;
      badge.hidden = novas === 0; badge.textContent = String(novas);
    } catch (_) { badge.hidden = true; }
  }

  function configurarAcoesCabecalho() {
    document.getElementById('abrirAtualizacoes')?.addEventListener('click', () => ir('atualizacoesReforma'));
    const usuario = document.getElementById('usuarioHeader');
    const menu = document.getElementById('usuarioMenuItens');
    usuario?.addEventListener('click', () => { const aberto = menu?.hidden !== false; if (menu) menu.hidden = !aberto; usuario.setAttribute('aria-expanded', String(aberto)); });
    document.querySelector('[data-manual-header]')?.addEventListener('click', () => ir('documentacaoSistema'));
    document.querySelector('[data-redefinir-header]')?.addEventListener('click', () => modal({ titulo: 'Redefinir senha', descricao: 'Enviaremos um link seguro para o e-mail da sua conta.', corpo: `<p>${esc(S.usuario?.email || '')}</p>`, confirmar: 'Enviar link', aoConfirmar: async () => {
      const r = await fetch('/auth/esqueci-senha', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ email:S.usuario?.email || '' }) }); const j = await r.json(); if (!j.ok) throw new Error(j.erro || 'Não foi possível solicitar a redefinição.'); toast('Se o e-mail estiver cadastrado, você receberá o link de recuperação.', 'ok');
    } }));
    document.querySelector('[data-sair-header]')?.addEventListener('click', () => { localStorage.removeItem('sattva_token'); location.reload(); });
  }

  async function iniciar() {
    const parametrosHash = new URLSearchParams(String(location.hash || '').replace(/^#/, ''));
    const tokenRecuperacao = parametrosHash.get('access_token');
    if (tokenRecuperacao) { telaRedefinirSenha(tokenRecuperacao); return; }
    const status = await fetch('/auth/status').then((r) => r.json()).catch(() => ({ exigido: false }));
    if (status.exigido) {
      const token = localStorage.getItem('sattva_token');
      const sessao = token ? await fetch('/auth/me', { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null) : null;
      if (!sessao?.ok) { telaLogin(); return; }
      S.usuario = sessao.usuario;
    }
    const usuarioHeader = document.getElementById('usuarioHeader'); if (usuarioHeader) usuarioHeader.textContent = S.usuario ? `${S.usuario.nome || S.usuario.email} ▾` : '';
    configurarAcoesCabecalho();
    const toggle = document.getElementById('menuToggle'); if (toggle) toggle.onclick = () => document.body.classList.toggle('menu-colapsado');
    try {
      // Leituras independentes: não altera contexto da empresa, parâmetros ou
      // motor; somente elimina uma espera de rede antes da primeira tela.
      await Promise.all([carregarParametros(), carregarEmpresas(), atualizarNotificacoesReforma()]);
    } catch (e) { document.getElementById('tela').innerHTML = `<div class="aviso alto">Servidor indisponível: ${esc(e.message)}</div>`; return; }
    // A navegação começa recolhida a cada acesso; cada pessoa abre apenas a
    // área necessária para não transformar a lateral numa lista extensa.
    MENU.forEach((grupo) => localStorage.removeItem(`sattva_menu_grupo_${grupo.id}`));
    const toggleMenu = document.getElementById('menuToggle');
    if (localStorage.getItem('sattva_menu_colapsado') === 'sim') document.body.classList.add('menu-colapsado');
    if (toggleMenu) toggleMenu.onclick = () => { const ativo = document.body.classList.toggle('menu-colapsado'); localStorage.setItem('sattva_menu_colapsado', ativo ? 'sim' : 'nao'); };
    const inicial = (location.hash || '').replace('#', '') || 'dashboardOperacao';
    ir(TELAS_MENU.some((m) => m.id === inicial) ? inicial : 'dashboardOperacao');
  }

  function telaLogin() {
    document.body.classList.add('auth-mode');
    document.getElementById('tela').innerHTML = `<div class="auth-layout"><section class="auth-brand"><img src="img/logo_sattva.jpg" alt="Sattva"><span>IMPLEMENTAÇÃO DA REFORMA TRIBUTÁRIA</span><h1>Clareza tributária para proteger a margem.</h1><p>Diagnóstico, adequação e inteligência para decisões seguras.</p><div class="auth-chips"><b>Diagnóstico</b><b>Precificação</b><b>Contratos</b><b>Capacitação</b><b>Acompanhamento</b></div></section><section class="auth-form"><div class="auth-card"><div class="olho">Acesso seguro</div><h1>Bem-vindo</h1><p class="desc">Acesse sua conta para continuar.</p><form id="formLogin"><label class="campo"><span>E-mail</span><input name="email" type="email" required autofocus></label><label class="campo"><span>Senha</span><input name="senha" type="password" required></label><button class="btn ouro" style="width:100%;margin-top:12px">Entrar</button><button type="button" class="link-recuperar" id="esqueciSenha">Esqueci minha senha</button><div id="erroLogin" class="mini" style="margin-top:12px"></div></form></div></section></div>`;
    document.getElementById('formLogin').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const erro = document.getElementById('erroLogin'); erro.textContent = 'Entrando…';
      try { const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), senha: f.get('senha') }) }); const j = await r.json(); if (!j.ok) throw new Error(j.erro); localStorage.setItem('sattva_token', j.sessao.access_token); location.reload(); }
      catch (x) { erro.textContent = x.message || 'Não foi possível entrar.'; }
    };
    document.getElementById('esqueciSenha').onclick = () => modal({ titulo: 'Recuperar senha', descricao: 'Informe seu e-mail para receber o link seguro de redefinição.', corpo: campo('email', 'E-mail', '', 'email'), confirmar: 'Enviar link', aoConfirmar: async (f) => { const r = await fetch('/auth/esqueci-senha', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(f) }); const j = await r.json(); if(!j.ok) throw new Error(j.erro); toast('Se o e-mail estiver cadastrado, você receberá o link de recuperação.', 'ok'); } });
  }

  function telaRedefinirSenha(token) {
    document.getElementById('tela').innerHTML = `<div style="max-width:440px;margin:80px auto" class="cartao"><div class="olho">Recuperação de acesso</div><h1>Definir nova senha</h1><p class="desc">Escolha uma senha com pelo menos 8 caracteres.</p>
      <form id="formRedefinir"><label class="campo"><span>Nome de exibição</span><input name="nome" required autofocus></label><label class="campo"><span>Nova senha</span><input name="senha" type="password" minlength="8" required></label><label class="campo"><span>Confirmar senha</span><input name="confirmacao" type="password" minlength="8" required></label><button class="btn ouro" style="width:100%;margin-top:12px">Salvar acesso</button><div id="erroRedefinir" class="mini" style="margin-top:12px"></div></form></div>`;
    document.getElementById('formRedefinir').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const erro = document.getElementById('erroRedefinir');
      if (f.get('senha') !== f.get('confirmacao')) { erro.textContent = 'As senhas não coincidem.'; return; }
      erro.textContent = 'Salvando…';
      try { const r = await fetch('/auth/redefinir-senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nome: f.get('nome'), senha: f.get('senha') }) }); const j = await r.json(); if (!j.ok) throw new Error(j.erro); erro.textContent = 'Senha definida com sucesso. Redirecionando para o acesso…'; erro.style.color = 'var(--desce)'; setTimeout(() => { location.hash = ''; location.reload(); }, 900); }
      catch (x) { erro.textContent = x.message || 'Não foi possível redefinir a senha.'; }
    };
  }

  // ---------- UPLOAD ----------
  function dropzone(id, texto, aoEscolher) {
    setTimeout(() => {
      const z = document.getElementById(id);
      if (!z) return;
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = '.xlsx,.xls,.csv'; inp.style.display = 'none';
      z.appendChild(inp);
      z.onclick = () => inp.click();
      inp.onchange = () => { if (inp.files[0]) aoEscolher(inp.files[0]); inp.value = ''; };
      z.ondragover = (e) => { e.preventDefault(); z.classList.add('sobre'); };
      z.ondragleave = () => z.classList.remove('sobre');
      z.ondrop = (e) => { e.preventDefault(); z.classList.remove('sobre'); if (e.dataTransfer.files[0]) aoEscolher(e.dataTransfer.files[0]); };
    }, 0);
    return `<div class="dropzone" id="${id}">${texto}</div>`;
  }

  async function tarefasModulo(host, chave, tituloModulo) {
    if (!host || !S.empresaId) return;
    const area = ({ diagnostico: 'diagnostico', precificacao: 'precificacao', contratos: 'contratos', capacitacao: 'capacitacao' })[chave] || 'gestao_projetos';
    const podeExecutar = !S.usuario?.permissoes || Boolean(S.usuario.permissoes[area]?.executar);
    const carregar = async () => {
      let d;
      try { d = await api(`/empresas/${S.empresaId}/projeto/tarefas/${chave}`); }
      catch (e) {
        host.innerHTML = `<section class="cartao tarefas-modulo"><h2>Tarefas do módulo</h2><p class="desc">Não foi possível abrir as tarefas agora.</p><p class="mini">${esc(e.message || 'Atualize a página e tente novamente. Se o problema persistir, confira o escopo do projeto.')}</p></section>`;
        return;
      }
      const entregas = d.entregas || [];
      if (!entregas.length) {
        host.innerHTML = `<section class="cartao tarefas-modulo"><h2>Tarefas do módulo</h2><p class="desc">Este módulo ainda não está liberado no escopo aprovado desta empresa.</p><p class="mini">Acesse Escopo e entregas para incluir o módulo no projeto e aprovar a atualização.</p><button class="btn pq vazio" data-ver-escopo>Ver escopo e entregas</button></section>`;
        host.querySelector('[data-ver-escopo]')?.addEventListener('click', () => ir('gestaoProjetos'));
        return;
      }
      const tarefas = d.tarefas || [];
      const responsaveisDaEntrega = (entregaId, lado) => (d.responsaveis || []).find((r) => r.entrega_id === entregaId && r.lado === lado);
      const contatos = entregas.map((e) => {
        const sattva = responsaveisDaEntrega(e.id, 'sattva'), cliente = responsaveisDaEntrega(e.id, 'cliente');
        const pessoa = (r, rotulo) => r ? `<span><b>${rotulo}:</b> ${esc(r.nome)}${r.telefone ? ` · ${esc(r.telefone)}` : ''}${r.email ? ` · ${esc(r.email)}` : ''}</span>` : `<span><b>${rotulo}:</b> não definido</span>`;
        const assumir = !sattva || sattva.usuario_id !== S.usuario?.id;
        return `<div class="responsavel-modulo-item"><div>${entregas.length > 1 ? `<strong>${esc(e.titulo)}</strong>` : ''}${pessoa(sattva, 'Sattva')}${pessoa(cliente, 'Cliente')}</div>${podeExecutar ? `<div class="responsavel-acoes">${assumir ? `<button class="btn pq" data-atribuir-me="${e.id}">Atribuir para mim</button>` : '<span class="tag c">Você é responsável</span>'}<button class="btn pq vazio" data-responsaveis="${e.id}">Editar</button></div>` : ''}</div>`;
      }).join('');
      host.innerHTML = `<section class="cartao tarefas-modulo"><div class="cabecalho-lista"><div><h2>Tarefas do módulo</h2><p class="desc">Execução de ${esc(tituloModulo)}. As tarefas também aparecem consolidadas no Acompanhamento geral.</p></div>${podeExecutar ? '<button class="btn pq" data-nova-tarefa>Nova tarefa</button>' : `<span class="tag">${tarefas.length} tarefas</span>`}</div><div class="responsaveis-modulo"><div class="mini">RESPONSÁVEIS DO MÓDULO</div>${contatos}</div>${tarefas.length ? tabela([
        { t: 'Situação', r: (t) => `<span class="tag ${t.status === 'concluida' ? 'c' : t.status === 'em_andamento' ? 'b' : 'n'}">${esc(t.status.replace('_', ' '))}</span>` },
        { t: 'Tarefa', r: (t) => `<b>${esc(t.titulo)}</b>${entregas.length > 1 ? `<small class="mini">${esc(t.entrega_titulo || 'Capacitação')}</small>` : ''}${t.pendencia_cliente ? `<small class="mini pendencia-cliente">Pendência: ${esc(t.pendencia_cliente)}</small>` : ''}` },
        { t: 'Prazo', r: (t) => `<span class="mono mini">${esc(t.data_conclusao || '—')}</span>` },
        ...(podeExecutar ? [{ t: '', r: (t) => `<button class="btn pq vazio" data-editar-tarefa="${t.id}">Atualizar</button>` }] : []),
      ], tarefas, { vazio: 'Nenhuma tarefa neste módulo.' }) : vazio('Nenhuma tarefa neste módulo.', podeExecutar ? 'Registre a primeira atividade de execução.' : 'Acompanhe o andamento pelo painel geral.')}</section>`;
      const abrir = (tarefa = null) => modal({ titulo: tarefa ? `Tarefa — ${tarefa.titulo}` : `Nova tarefa — ${tituloModulo}`, largura: 720,
        corpo: `${!tarefa && entregas.length > 1 ? selecao('entrega_id', 'Entrega de capacitação', entregas.map((e) => ({ v: e.id, t: e.titulo })), '') : ''}${selecao('status', 'Situação', [{ v: 'aberta', t: 'Aberta' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluida', t: 'Concluída' }], tarefa?.status || 'aberta')}${selecao('tipo_pendencia', 'Classificação da pendência', [{ v: 'interna', t: 'Pendência interna' }, { v: 'cliente', t: 'Pendência com cliente' }], tarefa?.envolve_cliente ? 'cliente' : 'interna')}${campo('titulo', 'Título', tarefa?.titulo || '')}<div class="grade g2">${campo('data_abertura', 'Data de abertura', tarefa?.data_abertura || '', 'date')}${campo('data_conclusao', 'Previsão/conclusão', tarefa?.data_conclusao || '', 'date')}</div>${area('pendencia_cliente', 'Descrição da pendência', tarefa?.pendencia_cliente || '', 2)}${area('interacoes_cliente', 'Interações / histórico', tarefa?.interacoes_cliente || '', 2)}${area('descricao', 'Detalhamento da tarefa', tarefa?.descricao || '', 2)}`,
        aoConfirmar: async (form) => { await api(tarefa ? `/projeto/tarefas/${tarefa.id}` : `/empresas/${S.empresaId}/projeto/tarefas/${chave}`, { metodo: tarefa ? 'PUT' : 'POST', corpo: form }); await carregar(); } });
      host.querySelector('[data-nova-tarefa]')?.addEventListener('click', () => abrir());
      host.querySelectorAll('[data-editar-tarefa]').forEach((b) => b.addEventListener('click', () => abrir(tarefas.find((t) => t.id === Number(b.dataset.editarTarefa)))));
      host.querySelectorAll('[data-responsaveis]').forEach((b) => b.addEventListener('click', () => {
        const entrega = entregas.find((e) => e.id === Number(b.dataset.responsaveis));
        const sattva = responsaveisDaEntrega(entrega.id, 'sattva') || {}, cliente = responsaveisDaEntrega(entrega.id, 'cliente') || {};
        modal({ titulo: `Responsáveis — ${entrega.titulo}`, largura: 720,
          corpo: `<h3 class="subtitulo-modal">Responsável pela Sattva</h3><div class="grade g2">${campo('responsavel_sattva', 'Nome', sattva.nome || '')}${campo('funcao_sattva', 'Função / papel', sattva.funcao || '')}${campo('telefone_sattva', 'Telefone', sattva.telefone || '')}${campo('email_sattva', 'E-mail', sattva.email || '', 'email')}</div><h3 class="subtitulo-modal">Responsável pelo cliente</h3><div class="grade g2">${campo('responsavel_cliente', 'Nome', cliente.nome || '')}${campo('funcao_cliente', 'Função / área', cliente.funcao || '')}${campo('telefone_cliente', 'Telefone', cliente.telefone || '')}${campo('email_cliente', 'E-mail', cliente.email || '', 'email')}</div>`,
          aoConfirmar: async (form) => { await api(`/empresas/${S.empresaId}/projeto/responsaveis/${chave}`, { metodo: 'POST', corpo: { ...form, entrega_id: entrega.id } }); await carregar(); } });
      }));
      host.querySelectorAll('[data-atribuir-me]').forEach((b) => b.addEventListener('click', async () => {
        await api(`/empresas/${S.empresaId}/projeto/responsaveis/${chave}/atribuir-me`, { metodo: 'POST', corpo: { entrega_id: Number(b.dataset.atribuirMe) } });
        toast('Entrega atribuída a você.', 'ok'); await carregar();
      }));
    };
    await carregar();
  }

  return { S, api, ir, iniciar, carregarEmpresas, carregarParametros, moeda, num, pct, esc, cnpjFmt, sinal, setaPct, setaR$,
    toast, modal, confirmar, campo, area, selecao, opcoesRegime, opcoesReducao, opcoesAno, regimeLabel,
    kpi, avisos, vazio, regua, tabela, dropzone, tarefasModulo, baixarArquivo };
})();
