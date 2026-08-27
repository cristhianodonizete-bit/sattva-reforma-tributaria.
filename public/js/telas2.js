/* =========================================================================
   TELAS — Módulos 2 a 4 e gestão do produto
   ========================================================================= */
(() => {
const A = App, S = App.S;
const cab = (olho, titulo, texto, acoes = '') =>
  `<div class="topo"><div><div class="olho">${olho}</div><h1>${titulo}</h1>${texto ? `<p>${texto}</p>` : ''}</div>
   <div class="acoes-topo">${acoes}</div></div>`;

// ===========================================================================
// MÓDULO 2 — PRECIFICAÇÃO E MARGEM
// ===========================================================================
Telas.precificacao = async (el) => {
  const { itens, legado } = await A.api(`/empresas/${S.empresaId}/precificacao`);
  const completos = itens.filter((i) => i.status === 'COMPLETO').length;
  el.innerHTML = cab('Módulo 2', 'Precificação e margem',
    'A precificação comercial usa somente a saída oficial de motor_resultados e a composição de custo explicitamente cadastrada. NCM, NBS e descrição não criam vínculos automáticos.',
    `<button class="btn" id="abrirIndependente">Base independente</button>
     <button class="btn" id="abrirFormacao">Gerenciar formação de custo</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/precificacao')">Exportar Excel</button>`) +
    `<div class="grade g3">${A.kpi('Itens em formação', itens.length)}${A.kpi('Resultados definitivos', completos)}${A.kpi('Itens legados desativados', legado, 'não entram no cálculo oficial')}</div>
    <div class="cartao"><h2>Precificação oficial</h2>
      ${A.tabela([
        {t:'Saída oficial / item',r:i=>`<b>${A.esc(i.item.descricao || '—')}</b><div class="mini mono">movimento ${A.esc(i.item.movimento_saida_id || 'não vinculado')}</div>`},
        {t:'Status',r:i=>`<span class="tag ${i.status === 'COMPLETO' ? 'c' : i.status === 'DIVERGENTE' ? 'a' : 'b'}">${A.esc(i.status)}</span>`},
        {t:'Preço atual',num:true,r:i=>A.moeda(i.saida?.preco_atual)},
        {t:'Base econômica',num:true,r:i=>A.moeda(i.saida?.base_economica)},
        {t:'CBS da saída',num:true,r:i=>A.moeda(i.saida?.cbs)},
        {t:'Custo líquido',num:true,r:i=>A.moeda(i.formacao?.custo_liquido)},
        {t:'Margem atual',num:true,r:i=>i.comercial ? `${A.moeda(i.comercial.margem_atual)}<div class="mini">${A.pct(i.comercial.margem_atual_percentual)}</div>` : '—'},
        {t:'Margem projetada',num:true,r:i=>i.comercial ? `${A.moeda(i.comercial.margem_projetada)}<div class="mini">${A.pct(i.comercial.margem_projetada_percentual)}</div>` : '—'},
        {t:'',r:i=>`<button class="btn pq vazio" data-detalhe="${i.item.id}">Memória</button>`},
      ], itens, {vazio:'Nenhum item de formação de custo cadastrado.'})}
    </div>`;
  document.getElementById('abrirFormacao').onclick = () => A.ir('formacaoCusto');
  document.getElementById('abrirIndependente').onclick = () => telaPrecificacaoIndependente(el);
  el.querySelectorAll('[data-detalhe]').forEach((b) => b.onclick = () => {
    const i = itens.find((x) => x.item.id === Number(b.dataset.detalhe));
    A.modal({ titulo: `Memória — ${i.item.descricao || 'item'}`, largura: 920, corpo: blocoResultadoOficial(i) });
  });
};

async function telaPrecificacaoIndependente(el) {
  const d = await A.api(`/empresas/${S.empresaId}/precificacao-independente`);
  const temSmoke = [...d.produtos, ...d.servicos, ...d.componentes].some((x) => String(x.codigo || x.codigo_componente || x.descricao || '').startsWith('SMOKE_PRICING_'));
  el.innerHTML = cab('Módulo 2', 'Precificação e margem — base independente',
    'Use uma base própria de portfólio e composição. Cada insumo é associado explicitamente ao item de saída; o cálculo fiscal continua sendo realizado pelo motor homologado.',
    `<button class="btn vazio" id="baixarModeloPrec">Baixar modelo XLSX</button><button class="btn" id="importarBasePrec">Importar base</button><button class="btn vazio" id="saidaExecPrec">Saída executiva</button>${temSmoke ? '<button class="btn perigo" id="limparSmokePrec">Limpar dados sintéticos</button>' : ''}<button class="btn vazio" id="voltarPrec">Voltar</button>`) +
    `<div class="aviso"><b>Modo independente.</b> Não exige movimentações importadas do Diagnóstico. Esta primeira camada é somente cadastral: valida portfólio e composição, sem calcular preço, margem ou crédito.</div>
    <div class="grade g3">${A.kpi('Produtos', d.produtos.length)}${A.kpi('Serviços', d.servicos.length)}${A.kpi('Componentes', d.componentes.length)}</div>
    <div class="cartao" style="margin-top:16px"><h2>Simulador comercial</h2><div class="grade g3">${A.selecao('modoPrecInd','Modo',[{v:'PRESERVAR_PRECO_FINAL',t:'Preservar preço final'},{v:'PRESERVAR_MARGEM',t:'Preservar margem'},{v:'PRESERVAR_CUSTO_EFETIVO_CLIENTE',t:'Preservar custo efetivo do cliente'},{v:'REAJUSTE_LIVRE',t:'Reajuste livre'}],'PRESERVAR_PRECO_FINAL')}${A.campo('percentualPrecInd','Reajuste livre (0,05 = 5%)',0,'number','step=0.0001')}<button class="btn" id="simularPrecInd">Simular</button></div><div id="resultadoPrecInd" class="mini" style="margin-top:10px">A simulação usa o motor fiscal oficial e não altera a base importada.</div></div>
    <div class="cartao" style="margin-top:16px"><h2>Produtos de saída</h2>${A.tabela([{t:'Código',r:x=>A.esc(x.codigo)},{t:'Descrição',r:x=>A.esc(x.descricao)},{t:'NCM',r:x=>A.esc(x.ncm)},{t:'Produção',num:true,r:x=>A.num(x.quantidade_producao)},{t:'Venda atual',num:true,r:x=>A.moeda(x.valor_venda_atual)}],d.produtos,{vazio:'Nenhum produto importado.'})}</div>
    <div class="cartao" style="margin-top:16px"><h2>Serviços de saída</h2>${A.tabela([{t:'Código',r:x=>A.esc(x.codigo)},{t:'Descrição',r:x=>A.esc(x.descricao)},{t:'LC 116',r:x=>A.esc(x.lc116)},{t:'NBS',r:x=>A.esc(x.nbs)},{t:'Venda atual',num:true,r:x=>A.moeda(x.valor_venda_atual)}],d.servicos,{vazio:'Nenhum serviço importado.'})}</div>
    <div class="cartao" style="margin-top:16px"><h2>Composição econômica</h2>${A.tabela([{t:'Componente',r:x=>`<b>${A.esc(x.codigo_componente)}</b> · ${A.esc(x.descricao)}`},{t:'Tipo',r:x=>A.esc(x.tipo_componente)},{t:'Vínculo de saída',r:x=>x.produto_saida_id?`Produto #${x.produto_saida_id}`:`Serviço #${x.servico_saida_id}`},{t:'Fornecedor/regime',r:x=>A.esc(x.regime_fornecedor || 'não informado')},{t:'Custo unitário',num:true,r:x=>A.moeda(x.custo_unitario_bruto)}],d.componentes,{vazio:'Nenhum componente importado.'})}</div>`;
  document.getElementById('voltarPrec').onclick = () => Telas.precificacao(el);
  if (temSmoke) document.getElementById('limparSmokePrec').onclick = () => A.modal({
    titulo:'Remover dados sintéticos de smoke test', confirmar:'Remover definitivamente',
    corpo:'Serão removidos somente produtos, serviços, componentes e lotes cujo identificador começa com <b>SMOKE_PRICING_20260827_</b>. Nenhum cadastro real será afetado.',
    aoConfirmar:async()=>{ const r=await A.api(`/empresas/${S.empresaId}/precificacao-independente/testes/SMOKE_PRICING_20260827_`,{metodo:'DELETE'}); A.toast(`Smoke removido: ${r.removidos.produtos} produto(s), ${r.removidos.servicos} serviço(s), ${r.removidos.componentes} componente(s) e ${r.removidos.lotes} lote(s).`,'ok'); telaPrecificacaoIndependente(el); }
  });
  document.getElementById('baixarModeloPrec').onclick = async()=>{
    try {
      const resposta=await fetch(`/api/empresas/${S.empresaId}/precificacao-independente/template`,{headers:{Authorization:`Bearer ${localStorage.getItem('sattva_token')||''}`}});
      if(!resposta.ok) throw new Error('Não foi possível gerar o modelo XLSX.');
      const url=URL.createObjectURL(await resposta.blob()); const a=document.createElement('a'); a.href=url; a.download='modelo-precificacao-margem.xlsx'; a.click(); URL.revokeObjectURL(url);
    } catch(e){A.toast(e.message,'erro');}
  };
  document.getElementById('saidaExecPrec').onclick = async()=>{
    try {
      const itens = [...d.produtos, ...d.servicos];
      const chaveItem = (x) => `${x.natureza_item || (x.nbs != null || x.lc116 != null ? 'servico' : 'produto')}:${x.id}`;
      A.modal({ titulo:'Configurar saída executiva', largura:720, confirmar:'Gerar saída', corpo:`
        <div class="grade g2">${A.selecao('modo','Modo da simulação',[
          {v:'PRESERVAR_PRECO_FINAL',t:'Preservar preço final'}, {v:'PRESERVAR_MARGEM',t:'Preservar margem'},
          {v:'PRESERVAR_CUSTO_EFETIVO_CLIENTE',t:'Preservar custo efetivo do cliente'}, {v:'REAJUSTE_LIVRE',t:'Reajuste livre'}
        ],'PRESERVAR_PRECO_FINAL')}</div>
        <p class="desc">Selecione os produtos e serviços que devem compor a apresentação. Itens sem marcação não entram nos indicadores nem no PDF.</p>
        <div class="lista-check">${itens.map(x=>`<label><input type="checkbox" name="item_${chaveItem(x)}" checked> ${A.esc(x.codigo)} — ${A.esc(x.descricao)}</label>`).join('')}</div>`,
        aoConfirmar:async(dados, fundo)=>{
          const item_chaves = itens.filter(x=>dados[`item_${chaveItem(x)}`]).map(chaveItem);
          if (!item_chaves.length) throw new Error('Selecione ao menos um produto ou serviço.');
          const r=await A.api(`/empresas/${S.empresaId}/precificacao-independente/saida-executiva`,{metodo:'POST',corpo:{modo:dados.modo,item_chaves}});
          const z=r.relatorio;
          const detalhe=A.modal({titulo:'Saída executiva — Precificação',largura:1100,corpo:`
            <div class="grade g4">${Object.entries(z.indicadores).map(([k,v])=>A.kpi(k.replaceAll('_',' '),typeof v==='number'?A.moeda(v):A.esc(v))).join('')}</div>
            <h3 style="margin-top:16px">Recomendações com evidência</h3>${z.recomendacoes.length?A.tabela([{t:'Recomendação',r:x=>A.esc(x.texto)},{t:'Indicador',r:x=>A.esc(x.indicador)},{t:'Causa',r:x=>A.esc(x.causa)},{t:'Premissa',r:x=>A.esc(x.premissa)},{t:'Natureza',r:x=>A.esc(x.natureza)}],z.recomendacoes,{vazio:''}):'<div class="aviso">Nenhuma recomendação conclusiva: não há evidência suficiente.</div>'}
            <h3 style="margin-top:16px">Produtos e serviços — preço, custo e tributação</h3>${A.tabela([{t:'Item',r:x=>A.esc(x.item.descricao)},{t:'Preço atual',num:true,r:x=>A.moeda(x.simulacao.valor_venda_atual)},{t:'Preço projetado',num:true,r:x=>A.moeda(x.simulacao.preco_projetado)},{t:'Custo bruto',num:true,r:x=>A.moeda(x.waterfall.custo.componentes_brutos)},{t:'Créditos',num:true,r:x=>x.waterfall.custo.creditos_recuperaveis==null?'INDETERMINADO':A.moeda(x.waterfall.custo.creditos_recuperaveis)},{t:'Custo líquido',num:true,r:x=>x.custos.custo_formado==null?'INCOMPLETO':A.moeda(x.custos.custo_formado)},{t:'IBS / CBS',num:true,r:x=>`${A.moeda(x.simulacao.ibs)} / ${A.moeda(x.simulacao.cbs)}`},{t:'Margem',num:true,r:x=>x.simulacao.margem_projetada==null?'INCOMPLETO':A.moeda(x.simulacao.margem_projetada)},{t:'Crédito / custo efetivo cliente',num:true,r:x=>x.simulacao.credito_entregue_ao_cliente==null?'INDETERMINADO':`${A.moeda(x.simulacao.credito_entregue_ao_cliente)} / ${A.moeda(x.simulacao.custo_efetivo_do_cliente)}`},{t:'Memória',r:x=>`<button class="btn vazio" data-memoria-prec="${x.item.id}">Abrir</button>`}],z.itens,{vazio:'Sem itens.'})}
            <h3 style="margin-top:16px">Waterfall e pontos de atenção</h3><div class="grade g3">${A.kpi('Margem comprimida',z.secoes.margem_comprimida.length)}${A.kpi('Aumento de preço',z.secoes.aumento_preco.length)}${A.kpi('Competitividade B2B comprovada',z.secoes.competitividade_b2b_afetada.length)}${A.kpi('Dados incompletos / indeterminados',z.secoes.dados_incompletos.length)}</div>
            <button class="btn" data-pdf-prec>Exportar PDF</button>`});
          detalhe.fundo.querySelector('[data-pdf-prec]').onclick=async()=>{
            const q=new URLSearchParams({modo:dados.modo,itens:item_chaves.join(',')});
            const resposta=await fetch(`/api/empresas/${S.empresaId}/precificacao-independente/saida-executiva.pdf?${q}`,{headers:{Authorization:`Bearer ${localStorage.getItem('sattva_token')||''}`}});
            if(!resposta.ok) throw new Error('Não foi possível gerar o PDF executivo.');
            const url=URL.createObjectURL(await resposta.blob()); const a=document.createElement('a'); a.href=url; a.download='precificacao-margem-executivo.pdf'; a.click(); URL.revokeObjectURL(url);
          };
          detalhe.fundo.querySelectorAll('[data-memoria-prec]').forEach((el)=>el.onclick=()=>{
            const x=z.itens.find(i=>Number(i.item.id)===Number(el.dataset.memoriaPrec));
            A.modal({titulo:`Memória — ${x.item.descricao}`,largura:960,corpo:`<pre>${A.esc(JSON.stringify({formacao_custo:x.waterfall,resultado_fiscal:x.simulacao.memoria_fiscal,natureza:x.simulacao.natureza,origem:x.simulacao.origem,motivo:x.motivo},null,2))}</pre>`});
          });
        }});
    } catch(e){A.toast(e.message,'erro');}
  };
  document.getElementById('simularPrecInd').onclick = async () => { const box=document.getElementById('resultadoPrecInd'); box.textContent='Calculando pelo motor oficial…'; try { const r=await A.api(`/empresas/${S.empresaId}/precificacao-independente/simular`,{metodo:'POST',corpo:{modo:document.querySelector('[name=modoPrecInd]').value,percentual_reajuste:Number(document.querySelector('[name=percentualPrecInd]').value)||0}}); box.innerHTML=A.tabela([{t:'Item',r:x=>A.esc(x.item.descricao)},{t:'Status',r:x=>A.esc(x.status)},{t:'Preço projetado',num:true,r:x=>A.moeda(x.simulacao.preco_projetado)},{t:'Margem projetada',num:true,r:x=>x.simulacao.margem_projetada==null?'INCOMPLETO':A.moeda(x.simulacao.margem_projetada)},{t:'Custo efetivo cliente',num:true,r:x=>x.simulacao.custo_efetivo_do_cliente==null?'INDETERMINADO':A.moeda(x.simulacao.custo_efetivo_do_cliente)},{t:'',r:x=>`<button class="btn pq vazio" data-mem-simulacao="${x.item.id}">Memória</button>`}],r.itens,{vazio:'Sem itens.'}); box.querySelectorAll('[data-mem-simulacao]').forEach(b=>b.onclick=()=>{const x=r.itens.find(i=>i.item.id===Number(b.dataset.memSimulacao)); A.modal({titulo:`Memória — ${x.item.descricao}`,largura:960,corpo:`<div class="aviso"><b>Fórmula do preço:</b> preço atual − tributos atuais = base econômica + IBS + CBS = preço projetado.</div><pre class="mono" style="white-space:pre-wrap">${A.esc(JSON.stringify({waterfall:x.waterfall,origem:x.simulacao.origem,natureza:x.simulacao.natureza,motivo:x.motivo},null,2))}</pre>`});}); } catch(e){box.innerHTML=`<div class="aviso alto">${A.esc(e.message)}</div>`;} };
  document.getElementById('importarBasePrec').onclick = () => A.modal({ titulo:'Importar base de Precificação', confirmar:'Importar e validar', corpo:'<input type="file" id="arquivoPrec" accept=".xlsx" required><p class="mini">A validação ocorre antes da troca da base ativa. Se houver erro, a base atual permanece intacta.</p>', aoConfirmar: async () => { const arq = document.getElementById('arquivoPrec').files[0]; if (!arq) throw new Error('Selecione o arquivo XLSX.'); const fd = new FormData(); fd.append('arquivo', arq); const r = await A.api(`/empresas/${S.empresaId}/precificacao-independente/importar`, {metodo:'POST',corpo:fd, formData:true}); if (!r.importado) throw new Error(r.erros.map(x=>`${x.aba} ${x.linha}: ${x.erro}`).join('\n')); A.toast(`Base importada: ${r.produtos + r.servicos} itens e ${r.componentes} componentes.`, 'ok'); telaPrecificacaoIndependente(el); } });
}

// ===========================================================================
// BASE DE FORMAÇÃO DE CUSTO
// Vincula entradas a itens de saída, mas não muda nenhum resultado tributário.
// ===========================================================================
Telas.formacaoCusto = async (el) => {
  const d = await A.api(`/empresas/${S.empresaId}/formacao-custo`);
  el.innerHTML = cab('Módulo 2', 'Base de formação de custo',
    'Defina como cada entrada participa de um produto ou serviço de saída. O motor continua sendo a única fonte de CBS e crédito; esta base apenas define o que pode compor o custo do item.',
    '<button class="btn" id="novoItemFormacao">Novo produto ou serviço</button>') +
    `<div class="aviso"><b>Regra de segurança:</b> crédito CBS total da empresa não é automaticamente crédito do produto. Apenas vínculos <b>diretos</b> ou <b>rateáveis com critério explícito</b> entram na formação do custo.</div>
    <div class="cartao" style="margin-top:16px"><h2>Produtos e serviços de saída</h2>${A.tabela([
      { t: 'Item de saída', r: (x) => `<b>${A.esc(x.descricao)}</b><div class="mini mono">${A.esc(x.codigo || x.sku || x.ncm || x.nbs || 'sem código')}</div>` },
      { t: 'Status', r: (x) => `<span class="tag ${x.status_formacao_custo === 'COMPLETO' ? 'c' : 'a'}">${A.esc(x.status_formacao_custo)}</span>` },
      { t: 'Crédito total das entradas', num: true, r: (x) => A.moeda(x.credito_cbs_total) },
      { t: 'Crédito precificável', num: true, r: (x) => A.moeda(x.credito_cbs_precificavel) },
      { t: 'Não alocado', num: true, r: (x) => A.moeda(x.credito_cbs_nao_alocado) },
      { t: '', r: (x) => `<button class="btn pq vazio" data-formacao="${x.id}">Gerenciar componentes (${x.componentes.length})</button>` },
    ], d.itens, { vazio: 'Nenhum produto ou serviço de saída cadastrado. Cadastre o portfólio antes de associar suas entradas.' })}</div>`;

  const opcoesSaidaFormacao = [{ v: '', t: 'Definir depois — item ficará INCOMPLETO' }].concat((d.saidasDisponiveis || []).map((m) => ({
    v: m.id, t: `${m.codigo_produto || '—'} · ${m.descricao || 'Sem descrição'} · ${A.moeda(m.valor)}`,
  })));
  document.getElementById('novoItemFormacao').onclick = () => A.modal({
    titulo: 'Novo item de formação de custo', confirmar: 'Salvar item',
    descricao: 'NCM/NBS são referências fiscais. Informe SKU, código interno ou centro de custo quando existirem; não haverá vinculação automática por NCM/NBS.',
    corpo: `<div class="grade g2">${A.campo('descricao', 'Descrição do produto ou serviço')}${A.campo('codigo', 'Código interno / SKU')}</div>
      ${A.selecao('movimentoSaidaId', 'Operação de saída no motor (obrigatória para precificar)', opcoesSaidaFormacao, '')}
      <div class="grade g3">${A.selecao('tipo', 'Natureza', [{v:'mercadoria',t:'Mercadoria'}, {v:'servico',t:'Serviço'}], 'mercadoria')}${A.campo('ncm', 'NCM (opcional)')}${A.campo('nbs', 'NBS (opcional)')}</div>
      <div class="grade g3">${A.campo('gtin', 'GTIN (opcional)')}${A.campo('unidade', 'Unidade')}${A.campo('centroCusto', 'Centro de custo')}</div>
      ${A.campo('despesasVariaveis', 'Despesas variáveis comerciais (0,05 = 5%)', 0, 'number', 'step=0.0001')}`,
    aoConfirmar: async (b) => { await A.api(`/empresas/${S.empresaId}/formacao-custo`, { metodo: 'POST', corpo: b }); A.toast('Item criado. Agora vincule os componentes.', 'ok'); A.ir('formacaoCusto'); },
  });
  el.querySelectorAll('[data-formacao]').forEach((b) => { b.onclick = () => abrirComponentes(d.itens.find((x) => x.id === Number(b.dataset.formacao))); });

  function abrirComponentes(item) {
    const opcoesEntrada = [{ v: '', t: 'Selecione uma entrada do diagnóstico' }].concat(d.entradasDisponiveis.map((m) => ({
      v: m.id, t: `${m.codigo_produto || '—'} · ${m.descricao || 'Sem descrição'} · ${A.moeda(m.valor)} · crédito ${A.moeda(m.credito_cbs)}`,
    })));
    const corpo = () => `<div class="aviso"><b>${A.esc(item.descricao)}</b><br>Crédito total: ${A.moeda(item.credito_cbs_total)} · precificável: ${A.moeda(item.credito_cbs_precificavel)} · não alocado: ${A.moeda(item.credito_cbs_nao_alocado)}.</div>
      <div style="margin:14px 0">${A.tabela([
        {t:'Componente',r:x=>`${A.esc(x.movimento_descricao || x.descricao_origem || '—')}<div class="mini mono">${A.esc(x.codigo_produto || x.codigo_origem || '')}</div>`},
        {t:'Relação',r:x=>A.esc(x.relacionamento)}, {t:'Crédito CBS',num:true,r:x=>A.moeda(x.credito_cbs)},
        {t:'Alocação',r:x=>`${A.esc(x.status_alocacao_credito)}${x.criterio_rateio ? `<div class="mini">${A.esc(x.criterio_rateio)} · ${A.pct(x.percentual_rateio)}</div>` : ''}`},
        {t:'',r:x=>`<button class="btn pq perigo" data-remover-comp="${x.id}">Remover</button>`},
      ], item.componentes, {vazio:'Nenhum componente vinculado.'})}</div>
      <hr class="sep"><h3>Vincular entrada</h3><div class="grade g2">${A.selecao('movimentoId', 'Entrada do diagnóstico', opcoesEntrada, '')}${A.selecao('relacionamento', 'Tipo de relacionamento', [{v:'DIRETA',t:'Direta'}, {v:'COMPOSICAO',t:'Composição'}, {v:'RATEIO',t:'Rateio'}, {v:'NAO_RELACIONADA',t:'Não relacionada'}], 'DIRETA')}</div>
      <div class="grade g2">${A.selecao('statusAlocacaoCredito', 'Crédito econômico', [{v:'DIRETO',t:'Direto'}, {v:'RATEAVEL',t:'Rateável'}, {v:'NAO_ALOCADO',t:'Não alocado'}], 'DIRETO')}${A.selecao('criterioRateio', 'Critério de rateio (se aplicável)', [{v:'',t:'Não se aplica'}, ...d.criterios_rateio.map(x=>({v:x,t:x.replaceAll('_',' ')}))], '')}</div>
      <div class="grade g2">${A.campo('percentualRateio', 'Percentual de rateio (0 a 1)', '', 'number', 'step=0.0001')}${A.campo('observacoes', 'Observações')}</div>`;
    A.modal({ titulo: `Componentes — ${item.descricao}`, confirmar: 'Vincular componente', largura: 1080, corpo: corpo(),
      aoConfirmar: async (b) => { await A.api(`/formacao-custo/${item.id}/componentes`, {metodo:'POST', corpo:b}); A.toast('Componente vinculado.', 'ok'); A.ir('formacaoCusto'); },
    });
    setTimeout(() => document.querySelectorAll('[data-remover-comp]').forEach((b) => { b.onclick = async () => { await A.api(`/formacao-custo/componentes/${b.dataset.removerComp}`, {metodo:'DELETE'}); A.ir('formacaoCusto'); }; }), 0);
  }
};

function blocoResultadoOficial(r) {
  if (!r.comercial) return `<div class="aviso atencao"><b>${A.esc(r.status)}</b><br>${A.esc(r.motivo || 'Não há dados suficientes para resultado definitivo.')}</div>`;
  return `<div class="aviso"><b>Fonte fiscal: motor_resultados</b><br>Saída oficial: ${A.esc(r.saida.movimento_id)} · tratamento ${A.esc(r.saida.tratamento || '—')} · CST ${A.esc(r.saida.cst || '—')} · cClassTrib ${A.esc(r.saida.cclasstrib || '—')} · natureza ${A.esc(r.saida.natureza || '—')}</div>
    <div class="grade g4" style="margin-top:14px">
      ${A.kpi('Preço atual', A.moeda(r.saida.preco_atual))}
      ${A.kpi('Base econômica', A.moeda(r.saida.base_economica))}
      ${A.kpi('CBS da saída', A.moeda(r.saida.cbs))}
      ${A.kpi('Venda projetada', A.moeda(r.saida.preco_projetado))}
      ${A.kpi('Custo econômico formado', A.moeda(r.formacao.custo_economico_bruto))}
      ${A.kpi('Crédito direto', A.moeda(r.formacao.credito_direto))}
      ${A.kpi('Crédito rateado', A.moeda(r.formacao.credito_rateado))}
      ${A.kpi('Crédito não alocado', A.moeda(r.formacao.credito_nao_alocado))}
      ${A.kpi('Custo líquido', A.moeda(r.formacao.custo_liquido))}
      ${A.kpi('Margem atual', A.moeda(r.comercial.margem_atual), A.pct(r.comercial.margem_atual_percentual))}
      ${A.kpi('Margem projetada', A.moeda(r.comercial.margem_projetada), A.pct(r.comercial.margem_projetada_percentual))}
      ${A.kpi('Impacto comercial', A.setaR$(r.comercial.impacto_comercial))}
    </div><div class="aviso ${r.status === 'COMPLETO' ? 'bom' : 'atencao'}" style="margin-top:14px"><b>Formação: ${A.esc(r.formacao.cobertura)}</b><br>Reconciliação de crédito: ${A.esc(r.formacao.reconciliacao_credito)}. ${A.esc(r.comercial.observacao_preco_alvo)}</div>`;
}

function blocoResultado(r) {
  const ibsAtivo = Boolean(S.params?.modoAnalise?.ibsAtivo);
  return `<div class="grade g3">
      ${A.kpi('Margem hoje', A.moeda(r.hoje.margem), A.pct(r.hoje.margemPerc))}
      ${A.kpi(`Margem ${ibsAtivo ? `em ${r.item.ano}` : 'CBS'} sem reajuste`, A.moeda(r.precoCongelado.margem), A.setaR$(r.precoCongelado.variacaoMargem))}
      ${A.kpi('Preço neutro', A.moeda(r.precoNeutro.preco), A.setaPct(r.precoNeutro.reajusteNecessario) + ' de reajuste', 'destaque')}
    </div>
    <table style="margin-top:14px">
      <tr><th>Composição</th><th class="num">Hoje</th><th class="num">Preço congelado</th><th class="num">Preço neutro</th></tr>
      <tr><td>Preço</td><td class="num mono">${A.moeda(r.hoje.preco)}</td><td class="num mono">${A.moeda(r.precoCongelado.preco)}</td><td class="num mono">${A.moeda(r.precoNeutro.preco)}</td></tr>
      <tr><td>(-) Tributos</td><td class="num mono">${A.moeda(r.hoje.tributos)}</td><td class="num mono">${A.moeda(r.precoCongelado.tributos)}</td><td class="num mono">${A.moeda(r.precoNeutro.tributos)}</td></tr>
      <tr><td>(-) Custo efetivo</td><td class="num mono">${A.moeda(r.hoje.custoLiquido)}</td><td class="num mono">${A.moeda(r.precoCongelado.custoLiquido)}</td><td class="num mono">${A.moeda(r.precoCongelado.custoLiquido)}</td></tr>
      <tr style="background:var(--ouro-100)"><td><b>= Margem bruta</b></td><td class="num mono"><b>${A.moeda(r.hoje.margem)}</b></td><td class="num mono"><b>${A.moeda(r.precoCongelado.margem)}</b></td><td class="num mono"><b>${A.moeda(r.precoNeutro.margem)}</b></td></tr>
      <tr><td>Carga efetiva</td><td class="num mono">${A.pct(r.hoje.cargaEfetiva)}</td><td class="num mono">${A.pct(r.precoCongelado.cargaEfetiva)}</td><td class="num mono">${A.pct(r.precoNeutro.cargaEfetiva)}</td></tr>
      <tr><td>Preço sem imposto</td><td class="num mono">${A.moeda(r.hoje.precoSemImposto)}</td><td class="num mono">—</td><td class="num mono">—</td></tr>
    </table>
    <hr class="sep">
    <div class="aviso ${r.cliente.credita ? 'bom' : 'atencao'}"><b>Cliente: ${A.esc(r.cliente.label)}</b>${A.esc(r.cliente.leitura)}
      <div class="acao">Custo para o cliente: ${A.moeda(r.cliente.custoHoje)} → ${A.moeda(r.cliente.custoNovo)} (${A.pct(r.cliente.variacaoPerc)})</div></div>
    ${A.avisos(r.recomendacoes)}`;
}

function resumoPreco(itens) {
  const rs = itens.map((i) => i.resultado);
  const perda = rs.reduce((s, r) => s + r.precoCongelado.variacaoMargem, 0);
  const reajusteMedio = rs.reduce((s, r) => s + r.precoNeutro.reajusteNecessario, 0) / rs.length;
  const semCredito = rs.filter((r) => !r.cliente.credita).length;
  const grupos = Object.values(itens.reduce((mapa, item) => {
    const chave = item.tipo === 'servico' ? 'servico' : 'mercadoria';
    const r = item.resultado;
    const grupo = mapa[chave] || { grupo: chave === 'servico' ? 'Serviços' : 'Mercadorias', itens: 0, margemHoje: 0, margemCongelada: 0, perda: 0, reajuste: 0, semCredito: 0 };
    grupo.itens++; grupo.margemHoje += r.hoje.margem; grupo.margemCongelada += r.precoCongelado.margem;
    grupo.perda += r.precoCongelado.variacaoMargem; grupo.reajuste += r.precoNeutro.reajusteNecessario;
    if (!r.cliente.credita) grupo.semCredito++;
    mapa[chave] = grupo; return mapa;
  }, {})).map((g) => ({ ...g, reajuste: g.reajuste / g.itens }));
  const faixa = (reajuste) => reajuste >= 0.07 ? ['a', 'Reajuste prioritário'] : reajuste >= 0.02 ? ['b', 'Reajuste planejado'] : ['c', 'Monitorar'];
  return `<div class="grade g4">
    ${A.kpi('Itens simulados', itens.length)}
    ${A.kpi('Margem em risco', A.setaR$(perda), 'se nenhum preço for ajustado')}
    ${A.kpi('Reajuste médio necessário', A.setaPct(reajusteMedio), 'para preservar a margem', 'destaque')}
    ${A.kpi('Itens com cliente que não credita', semCredito, 'repasse comercialmente sensível')}
  </div><div class="grade g2 resumo-precificacao">
    <div class="cartao"><h2>Margem consolidada da carteira</h2><p class="desc">Compara a margem atual com a margem mantida em preço congelado.</p>
      ${A.tabela([
        { t: 'Visão', r: (x) => x.grupo }, { t: 'Itens', num: true, r: (x) => x.itens },
        { t: 'Margem hoje', num: true, r: (x) => A.moeda(x.margemHoje) },
        { t: 'Margem sem reajuste', num: true, r: (x) => A.moeda(x.margemCongelada) },
        { t: 'Variação', num: true, r: (x) => A.setaR$(x.perda) },
      ], grupos.concat([{ grupo: 'Carteira total', itens: itens.length, margemHoje: rs.reduce((s, r) => s + r.hoje.margem, 0), margemCongelada: rs.reduce((s, r) => s + r.precoCongelado.margem, 0), perda }]))}
    </div>
    <div class="cartao"><h2>Régua de reposicionamento</h2><p class="desc">Orientação comercial por grupo, a partir do reajuste necessário para preservar a margem.</p>
      ${grupos.map((g) => { const f = faixa(g.reajuste); return `<div class="regua-preco"><div><b>${g.grupo}</b><span>${g.itens} itens · ${g.semCredito} sem crédito econômico</span></div><div><span class="tag ${f[0]}">${f[1]}</span><strong>${A.pct(g.reajuste)}</strong></div></div>`; }).join('')}
    </div>
  </div><div style="height:16px"></div>`;
}

// ===========================================================================
// MÓDULO 3 — CONTRATOS
// ===========================================================================
Telas.contratos = async (el) => {
  const { contratos, clausulas } = await A.api(`/empresas/${S.empresaId}/contratos`);
  const risco = (c) => `<span class="tag ${c.risco === 'alto' ? 'a' : c.risco === 'medio' ? 'b' : c.risco === 'baixo' ? 'c' : 'n'}">${c.risco.replace('_', ' ')}</span>`;
  const eixos = [
    { id: 'carga', titulo: 'Carga tributária e crédito', descricao: 'Preço líquido, reequilíbrio e crédito aproveitável.', clausulas: ['preco_liquido', 'reequilibrio', 'repasse_credito'] },
    { id: 'responsabilidade', titulo: 'Responsabilidade das partes', descricao: 'Regime declarado, classificação correta e reparação.', clausulas: ['regime_fornecedor', 'responsabilidade_solidaria'] },
    { id: 'preco', titulo: 'Reajuste, repasse e preço', descricao: 'Separação entre inflação, tributação e transição.', clausulas: ['reajuste_indice', 'contratos_longa_duracao'] },
    { id: 'adequacao', titulo: 'Adequação ao novo modelo', descricao: 'Split payment, devoluções e contratos públicos.', clausulas: ['split_payment', 'devolucoes', 'orgao_publico'] },
  ];
  const clausulaCard = (c) => `<details class="clausula">
    <summary>${A.esc(c.titulo)} ${risco(c)}</summary>
    <p style="margin:10px 0 0;color:var(--tinta-2)">${A.esc(c.problema)}</p>
    <div class="texto">${A.esc(c.texto)}</div>
    <div class="mini" style="margin-top:8px">Aplicável a: ${c.aplicacao.join(', ')}</div>
  </details>`;

  el.innerHTML = cab('Módulo 3', 'Revisão de contratos',
    'Contrato sem cláusula de tributo é contrato que decide sozinho quem paga a conta da transição.',
    `<button class="btn" id="novoContrato">Cadastrar contrato</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/contratos')">Exportar Excel</button>`) +
    `<div class="cartao"><h2>Carteira contratual</h2>
      ${A.tabela([
        { t: 'Tipo', r: (c) => `<span class="tag">${A.esc(c.tipo)}</span>` },
        { t: 'Contraparte', r: (c) => `${A.esc(c.contraparte)}<div class="mini mono">${A.cnpjFmt(c.cnpj_contraparte)}</div>` },
        { t: 'Regime', r: (c) => A.regimeLabel(c.regime_contraparte) },
        { t: 'Objeto', r: (c) => `<span class="mini">${A.esc((c.objeto || '').slice(0, 60))}</span>` },
        { t: 'Valor', num: true, r: (c) => A.moeda(c.valor) },
        { t: 'Vigência', r: (c) => `<span class="mini mono">${A.esc(c.vigencia_inicio || '')} → ${A.esc(c.vigencia_fim || '')}</span>` },
        { t: 'Preço c/ tributo', r: (c) => c.preco_com_tributo ? '<span class="tag b">incluso</span>' : '<span class="tag c">líquido</span>' },
        { t: 'Risco', r: risco },
        { t: 'Status', r: (c) => `<span class="tag n">${A.esc(c.status)}</span>` },
        { t: '', r: (c) => `<button class="btn pq" data-doc="${c.id}">Documento</button>
          <button class="btn pq" data-rec="${c.id}">Recomendações</button>
          <button class="btn pq ouro" data-rev="${c.id}">Revisar</button>
          <button class="btn pq vazio" data-ec="${c.id}">Editar</button>
          <button class="btn pq perigo" data-rc="${c.id}">Excluir</button>` },
      ], contratos, { vazio: 'Nenhum contrato cadastrado. Comece pelos contratos de maior valor e maior prazo.' })}
    </div>
    <div class="cartao biblioteca-eixos"><h2>Biblioteca de cláusulas por eixo</h2>
      <p class="desc">Texto sugerido organizado pelos quatro eixos da revisão. Adapte ao caso concreto antes de usar.</p>
      ${eixos.map((eixo) => `<section class="eixo-contratual"><div class="eixo-cabecalho"><div><h3>${eixo.titulo}</h3><p>${eixo.descricao}</p></div><span class="tag">${eixo.clausulas.length} cláusulas</span></div>
        ${eixo.clausulas.map((id) => clausulas.find((c) => c.id === id)).filter(Boolean).map(clausulaCard).join('')}
      </section>`).join('')}
    </div>`;

  const formContrato = (c = {}) => `<div class="grade g2">
      ${A.selecao('tipo', 'Tipo de contrato', [{ v: 'compra', t: 'Compra' }, { v: 'fornecimento', t: 'Fornecimento' }, { v: 'venda', t: 'Venda' }, { v: 'servico', t: 'Serviço' }], c.tipo || 'compra')}
      ${A.campo('contraparte', 'Contraparte', c.contraparte)}</div>
    <div class="grade g2">${A.campo('cnpj_contraparte', 'CNPJ', c.cnpj_contraparte)}
      ${A.selecao('regime_contraparte', 'Regime da contraparte', A.opcoesRegime(), c.regime_contraparte || 'lucro_real')}</div>
    ${A.area('objeto', 'Objeto', c.objeto, 2)}
    <div class="grade g3">${A.campo('valor', 'Valor (R$)', c.valor, 'number', 'step=0.01')}
      ${A.campo('vigencia_inicio', 'Início', c.vigencia_inicio, 'date')}${A.campo('vigencia_fim', 'Fim', c.vigencia_fim, 'date')}</div>
    <div class="grade g2">${A.campo('reajuste', 'Índice de reajuste', c.reajuste)}
      ${A.selecao('preco_com_tributo', 'Preço pactuado', [{ v: '1', t: 'Com tributos inclusos' }, { v: '', t: 'Líquido de tributos' }], c.preco_com_tributo ? '1' : '')}</div>
    ${A.area('parecer', 'Parecer técnico', c.parecer, 3)}`;

  document.getElementById('novoContrato').onclick = () => A.modal({
    titulo: 'Cadastrar contrato', corpo: formContrato(), largura: 760,
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/contratos`, { metodo: 'POST', corpo: d }); A.ir('contratos'); },
  });
  el.querySelectorAll('[data-ec]').forEach((b) => { b.onclick = () => {
    const c = contratos.find((x) => x.id === Number(b.dataset.ec));
    A.modal({ titulo: 'Editar contrato', largura: 760, corpo: formContrato(c) + A.selecao('status', 'Status',
      [{ v: 'pendente', t: 'Pendente' }, { v: 'em_revisao', t: 'Em revisão' }, { v: 'revisado', t: 'Revisado' }, { v: 'renegociado', t: 'Renegociado' }], c.status),
      aoConfirmar: async (d) => { await A.api(`/contratos/${c.id}`, { metodo: 'PUT', corpo: { ...d, risco: c.risco } }); A.ir('contratos'); } });
  }; });
  el.querySelectorAll('[data-rc]').forEach((b) => { b.onclick = () => A.confirmar('Excluir este contrato?', async () => {
    await A.api(`/contratos/${b.dataset.rc}`, { metodo: 'DELETE' }); A.ir('contratos'); }); });

  // Triagem documental é distinta da revisão: preserva o arquivo original e
  // mostra somente trechos extraídos e riscos iniciais rastreáveis.
  el.querySelectorAll('[data-doc]').forEach((b) => { b.onclick = async () => {
    const c = contratos.find((x) => x.id === Number(b.dataset.doc));
    let memoria = { documentos: [], clausulas: [], riscos: [], vinculos: [] };
    try { memoria = await A.api(`/contratos/${c.id}/memoria-inicial`); } catch (_) { /* contrato ainda sem documento */ }
    const resumo = () => `<div class="aviso bom"><b>Triagem documental inicial</b> O original é preservado. Trechos são EXTRAÍDOS; riscos são INTERPRETADOS e não constituem parecer final.</div>
      <div class="grade g3">${A.kpi('Documentos', memoria.documentos.length)}${A.kpi('Trechos extraídos', memoria.clausulas.length)}${A.kpi('Riscos iniciais', memoria.riscos.length)}</div>
      ${memoria.documentos.length ? `<details open><summary><b>Documentos preservados</b></summary>${memoria.documentos.map((d) => `<p class="mini">${A.esc(d.nome_original)} · ${A.esc(d.tipo_origem)} · ${A.esc(d.status_extracao)} · <a href="/api/contrato-documentos/${d.id}/original" target="_blank">baixar original</a></p>`).join('')}</details>` : ''}
      ${memoria.riscos.length ? `<details><summary><b>Riscos iniciais com evidência</b></summary>${memoria.riscos.map((r) => `<div class="cartao" style="box-shadow:none;margin:8px 0"><b>${A.esc(r.risco)}</b> <span class="tag ${r.nivel === 'alto' ? 'a' : 'b'}">${A.esc(r.nivel)}</span><p class="mini">${A.esc(r.evidencia)}</p></div>`).join('')}</details>` : ''}
      <hr><label class="campo"><span>Arquivo original (PDF, DOCX ou TXT)</span><input type="file" id="contratoArquivo" accept=".pdf,.docx,.txt,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></label>
      ${A.area('texto_contrato', 'Ou cole o texto do contrato', '', 8)}`;
    const modal = A.modal({ titulo: `Documento — ${c.contraparte || c.nome || 'contrato'}`, largura: 900, confirmar: 'Preservar e realizar triagem', corpo: resumo(),
      aoConfirmar: async (d, fundo) => {
        const arquivo = fundo.querySelector('#contratoArquivo')?.files?.[0];
        const texto = d.texto_contrato || '';
        if (!arquivo && !texto.trim()) throw new Error('Selecione um arquivo ou informe o texto do contrato.');
        const fd = new FormData(); if (arquivo) fd.append('arquivo', arquivo); if (texto.trim()) fd.append('texto', texto); if (!arquivo) fd.append('nome', 'texto-manual.txt');
        const r = await A.api(`/contratos/${c.id}/documentos`, { metodo: 'POST', corpo: fd });
        A.toast(`Original preservado. ${r.clausulas} trecho(s) e ${r.riscos} risco(s) iniciais registrados.`, 'ok');
        A.ir('contratos');
      } });
    return modal;
  }; });

  el.querySelectorAll('[data-rec]').forEach((b) => { b.onclick = async () => {
    const c = contratos.find((x) => x.id === Number(b.dataset.rec));
    let memoria = await A.api(`/contratos/${c.id}/memoria-inicial`);
    if (!memoria.riscos.length) { A.toast('Envie ou cole um documento antes de gerar recomendações.', 'erro'); return; }
    const mostrar = () => `${memoria.recomendacoes?.length ? `<section><h3>Recomendações interpretadas</h3>${memoria.recomendacoes.map((r) => `<div class="cartao" style="box-shadow:none;margin:8px 0"><span class="tag ${r.prioridade === 'ALTA' ? 'a' : r.prioridade === 'MEDIA' ? 'b' : 'c'}">${A.esc(r.prioridade)}</span><p><b>${A.esc(r.recomendacao)}</b></p><p class="mini">Evidência: ${A.esc(r.evidencia)}</p><p class="mini">Impacto: ${A.esc(r.impacto_potencial)} · Fundamento: ${A.esc(r.fundamento)} · ${A.esc(r.natureza)}</p></div>`).join('')}</section>` : '<div class="aviso atencao">Ainda não foram geradas recomendações para esta triagem.</div>'}
      ${memoria.sugestoes?.length ? `<section><h3>Rascunhos de cláusula</h3><div class="aviso atencao"><b>RASCUNHOS SUGERIDOS</b> Exigem revisão jurídica e não substituem o documento original.</div>${memoria.sugestoes.map((s) => `<details class="clausula"><summary>${A.esc(s.motivo)}</summary><p class="mini">Original/evidência: ${A.esc(s.clausula_original || '')}</p><div class="texto">${A.esc(s.sugestao_redacao)}</div><p class="mini">Impacto esperado: ${A.esc(s.impacto_esperado)} · ${A.esc(s.natureza)}</p></details>`).join('')}</section>` : ''}`;
    A.modal({ titulo: `Recomendações — ${c.contraparte || c.nome || 'contrato'}`, largura: 980, confirmar: 'Gerar/atualizar recomendações',
      descricao: 'A análise usa apenas riscos com evidência e fotografias de Precificação vinculadas explicitamente. Nenhum cálculo fiscal é refeito aqui.', corpo: mostrar(),
      aoConfirmar: async () => { const r = await A.api(`/contratos/${c.id}/entrega2/gerar`, { metodo: 'POST', corpo: {} }); A.toast(`${r.recomendacoes} recomendação(ões) e ${r.sugestoes} rascunho(s) atualizados.`, 'ok'); A.ir('contratos'); }, });
  }; });

  el.querySelectorAll('[data-rev]').forEach((b) => { b.onclick = async () => {
    const c = contratos.find((x) => x.id === Number(b.dataset.rev));
    const aplicaveis = clausulas.filter((cl) => cl.aplicacao.includes(c.tipo));
    const sit = (id) => (c.checklist.find((k) => k.clausula_id === id) || {}).situacao || 'ausente';
    const obs = (id) => (c.checklist.find((k) => k.clausula_id === id) || {}).observacao || '';
    let diagnostico;
    try { diagnostico = await A.api(`/contratos/${c.id}/impacto-diagnostico`); }
    catch (e) { diagnostico = { encontrado: false, motivo: 'Não foi possível consultar o diagnóstico desta contraparte.' }; }
    const impacto = diagnostico.encontrado ? diagnostico.impacto : null;
    A.modal({
      titulo: `Revisar — ${c.contraparte}`, largura: 860, confirmar: 'Salvar revisão',
      descricao: 'Marque a situação de cada cláusula. O risco do contrato é recalculado automaticamente.',
      corpo: `${impacto ? `<section class="impacto-contrato"><div><span class="olho">VÍNCULO COM O DIAGNÓSTICO</span><strong>Impacto projetado da contraparte</strong><p>${impacto.movimentos} lançamento(s) vinculados ao CNPJ deste contrato.</p></div><div class="grade g3">${A.kpi('Movimentação analisada', A.moeda(impacto.valor))}${A.kpi('CBS projetada', A.moeda(impacto.cbs))}${A.kpi('Crédito projetado', A.moeda(impacto.credito), '', 'destaque')}</div></section>` : `<div class="aviso atencao"><b>Vínculo com o diagnóstico indisponível</b>${A.esc(diagnostico.motivo || '')}</div>`}` + aplicaveis.map((cl) => `<div class="cartao" style="box-shadow:none;margin-bottom:10px">
          <h2 style="font-size:13.5px">${A.esc(cl.titulo)} <span class="tag ${cl.risco === 'alto' ? 'a' : 'b'}">${cl.risco}</span></h2>
          <p class="desc">${A.esc(cl.problema)}</p>
          <div class="chips" data-cl="${cl.id}">
            ${[['ausente', 'Ausente'], ['parcial', 'Parcial'], ['adequada', 'Adequada'], ['na', 'Não se aplica']].map(([v, t]) =>
              `<span class="chip ${sit(cl.id) === v ? 'on' : ''}" data-v="${v}">${t}</span>`).join('')}
          </div>
          <input type="text" data-obs="${cl.id}" placeholder="Observação" value="${A.esc(obs(cl.id))}" style="margin-top:9px">
          <details class="clausula" style="margin-top:9px;border:none;padding:0">
            <summary class="mini">Ver texto sugerido</summary><div class="texto">${A.esc(cl.texto)}</div></details>
        </div>`).join(''),
      aoConfirmar: async (_d, fundo) => {
        const itens = aplicaveis.map((cl) => ({
          clausula_id: cl.id,
          situacao: (fundo.querySelector(`[data-cl="${cl.id}"] .chip.on`) || { dataset: { v: 'ausente' } }).dataset.v,
          observacao: fundo.querySelector(`[data-obs="${cl.id}"]`).value,
        }));
        const r = await A.api(`/contratos/${c.id}/checklist`, { metodo: 'PUT', corpo: { itens } });
        A.toast(`Revisão salva — risco ${r.risco}`, r.risco === 'alto' ? 'erro' : 'ok');
        A.ir('contratos');
      },
    });
    setTimeout(() => {
      document.querySelectorAll('.chips[data-cl] .chip').forEach((ch) => { ch.onclick = () => {
        ch.parentElement.querySelectorAll('.chip').forEach((x) => x.classList.remove('on')); ch.classList.add('on'); }; });
    }, 0);
  }; });
};

// ===========================================================================
// MÓDULO 4 — CAPACITAÇÃO
// ===========================================================================
Telas.capacitacao = async (el) => {
  const [{ turmas, trilhas, limitePadrao }, acesso, baseEmpresas, compartilhadas] = await Promise.all([
    A.api(`/empresas/${S.empresaId}/turmas`), A.api(`/empresas/${S.empresaId}/acesso`), A.api('/empresas'), A.api('/turmas/compartilhadas'),
  ]);
  const chaveTrilha = { workshop_boas_praticas: 'treinamento_boas_praticas', workshop_pratico: 'capacitacao_operacional' };
  const trilhasLiberadas = trilhas.filter((t) => acesso.trilhas.includes(chaveTrilha[t.id]));
  const participantes = turmas.reduce((total, turma) => total + turma.participantes.length, 0);
  const presencas = turmas.reduce((total, turma) => total + turma.participantes.filter((p) => p.presenca).length, 0);
  const realizadas = turmas.filter((turma) => turma.status === 'realizada').length;
  el.innerHTML = cab('Módulo 4', 'Capacitação do time',
    'Treinamento de Boas Práticas pode reunir participantes de várias empresas; Capacitação Operacional é exclusiva da empresa contratante.',
    `<button class="btn" id="novaTurma" ${trilhasLiberadas.length ? '' : 'disabled'}>Programar turma</button>`) +
    `${trilhasLiberadas.length ? `<div class="aviso bom"><b>Capacitações liberadas no plano:</b> ${trilhasLiberadas.map((t) => A.esc(t.titulo)).join(' · ')}</div>` : '<div class="aviso atencao"><b>Nenhuma capacitação liberada no plano aprovado.</b> Aprove o plano com Treinamento Boas Práticas ou Capacitação Operacional para liberar agenda e participantes.</div>'}
    <div class="grade g4 resumo-capacitacao">
      ${A.kpi('Turmas programadas', turmas.length, `${realizadas} realizadas`)}
      ${A.kpi('Participantes', participantes, 'pessoas inscritas')}
      ${A.kpi('Presenças confirmadas', presencas, participantes ? `${A.pct(presencas / participantes, 0)} da lista` : 'sem lista de presença')}
      ${A.kpi('Trilhas liberadas', trilhasLiberadas.length, 'conforme plano aprovado', 'destaque')}
    </div>
    <div class="cartao turmas-lista"><div class="cabecalho-lista"><div><h2>Turmas compartilhadas</h2><p class="desc">Treinamentos de Boas Práticas com participantes de mais de uma empresa.</p></div><span class="tag">${compartilhadas.turmas.length} turmas</span></div>${compartilhadas.turmas.length ? A.tabela([
      { t: 'Turma', r: (t) => `<b>${A.esc(t.titulo)}</b><small class="mini">${A.esc(t.data || 'data a definir')}</small>` },
      { t: 'Participantes', r: (t) => `${t.participantes}/${t.limite_participantes || 30}` },
      { t: 'Empresas participantes', r: (t) => `<span class="mini">${A.esc(t.empresas.join(' · ') || 'Nenhuma empresa vinculada')}</span>` },
    ], compartilhadas.turmas) : A.vazio('Nenhuma turma compartilhada', 'Programe um Treinamento de Boas Práticas para iniciar uma turma entre empresas.')}</div>
    <div class="cartao turmas-lista"><div class="cabecalho-lista"><div><h2>Agenda de entrega</h2><p class="desc">Controle as turmas, os participantes e a presença. O conteúdo não é executado dentro da ferramenta.</p></div><span class="tag">${turmas.length} turmas</span></div>
      ${turmas.length ? turmas.map((t) => `<article class="turma-card">
          <div class="turma-data"><b>${A.esc(t.data || '—')}</b><span>${t.carga_horaria}h</span></div><div class="turma-conteudo">
            <div><b>${A.esc(t.titulo)}</b><div class="mini">${A.esc(t.trilha === 'workshop_boas_praticas' ? 'Treinamento de Boas Práticas · turma compartilhada' : 'Capacitação Operacional · exclusiva da empresa')} · ${A.esc(t.formato)} · ${A.esc(t.instrutor || 'instrutor a definir')}</div></div>
            <div class="turma-acoes">
              <span class="tag ${t.status === 'realizada' ? 'c' : 'n'}">${A.esc(t.status)}</span>
              <button class="btn pq vazio" data-part="${t.id}">Participantes (${t.participantes.length}/${t.limite_participantes || 30})</button>
              <button class="btn pq vazio" data-et="${t.id}">Editar</button>
              <button class="btn pq perigo" data-rt="${t.id}">Excluir</button>
            </div>
            <div class="mini turma-presenca">${t.participantes.length}/${t.limite_participantes || 30} vagas ocupadas${t.participantes.length ? ` · presença: ${t.participantes.filter((p) => p.presenca).length}/${t.participantes.length}` : ''}</div>
          </div>
        </article>`).join('') : A.vazio('Nenhuma turma programada', 'Escolha uma trilha acima e programe a primeira turma.')}
    </div>`;

  const form = (t = {}) => `<div class="grade g2">${A.campo('titulo', 'Título', t.titulo)}
      ${A.selecao('trilha', 'Tipo contratado', trilhasLiberadas.map((x) => ({ v: x.id, t: x.titulo })), t.trilha)}</div>
    <div class="grade g3">${A.campo('data', 'Data', t.data, 'date')}
      ${A.campo('carga_horaria', 'Carga horária', t.carga_horaria || 4, 'number', 'step=0.5')}
      ${A.campo('limite_participantes', 'Limite de participantes', t.limite_participantes || limitePadrao || 30, 'number', 'min=1')}
      ${A.selecao('formato', 'Formato', [{ v: 'presencial', t: 'Presencial' }, { v: 'online', t: 'Online' }, { v: 'hibrido', t: 'Híbrido' }], t.formato || 'presencial')}</div>
    <div class="grade g2">${A.campo('instrutor', 'Instrutor', t.instrutor)}
      ${A.selecao('status', 'Status', [{ v: 'planejada', t: 'Planejada' }, { v: 'realizada', t: 'Realizada' }, { v: 'cancelada', t: 'Cancelada' }], t.status || 'planejada')}</div>
    ${A.area('observacoes', 'Observações', t.observacoes, 2)}`;

  const abrir = (t) => A.modal({ titulo: t ? 'Editar turma' : 'Programar turma', corpo: form(t || {}),
    aoConfirmar: async (d) => { if (t) await A.api(`/turmas/${t.id}`, { metodo: 'PUT', corpo: d });
      else await A.api(`/empresas/${S.empresaId}/turmas`, { metodo: 'POST', corpo: d }); A.ir('capacitacao'); } });

  document.getElementById('novaTurma').onclick = () => { if (trilhasLiberadas.length) abrir(null); };
  el.querySelectorAll('[data-et]').forEach((b) => { b.onclick = () => abrir(turmas.find((x) => x.id === Number(b.dataset.et))); });
  el.querySelectorAll('[data-rt]').forEach((b) => { b.onclick = () => A.confirmar('Excluir a turma e seus participantes?', async () => {
    await A.api(`/turmas/${b.dataset.rt}`, { metodo: 'DELETE' }); A.ir('capacitacao'); }); });

  el.querySelectorAll('[data-part]').forEach((b) => { b.onclick = () => {
    const t = turmas.find((x) => x.id === Number(b.dataset.part));
    A.modal({ titulo: `Participantes — ${t.titulo}`, largura: 720, confirmar: null,
      corpo: `<div class="aviso ${t.trilha === 'workshop_boas_praticas' ? 'bom' : ''}"><b>${t.trilha === 'workshop_boas_praticas' ? 'Turma compartilhada.' : 'Turma exclusiva.'}</b> ${t.trilha === 'workshop_boas_praticas' ? 'Cada participante deve ser vinculado à respectiva empresa.' : 'Os participantes são vinculados automaticamente a esta empresa.'}</div><div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
          <input type="text" id="pNome" placeholder="Nome"><input type="text" id="pArea" placeholder="Área"><input type="email" id="pEmail" placeholder="E-mail">${t.trilha === 'workshop_boas_praticas' ? `<select id="pEmpresa">${baseEmpresas.empresas.map((e) => `<option value="${e.id}">${A.esc(e.razao_social)}</option>`).join('')}</select>` : ''}
          <button class="btn pq" id="pAdd">Incluir</button></div>
        ${A.dropzone('zonaPart', `<b>Importar lista de participantes</b><div class="mini">colunas: Nome, Área, E-mail${t.trilha === 'workshop_boas_praticas' ? ', Empresa ou CNPJ' : ''}</div>`, async (f) => {
          const fd = new FormData(); fd.append('arquivo', f);
          try { const r = await A.api(`/turmas/${t.id}/importar`, { metodo: 'POST', corpo: fd }); A.toast(`${r.importados} participantes${r.foraDaCarteira ? ` · ${r.foraDaCarteira} sem acesso` : ''}`, 'ok'); A.ir('capacitacao'); }
          catch (e) { A.toast(e.message, 'erro'); } })}
        <div style="margin-top:14px">${A.tabela([
          { t: 'Nome', r: (p) => A.esc(p.nome) },
          ...(t.trilha === 'workshop_boas_praticas' ? [{ t: 'Empresa', r: (p) => A.esc(p.empresa_nome || '—') }] : []),
          { t: 'Área', r: (p) => A.esc(p.area || '—') },
          { t: 'Presença', r: (p) => `<input type="checkbox" data-pres="${p.id}" ${p.presenca ? 'checked' : ''}>` },
          { t: '', r: (p) => `<button class="btn pq perigo" data-rpa="${p.id}">Remover</button>` },
        ], t.participantes, { vazio: 'Nenhum participante.' })}</div>`,
    });
    setTimeout(() => {
      const add = document.getElementById('pAdd');
      if (add) add.onclick = async () => {
        const nome = document.getElementById('pNome').value.trim(); if (!nome) return;
        await A.api(`/turmas/${t.id}/participantes`, { metodo: 'POST', corpo: { nome, area: document.getElementById('pArea').value, email: document.getElementById('pEmail').value, empresa_id: t.trilha === 'workshop_boas_praticas' ? document.getElementById('pEmpresa').value : S.empresaId } });
        A.ir('capacitacao');
      };
      document.querySelectorAll('[data-pres]').forEach((c) => { c.onchange = async () => {
        const p = t.participantes.find((x) => x.id === Number(c.dataset.pres));
        await A.api(`/participantes/${p.id}`, { metodo: 'PUT', corpo: { ...p, presenca: c.checked } });
      }; });
      document.querySelectorAll('[data-rpa]').forEach((c) => { c.onclick = async () => {
        await A.api(`/participantes/${c.dataset.rpa}`, { metodo: 'DELETE' }); A.ir('capacitacao'); }; });
    }, 0);
  }; });
};

// ===========================================================================
// PLANO DE ADEQUAÇÃO
// ===========================================================================
Telas.plano = async (el) => {
  const { acoes } = await A.api(`/empresas/${S.empresaId}/acoes`);
  const abertas = acoes.filter((a) => a.status !== 'concluida');
  const emAndamento = acoes.filter((a) => a.status === 'em_andamento').length;
  const prioridadeAlta = abertas.filter((a) => a.prioridade === 'alta').length;
  const vencidas = abertas.filter((a) => a.prazo && a.prazo < new Date().toISOString().slice(0, 10)).length;
  const ordemPrioridade = { alta: 0, media: 1, baixa: 2 };
  const ordenadas = [...acoes].sort((a, b) => (ordemPrioridade[a.prioridade] ?? 3) - (ordemPrioridade[b.prioridade] ?? 3));
  el.innerHTML = cab('Entregável', 'Plano de adequação',
    'O que precisa ser feito, por quem e até quando. É o entregável que transforma o diagnóstico em execução.',
    `<button class="btn" id="novaAcao">Nova ação</button>
     <button class="btn vazio" onclick="window.open('/api/empresas/${S.empresaId}/relatorio/plano')">Exportar Excel</button>`) +
    `<div class="grade g4 resumo-plano">
      ${A.kpi('Ações em aberto', abertas.length, `${emAndamento} em andamento`)}
      ${A.kpi('Prioridade alta', prioridadeAlta, 'agir primeiro', prioridadeAlta ? 'destaque' : '')}
      ${A.kpi('Prazo vencido', vencidas, vencidas ? 'replanejar execução' : 'nenhum prazo vencido', vencidas ? 'destaque' : '')}
      ${A.kpi('Concluídas', acoes.filter((a) => a.status === 'concluida').length, `${acoes.length} ações no plano`)}
    </div>
    <div class="cartao plano-acoes"><div class="cabecalho-lista"><div><h2>Fila de execução</h2><p class="desc">Ações organizadas por prioridade. Atribua responsável e prazo para transformar recomendação em entrega.</p></div><span class="tag">${acoes.length} ações</span></div>${A.tabela([
      { t: 'Prioridade', r: (a) => `<span class="tag ${a.prioridade === 'alta' ? 'a' : a.prioridade === 'media' ? 'b' : 'n'}">${a.prioridade}</span>` },
      { t: 'Ação', r: (a) => `<b>${A.esc(a.titulo)}</b><div class="mini">${A.esc(a.descricao || '')}</div>` },
      { t: 'Origem', r: (a) => `<span class="mini">${A.esc(a.origem)}</span>` },
      { t: 'Responsável', r: (a) => A.esc(a.responsavel || '—') },
      { t: 'Prazo', r: (a) => `<span class="mono mini">${A.esc(a.prazo || '—')}</span>` },
      { t: 'Status', r: (a) => `<span class="tag ${a.status === 'concluida' ? 'c' : 'n'}">${A.esc(a.status)}</span>` },
      { t: '', r: (a) => `<button class="btn pq vazio" data-ea="${a.id}">Editar</button><button class="btn pq perigo" data-ra="${a.id}">Excluir</button>` },
    ], ordenadas, { vazio: 'Nenhuma ação registrada. Use os riscos apontados no diagnóstico como ponto de partida.' })}</div>`;

  const form = (a = {}) => A.campo('titulo', 'Ação', a.titulo) + A.area('descricao', 'Descrição', a.descricao, 2) +
    `<div class="grade g2">${A.campo('responsavel', 'Responsável', a.responsavel)}${A.campo('prazo', 'Prazo', a.prazo, 'date')}</div>
     <div class="grade g2">${A.selecao('prioridade', 'Prioridade', [{ v: 'alta', t: 'Alta' }, { v: 'media', t: 'Média' }, { v: 'baixa', t: 'Baixa' }], a.prioridade || 'media')}
     ${A.selecao('status', 'Status', [{ v: 'aberta', t: 'Aberta' }, { v: 'em_andamento', t: 'Em andamento' }, { v: 'concluida', t: 'Concluída' }], a.status || 'aberta')}</div>`;

  document.getElementById('novaAcao').onclick = () => A.modal({ titulo: 'Nova ação', corpo: form(),
    aoConfirmar: async (d) => { await A.api(`/empresas/${S.empresaId}/acoes`, { metodo: 'POST', corpo: d }); A.ir('plano'); } });
  el.querySelectorAll('[data-ea]').forEach((b) => { b.onclick = () => {
    const a = acoes.find((x) => x.id === Number(b.dataset.ea));
    A.modal({ titulo: 'Editar ação', corpo: form(a), aoConfirmar: async (d) => { await A.api(`/acoes/${a.id}`, { metodo: 'PUT', corpo: d }); A.ir('plano'); } }); }; });
  el.querySelectorAll('[data-ra]').forEach((b) => { b.onclick = async () => { await A.api(`/acoes/${b.dataset.ra}`, { metodo: 'DELETE' }); A.ir('plano'); }; });
};

// ===========================================================================
// SERVIÇOS E COMBOS
// ===========================================================================
Telas.servicos = async (el) => {
  const [dados, contratacoesDados] = await Promise.all([
    A.api('/servicos'),
    S.empresaId ? A.api(`/empresas/${S.empresaId}/contratacoes`) : Promise.resolve({ contratacoes: [] }),
  ]);
  const nomesLegados = new Set(['diagnóstico completo', 'implementação integral', 'essencial', 'margem protegida', 'blindagem contratual', 'time preparado']);
  const servicos = dados.servicos.filter((s) => !nomesLegados.has(String(s.nome || '').trim().toLowerCase()));
  const combos = dados.combos.filter((c) => !nomesLegados.has(String(c.nome || '').trim().toLowerCase()));
  const contratacaoAtual = (contratacoesDados.contratacoes || []).find((c) => c.aprovado_em) || (contratacoesDados.contratacoes || [])[0] || null;
  const servicosDoContrato = (contratacaoAtual?.servicos || []).map(Number);
  // O contrato salvo sempre prevalece sobre qualquer seleção transitória da tela.
  const sel = contratacaoAtual ? [...servicosDoContrato] : (S.cache.selServ?.length ? S.cache.selServ : []);
  if (contratacaoAtual) S.cache.selServ = [...servicosDoContrato];
  const modulos = [...new Set(servicos.map((s) => s.modulo))];

  el.innerHTML = cab('Escopo do projeto', 'Serviços e combos',
    'Defina exclusivamente o que será entregue ao cliente. A aprovação posterior congela esse escopo e libera os módulos correspondentes.') +
    (contratacaoAtual ? `<div class="aviso bom" style="margin-bottom:16px"><b>Escopo já registrado: ${A.esc(combos.find((c) => Number(c.id) === Number(contratacaoAtual.combo_id))?.nome || 'Escopo personalizado')}.</b> ${contratacaoAtual.aprovado_em ? 'O projeto está aprovado; as entregas e o acompanhamento permanecem preservados.' : 'Aguardando aprovação.'}<div class="acao"><button class="btn pq vazio" id="gerenciarEscopoExistente">Gerenciar escopo e entregas</button></div></div>` : '') +
    `<div class="grade g3">${combos.map((c) => `<div class="cartao ${c.destaque ? '' : ''}" style="${c.destaque ? 'border-left:3px solid var(--ouro)' : ''}">
        <h2>${A.esc(c.nome)}</h2><p class="desc">${A.esc(c.descricao)}</p>
        <div class="mini">${c.servicos.length} serviços · ${c.acompanhamento_meses || 0} mês(es) de acompanhamento</div>
        <button class="btn vazio pq" style="margin-top:11px" data-combo="${c.id}">Selecionar combo</button>
      </div>`).join('')}</div>
    <div class="grade g2" style="margin-top:16px">
      <div>
        ${modulos.map((m) => `<div class="cartao"><h2>${A.esc(m)}</h2>
          <div class="lista-sel">${servicos.filter((s) => s.modulo === m).map((s) => `
            <label class="it ${sel.includes(s.id) ? 'on' : ''}">
              <input type="checkbox" data-serv="${s.id}" ${sel.includes(s.id) ? 'checked' : ''}>
              <span><span class="nome">${A.esc(s.nome)}</span>
                <span class="txt">${A.esc(s.descricao)}</span>
              <span class="txt mini"><b>Entregáveis:</b> ${A.esc(s.entregaveis)}</span></span>
              <span class="mini">${s.prazo_dias} dias</span>
            </label>`).join('')}</div></div>`).join('')}
      </div>
      <div>
        <div class="cartao" style="position:sticky;top:20px"><h2>Escopo selecionado</h2><p class="desc">Resumo das entregas que serão registradas para aprovação.</p>
          <div id="resumoEscopo"><p class="mini">Selecione os serviços ao lado.</p></div>
        </div>
      </div>
    </div>`;

  const recalcular = async () => {
    const box = document.getElementById('resumoEscopo');
    if (!sel.length) { box.innerHTML = '<p class="mini">Selecione os serviços ao lado.</p>'; return; }
    const itens = servicos.filter((s) => sel.includes(s.id));
    // Um plano só é reconhecido quando a seleção é exatamente igual ao seu escopo.
    // O Basic é subconjunto dos demais e, sem esta comparação, aparecia indevidamente.
    const comboEscolhido = combos.find((c) => Number(c.id) === Number(S.cache.comboSelecionado));
    const corresponde = (c) => c && c.servicos.length === sel.length && c.servicos.every((id) => sel.includes(id));
    const combo = corresponde(comboEscolhido) ? comboEscolhido : (combos.find(corresponde) || null);
    box.innerHTML = `${itens.map((i) => `<div style="padding:6px 0;border-bottom:1px solid #eef1f3;font-size:13px">${A.esc(i.nome)}</div>`).join('')}
      <div class="aviso" style="margin-top:12px"><b>${combo ? A.esc(combo.nome) : 'Escopo personalizado'}</b>${combo ? ` · ${combo.acompanhamento_meses || 0} mês(es) de acompanhamento` : ''}</div>
      <button class="btn ouro" style="width:100%;margin-top:12px" id="gravarProposta" ${S.empresaId ? '' : 'disabled'}>
        ${S.empresaId ? (contratacaoAtual ? 'Gerenciar escopo e entregas' : 'Registrar escopo para aprovação') : 'Selecione uma empresa'}</button>`;
    const g = document.getElementById('gravarProposta');
    if (g) g.onclick = async () => {
      if (contratacaoAtual) { A.ir('gestaoProjetos'); return; }
      await A.api(`/empresas/${S.empresaId}/contratacoes`, { metodo: 'POST', corpo: { combo_id: combo ? combo.id : null,
        servicos: sel, valor_bruto: 0, desconto: 0, valor_final: 0 } });
      S.cache.selServ = []; S.cache.comboSelecionado = null;
      A.toast('Escopo registrado', 'ok');
    };
  };

  el.querySelectorAll('[data-serv]').forEach((c) => { c.onchange = () => {
    const id = Number(c.dataset.serv);
    if (c.checked) { if (!sel.includes(id)) sel.push(id); } else { const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); }
    S.cache.comboSelecionado = null;
    S.cache.selServ = sel;
    c.closest('.it').classList.toggle('on', c.checked);
    recalcular();
  }; });
  el.querySelectorAll('[data-combo]').forEach((b) => { b.onclick = () => {
    const c = combos.find((x) => x.id === Number(b.dataset.combo));
    S.cache.selServ = [...c.servicos]; S.cache.comboSelecionado = c.id; A.ir('servicos'); }; });
  document.getElementById('gerenciarEscopoExistente')?.addEventListener('click', () => A.ir('gestaoProjetos'));
  recalcular();
};

// ===========================================================================
// INTEGRAÇÃO QUESTOR
// ===========================================================================
Telas.questor = async (el) => {
  const { config } = await A.api('/questor/config');
  const { log } = await A.api('/questor/log');
  el.innerHTML = cab('Integração', 'Questor · nWeb',
    'Busca cadastros e movimentação direto do Questor Tributário, sem planilha. O nWeb roda na máquina do servidor Questor, porta 8080 por padrão.') +
    `<div class="grade g2">
      <div class="cartao"><h2>Conexão</h2><p class="desc">Endereço do serviço nWeb e token, quando exigido</p>
        ${A.campo('base_url', 'URL base do nWeb', config.baseUrl)}
        ${A.campo('token', 'Token (opcional)', config.token)}
        <label class="campo"><span>Integração ativa</span>
          <select name="ativo"><option value="1" ${config.ativo ? 'selected' : ''}>Ativa</option><option value="" ${config.ativo ? '' : 'selected'}>Inativa</option></select></label>
        <div style="display:flex;gap:8px">
          <button class="btn" id="salvarQ">Salvar</button>
          <button class="btn vazio" id="testarQ">Testar conexão</button>
        </div>
        <div id="resultadoQ" style="margin-top:14px"></div>
      </div>
      <div class="cartao"><h2>Buscar dados da empresa</h2>
        <p class="desc">${S.empresa ? `${A.esc(S.empresa.razao_social)} · código Questor: <b class="mono">${A.esc(S.empresa.codigo_questor || 'não informado')}</b>` : 'Selecione uma empresa'}</p>
        <div class="grade g2">${A.campo('inicio', 'Data inicial', '', 'date')}${A.campo('fim', 'Data final', '', 'date')}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn vazio pq" data-q="participantes" data-tipo="fornecedor">Importar fornecedores</button>
          <button class="btn vazio pq" data-q="participantes" data-tipo="cliente">Importar clientes</button>
          <button class="btn vazio pq" data-q="movimentacao" data-tipo="fornecedor">Importar entradas</button>
          <button class="btn vazio pq" data-q="movimentacao" data-tipo="cliente">Importar saídas</button>
        </div>
        <hr class="sep">
        <h2 style="font-size:13px">Chamada livre</h2>
        <p class="desc">Para descobrir ou validar endpoints da sua instalação</p>
        ${A.campo('rawPath', 'Caminho', '/TnWebDMDadosGerais/PegarVersaoQuestor')}
        <button class="btn vazio pq" id="rawBtn">Executar</button>
        <pre id="rawOut" class="mini" style="max-height:220px;overflow:auto;background:#f4f7f9;padding:10px;border-radius:8px;margin-top:10px"></pre>
      </div>
    </div>
    <div class="cartao"><h2>Mapa de endpoints</h2>
      <p class="desc">Caminhos, parâmetros e de-para de campos. Ajuste conforme a versão do seu Questor — o sistema não depende de código para isso.</p>
      <textarea id="endpoints" rows="16" class="mono" style="font-size:12px">${A.esc(JSON.stringify(config.endpoints, null, 2))}</textarea>
      <button class="btn vazio pq" id="salvarEnd" style="margin-top:10px">Salvar mapa</button>
    </div>
    <div class="cartao"><h2>Histórico de chamadas</h2>
      ${A.tabela([
        { t: 'Quando', r: (l) => `<span class="mini mono">${A.esc(l.criado_em)}</span>` },
        { t: 'Endpoint', r: (l) => `<span class="mono mini">${A.esc(l.endpoint)}</span>` },
        { t: 'Status', r: (l) => `<span class="tag ${l.status === 'ok' ? 'c' : 'a'}">${A.esc(l.status)}</span>` },
        { t: 'Registros', num: true, r: (l) => l.registros },
        { t: 'Mensagem', r: (l) => `<span class="mini">${A.esc(l.mensagem)}</span>` },
      ], log, { vazio: 'Nenhuma chamada registrada.' })}
    </div>`;

  const val = (n) => (el.querySelector(`[name="${n}"]`) || {}).value || '';
  document.getElementById('salvarQ').onclick = async () => {
    await A.api('/questor/config', { metodo: 'POST', corpo: { base_url: val('base_url'), token: val('token'), ativo: !!val('ativo'), endpoints: config.endpoints } });
    A.toast('Conexão salva', 'ok');
  };
  document.getElementById('salvarEnd').onclick = async () => {
    try {
      const eps = JSON.parse(document.getElementById('endpoints').value);
      await A.api('/questor/config', { metodo: 'POST', corpo: { base_url: val('base_url'), token: val('token'), ativo: !!val('ativo'), endpoints: eps } });
      A.toast('Mapa de endpoints salvo', 'ok');
    } catch (e) { A.toast('JSON inválido: ' + e.message, 'erro'); }
  };
  document.getElementById('testarQ').onclick = async () => {
    const box = document.getElementById('resultadoQ');
    box.innerHTML = '<div class="carregando">Testando…</div>';
    try {
      const r = await A.api('/questor/testar', { metodo: 'POST' });
      box.innerHTML = r.resultados.map((x) => `<div class="aviso ${x.ok ? 'bom' : 'alto'}"><b>${A.esc(x.path)}</b>
        ${x.ok ? A.esc(JSON.stringify(x.resposta).slice(0, 200)) : A.esc(x.erro)}</div>`).join('');
    } catch (e) { box.innerHTML = `<div class="aviso alto">${A.esc(e.message)}</div>`; }
  };
  document.getElementById('rawBtn').onclick = async () => {
    const out = document.getElementById('rawOut'); out.textContent = 'Chamando…';
    try { const r = await A.api('/questor/raw', { metodo: 'POST', corpo: { path: val('rawPath') } });
      out.textContent = JSON.stringify(r.resposta, null, 2).slice(0, 4000); }
    catch (e) { out.textContent = e.message; }
  };
  el.querySelectorAll('[data-q]').forEach((b) => { b.onclick = async () => {
    if (!S.empresaId) return A.toast('Selecione uma empresa', 'erro');
    b.disabled = true;
    try {
      const r = await A.api(`/empresas/${S.empresaId}/questor/${b.dataset.q}`, { metodo: 'POST',
        corpo: { tipo: b.dataset.tipo, inicio: val('inicio'), fim: val('fim') } });
      A.toast(`${r.importados} registros importados`, 'ok');
    } catch (e) { A.toast(e.message, 'erro'); } finally { b.disabled = false; }
  }; });
};
})();
