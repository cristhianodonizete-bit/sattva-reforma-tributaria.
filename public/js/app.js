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
    if (!j.ok) throw new Error(j.erro || 'Falha na requisição.');
    return j;
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
  function modal({ titulo, descricao, corpo, confirmar = 'Salvar', aoConfirmar, largura }) {
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
    const fechar = () => fundo.remove();
    fundo.querySelector('[data-x]').onclick = fechar;
    fundo.onclick = (e) => { if (e.target === fundo) fechar(); };
    document.addEventListener('keydown', function esc2(e) { if (e.key === 'Escape') { fechar(); document.removeEventListener('keydown', esc2); } });
    const okBtn = fundo.querySelector('[data-ok]');
    if (okBtn) okBtn.onclick = async () => {
      const dados = {};
      fundo.querySelectorAll('[name]').forEach((el) => {
        dados[el.name] = el.type === 'checkbox' ? el.checked : el.value;
      });
      try { okBtn.disabled = true; const r = await aoConfirmar(dados, fundo); if (r !== false) fechar(); }
      catch (e) { toast(e.message, 'erro'); } finally { okBtn.disabled = false; }
    };
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
    { grupo: 'Visão geral' },
    { id: 'painel', t: 'Painel do projeto' },
    { id: 'empresas', t: 'Empresas' },
    { id: 'dashboardOperacao', t: 'Acompanhamento geral' },
    { grupo: 'Módulo 1 · Diagnóstico' },
    { id: 'dados', t: 'Cadastros e importação' },
    { id: 'bases', t: 'Bases de classificação' },
    { id: 'perfil', t: 'Perfil tributário' },
    { id: 'fornecedores', t: 'Cadeia de fornecedores' },
    { id: 'clientes', t: 'Cadeia de clientes' },
    { id: 'cenarios', t: 'Projeção de cenários' },
    { id: 'calculadora', t: 'Calculadora da reforma' },
    { grupo: 'Módulos 2 a 4' },
    { id: 'precificacao', t: 'Precificação e margem' },
    { id: 'contratos', t: 'Revisão de contratos' },
    { id: 'analise', t: 'Análise de contrato (IA)' },
    { id: 'capacitacao', t: 'Capacitação do time' },
    { grupo: 'Gestão do produto' },
    { id: 'plano', t: 'Plano de adequação' },
    { id: 'servicos', t: 'Escopos e combos' },
    { id: 'gestaoProjetos', t: 'Escopo e entregas' },
    { id: 'configComercial', t: 'Configurar combos' },
    { id: 'conhecimento', t: 'Base de conhecimento' },
    { id: 'configuracoes', t: 'Configurações e controle' },
    { id: 'questor', t: 'Integração Questor' },
  ];

  function desenharMenu() {
    document.getElementById('menu').innerHTML = MENU.map((m) => m.grupo
      ? `<div class="grupo">${m.grupo}</div>`
      : `<a data-tela="${m.id}" class="${S.tela === m.id ? 'ativo' : ''}">${m.t}</a>`).join('') +
      (S.usuario ? `<div class="grupo" style="margin-top:14px">${esc(S.usuario.nome || S.usuario.email)}</div><a data-sair>Sair</a>` : '');
    document.querySelectorAll('#menu a').forEach((a) => { a.onclick = () => ir(a.dataset.tela); });
    const sair = document.querySelector('#menu [data-sair]');
    if (sair) sair.onclick = () => { localStorage.removeItem('sattva_token'); location.reload(); };
    document.querySelectorAll('#menu .grupo').forEach((g, i) => { const chave = `sattva_grupo_${i}`; let n = g.nextElementSibling; const itens=[]; while (n && !n.classList.contains('grupo')) { itens.push(n); n=n.nextElementSibling; } const ativo=itens.some((x)=>x.classList.contains('ativo')); const aberto=ativo || localStorage.getItem(chave)!=='fechado'; itens.forEach((x)=>x.classList.toggle('menu-item-oculto',!aberto)); g.onclick=()=>{const fechado=itens[0] && !itens[0].classList.contains('menu-item-oculto');itens.forEach((x)=>x.classList.toggle('menu-item-oculto',fechado));localStorage.setItem(chave,fechado?'fechado':'aberto');}; });
  }

  async function ir(tela) {
    S.tela = tela;
    location.hash = tela;
    desenharMenu();
    const alvo = document.getElementById('tela');
    alvo.innerHTML = '<div class="carregando">Carregando…</div>';
    try {
      const fn = Telas[tela];
      if (!fn) { alvo.innerHTML = vazio('Tela não encontrada', 'Escolha uma opção no menu.'); return; }
      const semEmpresa = ['empresas', 'dashboardOperacao', 'servicos', 'gestaoProjetos', 'configComercial', 'conhecimento', 'questor', 'bases', 'configuracoes'];
      if (!semEmpresa.includes(tela) && !S.empresaId) {
        alvo.innerHTML = vazio('Selecione uma empresa', 'Este módulo trabalha sobre os dados de uma empresa. Cadastre ou selecione uma no topo do menu.',
          '<button class="btn" onclick="App.ir(\'empresas\')">Ir para empresas</button>');
        return;
      }
      // O catálogo é configurável, mas uma vez que o plano é aprovado só os
      // módulos presentes naquela fotografia ficam disponíveis ao projeto.
      const moduloPorTela = {
        dados: 'diagnostico', bases: 'diagnostico', perfil: 'diagnostico', fornecedores: 'diagnostico',
        clientes: 'diagnostico', cenarios: 'diagnostico', calculadora: 'diagnostico', plano: 'diagnostico',
        precificacao: 'precificacao', contratos: 'contratos', analise: 'contratos', capacitacao: 'capacitacao',
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
    if (selHeader) { selHeader.innerHTML = sel.innerHTML; selHeader.value = sel.value; selHeader.onchange = () => { sel.value = selHeader.value; sel.onchange(); }; }
    sel.onchange = () => {
      S.empresaId = Number(sel.value) || null;
      S.empresa = S.empresas.find((e) => e.id === S.empresaId) || null;
      localStorage.setItem('sattva_empresa', S.empresaId);
      ir(S.tela);
    };
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
    const usuarioHeader = document.getElementById('usuarioHeader'); if (usuarioHeader) usuarioHeader.textContent = S.usuario?.nome || S.usuario?.email || '';
    const toggle = document.getElementById('menuToggle'); if (toggle) toggle.onclick = () => document.body.classList.toggle('menu-colapsado');
    try {
      const p = await api('/parametros');
      S.params = p;
    } catch (e) { document.getElementById('tela').innerHTML = `<div class="aviso alto">Servidor indisponível: ${esc(e.message)}</div>`; return; }
    await carregarEmpresas();
    const inicial = (location.hash || '').replace('#', '') || 'painel';
    ir(MENU.some((m) => m.id === inicial) ? inicial : 'painel');
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
      <form id="formRedefinir"><label class="campo"><span>Nova senha</span><input name="senha" type="password" minlength="8" required autofocus></label><label class="campo"><span>Confirmar senha</span><input name="confirmacao" type="password" minlength="8" required></label><button class="btn ouro" style="width:100%;margin-top:12px">Salvar nova senha</button><div id="erroRedefinir" class="mini" style="margin-top:12px"></div></form></div>`;
    document.getElementById('formRedefinir').onsubmit = async (e) => {
      e.preventDefault(); const f = new FormData(e.currentTarget); const erro = document.getElementById('erroRedefinir');
      if (f.get('senha') !== f.get('confirmacao')) { erro.textContent = 'As senhas não coincidem.'; return; }
      erro.textContent = 'Salvando…';
      try { const r = await fetch('/auth/redefinir-senha', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, senha: f.get('senha') }) }); const j = await r.json(); if (!j.ok) throw new Error(j.erro); location.hash = ''; location.reload(); }
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

  return { S, api, ir, iniciar, carregarEmpresas, moeda, num, pct, esc, cnpjFmt, sinal, setaPct, setaR$,
    toast, modal, confirmar, campo, area, selecao, opcoesRegime, opcoesReducao, opcoesAno, regimeLabel,
    kpi, avisos, vazio, regua, tabela, dropzone };
})();
