/* =========================================================================
   NÚCLEO — estado, navegação, chamadas à API e componentes reutilizáveis
   ========================================================================= */
const App = (() => {
  const S = { empresas: [], empresaId: null, empresa: null, params: null, tela: 'visaoCarteira', aba: {}, cache: {}, menuAbertos: new Set(), submenusAbertos: new Set() };
  const temaAtual = () => document.documentElement.classList.contains('tema-escuro') ? 'escuro' : 'claro';
  const aplicarTema = (tema) => {
    const escolhido = tema === 'escuro' ? 'escuro' : 'claro';
    document.documentElement.classList.toggle('tema-escuro', escolhido === 'escuro');
    document.body.classList.toggle('tema-escuro', escolhido === 'escuro');
    // A preferência é local ao navegador. Não altera empresa, parâmetros ou
    // qualquer dado fiscal; somente a apresentação do usuário.
    localStorage.setItem('sattva_tema', escolhido);
    if (S.usuario?.id) localStorage.setItem(`sattva_tema_${S.usuario.id}`, escolhido);
    document.querySelectorAll('[data-tema]').forEach((b) => {
      const ativo = b.dataset.tema === escolhido;
      b.classList.toggle('ativo', ativo);
      b.setAttribute('aria-pressed', String(ativo));
    });
  };

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

  // Ícones vetoriais pequenos, definidos pelo contexto do indicador. Eles
  // evitam emojis e bibliotecas externas, mantendo a mesma leitura visual em
  // todas as telas e também no ambiente sem acesso à internet.
  const iconeKpi = (rotulo = '') => {
    const chave = String(rotulo).toLowerCase();
    const svg = (corpo) => `<span class="kpi-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${corpo}</svg></span>`;
    if (/receita|faturamento|valor|preço|exposição|compras|base econ|margem/.test(chave)) return svg('<path d="M4 19h16"/><path d="M6 16V10"/><path d="M10 16V5"/><path d="M14 16v-7"/><path d="M18 16V8"/>');
    if (/pis|cofins|crédito|débito|carga|das|tribut/.test(chave)) return svg('<ellipse cx="12" cy="6" rx="6" ry="3"/><path d="M6 6v6c0 1.7 2.7 3 6 3s6-1.3 6-3V6"/><path d="M6 12v6c0 1.7 2.7 3 6 3s6-1.3 6-3v-6"/>');
    if (/alíquota|percentual|taxa|redução/.test(chave)) return svg('<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2"/><circle cx="17" cy="17" r="2"/>');
    if (/documento|xml|lançamento|item|importa/.test(chave)) return svg('<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v5h5"/><path d="M10 13h5M10 17h5"/>');
    if (/período|competência|prazo|tempo|data/.test(chave)) return svg('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>');
    if (/folha|pessoal|cliente|fornecedor|parceiro|empresa/.test(chave)) return svg('<circle cx="12" cy="8" r="3"/><path d="M5 20c.6-3.4 3-5 7-5s6.4 1.6 7 5"/>');
    if (/risco|pendência|atenção|valida/.test(chave)) return svg('<path d="M12 3 2.8 20h18.4z"/><path d="M12 9v4M12 17h.01"/>');
    if (/regime|classifica|catálogo|mapa/.test(chave)) return svg('<path d="m12 3 8 4.4-8 4.4-8-4.4z"/><path d="m4 12 8 4.4 8-4.4M4 16.5l8 4.5 8-4.5"/>');
    return svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12h8M12 8v8"/>');
  };
  const kpi = (rot, val, pe = '', classe = '') =>
    `<div class="kpi ${classe}">${iconeKpi(rot)}<div class="kpi-conteudo"><div class="rot">${rot}</div><div class="val">${val}</div>${pe ? `<div class="pe">${pe}</div>` : ''}</div></div>`;

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
    return `<div class="tabela-rolagem ${esc(opcoes.classe || '')}"><table><thead><tr>${colunas.map((c) =>
      `<th class="${c.num ? 'num' : ''}">${c.t}</th>`).join('')}</tr></thead><tbody>
      ${linhas.map((l) => `<tr>${colunas.map((c) =>
        `<td class="${c.num ? 'num' : ''}">${c.r(l)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`;
  }

  // ---------- NAVEGAÇÃO ----------
  const MENU = [
    { id: 'visao-geral', titulo: 'Visão geral', itens: [
      { id: 'visaoCarteira', t: 'Visão da carteira', i: '◈' },
      { id: 'dashboardOperacao', t: 'Projetos e responsáveis', i: '◷' },
      { id: 'painel', t: 'Painel do projeto', i: '◈' },
    ] },
    { id: 'dados', titulo: 'Central de Dados', itens: [
      { tipo: 'titulo', t: 'Controle da análise' },
      { id: 'dadosDashboard', t: 'Dashboard', i: '◈' },
      { id: 'periodoAnalisado', t: 'Período analisado', i: '◷' },
      { tipo: 'titulo', t: 'Importações' },
      { id: 'dados', t: 'Documentos fiscais', i: '⇧', centralGrupo: 'documentos' },
      { id: 'dados', t: 'Folha', i: '⇧', centralGrupo: 'folha' },
      { id: 'dados', t: 'Outras receitas', i: '⇧', centralGrupo: 'receitas' },
      { id: 'dados', t: 'Apurações', i: '⇧', centralGrupo: 'apuracoes' },
      { id: 'dados', t: 'Margem operacional', i: '⇧', centralGrupo: 'margem' },
      { tipo: 'titulo', t: 'Cadastros' },
      { id: 'empresas', t: 'Empresas e estabelecimentos', i: '▦' },
      { id: 'cadastrosCnpj', t: 'Cadastros compartilhados', i: '⌘' },
      { id: 'consultaBaseRegime', t: 'Consultar regime na base importada', i: '⌕' },
      { tipo: 'titulo', t: 'Bases e classificações' },
      { id: 'bases', t: 'Bases, catálogos e classificações', i: '⌘' },
    ] },
    { id: 'motor', titulo: 'Motor tributário', itens: [
      { id: 'executarMotor', t: 'Executar motor', i: '●' },
      { id: 'coberturaDiagnostico', t: 'Cobertura do diagnóstico', i: '◌' },
      { id: 'classificacaoFiscalComplementar', t: 'Classificação fiscal complementar', i: '✓' },
    ] },
    { id: 'diagnostico', titulo: 'Módulo 1 · Diagnóstico', itens: [
      { id: 'perfil', t: 'Perfil Tributário', i: '◉' }, { id: 'fornecedores', t: 'Cadeia de fornecedores', i: '↙' },
      { id: 'clientes', t: 'Cadeia de clientes', i: '↗' }, { id: 'impactoFinalCbs', t: 'Impacto Final CBS', i: '≋' }, { id: 'cenarios', t: 'Projeção de cenários', i: '⌁' },
      { id: 'mapaOperacional', t: 'Mapa operacional', i: '⌘' }, { id: 'calculadora', t: 'Calculadora da reforma', i: '∑' }, { id: 'conformidadeDocumental', t: 'Conformidade documental', i: '▤' }, { id: 'pendenciasDiagnostico', t: 'Pendências do diagnóstico', i: '!' }, { id: 'tarefasDiagnostico', t: 'Tarefas', i: '✓' },
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
    { id: 'planejamento', titulo: 'Módulo 5 · Planejamento tributário', itens: [
      { id: 'planejamento', t: 'Análises e regimes', i: '◫' },
    ] },
    { id: 'acompanhamento', titulo: 'Módulo 6 · Acompanhamento', itens: [
      { id: 'acompanhamento', t: 'Baseline e realizado', i: '◷' },
    ] },
    { id: 'entregavel-cliente', titulo: 'Módulo 7 · Entregável ao cliente', itens: [
      { id: 'entregavelCliente', t: 'Relatório executivo e conformidade', i: '▣' },
    ] },
    { id: 'empresa-operacao', titulo: 'Operação da carteira', itens: [
      { id: 'gestaoProjetos', t: 'Escopo, entregas e ações', i: '✓' },
    ] },
    { id: 'gestao', titulo: 'Gestão do produto', itens: [
      { tipo: 'titulo', t: 'Escopos e combos' },
      { id: 'servicos', t: 'Serviços e combos', i: '⊞' }, { id: 'configComercial', t: 'Configurar combos', i: '⚙' }, { id: 'sla', t: 'SLA e prazos', i: '◷' },
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
    painel: 'visao_geral', empresas: 'visao_geral', visaoCarteira: 'visao_geral', dashboardOperacao: 'visao_geral',
    dados: 'diagnostico', dadosDashboard: 'diagnostico', periodoAnalisado: 'diagnostico', executarMotor: 'diagnostico', bases: 'diagnostico', utilidadesFiscais: 'diagnostico', coberturaDiagnostico: 'diagnostico', classificacaoFiscalComplementar: 'diagnostico', pendenciasDiagnostico: 'diagnostico', conformidadeDocumental: 'diagnostico', perfil: 'diagnostico', fornecedores: 'diagnostico', clientes: 'diagnostico', impactoFinalCbs: 'diagnostico', cenarios: 'diagnostico', mapaOperacional: 'diagnostico', calculadora: 'diagnostico', plano: 'diagnostico', tarefasDiagnostico: 'diagnostico',
    precificacao: 'precificacao', formacaoCusto: 'precificacao', tarefasPrecificacao: 'precificacao', contratos: 'contratos', analise: 'contratos', tarefasContratos: 'contratos', capacitacao: 'capacitacao', tarefasCapacitacao: 'capacitacao', acompanhamento: 'gestao_projetos',
    planejamento: 'gestao_projetos', entregavelCliente: 'diagnostico',
    servicos: 'gestao_projetos', gestaoProjetos: 'visao_geral', configComercial: 'configuracoes', sla: 'configuracoes', cadastrosCnpj: 'configuracoes', consultaBaseRegime: 'configuracoes', conhecimento: 'configuracoes', atualizacoesReforma: 'visao_geral', documentacaoSistema: 'visao_geral', configuracoes: 'configuracoes', controleProjeto: 'gestao_projetos', questor: 'configuracoes', acessos: 'acessos',
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
  const MODULO_FECHAMENTO_POR_TELA = {
    perfil:'perfil', fornecedores:'fornecedores', clientes:'clientes', impactoFinalCbs:'impacto_cbs', cenarios:'cenarios', conformidadeDocumental:'conformidade', mapaOperacional:'perfil',
    precificacao:'precificacao', formacaoCusto:'formacao_custo', tarefasPrecificacao:'precificacao',
    contratos:'contratos', analise:'contratos', tarefasContratos:'contratos',
    capacitacao:'capacitacao', tarefasCapacitacao:'capacitacao', planejamento:'planejamento', acompanhamento:'acompanhamento',
  };

  async function anexarFechamentoModulo(alvo, tela) {
    const chave = MODULO_FECHAMENTO_POR_TELA[tela];
    if (!chave || !S.empresaId) return;
    const estado = await api(`/empresas/${S.empresaId}/modulos-entrega`);
    const modulo = (estado.modulos || []).find((m) => m.chave === chave);
    if (!modulo) return;
    const podeExecutar = !S.usuario?.permissoes || Boolean(S.usuario.permissoes[PERMISSAO_TELA[tela] || tela]?.executar);
    const bloco = document.createElement('section'); bloco.className = `cartao fechamento-modulo ${modulo.status === 'FECHADO' ? 'fechado' : ''}`;
    bloco.innerHTML = `<div class="cabecalho-lista"><div><div class="olho">CONTROLE DE ENTREGA</div><h2>${esc(modulo.titulo)}</h2><p class="desc">${modulo.status === 'FECHADO' ? `Fechado em ${esc(new Date(modulo.fechado_em).toLocaleString('pt-BR'))}. A fotografia permanece protegida; reabra apenas se precisar alterar dados ou cálculos.` : 'Revise este módulo e feche-o quando ele estiver pronto para compor a entrega ao cliente.'}</p>${modulo.observacao ? `<p class="mini">Fechamento: ${esc(modulo.observacao)}</p>` : ''}</div><div>${modulo.status === 'FECHADO' ? '<span class="tag c">FECHADO</span>' : '<span class="tag a">EM ABERTO</span>'}</div></div>${podeExecutar ? `<div class="acoes-topo">${modulo.status === 'FECHADO' ? '<button class="btn vazio" data-reabrir-modulo>Reabrir módulo</button>' : '<button class="btn" data-fechar-modulo>Fechar módulo</button>'}</div>` : ''}`;
    alvo.appendChild(bloco);
    bloco.querySelector('[data-fechar-modulo]')?.addEventListener('click', () => modal({ titulo:`Fechar ${modulo.titulo}`, descricao:'O fechamento não apaga nada. Ele impede novos cálculos deste módulo até uma reabertura registrada.', corpo:area('observacao','Observação do fechamento (opcional)','',3), confirmar:'Confirmar fechamento', aoConfirmar:async (form) => { await api(`/empresas/${S.empresaId}/modulos-entrega/${chave}/fechar`,{ metodo:'POST', corpo:form }); toast('Módulo fechado e protegido para a entrega.', 'ok'); ir(tela); } }));
    bloco.querySelector('[data-reabrir-modulo]')?.addEventListener('click', () => modal({ titulo:`Reabrir ${modulo.titulo}`, descricao:'A reabertura será registrada no histórico e volta a permitir alterações e cálculos deste módulo.', corpo:area('motivo','Motivo da reabertura','',3), confirmar:'Reabrir módulo', aoConfirmar:async (form) => { await api(`/empresas/${S.empresaId}/modulos-entrega/${chave}/reabrir`,{ metodo:'POST', corpo:form }); toast('Módulo reaberto com histórico preservado.', 'ok'); ir(tela); } }));
  }

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
      // A navegação inicia recolhida em toda nova abertura do sistema. O
      // estado é apenas da sessão atual: não ressuscitamos menus antigos por
      // localStorage, que era a causa de grupos voltarem todos abertos.
      const aberto = S.menuAbertos.has(grupo.id);
      const renderItem = (item) => `<a data-tela="${item.id}" ${item.centralGrupo ? `data-central-grupo="${item.centralGrupo}"` : ''} title="${item.t}" class="${S.tela === item.id && (!item.centralGrupo || (S.aba.centralDados || 'documentos') === item.centralGrupo) ? 'ativo' : ''}"><i aria-hidden="true" ${item.id==='executarMotor' && S.cache.prontidaoMotor !== undefined ? `style="color:${S.cache.prontidaoMotor?'#138a4b':'#c03532'}"` : ''}>${item.i}</i><span>${item.t}</span></a>`;
      const secoes = [];
      let secao = { titulo: null, chave: 'principal', itens: [] };
      for (const item of itens) {
        if (item.tipo === 'titulo') { if (secao.itens.length) secoes.push(secao); secao = { titulo: item.t, chave: item.t.toLowerCase().replace(/[^a-z0-9]+/g, '-'), itens: [] }; }
        else secao.itens.push(item);
      }
      if (secao.itens.length) secoes.push(secao);
      const itensHtml = secoes.map((secao) => {
        if (!secao.titulo) return secao.itens.map(renderItem).join('');
        const chaveSubmenu = `${grupo.id}:${secao.chave}`;
        const subAberto = S.submenusAbertos.has(chaveSubmenu);
        return `<section class="menu-subgrupo ${subAberto ? 'aberto' : ''}" data-subgrupo="${chaveSubmenu}"><button type="button" class="menu-subtitulo" data-subgrupo-toggle aria-expanded="${subAberto}">${secao.titulo}<span>${subAberto ? '⌃' : '⌄'}</span></button><div class="menu-subgrupo-itens">${secao.itens.map(renderItem).join('')}</div></section>`;
      }).join('');
      return `<section class="nav-grupo ${aberto ? 'aberto' : ''}" data-grupo="${grupo.id}">
        <button class="grupo-titulo" type="button" data-grupo-toggle aria-expanded="${aberto}" aria-controls="grupo-itens-${grupo.id}">${grupo.titulo}<span>${aberto ? '⌃' : '⌄'}</span></button>
        <div class="grupo-itens" id="grupo-itens-${grupo.id}">${itensHtml}</div>
      </section>`;
    }).join('') + (S.usuario ? `<section class="nav-grupo sessao aberto"><div class="grupo-titulo">${esc(S.usuario.nome || S.usuario.email)}</div><div class="grupo-itens"><a data-sair title="Sair"><i aria-hidden="true">↪</i><span>Sair</span></a></div></section>` : '');
    menu.onclick = (evento) => {
      const botao = evento.target.closest('[data-grupo-toggle]');
      if (botao && menu.contains(botao)) {
        evento.preventDefault();
        const bloco = botao.closest('.nav-grupo');
        const aberto = bloco.classList.toggle('aberto');
        botao.setAttribute('aria-expanded', String(aberto));
        botao.querySelector('span').textContent = aberto ? '⌃' : '⌄';
        if (aberto) S.menuAbertos.add(bloco.dataset.grupo);
        else S.menuAbertos.delete(bloco.dataset.grupo);
        return;
      }
      const botaoSubgrupo = evento.target.closest('[data-subgrupo-toggle]');
      if (botaoSubgrupo && menu.contains(botaoSubgrupo)) {
        evento.preventDefault();
        const bloco = botaoSubgrupo.closest('.menu-subgrupo');
        const aberto = bloco.classList.toggle('aberto');
        botaoSubgrupo.setAttribute('aria-expanded', String(aberto));
        botaoSubgrupo.querySelector('span').textContent = aberto ? '⌃' : '⌄';
        if (aberto) S.submenusAbertos.add(bloco.dataset.subgrupo);
        else S.submenusAbertos.delete(bloco.dataset.subgrupo);
      }
    };
    menu.querySelectorAll('[data-tela]').forEach((a) => { a.onclick = () => {
      if (a.dataset.centralGrupo) {
        S.aba.centralDados = a.dataset.centralGrupo;
        S.aba.dadosMotor = 'atual';
      }
      ir(a.dataset.tela);
    }; });
    const sair = menu.querySelector('[data-sair]');
    if (sair) sair.onclick = () => { localStorage.removeItem('sattva_token'); location.reload(); };
  }

  async function ir(tela) {
    if (!pode(tela)) { toast('Seu perfil não possui acesso a esta área.', 'erro'); return; }
    S.tela = tela;
    // A abertura da carteira é global. Ocultar o seletor nessa visão evita
    // transmitir a ideia de que seus dados foram filtrados pela última empresa
    // analisada; a escolha volta a aparecer ao entrar em um projeto.
    document.body.classList.toggle('visao-carteira', tela === 'visaoCarteira');
    location.hash = tela;
    desenharMenu();
    const tituloContexto = document.getElementById('tituloContexto');
    // Todas as etapas de importação reutilizam a tela "dados". O cabeçalho
    // não deve escolher o primeiro item desse id (Documentos fiscais), pois
    // isso duplicava o título no card e ficava incorreto ao abrir Folha,
    // Apurações etc. A área permanece Central de Dados; o card identifica a
    // etapa efetivamente selecionada.
    const itemMenu = TELAS_MENU.find((item) => item.id === tela);
    if (tituloContexto) tituloContexto.textContent = tela === 'dados'
      ? 'Central de Dados'
      : (itemMenu?.t || 'Visão geral');
    const alvo = document.getElementById('tela');
    alvo.innerHTML = '<div class="carregando">Carregando…</div>';
    try {
      const tarefasDaTela = TAREFAS_POR_TELA[tela];
      const fn = tarefasDaTela ? ((host) => telaTarefasModulo(host, ...tarefasDaTela)) : Telas[tela];
      if (!fn) { alvo.innerHTML = vazio('Tela não encontrada', 'Escolha uma opção no menu.'); return; }
      const semEmpresa = ['empresas', 'visaoCarteira', 'dashboardOperacao', 'planejamento', 'gestaoProjetos', 'configComercial', 'sla', 'cadastrosCnpj', 'consultaBaseRegime', 'conhecimento', 'atualizacoesReforma', 'documentacaoSistema', 'questor', 'bases', 'utilidadesFiscais', 'configuracoes', 'controleProjeto', 'acessos'];
      if (!semEmpresa.includes(tela) && !S.empresaId) {
        alvo.innerHTML = vazio('Selecione uma empresa', 'Este módulo trabalha sobre os dados de uma empresa. Cadastre ou selecione uma no topo do menu.',
          '<button class="btn" onclick="App.ir(\'empresas\')">Ir para empresas</button>');
        return;
      }
      // O catálogo é configurável, mas uma vez que o plano é aprovado só os
      // módulos presentes naquela fotografia ficam disponíveis ao projeto.
      const moduloPorTela = {
        dados: 'diagnostico', dadosDashboard: 'diagnostico', periodoAnalisado: 'diagnostico', executarMotor: 'diagnostico', bases: 'diagnostico', coberturaDiagnostico: 'diagnostico', perfil: 'diagnostico', fornecedores: 'diagnostico',
        clientes: 'diagnostico', cenarios: 'diagnostico', mapaOperacional: 'diagnostico', calculadora: 'diagnostico', plano: 'diagnostico', tarefasDiagnostico: 'diagnostico', entregavelCliente: 'diagnostico',
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
      // O controle fica ao final de cada módulo, sem interferir no conteúdo
      // operacional da tela. M7 não tem fechamento próprio: ele depende dos
      // seis módulos anteriores estarem fechados.
      if (S.tela === tela) await anexarFechamentoModulo(alvo, tela);
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
    const atualizarProntidaoMenu = async () => {
      if (!S.empresaId) { S.cache.prontidaoMotor = undefined; return; }
      try { S.cache.prontidaoMotor = Boolean((await api(`/empresas/${S.empresaId}/prontidao-dados`)).motor?.liberado); }
      catch (_) { S.cache.prontidaoMotor = false; }
      desenharMenu();
    };
    await atualizarProntidaoMenu();
    const selecionarEmpresa = (valor) => {
      S.empresaId = Number(valor) || null;
      S.empresa = S.empresas.find((e) => e.id === S.empresaId) || null;
      // A operação da carteira sempre inicia no mesmo contexto do cabeçalho.
      // A opção "Todas as empresas" continua disponível dentro daquela tela.
      S.cache.filtroGestaoEmpresa = S.empresaId ? String(S.empresaId) : '';
      localStorage.setItem('sattva_empresa', S.empresaId);
      S.cache.prontidaoMotor = undefined;
      atualizarProntidaoMenu().catch(() => {});
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
    document.getElementById('abrirUtilidadesFiscais')?.addEventListener('click', () => ir('utilidadesFiscais'));
    const usuario = document.getElementById('usuarioHeader');
    const menu = document.getElementById('usuarioMenuItens');
    usuario?.addEventListener('click', () => { const aberto = menu?.hidden !== false; if (menu) menu.hidden = !aberto; usuario.setAttribute('aria-expanded', String(aberto)); });
    document.querySelectorAll('[data-tema]').forEach((b) => b.addEventListener('click', () => aplicarTema(b.dataset.tema)));
    aplicarTema(S.usuario?.id ? (localStorage.getItem(`sattva_tema_${S.usuario.id}`) || localStorage.getItem('sattva_tema') || temaAtual()) : (localStorage.getItem('sattva_tema') || temaAtual()));
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
    const inicial = (location.hash || '').replace('#', '') || 'visaoCarteira';
    ir(TELAS_MENU.some((m) => m.id === inicial) ? inicial : 'visaoCarteira');
  }

  function telaLogin() {
    document.body.classList.add('auth-mode');
    document.getElementById('tela').innerHTML = `<div class="auth-layout"><section class="auth-brand"><div class="auth-aura auth-aura-um"></div><div class="auth-aura auth-aura-dois"></div><div class="auth-brand-conteudo"><img src="img/logo_sattva.jpg" alt="Sattva"><div class="auth-kicker"><i>✦</i> Plataforma de inteligência tributária</div><h1>Decisões seguras<br>em cada transição.</h1><p>Uma visão integrada para transformar dados fiscais em clareza, margem e conformidade.</p><div class="auth-pilares"><div><b>01</b><span>Diagnóstico<br>estruturado</span></div><div><b>02</b><span>Cenários<br>comparáveis</span></div><div><b>03</b><span>Decisões<br>auditáveis</span></div></div></div><div class="auth-rodape-brand"><span></span> Reforma tributária com método e rastreabilidade.</div></section><section class="auth-form"><div class="auth-card"><div class="auth-card-topo"><div class="auth-escudo">✓</div><div><div class="olho">Ambiente protegido</div><span>Área exclusiva para usuários autorizados</span></div></div><h1>Bem-vindo de volta</h1><p class="desc">Acesse sua conta para continuar sua análise.</p><form id="formLogin"><label class="campo auth-campo"><span>E-mail corporativo</span><div class="auth-input"><input name="email" type="email" autocomplete="email" required autofocus placeholder="nome@empresa.com"></div></label><label class="campo auth-campo"><span>Senha</span><div class="auth-input auth-senha"><input id="senhaLogin" name="senha" type="password" autocomplete="current-password" required placeholder="Informe sua senha"><button type="button" class="auth-ver-senha" id="verSenha" aria-label="Mostrar senha" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.4-6 9.5-6 9.5 6 9.5 6-3.4 6-9.5 6-9.5-6-9.5-6Z"></path><circle cx="12" cy="12" r="2.7"></circle></svg></button></div></label><button class="btn ouro auth-submit">Entrar na plataforma <span>→</span></button><button type="button" class="link-recuperar" id="esqueciSenha">Esqueci minha senha</button><div class="auth-seguro"><i>◈</i> Seus dados são tratados em ambiente protegido.</div><div id="erroLogin" class="mini auth-erro"></div></form></div><p class="auth-suporte">Sattva · Implementação da Reforma Tributária</p></section></div>`;
    document.getElementById('formLogin').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const erro = document.getElementById('erroLogin'); erro.textContent = 'Entrando…';
      try { const r = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: f.get('email'), senha: f.get('senha') }) }); const j = await r.json(); if (!j.ok) throw new Error(j.erro); localStorage.setItem('sattva_token', j.sessao.access_token); location.reload(); }
      catch (x) { erro.textContent = x.message || 'Não foi possível entrar.'; }
    };
    document.getElementById('verSenha').onclick = () => {
      const senha = document.getElementById('senhaLogin'); const botao = document.getElementById('verSenha');
      const exibindo = senha.type === 'text'; senha.type = exibindo ? 'password' : 'text';
      botao.setAttribute('aria-pressed', String(!exibindo)); botao.setAttribute('aria-label', exibindo ? 'Mostrar senha' : 'Ocultar senha');
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
        { t: 'Prazo', r: (t) => `<span class="mono mini">${esc(t.data_conclusao || '—')}</span>${t.prorrogado_em ? '<small class="mini">prorrogado</small>' : ''}` },
        { t: 'Origem', r: (t) => t.obrigatoria ? '<span class="tag b">SLA obrigatório</span>' : '<span class="mini">Manual</span>' },
        ...(podeExecutar ? [{ t: '', r: (t) => `${t.obrigatoria ? `<button class="btn pq vazio" data-prorrogar-tarefa="${t.id}">Prorrogar prazo</button>` : ''}<button class="btn pq vazio" data-editar-tarefa="${t.id}">Atualizar</button>` }] : []),
      ], tarefas, { vazio: 'Nenhuma tarefa neste módulo.' }) : vazio('Nenhuma tarefa neste módulo.', podeExecutar ? 'Registre a primeira atividade de execução.' : 'Acompanhe o andamento pelo painel geral.')}</section>`;
      const abrir = (tarefa = null) => modal({ titulo: tarefa ? `Tarefa — ${tarefa.titulo}` : `Nova tarefa — ${tituloModulo}`, largura: 720,
        corpo: `${!tarefa && entregas.length > 1 ? selecao('entrega_id', 'Entrega de capacitação', entregas.map((e) => ({ v: e.id, t: e.titulo })), '') : ''}${selecao('status', 'Situação', [{ v: 'aberta', t: 'Aberta' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluida', t: 'Concluída' }], tarefa?.status || 'aberta')}${selecao('tipo_pendencia', 'Classificação da pendência', [{ v: 'interna', t: 'Pendência interna' }, { v: 'cliente', t: 'Pendência com cliente' }], tarefa?.envolve_cliente ? 'cliente' : 'interna')}${campo('titulo', 'Título', tarefa?.titulo || '')}${tarefa?.obrigatoria ? `<div class="aviso"><b>Prazo do SLA</b>${esc(tarefa.data_abertura || '—')} até ${esc(tarefa.data_conclusao || '—')}. Use “Prorrogar prazo” para alterar a data com justificativa e reprogramar as etapas seguintes.</div>` : `<div class="grade g2">${campo('data_abertura', 'Data de abertura', tarefa?.data_abertura || '', 'date')}${campo('data_conclusao', 'Previsão/conclusão', tarefa?.data_conclusao || '', 'date')}</div>`}${area('pendencia_cliente', 'Descrição da pendência', tarefa?.pendencia_cliente || '', 2)}${area('interacoes_cliente', 'Interações / histórico', tarefa?.interacoes_cliente || '', 2)}${area('descricao', 'Detalhamento da tarefa', tarefa?.descricao || '', 2)}`,
        aoConfirmar: async (form) => { await api(tarefa ? `/projeto/tarefas/${tarefa.id}` : `/empresas/${S.empresaId}/projeto/tarefas/${chave}`, { metodo: tarefa ? 'PUT' : 'POST', corpo: form }); await carregar(); } });
      host.querySelector('[data-nova-tarefa]')?.addEventListener('click', () => abrir());
      host.querySelectorAll('[data-editar-tarefa]').forEach((b) => b.addEventListener('click', () => abrir(tarefas.find((t) => t.id === Number(b.dataset.editarTarefa)))));
      host.querySelectorAll('[data-prorrogar-tarefa]').forEach((b) => b.addEventListener('click', () => {
        const tarefa = tarefas.find((t) => t.id === Number(b.dataset.prorrogarTarefa));
        modal({ titulo: `Prorrogar prazo — ${tarefa.titulo}`, descricao:'A nova data reprogramará os marcos posteriores que dependem desta entrega. A justificativa ficará registrada no histórico do projeto.', largura:640,
          corpo: `${campo('novo_prazo', 'Novo prazo', tarefa.data_conclusao || '', 'date')}${area('justificativa', 'Justificativa da prorrogação', '', 3)}`,
          confirmar:'Prorrogar e reprogramar', aoConfirmar:async(form)=>{await api(`/projeto/tarefas/${tarefa.id}/prorrogar`,{metodo:'POST',corpo:form});toast('Prazo prorrogado e sequência reprogramada.','ok');await carregar();} });
      }));
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
