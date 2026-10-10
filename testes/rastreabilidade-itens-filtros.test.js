const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const raiz=path.resolve(__dirname,'..');
const tela=fs.readFileSync(path.join(raiz,'public/js/telas.js'),'utf8');
const abas=fs.readFileSync(path.join(raiz,'public/js/telas5.js'),'utf8');
const api=fs.readFileSync(path.join(raiz,'src/routes/api.js'),'utf8');
const consolidacao=fs.readFileSync(path.join(raiz,'src/services/consolidacaoOficial.js'),'utf8');

for(const campo of ['Documento','Fornecedor','Regime','Serviço ou item','Ordenar por','Direção']) assert.match(tela,new RegExp(campo));
assert.match(tela,/aplicarFiltrosRastreabilidadeItens/);
assert.match(tela,/limparFiltrosRastreabilidadeItens/);
assert.match(tela,/parametrosRastreabilidadeItens\.toString\(\)/,'os filtros devem chegar ao servidor');
for(const parametro of ['filtroDocumento','filtroParceiro','filtroRegime','filtroServico','ordenarDetalhes','direcaoDetalhes']) assert.match(api,new RegExp(parametro));
assert.match(consolidacao,/const itensDetalhados=itens\.filter/,'a filtragem deve ocorrer antes da paginação');
assert.match(consolidacao,/itensDetalhados\.slice\(inicioDetalhes/,'a página deve ser extraída do resultado filtrado');
assert.match(consolidacao,/totalSemFiltro: itens\.length/,'a resposta deve distinguir total filtrado da fotografia');
assert.match(consolidacao,/localeCompare\(String\(bv\),'pt-BR'/,'a ordenação textual deve ser determinística');
for(const aba of ['Análise atual','Compras por fornecedor','Riscos e oportunidades','Curva ABC','Rastreabilidade']) assert.match(abas,new RegExp(aba));
assert.match(abas,/id: 'rastreabilidade'.*render: renderVisaoFornecedor/,'a rastreabilidade deve ficar na navegação superior');
assert.match(tela,/abaSuperiorFornecedor/,'a visão interna deve acompanhar a aba superior ativa');
assert.match(tela,/abaSuperiorFornecedor==='atual' \? 'resumo'/,'Análise atual deve ser um resumo sem duplicar Compras por fornecedor');

console.log('OK: rastreabilidade por item filtra e ordena toda a fotografia antes da paginação.');
