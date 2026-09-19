/*
 * Dados complementares para diagnóstico. Esta camada guarda fatos e
 * premissas informadas; ela não calcula nem alimenta o motor fiscal.
 */
const crypto = require('crypto');
const motorReceitasSemDfe = require('./motorReceitasSemDfe');

const STATUS_VALIDACAO = new Set(['PENDENTE', 'VALIDADO', 'POSSIVEL_DUPLICIDADE', 'REJEITADO']);
const CLASSIFICACOES_RECEITA = new Set(['LOCACAO_IMOVEL','LOCACAO_BEM_MOVEL','CESSAO_DIREITOS','ROYALTIES_LICENCIAMENTO','RECEITA_FINANCEIRA','REEMBOLSO_RESSARCIMENTO','INDENIZACAO_MULTA','SUBVENCAO','ALIENACAO_ATIVO','VENDA_IMOVEL_PROPRIO','INCORPORACAO_IMOBILIARIA','OUTRA']);

function texto(valor) {
  return String(valor ?? '').trim();
}

function normalizarTexto(valor) {
  return texto(valor).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');
}

// A entrada operacional deve ser curta. A classificação é responsabilidade
// do sistema: aluguel de equipamento e locação de bem móvel são o mesmo fato.
function classificacaoAutomatica(tipoReceita, descricao) {
  const chave = normalizarTexto(`${tipoReceita} ${descricao}`);
  if (/locacao|aluguel|aluguer/.test(chave)) return 'LOCACAO_BEM_MOVEL';
  if (/receita financeira|juros|rendimento financeiro|aplicacao financeira/.test(chave)) return 'RECEITA_FINANCEIRA';
  return 'OUTRA';
}

function competenciaValida(valor) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(texto(valor));
}

function numeroObrigatorio(valor, campo, { permiteZero = true } = {}) {
  if (valor === '' || valor === null || valor === undefined || !Number.isFinite(Number(valor))) throw new Error(`${campo} obrigatório.`);
  const n = Number(valor);
  if (n < 0 || (!permiteZero && n === 0)) throw new Error(`${campo} inválido.`);
  return n;
}

function validarEmpresa(db, empresaId) {
  if (!db.prepare('SELECT 1 FROM empresas WHERE id=?').get(empresaId)) throw new Error('Empresa não encontrada.');
}

function status(valor, padrao = 'PENDENTE') {
  const resultado = texto(valor || padrao).toUpperCase();
  if (!STATUS_VALIDACAO.has(resultado)) throw new Error('Status de validação inválido.');
  return resultado;
}

function salvarFolha(db, empresaId, dados) {
  validarEmpresa(db, empresaId);
  const competencia = texto(dados.competencia);
  if (!competenciaValida(competencia)) throw new Error('Competência deve estar no formato AAAA-MM.');
  const existente = db.prepare('SELECT id FROM folhas_pagamento_competencias WHERE empresa_id=? AND competencia=?').get(empresaId, competencia);
  if (existente) throw new Error('Já existe folha informada para esta empresa e competência.');
  const valorFolha = numeroObrigatorio(dados.valor_folha, 'Valor da folha');
  const proLabore = dados.pro_labore === '' || dados.pro_labore === null || dados.pro_labore === undefined ? null : numeroObrigatorio(dados.pro_labore, 'Pró-labore');
  const r = db.prepare(`INSERT INTO folhas_pagamento_competencias
    (empresa_id,competencia,valor_folha,pro_labore,origem,referencia_arquivo,status_validacao)
    VALUES (?,?,?,?,?,?,?)`).run(empresaId, competencia, valorFolha, proLabore, texto(dados.origem || 'MANUAL'),
    texto(dados.referencia_arquivo) || null, status(dados.status_validacao, 'VALIDADO'));
  return { id: r.lastInsertRowid };
}

function editarFolha(db, empresaId, folhaId, dados) {
  validarEmpresa(db, empresaId);
  const atual = db.prepare('SELECT * FROM folhas_pagamento_competencias WHERE id=? AND empresa_id=?').get(Number(folhaId), empresaId);
  if (!atual) throw new Error('Lançamento de folha não encontrado.');
  const competencia = texto(dados.competencia);
  if (!competenciaValida(competencia)) throw new Error('Competência deve estar no formato AAAA-MM.');
  const duplicada = db.prepare('SELECT * FROM folhas_pagamento_competencias WHERE empresa_id=? AND competencia=? AND id<>?').get(empresaId, competencia, Number(folhaId));
  const valorFolha = numeroObrigatorio(dados.valor_folha, 'Valor da folha');
  const proLabore = dados.pro_labore === '' || dados.pro_labore === null || dados.pro_labore === undefined ? null : numeroObrigatorio(dados.pro_labore, 'Pró-labore');
  // Uma edição feita durante a sincronização anterior podia deixar a antiga
  // competência e a nova no remoto. Quando os valores são rigorosamente os
  // mesmos, são o mesmo lançamento: preservamos a competência ajustada e
  // removemos apenas a cópia antiga. Valores divergentes exigem escolha humana.
  if (duplicada) {
    const mesmaFolha = Number(duplicada.valor_folha) === valorFolha && Number(duplicada.pro_labore || 0) === Number(proLabore || 0);
    if (!mesmaFolha) throw new Error('Já existe folha com valores diferentes nesta competência. Revise os dois lançamentos antes de escolher qual manter.');
    db.prepare('DELETE FROM folhas_pagamento_competencias WHERE id=? AND empresa_id=?').run(Number(folhaId), empresaId);
    return { id: Number(duplicada.id), competencia_anterior: atual.competencia, competencia, consolidada: true };
  }
  db.prepare(`UPDATE folhas_pagamento_competencias
    SET competencia=?, valor_folha=?, pro_labore=?, origem=?, referencia_arquivo=?, status_validacao=?, atualizado_em=datetime('now','localtime')
    WHERE id=? AND empresa_id=?`).run(competencia, valorFolha, proLabore, texto(dados.origem || atual.origem || 'MANUAL'),
    texto(dados.referencia_arquivo) || null, status(dados.status_validacao, 'VALIDADO'), Number(folhaId), empresaId);
  return { id: Number(folhaId), competencia_anterior: atual.competencia, competencia };
}

function salvarMargem(db, empresaId, dados) {
  validarEmpresa(db, empresaId);
  const inicio = texto(dados.periodo_inicio), fim = texto(dados.periodo_fim);
  if (!competenciaValida(inicio) || !competenciaValida(fim) || inicio > fim) throw new Error('Período da margem inválido.');
  const margem = numeroObrigatorio(dados.margem_operacional_percentual, 'Margem operacional');
  if (margem > 100) throw new Error('Margem operacional deve ser informada em percentual entre 0 e 100.');
  const existente = db.prepare('SELECT id FROM margens_operacionais_premissas WHERE empresa_id=? AND periodo_inicio=? AND periodo_fim=?').get(empresaId, inicio, fim);
  if (existente) throw new Error('Já existe margem operacional para este período.');
  const r = db.prepare(`INSERT INTO margens_operacionais_premissas
    (empresa_id,periodo_inicio,periodo_fim,margem_operacional_percentual,origem,natureza,status_validacao)
    VALUES (?,?,?,?,?,'PREMISSA_INFORMADA',?)`).run(empresaId, inicio, fim, margem, texto(dados.origem || 'MANUAL'), status(dados.status_validacao));
  return { id: r.lastInsertRowid };
}

function candidatosDocumento(db, empresaId, competencia, valor) {
  const linhas = db.prepare(`SELECT id,descricao,documento,chave FROM movimentos
    WHERE empresa_id=? AND competencia=? AND tipo='cliente' AND ABS(COALESCE(valor,0)-?) < 0.005`).all(empresaId, competencia, valor);
  return linhas;
}

function salvarReceitaSemDfe(db, empresaId, dados) {
  validarEmpresa(db, empresaId);
  const competencia = texto(dados.competencia), descricao = texto(dados.descricao);
  if (!competenciaValida(competencia)) throw new Error('Competência deve estar no formato AAAA-MM.');
  if (!descricao) throw new Error('Descrição da receita é obrigatória.');
  const itemInformado = texto(dados.item_receita_chave || dados.tipo_receita);
  const item = db.prepare(`SELECT chave,nome,classificacao_fiscal FROM catalogo_itens_receita
    WHERE ativo=1 AND (chave=? OR lower(nome)=lower(?))`).get(itemInformado, itemInformado);
  if (!item) throw new Error('Selecione um item padronizado da lista. Não é permitido informar livremente o tipo de receita.');
  const tipoReceita = item.nome;
  const valor = numeroObrigatorio(dados.valor, 'Valor da receita');
  const classificacao = item.classificacao_fiscal;
  // Registros legados e planilhas antigas continuam importáveis, porém ficam
  // pendentes até receberem a classificação comparável na revisão.
  const classificacaoValida = CLASSIFICACOES_RECEITA.has(classificacao) ? classificacao : 'OUTRA';
  const subtipo = texto(dados.subtipo), objeto = texto(dados.objeto_operacao);
  const subtipoFinal = subtipo || 'A CLASSIFICAR', objetoFinal = objeto || descricao;
  // Para lançamentos do Questor, o número do lançamento REC é a identidade
  // fiscal estável. Descrição e texto do relatório podem variar entre duas
  // extrações do mesmo período; usá-los como chave permitia duplicação.
  const identificadorOrigem = texto(dados.identificador_origem);
  const especieQuestor = texto(dados.especie_questor).toUpperCase();
  const chaveFonte = identificadorOrigem && especieQuestor === 'REC'
    ? ['QUESTOR_REC', empresaId, identificadorOrigem]
    : [empresaId, competencia, normalizarTexto(tipoReceita), normalizarTexto(descricao), valor.toFixed(2)];
  const chave = crypto.createHash('sha256').update(chaveFonte.join('|')).digest('hex');
  if (db.prepare('SELECT id FROM receitas_sem_dfe WHERE empresa_id=? AND chave_deduplicacao=?').get(empresaId, chave)) throw new Error('Receita complementar duplicada para esta empresa.');

  const candidatos = candidatosDocumento(db, empresaId, competencia, valor);
  const exato = candidatos.find((x) => normalizarTexto(x.descricao) === normalizarTexto(descricao));
  if (exato) throw new Error('Receita já capturada em documento fiscal; não foi criada uma entrada complementar.');
  const statusValidacao = candidatos.length ? 'POSSIVEL_DUPLICIDADE' : status(dados.status_validacao);
  const campos = new Set(db.prepare('PRAGMA table_info(receitas_sem_dfe)').all().map((x) => x.name));
  const r = campos.has('classificacao_fiscal')
    ? db.prepare(`INSERT INTO receitas_sem_dfe (empresa_id,competencia,tipo_receita,descricao,valor,origem,evidencia,classificacao_fiscal,subtipo,objeto_operacao,contrato_referencia,regra_atual,regra_reforma,status_comparabilidade,identificador_origem,especie_questor,segregacao_apuracao,base_pis_cofins_atual,pis_atual,cofins_atual,criterio_tributacao_atual,tributacao_atual_origem,item_receita_chave,status_validacao,chave_deduplicacao) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(empresaId, competencia, tipoReceita, descricao, valor, texto(dados.origem || 'MANUAL'), texto(dados.evidencia) || null, classificacaoValida, subtipoFinal, objetoFinal, texto(dados.contrato_referencia) || null, texto(dados.regra_atual) || null, texto(dados.regra_reforma) || null, 'PENDENTE_MOTOR', identificadorOrigem || null, especieQuestor || null, texto(dados.segregacao_apuracao) || null, dados.base_pis_cofins_atual === null || dados.base_pis_cofins_atual === undefined ? null : numeroObrigatorio(dados.base_pis_cofins_atual, 'Base PIS/COFINS atual'), dados.pis_atual === null || dados.pis_atual === undefined ? null : numeroObrigatorio(dados.pis_atual, 'PIS atual'), dados.cofins_atual === null || dados.cofins_atual === undefined ? null : numeroObrigatorio(dados.cofins_atual, 'COFINS atual'), texto(dados.criterio_tributacao_atual) || null, texto(dados.tributacao_atual_origem) || null, item.chave, statusValidacao, chave)
    : db.prepare(`INSERT INTO receitas_sem_dfe (empresa_id,competencia,tipo_receita,descricao,valor,origem,evidencia,status_validacao,chave_deduplicacao) VALUES (?,?,?,?,?,?,?,?,?)`).run(empresaId,competencia,tipoReceita,descricao,valor,texto(dados.origem || 'MANUAL'),texto(dados.evidencia) || null,statusValidacao,chave);
  const id = r.lastInsertRowid;
  // A classificação da planilha é fato; a conclusão CBS/IBS é sempre do motor.
  const regimeEmpresa = db.prepare('SELECT regime FROM empresas WHERE id=?').get(empresaId)?.regime;
  const motor = campos.has('status_motor') ? motorReceitasSemDfe.aplicar(db, { id, competencia, classificacao_fiscal: classificacaoValida, subtipo: subtipoFinal, item_receita_chave: item.chave, valor }, regimeEmpresa) : null;
  return { id, status_validacao: statusValidacao, possivel_duplicidade: candidatos.length > 0, motor };
}

function listar(db, empresaId) {
  validarEmpresa(db, empresaId);
  return {
    folhas: db.prepare('SELECT * FROM folhas_pagamento_competencias WHERE empresa_id=? ORDER BY competencia DESC').all(empresaId),
    margens: db.prepare('SELECT * FROM margens_operacionais_premissas WHERE empresa_id=? ORDER BY periodo_inicio DESC, periodo_fim DESC').all(empresaId),
    receitas_sem_dfe: db.prepare('SELECT * FROM receitas_sem_dfe WHERE empresa_id=? ORDER BY competencia DESC, id DESC').all(empresaId),
  };
}

module.exports = { salvarFolha, editarFolha, salvarMargem, salvarReceitaSemDfe, listar, STATUS_VALIDACAO, CLASSIFICACOES_RECEITA, classificacaoAutomatica };
