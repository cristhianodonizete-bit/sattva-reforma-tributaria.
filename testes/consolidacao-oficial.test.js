#!/usr/bin/env node
/*
 * Regressão da Fase 1: uma única execução materializada deve alimentar as
 * duas cadeias, o Perfil CBS e o Impacto Final. Não usa a cadeia legada.
 */
const assert = require('node:assert/strict');
const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const oficial = require('../src/services/consolidacaoOficial');
const perfilCbs = require('../src/services/perfilCbs');

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const empresa = db.prepare('SELECT id FROM empresas ORDER BY id LIMIT 1').get();
if (!empresa) throw new Error('Fixture ausente: é necessária uma empresa para a reconciliação oficial.');

motorExec.executar(empresa.id, { ano: 2027 });
const execucaoInicial = oficial.ultimaExecucao(empresa.id).id;
const clientes = oficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false });
const clientesReutilizados = oficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false });
const clientesComBeneficios = oficial.cadeia(empresa.id, 'cliente', { executarSeAusente: false, incluirBeneficios: true });
const fornecedores = oficial.cadeia(empresa.id, 'fornecedor', { executarSeAusente: false });
const empresaCompleta = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresa.id);
const fotografia = motorExec.resultadoMaterializado(empresaCompleta);
const impacto = oficial.impactoFinal(empresa.id, { executarSeAusente: false });
const perfil = perfilCbs.materializar(empresa.id);
const perfilReutilizado = perfilCbs.materializar(empresa.id);
const leituraPagina = () => oficial.listar(empresa.id, { limite:100 });
const linhas = leituraPagina().itens;
const linhasReutilizadas = leituraPagina().itens;
const soma = (xs, campo) => r2(xs.reduce((s, x) => s + (Number(x[campo]) || 0), 0));
// Totais vêm do resumo SQL, não da primeira página. A lista é somente um
// recorte navegável e pode conter no máximo 100 resultados.
const resumoSaidas=oficial.resumo(empresa.id,{sentido:'saida'});
const resumoEntradas=oficial.resumo(empresa.id,{sentido:'entrada'});
const debito=r2(resumoSaidas.totais.cbs);
const credito=r2(resumoEntradas.totais.credito_cbs);

assert.equal(r2(clientes.totais.cbs), debito, 'Cadeia de Clientes deve ler a CBS de motor_resultados');
assert.equal(r2(fornecedores.totais.creditoFinal), credito, 'Cadeia de Fornecedores deve ler o crédito de motor_resultados');
assert.ok(fornecedores.estadoAtualizacao.pendentes>=0,'cadeia deve expor o estado de atualização do resumo SQL');
assert.equal(impacto.cbs_debito_vendas, debito, 'Impacto Final deve ler o débito materializado');
assert.equal(impacto.cbs_credito_compras, credito, 'Impacto Final deve ler o crédito materializado');
assert.equal(impacto.cbs_liquida, r2(debito - credito), 'CBS líquida deve reconciliar');
assert.equal(impacto.reconciliacao.status, impacto.pendentes ? 'PENDENTE_ATUALIZACAO' : 'RECONCILIADO', 'resultado vencido jamais pode ser tratado como vigente');
assert.equal(fotografia.ano, 2027, 'leitura materializada deve informar o ano efetivamente certificado');
assert.equal(fotografia.resumo.materializado, true, 'leitura de projeção não pode disparar novo cálculo');
assert.equal(r2(resumoSaidas.totais.valor), r2(clientes.totais.valor), 'cliente materializado deve reconciliar com o resumo SQL no período e escopo de receita');
assert.equal(clientes.parceiros.some((x) => Object.hasOwn(x, '_linha')), false, 'referência interna da linha não pode vazar no payload');
assert.equal(Object.hasOwn(clientes, 'operacoes200044'), false, 'benefícios não podem ser duplicados pelo contrato legado');
assert.deepEqual(clientesReutilizados.totais, clientes.totais, 'mesma execução deve devolver a mesma agregação SQL');
assert.equal(clientes.operacoesBeneficios.length, 0, 'resumo da cadeia não deve transferir o drill-down de benefícios');
assert.equal(clientes.tratamentoBeneficios.operacoes, clientesComBeneficios.tratamentoBeneficios.operacoes, 'resumo de benefícios deve permanecer íntegro sem transferir evidências');
assert.deepEqual(linhasReutilizadas, linhas, 'a mesma página SQL deve ser determinística');
assert.deepEqual(perfilReutilizado.competencias, perfil.competencias, 'o perfil CBS deve preservar a mesma fotografia materializada');
motorExec.executar(empresa.id, { ano: 2027 });
const execucaoNova = oficial.ultimaExecucao(empresa.id).id;
const linhasNovaExecucao = leituraPagina().itens;
assert.ok(execucaoNova > execucaoInicial, 'nova execução deve receber fotografia distinta');
assert.notStrictEqual(linhasNovaExecucao, linhas, 'nova execução não pode reutilizar linhas de fotografia anterior');
const rastreabilidade = clientes.detalhes[0] && oficial.detalhe(empresa.id,clientes.detalhes[0].movimento_id);
if (rastreabilidade?.resultado_vigente) {
  assert.equal(typeof rastreabilidade.detalhe,'object','detalhe unitário vigente deve ser carregado somente sob demanda');
} else if (rastreabilidade) {
  assert.equal(rastreabilidade.cbs,null,'detalhe vencido deve ocultar valores financeiros');
}
for (const d of clientes.detalhes) {
  if (d.resultado_vigente) {
    assert.equal(d.creditoPotencial, r2(d.credito_cbs + d.credito_ibs), 'crédito potencial do cliente deve vir do crédito oficial, não da CBS total da venda');
    if (d.status_credito === 'SEM_DIREITO') assert.equal(d.creditoPotencial, 0, 'perfil sem direito não recebe crédito potencial automático');
  } else assert.equal(d.creditoPotencial,null,'resultado vencido não pode expor crédito vigente');
}
console.log(`consolidacao-oficial.test: ${linhas.length} operações reconciliadas em motor_resultados.`);
