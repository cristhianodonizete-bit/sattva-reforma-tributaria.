/* =========================================================================
   TELAS — Análise de contratos por IA, base de conhecimento e configuração
   de configuração de serviços e combos
   ========================================================================= */
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') =>
  `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
   <div class="acoes-topo">${acoes}</div></div>`;
const rt = (r) => `<span class="tag ${r === 'alto' ? 'a' : r === 'medio' ? 'b' : 'c'}">${r || '—'}</span>`;
const st = (s) => ({ ausente: ['a', 'Ausente'], parcial: ['b', 'Parcial'], adequada: ['c', 'Adequada'], na: ['n', 'Não se aplica'] }[s] || ['n', s || '—']);

// ===========================================================================
// ANÁLISE DE CONTRATOS POR IA
// ===========================================================================
Telas.analise = async (el) => {
  const [{ analises }, { contratos, clausulas }, { config }] = await Promise.all([
    A.api(`/empresas/${S.empresaId}/analises`),
    A.api(`/empresas/${S.empresaId}/contratos`),
    A.api('/ia/config'),
  ]);

  el.innerHTML = cab('Módulo 3 · IA', 'Análise de contrato',
    'Suba o contrato em PDF, foto, imagem escaneada ou texto. A IA lê o documento, cruza com a base de conhecimento e devolve os achados cláusula a cláusula, com texto pronto para inserir.') +
    (!config.ativo ? `<div class="aviso alto"><b>Chave da API não configurada</b>
      A análise por IA precisa de uma chave da API Anthropic. Configure em Base de conhecimento → Configuração da IA, ou no arquivo <span class="mono">.env</span>.
      <div class="acao">Ir para Base de conhecimento</div></div>` : '') +
    `<div class="grade g2">
      <div class="cartao">
        <h2>Enviar contrato</h2>
        <p class="desc">PDF, JPG, PNG, WEBP, TXT, CSV ou MD. Fotos e digitalizações são lidas pela própria IA — não precisa de OCR instalado.</p>
        ${A.selecao('contrato_id', 'Vincular a um contrato cadastrado (opcional)',
          [{ v: '', t: '— não vincular —' }].concat(contratos.map((c) => ({ v: c.id, t: `${c.tipo} · ${c.contraparte || 'sem contraparte'}` }))), '')}
        <div id="zonaContrato" class="dropzone">
          <b>Solte o contrato aqui</b>
          <div class="mini">ou clique para escolher o arquivo</div>
        </div>
        <details class="clausula" style="margin-top:12px;border:none;padding:0">
          <summary class="mini">Prefiro colar o texto</summary>
          <textarea id="textoContrato" rows="7" placeholder="Cole aqui o texto do contrato" style="margin-top:8px"></textarea>
          <button class="btn vazio pq" id="analisarTexto" style="margin-top:8px">Analisar o texto colado</button>
        </details>
        <div id="statusAnalise" style="margin-top:14px"></div>
      </div>
      <div class="cartao">
        <h2>Como a análise é feita</h2>
        <p class="desc">Transparência do método — é isso que se explica ao cliente</p>
        <div class="aviso"><b>1. Leitura</b>O documento é transcrito integralmente, preservando a numeração das cláusulas. Trechos ilegíveis são marcados, não adivinhados.</div>
        <div class="aviso"><b>2. Recuperação</b>O sistema busca na base de conhecimento os trechos normativos e técnicos pertinentes ao contrato. Só o que foi recuperado vai para a análise.</div>
        <div class="aviso"><b>3. Análise</b>Cada ponto da biblioteca de cláusulas é confrontado com o contrato: ausente, parcial ou adequada — com o trecho literal que sustenta a conclusão.</div>
        <div class="aviso"><b>4. Sugestão</b>A cláusula sugerida é redigida para este contrato, usando os nomes das partes e o vocabulário do próprio documento.</div>
        <div class="aviso atencao"><b>Revisão humana obrigatória</b>A saída é minuta de trabalho. O parecer é do profissional, não da ferramenta.</div>
      </div>
    </div>
    <div class="cartao"><h2>Análises realizadas</h2>
      ${A.tabela([
        { t: 'Documento', r: (a) => `${A.esc(a.arquivo)}<div class="mini">${A.esc(a.tipo_arquivo)} · ${(a.caracteres / 1000).toFixed(1)} mil caracteres</div>` },
        { t: 'Contrato', r: (a) => { const c = contratos.find((x) => x.id === a.contrato_id); return c ? A.esc(c.contraparte) : '<span class="mini">não vinculado</span>'; } },
        { t: 'Modelo', r: (a) => `<span class="mini mono">${A.esc(a.modelo)}</span>` },
        { t: 'Tokens', num: true, r: (a) => `<span class="mini">${a.tokens_entrada + a.tokens_saida}</span>` },
        { t: 'Data', r: (a) => `<span class="mini mono">${A.esc(a.criado_em)}</span>` },
        { t: '', r: (a) => `<button class="btn pq ouro" data-va="${a.id}">Ver análise</button>
          <button class="btn pq perigo" data-da="${a.id}">Excluir</button>` },
      ], analises, { vazio: 'Nenhuma análise ainda. Envie o primeiro contrato.' })}
    </div>`;

  const zona = document.getElementById('zonaContrato');
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.csv,.md'; inp.style.display = 'none';
  zona.appendChild(inp);
  zona.onclick = () => inp.click();
  inp.onchange = () => { if (inp.files[0]) enviar(inp.files[0]); inp.value = ''; };
  zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('sobre'); };
  zona.ondragleave = () => zona.classList.remove('sobre');
  zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove('sobre'); if (e.dataTransfer.files[0]) enviar(e.dataTransfer.files[0]); };

  document.getElementById('analisarTexto').onclick = () => {
    const t = document.getElementById('textoContrato').value.trim();
    if (t.length < 200) return A.toast('Cole ao menos alguns parágrafos do contrato.', 'erro');
    enviar(null, t);
  };

  async function enviar(arquivo, texto) {
    const box = document.getElementById('statusAnalise');
    box.innerHTML = `<div class="aviso"><b>Analisando…</b>Leitura do documento, busca na base de conhecimento e análise. Um contrato longo pode levar de 30 a 90 segundos.</div>
      <div class="barra-prog"><i style="width:35%"></i></div>`;
    const fd = new FormData();
    if (arquivo) fd.append('arquivo', arquivo); else fd.append('texto', texto);
    const cid = (el.querySelector('[name="contrato_id"]') || {}).value;
    if (cid) fd.append('contrato_id', cid);
    try {
      const r = await A.api(`/empresas/${S.empresaId}/contratos/analisar`, { metodo: 'POST', corpo: fd });
      box.innerHTML = '<div class="aviso bom"><b>Análise concluída</b>Resultado aberto ao lado.</div>';
      verAnalise(r.id);
    } catch (e) {
      box.innerHTML = `<div class="aviso alto"><b>Não foi possível analisar</b>${A.esc(e.message)}</div>`;
    }
  }

  el.querySelectorAll('[data-va]').forEach((b) => { b.onclick = () => verAnalise(b.dataset.va); });
  el.querySelectorAll('[data-da]').forEach((b) => { b.onclick = () => A.confirmar('Excluir esta análise?', async () => {
    await A.api(`/analises/${b.dataset.da}`, { metodo: 'DELETE' }); A.ir('analise'); }); });

  async function verAnalise(id) {
    const { analise } = await A.api(`/analises/${id}`);
    const r = analise.resultado;
    const achados = r.achados || [];
    A.modal({
      titulo: 'Análise do contrato', largura: 940, confirmar: null,
      descricao: `${A.esc(analise.arquivo)} · ${A.esc(analise.modelo)} · ${A.esc(analise.criado_em)}`,
      corpo: `<div class="grade g3">
          ${A.kpi('Risco geral', rt(r.risco_geral))}
          ${A.kpi('Pontos analisados', achados.length, `${achados.filter((a) => a.situacao === 'ausente').length} ausentes`)}
          ${A.kpi('Preço', r.preco_com_tributo_incluso ? 'Com tributo incluso' : 'Líquido de tributo', '', r.preco_com_tributo_incluso ? 'destaque' : '')}
        </div>
        <div class="aviso" style="margin-top:14px"><b>Resumo</b>${A.esc(r.resumo || '')}</div>
        <table style="margin-bottom:14px">
          <tr><td>Tipo</td><td>${A.esc(r.tipo_contrato || '—')}</td></tr>
          <tr><td>Partes</td><td>${A.esc((r.partes && r.partes.contratante) || '—')} × ${A.esc((r.partes && r.partes.contratado) || '—')}</td></tr>
          <tr><td>Objeto</td><td>${A.esc(r.objeto || '—')}</td></tr>
          <tr><td>Vigência</td><td>${A.esc(r.vigencia || '—')}</td></tr>
        </table>
        <h3 style="font-size:14px;color:var(--navy-900)">Achados</h3>
        ${achados.map((f) => `<div class="cartao" style="box-shadow:none;margin-bottom:10px">
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <b style="flex:1">${A.esc(f.titulo || f.clausula_id || '')}</b>
              <span class="tag ${st(f.situacao)[0]}">${st(f.situacao)[1]}</span>${rt(f.risco)}
            </div>
            <p style="margin:9px 0 0;color:var(--tinta-2);font-size:13px">${A.esc(f.analise || '')}</p>
            ${f.trecho ? `<div class="mini" style="margin-top:8px;padding:8px 10px;background:#f4f7f9;border-radius:6px">
              <b>No contrato:</b> “${A.esc(f.trecho)}”</div>` : ''}
            ${f.fundamento ? `<div class="mini" style="margin-top:6px">Fundamento: ${A.esc(f.fundamento)}</div>` : ''}
            ${f.sugestao ? `<details class="clausula" style="margin-top:9px;border:none;padding:0">
              <summary class="mini">Ver cláusula sugerida</summary>
              <div class="texto">${A.esc(f.sugestao)}</div>
              <button class="btn vazio pq" style="margin-top:8px" data-copiar="${A.esc(f.sugestao).replace(/"/g, '&quot;')}">Copiar texto</button>
            </details>` : ''}
          </div>`).join('')}
        ${(r.acoes || []).length ? `<h3 style="font-size:14px;color:var(--navy-900)">Ações recomendadas</h3>
          ${(r.acoes).map((a) => `<div class="aviso ${a.prioridade === 'alta' ? 'alto' : 'atencao'}"><b>${A.esc(a.titulo)}</b>${A.esc(a.descricao || '')}</div>`).join('')}` : ''}
        <hr class="sep">
        <h3 style="font-size:13px">Fontes consultadas na base de conhecimento</h3>
        ${(analise.fontes || []).map((f) => `<div class="mini">[${f.marcador}] ${A.esc(f.titulo)}${f.fonte ? ` — ${A.esc(f.fonte)}` : ''}</div>`).join('') || '<div class="mini">Nenhuma fonte recuperada.</div>'}
        <hr class="sep">
        <div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">
          ${A.selecao('aplicar_contrato', 'Aplicar achados ao contrato',
            [{ v: '', t: '— escolher contrato —' }].concat(contratos.map((c) => ({ v: c.id, t: `${c.tipo} · ${c.contraparte || 'sem contraparte'}` }))), analise.contrato_id || '')}
          <label class="campo" style="flex:0 0 auto"><span>Abrir ações no plano</span>
            <input type="checkbox" name="criar_acoes" checked style="width:auto"></label>
          <button class="btn ouro" id="aplicarAch" style="margin-bottom:12px">Aplicar ao checklist</button>
        </div>`,
    });
    setTimeout(() => {
      document.querySelectorAll('[data-copiar]').forEach((b) => { b.onclick = () => {
        navigator.clipboard.writeText(b.dataset.copiar).then(() => A.toast('Texto copiado', 'ok')); }; });
      const btn = document.getElementById('aplicarAch');
      if (btn) btn.onclick = async () => {
        const cid = document.querySelector('[name="aplicar_contrato"]').value;
        if (!cid) return A.toast('Escolha o contrato', 'erro');
        try {
          const r2 = await A.api(`/analises/${id}/aplicar`, { metodo: 'POST',
            corpo: { contrato_id: cid, criar_acoes: document.querySelector('[name="criar_acoes"]').checked } });
          A.toast(`${r2.aplicados} pontos aplicados${r2.acoes ? ` · ${r2.acoes} ações abertas` : ''} · risco ${r2.risco}`, 'ok');
        } catch (e) { A.toast(e.message, 'erro'); }
      };
    }, 0);
  }
};

// ===========================================================================
// BASE DE CONHECIMENTO
// ===========================================================================
Telas.conhecimento = async (el) => {
  const { documentos, estatisticas, ia } = await A.api('/conhecimento');
  const categorias = [...new Set(documentos.map((d) => d.categoria))];

  el.innerHTML = cab('Fundamento', 'Base de conhecimento',
    'É daqui que a IA tira o fundamento de cada análise. Quanto melhor a base — pareceres, minutas padrão, notas técnicas, atos normativos —, mais precisa e mais defensável fica a saída.',
    '<button class="btn" id="addTexto">Adicionar texto</button><button class="btn vazio" id="addArquivo">Subir documento</button>') +
    `<div class="grade g4">
      ${A.kpi('Documentos', estatisticas.documentos)}
      ${A.kpi('Trechos indexados', estatisticas.trechos, 'unidades de recuperação')}
      ${A.kpi('Categorias', categorias.length)}
      ${A.kpi('IA', ia.ativo ? 'Configurada' : 'Não configurada', A.esc(ia.modelo), ia.ativo ? 'destaque' : '')}
    </div>
    <div class="grade g2" style="margin-top:16px">
      <div class="cartao"><h2>Consultar a base</h2>
        <p class="desc">Pergunta técnica respondida com os trechos da base e as fontes citadas</p>
        <textarea id="pergunta" rows="3" placeholder="Ex.: como fica o crédito quando o fornecedor é do Simples Nacional?"></textarea>
        <div style="display:flex;gap:8px;margin-top:9px">
          <button class="btn" id="perguntar">Perguntar à IA</button>
          <button class="btn vazio" id="buscar">Só buscar trechos</button>
        </div>
        <div id="respostaBase" style="margin-top:14px"></div>
      </div>
      <div class="cartao"><h2>Configuração da IA</h2>
        <p class="desc">Chave da API Anthropic. Fica gravada apenas neste servidor.</p>
        <div class="aviso ${ia.ativo ? 'bom' : 'atencao'}"><b>${ia.ativo ? 'Chave ativa' : 'Sem chave'}</b>Origem: ${A.esc(ia.origemChave)}</div>
        ${A.campo('api_key', 'Chave da API (sk-ant-...)', '', 'text', 'placeholder="deixe em branco para manter a atual"')}
        ${A.campo('modelo', 'Modelo', ia.modelo)}
        <div style="display:flex;gap:8px">
          <button class="btn" id="salvarIA">Salvar</button>
          <button class="btn vazio" id="testarIA">Testar conexão</button>
        </div>
        <div id="statusIA" style="margin-top:12px"></div>
        <hr class="sep">
        <p class="mini">Preferindo variável de ambiente, crie um arquivo <span class="mono">.env</span> na raiz com
          <span class="mono">ANTHROPIC_API_KEY=sk-ant-...</span> — ela tem prioridade sobre a chave salva aqui.</p>
      </div>
    </div>
    <div class="cartao"><h2>Documentos indexados</h2>
      ${A.tabela([
        { t: 'Título', r: (d) => `<b>${A.esc(d.titulo)}</b><div class="mini">${A.esc(d.fonte || '')}</div>` },
        { t: 'Categoria', r: (d) => `<span class="tag">${A.esc(d.categoria)}</span>` },
        { t: 'Trechos', num: true, r: (d) => d.trechos },
        { t: 'Tamanho', num: true, r: (d) => `${(d.caracteres / 1000).toFixed(1)} mil` },
        { t: 'Incluído em', r: (d) => `<span class="mini mono">${A.esc(d.criado_em)}</span>` },
        { t: '', r: (d) => `<button class="btn pq perigo" data-rd="${d.id}">Remover</button>` },
      ], documentos, { vazio: 'Base vazia.' })}
    </div>`;

  document.getElementById('addTexto').onclick = () => A.modal({
    titulo: 'Adicionar à base de conhecimento', largura: 760,
    descricao: 'Cole um parecer, uma nota técnica, um trecho de lei ou uma orientação interna.',
    corpo: `<div class="grade g2">${A.campo('titulo', 'Título')}${A.campo('fonte', 'Fonte (lei, parecer, autor)')}</div>
      ${A.selecao('categoria', 'Categoria', [{ v: 'legislacao', t: 'Legislação' }, { v: 'contratos', t: 'Contratos' },
        { v: 'creditos', t: 'Créditos' }, { v: 'diagnostico', t: 'Diagnóstico' }, { v: 'jurisprudencia', t: 'Jurisprudência' },
        { v: 'interno', t: 'Material interno Sattva' }, { v: 'geral', t: 'Geral' }], 'geral')}
      ${A.area('conteudo', 'Conteúdo', '', 12)}`,
    aoConfirmar: async (d) => { const r = await A.api('/conhecimento', { metodo: 'POST', corpo: d });
      A.toast(`Indexado em ${r.trechos} trechos`, 'ok'); A.ir('conhecimento'); },
  });

  document.getElementById('addArquivo').onclick = () => A.modal({
    titulo: 'Subir documento para a base', confirmar: null,
    descricao: 'PDF, imagem ou texto. PDFs e imagens são lidos pela IA antes de entrar no índice.',
    corpo: `<div class="grade g2">${A.campo('titulo', 'Título (opcional)')}${A.campo('fonte', 'Fonte (opcional)')}</div>
      ${A.selecao('categoria', 'Categoria', [{ v: 'legislacao', t: 'Legislação' }, { v: 'contratos', t: 'Contratos' },
        { v: 'creditos', t: 'Créditos' }, { v: 'jurisprudencia', t: 'Jurisprudência' },
        { v: 'interno', t: 'Material interno Sattva' }, { v: 'geral', t: 'Geral' }], 'geral')}
      <div class="dropzone" id="zonaBase"><b>Solte o documento aqui</b><div class="mini">ou clique para escolher</div></div>
      <div id="statusBase" style="margin-top:12px"></div>`,
  });
  // handler do dropzone da base (o modal só existe depois de aberto)
  document.addEventListener('click', function ligar(e) {
    const z = document.getElementById('zonaBase');
    if (!z || z.dataset.ligado) return;
    z.dataset.ligado = '1';
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.pdf,.png,.jpg,.jpeg,.webp,.txt,.md,.csv'; i.style.display = 'none';
    z.appendChild(i);
    z.onclick = () => i.click();
    i.onchange = async () => {
      if (!i.files[0]) return;
      const box = document.getElementById('statusBase');
      box.innerHTML = '<div class="aviso">Lendo e indexando o documento…</div>';
      const fd = new FormData();
      fd.append('arquivo', i.files[0]);
      ['titulo', 'fonte', 'categoria'].forEach((k) => {
        const c = document.querySelector(`.modal [name="${k}"]`); if (c && c.value) fd.append(k, c.value);
      });
      try { const r = await A.api('/conhecimento/upload', { metodo: 'POST', corpo: fd });
        A.toast(`Indexado em ${r.trechos} trechos`, 'ok'); A.ir('conhecimento'); }
      catch (err) { box.innerHTML = `<div class="aviso alto">${A.esc(err.message)}</div>`; }
    };
  });

  document.getElementById('perguntar').onclick = async () => {
    const q = document.getElementById('pergunta').value.trim();
    if (!q) return;
    const box = document.getElementById('respostaBase');
    box.innerHTML = '<div class="carregando">Consultando…</div>';
    try {
      const r = await A.api('/conhecimento/perguntar', { metodo: 'POST', corpo: { pergunta: q } });
      box.innerHTML = `<div style="white-space:pre-wrap;font-size:13.5px">${A.esc(r.resposta)}</div>
        <hr class="sep"><div class="mini"><b>Fontes:</b> ${r.fontes.map((f) => `[${f.marcador}] ${A.esc(f.titulo)}`).join(' · ')}</div>`;
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  };
  document.getElementById('buscar').onclick = async () => {
    const q = document.getElementById('pergunta').value.trim();
    if (!q) return;
    const r = await A.api(`/conhecimento/buscar?q=${encodeURIComponent(q)}`);
    document.getElementById('respostaBase').innerHTML = r.trechos.map((t) =>
      `<div class="aviso"><b>${A.esc(t.titulo)} · relevância ${t.score.toFixed(1)}</b>
        <span class="mini">${A.esc(t.conteudo.slice(0, 380))}…</span></div>`).join('') || '<div class="mini">Nada encontrado.</div>';
  };
  document.getElementById('salvarIA').onclick = async () => {
    const corpo = { modelo: el.querySelector('[name="modelo"]').value };
    const k = el.querySelector('[name="api_key"]').value.trim();
    if (k) corpo.api_key = k;
    await A.api('/ia/config', { metodo: 'POST', corpo });
    A.toast('Configuração salva', 'ok'); A.ir('conhecimento');
  };
  document.getElementById('testarIA').onclick = async () => {
    const box = document.getElementById('statusIA');
    box.innerHTML = '<div class="carregando">Testando…</div>';
    try { const r = await A.api('/ia/testar', { metodo: 'POST' });
      box.innerHTML = `<div class="aviso bom"><b>Conexão ok</b>${A.esc(r.modelo)} respondeu: ${A.esc(r.resposta)}</div>`; }
    catch (e) { box.innerHTML = `<div class="aviso alto"><b>Falhou</b>${A.esc(e.message)}</div>`; }
  };
  el.querySelectorAll('[data-rd]').forEach((b) => { b.onclick = () => A.confirmar('Remover este documento da base?', async () => {
    await A.api(`/conhecimento/${b.dataset.rd}`, { metodo: 'DELETE' }); A.ir('conhecimento'); }); });
};

// ===========================================================================
// CONFIGURAÇÃO DE ESCOPO — SERVIÇOS E COMBOS
// ===========================================================================
Telas.configComercial = async (el) => {
  const { servicos, combos } = await A.api('/servicos');
  el.innerHTML = cab('Configuração', 'Combos e módulos',
    'Monte os escopos entregáveis e indique quais módulos cada serviço libera. Não há valores comerciais nesta ferramenta.',
    '<button class="btn" id="novoServico">Novo serviço</button><button class="btn vazio" id="novoCombo">Novo combo</button>') +
    `<div class="cartao"><h2>Acompanhamento dos planos</h2><p class="desc">Todos os planos incluem acompanhamento. Defina aqui a mesma quantidade de meses para todos os combos ativos.</p>
      <div style="display:flex;gap:8px;align-items:end"><label class="campo" style="margin:0;max-width:280px"><span>Meses liberados após o Diagnóstico</span><input id="mesesTodosCombos" type="number" min="1" max="36" value="${combos[0]?.acompanhamento_meses || 3}"></label><button class="btn" id="aplicarMesesTodos">Aplicar a todos os planos</button></div></div>` +
    `<div class="cartao"><h2>Catálogo de entregas</h2>
      ${A.tabela([
        { t: 'Código', r: (s) => `<span class="mono mini">${A.esc(s.codigo)}</span>` },
        { t: 'Módulo', r: (s) => `<span class="tag">${A.esc(s.modulo)}</span>` },
        { t: 'Serviço', r: (s) => `<b>${A.esc(s.nome)}</b><div class="mini">${A.esc((s.descricao || '').slice(0, 110))}</div>` },
        { t: 'Entregáveis', r: (s) => `<span class="mini">${A.esc(s.entregaveis || '')}</span>` },
        { t: 'Libera', r: (s) => `<span class="mini">${A.esc(s.chave_entrega || 'outro')}</span>` },
        { t: 'Prazo', num: true, r: (s) => `<span class="mini">${s.prazo_dias}d</span>` },
        { t: 'Ativo', r: (s) => `<span class="tag ${s.ativo ? 'c' : 'n'}">${s.ativo ? 'sim' : 'não'}</span>` },
        { t: '', r: (s) => `<button class="btn pq vazio" data-es="${s.id}">Editar</button>` },
      ], servicos)}
    </div>
    <div class="cartao combos-config"><div class="cabecalho-lista"><div><h2>Combos</h2><p class="desc">Pacotes de entrega. A aprovação congela os módulos e os meses de acompanhamento daquele projeto.</p></div><span class="tag">${combos.length} planos</span></div>
      <div class="grade g3 cards-combo">${combos.map((c) => {
        const incluidos = c.servicos.map((id) => servicos.find((s) => s.id === id)).filter(Boolean);
        return `<article class="combo-config-card ${c.destaque ? 'destaque' : ''}">
          <div class="combo-config-topo"><div><h3>${A.esc(c.nome)}</h3>${c.destaque ? '<span class="tag b">destaque</span>' : ''}</div><span class="tag ${c.ativo ? 'c' : 'n'}">${c.ativo ? 'ativo' : 'inativo'}</span></div>
          <p>${A.esc(c.descricao || 'Sem descrição definida.')}</p>
          <div class="combo-meses"><b>${c.acompanhamento_meses || 0}</b><span>meses de acompanhamento<br>após o Diagnóstico</span></div>
          <div class="combo-servicos"><strong>Entregas incluídas</strong>${incluidos.length ? incluidos.map((s) => `<span>${A.esc(s.nome)}</span>`).join('') : '<span>Sem serviços vinculados</span>'}</div>
          <div class="combo-config-acoes"><button class="btn pq vazio" data-ec2="${c.id}">Editar combo</button><button class="btn pq perigo" data-rc2="${c.id}">Excluir</button></div>
        </article>`;
      }).join('')}</div>
    </div>`;

  const formServico = (s = {}) => `<div class="grade g2">${A.campo('codigo', 'Código', s.codigo, 'text', s.id ? 'disabled' : '')}
      ${A.campo('modulo', 'Módulo', s.modulo)}</div>
    ${A.campo('nome', 'Nome do serviço', s.nome)}
    ${A.area('descricao', 'Descrição', s.descricao, 3)}
    ${A.area('entregaveis', 'Entregáveis (separe por ponto e vírgula)', s.entregaveis, 2)}
    <div class="grade g2">${A.selecao('unidade', 'Unidade de entrega', [{ v: 'projeto', t: 'Projeto' }, { v: 'turma', t: 'Turma' }, { v: 'hora', t: 'Hora' }], s.unidade || 'projeto')}
      ${A.campo('prazo_dias', 'Prazo estimado (dias)', s.prazo_dias || 30, 'number')}</div>
    ${A.selecao('chave_entrega', 'Módulo liberado por este serviço', [
      { v: 'diagnostico', t: 'Diagnóstico' }, { v: 'precificacao', t: 'Precificação' }, { v: 'contratos', t: 'Revisão de contratos' },
      { v: 'treinamento_boas_praticas', t: 'Treinamento Boas Práticas' }, { v: 'capacitacao_operacional', t: 'Capacitação Operacional' },
      { v: 'acompanhamento', t: 'Acompanhamento (não libera tela)' }, { v: 'outro', t: 'Outro / sem liberação' },
    ], s.chave_entrega || 'outro')}
    <label class="campo"><span>Serviço ativo</span><input type="checkbox" name="ativo" ${s.ativo === undefined || s.ativo ? 'checked' : ''} style="width:auto"></label>`;

  document.getElementById('novoServico').onclick = () => A.modal({
    titulo: 'Novo serviço', largura: 720, corpo: formServico(),
    aoConfirmar: async (d) => { await A.api('/servicos', { metodo: 'POST', corpo: d }); A.toast('Serviço criado', 'ok'); A.ir('configComercial'); },
  });
  document.getElementById('aplicarMesesTodos').onclick = async () => {
    const acompanhamento_meses = Number(document.getElementById('mesesTodosCombos').value);
    await A.api('/combos/acompanhamento', { metodo: 'PUT', corpo: { acompanhamento_meses } });
    A.toast('Acompanhamento atualizado em todos os planos ativos', 'ok'); A.ir('configComercial');
  };
  el.querySelectorAll('[data-es]').forEach((b) => { b.onclick = () => {
    const s = servicos.find((x) => x.id === Number(b.dataset.es));
    A.modal({ titulo: 'Editar serviço', largura: 720, corpo: formServico(s),
      aoConfirmar: async (d) => { await A.api(`/servicos/${s.id}`, { metodo: 'PUT', corpo: d }); A.toast('Serviço atualizado', 'ok'); A.ir('configComercial'); } });
  }; });

  const formCombo = (c = {}) => `${A.campo('nome', 'Nome do combo', c.nome)}
    ${A.area('descricao', 'Descrição do escopo', c.descricao, 2)}
    <div class="aviso bom"><b>Acompanhamento incluído em todos os planos.</b> Defina abaixo quantos meses serão liberados após a conclusão do Diagnóstico.</div>
    <div class="grade g2">${A.campo('acompanhamento_meses', 'Quantidade de meses de acompanhamento', c.acompanhamento_meses === undefined ? 3 : c.acompanhamento_meses, 'number', 'min=1 max=36')}
      <label class="campo"><span>Destacar na escolha do escopo</span><input type="checkbox" name="destaque" ${c.destaque ? 'checked' : ''} style="width:auto"></label></div>
    <label class="campo"><span>Serviços incluídos</span></label>
    <div class="lista-sel">${servicos.map((s) => `<label class="it ${(c.servicos || []).includes(s.id) ? 'on' : ''}">
        <input type="checkbox" data-cs="${s.id}" ${(c.servicos || []).includes(s.id) ? 'checked' : ''}>
        <span><span class="nome">${A.esc(s.nome)}</span><span class="txt mini" style="margin-left:6px">${A.esc(s.modulo)}</span></span>
        </label>`).join('')}</div>
    <div id="previaCombo" class="aviso" style="margin-top:12px"></div>`;

  const ligarPrevia = (fundo) => {
    const calc = () => {
      const ids = [...fundo.querySelectorAll('[data-cs]:checked')].map((i) => Number(i.dataset.cs));
      fundo.querySelector('#previaCombo').innerHTML = `<b>${ids.length} serviços</b> serão incluídos neste escopo.`;
    };
    fundo.querySelectorAll('[data-cs]').forEach((i) => { i.onchange = () => { i.closest('.it').classList.toggle('on', i.checked); calc(); }; });
    calc();
  };

  document.getElementById('novoCombo').onclick = () => {
    const m = A.modal({ titulo: 'Novo combo', largura: 720, corpo: formCombo(),
      aoConfirmar: async (d, fundo) => {
        const ids = [...fundo.querySelectorAll('[data-cs]:checked')].map((i) => Number(i.dataset.cs));
        if (!ids.length) throw new Error('Selecione ao menos um serviço.');
        await A.api('/combos', { metodo: 'POST', corpo: { ...d, servicos: ids } });
        A.toast('Combo criado', 'ok'); A.ir('configComercial');
      } });
    setTimeout(() => ligarPrevia(m.fundo), 0);
  };
  el.querySelectorAll('[data-ec2]').forEach((b) => { b.onclick = () => {
    const c = combos.find((x) => x.id === Number(b.dataset.ec2));
    const m = A.modal({ titulo: 'Editar combo', largura: 720,
      corpo: formCombo(c) + `<label class="campo" style="margin-top:10px"><span>Combo ativo</span>
        <input type="checkbox" name="ativo" ${c.ativo ? 'checked' : ''} style="width:auto"></label>`,
      aoConfirmar: async (d, fundo) => {
        const ids = [...fundo.querySelectorAll('[data-cs]:checked')].map((i) => Number(i.dataset.cs));
        await A.api(`/combos/${c.id}`, { metodo: 'PUT', corpo: { ...d, servicos: ids } });
        A.toast('Combo atualizado', 'ok'); A.ir('configComercial');
      } });
    setTimeout(() => ligarPrevia(m.fundo), 0);
  }; });
  el.querySelectorAll('[data-rc2]').forEach((b) => { b.onclick = () => A.confirmar('Excluir este combo?', async () => {
    await A.api(`/combos/${b.dataset.rc2}`, { metodo: 'DELETE' }); A.ir('configComercial'); }); });
};

// ===========================================================================
// GESTÃO DA CARTEIRA — escopo aprovado, entrega e acompanhamento
// ===========================================================================
Telas.gestaoProjetos = async (el) => {
  const d = await A.api('/gestao/projetos');
  const statusEntrega = [{ v: 'pendente', t: 'Pendente' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluida', t: 'Concluída' }, { v: 'nao_aplicavel', t: 'Não aplicável' }];
  const statusAcomp = [{ v: 'planejado', t: 'Planejado' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluido', t: 'Concluído' }];
  const rotulo = (s) => (statusEntrega.concat(statusAcomp).find((x) => x.v === s) || {}).t || s;
  const tag = (s) => s === 'concluida' || s === 'concluido' ? 'c' : s === 'em_andamento' ? 'b' : 'n';

  el.innerHTML = cab('Gestão do projeto', 'Escopo e entregas',
    'O escopo é congelado na aprovação. A evolução compara as entregas e os três meses de acompanhamento com o plano efetivamente aprovado.') +
    `<div class="grade g3">
      ${A.kpi('Projetos em execução', d.projetos.filter((p) => p.status === 'em_execucao').length, 'escopo aprovado')}
      ${A.kpi('Escopos para aprovar', d.propostas.length, 'defina entregas e acompanhamento', d.propostas.length ? 'destaque' : '')}
      ${A.kpi('Acompanhamentos em aberto', d.projetos.reduce((n, p) => n + p.acompanhamentos.filter((a) => a.status !== 'concluido').length, 0), 'meses liberados')}
    </div>
    <div class="cartao lista-aprovacoes"><div class="cabecalho-lista"><div><h2>Escopos aguardando aprovação</h2><p class="desc">A aprovação registra a fotografia do plano e libera as etapas contratadas.</p></div><span class="tag">${d.propostas.length} pendentes</span></div>
      ${A.tabela([
        { t: 'Cliente', r: (p) => `<b>${A.esc(p.razao_social)}</b>` },
        { t: 'Escopo contratado', r: (p) => A.esc(p.combo_nome || 'Escopo personalizado') },
        { t: 'Criada em', r: (p) => A.esc(p.criado_em || '—') },
        { t: '', r: (p) => `<button class="btn pq" data-aprovar="${p.id}">Fechar e aprovar</button>` },
      ], d.propostas, { vazio: 'Nenhuma proposta aguardando aprovação.' })}</div>
    <div class="projetos-entrega">${d.projetos.map((p) => `<section class="cartao projeto-entrega-card">
      <div class="projeto-entrega-cabecalho"><div>
        <h2>${A.esc(p.razao_social)}</h2><p class="desc">${A.esc(p.combo_nome || 'Plano personalizado')} · aprovado em ${A.esc(p.aprovado_em || '—')}</p>
      </div><div class="projeto-progresso"><b class="mono">${p.progresso}%</b><div class="mini">${p.concluidas}/${p.entregas.length} entregas concluídas</div></div></div>
      <div class="barra-prog projeto-barra"><i style="width:${p.progresso}%"></i></div>
      <div class="grade g2">
        <div><h3 class="subtitulo-entrega">Escopo aprovado</h3>
          ${p.entregas.map((x) => { const ts=p.tarefas.filter((t)=>t.entrega_id===x.id), rs=p.responsaveis.filter((r)=>r.entrega_id===x.id); return `<div class="linha-entrega"><span class="tag ${tag(x.status)}">${A.esc(rotulo(x.status))}</span><span class="linha-entrega-texto">${A.esc(x.titulo)}<small class="mini">${rs.length ? A.esc(rs.map(r=>r.nome).join(' · ')) : 'Sem responsáveis'} · ${ts.length} tarefa(s)</small></span><button class="btn pq vazio" data-entrega="${x.id}">Planejar</button></div>`; }).join('')}
        </div>
        <div><h3 class="subtitulo-entrega">Acompanhamento · ${p.acompanhamento_meses} mês(es) contratados</h3>
          ${p.acompanhamentos.length ? p.acompanhamentos.map((a) => `<div class="linha-entrega"><span class="tag ${tag(a.status)}">${A.esc(rotulo(a.status))}</span><span class="linha-entrega-texto">${A.esc(a.nome || a.competencia)}</span><button class="btn pq vazio" data-acomp="${a.id}">Atualizar</button></div>`).join('') : (p.acompanhamento_meses ? `<p class="mini">Aguardando conclusão do Diagnóstico.</p><button class="btn pq" data-liberar="${p.id}">Liberar acompanhamento</button>` : '<p class="mini">Sem acompanhamento contratado.</p>')}
        </div>
      </div>
      ${p.tarefas.filter((t) => t.status !== 'concluida').length ? `<section class="tarefas-projeto"><h3 class="subtitulo-entrega">Tarefas em andamento</h3>
        ${p.tarefas.filter((t) => t.status !== 'concluida').map((t) => { const entrega = p.entregas.find((x) => x.id === t.entrega_id); return `<div class="tarefa-projeto-linha"><span class="tag ${tag(t.status)}">${A.esc(rotulo(t.status))}</span><span class="linha-entrega-texto"><b>${A.esc(t.titulo)}</b><small class="mini">${A.esc(entrega?.titulo || 'Etapa não identificada')}${t.data_conclusao ? ` · previsão ${A.esc(t.data_conclusao)}` : ''}${t.envolve_cliente ? ' · envolve cliente' : ''}</small>${t.pendencia_cliente ? `<small class="mini pendencia-cliente">Pendência: ${A.esc(t.pendencia_cliente)}</small>` : ''}</span><button class="btn pq vazio" data-tarefa="${t.id}">Atualizar</button></div>`; }).join('')}
      </section>` : ''}
    </section>`).join('') || A.vazio('Nenhum projeto aprovado', 'Aprove uma proposta para iniciar o controle de execução.')}</div>`;

  el.querySelectorAll('[data-aprovar]').forEach((b) => { b.onclick = () => {
    const p = d.propostas.find((x) => x.id === Number(b.dataset.aprovar));
    const m = A.modal({ titulo: `Aprovação do escopo — ${p.razao_social}`, largura: 620,
      corpo: `<div class="aviso"><b>O escopo será congelado</b>Os módulos do combo/proposta passam a ser a referência para a evolução deste projeto. Alterações futuras no catálogo não o modificam.</div>
        ${A.campo('acompanhamento_meses', 'Meses de acompanhamento liberados', p.acompanhamento_meses || 3, 'number', 'min=0 max=36')}
        ${A.area('observacoes', 'Observações do fechamento', p.observacoes || '', 3)}`,
      aoConfirmar: async (form) => { await A.api(`/contratacoes/${p.id}/aprovar`, { metodo: 'POST', corpo: form }); A.toast('Escopo aprovado e módulos liberados', 'ok'); A.ir('gestaoProjetos'); } });
  }; });
  el.querySelectorAll('[data-liberar]').forEach((b) => { b.onclick = () => {
    const p = d.projetos.find((x) => x.id === Number(b.dataset.liberar));
    const m = A.modal({ titulo: `Liberar acompanhamento — ${p.razao_social}`,
      corpo: `<div class="aviso"><b>${p.acompanhamento_meses} mês(es)</b> serão criados a partir da referência informada.</div>${A.campo('competencia_referencia', 'Mês e ano de referência', '', 'month')}`,
      aoConfirmar: async (form) => { await A.api(`/contratacoes/${p.id}/liberar-acompanhamento`, { metodo: 'POST', corpo: form }); A.toast('Acompanhamento liberado', 'ok'); A.ir('gestaoProjetos'); } });
    const campo = m.fundo.querySelector('[name="competencia_referencia"]'); if (campo) campo.value = new Date().toISOString().slice(0, 7);
  }; });
  el.querySelectorAll('[data-entrega]').forEach((b) => { b.onclick = () => {
    const x = d.projetos.flatMap((p) => p.entregas).find((v) => v.id === Number(b.dataset.entrega));
    const p = d.projetos.find((p) => p.entregas.some((v) => v.id === x.id));
    const rs = p.responsaveis.filter((r) => r.entrega_id === x.id), ts = p.tarefas.filter((t) => t.entrega_id === x.id);
    A.modal({ titulo: `Entrega — ${x.titulo}`, largura: 760, corpo: A.selecao('status', 'Situação', statusEntrega, x.status) + A.area('observacoes', 'Observações da entrega', x.observacoes || '', 2) +
      `<h3>Responsáveis</h3><p class="mini">${rs.length ? A.esc(rs.map((r)=>`${r.lado==='sattva'?'Sattva':'Cliente'}: ${r.nome}${r.email?' · '+r.email:''}`).join(' | ')) : 'Cadastre os responsáveis abaixo.'}</p><div class="grade g2">${A.campo('responsavel_sattva','Responsável Sattva','')}${A.campo('funcao_sattva','Função / papel','')}${A.campo('telefone_sattva','Telefone','')}${A.campo('email_sattva','E-mail','email')}${A.campo('responsavel_cliente','Responsável do cliente','')}${A.campo('funcao_cliente','Função / área','')}${A.campo('telefone_cliente','Telefone','')}${A.campo('email_cliente','E-mail','email')}</div>`+
      `<h3>Tarefas da etapa</h3><p class="mini">${ts.length ? A.esc(ts.map((t)=>`${t.titulo} (${t.status})`).join(' · ')) : 'Inclua a primeira tarefa desta etapa.'}</p>${A.campo('tarefa_titulo','Nova tarefa','')}<div class="grade g2">${A.campo('tarefa_abertura','Data de abertura','','date')}${A.campo('tarefa_conclusao','Previsão/conclusão','','date')}${A.selecao('tarefa_status','Situação',[{v:'aberta',t:'Aberta'},{v:'em_andamento',t:'Em andamento'},{v:'concluida',t:'Concluída'}],'aberta')}</div><label class="check"><input type="checkbox" name="envolve_cliente"> Envolve pendência ou interação do cliente</label>${A.area('pendencia_cliente','Pendência do cliente','',2)}${A.area('interacoes_cliente','Interações / histórico','',2)}${A.area('tarefa_descricao','Detalhamento da tarefa','',2)}`,
      aoConfirmar: async (form) => { await A.api(`/projeto/entregas/${x.id}`, { metodo: 'PUT', corpo: form }); A.ir('gestaoProjetos'); } });
  }; });
  el.querySelectorAll('[data-acomp]').forEach((b) => { b.onclick = () => {
    const x = d.projetos.flatMap((p) => p.acompanhamentos).find((v) => v.id === Number(b.dataset.acomp));
    A.modal({ titulo: `Acompanhamento — ${x.competencia}`, corpo: A.campo('nome', 'Nome do mês / encontro', x.nome) + A.selecao('status', 'Situação', statusAcomp, x.status) + A.area('observacoes', 'Observações', x.observacoes || '', 3),
      aoConfirmar: async (form) => { await A.api(`/projeto/acompanhamentos/${x.id}`, { metodo: 'PUT', corpo: form }); A.ir('gestaoProjetos'); } });
  }; });
  el.querySelectorAll('[data-tarefa]').forEach((b) => { b.onclick = () => {
    const t = d.projetos.flatMap((p) => p.tarefas).find((v) => v.id === Number(b.dataset.tarefa));
    A.modal({ titulo: `Tarefa — ${t.titulo}`, largura: 720,
      corpo: `${A.selecao('status', 'Situação', [{ v: 'aberta', t: 'Aberta' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluida', t: 'Concluída' }], t.status)}${A.campo('titulo', 'Título', t.titulo)}<div class="grade g2">${A.campo('data_abertura', 'Data de abertura', t.data_abertura, 'date')}${A.campo('data_conclusao', 'Previsão/conclusão', t.data_conclusao, 'date')}</div><label class="check"><input type="checkbox" name="envolve_cliente" ${t.envolve_cliente ? 'checked' : ''}> Envolve pendência ou interação do cliente</label>${A.area('pendencia_cliente', 'Pendência do cliente', t.pendencia_cliente || '', 2)}${A.area('interacoes_cliente', 'Interações / histórico', t.interacoes_cliente || '', 2)}${A.area('descricao', 'Detalhamento da tarefa', t.descricao || '', 2)}`,
      aoConfirmar: async (form) => { await A.api(`/projeto/tarefas/${t.id}`, { metodo: 'PUT', corpo: form }); A.ir('gestaoProjetos'); } });
  }; });
};

Telas.dashboardOperacao = async (el) => {
  const d = await A.api('/operacao/dashboard');
  const concluidos = d.projetos.filter((p) => p.status === 'concluido').length;
  const emAndamento = d.projetos.filter((p) => p.status === 'em_execucao').length;
  el.innerHTML = cab('Operação compartilhada', 'Acompanhamento geral',
    'Visão única da carteira: escopo aprovado, avanço das entregas e próximos acompanhamentos.') +
    `<div class="grade g4">${A.kpi('Clientes na base', d.empresas, 'base compartilhada')}
      ${A.kpi('Projetos em execução', emAndamento, 'escopo aprovado')}
      ${A.kpi('Entregas pendentes', d.resumo.entregasPendentes, 'prioridade da operação', d.resumo.entregasPendentes ? 'destaque' : '')}
      ${A.kpi('Projetos concluídos', concluidos, 'entregas finalizadas')}</div>
     <div class="cartao carteira-operacao"><div class="cabecalho-lista"><div><h2>Carteira de projetos</h2><p class="desc">Acompanhe o que está em execução e a próxima interação prevista para cada cliente.</p></div><span class="tag">${d.projetos.length} projetos</span></div>
       ${d.projetos.length ? `<div class="projetos-operacao">${d.projetos.map((p) => `<article class="projeto-operacao-card">
          <div class="projeto-operacao-cabecalho"><div><h3>${A.esc(p.empresa)}</h3><p>${A.esc(p.nome_plano || 'Escopo personalizado')}</p></div><span class="tag ${p.status === 'em_execucao' ? 'b' : p.status === 'concluido' ? 'c' : 'n'}">${A.esc(p.status)}</span></div>
          <div class="projeto-operacao-progresso"><div><span>Evolução das entregas</span><b>${p.entregasConcluidas}/${p.entregas} · ${p.progresso}%</b></div><div class="barra-prog"><i style="width:${p.progresso}%"></i></div></div>
          <div class="projeto-operacao-rodape"><span><b>Próximo acompanhamento</b>${A.esc(p.proximoAcompanhamento || 'A definir')}</span><button class="btn pq vazio" data-ir-projeto="${p.empresa_id || ''}">Abrir projeto</button></div>
        </article>`).join('')}</div>` : A.vazio('Nenhum escopo sincronizado ainda.', 'Registre e aprove o primeiro escopo do cliente.')}
     </div>`;
  el.querySelectorAll('[data-ir-projeto]').forEach((botao) => { botao.onclick = async () => {
    if (botao.dataset.irProjeto) { localStorage.setItem('sattva_empresa', botao.dataset.irProjeto); await A.carregarEmpresas(); }
    A.ir('painel');
  }; });
};
})();
