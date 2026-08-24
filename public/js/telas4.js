/* =========================================================================
   TELA — Bases de classificação tributária (NCM e NBS/LC116)
   ========================================================================= */
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') =>
  `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
   <div class="acoes-topo">${acoes}</div></div>`;

Telas.bases = async (el) => {
  const { estatisticas: e } = await A.api('/bases');
  const pend = S.empresaId ? (await A.api(`/empresas/${S.empresaId}/bases/pendencias`)).pendencias : [];
  const temBase = e.ncm.linhas > 0 || e.servicos.linhas > 0;

  el.innerHTML = cab('Cadastros base', 'Classificação tributária',
    'As duas bases oficiais que dizem em qual tributação cada produto e cada serviço se enquadra. É delas que sai a redução aplicada no cálculo — sem elas, tudo entra como tributação integral.') +
    `<div class="grade g4">
      ${A.kpi('NCMs na base', e.ncm.unicos || 0, `${e.ncm.linhas || 0} linhas de classificação`)}
      ${A.kpi('NCMs com mais de um enquadramento', e.ncm.comMultiplosCandidatos || 0, 'exigem decisão do consultor', e.ncm.comMultiplosCandidatos ? 'destaque' : '')}
      ${A.kpi('NBS na base', e.servicos.nbs || 0, `${e.servicos.lc116 || 0} itens da LC 116`)}
      ${A.kpi('Pendências nesta empresa', pend.length, S.empresaId ? 'NCMs a decidir na movimentação' : 'selecione uma empresa')}
    </div>
    <div class="cartao" style="margin-top:16px;border-left:4px solid var(--ouro)">
      <h2>Catálogo fiscal completo — PIS/COFINS</h2>
      <p class="desc">Importe uma única vez a planilha com as abas <span class="mono">Produtos NCM</span> e <span class="mono">Serviços NBS</span>. Ela atualiza as duas bases e alimenta a reconstrução da carga atual sem depender do Excel depois da importação.</p>
      <div class="dropzone" id="zonaCatalogo"><b>Solte o catálogo fiscal completo aqui</b><div class="mini">.xlsx · produtos, serviços, cumulatividade e regras de reconstrução</div></div>
      <div id="statusCatalogo" style="margin-top:12px"></div>
    </div>
    <div class="grade g2" style="margin-top:16px">
      <div class="cartao">
        <h2>Base de mercadorias — NCM</h2>
        <p class="desc">Planilha com NCM, CST, cClassTrib, anexo da LC 214, fundamento e percentuais de redução de IBS e CBS. Aba esperada: <span class="mono">Detalhamento candidatos</span>.</p>
        <div class="dropzone" id="zonaNcm"><b>Solte a planilha de NCM aqui</b><div class="mini">substitui a base atual · .xlsx</div></div>
        <div id="statusNcm" style="margin-top:12px"></div>
      </div>
      <div class="cartao">
        <h2>Base de serviços — LC 116 + NBS</h2>
        <p class="desc">Planilha de correlação com Item LC 116, NBS, INDOP, local de incidência do IBS e cClassTrib. Aba esperada: <span class="mono">tabela geral</span>.</p>
        <div class="dropzone" id="zonaServ"><b>Solte a planilha de correlação aqui</b><div class="mini">substitui a base atual · .xlsx</div></div>
        <div id="statusServ" style="margin-top:12px"></div>
      </div>
    </div>
    ${temBase ? `
    <div class="cartao">
      <h2>Consultar a base</h2>
      <p class="desc">Digite um NCM, uma NBS, um item da LC 116 ou parte de uma descrição</p>
      <div style="display:flex;gap:8px">
        <input type="text" id="buscaBase" placeholder="Ex.: 3004.90.99, 1.1502.10.00, 01.01, medicamento">
        <button class="btn" id="btnBusca">Buscar</button>
      </div>
      <div id="resultadoBase" style="margin-top:14px"></div>
    </div>
    <div class="cartao">
      <h2>Classificar a movimentação</h2>
      <p class="desc">Cruza cada lançamento importado com as bases e grava a redução correta. Lançamentos com mais de um enquadramento possível ficam pendentes — o sistema não escolhe por você.</p>
      <button class="btn ouro" id="classificar" ${S.empresaId ? '' : 'disabled'}>
        ${S.empresaId ? 'Classificar movimentação desta empresa' : 'Selecione uma empresa'}</button>
      <div id="statusClass" style="margin-top:14px"></div>
    </div>` : `<div class="cartao">${A.vazio('Bases ainda não carregadas',
      'Suba as duas planilhas acima. Enquanto elas não existirem, todo lançamento é calculado como tributação integral — o que subestima o benefício de quem tem redução e superestima a carga.')}</div>`}
    ${pend.length ? `<div class="cartao">
      <h2>Pendências de enquadramento</h2>
      <p class="desc">Estes NCMs têm mais de um enquadramento possível na base. Escolha o que se aplica à operação real do cliente — a decisão vale para todos os lançamentos daquele NCM.</p>
      ${pend.map((p) => `<div class="cartao" style="box-shadow:none;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div><b class="mono">${A.esc(p.ncm)}</b>
            <div class="mini">${A.esc(p.exemplo || '')} · ${p.itens} lançamentos</div></div>
          <b class="mono">${A.moeda(p.valor)}</b>
        </div>
        <div class="lista-sel" style="margin-top:10px">
          ${p.candidatos.map((c) => `<div class="it" data-ncm="${A.esc(p.ncm)}" data-cls="${A.esc(c.cclasstrib)}">
            <span><span class="nome">${A.esc(c.classificacao || c.cclasstrib)}</span>
              <span class="txt">${A.esc(c.regra || '')}</span>
              <span class="txt mini">cClassTrib ${A.esc(c.cclasstrib)} · CST ${A.esc(c.cst)}${c.anexo ? ` · Anexo ${A.esc(c.anexo)}` : ''}${c.fundamento ? ` · ${A.esc(c.fundamento)}` : ''}</span></span>
            <span class="preco">${c.reducao_ibs != null ? A.pct(c.reducao_ibs, 0) : '—'}<div class="mini" style="text-align:right">redução</div></span>
          </div>`).join('')}
        </div>
      </div>`).join('')}
    </div>` : ''}`;

  // ---- uploads ----
  const ligarZona = (idZona, tipo, idStatus) => {
    const z = document.getElementById(idZona);
    if (!z) return;
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.xlsx,.xls'; i.style.display = 'none';
    z.appendChild(i);
    z.onclick = () => i.click();
    z.ondragover = (ev) => { ev.preventDefault(); z.classList.add('sobre'); };
    z.ondragleave = () => z.classList.remove('sobre');
    z.ondrop = (ev) => { ev.preventDefault(); z.classList.remove('sobre'); if (ev.dataTransfer.files[0]) enviar(ev.dataTransfer.files[0]); };
    i.onchange = () => { if (i.files[0]) enviar(i.files[0]); i.value = ''; };
    async function enviar(f) {
      const box = document.getElementById(idStatus);
      box.innerHTML = '<div class="aviso">Lendo e indexando a planilha…</div>';
      const fd = new FormData(); fd.append('arquivo', f);
      try {
        const r = await A.api(`/bases/importar/${tipo}`, { metodo: 'POST', corpo: fd });
        box.innerHTML = `<div class="aviso bom"><b>${r.importados} registros carregados</b>
          Aba lida: ${A.esc(r.aba)}${r.unicos ? ` · ${r.unicos} NCMs únicos` : ''}${r.comMultiplosCandidatos ? ` · ${r.comMultiplosCandidatos} com mais de um enquadramento` : ''}
          ${r.ignorados ? `<div class="acao">${r.ignorados} linhas ignoradas por falta de código válido</div>` : ''}</div>
          ${(r.mensagens || []).map((m) => `<div class="aviso atencao">${A.esc(m)}</div>`).join('')}
          ${r.reclassificacao && r.reclassificacao.empresas ? `<div class="aviso bom">
            <b>${r.reclassificacao.totalMovimentos} lançamentos reclassificados automaticamente</b>
            em ${r.reclassificacao.empresas} empresa(s) já cadastrada(s)
            ${r.reclassificacao.requerDecisao ? ` · ${r.reclassificacao.requerDecisao} passaram a exigir decisão do consultor` : ''}
            ${r.reclassificacao.naoEncontrado ? ` · ${r.reclassificacao.naoEncontrado} sem correspondência na base` : ''}
            <div class="acao">As projeções e cenários refletem a base nova ao serem abertos. Para atualizar a aba Classificações, execute novamente o motor na tela Projeção de fornecedores.</div>
          </div>` : ''}`;
        setTimeout(() => A.ir('bases'), 2600);
      } catch (err) { box.innerHTML = `<div class="aviso alto"><b>Não foi possível importar</b>${A.esc(err.message)}</div>`; }
    }
  };
  ligarZona('zonaNcm', 'ncm', 'statusNcm');
  ligarZona('zonaServ', 'servicos', 'statusServ');
  ligarZona('zonaCatalogo', 'catalogo-fiscal', 'statusCatalogo');

  // ---- busca ----
  const btn = document.getElementById('btnBusca');
  if (btn) {
    const buscar = async () => {
      const q = document.getElementById('buscaBase').value.trim();
      if (!q) return;
      const box = document.getElementById('resultadoBase');
      box.innerHTML = '<div class="carregando">Buscando…</div>';
      const r = await A.api(`/bases/buscar?q=${encodeURIComponent(q)}`);
      box.innerHTML =
        (r.ncm.length ? `<h3 style="font-size:13px;color:var(--navy-900)">Mercadorias (NCM)</h3>
          ${A.tabela([
            { t: 'NCM', r: (x) => `<span class="mono">${A.esc(x.ncm)}</span>${x.candidatos > 1 ? '<div class="mini"><span class="tag b">' + x.candidatos + ' enquadramentos</span></div>' : ''}` },
            { t: 'Descrição', r: (x) => `<span class="mini">${A.esc((x.descricao || '').slice(0, 70))}</span>` },
            { t: 'CST', r: (x) => `<span class="mono mini">${A.esc(x.cst)}</span>` },
            { t: 'cClassTrib', r: (x) => `<span class="mono mini">${A.esc(x.cclasstrib)}</span>` },
            { t: 'Classificação', r: (x) => `<span class="mini">${A.esc((x.classificacao || '').slice(0, 60))}</span>` },
            { t: 'Anexo', r: (x) => A.esc(x.anexo || '—') },
            { t: 'Redução', num: true, r: (x) => x.reducao_ibs != null ? A.pct(x.reducao_ibs, 0) : '—' },
            { t: 'No sistema', r: (x) => `<span class="tag">${A.esc(x.reducao)}</span>` },
          ], r.ncm)}` : '')
        + (r.servicos.length ? `<h3 style="font-size:13px;color:var(--navy-900);margin-top:16px">Serviços (LC 116 + NBS)</h3>
          ${A.tabela([
            { t: 'LC 116', r: (x) => `<span class="mono">${A.esc(x.lc116)}</span>` },
            { t: 'Item', r: (x) => `<span class="mini">${A.esc((x.descricao_item || '').slice(0, 50))}</span>` },
            { t: 'NBS', r: (x) => `<span class="mono">${A.esc(x.nbs)}</span>` },
            { t: 'Descrição NBS', r: (x) => `<span class="mini">${A.esc((x.descricao_nbs || '').slice(0, 60))}</span>` },
            { t: 'INDOP', r: (x) => `<span class="mono mini">${A.esc(x.indop)}</span>` },
            { t: 'Local de incidência', r: (x) => `<span class="mini">${A.esc(x.local_incidencia)}</span>` },
            { t: 'cClassTrib', r: (x) => `<span class="mono mini">${A.esc(x.cclasstrib)}</span>` },
            { t: 'No sistema', r: (x) => `<span class="tag">${A.esc(x.reducao)}</span>` },
          ], r.servicos)}` : '')
        || '<div class="mini">Nada encontrado.</div>';
    };
    btn.onclick = buscar;
    document.getElementById('buscaBase').onkeydown = (ev) => { if (ev.key === 'Enter') buscar(); };
  }

  // ---- classificação em lote ----
  const bc = document.getElementById('classificar');
  if (bc) bc.onclick = async () => {
    const box = document.getElementById('statusClass');
    box.innerHTML = '<div class="carregando">Classificando…</div>';
    try {
      const { resultado: r } = await A.api(`/empresas/${S.empresaId}/bases/classificar`, { metodo: 'POST' });
      box.innerHTML = `<div class="grade g4">
          ${A.kpi('Lançamentos', r.total)}
          ${A.kpi('Classificados por NCM', r.porNcm)}
          ${A.kpi('Classificados por NBS', r.porNbs)}
          ${A.kpi('Requerem decisão', r.requerDecisao, '', r.requerDecisao ? 'destaque' : '')}
        </div>
        ${r.naoEncontrado ? `<div class="aviso atencao" style="margin-top:12px"><b>${r.naoEncontrado} lançamentos sem correspondência nas bases</b>
          Entram como tributação integral. Verifique se o NCM está correto no cadastro de produtos — NCM inválido é apontamento fiscal, não só imprecisão de cálculo.</div>` : ''}`;
      if (r.requerDecisao) setTimeout(() => A.ir('bases'), 1800);
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  };

  // ---- decisão de enquadramento ----
  el.querySelectorAll('[data-ncm]').forEach((it) => { it.onclick = async () => {
    try {
      const r = await A.api(`/empresas/${S.empresaId}/bases/decidir`, { metodo: 'POST',
        corpo: { ncm: it.dataset.ncm, cclasstrib: it.dataset.cls } });
      A.toast(`${r.atualizados} lançamentos reclassificados como ${r.reducao}`, 'ok');
      A.ir('bases');
    } catch (e) { A.toast(e.message, 'erro'); }
  }; });
};
})();
