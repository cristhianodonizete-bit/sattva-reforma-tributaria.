/* =========================================================================
   TELAS — Visão geral e Módulo 1 (Diagnóstico)
   ========================================================================= */
const Telas = {};
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') =>
  `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
   <div class="acoes-topo">${acoes}</div></div>`;

// Um único ponto de ingestão para a apuração histórica: a Central de Dados
// e a revisão no Raio-X usam a mesma rota, serviço e normalização.
const abrirIngestaoApuracao = (aoConcluir, reprocessar = false) => A.modal({
  titulo: reprocessar ? 'Reprocessar apuração histórica de PIS/Cofins' : 'Enviar apuração histórica de PIS/Cofins',
  descricao: 'Selecione o arquivo original. A extração preserva ausência como “Não identificado” e exige revisão humana quando houver baixa confiança.',
  confirmar: reprocessar ? 'Reprocessar' : 'Enviar e processar',
  corpo: '<label class="campo"><span>Arquivo</span><input id="arquivoApuracao" type="file" accept=".pdf,.xlsx,.csv,.txt" required></label><label class="campo"><span>Tipo do documento</span><select id="tipoApuracao"><option value="PDF">PDF</option><option value="XLSX">XLSX</option><option value="CSV">CSV</option><option value="RELATORIO_ERP">Relatório ERP</option></select></label><div><button type="button" class="btn vazio pq" onclick="window.open(\'/api/modelos/apuracao_pis_cofins\')">Baixar modelo de planilha</button></div>',
  aoConfirmar: async (_dados, fundo) => {
    const arquivo = fundo.querySelector('#arquivoApuracao')?.files?.[0];
    if (!arquivo) throw new Error('Selecione um documento.');
    const fd = new FormData();
    fd.append('arquivo', arquivo);
    fd.append('tipo_documento', fundo.querySelector('#tipoApuracao')?.value || '');
    await A.api(`/empresas/${S.empresaId}/apuracoes-pis-cofins/ingestao`, { metodo: 'POST', corpo: fd });
    A.toast('Documento processado. Revise os campos antes de confirmar.', 'ok');
    aoConcluir();
  },
});

// ===========================================================================
// PAINEL
// ===========================================================================
Telas.painel = async (el) => {
  const { empresa, contadores: c, contratacoes, dados_operacionais_pendentes_sincronizacao } = await A.api(`/empresas/${S.empresaId}/painel`);
  const passos = [
    { t: 'Cadastro de fornecedores e clientes', ok: c.fornecedores + c.clientes > 0, n: `${c.fornecedores + c.clientes} parceiros`, tela: 'dados' },
    { t: 'Movimentação importada', ok: c.movEntradas.c + c.movSaidas.c > 0, n: `${c.movEntradas.c + c.movSaidas.c} lançamentos`, tela: 'dados' },
    { t: 'Perfil tributário levantado', ok: c.perfil > 0, n: `${c.perfil} competências`, tela: 'perfil' },
    { t: 'Projeção CBS', ok: c.movEntradas.c > 0 || c.movSaidas.c > 0, n: 'análise única', tela: 'cenarios' },
    { t: 'Precificação simulada', ok: c.itensPreco > 0, n: `${c.itensPreco} itens`, tela: 'precificacao' },
    { t: 'Contratos revisados', ok: c.contratos > 0, n: `${c.contratos} contratos`, tela: 'contratos' },
    { t: 'Capacitação programada', ok: c.turmas > 0, n: `${c.turmas} turmas`, tela: 'capacitacao' },
  ];
  const concluidos = passos.filter((p) => p.ok).length;
  const proximoPasso = passos.find((p) => !p.ok);

  el.innerHTML = cab('Painel do projeto', A.esc(empresa.razao_social),
    `${A.cnpjFmt(empresa.cnpj)} · ${A.regimeLabel(empresa.regime)} · ${A.esc(empresa.municipio || '')} ${A.esc(empresa.uf || '')}`,
    `<button class="btn" id="verRecomendacoes">Recomendações iniciais</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/tecnico')">Relatório técnico</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/riscos')">Mapa de riscos</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/diagnostico')">Relatório completo</button>`) +
    (S.params.modoAnalise?.ibsAtivo ? A.regua(2027, null) : '<div class="aviso bom"><b>Projeção CBS</b> A análise atual trabalha com uma referência única; a transição anual será exibida quando o IBS for habilitado.</div>') +
    `<div class="grade g4">
      ${A.kpi('Fornecedores mapeados', c.fornecedores, `${c.movEntradas.c} lançamentos de entrada`)}
      ${A.kpi('Clientes mapeados', c.clientes, `${c.movSaidas.c} lançamentos de saída`)}
      ${A.kpi('Compras analisadas', A.moeda(c.movEntradas.v), 'Base de crédito')}
      ${A.kpi('Faturamento analisado', A.moeda(c.movSaidas.v), 'Base de débito', 'destaque')}
    </div>
    ${dados_operacionais_pendentes_sincronizacao ? `<div class="aviso atencao" style="margin-top:16px"><b>Dados operacionais aguardando sincronização</b>
      A fotografia CBS desta empresa existe, mas parceiros e movimentações ainda não foram restaurados no cache operacional. Os zeros exibidos acima não representam ausência de dados fiscais.
      <div class="acao">Aguarde a sincronização e recarregue esta tela.</div></div>` : ''}
    ${c.semRegime ? `<div class="aviso atencao" style="margin-top:16px"><b>${c.semRegime} lançamentos sem regime tributário identificado</b>
      Esses registros entram no cálculo como Lucro Real. Importe o cadastro de parceiros com a coluna de regime para corrigir.
      <div class="acao">Cadastros e importação → Importar clientes e fornecedores</div></div>` : ''}
    <section class="proximo-passo ${proximoPasso ? '' : 'concluido'}">
      <div><span class="olho">PRÓXIMA AÇÃO</span><strong>${proximoPasso ? proximoPasso.t : 'Dados essenciais concluídos'}</strong><p>${proximoPasso ? `Para avançar, complete esta etapa. ${proximoPasso.n}.` : 'O diagnóstico possui informações em todas as etapas principais.'}</p></div>
      ${proximoPasso ? `<button class="btn ouro" data-proximo="${proximoPasso.tela}">Continuar</button>` : '<span class="tag c">Base preparada</span>'}
    </section>
    <div class="grade g2 projeto-painel">
      <div class="cartao andamento-projeto">
        <div class="titulo-cartao"><div><h2>Andamento do projeto</h2><p class="desc">${concluidos} de ${passos.length} etapas com dados</p></div><strong>${Math.round((concluidos / passos.length) * 100)}%</strong></div>
        <div class="barra-prog"><i style="width:${(concluidos / passos.length) * 100}%"></i></div>
        <div class="lista-etapas">${passos.map((p, indice) => `<button type="button" class="etapa ${p.ok ? 'feito' : ''}" data-etapa="${p.tela}">
            <b>${p.ok ? '✓' : indice + 1}</b><span><strong>${p.t}</strong><small>${p.n}</small></span><i>›</i></button>`).join('')}</div>
      </div>
      <div class="cartao">
        <h2>Atenções abertas</h2><p class="desc">Itens que exigem decisão</p>
        ${c.contratosRisco ? `<div class="aviso alto"><b>${c.contratosRisco} contrato(s) com risco alto</b>Cláusulas críticas ausentes.<div class="acao">Revisão de contratos</div></div>` : ''}
        ${c.acoesAbertas ? `<div class="aviso atencao"><b>${c.acoesAbertas} ação(ões) em aberto</b>Plano de adequação em execução.<div class="acao">Plano de adequação</div></div>` : ''}
        ${!c.contratosRisco && !c.acoesAbertas ? '<div class="aviso">Nenhuma pendência crítica registrada.</div>' : ''}
        <hr class="sep">
        <h2 style="font-size:13px">Serviços contratados</h2>
        ${contratacoes.length ? contratacoes.map((t) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eef1f3">
            <span class="tag ${t.status === 'contratado' ? 'c' : 'n'}">${t.status}</span>
            <span class="mini">escopo registrado</span></div>`).join('')
          : '<p class="mini">Nenhum escopo registrado. Monte um combo em “Escopos e combos”.</p>'}
      </div>
    </div>`;
  el.querySelector('[data-proximo]')?.addEventListener('click', () => A.ir(proximoPasso.tela));
  el.querySelectorAll('[data-etapa]').forEach((botao) => { botao.onclick = () => A.ir(botao.dataset.etapa); });
  document.getElementById('verRecomendacoes').onclick = async () => {
    try {
      const d = await A.api(`/empresas/${S.empresaId}/motor/riscos`);
      const prioridade = { alta: 'Prioridade alta', media: 'Prioridade média', baixa: 'Monitoramento' };
      A.modal({ titulo: 'Recomendações iniciais', largura: 860, confirmar: 'Exportar Excel',
        descricao: 'Leitura executiva derivada dos documentos importados, organizada por materialidade e prioridade de ação.',
        corpo: `<div class="grade g3">${A.kpi('Recomendações', d.sintese.total, `${d.sintese.alta} prioritárias`)}${A.kpi('Exposição mapeada', A.moeda(d.sintese.exposicaoTotal), 'valor associado aos riscos')}${A.kpi('Dimensões', d.sintese.dimensoes.length, d.sintese.dimensoes.join(' · '), 'destaque')}</div>
          <div class="aviso classificacao-orientacao"><b>O que exige validação</b> Itens sem cadastro, classificação ou regime confirmado devem ser revisados antes de uma decisão fiscal definitiva.</div>
          <div class="recomendacoes-executivas">${d.riscos.map((r, i) => `<article class="recomendacao-executiva ${r.nivel}"><div><span class="tag ${r.nivel === 'alta' ? 'a' : r.nivel === 'media' ? 'b' : 'c'}">${prioridade[r.nivel] || r.nivel}</span><b>${i + 1}. ${A.esc(r.titulo)}</b><p>${A.esc(r.descricao)}</p></div><div class="recomendacao-acao"><strong>Recomendação</strong><span>${A.esc(r.acao)}</span>${r.impacto ? `<small>Impacto: ${A.esc(r.impacto)}</small>` : ''}</div></article>`).join('')}</div>`,
        aoConfirmar: async () => { window.open(`/api/empresas/${S.empresaId}/relatorio/recomendacoes`); } });
    } catch (e) { A.toast(e.message || 'Não foi possível gerar as recomendações.', 'erro'); }
  };
};

// ===========================================================================
// EMPRESAS
// ===========================================================================
Telas.empresas = async (el) => {
  const [{ empresas }, gruposDados] = await Promise.all([A.api('/empresas'), A.api('/grupos-empresas').catch(() => ({ grupos: [] }))]);
  const grupos = gruposDados.grupos || [];
  const totais = empresas.reduce((acc, empresa) => ({
    fornecedores: acc.fornecedores + Number(empresa.fornecedores || 0),
    clientes: acc.clientes + Number(empresa.clientes || 0),
    movimentos: acc.movimentos + Number(empresa.movimentos || 0),
  }), { fornecedores: 0, clientes: 0, movimentos: 0 });
  el.innerHTML = cab('Cadastro', 'Empresas atendidas', 'Cada empresa é um projeto de implementação independente.',
    '<button class="btn vazio" id="novoGrupo">Criar grupo de análise</button><button class="btn" id="novaEmpresa">Cadastrar empresa</button>') +
    `<div class="grade g4 resumo-carteira">
      ${A.kpi('Projetos cadastrados', empresas.length, 'empresas atendidas')}
      ${A.kpi('Fornecedores', totais.fornecedores, 'na carteira total')}
      ${A.kpi('Clientes', totais.clientes, 'na carteira total')}
      ${A.kpi('Lançamentos', totais.movimentos, 'movimentações importadas')}
    </div>
    <div class="cartao empresas-lista"><div class="cabecalho-lista"><div><h2>Carteira de projetos</h2><p class="desc">Abra um projeto para continuar a entrega, importar dados ou acompanhar o diagnóstico.</p></div><span class="tag">${empresas.length} empresas</span></div>${A.tabela([
      { t: 'Razão social', r: (e) => `<b>${A.esc(e.razao_social)}</b><div class="mini">${A.cnpjFmt(e.cnpj)}</div>` },
      { t: 'Regime', r: (e) => `<span class="tag">${A.regimeLabel(e.regime)}</span>` },
      { t: 'UF', r: (e) => A.esc(e.uf || '—') },
      { t: 'Fornecedores', num: true, r: (e) => e.fornecedores },
      { t: 'Clientes', num: true, r: (e) => e.clientes },
      { t: 'Lançamentos', num: true, r: (e) => e.movimentos },
      { t: 'Código Questor', r: (e) => `<span class="mono mini">${A.esc(e.codigo_questor || '—')}</span>` },
      { t: '', r: (e) => `<button class="btn pq" data-abrir="${e.id}">Abrir projeto</button><button class="btn pq vazio" data-qsa="${e.id}">Quadro societário</button><button class="btn pq vazio" data-ed="${e.id}">Editar</button>
        <button class="btn pq perigo" data-rm="${e.id}">Excluir</button>` },
    ], empresas, { vazio: 'Nenhuma empresa cadastrada. Comece cadastrando a primeira.' })}</div>
    <div class="cartao grupos-empresas"><div class="cabecalho-lista"><div><h2>Grupos de empresas para análise</h2><p class="desc">Organize empresas por carteira, segmento ou projeto para conduzir análises conjuntas.</p></div><span class="tag">${grupos.length} grupo${grupos.length === 1 ? '' : 's'}</span></div>
      ${grupos.length ? `<div class="lista-grupos">${grupos.map((g) => { const nomes = empresas.filter((e) => (g.empresa_ids || []).map(Number).includes(Number(e.id))).map((e) => e.razao_social); return `<article class="grupo-empresas-item"><div><b>${A.esc(g.nome)}</b><p class="mini">${A.esc(g.descricao || 'Sem descrição')} · ${nomes.length} empresa(s)</p><p class="mini">${A.esc(nomes.join(' · ') || 'Nenhuma empresa vinculada')}</p></div><div><button class="btn pq vazio" data-grupo-ed="${g.id}">Editar</button><button class="btn pq perigo" data-grupo-rm="${g.id}">Excluir</button></div></article>`; }).join('')}</div>` : A.vazio('Nenhum grupo criado.', 'Crie um grupo para organizar empresas que serão analisadas em conjunto.')}
    </div>`;

  const form = (e = {}) => A.campo('razao_social', 'Razão social', e.razao_social) +
    `<div class="grade g2">${A.campo('cnpj', 'CNPJ', e.cnpj)}${A.campo('nome_fantasia', 'Nome fantasia', e.nome_fantasia)}</div>
     <div class="grade g2">${A.selecao('regime', 'Regime tributário', A.opcoesRegime(), e.regime || 'lucro_real')}
     ${A.selecao('reducao_padrao', 'Enquadramento predominante no IVA', A.opcoesReducao(), e.reducao_padrao || 'integral')}</div>
     <div class="grade g3">${A.campo('uf', 'UF', e.uf)}${A.campo('municipio', 'Município', e.municipio)}${A.campo('cnae', 'CNAE principal', e.cnae)}</div>
     <div class="grade g2">${A.campo('faturamento_anual', 'Faturamento anual (R$)', e.faturamento_anual, 'number')}
     ${A.campo('codigo_questor', 'Código da empresa no Questor', e.codigo_questor)}</div>
     ${A.area('atividade', 'Atividade', e.atividade, 2)}`;
  const formGrupo = (g = {}) => `${A.campo('nome', 'Nome do grupo', g.nome || '')}${A.area('descricao', 'Descrição / objetivo da análise', g.descricao || '', 2)}<h3 class="subtitulo-modal">Empresas incluídas</h3><div class="empresas-acesso">${empresas.map((empresa) => `<label class="check"><input type="checkbox" name="empresa_${empresa.id}" ${(g.empresa_ids || []).map(Number).includes(Number(empresa.id)) ? 'checked' : ''}> ${A.esc(empresa.razao_social)}</label>`).join('') || '<p class="mini">Cadastre empresas antes de criar um grupo.</p>'}</div>`;

  document.getElementById('novaEmpresa').onclick = () => A.modal({
    titulo: 'Cadastrar empresa', descricao: 'Os dados alimentam todos os módulos do produto.',
    corpo: form(), aoConfirmar: async (d) => { await A.api('/empresas', { metodo: 'POST', corpo: d }); A.toast('Empresa cadastrada', 'ok'); await A.carregarEmpresas(); A.ir('empresas'); },
  });
  document.getElementById('novoGrupo').onclick = () => A.modal({ titulo: 'Criar grupo de empresas para análise', largura: 720, corpo: formGrupo(), aoConfirmar: async (d) => { d.empresa_ids = empresas.filter((empresa) => d[`empresa_${empresa.id}`]).map((empresa) => empresa.id); await A.api('/grupos-empresas', { metodo: 'POST', corpo: d }); A.toast('Grupo criado', 'ok'); A.ir('empresas'); } });
  el.querySelectorAll('[data-abrir]').forEach((b) => { b.onclick = async () => {
    localStorage.setItem('sattva_empresa', b.dataset.abrir); await A.carregarEmpresas(); A.ir('painel');
  }; });
  el.querySelectorAll('[data-ed]').forEach((b) => { b.onclick = () => {
    const e = empresas.find((x) => x.id === Number(b.dataset.ed));
    A.modal({ titulo: 'Editar empresa', corpo: form(e), aoConfirmar: async (d) => {
      await A.api(`/empresas/${e.id}`, { metodo: 'PUT', corpo: d }); A.toast('Alterações salvas', 'ok'); await A.carregarEmpresas(); A.ir('empresas'); } });
  }; });
  el.querySelectorAll('[data-qsa]').forEach((b) => { b.onclick = async () => {
    const e = empresas.find((x) => x.id === Number(b.dataset.qsa));
    const abrir = async () => {
      const d = await A.api(`/empresas/${e.id}/qsa`);
      const linhas = (d.socios || []).map((s) => `<tr><td>${A.esc(s.nome)}</td><td>${A.esc(s.qualificacao || '—')}</td><td>${s.percentual_participacao == null ? '<b>Pendente</b>' : `${A.esc(s.percentual_participacao)}%`}</td><td>${Number(s.brasileiro) ? 'SIM' : 'NÃO'}</td><td><button class="btn pq vazio" data-qsa-ed="${s.id}">Confirmar</button></td></tr>`).join('');
      A.modal({ titulo:`Quadro societário — ${e.razao_social}`, largura:900, confirmar:'Fechar', corpo:`<div class="aviso"><b>ATENDE_200044: ${A.esc(d.atende_200044)}</b><br>${A.esc(d.motivo)}</div><p class="mini">A condição exige sócio brasileiro com participação igual ou superior a 20%. Percentual ausente nunca é presumido.</p><button class="btn" id="enriquecerQsa">Consultar cadastro</button><table class="tabela" style="margin-top:12px"><thead><tr><th>Sócio</th><th>Qualificação</th><th>Participação</th><th>Brasileiro</th><th></th></tr></thead><tbody>${linhas || '<tr><td colspan="5">Nenhum sócio disponível.</td></tr>'}</tbody></table>`, aoConfirmar: async()=>{} });
      document.getElementById('enriquecerQsa').onclick = async () => { await A.api(`/empresas/${e.id}/qsa/enriquecer`,{metodo:'POST',corpo:{forcar:true}}); A.toast('Quadro societário atualizado.','ok'); abrir(); };
      document.querySelectorAll('[data-qsa-ed]').forEach((botao) => botao.onclick = () => { const s=d.socios.find((x)=>x.id===Number(botao.dataset.qsaEd)); A.modal({titulo:`Confirmar sócio — ${s.nome}`,corpo:`${A.campo('percentual_participacao','Participação no capital (%)',s.percentual_participacao ?? '','number')}<label class="check"><input type="checkbox" name="brasileiro" ${Number(s.brasileiro)?'checked':''}> Brasileiro</label>`,aoConfirmar:async f=>{await A.api(`/empresas/${e.id}/qsa/${s.id}`,{metodo:'PUT',corpo:{...s,percentual_participacao:f.percentual_participacao,brasileiro:!!f.brasileiro}});abrir();}}); });
    };
    abrir();
  }; });
  el.querySelectorAll('[data-rm]').forEach((b) => { b.onclick = () => A.confirmar('Excluir a empresa apaga também parceiros, movimentação, contratos e turmas. Confirma?', async () => {
    await A.api(`/empresas/${b.dataset.rm}`, { metodo: 'DELETE' }); A.toast('Empresa excluída', 'ok'); await A.carregarEmpresas(); A.ir('empresas'); }); });
  el.querySelectorAll('[data-grupo-ed]').forEach((b) => { b.onclick = () => { const g = grupos.find((x) => x.id === b.dataset.grupoEd); A.modal({ titulo: 'Editar grupo de empresas', largura: 720, corpo: formGrupo(g), aoConfirmar: async (d) => { d.empresa_ids = empresas.filter((empresa) => d[`empresa_${empresa.id}`]).map((empresa) => empresa.id); await A.api(`/grupos-empresas/${g.id}`, { metodo: 'PUT', corpo: d }); A.toast('Grupo atualizado', 'ok'); A.ir('empresas'); } }); }; });
  el.querySelectorAll('[data-grupo-rm]').forEach((b) => { b.onclick = () => A.confirmar('Excluir este grupo não exclui as empresas. Confirma?', async () => { await A.api(`/grupos-empresas/${b.dataset.grupoRm}`, { metodo: 'DELETE' }); A.toast('Grupo excluído', 'ok'); A.ir('empresas'); }); });
};

// ===========================================================================
// CADASTROS E IMPORTAÇÃO
// ===========================================================================
Telas.dados = async (el) => {
  const aba = S.aba.dados || 'fornecedor';
  const filtroPendencia = S.aba.dadosPendencia || null;
  const regimeEmpresa = S.empresa?.regime || '';
  const simplesNacional = regimeEmpresa === 'simples_nacional';
  const exigeApuracaoPisCofins = ['lucro_presumido', 'lucro_real'].includes(regimeEmpresa);
  const [{ parceiros }, { lotes }, dadosAdicionais, cobertura] = await Promise.all([
    A.api(`/empresas/${S.empresaId}/parceiros?tipo=${aba}`),
    A.api(`/empresas/${S.empresaId}/lotes`),
    A.api(`/empresas/${S.empresaId}/dados-adicionais-analise`),
    A.api(`/empresas/${S.empresaId}/cobertura-diagnostico`),
  ]);
  const { movimentos, total } = await A.api(`/empresas/${S.empresaId}/movimentos?tipo=${aba}&limite=${filtroPendencia?.movimento_id ? 5000 : 200}`);
  const referenciasVendas = aba === 'cliente' ? await A.api(`/empresas/${S.empresaId}/referencias-vendas`) : null;
  const rotulo = aba === 'cliente' ? 'clientes' : 'fornecedores';
  const pendenciasDaAba = (cobertura.fotografia?.pendencias_operacionais || []).filter((p) => p.sentido === (aba === 'cliente' ? 'saida' : 'entrada'));
  const movimentosVisiveis = filtroPendencia?.movimento_id ? movimentos.filter((m) => Number(m.id) === Number(filtroPendencia.movimento_id)) : movimentos;

  el.innerHTML = cab('DADOS · ENTRADA E TRATAMENTO', 'Central de Dados',
    'Cadastre, importe, complete e trate dados uma única vez. Os módulos de análise apenas consomem esta base com origem e rastreabilidade preservadas.') +
    `<div class="aviso bom"><b>Fluxo de dados:</b> Central de Dados → tratamento e validações → módulos do produto → relatórios e entregáveis.</div>` +
    `<div class="abas">
      <button data-aba="fornecedor" class="${aba === 'fornecedor' ? 'ativo' : ''}">Fornecedores</button>
      <button data-aba="cliente" class="${aba === 'cliente' ? 'ativo' : ''}">Clientes</button>
    </div>
    <section class="fluxo-importacao" aria-label="Etapas da importação">
      <button type="button" class="${parceiros.length ? 'feito' : 'atual'}" data-ir-importacao="cadastro">
        <b>1</b><span><strong>Cadastre ${rotulo}</strong><small>${parceiros.length ? `${parceiros.length} registros disponíveis` : 'Importe ou inclua manualmente'}</small></span>
      </button><span class="fluxo-linha"></span>
      <button type="button" class="${total.c ? 'feito' : parceiros.length ? 'atual' : ''}" data-ir-importacao="movimentacao">
        <b>2</b><span><strong>Importe a movimentação</strong><small>${total.c ? `${total.c} lançamentos analisáveis` : 'Envie a planilha de transações'}</small></span>
      </button><span class="fluxo-linha"></span>
      <button type="button" class="${total.c ? 'atual' : ''}" data-ir-importacao="historico">
        <b>3</b><span><strong>Confira a base</strong><small>${lotes.length ? `${lotes.length} lotes registrados` : 'Acompanhe os arquivos enviados'}</small></span>
      </button>
    </section>
    ${filtroPendencia ? `<div class="aviso atencao" style="margin-top:16px"><b>Filtro ativo: operação #${A.esc(filtroPendencia.movimento_id || '—')} · ${A.esc(filtroPendencia.dimensao || 'pendência')} · ${A.esc(filtroPendencia.status || '')}</b><br><span class="mini">${A.esc(filtroPendencia.acao || 'Revise a pendência selecionada.')} ${filtroPendencia.fonte_minima ? `Fonte mínima: ${A.esc(filtroPendencia.fonte_minima)}` : ''}</span><div style="margin-top:8px"><button class="btn pq vazio" id="limparFiltroPendencia">Limpar filtro</button></div></div>` : ''}
    <div class="cartao" style="margin-top:16px" id="importacoesCentral">
      <h2>Importações e documentos</h2>
      <p class="desc">Use esta Central como porta de entrada. Cada ação reutiliza o mesmo fluxo já tratado pelo sistema; nenhuma base ou processamento paralelo é criado.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn vazio pq" id="centralXmlSped">Importar XML ou SPED</button>
        <button class="btn vazio pq" id="centralPlanilhas">Importar planilhas</button>
        ${simplesNacional ? '<button class="btn vazio pq" id="centralPgdas">Importar PGDAS</button>' : ''}
        <button class="btn vazio pq" id="centralApuracao">${exigeApuracaoPisCofins ? 'Enviar apuração PIS/Cofins obrigatória' : 'Enviar apuração PIS/Cofins'}</button>
        <button class="btn vazio pq" id="centralReferencias">Importar referências de serviços</button>
      </div>
      <div class="mini" style="margin-top:10px">${simplesNacional ? '<b>Empresa do Simples Nacional:</b> importe o PGDAS por competência em XLSX, XLS ou CSV para completar a evidência histórica.' : exigeApuracaoPisCofins ? '<b>Empresa no Lucro Presumido ou Lucro Real:</b> envie a apuração histórica de PIS/Cofins para completar a evidência do período.' : '<b>PGDAS:</b> a importação fica disponível para empresas enquadradas no Simples Nacional.'}</div>
    </div>
    <div class="grade g2">
      <div class="cartao" id="cadastro">
        <h2>1. Cadastro de ${rotulo}</h2>
        <p class="desc">Planilha com CNPJ, descrição e regime tributário. A ordem das colunas não importa.</p>
        ${A.dropzone('zonaParceiros', `<b>Solte a planilha de ${rotulo} aqui</b><div class="mini">ou clique para escolher · .xlsx, .xls, .csv</div>`, (f) => enviar(f, 'parceiros'))}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn vazio pq" onclick="window.open('/api/modelos/parceiros')">Baixar modelo</button>
          <button class="btn vazio pq" id="addParceiro">Incluir manualmente</button>
          <button class="btn ouro pq" id="consultarReceita">Consultar regime na Receita</button>
          <span class="mini" style="margin-left:auto;align-self:center">${parceiros.length} cadastrados</span>
        </div>
      </div>
      <div class="cartao" id="movimentacao">
        <h2>2. Movimentação de ${rotulo}</h2>
        <p class="desc">Nome, inscrição federal, descrição do produto, NCM, valor, base de cálculo e impostos.</p>
        ${A.dropzone('zonaMov', `<b>Solte a movimentação aqui</b><div class="mini">ou clique para escolher · .xlsx, .xls, .csv</div>`, (f) => enviar(f, 'movimentos'))}
        <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
          <button class="btn vazio pq" onclick="window.open('/api/modelos/movimento_${aba}')">Baixar modelo</button>
          <button class="btn vazio pq" id="revincular">Revincular regimes</button>
          <span class="mini" style="margin-left:auto;align-self:center">${total.c} lançamentos · ${A.moeda(total.v)}</span>
        </div>
      </div>
    </div>
    ${aba === 'fornecedor' ? `<div class="cartao" style="margin-top:16px">
      <h2>Dados complementares</h2>
      <p class="desc">Informações complementares por empresa. Elas permanecem separadas da movimentação e não recalculam a CBS.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
        <button class="btn vazio pq" id="addFolha">Informar folha</button>
        <button class="btn vazio pq" id="importarFolha">Importar folha</button>
        <button class="btn vazio pq" id="addMargemOperacional">Informar margem operacional</button>
        <button class="btn vazio pq" id="addReceitaSemDfe">Adicionar receita sem DF-e</button>
        <button class="btn vazio pq" id="importarReceitaSemDfe">Importar receitas sem DF-e</button>
      </div>
      <div class="grade g3">
        <div>${A.kpi('Folhas informadas', (dadosAdicionais.folhas || []).length, 'por competência')}</div>
        <div>${A.kpi('Margens informadas', (dadosAdicionais.margens || []).length, 'premissas declaradas')}</div>
        <div>${A.kpi('Receitas sem DF-e', (dadosAdicionais.receitas_sem_dfe || []).length, 'não consolidadas automaticamente')}</div>
      </div>
      ${(dadosAdicionais.receitas_sem_dfe || []).some((x) => x.status_validacao === 'POSSIVEL_DUPLICIDADE') ? '<div class="aviso atencao" style="margin-top:12px"><b>Há receita(s) com possível duplicidade.</b> Elas não foram consolidadas automaticamente; revise a evidência antes de qualquer uso analítico.</div>' : ''}
    </div>` : ''}
    <div class="cartao" style="margin-top:16px" id="pendenciasDiagnosticoCentral"><h2>Pendências do diagnóstico</h2><p class="desc">Localize a linha que bloqueia a cobertura, confira a evidência existente e siga a ação indicada. Cada operação aparece uma única vez pela pendência principal.</p>${pendenciasDaAba.length ? A.tabela([
      { t:'Operação', r:p=>`#${A.esc(p.movimento_id)}<div class="mini">${A.esc(p.documento)}</div>` },
      { t:'Valor', num:true, r:p=>A.moeda(p.valor) },
      { t:'Pendência', r:p=>`<b>${A.esc(p.dimensao)}</b> · ${A.esc(p.status)}<div class="mini">${A.esc(p.causa)}</div>` },
      { t:'Ação', r:p=>`${A.esc(p.acao)}<div class="mini">${A.esc(p.fonte_minima)}</div><button class="btn pq" data-abrir-pendencia="${A.esc(p.movimento_id)}">Abrir lançamento</button>` },
    ], pendenciasDaAba, { vazio:'Sem pendências para esta origem.' }) : A.vazio('Sem pendências nesta origem', 'Não há linhas pendentes de cobertura para fornecedores ou clientes nesta empresa.')}</div>
    ${aba === 'fornecedor' ? `<div class="cartao" style="margin-top:16px" id="tratamentoCentral"><h2>Tratamento e revisão de dados</h2><p class="desc">Acompanhe apurações históricas, campos com baixa confiança, pendências de classificação, inconsistências e rastreabilidade antes de usar os dados nas análises.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn vazio pq" id="abrirRaioXDados">Revisar apurações e rastreabilidade</button><button class="btn vazio pq" id="centralPendenciasRegime">Ver pendências de regime</button><button class="btn vazio pq" id="centralPendenciasClassificacao">Ver pendências de classificação</button></div></div>` : ''}
    ${aba === 'cliente' ? `<div class="cartao" style="margin-top:16px">
      <h2>Referências fiscais das vendas por serviço</h2>
      <p class="desc">Todo serviço prestado precisa ter a referência da tributação atual no cadastro da empresa. A referência só é usada quando o documento não traz os tributos destacados.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"><button class="btn vazio pq" id="addReferenciaServico">Adicionar serviço ao cadastro</button><button class="btn vazio pq" id="importarReferenciasServico">Importar referências</button><button class="btn vazio pq" onclick="window.open('/api/modelos/referencias_servicos')">Baixar modelo</button></div>
      ${referenciasVendas.pendentes.length ? `<div class="aviso atencao"><b>${referenciasVendas.pendentes.length} serviço(s) exigem referência fiscal.</b> Defina PIS/COFINS ou DAS efetivo antes de usar uma estimativa para a venda.</div>` : '<div class="aviso bom"><b>Serviços identificados com referência cadastrada.</b></div>'}
      ${A.tabela([
        { t: 'NBS / serviço', r: (s) => `<b class="mono">${A.esc(s.nbs || 'sem NBS')}</b><div class="mini">${A.esc(s.descricao || '')}</div>` },
        { t: 'Vendas', num: true, r: (s) => A.moeda(s.valor) },
        { t: 'Referência', r: (s) => s.configurado ? '<span class="tag c">configurada</span>' : s.exigeReferencia ? '<span class="tag b">obrigatória</span>' : '<span class="tag n">documento</span>' },
        { t: 'Vínculo', r: (s) => s.configurado ? `<span class="mini">${A.esc(s.correspondencia)}</span>` : s.exigeReferencia ? '—' : '<span class="mini">PIS/COFINS veio no documento</span>' },
        { t: 'Alíquota atual', r: (s) => {
          if (!s.referencia) return '—';
          const r = s.referencia;
          const p = r.pis_cofins !== null && r.pis_cofins !== undefined ? `PIS/COFINS ${A.pct(r.pis_cofins)}` : '';
          const d = r.das_efetivo !== null && r.das_efetivo !== undefined ? `DAS ${A.pct(r.das_efetivo)}` : '';
          const i = r.iss_aliquota !== null && r.iss_aliquota !== undefined ? `ISS ${A.pct(r.iss_aliquota)}` : '';
          return [p, d, i].filter(Boolean).join('<br>') || '—';
        } },
        { t: '', r: (s) => `<button class="btn pq ${s.configurado ? 'vazio' : ''}" data-ref-servico="${A.esc(s.chave)}">${s.configurado ? 'Editar' : s.exigeReferencia ? 'Definir referência' : 'Cadastrar referência'}</button>` },
      ], referenciasVendas.servicos, { vazio: 'Nenhum serviço foi identificado nas vendas importadas.' })}
    </div>` : ''}
    <div class="cartao" id="historico">
      <h2>${rotulo[0].toUpperCase() + rotulo.slice(1)} cadastrados</h2>
      ${A.tabela([
        { t: 'CNPJ/CPF', r: (p) => `<span class="mono">${A.cnpjFmt(p.cnpj)}</span>` },
        { t: 'Descrição', r: (p) => A.esc(p.descricao) },
        { t: 'Regime', r: (p) => `<span class="tag ${['simples_nacional', 'mei'].includes(p.regime) ? 'b' : ''}">${A.regimeLabel(p.regime)}</span>` },
        { t: 'Origem', r: (p) => `<span class="mini">${A.esc(p.origem)}</span>` },
        { t: '', r: (p) => `<button class="btn pq vazio" data-ep="${p.id}">Editar</button>` },
      ], parceiros, { vazio: `Nenhum ${aba} cadastrado ainda.` })}
    </div>
    <div class="cartao">
      <h2>${filtroPendencia?.movimento_id ? `Movimentação filtrada · operação #${A.esc(filtroPendencia.movimento_id)}` : 'Movimentação importada'}</h2><p class="desc">${filtroPendencia?.movimento_id ? 'Linha relacionada à pendência selecionada.' : '200 maiores lançamentos'}</p>
      ${A.tabela([
        { t:'ID', r: (m) => `<span class="mono">#${A.esc(m.id)}</span>` },
        { t: 'Parceiro', r: (m) => `${A.esc(m.nome)}<div class="mini mono">${A.cnpjFmt(m.inscr_federal)}</div>` },
        { t: 'Produto/serviço', r: (m) => A.esc(m.descricao || '—') },
        { t: 'NCM', r: (m) => `<span class="mono mini">${A.esc(m.ncm || '—')}</span>` },
        { t: 'Regime', r: (m) => m.regime ? `<span class="tag">${A.regimeLabel(m.regime)}</span>` : '<span class="tag b">não vinculado</span>' },
        { t: 'Valor', num: true, r: (m) => A.moeda(m.valor) },
        { t: 'Base', num: true, r: (m) => A.moeda(m.base_calculo) },
        { t: 'ICMS', num: true, r: (m) => A.moeda(m.icms) },
        { t: 'PIS/COFINS', num: true, r: (m) => A.moeda(m.pis + m.cofins) },
        { t: 'ISS', num: true, r: (m) => A.moeda(m.iss) },
      ], movimentosVisiveis, { vazio: filtroPendencia?.movimento_id ? 'A operação selecionada não está disponível nesta origem. Limpe o filtro e confira a empresa selecionada.' : 'Importe a movimentação para liberar o diagnóstico.' })}
    </div>
    <div class="cartao">
      <h2>Lotes importados</h2>
      ${A.tabela([
        { t: 'Arquivo', r: (l) => A.esc(l.arquivo) },
        { t: 'Tipo', r: (l) => l.tipo },
        { t: 'Origem', r: (l) => l.origem },
        { t: 'Registros', num: true, r: (l) => l.registros },
        { t: 'Valor', num: true, r: (l) => A.moeda(l.valor_total) },
        { t: 'Data', r: (l) => `<span class="mini">${A.esc(l.criado_em)}</span>` },
        { t: '', r: (l) => `<button class="btn pq perigo" data-rl="${l.id}">Remover</button>` },
      ], lotes, { vazio: 'Nenhum lote importado.' })}
    </div>`;

    el.querySelectorAll('[data-aba]').forEach((b) => { b.onclick = () => { S.aba.dados = b.dataset.aba; S.aba.dadosPendencia = null; A.ir('dados'); }; });
    document.getElementById('limparFiltroPendencia')?.addEventListener('click', () => { S.aba.dadosPendencia = null; A.ir('dados'); });
    el.querySelectorAll('[data-abrir-pendencia]').forEach((botao) => botao.addEventListener('click', async () => {
      const pendencia = pendenciasDaAba.find((p) => String(p.movimento_id) === String(botao.dataset.abrirPendencia));
      if (!pendencia) return;
      const tipo = pendencia.sentido === 'saida' ? 'cliente' : 'fornecedor';
      const { movimentos: lista } = await A.api(`/empresas/${S.empresaId}/movimentos?tipo=${tipo}&limite=5000`);
      const m = lista.find((x) => Number(x.id) === Number(pendencia.movimento_id));
      if (!m) { A.toast('O lançamento não está disponível para a empresa selecionada.', 'erro'); return; }
      A.modal({ titulo: `Lançamento #${m.id}`, descricao: 'Conferência do fato original. A pendência não altera os valores do lançamento.', confirmar: 'Salvar classificação',
        corpo: `<div class="aviso atencao"><b>${A.esc(pendencia.dimensao)} · ${A.esc(pendencia.status)}</b><br>${A.esc(pendencia.causa)}<div class="mini" style="margin-top:6px"><b>Ação:</b> ${A.esc(pendencia.acao)}<br><b>Fonte mínima:</b> ${A.esc(pendencia.fonte_minima)}</div></div>` +
          `<div class="grade g2" style="margin-top:12px">${A.kpi('Valor', A.moeda(m.valor))}${A.kpi('Competência', m.competencia || 'Não identificada')}${A.kpi('Documento', m.documento || m.chave || 'Não identificado')}${A.kpi('Origem', m.origem || 'Não identificada')}</div>` +
          `<div class="cartao" style="margin-top:12px"><b>Parceiro</b><div>${A.esc(m.nome || 'Não identificado')}</div><div class="mini mono">${A.esc(m.inscr_federal || 'CNPJ/CPF não identificado')}</div></div>` +
          `<div class="cartao" style="margin-top:12px"><b>Produto ou serviço</b><div>${A.esc(m.descricao || 'Não identificado')}</div><div class="mini">Código fiscal bruto no XML: ${A.esc(m.cst || 'Não identificado')} · Regime: ${A.esc(m.regime || 'Não identificado')}</div></div>` +
          `<div class="cartao" style="margin-top:12px"><b>Classificação do lançamento</b><p class="mini">Revise somente o código aplicável ao fato. O item da LC116 extraído do XML é mostrado separadamente do código fiscal bruto; salvar não altera os valores nem executa o motor.</p><div class="grade g3">${A.campo('lc116', 'Item LC116', m.lc116 || '', 'text', 'placeholder="Ex.: 1.05"')}${A.campo('nbs', 'NBS', m.nbs || '', 'text')}${A.campo('ncm', 'NCM', m.ncm || '', 'text')}</div></div>` +
          `<div class="grade g4" style="margin-top:12px">${A.kpi('Base', A.moeda(m.base_calculo))}${A.kpi('PIS', A.moeda(m.pis))}${A.kpi('Cofins', A.moeda(m.cofins))}${A.kpi('ISS', A.moeda(m.iss))}</div>`,
        aoConfirmar: async (dados) => {
          const r = await A.api(`/empresas/${S.empresaId}/movimentos/${m.id}/classificacao`, { metodo: 'PUT', corpo: dados });
          const status = r.classificacao?.status || 'INDETERMINADO';
          A.toast(status === 'CLASSIFICADO' ? 'Classificação salva e vinculada ao catálogo.' : `Classificação salva: ${status}. Revise os candidatos ou complete o código necessário.`, status === 'CLASSIFICADO' ? 'ok' : 'erro');
          S.aba.dadosPendencia = { ...pendencia, ...dados };
          A.ir('dados');
        },
      });
    }));
    document.getElementById('centralXmlSped')?.addEventListener('click', () => {
      S.aba.dadosMotor = 'xml'; A.ir('dados');
    });
    document.getElementById('centralPlanilhas')?.addEventListener('click', () => {
      S.aba.dadosMotor = 'atual'; A.ir('dados');
    });
    document.getElementById('centralPgdas')?.addEventListener('click', () => {
      A.modal({ titulo: 'Importar PGDAS', descricao: 'Envie a exportação do PGDAS por competência. Competência e valor do DAS são obrigatórios; os demais campos são aproveitados somente quando existirem no arquivo.', confirmar: null,
        corpo: `${A.dropzone('zonaPgdas', '<b>Solte a exportação do PGDAS aqui</b><div class="mini">ou clique para escolher · .xlsx, .xls, .csv</div>', async (arquivo) => {
          const dados = new FormData(); dados.append('arquivo', arquivo);
          const r = await A.api(`/empresas/${S.empresaId}/importar/pgdas`, { method: 'POST', body: dados });
          A.toast(`${r.importados || 0} competência(s) importada(s) e ${r.atualizados || 0} atualizada(s).`, 'ok');
          A.ir('dados');
        })}<div style="margin-top:12px"><button class="btn vazio pq" onclick="window.open('/api/modelos/pgdas')">Baixar modelo</button></div>` });
    });
    document.getElementById('centralApuracao')?.addEventListener('click', () => abrirIngestaoApuracao(() => A.ir('dados')));
    document.getElementById('centralReferencias')?.addEventListener('click', () => {
      S.aba.dados = 'cliente'; S.aba.dadosMotor = 'atual'; A.ir('dados');
    });
    document.getElementById('centralPendenciasRegime')?.addEventListener('click', () => document.getElementById('cadastro')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    document.getElementById('centralPendenciasClassificacao')?.addEventListener('click', () => {
      S.aba.dados = 'cliente'; S.aba.dadosMotor = 'atual'; A.ir('dados');
    });
    el.querySelectorAll('[data-ref-servico]').forEach((botao) => { botao.onclick = () => {
      const s = referenciasVendas.servicos.find((x) => x.chave === botao.dataset.refServico);
      const existente = referenciasVendas.referencias.find((x) => x.chave === s.chave) || {};
      A.modal({ titulo: 'Referência fiscal da venda de serviço', descricao: 'Premissa da empresa analisada. Os valores do documento prevalecem quando estiverem informados.',
        corpo: `<p><b>${A.esc(s.descricao || 'Serviço')}</b><br><span class="mini mono">${A.esc(s.nbs || 'NBS não informado')}</span></p>` +
          `<div class="grade g3">${A.campo('pis_cofins','PIS/COFINS da venda',existente.pis_cofins ?? '', 'number','step="0.0001"')}${A.campo('das_efetivo','DAS efetivo (Simples)',existente.das_efetivo ?? '', 'number','step="0.0001"')}${A.campo('iss_aliquota','ISS',existente.iss_aliquota ?? '', 'number','step="0.0001"')}</div>`,
        aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/referencias-vendas/${encodeURIComponent(s.chave)}`, { metodo: 'PUT', corpo: { ...d, nbs: s.nbs, descricao: s.descricao } }); A.toast('Referência fiscal salva', 'ok'); A.ir('dados'); },
      });
    }; });
    document.getElementById('addReferenciaServico')?.addEventListener('click', () => {
      A.modal({ titulo: 'Cadastrar referência fiscal de serviço', descricao: 'Use este cadastro para serviços novos, mesmo antes de haver uma venda importada.',
        corpo: `<div class="grade g2">${A.campo('descricao', 'Descrição do serviço')}${A.campo('nbs', 'NBS (se houver)')}</div>` +
          `<div class="grade g3">${A.campo('pis_cofins','PIS/COFINS da venda','', 'number','step="0.0001"')}${A.campo('das_efetivo','DAS efetivo (Simples)','', 'number','step="0.0001"')}${A.campo('iss_aliquota','ISS','', 'number','step="0.0001"')}</div>`,
        aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/referencias-vendas`, { metodo: 'POST', corpo: d }); A.toast('Referência fiscal cadastrada', 'ok'); A.ir('dados'); },
      });
    });
    document.getElementById('importarReferenciasServico')?.addEventListener('click', () => {
      A.modal({ titulo: 'Importar referências fiscais de serviços', confirmar: null,
        descricao: 'Colunas aceitas: Descrição do serviço, NBS, PIS/COFINS, DAS efetivo e ISS. Informe alíquotas como 9,25% ou 0,0925. A importação atualiza referências que já existirem com a mesma chave.',
        corpo: `${A.dropzone('zonaImportarReferencias', '<b>Solte a planilha aqui</b><div class="mini">ou clique para escolher · .xlsx, .xls, .csv</div>', async (arquivo) => {
          const fd = new FormData(); fd.append('arquivo', arquivo);
          try { const r = await A.api(`/empresas/${S.empresaId}/referencias-vendas/importar`, { metodo: 'POST', corpo: fd }); A.toast(`${r.importados} referência(s) importada(s)${r.ignorados ? ` · ${r.ignorados} ignorada(s)` : ''}`, 'ok'); A.ir('dados'); }
          catch (e) { A.toast(e.message, 'erro'); }
        })}<div style="margin-top:12px"><button class="btn vazio pq" onclick="window.open('/api/modelos/referencias_servicos')">Baixar modelo</button></div>`,
      });
    });
    el.querySelectorAll('[data-ir-importacao]').forEach((b) => { b.onclick = () => document.getElementById(b.dataset.irImportacao)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); });

  document.getElementById('addFolha')?.addEventListener('click', () => A.modal({
    titulo: 'Informar folha de pagamento', descricao: 'Registro agregado por competência; não exige dados individuais de empregados.',
    corpo: `<div class="grade g2">${A.campo('competencia','Competência (AAAA-MM)','','text','placeholder="2026-08"')}${A.campo('valor_folha','Valor da folha','', 'number','step="0.01" min="0"')}</div>` +
      `<div class="grade g2">${A.campo('pro_labore','Pró-labore (se informado)','', 'number','step="0.01" min="0"')}${A.campo('referencia_arquivo','Referência do arquivo (opcional)')}</div>`,
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/folhas-pagamento`, { metodo: 'POST', corpo: d }); A.toast('Folha registrada como dado complementar', 'ok'); A.ir('dados'); },
  }));
  document.getElementById('importarFolha')?.addEventListener('click', () => A.modal({
    titulo: 'Importar folha de pagamento', descricao: 'Envie uma planilha agregada por competência. Competência e Valor da Folha são obrigatórios; Pró-labore e Referência são opcionais.', confirmar: null,
    corpo: `${A.dropzone('zonaImportarFolha', '<b>Solte a planilha de folha aqui</b><div class="mini">ou clique para escolher · .xlsx, .xls, .csv</div>', async (arquivo) => {
      const fd = new FormData(); fd.append('arquivo', arquivo);
      const r = await A.api(`/empresas/${S.empresaId}/importar/folhas-pagamento`, { metodo: 'POST', corpo: fd });
      A.toast(`${r.importados || 0} folha(s) importada(s)${r.ignorados ? ` · ${r.ignorados} ignorada(s)` : ''}`, 'ok'); A.ir('dados');
    })}<div style="margin-top:12px"><button class="btn vazio pq" onclick="window.open('/api/modelos/folha')">Baixar modelo</button></div>`,
  }));
  document.getElementById('addMargemOperacional')?.addEventListener('click', () => A.modal({
    titulo: 'Informar margem operacional', descricao: 'Premissa informada: lucro antes do IR dividido pela receita total. Não representa lucro tributável definitivo.',
    corpo: `<div class="grade g3">${A.campo('periodo_inicio','Início (AAAA-MM)','','text','placeholder="2026-01"')}${A.campo('periodo_fim','Fim (AAAA-MM)','','text','placeholder="2026-12"')}${A.campo('margem_operacional_percentual','Margem (%)','', 'number','step="0.01" min="0" max="100"')}</div>`,
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/margens-operacionais`, { metodo: 'POST', corpo: d }); A.toast('Margem operacional registrada como premissa', 'ok'); A.ir('dados'); },
  }));
  document.getElementById('addReceitaSemDfe')?.addEventListener('click', () => A.modal({
    titulo: 'Adicionar receita sem documento fiscal', descricao: 'Use apenas receita ainda não capturada por XML/DF-e. Em caso de correlação não segura, o registro fica marcado como possível duplicidade e não é consolidado automaticamente.',
    corpo: `<div class="grade g2">${A.campo('competencia','Competência (AAAA-MM)','','text','placeholder="2026-08"')}${A.campo('tipo_receita','Tipo de receita','','text','placeholder="Aluguel, locação, cessão…"')}</div>` +
      `${A.campo('descricao','Descrição')}<div class="grade g2">${A.campo('valor','Valor','', 'number','step="0.01" min="0"')}${A.campo('evidencia','Evidência/referência (opcional)')}</div>`,
    aoConfirmar: async (d) => { const r = await A.api(`/empresas/${S.empresaId}/receitas-sem-dfe`, { metodo: 'POST', corpo: d }); A.toast(r.possivel_duplicidade ? 'Receita registrada com possível duplicidade; não consolidada automaticamente' : 'Receita complementar registrada', r.possivel_duplicidade ? '' : 'ok'); A.ir('dados'); },
  }));
  document.getElementById('importarReceitaSemDfe')?.addEventListener('click', () => A.modal({
    titulo: 'Importar receitas sem documento fiscal', descricao: 'Use apenas receitas que ainda não estejam nos XML/DF-e. Competência, Tipo, Descrição e Valor são obrigatórios; o sistema sinaliza possível duplicidade.', confirmar: null,
    corpo: `${A.dropzone('zonaImportarReceitasSemDfe', '<b>Solte a planilha de receitas aqui</b><div class="mini">ou clique para escolher · .xlsx, .xls, .csv</div>', async (arquivo) => {
      const fd = new FormData(); fd.append('arquivo', arquivo);
      const r = await A.api(`/empresas/${S.empresaId}/importar/receitas-sem-dfe`, { metodo: 'POST', corpo: fd });
      A.toast(`${r.importados || 0} receita(s) importada(s)${r.possiveisDuplicidades ? ` · ${r.possiveisDuplicidades} com possível duplicidade` : ''}${r.ignorados ? ` · ${r.ignorados} ignorada(s)` : ''}`, 'ok'); A.ir('dados');
    })}<div style="margin-top:12px"><button class="btn vazio pq" onclick="window.open('/api/modelos/receitas_sem_dfe')">Baixar modelo</button></div>`,
  }));
  document.getElementById('abrirRaioXDados')?.addEventListener('click', () => A.ir('perfil'));

  async function enviar(arquivo, destino) {
    const fd = new FormData();
    fd.append('arquivo', arquivo); fd.append('tipo', aba);
    try {
      const r = await A.api(`/empresas/${S.empresaId}/importar/${destino}`, { metodo: 'POST', corpo: fd });
      const cols = Object.entries(r.colunasDetectadas || {}).map(([k, v]) => `<tr><td>${k}</td><td class="mono">${A.esc(v)}</td></tr>`).join('');
      A.modal({ titulo: 'Importação concluída', largura: 620,
        corpo: `<div class="grade g3">${A.kpi('Importados', r.importados)}${A.kpi('Ignorados', r.ignorados || 0)}
          ${r.valorTotal !== undefined ? A.kpi('Valor total', A.moeda(r.valorTotal)) : ''}</div>
          ${r.semRegime ? `<div class="aviso atencao" style="margin-top:14px"><b>${r.semRegime} lançamentos sem regime</b>
            Importe o cadastro de ${rotulo} com a coluna de regime tributário para que o cálculo de crédito fique correto.</div>` : ''}
          ${(r.mensagens || []).map((m) => `<div class="aviso atencao">${A.esc(m)}</div>`).join('')}
          <hr class="sep"><h3 style="font-size:13px">Colunas reconhecidas</h3>
          <table><thead><tr><th>Campo do sistema</th><th>Coluna da planilha</th></tr></thead><tbody>${cols}</tbody></table>` });
      A.ir('dados');
    } catch (e) { A.toast(e.message, 'erro'); }
  }

  document.getElementById('addParceiro').onclick = () => A.modal({
    titulo: `Incluir ${aba}`,
    corpo: A.campo('cnpj', 'CNPJ/CPF') + A.campo('descricao', 'Descrição') + A.selecao('regime', 'Regime tributário', A.opcoesRegime(), 'lucro_real') +
      `<div class="grade g2">${A.campo('uf', 'UF')}${A.campo('municipio', 'Município')}</div>`,
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/parceiros`, { metodo: 'POST', corpo: { ...d, tipo: aba } }); A.ir('dados'); },
  });

  el.querySelectorAll('[data-ep]').forEach((b) => { b.onclick = () => {
    const p = parceiros.find((x) => x.id === Number(b.dataset.ep));
    A.modal({ titulo: 'Editar parceiro', corpo: A.campo('descricao', 'Descrição', p.descricao) +
      A.selecao('regime', 'Regime tributário', A.opcoesRegime(), p.regime) +
      `<div class="grade g2">${A.campo('uf', 'UF', p.uf)}${A.campo('municipio', 'Município', p.municipio)}</div>`,
      aoConfirmar: async (d) => { await A.api(`/parceiros/${p.id}`, { metodo: 'PUT', corpo: d }); await A.api(`/empresas/${S.empresaId}/vincular-regimes`, { metodo: 'POST' }); A.ir('dados'); } });
  }; });

  el.querySelectorAll('[data-rl]').forEach((b) => { b.onclick = () => A.confirmar('Remover o lote apaga os lançamentos importados nele. Confirma?', async () => {
    await A.api(`/lotes/${b.dataset.rl}`, { metodo: 'DELETE' }); A.ir('dados'); }); });

  document.getElementById('consultarReceita').onclick = async () => {
    const p = await A.api(`/empresas/${S.empresaId}/parceiros/pendencias-regime`);
    const cfg = await A.api('/cnpj/config');
    const min = Math.ceil(p.tempoEstimadoSegundos / 60);
    A.modal({
      titulo: 'Consultar regime na base da Receita', largura: 700, confirmar: 'Consultar agora',
      descricao: 'Descobre se cada parceiro é MEI, optante do Simples ou está no regime regular.',
      corpo: `<div class="grade g3">
          ${A.kpi('Sem regime', p.total, 'parceiros a resolver')}
          ${A.kpi('Já em cache', p.emCache, 'consulta instantânea')}
          ${A.kpi('Tempo estimado', p.tempoEstimadoSegundos < 60 ? `${p.tempoEstimadoSegundos}s` : `${min} min`,
            `${p.provedor}, ${(p.intervalo / 1000).toFixed(1)}s entre consultas`, 'destaque')}
        </div>
        <div class="aviso" style="margin-top:14px"><b>O que a consulta resolve</b>
          A base pública informa a opção pelo Simples e pelo SIMEI. Não distingue Lucro Real de
          Presumido — e não precisa: para IBS/CBS o que importa é estar dentro ou fora do Simples.
          Quem não é optante apura pelo regime regular e credita normalmente.</div>
        ${A.selecao('tipo', 'Escopo', [{ v: '', t: 'Fornecedores e clientes' },
          { v: 'fornecedor', t: 'Somente fornecedores' }, { v: 'cliente', t: 'Somente clientes' }], '')}
        <label class="campo"><span>Sobrescrever regimes já definidos</span>
          <input type="checkbox" name="sobrescrever" style="width:auto"></label>
        <div class="mini">Por padrão a consulta só toca em quem está sem regime — o que o consultor
          definiu à mão é preservado.</div>
        <div id="statusReceita" style="margin-top:12px"></div>`,
      aoConfirmar: async (d, fundo) => {
        const box = fundo.querySelector('#statusReceita');
        box.innerHTML = '<div class="aviso">Consultando… não feche esta janela.</div><div class="barra-prog"><i style="width:40%"></i></div>';
        try {
          const r = await A.api(`/empresas/${S.empresaId}/parceiros/enriquecer`, { metodo: 'POST',
            corpo: { tipo: d.tipo || undefined, sobrescrever: d.sobrescrever } });
          box.innerHTML = `<div class="aviso bom"><b>${r.atualizados} parceiros atualizados</b>
              ${r.consultados} consultas novas · ${r.cache} do cache${r.naoEncontrados ? ` · ${r.naoEncontrados} não localizados` : ''}</div>
            ${Object.keys(r.porRegime).length ? `<table class="compacta"><thead><tr><th>Regime identificado</th><th class="num">Parceiros</th></tr></thead>
              <tbody>${Object.entries(r.porRegime).map(([k, v]) =>
                `<tr><td>${A.regimeLabel(k)}</td><td class="num mono">${v}</td></tr>`).join('')}</tbody></table>` : ''}
            ${r.inativos && r.inativos.length ? `<div class="aviso atencao"><b>${r.inativos.length} com situação cadastral irregular</b>
              ${A.esc(r.inativos.slice(0, 4).map((x) => `${x.nome} (${x.situacao})`).join('; '))}
              <div class="acao">Vale confirmar antes de projetar crédito sobre essas operações.</div></div>` : ''}
            ${r.erros.length ? `<details class="clausula"><summary class="mini">${r.erros.length} erros</summary>
              ${r.erros.slice(0, 10).map((e) => `<div class="mini">• ${A.esc(e)}</div>`).join('')}</details>` : ''}`;
          setTimeout(() => A.ir('dados'), 2500);
        } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
        return false;
      },
    });
  };

  document.getElementById('revincular').onclick = async () => {
    const r = await A.api(`/empresas/${S.empresaId}/vincular-regimes`, { metodo: 'POST' });
    A.toast(r.semRegime ? `${r.semRegime} lançamentos ainda sem regime` : 'Todos os lançamentos vinculados', r.semRegime ? '' : 'ok');
    A.ir('dados');
  };
};

// ===========================================================================
// 1.a PERFIL TRIBUTÁRIO
// ===========================================================================
Telas.perfil = async (el) => {
  const [dados, tributario, comparador, apuracoesResposta] = await Promise.all([
    A.api(`/empresas/${S.empresaId}/perfil-cbs`),
    A.api(`/empresas/${S.empresaId}/perfil-tributario-historico`),
    A.api(`/empresas/${S.empresaId}/comparador-regimes`),
    A.api(`/empresas/${S.empresaId}/apuracoes-pis-cofins`),
  ]);
  const competencias = dados.competencias || []; const atual = competencias[0];
  const historicoTributario = tributario.historico || [];
  const na = (v) => v === null || v === undefined ? 'N/A' : A.pct(v);
  const valorOuIndeterminado = (x, formato = A.moeda) => x?.natureza === 'INDETERMINADO' || x?.valor === null || x?.valor === undefined ? 'INDETERMINADO' : formato(x.valor);
  const natureza = (x) => x?.natureza || 'INDETERMINADO';
  const apuracoes = apuracoesResposta.apuracoes || [];
  const valorExtraido = (campo) => campo?.valor_extraido === null || campo?.valor_extraido === undefined || campo?.valor_extraido === '' ? 'Não identificado' : A.esc(campo.valor_extraido);
  const confianca = (campo) => campo?.confianca === null || campo?.confianca === undefined ? 'Não identificada' : `${Math.round(Number(campo.confianca) * 100)}%`;
  const tabelaCamposApuracao = (campos) => A.tabela([
    { t: 'Campo', r: x => A.esc(x.campo) }, { t: 'Valor', r: x => valorExtraido(x) },
    { t: 'Confiança', r: x => `<span class="${Number(x.confianca) < .8 ? 'sobe' : ''}">${confianca(x)}</span>` },
    { t: 'Origem / localização', r: x => `${A.esc(x.rotulo_original || 'Não identificado')}<br><span class="mini">${A.esc(x.origem_documento || 'Não identificado')} · ${A.esc(x.pagina_ou_localizacao || 'Não identificado')}</span>` },
    { t: 'Validação', r: x => A.esc(x.status_validacao || 'INDETERMINADO') },
  ], campos || [], { vazio: 'Nenhum campo extraído.' });
  const especiais = atual ? ['receita_reducao_cbs','receita_aliquota_zero_cbs','receita_imunidade_cbs','receita_regime_especifico_cbs','receita_beneficio_governo_cbs'].reduce((s, k) => s + (+atual[k] || 0), 0) : 0;
  const indeterminadas = atual ? (+atual.receita_tratamento_indeterminado_cbs || 0) + (+atual.compras_credito_indeterminado || 0) : 0;
  el.innerHTML = cab('Módulo 1.a', 'Perfil Tributário e Raio-X Histórico', 'Leitura da carga atual de PIS/Cofins por competência. A CBS aparece apenas na comparação do Raio-X.', '<button class="btn vazio" id="centralDadosPerfil">Central de Dados</button><button class="btn vazio" id="complementarCbs">Completar informações</button><button class="btn" id="atualizarCbs">Atualizar Perfil CBS</button>') +
    `<div class="cartao"><h2>Perfil tributário consolidado</h2><div class="grade g4">
      ${A.kpi('Regime atual', A.esc(tributario.empresa?.regime_atual || 'INDETERMINADO'), 'cadastro da empresa')}
      ${A.kpi('Períodos analisados', historicoTributario.length, historicoTributario.length ? 'dados persistidos' : 'INDETERMINADO')}
      ${A.kpi('Folha', tributario.cobertura?.folha === 'DISPONIVEL' ? 'DISPONÍVEL' : 'INDETERMINADO', 'por competência')}
      ${A.kpi('Margem operacional', tributario.cobertura?.margem_operacional === 'DISPONIVEL' ? 'PREMISSA INFORMADA' : 'INDETERMINADO', 'não é lucro tributável')}
    </div><p class="mini">CBS é consumida exclusivamente da fotografia existente do motor. Ausências permanecem explicitamente como INDETERMINADO.</p></div>
    <div class="cartao" style="margin-top:16px"><h2>Raio-X histórico — situação anterior × CBS</h2>${historicoTributario.length ? A.tabela([
      {t:'Competência',r:x=>A.esc(x.competencia)}, {t:'Regime',r:x=>A.esc(x.regime)},
      {t:'Receita',num:true,r:x=>valorOuIndeterminado(x.receita)}, {t:'PIS/Cofins atual',num:true,r:x=>valorOuIndeterminado(x.carga_pis_cofins_atual)},
      {t:'Carga atual',num:true,r:x=>valorOuIndeterminado(x.carga_pis_cofins_percentual, A.pct)}, {t:'Origem',r:x=>A.esc(x.carga_pis_cofins_atual?.origem || 'INDETERMINADO')}, {t:'PGDAS',num:true,r:x=>x.pgdas?.natureza === 'NAO_APLICAVEL' ? 'NÃO APLICÁVEL' : valorOuIndeterminado(x.pgdas)},
      {t:'Créditos Lucro Real',num:true,r:x=>x.creditos_lucro_real?.natureza === 'NAO_APLICAVEL' ? 'NÃO APLICÁVEL' : valorOuIndeterminado(x.creditos_lucro_real)},
      {t:'CBS do motor',num:true,r:x=>x.cbs_motor_existente?.natureza === 'CALCULADO' ? A.moeda(x.cbs_motor_existente.liquida) : 'INDETERMINADO'},
      {t:'Completude',r:x=>`${A.esc(natureza(x.receita))} · ${A.esc(natureza(x.cbs_motor_existente))}`},
    ], historicoTributario) : A.vazio('Sem período histórico consolidado', 'Cadastre ou importe dados por competência; o sistema não estima a informação ausente.', '')}</div>
    <div class="cartao" style="margin-top:16px"><h2>Apurações Históricas de PIS/Cofins</h2><p class="mini">O documento original é preservado. Campos sem evidência aparecem como “Não identificado”; baixa confiança exige revisão humana.</p>${apuracoes.length ? apuracoes.map((a) => `<div class="cartao" style="margin-top:12px"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center"><div><b>${A.esc(a.nome_original)}</b><div class="mini">Competência: ${A.esc(a.competencia || 'Não identificada')} · processamento: ${A.esc(a.status_processamento || 'INDETERMINADO')}</div></div><div><button class="btn pq vazio" data-apuracao-revisar="${a.id}">Revisar</button>${a.status_processamento === 'ERRO' ? `<button class="btn pq vazio" data-apuracao-reprocessar="${a.id}">Reprocessar</button>` : ''}${a.status_validacao === 'VALIDADO_USUARIO' ? '<span class="mini"> Confirmado</span>' : `<button class="btn pq" data-apuracao-confirmar="${a.id}">Confirmar dados</button>`}</div></div>${a.campos_pendentes?.length ? `<div class="aviso atencao" style="margin-top:10px"><b>Pendências/baixa confiança:</b> ${a.campos_pendentes.map(A.esc).join(', ')}</div>` : ''}</div>`).join('') : A.vazio('Nenhuma apuração histórica enviada', 'Envie o documento pela Central de Dados para extrair PIS/Cofins sem recalcular CBS.', '<button class="btn" id="centralDadosApuracao">Ir para Central de Dados</button>')}</div>
    <div class="cartao" style="margin-top:16px"><h2>Composição, dados complementares e tratamentos</h2>${historicoTributario.length ? A.tabela([
      {t:'Competência',r:x=>A.esc(x.competencia)}, {t:'Mercadorias',num:true,r:x=>x.composicao_receitas?.natureza === 'INDETERMINADO' ? 'INDETERMINADO' : valorOuIndeterminado(x.composicao_receitas.mercadorias)},
      {t:'Serviços',num:true,r:x=>x.composicao_receitas?.natureza === 'INDETERMINADO' ? 'INDETERMINADO' : valorOuIndeterminado(x.composicao_receitas.servicos)}, {t:'Receitas sem DF-e',num:true,r:x=>valorOuIndeterminado(x.receitas_sem_dfe)},
      {t:'Folha',num:true,r:x=>valorOuIndeterminado(x.folha)}, {t:'Margem operacional',num:true,r:x=>x.margem_operacional?.natureza === 'INDETERMINADO' ? 'INDETERMINADO' : `${Number(x.margem_operacional?.valor || 0).toFixed(2)}%`}, {t:'Tratamentos',r:x=>A.esc(x.tratamentos_identificados)},
    ], historicoTributario) : ''}</div>` +
    `<div class="cartao" style="margin-top:16px"><h2>Comparador de regimes tributários</h2><p class="mini">A comparação consome a CBS já materializada pelo motor. Nenhuma carga total é inferida quando faltam componentes fiscais.</p>${A.tabela([
      {t:'Regime',r:x=>A.esc(x.rotulo)}, {t:'Tributos estimados',num:true,r:x=>x.tributos_estimados === null ? 'INDETERMINADO' : A.moeda(x.tributos_estimados)},
      {t:'Carga efetiva',num:true,r:x=>x.carga_efetiva_percentual === null ? 'INDETERMINADO' : A.pct(x.carga_efetiva_percentual)},
      {t:'Diferença para menor',num:true,r:x=>x.diferenca_para_menor === null ? 'INDETERMINADO' : A.moeda(x.diferenca_para_menor)}, {t:'Status',r:x=>A.esc(x.status)},
    ], comparador.cenarios || [])}
      <div class="grade g3" style="margin-top:14px">${A.kpi('Melhor cenário estimado', A.esc(comparador.melhor_cenario_estimado || 'INDETERMINADO'), 'somente com comparabilidade completa')}${A.kpi('Economia estimada', comparador.economia_estimada === null ? 'INDETERMINADO' : A.moeda(comparador.economia_estimada), comparador.status_comparacao || 'INCOMPLETA')}${A.kpi('Pendências', (comparador.pendencias || []).length, 'impedem vencedor artificial')}</div>
      ${(comparador.pendencias || []).length ? `<div class="aviso atencao" style="margin-top:12px"><b>Premissas e pendências</b><br>${comparador.pendencias.map((x)=>A.esc(x)).join('<br>')}</div>` : ''}
    </div>` +
    (atual ? `<div class="aviso bom"><b>Competência selecionada: ${A.esc(atual.competencia)}</b> · ${competencias.length}/${dados.competencias_detectadas || competencias.length} competências materializadas · Cobertura de classificação CBS: ${na(atual.cobertura_classificacao_cbs)} · Última atualização: ${A.esc(atual.atualizado_em || '—')}</div>
      <div class="grade g4" style="margin-top:16px">${A.kpi('Base econômica das saídas', A.moeda(atual.base_economica_saidas), 'soma do motor')}${A.kpi('CBS débito', A.moeda(atual.cbs_debito), 'saídas projetadas', 'destaque')}${A.kpi('CBS crédito', A.moeda(atual.cbs_credito), 'crédito calculado nas entradas', 'destaque')}${A.kpi('CBS líquida', A.moeda(atual.cbs_liquida), 'débito − crédito', 'destaque')}</div>
      <div class="grade g4" style="margin-top:16px">${A.kpi('Alíquota efetiva CBS', na(atual.aliquota_efetiva_cbs_saida), 'CBS débito / base das saídas')}${A.kpi('Recuperação das compras', na(atual.taxa_recuperacao_cbs_entrada), 'CBS crédito / base das entradas')}${A.kpi('Operações com tratamento especial', A.moeda(especiais), 'receita associada')}${A.kpi('Operações indeterminadas', A.moeda(indeterminadas), 'não distribuídas entre grupos conhecidos', indeterminadas ? 'destaque' : '')}</div>
      <div class="cartao" style="margin-top:16px"><h2>Evolução mensal CBS</h2>${A.tabela([{t:'Competência',r:x=>A.esc(x.competencia)},{t:'CBS débito',num:true,r:x=>A.moeda(x.cbs_debito)},{t:'CBS crédito',num:true,r:x=>A.moeda(x.cbs_credito)},{t:'CBS líquida',num:true,r:x=>A.moeda(x.cbs_liquida)},{t:'Débito / base',num:true,r:x=>na(x.aliquota_efetiva_cbs_saida)},{t:'',r:x=>`<button class="btn pq vazio" data-cbs-detalhe="${A.esc(x.competencia)}">Abrir memória</button>`}],competencias)}</div>
      <div class="grade g2" style="margin-top:16px"><div class="cartao"><h2>Receita por tratamento CBS</h2>${A.tabela([{t:'Tratamento',r:x=>x[0]},{t:'Receita',num:true,r:x=>A.moeda(x[1])}],[['Tributação integral',atual.receita_tributacao_integral],['Redução',atual.receita_reducao_cbs],['Alíquota zero',atual.receita_aliquota_zero_cbs],['Imunidade',atual.receita_imunidade_cbs],['Regime específico',atual.receita_regime_especifico_cbs],['Benefício governamental',atual.receita_beneficio_governo_cbs],['Indeterminado',atual.receita_tratamento_indeterminado_cbs]])}</div><div class="cartao"><h2>Compras por tratamento de crédito</h2>${A.tabela([{t:'Tratamento',r:x=>x[0]},{t:'Compras',num:true,r:x=>A.moeda(x[1])}],[['Normal',atual.compras_credito_normal],['Limitado',atual.compras_credito_limitado],['Simples',atual.compras_credito_simples],['Presumido',atual.compras_credito_presumido],['Sem crédito',atual.compras_sem_credito],['Indeterminado',atual.compras_credito_indeterminado]])}</div></div>
      <div class="cartao" style="margin-top:16px"><h2>Cobertura e natureza dos dados</h2><div class="grade g4">${A.kpi('Classificação CBS',na(atual.cobertura_classificacao_cbs))}${A.kpi('Base econômica',na(atual.cobertura_base_economica))}${A.kpi('Crédito CBS',na(atual.cobertura_credito_cbs))}${A.kpi('Indeterminado',na(atual.percentual_indeterminado),'não é distribuído')}</div><p class="mini">Natureza: REAL ${na(atual.percentual_real)} · CALCULADO ${na(atual.percentual_calculado)} · SIMULADO ${na(atual.percentual_simulado)} · INDETERMINADO ${na(atual.percentual_indeterminado)}.</p></div>` : A.vazio('Nenhuma competência CBS materializada', 'Importe XML, SPED ou planilha. Depois clique em “Atualizar Perfil CBS”; a competência será detectada automaticamente.', ''));
  el.querySelector('#atualizarCbs').onclick = async () => { await A.api(`/empresas/${S.empresaId}/perfil-cbs/atualizar`, { metodo: 'POST', corpo: {} }); A.ir('perfil'); };
  el.querySelector('#centralDadosPerfil').onclick = () => A.ir('dados');
  el.querySelector('#centralDadosApuracao')?.addEventListener('click', () => A.ir('dados'));
  el.querySelector('#complementarCbs').onclick = () => A.ir('dados');
  el.querySelectorAll('[data-apuracao-reprocessar]').forEach((b) => { b.onclick = () => abrirIngestaoApuracao(() => A.ir('perfil'), true); });
  el.querySelectorAll('[data-apuracao-revisar]').forEach((b) => { b.onclick = () => { const a = apuracoes.find((x) => Number(x.id) === Number(b.dataset.apuracaoRevisar)); if (a) A.modal({ titulo: `Revisar — ${a.nome_original}`, largura: 1200, corpo: tabelaCamposApuracao(a.campos_extraidos) }); }; });
  el.querySelectorAll('[data-apuracao-confirmar]').forEach((b) => { b.onclick = () => A.confirmar('Confirmar os valores identificados? Campos sem valor continuarão indeterminados.', async () => { await A.api(`/empresas/${S.empresaId}/apuracoes-pis-cofins/${b.dataset.apuracaoConfirmar}/confirmar`, { metodo: 'POST', corpo: {} }); A.toast('Revisão confirmada pelo usuário.', 'ok'); A.ir('perfil'); }); });
  el.querySelectorAll('[data-cbs-detalhe]').forEach((b) => { b.onclick = async () => { const d = await A.api(`/empresas/${S.empresaId}/perfil-cbs/${encodeURIComponent(b.dataset.cbsDetalhe)}/detalhes`); A.modal({ titulo: `Memória CBS — ${b.dataset.cbsDetalhe}`, largura: 1100, corpo: A.tabela([{t:'Documento',r:x=>A.esc(x.documento||x.chave||'—')},{t:'Item / parceiro',r:x=>`${A.esc(x.descricao||'—')}<br><span class="mini">${A.esc(x.nome||'—')}</span>`},{t:'NCM/NBS',r:x=>A.esc(x.ncm||x.nbs||'—')},{t:'CST / cClassTrib',r:x=>`${A.esc(x.cst||'—')} / ${A.esc(x.cclasstrib||'—')}`},{t:'Tratamento',r:x=>A.esc(x.tratamento||'—')},{t:'Base',num:true,r:x=>A.moeda(x.base_economica)},{t:'CBS',num:true,r:x=>A.moeda(x.cbs)},{t:'Crédito CBS',num:true,r:x=>A.moeda(x.credito_cbs)},{t:'Crédito',r:x=>A.esc(x.status_credito||'—')},{t:'Natureza',r:x=>A.esc(x.natureza||'—')}],d.operacoes||[]) }); }; });
};

const barras = (itens) => itens.map(([rot, v]) => `<div style="margin-bottom:11px">
  <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span>${rot}</span><span class="mono">${A.pct(v)}</span></div>
  <div class="barra-prog"><i style="width:${Math.min(100, (v || 0) * 100)}%"></i></div></div>`).join('');

// ===========================================================================
// 1.b / 1.c CADEIAS
// ===========================================================================
async function telaCadeia(el, tipo) {
  const rep = S.cache[`rep_${tipo}`] === undefined ? 1 : S.cache[`rep_${tipo}`];
  const { analise, pendenciasReferencias = [] } = await A.api(`/empresas/${S.empresaId}/cadeia/${tipo}?repasse=${rep}`);
  const eForn = tipo === 'fornecedor';
  const t = analise.totais;
  const ultimo = analise.cenarios[analise.cenarios.length - 1] || {};
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);
  const cbsReferencia = Number(S.params?.aliquotaReferencia?.cbs) || 0;
  const ibsReferencia = ibsAtivo ? (Number(S.params?.aliquotaReferencia?.ibs) || 0) : 0;
  const rotuloBase = ibsAtivo ? 'Base econômica integral' : 'Base econômica CBS';
  const abaCliente = S.aba.clientesCadeia || 'carteira';
  const mostrarCarteira = eForn || abaCliente === 'carteira';
  const mostrarRiscos = eForn || abaCliente === 'riscos';
  const mostrarAbc = eForn || abaCliente === 'abc';
  const mostrarRastreabilidade = !eForn && abaCliente === 'rastreabilidade';

  el.innerHTML = cab(eForn ? 'Módulo 1.b' : 'Módulo 1.c',
    eForn ? 'Análise da cadeia de fornecedores' : 'Análise da cadeia de clientes',
    eForn ? 'Impacto da reforma no preço das compras da empresa. O crédito potencial é exibido separadamente e não reduz o impacto do preço.'
          : 'Impacto da reforma no preço das vendas da empresa. O perfil do cliente não altera o IBS/CBS devido na saída; ele apenas orienta a relevância comercial do crédito potencial.',
    `<button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/${eForn ? 'fornecedores' : 'clientes'}?repasse=${rep}')">Exportar Excel</button>`) +
    (!eForn && pendenciasReferencias.length ? `<div class="aviso atencao" style="margin-top:16px"><b>${pendenciasReferencias.length} lançamento(s) de serviço estão sem referência fiscal específica.</b> A análise foi carregada com a melhor evidência disponível (documento, catálogo ou regime da empresa). <button class="btn pq vazio" id="corrigirDadosCadeia">Corrigir na Central de Dados</button> Esses itens permanecem <b>a validar</b>.</div>` : '') +
    (t.registros ? `
    <div class="grade g4">
      ${A.kpi(eForn ? 'Compra atual' : 'Venda atual', A.moeda(t.valor), `${t.registros} lançamentos · ${t.parceiros} ${eForn ? 'fornecedores' : 'clientes'}`)}
      ${A.kpi(rotuloBase, A.moeda(ultimo.baseEconomica || 0), ibsAtivo ? 'visão IBS + CBS' : 'venda atual menos PIS/COFINS; ISS/ICMS preservados')}
      ${A.kpi(eForn ? 'Compra projetada' : 'Venda projetada', A.moeda(ultimo.precoFinal || 0), ibsAtivo ? 'IBS + CBS' : 'CBS')}
      ${A.kpi(eForn ? 'Impacto da compra' : 'Impacto da venda', A.setaR$(ultimo.impactoOperacao || 0), A.setaPct(ultimo.impactoOperacaoPerc || 0) + ' sobre o preço atual', 'destaque')}
    </div>
    <div class="cartao" style="margin-top:16px"><h2>${eForn ? 'Impacto para a empresa — entradas' : 'Impacto para a empresa — saídas'}</h2>
      <p class="desc">${eForn ? 'Compra atual − tributos substituídos = base econômica + IBS + CBS = compra projetada − compra atual = impacto da compra.' : (ibsAtivo ? 'Venda atual − tributos substituídos = base econômica integral + IBS + CBS = venda projetada − venda atual = impacto da venda.' : 'Venda atual − PIS/COFINS atuais = base econômica CBS + CBS = venda projetada − venda atual = impacto da venda. ISS e ICMS permanecem na estrutura econômica.') } CBS configurada: <b>${A.pct(cbsReferencia)}</b>${ibsAtivo ? ` · IBS configurado: <b>${A.pct(ibsReferencia)}</b>` : ' · IBS desabilitado nesta análise.'}</p>
      ${A.tabela([
        { t: eForn ? 'Compra atual' : 'Venda atual', num: true, r: () => A.moeda(t.valor) },
        ...(!eForn ? [{ t: 'Tributos atuais retirados', num: true, r: () => A.moeda(analise.regimes.reduce((s, r) => s + (Number(r.pisCofinsAtual) || 0), 0)) }] : []),
        { t: rotuloBase, num: true, r: () => A.moeda(ultimo.baseEconomica || 0) },
        ...(ibsAtivo ? [{ t: 'IBS projetado', num: true, r: () => A.moeda(ultimo.ibs || 0) }] : []),
        { t: 'Alíquota CBS', num: true, r: () => A.pct(cbsReferencia) },
        { t: 'CBS projetada', num: true, r: () => A.moeda(ultimo.cbs || 0) },
        { t: eForn ? 'Compra projetada' : 'Venda projetada', num: true, r: () => A.moeda(ultimo.precoFinal || 0) },
        { t: 'Impacto R$', num: true, r: () => A.setaR$(ultimo.impactoOperacao || 0) },
        { t: 'Impacto %', num: true, r: () => A.setaPct(ultimo.impactoOperacaoPerc || 0) },
      ], [{}])}
      <p class="mini" style="margin-top:12px"><b>Crédito potencial juridicamente associado à operação:</b> ${A.moeda(ultimo.creditoPotencial || 0)}. A CBS da venda é exibida separadamente e não pressupõe direito de crédito para Pessoa Física, Simples ou outro perfil sem apropriação.</p>
      ${!eForn ? `<div class="aviso neutro" style="margin-top:12px"><b>Origem do PIS/COFINS usado na base econômica</b><br>${Object.entries(t.origensPisCofins || {}).map(([origem, x]) => `${A.esc(origem)}: <b>${A.moeda(x.valor)}</b> em ${x.registros} lançamento(s) · ${A.pct(t.valor ? x.vendas / t.valor : 0, 1)} das vendas`).join(' · ') || 'Sem informação disponível.'}</div>` : ''}
    </div>
    ${eForn ? `<div class="cartao" style="margin-top:16px">
      <h2>Grau de repasse simulado</h2>
      <p class="desc">100% = o fornecedor repassa integralmente a desoneração/oneração ao preço. 0% = preço congelado.</p>
      <input type="range" min="0" max="1" step="0.1" value="${rep}" id="repasse">
      <div style="display:flex;justify-content:space-between" class="mini"><span>0% (preço congelado)</span><b class="mono">${A.pct(rep, 0)}</b><span>100% (repasse total)</span></div>
    </div>` : ''}
    ${!eForn ? `<div class="abas" style="margin-top:16px">
      <button class="${abaCliente === 'carteira' ? 'ativo' : ''}" data-aba-cliente="carteira">Carteira por perfil</button>
      <button class="${abaCliente === 'riscos' ? 'ativo' : ''}" data-aba-cliente="riscos">Riscos e oportunidades</button>
      <button class="${abaCliente === 'abc' ? 'ativo' : ''}" data-aba-cliente="abc">Curva ABC</button>
      <button class="${abaCliente === 'rastreabilidade' ? 'ativo' : ''}" data-aba-cliente="rastreabilidade">Rastreabilidade</button>
    </div>` : ''}
    ${mostrarRiscos ? `<div class="cartao" style="margin-top:16px"><h2>Riscos e oportunidades</h2><p class="desc">Leitura da carteira sob a ótica da empresa vendedora.</p>${A.avisos(analise.riscos)}
      ${!eForn && analise.riscos.some((r) => r.codigo === 'base_estimada_regime') ? '<button class="btn vazio" id="corrigirReferencias" style="margin-top:12px">Corrigir referências fiscais dos serviços</button>' : ''}
    </div>` : ''}
    ${mostrarCarteira ? `<div class="cartao" style="margin-top:16px"><h2>${eForn ? 'Compras por regime do fornecedor' : 'Carteira por perfil de cliente'}</h2>
        <p class="desc">${eForn ? 'O regime do fornecedor determina o crédito que a empresa toma' : 'O perfil do cliente indica a relevância econômica do crédito potencial; não altera o IBS/CBS da venda'}</p>
        ${A.tabela([
          { t: eForn ? 'Regime' : 'Perfil', r: (r) => `${A.esc(r.label)}<div class="mini">${r.parceiros} ${eForn ? 'fornecedores' : 'clientes'}</div>` },
          { t: 'Valor', num: true, r: (r) => A.moeda(r.valor) },
          { t: 'Part.', num: true, r: (r) => A.pct(r.representatividade, 1) },
          ...(!eForn ? [
            { t: ibsAtivo ? 'Base econômica integral' : 'Base econômica CBS', num: true, r: (r) => A.moeda(r.baseEconomica) },
            { t: 'PIS/COFINS atual', num: true, r: (r) => A.moeda(r.pisCofinsAtual) },
          ] : []),
          ...(ibsAtivo ? [{ t: eForn ? 'IBS da compra' : 'IBS da venda', num: true, r: (r) => A.moeda(r.ibs) }] : []),
          { t: eForn ? 'CBS da compra' : 'CBS da venda', num: true, r: (r) => A.moeda(r.cbs) },
          { t: eForn ? 'Compra projetada' : 'Venda projetada', num: true, r: (r) => A.moeda(r.precoFinal) },
          { t: eForn ? 'Impacto da compra' : 'Impacto da venda', num: true, r: (r) => A.setaR$(r.impactoOperacao) },
          { t: 'Crédito potencial da operação', num: true, r: (r) => A.moeda(r.creditoPotencial) },
          { t: eForn ? 'Relevância para a empresa' : 'Relevância para o cliente', r: (r) => `<span class="tag ${String(r.relevanciaCreditoCliente || '').startsWith('Potencialmente') ? 'c' : 'n'}">${A.esc(r.relevanciaCreditoCliente)}</span>` },
        ], analise.regimes)}
      </div>
    <div class="cartao" style="margin-top:16px"><h2>${ibsAtivo ? 'Projeção ano a ano' : 'Referência CBS'}</h2>
      ${ibsAtivo ? A.tabela([
        { t: 'Ano', r: (c) => `<b class="mono">${c.ano}</b>` },
        { t: 'Base econômica', num: true, r: (c) => A.moeda(c.baseEconomica) },
        { t: 'IBS', num: true, r: (c) => A.moeda(c.ibs) },
        { t: 'CBS', num: true, r: (c) => A.moeda(c.cbs) },
        { t: eForn ? 'Compra projetada' : 'Venda projetada', num: true, r: (c) => A.moeda(c.precoFinal) },
        { t: 'Impacto', num: true, r: (c) => A.setaR$(c.impactoOperacao) },
        { t: 'Marco', r: (c) => `<span class="mini">${A.esc(c.nota)}</span>` },
      ], analise.cenarios) : `<div class="grade g3 projecao-cbs-resumo">
        ${A.kpi(eForn ? 'CBS da compra' : 'CBS da venda', A.moeda(ultimo.cbs || 0), 'incidência sobre a base econômica')}
        ${A.kpi(eForn ? 'Compra projetada' : 'Venda projetada', A.moeda(ultimo.precoFinal || 0), 'antes de qualquer crédito')}
        ${A.kpi(eForn ? 'Impacto da compra' : 'Impacto da venda', A.setaR$(ultimo.impactoOperacao || 0), A.setaPct(ultimo.impactoOperacaoPerc || 0) + ' vs. hoje', 'destaque')}
      </div>`}
    </div>` : ''}
    ${mostrarAbc ? `<div class="cartao" style="margin-top:16px"><h2>Curva ABC — ${eForn ? 'fornecedores' : 'clientes'}</h2>
      <p class="desc">Classe A concentra 80% do volume. É por onde a renegociação começa.</p>
      ${A.tabela([
        { t: 'ABC', r: (p) => `<span class="tag ${p.classeAbc === 'A' ? 'b' : 'n'}">${p.classeAbc}</span>` },
        { t: eForn ? 'Fornecedor' : 'Cliente', r: (p) => `${A.esc(p.nome)}<div class="mini mono">${A.cnpjFmt(p.cnpj)}</div>` },
        { t: 'Regime', r: (p) => `<span class="tag ${['simples_nacional', 'mei'].includes(p.regime) ? 'a' : ''}">${A.esc(p.regimeLabel)}</span>` },
        { t: 'Valor', num: true, r: (p) => A.moeda(p.valor) },
        { t: 'Part.', num: true, r: (p) => A.pct(p.representatividade, 1) },
        { t: rotuloBase, num: true, r: (p) => A.moeda(p.baseEconomica) },
        ...(ibsAtivo ? [{ t: 'IBS', num: true, r: (p) => A.moeda(p.ibs) }] : []),
        { t: 'CBS', num: true, r: (p) => A.moeda(p.cbs) },
        { t: eForn ? 'Compra projetada' : 'Venda projetada', num: true, r: (p) => A.moeda(p.precoFinal) },
        { t: 'Impacto', num: true, r: (p) => A.setaR$(p.impactoOperacao) },
        { t: 'Crédito potencial', num: true, r: (p) => A.moeda(p.creditoPotencial) },
        { t: 'Relevância do crédito', r: (p) => `<span class="tag ${String(p.relevanciaCreditoCliente || '').startsWith('Potencialmente') ? 'c' : 'n'}">${A.esc(p.relevanciaCreditoCliente)}</span>` },
      ], analise.parceiros.slice(0, 200))}
    </div>` : ''}
    ${mostrarRastreabilidade ? `<div class="cartao" style="margin-top:16px"><h2>Rastreabilidade da base econômica</h2>
      <p class="desc">Mostra, documento a documento, tributos identificados e os efetivamente retirados na metodologia ${ibsAtivo ? 'integral' : 'CBS-only'}. Não recalcula nada nesta tela: todos os dados vêm da memória persistida do motor.</p>
      ${A.tabela([
        { t: 'Documento', r: (d) => `<b class="mono">${A.esc(d.documento || 'sem número')}</b><div class="mini">${A.esc(d.competencia || '')}</div>` },
        { t: 'Cliente', r: (d) => `${A.esc(d.parceiro)}<div class="mini mono">${A.cnpjFmt(d.cnpj)}</div>` },
        { t: 'Serviço', r: (d) => `${A.esc(d.produto)}<div class="mini mono">${A.esc(d.nbs || d.ncm || 'sem NBS/NCM')}</div>` },
        { t: 'Venda atual', num: true, r: (d) => A.moeda(d.valor) },
        { t: 'ICMS retirado', num: true, r: (d) => A.moeda(d.tributosRetirados?.icms) },
        { t: 'ISS retirado', num: true, r: (d) => A.moeda(d.tributosRetirados?.iss) },
        ...(!ibsAtivo ? [
          { t: 'ICMS identificado (preservado)', num: true, r: (d) => A.moeda(d.tributosIdentificados?.icms) },
          { t: 'ISS identificado (preservado)', num: true, r: (d) => A.moeda(d.tributosIdentificados?.iss) },
        ] : []),
        { t: 'PIS retirado', num: true, r: (d) => A.moeda(d.tributosRetirados?.pis) },
        { t: 'COFINS retirado', num: true, r: (d) => A.moeda(d.tributosRetirados?.cofins) },
        { t: 'Total retirado', num: true, r: (d) => A.moeda(d.tributosRetirados?.total) },
        { t: rotuloBase, num: true, r: (d) => A.moeda(d.valorSemImposto) },
        { t: 'Origem', r: (d) => `<span class="tag ${String(d.origemBaseEconomica).toUpperCase() === 'DOCUMENTO' ? 'c' : 'a'}">${A.esc(d.origemBaseEconomica || 'a validar')}</span>` },
        { t: 'Memória por tributo', r: (d) => ['pis', 'cofins', 'iss', 'icms'].map((k) => {
          const m = d.memoriaTributos?.[k];
          return m ? `${k.toUpperCase()}: ${A.esc(m.origem || 'INDETERMINADO')} · ${A.esc(m.regra || m.status || '')}` : '';
        }).filter(Boolean).join('<br>') },
        { t: 'Motivo / regra usada', r: (d) => `<span class="mini">${A.esc(d.motivoBaseEconomica || d.formulaBaseEconomica)}</span>` },
        { t: 'Natureza', r: (d) => `<span class="tag ${String(d.natureza).toUpperCase() === 'REAL' ? 'c' : String(d.natureza).toUpperCase() === 'SIMULADO' ? 'a' : 'n'}">${A.esc(d.natureza || 'INDETERMINADO')}</span>` },
        ...(ibsAtivo ? [{ t: 'IBS', num: true, r: (d) => A.moeda(d.ibs) }] : []),
        { t: 'CBS', num: true, r: (d) => A.moeda(d.cbs) },
        { t: 'Venda projetada', num: true, r: (d) => A.moeda(d.precoFinal) },
        { t: 'Impacto', num: true, r: (d) => A.setaR$(d.impactoOperacao) },
        { t: 'Impacto %', num: true, r: (d) => A.setaPct(d.impactoOperacaoPerc) },
      ], analise.detalhes.slice(0, 500), { vazio: 'Não há vendas para rastrear.' })}
    </div>` : ''}` : A.vazio('Sem movimentação importada',
      `Importe a movimentação de ${eForn ? 'fornecedores' : 'clientes'} para gerar esta análise.`,
      '<button class="btn" onclick="App.ir(\'dados\')">Ir para importação</button>'));

  const r = document.getElementById('repasse');
  if (r) r.onchange = () => { S.cache[`rep_${tipo}`] = Number(r.value); A.ir(tipo === 'fornecedor' ? 'fornecedores' : 'clientes'); };
  el.querySelectorAll('[data-aba-cliente]').forEach((botao) => {
    botao.onclick = () => { S.aba.clientesCadeia = botao.dataset.abaCliente; A.ir('clientes'); };
  });
  document.getElementById('corrigirDadosCadeia')?.addEventListener('click', () => {
    S.aba.dados = 'cliente'; S.aba.dadosMotor = 'atual'; A.ir('dados');
  });
  document.getElementById('corrigirReferencias')?.addEventListener('click', () => { S.aba.dados = 'cliente'; A.ir('dados'); });
}
Telas.fornecedores = (el) => telaCadeia(el, 'fornecedor');
Telas.clientes = (el) => telaCadeia(el, 'cliente');

// Consolida Cadeia de Clientes + Fornecedores. Não executa cálculo próprio.
Telas.impactoFinalCbs = async (el) => {
  const d = await A.api(`/empresas/${S.empresaId}/impacto-final-cbs`);
  const naoApurado = (v) => v === null || v === undefined;
  const dinheiro = (v) => naoApurado(v) ? 'A validar' : A.moeda(v);
  const percentual = (v) => naoApurado(v) ? 'A validar' : A.pct(v, 2);
  const diferenca = (v) => naoApurado(v) ? 'A validar' : A.setaR$(v);
  const rec = d.reconciliacao || {};
  el.innerHTML = cab('Módulo 1 · Consolidação CBS', 'Impacto Final CBS da Cadeia',
    'Leitura consolidada das Cadeias de Clientes e Fornecedores. Não há novo motor: os valores abaixo são as somas das análises já apuradas.') +
    `<div class="grade g4">
      ${A.kpi('PIS/COFINS atual', dinheiro(d.pis_cofins_liquido_atual), naoApurado(d.pis_cofins_liquido_atual) ? 'há dado atual indeterminado' : `${A.pct(d.carga_atual_percentual || 0, 2)} sobre venda atual · ${A.esc(d.origem_carga_atual || 'INDETERMINADO')}`)}
      ${A.kpi('CBS líquida projetada', dinheiro(d.cbs_liquida), 'CBS das vendas − crédito CBS das compras', 'destaque')}
      ${A.kpi('Diferença R$', diferenca(d.variacao_carga_federal), 'CBS líquida vs. PIS/COFINS líquido atual', naoApurado(d.variacao_carga_federal) ? '' : 'destaque')}
      ${A.kpi('Diferença p.p.', percentual(d.variacao_percentual), naoApurado(d.variacao_percentual) ? 'não é tratada como zero' : 'CBS líquida % − carga atual %')}
    </div>
    ${d.pis_cofins_indeterminado ? `<div class="aviso atencao" style="margin-top:16px"><b>PIS/COFINS líquido atual a validar.</b> Existe operação sem base suficiente para apurar o valor atual; por isso a diferença percentual não foi convertida em zero.</div>` : ''}
    <div class="cartao" style="margin-top:16px"><h2>Formação da CBS líquida</h2>
      ${A.tabela([
        { t: 'Componente', r: x => `<b>${A.esc(x.nome)}</b><div class="mini">${A.esc(x.memoria)}</div>` },
        { t: 'Valor', num: true, r: x => dinheiro(x.valor) },
      ], [
        { nome:'CBS débito das vendas', memoria:'soma da CBS das saídas — Cadeia de Clientes', valor:d.cbs_debito_vendas },
        { nome:'(-) Crédito CBS recebido dos fornecedores', memoria:'soma do crédito CBS aproveitável nas entradas — Cadeia de Fornecedores', valor:-d.cbs_credito_compras },
        { nome:'CBS líquida projetada', memoria:'CBS débito − crédito CBS das compras', valor:d.cbs_liquida },
      ])}
      <div class="grade g2" style="margin-top:16px">
        ${A.kpi('Carga efetiva sobre venda atual', percentual(d.carga_efetiva_cbs_receita), 'CBS líquida / venda atual')}
        ${A.kpi('Carga efetiva sobre base econômica das saídas', percentual(d.carga_efetiva_cbs_base), 'CBS líquida / base econômica das saídas')}
      </div>
    </div>
    <div class="grade g2" style="margin-top:16px">
      <div class="cartao"><h2>Crédito CBS recebido dos fornecedores</h2><p class="valor-destaque">${A.moeda(d.credito_cbs_recebido_fornecedores)}</p><p class="mini">Reduz a CBS líquida da empresa quando aproveitável.</p><button class="btn vazio" data-ir-cadeia="fornecedores">Abrir Cadeia de Fornecedores</button></div>
      <div class="cartao"><h2>Crédito CBS entregue aos clientes</h2><p class="valor-destaque">${A.moeda(d.credito_cbs_entregue_clientes)}</p><p class="mini">Indicador comercial/econômico. Não reduz a CBS líquida da empresa.</p><button class="btn vazio" data-ir-cadeia="clientes">Abrir Cadeia de Clientes</button></div>
    </div>
    <div class="cartao" style="margin-top:16px"><h2>Reconciliação com motor_resultados</h2>
      ${rec.disponivel ? `<div class="aviso ${rec.confere ? 'bom' : 'atencao'}"><b>${rec.confere ? 'Valores conciliados.' : 'Há divergência a revisar.'}</b> Comparação com ${rec.itens} item(ns) materializados pelo motor.</div>
      ${A.tabela([{t:'Componente',r:x=>x.nome},{t:'Cadeia',num:true,r:x=>A.moeda(x.cadeia)},{t:'motor_resultados',num:true,r:x=>A.moeda(x.motor)},{t:'Diferença',num:true,r:x=>A.setaR$(x.diferenca)}],[
        {nome:'CBS débito das vendas',cadeia:d.cbs_debito_vendas,motor:rec.cbsDebitoVendas,diferenca:rec.diferencaDebito},
        {nome:'Crédito CBS das compras',cadeia:d.cbs_credito_compras,motor:rec.cbsCreditoCompras,diferenca:rec.diferencaCredito},
      ])}` : `<div class="aviso atencao"><b>Reconciliação pendente.</b> Execute “Recalcular projeto” para materializar o motor_resultados e conferir as somas.</div>`}
    </div>
    <div class="cartao" style="margin-top:16px"><h2>Memória do PIS/COFINS atual</h2><p class="desc">Débitos atuais: ${A.moeda(d.pis_cofins_debitos_atuais)} · Créditos atuais: ${A.moeda(d.pis_cofins_creditos_atuais)}.</p><button class="btn vazio" id="abrirMemoriaAtual">Abrir rastreabilidade das vendas</button></div>`;
  el.querySelectorAll('[data-ir-cadeia]').forEach((b) => b.onclick = () => A.ir(b.dataset.irCadeia));
  document.getElementById('abrirMemoriaAtual').onclick = () => { S.aba.clientesCadeia = 'rastreabilidade'; A.ir('clientes'); };
};

// ===========================================================================
// 1.d PROJEÇÃO DE CENÁRIOS
// ===========================================================================
Telas.cenarios = async (el) => {
  const rep = S.cache.repCen === undefined ? 1 : S.cache.repCen;
  const d = await A.api(`/empresas/${S.empresaId}/cenarios?repasse=${rep}`);
  const base = d.consolidado[0] || {}, fim = d.consolidado[d.consolidado.length - 1] || {};
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);
  el.innerHTML = cab('Módulo 1.d', 'Projeção de cenários',
    ibsAtivo ? 'Receita, custo e resultado bruto ano a ano, aplicando o cronograma constitucional sobre a movimentação real da empresa.' : 'Receita, custo e resultado bruto na projeção CBS de referência, sobre a movimentação real da empresa.',
    `<button class="btn vazio" id="salvarCen">Salvar cenário</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/diagnostico?repasse=${rep}')">Exportar Excel</button>`) +
    (ibsAtivo ? A.regua(2033, null) : '<div class="aviso bom"><b>Projeção CBS</b> Esta análise usa uma referência única. A transição anual ficará disponível somente quando o IBS for habilitado.</div>') +
    `<div class="grade g4">
      ${A.kpi('Resultado bruto hoje', A.moeda(base.resultadoBruto || 0), `margem ${A.pct(base.margemPerc || 0)}`)}
      ${A.kpi(`Resultado bruto ${ibsAtivo ? 'final' : 'CBS'}`, A.moeda(fim.resultadoBruto || 0), `margem ${A.pct(fim.margemPerc || 0)}`, 'destaque')}
      ${A.kpi('Variação de resultado', A.setaR$(d.resumo.variacaoResultado), 'no cenário final')}
      ${A.kpi('Variação da carga', A.setaPct(d.resumo.variacaoCarga), 'sobre as saídas')}
    </div>
    <div class="cartao" style="margin-top:16px">
      <h2>Grau de repasse</h2><p class="desc">Quanto da variação tributária vai para o preço</p>
      <input type="range" min="0" max="1" step="0.1" value="${rep}" id="repCen">
      <div style="display:flex;justify-content:space-between" class="mini"><span>0%</span><b class="mono">${A.pct(rep, 0)}</b><span>100%</span></div>
    </div>
    <div class="cartao"><h2>${ibsAtivo ? 'Demonstrativo projetado' : 'Demonstrativo CBS projetado'}</h2>
      <p class="desc">Receita (-) impostos (-) custos = margem bruta, na estrutura da cartilha</p>
      ${ibsAtivo ? A.tabela([
        { t: 'Ano', r: (c) => `<b class="mono">${c.ano}</b>` },
        { t: 'Receita bruta', num: true, r: (c) => A.moeda(c.receitaBruta) },
        { t: '(-) Tributos', num: true, r: (c) => A.moeda(c.tributosSaida) },
        { t: '= Receita líquida', num: true, r: (c) => A.moeda(c.receitaLiquida) },
        { t: '(-) Custo efetivo', num: true, r: (c) => A.moeda(c.custoEfetivo) },
        { t: '= Resultado bruto', num: true, r: (c) => `<b>${A.moeda(c.resultadoBruto)}</b>` },
        { t: 'Margem', num: true, r: (c) => A.pct(c.margemPerc) },
        { t: 'Carga', num: true, r: (c) => A.pct(c.cargaEfetiva) },
        { t: 'Marco do ano', r: (c) => `<span class="mini">${A.esc(c.nota)}</span>` },
      ], d.consolidado) : A.tabela([
        { t: 'Receita bruta', num: true, r: () => A.moeda(fim.receitaBruta) },
        { t: '(-) Tributos CBS', num: true, r: () => A.moeda(fim.tributosSaida) },
        { t: '= Receita líquida', num: true, r: () => A.moeda(fim.receitaLiquida) },
        { t: '(-) Custo efetivo', num: true, r: () => A.moeda(fim.custoEfetivo) },
        { t: '= Resultado bruto', num: true, r: () => `<b>${A.moeda(fim.resultadoBruto)}</b>` },
        { t: 'Margem', num: true, r: () => A.pct(fim.margemPerc) },
        { t: 'Carga CBS', num: true, r: () => A.pct(fim.cargaEfetiva) },
      ], [{}])}
    </div>
    <div class="cartao"><h2>Riscos consolidados</h2>${A.avisos(d.riscos)}</div>`;

  const r = document.getElementById('repCen');
  r.onchange = () => { S.cache.repCen = Number(r.value); A.ir('cenarios'); };
  document.getElementById('salvarCen').onclick = () => A.modal({
    titulo: 'Salvar cenário', corpo: A.campo('nome', 'Nome do cenário', `Repasse ${A.pct(rep, 0)}`) + A.area('descricao', 'Premissas', ''),
    aoConfirmar: async (dd) => { await A.api(`/empresas/${S.empresaId}/cenarios/salvar`, { metodo: 'POST',
      corpo: { ...dd, parametros: { repasse: rep }, resultado: d } }); A.toast('Cenário salvo', 'ok'); },
  });
};

// ===========================================================================
// CALCULADORA
// ===========================================================================
Telas.calculadora = async (el) => {
  const v = S.cache.calc || { valor: 10000, regime: 'lucro_real', regimeAdquirente: S.empresa?.regime || 'lucro_real',
    tipo: 'mercadoria', reducao: 'integral', aliqIcms: 0.18, aliqIss: 0.03, grauRepasse: 1 };
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);

  el.innerHTML = cab('Ferramenta', 'Calculadora da reforma tributária',
    ibsAtivo ? 'Volta a base do preço até o valor sem imposto — respeitando o regime de quem emite — e reaplica o IVA por fora, ano a ano.' : 'Volta a base do preço até o valor sem imposto e aplica a CBS por fora, em uma referência única.') +
    `<div class="grade g2">
      <div class="cartao">
        <h2>Dados da operação</h2><p class="desc">Informe os valores da nota. Deixe os impostos em branco para o sistema estimar pelo regime.</p>
        <div class="grade g2">
          ${A.campo('valor', 'Valor total da operação (R$)', v.valor, 'number', 'step=0.01')}
          ${A.selecao('tipo', 'Natureza', [{ v: 'mercadoria', t: 'Mercadoria' }, { v: 'servico', t: 'Serviço' }], v.tipo)}
        </div>
        <div class="grade g2">
          ${A.selecao('regime', 'Regime de quem EMITE', A.opcoesRegime(), v.regime)}
          ${A.selecao('regimeAdquirente', 'Regime de quem RECEBE', A.opcoesRegime(), v.regimeAdquirente)}
        </div>
        ${A.selecao('reducao', `Enquadramento no ${ibsAtivo ? 'IBS/CBS' : 'CBS'}`, A.opcoesReducao(), v.reducao)}
        <hr class="sep">
        <h2 style="font-size:13px">Impostos destacados na nota</h2>
        <p class="desc">Opcional — preencha se tiver os valores reais</p>
        <div class="grade g3">
          ${A.campo('icms', 'ICMS (R$)', '', 'number', 'step=0.01')}
          ${A.campo('pis', 'PIS (R$)', '', 'number', 'step=0.01')}
          ${A.campo('cofins', 'COFINS (R$)', '', 'number', 'step=0.01')}
        </div>
        <div class="grade g3">
          ${A.campo('ipi', 'IPI (R$)', '', 'number', 'step=0.01')}
          ${A.campo('iss', 'ISS (R$)', '', 'number', 'step=0.01')}
          ${A.campo('icmsSt', 'ICMS-ST (R$)', '', 'number', 'step=0.01')}
        </div>
        <div class="grade g2">
          ${A.campo('aliqIcms', 'Alíquota ICMS (ex.: 0,18)', v.aliqIcms, 'number', 'step=0.0001')}
          ${A.campo('aliqIss', 'Alíquota ISS (ex.: 0,03)', v.aliqIss, 'number', 'step=0.0001')}
        </div>
        ${A.campo('aliqEspecifica', 'Alíquota efetiva do regime específico (ex.: 0,10)', '', 'number', 'step=0.0001')}
        <button class="btn ouro" id="calcular" style="width:100%;margin-top:8px">Calcular</button>
      </div>
      <div id="resultadoCalc"></div>
    </div>`;

  const ler = () => {
    const o = {};
    el.querySelectorAll('[name]').forEach((i) => { o[i.name] = i.value === '' ? undefined : (i.type === 'number' ? Number(i.value) : i.value); });
    return o;
  };
  const calcular = async () => {
    const dados = ler();
    S.cache.calc = dados;
    const { resultado } = await A.api('/calculadora', { metodo: 'POST', corpo: dados });
    mostrar(resultado);
  };
  document.getElementById('calcular').onclick = () => calcular().catch((e) => A.toast(e.message, 'erro'));

  function mostrar(r) {
    const a = r.atual, fim = r.projecao[r.projecao.length - 1];
    document.getElementById('resultadoCalc').innerHTML = `
      <div class="cartao">
        <h2>Volta da base — situação atual</h2>
        <p class="desc">${A.esc(a.regimeLabel)} · ${a.tipo === 'servico' ? 'Serviço' : 'Mercadoria'}</p>
        <table>
          <tr><td>Valor total da operação</td><td class="num mono"><b>${A.moeda(a.valorOperacao)}</b></td></tr>
          ${a.tributos.icms ? `<tr><td>(-) ICMS</td><td class="num mono">${A.moeda(a.tributos.icms)}</td></tr>` : ''}
          ${a.tributos.iss ? `<tr><td>(-) ISS</td><td class="num mono">${A.moeda(a.tributos.iss)}</td></tr>` : ''}
          ${a.tributos.pis || a.tributos.cofins ? `<tr><td>(-) PIS/COFINS</td><td class="num mono">${A.moeda(a.tributos.pis + a.tributos.cofins)}</td></tr>` : ''}
          ${a.tributos.ipi ? `<tr><td>(-) IPI</td><td class="num mono">${A.moeda(a.tributos.ipi)}</td></tr>` : ''}
          ${a.tributos.icmsSt ? `<tr><td>(-) ICMS-ST</td><td class="num mono">${A.moeda(a.tributos.icmsSt)}</td></tr>` : ''}
          <tr style="background:var(--ouro-100)"><td><b>= Valor sem imposto (base limpa)</b></td><td class="num mono"><b>${A.moeda(a.valorSemImposto)}</b></td></tr>
          <tr><td>Carga efetiva atual</td><td class="num mono">${A.pct(a.cargaEfetiva)}</td></tr>
          <tr><td>Crédito aproveitado pelo adquirente</td><td class="num mono">${A.moeda(a.credito.total)}</td></tr>
          <tr><td><b>Custo efetivo de aquisição</b></td><td class="num mono"><b>${A.moeda(a.custoEfetivo)}</b></td></tr>
        </table>
      </div>
      <div class="cartao">
        <h2>${ibsAtivo ? 'Projeção com o IVA por fora' : 'Projeção CBS por fora'}</h2>
        <p class="desc">${ibsAtivo ? 'O IBS e a CBS não integram a própria base — por isso a base limpa é a única comparação honesta' : 'A CBS não integra a própria base — por isso a base limpa é a única comparação honesta'}</p>
        ${ibsAtivo ? A.tabela([
          { t: 'Ano', r: (p) => `<b class="mono">${p.ano}</b>` },
          { t: 'Alíq. IVA', num: true, r: (p) => A.pct(p.aliquotas.total) },
          { t: 'IBS+CBS', num: true, r: (p) => A.moeda(p.ivaEfetivo) },
          { t: 'Residual', num: true, r: (p) => A.moeda(p.residual.total) },
          { t: 'Preço final', num: true, r: (p) => A.moeda(p.precoFinal) },
          { t: 'Crédito', num: true, r: (p) => A.moeda(p.credito.total) },
          { t: 'Custo efetivo', num: true, r: (p) => `<b>${A.moeda(p.custoEfetivo)}</b>` },
          { t: 'Δ vs. hoje', num: true, r: (p) => A.setaPct(p.variacaoCustoPerc) },
        ], r.projecao) : A.tabela([
          { t: 'Alíquota CBS', num: true, r: () => A.pct(fim.aliquotas?.cbs ?? fim.aliquotas?.total ?? 0) },
          { t: 'CBS projetada', num: true, r: () => A.moeda(fim.ivaEfetivo) },
          { t: 'Tributos residuais', num: true, r: () => A.moeda(fim.residual.total) },
          { t: 'Preço final', num: true, r: () => A.moeda(fim.precoFinal) },
          { t: 'Crédito CBS', num: true, r: () => A.moeda(fim.credito.total) },
          { t: 'Custo efetivo', num: true, r: () => `<b>${A.moeda(fim.custoEfetivo)}</b>` },
          { t: 'Δ vs. hoje', num: true, r: () => A.setaPct(fim.variacaoCustoPerc) },
        ], [{}])}
      </div>
      <div class="cartao"><h2>Leitura</h2>
        ${A.avisos(r.resumo.alertas)}
        ${fim.credito.observacoes.map((o) => `<div class="aviso">${A.esc(o)}</div>`).join('')}
        ${ibsAtivo ? `<div class="aviso"><b>${A.esc(String(fim.ano))}</b>${A.esc(fim.nota)}</div>` : ''}
      </div>`;
  }
  calcular().catch(() => {});
};
})();
