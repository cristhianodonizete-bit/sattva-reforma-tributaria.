const assert = require('assert');
const { PassThrough } = require('stream');
const executivo = require('../src/services/contratosExecutivo');
const entrega2 = require('../src/services/contratosEntrega2');

function contrato(extra = {}) {
  return { id: 91, nome: 'Contrato de teste', contraparte: 'Contraparte de teste', objeto: 'Fornecimento', vigencia_inicio: '2027-01-01', vigencia_fim: '2027-12-31', status_analise: 'EM_ANALISE', ...extra };
}
const clausula = { id: 4, localizacao: 'Cláusula 4 · página 2', texto_original: 'O preço é fixo e irreajustável.', natureza: 'EXTRAIDO' };
const risco = { id: 8, codigo: 'PRECO_FIXO_SEM_REVISAO', risco: 'Preço fixo sem revisão', evidencia: 'Trecho extraído: preço fixo e irreajustável.', impacto_potencial: 'Risco de absorção de impacto.', nivel: 'alto', fundamento: 'Triagem documental.', clausula_id: 4, natureza: 'INTERPRETADO' };
const recomendacao = { prioridade: 'ALTA', recomendacao: 'Avaliar mecanismo expresso de reajuste.', evidencia: risco.evidencia, natureza: 'INTERPRETADO' };
const sugestao = { clausula_original: clausula.texto_original, sugestao_redacao: 'RASCUNHO PARA REVISÃO JURÍDICA — texto sugerido.', motivo: 'Criar mecanismo de reajuste.', natureza: 'SUGERIDO', status: 'RASCUNHO' };

function gerarPdf(gerador, entrada) {
  return new Promise((resolve, reject) => {
    const destino = new PassThrough(); let bytes = 0;
    destino.on('data', (chunk) => { bytes += chunk.length; });
    destino.on('error', reject); destino.on('finish', () => resolve(bytes));
    gerador(entrada, destino);
  });
}

(async () => {
  // ADMINISTRATIVO somente com marcação e prova explícita.
  const administrativo = executivo.montarContrato({ contrato: contrato({ natureza_contrato: 'CONTRATO_ADMINISTRATIVO', natureza_contrato_origem: 'DOCUMENTO', natureza_contrato_evidencia: 'Cláusula 1 identifica a contratação administrativa.' }), documentos: [{ nome_original: 'admin.txt', status_extracao: 'CONCLUIDA' }], clausulas: [clausula], riscos: [risco], recomendacoes: [recomendacao], sugestoes: [sugestao] });
  assert.strictEqual(administrativo.contrato.natureza_contrato, 'CONTRATO_ADMINISTRATIVO');
  assert.strictEqual(administrativo.clausulas[0].natureza, 'EXTRAIDO');
  assert.strictEqual(administrativo.riscos[0].natureza, 'INTERPRETADO');
  assert.strictEqual(administrativo.sugestoes[0].sugestao_redacao, sugestao.sugestao_redacao); // original não é substituído

  const privado = executivo.montarContrato({ contrato: contrato({ natureza_contrato: 'CONTRATO_PRIVADO', natureza_contrato_origem: 'CADASTRO', natureza_contrato_evidencia: 'Cadastro confirmado como relação privada.' }) });
  assert.strictEqual(privado.contrato.natureza_contrato, 'CONTRATO_PRIVADO');
  const semProva = executivo.montarContrato({ contrato: contrato({ natureza_contrato: 'CONTRATO_ADMINISTRATIVO' }) });
  assert.strictEqual(semProva.contrato.natureza_contrato, 'INDETERMINADO');
  assert(semProva.pendencias.some((x) => x.natureza === 'INDETERMINADO'));

  // Uma recomendação sem fonte continua bloqueada na camada anterior.
  assert.strictEqual(entrega2.recomendacaoDeRisco({ codigo: 'PRECO_FIXO_SEM_REVISAO', evidencia: '' }, new Map()), null);

  // A Precificação é apenas lida por vínculo explícito; estados são preservados.
  const calculado = executivo.impactoEconomico({ item: { id: 7, natureza_item: 'produto', descricao: 'Produto calculado' }, simulacao: { natureza: 'CALCULADO', valor_venda_atual: 100, preco_projetado: 110, margem_atual: 25, margem_projetada: 25 } }, { id: 1, tipo_item: 'produto', item_precificacao_id: 7, pricing_simulacao_id: 501 });
  const incompleto = executivo.impactoEconomico({ item: { id: 8, natureza_item: 'servico', descricao: 'Serviço incompleto' }, simulacao: { natureza: 'CALCULADO', status: 'INCOMPLETO', valor_venda_atual: 80 } }, { id: 2, tipo_item: 'servico', item_precificacao_id: 8, pricing_simulacao_id: 502 });
  assert.strictEqual(calculado.natureza, 'CALCULADO');
  assert.strictEqual(incompleto.natureza, 'INCOMPLETO');
  const completo = executivo.montarContrato({ contrato: administrativo.contrato, documentos: administrativo.documentos, clausulas: [clausula], riscos: [risco], recomendacoes: [recomendacao], sugestoes: [sugestao], impactosEconomicos: [calculado, incompleto] });
  assert(completo.parecer.secoes.some((x) => x.tipo === 'CALCULO' && x.natureza === 'CALCULADO'));
  assert(completo.pendencias.some((x) => x.natureza === 'INCOMPLETO'));

  const p = executivo.painel([completo, privado, semProva]);
  assert.strictEqual(p.contratos_analisados.quantidade, 1);
  assert.strictEqual(p.contratos_administrativos.quantidade, 1);
  assert.strictEqual(p.contratos_privados.quantidade, 1);
  assert.strictEqual(p.contratos_indeterminados.quantidade, 1);
  assert.deepStrictEqual(p.risco_alto.contratos, [91]);

  const bytesIndividual = await gerarPdf(executivo.gerarPdfIndividual, completo);
  const bytesCarteira = await gerarPdf(executivo.gerarPdfCarteira, { painel: p, relatorios: [completo, privado, semProva] });
  assert(bytesIndividual > 800, 'PDF individual deve conter conteúdo');
  assert(bytesCarteira > 800, 'PDF consolidado deve conter conteúdo');
  console.log('Contratos Entrega 3: painel, segregação de natureza, camadas, vínculo econômico, memória e PDFs aprovados.');
})().catch((erro) => { console.error(erro); process.exitCode = 1; });
