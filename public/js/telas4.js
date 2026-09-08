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
  const matriz = await A.api('/bases/matriz-fiscal/resumo');

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
      <div style="margin-top:10px"><button class="btn vazio pq" onclick="App.baixarArquivo('/bases/modelo/catalogo-fiscal').catch(e=>App.toast(e.message,'erro'))">Baixar modelo</button></div>
      <div id="statusCatalogo" style="margin-top:12px"></div>
    </div>
    <div class="cartao" style="margin-top:16px;border-left:4px solid var(--azul)"><h2>Matriz operacional — PIS/Cofins e CBS</h2><p class="desc">Cada linha completa atualiza, sem apagar a base existente, a mesma regra usada pelo motor para CBS e reconstrução de PIS/Cofins. Exige chave oficial, vigência, fonte e fundamento. Regras condicionais de PIS/Cofins só entram quando todos os fatos estão estruturados.</p><div class="grade g3" style="margin:12px 0">${A.kpi('Regras NCM',(matriz.regras||[]).filter(x=>x.tipo_chave==='NCM').reduce((s,x)=>s+Number(x.quantidade||0),0),'ativas no catálogo')}${A.kpi('Regras de serviços',(matriz.regras||[]).filter(x=>x.tipo_chave==='NBS_LC116').reduce((s,x)=>s+Number(x.quantidade||0),0),'ativas no catálogo')}${A.kpi('PIS condicionais',(matriz.regras||[]).filter(x=>x.tipo_chave==='PIS_CONDICIONAL').reduce((s,x)=>s+Number(x.quantidade||0),0),'com fatos estruturados')}</div><div class="dropzone" id="zonaMatrizFiscal"><b>Solte a matriz operacional PIS/Cofins + CBS aqui</b><div class="mini">.xlsx · atualização incremental do catálogo</div></div><div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn vazio pq" onclick="App.baixarArquivo('/bases/matriz-fiscal/modelo').catch(e=>App.toast(e.message,'erro'))">Baixar modelo integrado</button><button class="btn ouro pq" id="completarCoberturaFiscal">Completar cobertura oficial</button></div><div class="mini" style="margin-top:8px">Cria somente regra residual para códigos oficiais ainda sem regra específica: CBS integral e PIS/Cofins conforme o regime. Regras específicas existentes têm precedência.</div><div id="statusMatrizFiscal" style="margin-top:12px"></div></div>
    <div class="grade g2" style="margin-top:16px">
      <div class="cartao">
        <h2>Base de mercadorias — NCM</h2>
        <p class="desc">Planilha com NCM, CST, cClassTrib, anexo da LC 214, fundamento e percentuais de redução de IBS e CBS. Aba esperada: <span class="mono">Detalhamento candidatos</span>.</p>
        <div class="dropzone" id="zonaNcm"><b>Solte a planilha de NCM aqui</b><div class="mini">substitui a base atual · .xlsx</div></div>
        <div style="margin-top:10px"><button class="btn vazio pq" onclick="App.baixarArquivo('/bases/modelo/ncm').catch(e=>App.toast(e.message,'erro'))">Baixar modelo</button></div>
        <div id="statusNcm" style="margin-top:12px"></div>
      </div>
      <div class="cartao">
        <h2>Base de serviços — LC 116 + NBS</h2>
        <p class="desc">Planilha de correlação com Item LC 116, NBS, INDOP, local de incidência do IBS e cClassTrib. Aba esperada: <span class="mono">tabela geral</span>.</p>
        <div class="dropzone" id="zonaServ"><b>Solte a planilha de correlação aqui</b><div class="mini">substitui a base atual · .xlsx</div></div>
        <div style="margin-top:10px"><button class="btn vazio pq" onclick="App.baixarArquivo('/bases/modelo/servicos').catch(e=>App.toast(e.message,'erro'))">Baixar modelo</button></div>
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
  const zonaMatriz = document.getElementById('zonaMatrizFiscal');
  if (zonaMatriz) { const i=document.createElement('input'); i.type='file'; i.accept='.xlsx,.xls'; i.style.display='none'; zonaMatriz.appendChild(i); zonaMatriz.onclick=()=>i.click(); zonaMatriz.ondragover=e=>{e.preventDefault();zonaMatriz.classList.add('sobre');}; zonaMatriz.ondragleave=()=>zonaMatriz.classList.remove('sobre'); zonaMatriz.ondrop=e=>{e.preventDefault();zonaMatriz.classList.remove('sobre');if(e.dataTransfer.files[0]) enviarMatriz(e.dataTransfer.files[0]);}; i.onchange=()=>{if(i.files[0])enviarMatriz(i.files[0]);i.value='';}; async function enviarMatriz(f){const box=document.getElementById('statusMatrizFiscal');box.innerHTML='<div class="aviso">Validando matriz e sincronizando catálogo…</div>';const fd=new FormData();fd.append('arquivo',f);try{const r=await A.api('/bases/matriz-fiscal/importar',{metodo:'POST',corpo:fd});box.innerHTML=`<div class="aviso bom"><b>${r.regras_importadas} regra(s) operacionais sincronizadas</b><br>NCM: ${r.ncm} · Serviços: ${r.servicos} · PIS condicionais: ${r.condicionais_pis}. ${r.criadas} criada(s), ${r.atualizadas} atualizada(s). Nenhuma regra existente foi apagada.</div>`;setTimeout(()=>A.ir('bases'),1800);}catch(e){box.innerHTML=`<div class="aviso alto"><b>Carga bloqueada</b><br>${A.esc(e.message)}</div>`;}} }
  const btnCobertura = document.getElementById('completarCoberturaFiscal');
  if (btnCobertura) btnCobertura.onclick = async () => { const box=document.getElementById('statusMatrizFiscal'); btnCobertura.disabled=true; box.innerHTML='<div class="aviso">Completando a cobertura oficial e marcando movimentos para reclassificação…</div>'; try { const r=await A.api('/bases/matriz-fiscal/completar-cobertura',{metodo:'POST'}); box.innerHTML=`<div class="aviso bom"><b>Cobertura oficial concluída</b><br>${r.ncm_residuais_criados} NCM(s) e ${r.nbs_residuais_criados} NBS(s) receberam regra residual. ${r.existentes_preservados} regra(s) específica(s) existente(s) foram preservadas.</div>`; setTimeout(()=>A.ir('bases'),1800); } catch(e) { box.innerHTML=`<div class="aviso alto"><b>Cobertura bloqueada</b><br>${A.esc(e.message)}</div>`; btnCobertura.disabled=false; } };

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

// Pendências que ainda requerem uma decisão ou evidência humana. Ficam
// deliberadamente no menu Diagnóstico para não parecerem um detalhe escondido
// dentro da cobertura do motor.
Telas.pendenciasDiagnostico = async (el) => {
  const d = await A.api(`/empresas/${S.empresaId}/cobertura-diagnostico`);
  const pendencias = d.fotografia?.pendencias_operacionais || [];
  const valor = pendencias.reduce((s, x) => s + (Number(x.valor) || 0), 0);
  el.innerHTML = cab('DIAGNÓSTICO · AÇÃO NECESSÁRIA', 'Pendências do diagnóstico',
    'Estas são somente operações em que o motor não conseguiu concluir classificação, tratamento, reconstrução ou crédito com segurança. Resultados já determinados ou tratados pelo motor não aparecem nesta lista.') +
    `<div class="aviso atencao" style="margin-top:16px"><b>${pendencias.length} pendência(s) requerem atuação humana.</b><br>Abra a operação, confira a evidência existente e execute a ação indicada. A pendência deixa de aparecer quando o motor conseguir determinar o resultado com segurança.</div>
    <div class="grade g3" style="margin-top:16px">${A.kpi('Operações pendentes', pendencias.length, 'uma causa principal por operação')}${A.kpi('Valor sujeito a validação', A.moeda(valor), 'sem dupla contagem')}${A.kpi('Exceções abertas', d.excecoes?.resumo?.abertas || 0, 'fotografia oficial')}</div>
    <div class="cartao" style="margin-top:16px"><h2>Fila de atuação humana</h2>${pendencias.length ? A.tabela([
      { t:'Operação', r:x=>`<b>#${A.esc(x.movimento_id)}</b><div class="mini">${A.esc(x.documento)}</div><div class="mini">${A.esc(x.parceiro)}</div>` },
      { t:'Valor', num:true, r:x=>A.moeda(x.valor) },
      { t:'Por que requer ação', r:x=>`<b>${A.esc(x.dimensao)}</b> · ${A.esc(x.status)}<div class="mini">${A.esc(x.causa)}</div>` },
      { t:'Ação necessária', r:x=>`${A.esc(x.acao)}<div class="mini">Fonte mínima: ${A.esc(x.fonte_minima)}</div><button class="btn pq vazio" data-abrir-pendencia="${A.esc(x.movimento_id)}">Abrir lançamento</button>` },
    ], pendencias) : A.vazio('Não há pendências que exijam atuação humana.', 'A execução oficial atual está determinada ou tratada pelo motor.')}</div>`;
  el.querySelectorAll('[data-abrir-pendencia]').forEach((botao) => botao.addEventListener('click', () => {
    const contexto = pendencias.find((x) => String(x.movimento_id) === String(botao.dataset.abrirPendencia));
    if (!contexto) return;
    S.aba.dados = contexto.sentido === 'saida' ? 'cliente' : 'fornecedor';
    S.aba.dadosPendencia = contexto;
    S.aba.centralDados = 'documentos';
    A.ir('dados');
  }));
};

// Leitura documental independente: não executa motor nem modifica lançamento.
Telas.conformidadeDocumental = async (el) => {
  const d = await A.api(`/empresas/${S.empresaId}/conformidade-documental`);
  const itens = d.itens || [];
  const tipos = [...new Set(itens.map((x) => x.tipo))];
  // A regra repetida deixa de ocupar cada linha. Ela recebe um código curto
  // e aparece uma única vez no rodapé da lista.
  const temBeneficioFiscal = (c) => !['', 'integral', 'tributação integral', 'tributacao integral'].includes(String(c.reducao || c.tratamento || '').trim().toLowerCase());
  const regras = [...new Set(itens.flatMap((x) => (x.candidatos || []).filter(temBeneficioFiscal).map((c) => c.regra_uso || 'Confirme a condição legal e a descrição efetiva do serviço.')))]
    .map((texto, indice) => ({ codigo: `R${String(indice + 1).padStart(2, '0')}`, texto }));
  const codigoRegra = (texto) => regras.find((x) => x.texto === (texto || 'Confirme a condição legal e a descrição efetiva do serviço.'))?.codigo || '—';
  const tabelaItens = (itensDaAmostra) => {
    const gruposDeErro = new Map();
    for (const item of itensDaAmostra) {
      const chave = [item.tipo, item.lc116 || '', item.nbs || ''].join('|');
      const grupo = gruposDeErro.get(chave) || { item, ocorrencias: [], candidatos: new Map() };
      grupo.ocorrencias.push(item);
      for (const candidato of item.candidatos || []) {
        const chaveCandidato = [candidato.lc116 || '', candidato.nbs || '', candidato.cst || '', candidato.cclasstrib || '', candidato.reducao || ''].join('|');
        if (!grupo.candidatos.has(chaveCandidato)) grupo.candidatos.set(chaveCandidato, candidato);
      }
      gruposDeErro.set(chave, grupo);
    }
    // Uma correspondência fiscal por linha. As informações do erro são
    // repetidas intencionalmente nas duas primeiras colunas para permitir
    // comparar opções como em uma tabela de base de dados.
    const linhas = [...gruposDeErro.values()].flatMap((erro) => {
      const opcoes = [...erro.candidatos.values()];
      return (opcoes.length ? opcoes : [null]).map((candidato) => ({ ...erro, candidato }));
    });
    return A.tabela([
      { t:'Não conformidade', r:x=>`<span class="tag ${x.item.severidade === 'ALTA' ? 'a' : 'b'}">${A.esc(x.item.tipo)}</span><div style="margin-top:6px"><b>${A.esc(x.item.titulo)}</b></div><div class="mini">LC 116: ${A.esc(x.item.lc116 || 'não informado')} · NBS: ${A.esc(x.item.nbs || 'não informado')}</div>` },
      { t:'Ocorrências e exemplos', r:x=>`${x.ocorrencias.length} ocorrência(s)<div class="mini" style="margin-top:6px">${x.ocorrencias.slice(0, 2).map((i) => `${A.esc(i.documento || 'sem número')} · item ${A.esc(i.item_numero || '—')} · ${A.esc(i.contraparte)}`).join('<br>')}</div>${x.ocorrencias.length > 2 ? '<div class="mini">+ outros documentos com o mesmo erro</div>' : ''}` },
      { t:'LC 116 compatível', r:x=>A.esc(x.candidato?.lc116 || '—') },
      { t:'NBS compatível', r:x=>x.candidato ? `${A.esc(x.candidato.nbs || '—')}<div class="mini">${A.esc(x.candidato.descricao_nbs || '')}</div>` : 'Nenhuma correlação cadastrada' },
      { t:'CST / cClassTrib', r:x=>x.candidato ? `${A.esc(x.candidato.cst || 'CST não informado no catálogo')}<div class="mini">${A.esc(x.candidato.cclasstrib || '—')}</div>` : '—' },
      { t:'Tratamento', r:x=>x.candidato ? `${A.esc(x.candidato.tratamento || '—')}<div class="mini">${A.esc(x.candidato.reducao || '')}</div>` : '—' },
      { t:'Quando usar', r:x=>x.candidato && temBeneficioFiscal(x.candidato) ? `<span class="tag n">${codigoRegra(x.candidato.regra_uso)}</span><div class="mini">Ver regra no rodapé</div>` : '—' },
    ], linhas, { vazio:'Nenhum item neste grupo.' });
  };
  const render = (filtro = '') => {
    const visiveis = !filtro ? itens : itens.filter((x) => x.tipo === filtro);
    el.querySelector('#listaConformidade').innerHTML = visiveis.length
      ? tabelaItens(visiveis)
      : A.vazio('Nenhuma não conformidade documental encontrada.', 'Os documentos com LC 116 ou NBS possuem chave compatível com o catálogo atual.');
  };
  const resumoTipos = tipos.map((tipo) => {
    const grupo = itens.filter((x) => x.tipo === tipo);
    const erros = new Set(grupo.map((x) => [x.tipo, x.lc116 || '', x.nbs || ''].join('|'))).size;
    return A.kpi(tipo.replaceAll('_', ' '), grupo.length, `${erros} erro(s) distinto(s)`);
  }).join('');
  el.innerHTML = cab('DIAGNÓSTICO · QUALIDADE DA EMISSÃO', 'Conformidade documental',
    'Confira erros de emissão e as alternativas compatíveis antes de corrigir o documento ou orientar a contraparte. Esta tela é somente de leitura: não executa o motor e não altera cálculos.') +
    `<div class="grade g3">${A.kpi('Apontamentos documentais', d.resumo?.total || 0, 'itens para conferência')}${A.kpi('Valor relacionado', A.moeda(d.resumo?.valor || 0), 'não altera o diagnóstico')}${A.kpi('Tipos encontrados', tipos.length, 'resumo detalhado abaixo')}</div>
    ${tipos.length ? `<div class="cartao" style="margin-top:16px"><h2>Resumo por tipo</h2><div class="grade g3">${resumoTipos}</div></div>` : ''}
    <div class="cartao" style="margin-top:16px"><div class="filtros-carteira"><label>Tipo de apontamento<select id="filtroConformidade"><option value="">Todos</option>${tipos.map((x)=>`<option value="${A.esc(x)}">${A.esc(x).replaceAll('_',' ')}</option>`).join('')}</select></label></div><p class="desc">A tela aponta qualidade documental. Uma divergência NBS/LC116 só é prioritária quando a análise econômica demonstrar efeito em CBS, crédito ou PIS/Cofins.</p><div id="listaConformidade"></div>${regras.length ? `<div class="cartao" style="margin-top:16px;box-shadow:none"><h3>Regras de uso</h3>${A.tabela([{t:'Código',r:r=>`<span class="tag n">${r.codigo}</span>`},{t:'Quando usar',r:r=>A.esc(r.texto)}],regras)}</div>` : ''}</div>`;
  render();
  el.querySelector('#filtroConformidade').addEventListener('change', (evento) => render(evento.target.value));
};

// Fase 2A: leitura da fotografia oficial, sem criar novo cálculo tributário.
Telas.classificacaoFiscalComplementar = async (el) => {
  const carregar = async () => A.api(`/empresas/${S.empresaId}/classificacao-fiscal-complementar`);
  let dados = await carregar();
  const render = () => {
    const p = dados.pendencias || [];
    const triagemHistorica = dados.triagem_ncm_historico || { itens: [], produtos_empresa_identificados: 0 };
    const historicosDaEmpresa = (triagemHistorica.itens || []).filter((x) => (x.produtos_empresa || []).length);
    const evidenciasHistoricas = historicosDaEmpresa.flatMap((x) => x.produtos_empresa.map((produto) => ({ ...x, produto })));
    el.innerHTML = `<div class="topo"><div><div class="olho">CADASTRO COMPLEMENTAR</div><h1>Classificação Fiscal Complementar</h1><p>Responda apenas fatos materiais por empresa e produto. Esta tela não escolhe CST, alíquota ou tratamento e não reprocessa documentos.</p></div></div>
      <div class="grade g4">${A.kpi('Pendências',p.filter(x=>x.status==='PENDENTE').length,'fatos materiais a confirmar')}${A.kpi('Respondidas',p.filter(x=>x.status==='RESPONDIDA').length,'cadastro reaproveitável')}${A.kpi('Ignoradas',p.filter(x=>x.status==='IGNORADA').length,'“não sei” preservado')}${A.kpi('Produtos envolvidos',new Set(p.map(x=>x.produto_empresa_id||`legado:${x.codigo_produto}`)).size,'sem alterar a regra')}</div>
      <div class="cartao" style="margin-top:16px"><h2>NCMs históricos que exigem evidência</h2><p class="desc">Registre apenas fatos materiais comprováveis por empresa e produto. O registro não cria regra, não altera CST, PIS/Cofins, CBS nem reprocessa documentos.</p>${evidenciasHistoricas.length ? A.tabela([
        {t:'Produto',r:x=>`<b>${A.esc(x.produto.codigo_produto_atual||`Produto #${x.produto.id}`)}</b><div class="mini">${A.esc(x.produto.descricao_atual||'Sem descrição')} · NCM ${A.esc(x.produto.ncm_atual)}</div>`},
        {t:'NCM sucessor',r:x=>`<span class="tag n">${A.esc(x.ncm_sucessor_oficial)}</span><div class="mini">${A.esc(x.status.replaceAll('_',' '))}</div>`},
        {t:'Evidências para validação',r:x=>`<div class="mini">${x.evidencia_minima.map(A.esc).join('<br>')}</div>`},
        {t:'Fatos já disponíveis',r:x=>`<div class="mini">${x.fatos_existentes_reutilizaveis.map(A.esc).join('<br>')}</div>`},
        {t:'',r:x=>`<button class="btn pq vazio" data-registrar-evidencia-historica="${x.produto.id}">Registrar fato</button>`},
      ],evidenciasHistoricas) : A.vazio('Nenhum produto desta empresa usa os 13 NCMs históricos mapeados.', 'Quando houver um produto correspondente, a evidência será solicitada antes de qualquer decisão fiscal.')}</div>
      <div class="cartao" style="margin-top:16px"><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end"><label class="campo"><span>Status</span><select id="filtroStatus"><option value="">Todos</option><option value="PENDENTE">Pendentes</option><option value="RESPONDIDA">Respondidas</option><option value="IGNORADA">Ignoradas</option></select></label><label class="campo"><span>NCM</span><input id="filtroNcm" placeholder="Ex.: 38089199"></label><label class="campo"><span>Produto</span><input id="filtroProduto" placeholder="Código ou descrição"></label><label class="campo"><span>Fato</span><select id="filtroFato"><option value="">Todos</option>${Object.entries(dados.fatos).map(([v,t])=>`<option value="${A.esc(v)}">${A.esc(t)}</option>`).join('')}</select></label><button class="btn vazio" id="filtrarFiscal">Filtrar</button></div></div>
      <div class="cartao" style="margin-top:16px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><h2>Pendências fiscais de produtos</h2><p class="desc">A fila será alimentada pelo motor somente quando regras condicionais forem ativadas. Nesta etapa ela começa vazia, por segurança.</p></div><button class="btn vazio" id="classificarLote">Classificar selecionados</button></div>${A.tabela([
        {t:'',r:x=>x.status==='PENDENTE'&&x.produto_empresa_id?`<input type="checkbox" data-lote-fiscal="${x.id}" data-produto-empresa-id="${x.produto_empresa_id}" aria-label="Selecionar ${A.esc(x.codigo_produto)}">`:''},
        {t:'Produto',r:x=>`<b>${A.esc(x.codigo_produto)}</b><div class="mini">${A.esc(x.produto_descricao||'Sem descrição')} · NCM ${A.esc(x.ncm||'—')}</div>`},
        {t:'Regra/família',r:x=>A.esc(x.familia_regra||x.regra_candidata||'—')},
        {t:'Fato necessário',r:x=>`<b>${A.esc(x.pergunta)}</b><div class="mini">Origem atual: ${A.esc(x.origem_dados_existentes||'não determinada')}</div>`},
        {t:'Situação',r:x=>`<span class="tag ${x.status==='PENDENTE'?'a':'c'}">${A.esc(x.status)}</span>`},
        {t:'',r:x=>x.status==='PENDENTE'?`<button class="btn pq" data-responder="${x.id}">Responder</button>`:'—'},
      ],p,{vazio:'Nenhuma pendência fiscal de produto. Nenhuma regra dos 322 NCMs foi ativada nesta etapa.'})}</div>`;
    const recarregar = async () => { dados=await carregar(); render(); };
    el.querySelector('#filtrarFiscal').onclick=async()=>{ const q=new URLSearchParams(); ['Status','Ncm','Produto','Fato'].forEach(k=>{const v=el.querySelector(`#filtro${k}`).value;if(v)q.set(({Status:'status',Ncm:'ncm',Produto:'produto',Fato:'fato'})[k],v)}); dados=await A.api(`/empresas/${S.empresaId}/classificacao-fiscal-complementar?${q}`); render(); };
    el.querySelectorAll('[data-responder]').forEach(b=>b.onclick=()=>{ const p=dados.pendencias.find(x=>String(x.id)===b.dataset.responder); A.modal({titulo:'Confirmar fato material',descricao:`Produto ${p.codigo_produto} · NCM ${p.ncm||'—'}`,corpo:`<p><b>${A.esc(p.pergunta)}</b></p>${A.selecao('resposta','Resposta',[{v:'SIM',t:'SIM'},{v:'NAO',t:'NÃO'},{v:'NAO_SEI',t:'NÃO SEI'}],'')}${A.area('observacao','Observação/evidência','',2)}${A.campo('vigencia_inicio','Vigência inicial','','date')}${A.campo('vigencia_fim','Vigência final','','date')}`,confirmar:'Salvar resposta',aoConfirmar:async f=>{await A.api(`/empresas/${S.empresaId}/classificacao-fiscal-complementar/pendencias/${p.id}/responder`,{metodo:'POST',corpo:{...f,produto_empresa_id:p.produto_empresa_id||null}});A.toast(f.resposta==='NAO_SEI'?'Pendência mantida sem liberar regra especial.':'Fato salvo para este produto e empresa.','ok');await recarregar();}}); });
    el.querySelectorAll('[data-registrar-evidencia-historica]').forEach((b)=>b.onclick=()=>{
      const item=evidenciasHistoricas.find((x)=>String(x.produto.id)===String(b.dataset.registrarEvidenciaHistorica));
      if(!item)return;
      const opcoes=item.fatos_existentes_reutilizaveis.filter((f)=>dados.fatos[f]).map((f)=>({v:f,t:dados.fatos[f]}));
      A.modal({titulo:'Registrar fato material',descricao:`${item.produto.codigo_produto_atual||`Produto #${item.produto.id}`} · NCM histórico ${item.ncm_historico}`,corpo:`<div class="aviso info"><b>Proteção:</b> esta ação apenas guarda a evidência para este produto e empresa. Não escolhe benefício, CST, PIS/Cofins ou CBS.</div>${A.selecao('fato','Fato comprovado',opcoes,'')}${A.selecao('valor','Resposta',[{v:'SIM',t:'SIM'},{v:'NAO',t:'NÃO'}],'')}${A.selecao('origem_evidencia','Origem da evidência',[{v:'DOCUMENTO',t:'Documento fiscal/técnico'},{v:'XML_SPED',t:'XML ou SPED'},{v:'CADASTRO_EMPRESA_PRODUTO',t:'Cadastro empresa + produto'},{v:'USUARIO',t:'Validação do usuário'}],'')}${A.area('observacao','Evidência / observação','',3)}${A.campo('vigencia_inicio','Vigência inicial','','date')}${A.campo('vigencia_fim','Vigência final','','date')}`,confirmar:'Salvar fato material',aoConfirmar:async f=>{if(!f.fato)return A.toast('Selecione um fato material.','erro');if(!f.observacao?.trim())return A.toast('Registre a evidência ou observação que sustenta o fato.','erro');await A.api(`/empresas/${S.empresaId}/classificacao-fiscal-complementar/fatos`,{metodo:'POST',corpo:{...f,produto_empresa_id:item.produto.id,codigo_produto:item.produto.codigo_produto_atual||null,ncm:item.ncm_historico}});A.toast('Fato material registrado com histórico. O tratamento fiscal permanece inalterado.','ok');await recarregar();}});
    });
    el.querySelector('#classificarLote').onclick=()=>{ const selecionadas=[...el.querySelectorAll('[data-lote-fiscal]:checked')].map(x=>dados.pendencias.find(p=>String(p.id)===x.dataset.loteFiscal)).filter(p=>p?.produto_empresa_id); if(!selecionadas.length)return A.toast('Selecione ao menos um produto pendente com identidade interna resolvida.','erro'); A.modal({titulo:'Classificação em lote',descricao:`${selecionadas.length} produto(s) da empresa selecionada receberão o mesmo fato. CST, alíquota e regra não serão alterados.`,corpo:`${A.selecao('fato','Fato material',Object.entries(dados.fatos).map(([v,t])=>({v,t})),'')}${A.selecao('valor','Resposta',[{v:'SIM',t:'SIM'},{v:'NAO',t:'NÃO'}],'')}${A.area('observacao','Observação/evidência','',2)}${A.campo('vigencia_inicio','Vigência inicial','','date')}${A.campo('vigencia_fim','Vigência final','','date')}`,confirmar:'Confirmar lote',aoConfirmar:async f=>{ await A.api(`/empresas/${S.empresaId}/classificacao-fiscal-complementar/lote`,{metodo:'POST',corpo:{...f,produtos_empresa_id:selecionadas.map(p=>p.produto_empresa_id)}});A.toast(`${selecionadas.length} produto(s) atualizados com histórico.`, 'ok');await recarregar();}}); };
  }; render();
};

Telas.coberturaDiagnostico = async (el) => {
  const d = await A.api(`/empresas/${S.empresaId}/cobertura-diagnostico`);
  const p = d.fotografia;
  const pct = (v) => v == null ? '—' : A.pct(v);
  const bloco = (titulo, x) => `<div class="cartao"><h2>${titulo}</h2><table class="compacta"><thead><tr><th>Status</th><th class="num">Operações</th><th class="num">Valor</th></tr></thead><tbody>${x.itens.map((i) => `<tr><td>${A.esc(i.status)}</td><td class="num mono">${i.quantidade}</td><td class="num mono">${A.moeda(i.valor)}</td></tr>`).join('')}</tbody></table><p class="mini">Cobertura: <b>${pct(x.cobertura_quantidade)}</b> das operações · <b>${pct(x.cobertura_valor)}</b> do valor.</p></div>`;
  el.innerHTML = `<div class="topo"><div><div class="olho">FASE 2A · COBERTURA</div><h1>Cobertura do diagnóstico</h1><p>Fotografia da execução oficial. Esta visão não recalcula CBS nem converte ausência de evidência em zero.</p></div><button class="btn" id="registrarFotografia">Registrar fotografia</button></div>
    <div class="grade g4">${A.kpi('Operações', p.total.quantidade)}${A.kpi('Valor analisado', A.moeda(p.total.valor))}${A.kpi('Resolvido pelo motor', pct(p.automacao.cobertura_valor), `${pct(p.automacao.cobertura_quantidade)} das operações · por valor`)}${A.kpi('Exceções abertas', d.excecoes.resumo.abertas, A.moeda(d.excecoes.resumo.valor_envolvido))}</div>
    <div class="aviso info" style="margin-top:16px"><b>Como ler esta cobertura:</b> o percentual inclui decisões determinadas pelo motor, premissas explicitamente registradas, casos não aplicáveis e classificações parciais somente quando a equivalência fiscal foi comprovada. As exceções abaixo são apenas operações que ainda exigem evidência ou validação humana.</div>
    <div class="grade g2" style="margin-top:16px">${bloco('Classificação',p.cobertura.classificacao)}${bloco('Tratamento',p.cobertura.tratamento)}${bloco('Reconstrução',p.cobertura.reconstrucao)}${bloco('Crédito',p.cobertura.credito)}</div>
    <div class="cartao" style="margin-top:16px"><h2>Fila operacional de pendências</h2><p class="desc">Cada valor aparece uma única vez, pela causa principal. Use a ação indicada para completar a evidência sem transformar ausência em zero.</p>${p.pendencias_operacionais?.length ? A.tabela([
      { t:'Operação', r:x=>`#${A.esc(x.movimento_id)}<div class="mini">${A.esc(x.documento)}</div>` },
      { t:'Valor', num:true, r:x=>A.moeda(x.valor) },
      { t:'Pendência principal', r:x=>`<b>${A.esc(x.dimensao)}</b> · ${A.esc(x.status)}<div class="mini">${A.esc(x.causa)}</div>` },
      { t:'Evidência disponível', r:x=>`<div class="mini">${x.evidencia_disponivel.map(A.esc).join('<br>')}</div>` },
      { t:'Ação necessária', r:x=>`${A.esc(x.acao)}<div class="mini">Fonte mínima: ${A.esc(x.fonte_minima)}</div><button class="btn pq vazio" data-ir-central data-pendencia-id="${A.esc(x.movimento_id)}">Ir para Central de Dados</button>` },
    ], p.pendencias_operacionais, { vazio:'Não há pendências operacionais na fotografia.' }) : A.vazio('Sem pendências operacionais', 'A fotografia não possui operações fora da cobertura.')}</div>
    <div class="cartao"><h2>Matriz de suporte por família</h2><p class="desc">Identificado não significa motor completo. Somente “Suportado” percorreu classificação, cálculo, crédito, memória e fotografia oficial.</p><table class="compacta"><thead><tr><th>Família</th><th>Estado</th><th class="num">Operações</th><th class="num">Valor</th><th>Gap</th></tr></thead><tbody>${d.familias.filter((x) => x.identificado).map((x) => `<tr><td>${A.esc(x.familia)}</td><td><span class="tag ${x.suportado ? 'c' : 'a'}">${A.esc(x.nivel_suporte)}</span></td><td class="num mono">${x.quantidade}</td><td class="num mono">${A.moeda(x.valor)}</td><td class="mini">${A.esc(x.gap || '—')}</td></tr>`).join('') || '<tr><td colspan="5">Nenhuma família identificada.</td></tr>'}</tbody></table></div>
    <div class="cartao"><h2>Exceções agrupadas por causa</h2><table class="compacta"><thead><tr><th>Causa</th><th>Categoria</th><th class="num">Operações</th><th class="num">Valor</th><th class="num">Impacto CBS</th></tr></thead><tbody>${d.excecoes.agrupadas.map((x) => `<tr><td>${A.esc(x.causa)}</td><td>${A.esc(x.categoria)}</td><td class="num mono">${x.quantidade}</td><td class="num mono">${A.moeda(x.valor)}</td><td class="num mono">${A.moeda(x.impacto)}</td></tr>`).join('') || '<tr><td colspan="5">Sem exceções abertas.</td></tr>'}</tbody></table></div>
    <div class="cartao"><h2>Cadastros e regras reutilizáveis</h2><div class="grade g4">${A.kpi('Parceiros mestre', d.mestres.parceiros.registros, d.mestres.parceiros.operacional ? 'operacional' : 'sem registros')}${A.kpi('Produtos mestre', d.mestres.produtos.registros, `${d.mestres.produtos.catalogo} no catálogo`)}${A.kpi('Serviços mestre', d.mestres.servicos.registros, `${d.mestres.servicos.catalogo} no catálogo`)}${A.kpi('Regras ativas', d.mestres.regras_enquadramento.ativas, `${d.mestres.regras_enquadramento.registros} cadastradas`)}</div></div>`;
  document.getElementById('registrarFotografia').onclick = async () => { await A.api(`/empresas/${S.empresaId}/cobertura-diagnostico/fotografias`, { metodo: 'POST', corpo: { tipo: 'FASE_2A' } }); A.toast('Fotografia registrada sem alterar o motor.', 'ok'); };
  el.querySelectorAll('[data-ir-central]').forEach((botao) => botao.addEventListener('click', () => {
    const contexto = p.pendencias_operacionais.find((x) => String(x.movimento_id) === String(botao.dataset.pendenciaId));
    if (contexto) {
      S.aba.dados = contexto.sentido === 'saida' ? 'cliente' : 'fornecedor';
      S.aba.dadosPendencia = contexto;
    }
    A.ir('dados');
  }));
};

// Consulta pública e versionada. A página não é uma tela de configuração do
// motor: fontes e tabelas são apresentadas para pesquisa e conferência.
Telas.utilidadesFiscais = async (el) => {
  const d = await A.api('/utilidades-fiscais');
  const quando = (v) => v ? new Date(`${String(v).replace(' ', 'T')}Z`).toLocaleString('pt-BR') : 'Aguardando primeira verificação';
  const fonte = (x) => `<article class="cartao" style="box-shadow:none"><div style="display:flex;justify-content:space-between;gap:12px"><div><b>${A.esc(x.nome)}</b><div class="mini">${A.esc(x.tema)}</div></div><span class="tag ${x.ultimo_erro ? 'a' : x.ultimo_sucesso_em ? 'c' : 'b'}">${x.ultimo_erro ? 'falhou' : x.ultimo_sucesso_em ? 'verificada' : 'aguardando'}</span></div><p class="mini" style="margin:10px 0 7px">Última verificação: ${A.esc(quando(x.ultimo_sucesso_em || x.ultima_consulta_em))}${x.ultimo_erro ? `<br>Erro: ${A.esc(x.ultimo_erro)}` : ''}</p><a href="${A.esc(x.url)}" target="_blank" rel="noopener">Abrir fonte oficial ↗</a></article>`;
  const cbenef = [
    ['DF','https://ww1.receita.fazenda.df.gov.br/legislacao/visualizar-legislacao?txtNumero=4&txtAno=2023&txtTipo=734&txtParte=.&identificacao=Ato%20Declarat%C3%B3rio%20-%20Assuntos%20Econ%C3%B4micos%20n%C2%BA%204/2023'], ['GO','https://www.economia.go.gov.br/files/Documentos_Fiscais/IN.docx'], ['ES','https://sefaz.es.gov.br/codigos-de-beneficios-fiscais-cbenef'], ['PR','https://sped.fazenda.pr.gov.br/NFe/Pagina/CODIGO-DE-BENEFICIO-FISCAL'], ['RS','https://atendimento.receita.rs.gov.br/nf-e-nota-fiscal-eletronica'], ['RJ','http://www.fazenda.rj.gov.br/dfe'], ['SC','https://www.sef.sc.gov.br/servicos/servico/88/SPED_Fiscal'], ['SP','https://portal.fazenda.sp.gov.br/servicos/nfe/Paginas/cBenef.aspx'],
  ];
  const portalNfe = 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=%2FNJarYc9nus%3D';
  const cardTabela = (titulo, descricao, url = portalNfe) => `<article class="cartao" style="box-shadow:none"><h3>${titulo}</h3><p class="desc">${descricao}</p><a class="btn vazio pq" target="_blank" rel="noopener" href="${url}">Abrir publicação oficial ↗</a></article>`;
  el.innerHTML = cab('CONSULTA OFICIAL', 'Utilidades fiscais', 'Legislação, tabelas técnicas e fontes oficiais verificadas diariamente. Uma alteração encontrada abre revisão; nunca muda o motor automaticamente.') +
    `<div class="grade g3">${A.kpi('Fontes monitoradas', d.fontes.length, 'consulta diária')}${A.kpi('LC 116 × NBS × IndOp', d.tabelas.lc116_nbs_indop || 0, 'linhas na base de serviços')}${A.kpi('cClassTrib catalogados', d.tabelas.cclasstrib || 0, 'NCM e serviços')}</div>
    <section class="cartao" style="margin-top:16px"><h2>Legislação e publicações oficiais</h2><p class="desc">O monitor confere o conteúdo publicado e guarda a data da última verificação. A interpretação jurídica continua sujeita à revisão humana.</p><div class="grade g2">${d.fontes.map(fonte).join('')}</div></section>
    <section class="cartao" style="margin-top:16px"><h2>Tabelas</h2><p class="desc">Consulte as publicações oficiais vigentes. As versões expiradas permanecem disponíveis apenas para consulta histórica.</p><div class="grade g2">${cardTabela('cClassTrib IBS/CBS','Essencial para classificação e regras CBS/IBS.')} ${cardTabela('cCredPres','Referência para crédito presumido, quando a hipótese legal estiver configurada.')} ${cardTabela('Alíquotas CBS','Referência oficial para validar os parâmetros e a transição.')} ${cardTabela('CFOP','Apoia a natureza da operação e a conformidade documental; o motor já usa a lógica de CFOP.')} ${cardTabela('FCP por UF','Referência para reconstruir a carga atual de ICMS em operações sujeitas.')} ${cardTabela('LC 116 × NBS × cIndOp × cClassTrib','Tabela oficial do Anexo VIII do Portal Nacional da NFS-e para serviços.', 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-00-00.xlsx/@@download/file')}</div><h3 style="margin-top:20px">cBenef × CST por UF</h3><p class="desc">Útil para conformidade documental e reconstrução de ICMS. Não muda CBS automaticamente.</p><div class="tags" style="gap:8px">${cbenef.map(([uf,url]) => `<a class="tag" target="_blank" rel="noopener" href="${A.esc(url)}">${uf} ↗</a>`).join('')}</div></section>
    <section class="cartao" style="margin-top:16px"><h2>Referências oficiais de classificação</h2><p class="desc">NCM e NBS são sincronizadas de fontes governamentais e preservam a versão de origem. A ausência de regra operacional não significa que o código deixe de existir na tabela oficial.</p><div class="grade g3">${A.kpi('NCM vigentes', d.referencias?.NCM?.vigentes || 0, 'fonte Siscomex')}${A.kpi('NBS vigentes', d.referencias?.NBS?.vigentes || 0, 'fonte MDIC')}${A.kpi('LC 116 vigentes', d.referencias?.LC116?.vigentes || 0, 'texto legal consolidado')}</div></section>`;
};
})();
