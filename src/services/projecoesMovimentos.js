/*
 * Estado persistido da projeção por movimento.
 *
 * `motor_resultados` é um resultado derivado, não a verdade operacional.
 * Esta camada compara a assinatura dos fatos e do cadastro canônico com as
 * versões armazenadas no resultado antes que qualquer leitura o trate como
 * vigente. Ela é deliberadamente pequena: não recalcula valores e não altera
 * o fato fiscal; apenas governa a validade da fotografia.
 */
const crypto = require('node:crypto');
const motorExec = require('./motorExec');

const ESTADOS = Object.freeze({
  ATUAL: 'ATUAL',
  PENDENTE: 'ATUALIZACAO_PENDENTE',
  FALHOU: 'FALHOU',
  PENDENCIA_REAL: 'PENDENCIA_REAL',
  FORA_ESCOPO: 'FORA_ESCOPO',
});

const hash = (valor) => crypto.createHash('sha256').update(JSON.stringify(valor)).digest('hex');
const cnpj = (valor) => String(valor || '').replace(/\D/g, '');

function fonteCanonica(movimento, parceiro = {}) {
  return {
    movimento_id: Number(movimento.id),
    tipo: movimento.tipo,
    cnpj: cnpj(movimento.inscr_federal),
    // A versão do parceiro é a regra explícita que separa a identidade atual
    // da cópia histórica existente em movimentos.regime.
    regime: parceiro.regime || movimento.regime || 'indeterminado',
    regime_versao: Number(parceiro.regime_versao || movimento.regime_parceiro_versao || 1),
    regime_origem: parceiro.regime_origem || movimento.regime_fonte || null,
    ncm: movimento.ncm || null,
    nbs: movimento.nbs || null,
    lc116: movimento.lc116 || null,
    cfop: movimento.cfop || null,
    cst: movimento.cst || null,
    csosn: movimento.csosn || null,
    cclasstrib: movimento.cclasstrib || null,
    reducao: movimento.reducao || null,
    valor: Number(movimento.valor || 0),
    base_calculo: Number(movimento.base_calculo || 0),
    pis: Number(movimento.pis || 0),
    cofins: Number(movimento.cofins || 0),
    situacao_documento: movimento.situacao_documento || 'AUTORIZADO',
  };
}

function assinaturaOrigem(movimento, parceiro) {
  return hash(fonteCanonica(movimento, parceiro));
}

function assinaturaEsperadaLegada(movimento, parceiro) {
  const versoes = motorExec.versoesDaOperacao(movimento, parceiro);
  return {
    movimento_hash: motorExec.hashMovimento(movimento),
    regra_version: versoes.regra_version,
    parametro_version: versoes.parametro_version,
    catalogo_version: versoes.catalogo_version,
    parceiro_version: versoes.parceiro_version,
    motor_version: versoes.motor_version,
  };
}

function resultadoCompativel(movimento, parceiro, resultado) {
  if (!resultado) return false;
  const assinatura = assinaturaOrigem(movimento, parceiro);
  if (resultado.assinatura_origem) return resultado.assinatura_origem === assinatura;
  // Fotografias anteriores à coluna de assinatura continuam verificáveis por
  // suas seis versões já gravadas. Sem equivalência completa, são vencidas —
  // nunca presumimos que uma fotografia antiga ainda seja atual.
  const esperada = assinaturaEsperadaLegada(movimento, parceiro);
  return Object.entries(esperada).every(([campo, valor]) => String(resultado[campo] || '') === String(valor || ''));
}

function situacaoPreservada(db, empresaId, movimentoId) {
  return db.prepare(`SELECT situacao,motivo,job_id FROM projecoes_movimentos_estado
    WHERE empresa_id=? AND movimento_id=?`).get(Number(empresaId), Number(movimentoId));
}

function decidir(db, movimento, parceiro, resultado) {
  const assinatura = assinaturaOrigem(movimento, parceiro);
  const anterior = situacaoPreservada(db, movimento.empresa_id, movimento.id);
  // A fotografia de PIS/Cofins de fornecedores não calcula saídas para
  // clientes. Sem esta separação, uma saída sem resultado do motor aparecia
  // falsamente como pendência fiscal de fornecedor. Mantemos o fato e sua
  // decisão, mas o classificamos explicitamente fora do escopo desta projeção.
  if (String(movimento.tipo || '').toLowerCase() === 'cliente' || String(movimento.sentido || '').toLowerCase() === 'saida') {
    return { assinatura, situacao: ESTADOS.FORA_ESCOPO,
      motivo: 'Movimento de saída: não integra pendências de PIS/Cofins de fornecedores.', job_id: null };
  }
  if (['CANCELADO','DENEGADO','INUTILIZADO'].includes(String(movimento.situacao_documento || '').toUpperCase())) {
    return { assinatura, situacao: ESTADOS.FORA_ESCOPO,
      motivo: 'Documento fiscal cancelado: não integra cálculo nem pendências vigentes.', job_id: null };
  }
  if (resultadoCompativel(movimento, parceiro, resultado)) {
    return { assinatura, situacao: ESTADOS.ATUAL, motivo: null, job_id: null };
  }
  if (anterior?.situacao === ESTADOS.FALHOU) {
    return { assinatura, situacao: ESTADOS.FALHOU, motivo: anterior.motivo || 'A atualização incremental falhou.', job_id: anterior.job_id || null };
  }
  return {
    assinatura,
    situacao: resultado ? ESTADOS.PENDENTE : ESTADOS.PENDENCIA_REAL,
    motivo: resultado ? 'A decisão canônica mudou após a fotografia ativa; aguardando atualização incremental.' : 'Não existe resultado ativo para este movimento.',
    job_id: anterior?.job_id || null,
  };
}

function reconciliar(db, empresaId, movimentoIds) {
  const ids=[...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) throw new Error('Reconciliação global proibida: informe movimentos explícitos ou execute a migração administrativa em lotes.');
  const marcas=ids.map(()=>'?').join(',');
  const linhas = db.prepare(`SELECT m.*,COALESCE(d.valor,p.regime) AS regime_canonico,
      COALESCE(d.versao,p.regime_versao) AS parceiro_regime_versao,
      COALESCE(d.origem,p.regime_origem) AS parceiro_regime_origem,
      m.id AS movimento_id_fonte,r.id AS resultado_id,r.assinatura_origem AS resultado_assinatura_origem,
      r.movimento_hash AS resultado_movimento_hash,r.regra_version AS resultado_regra_version,
      r.catalogo_version AS resultado_catalogo_version,r.parceiro_version AS resultado_parceiro_version,
      r.parametro_version AS resultado_parametro_version,r.motor_version AS resultado_motor_version
    FROM movimentos m
    LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo
      AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=
          REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
    LEFT JOIN movimento_decisoes_fiscais d ON d.empresa_id=m.empresa_id AND d.movimento_id=m.id
      AND d.campo='REGIME_FORNECEDOR' AND d.revogado_em IS NULL
    LEFT JOIN motor_resultados r ON r.empresa_id=m.empresa_id AND r.movimento_id=m.id
    WHERE m.empresa_id=? AND m.id IN (${marcas})`).all(Number(empresaId),...ids);
  const gravar = db.prepare(`INSERT INTO projecoes_movimentos_estado
      (empresa_id,movimento_id,assinatura_origem,versao_origem,assinatura_calculada,versao_calculada,situacao,motivo,job_id,atualizado_em)
    VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET
      assinatura_origem=excluded.assinatura_origem,versao_origem=excluded.versao_origem,
      assinatura_calculada=excluded.assinatura_calculada,versao_calculada=excluded.versao_calculada,
      situacao=excluded.situacao,motivo=excluded.motivo,job_id=COALESCE(excluded.job_id,projecoes_movimentos_estado.job_id),atualizado_em=excluded.atualizado_em`);
  // A comparação retrocompatível consulta versões de regra que podem
  // inicializar catálogos em sua própria transação. Portanto a decisão deve
  // ser feita antes da transação curta de escrita; abrir a transação externa
  // aqui causava "cannot start a transaction within a transaction" e deixava
  // toda a fotografia histórica sem estado, zerando os agregados protegidos.
  const decisoes = linhas.map((linha) => {
    const parceiro = { regime:linha.regime_canonico, regime_versao:linha.parceiro_regime_versao, regime_origem:linha.parceiro_regime_origem };
    const movimento = { ...linha, id:linha.movimento_id_fonte };
    const resultado = linha.resultado_id ? {
      assinatura_origem:linha.resultado_assinatura_origem,
      movimento_hash:linha.resultado_movimento_hash,regra_version:linha.resultado_regra_version,
      catalogo_version:linha.resultado_catalogo_version,parceiro_version:linha.resultado_parceiro_version,
      parametro_version:linha.resultado_parametro_version,motor_version:linha.resultado_motor_version,
    } : null;
    const estado = decidir(db, movimento, parceiro, resultado);
    return { linha, parceiro, resultado, estado };
  });
  const estados = new Map();
  db.transaction(() => decisoes.forEach(({ linha, parceiro, resultado, estado }) => {
    gravar.run(linha.empresa_id,linha.movimento_id_fonte,estado.assinatura,Number(parceiro.regime_versao || 1),resultado?.assinatura_origem || null,null,estado.situacao,estado.motivo,estado.job_id);
    estados.set(Number(linha.movimento_id_fonte), estado);
  }))();
  return estados;
}

function marcar(db, empresaId, movimentoIds, situacao, motivo, jobId = null) {
  const ids = [...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const fontes = db.prepare(`SELECT m.*,COALESCE(d.valor,p.regime) AS regime_canonico,
      COALESCE(d.versao,p.regime_versao) AS parceiro_regime_versao,COALESCE(d.origem,p.regime_origem) AS parceiro_regime_origem
    FROM movimentos m LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo
      AND REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=
          REPLACE(REPLACE(REPLACE(REPLACE(COALESCE(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
    LEFT JOIN movimento_decisoes_fiscais d ON d.empresa_id=m.empresa_id AND d.movimento_id=m.id
      AND d.campo='REGIME_FORNECEDOR' AND d.revogado_em IS NULL
    WHERE m.empresa_id=? AND m.id IN (${placeholders})`).all(Number(empresaId), ...ids);
  const gravar = db.prepare(`INSERT INTO projecoes_movimentos_estado
    (empresa_id,movimento_id,assinatura_origem,versao_origem,situacao,motivo,job_id,atualizado_em)
    VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET assinatura_origem=excluded.assinatura_origem,
      versao_origem=excluded.versao_origem,situacao=excluded.situacao,motivo=excluded.motivo,job_id=excluded.job_id,atualizado_em=excluded.atualizado_em`);
  db.transaction(() => fontes.forEach((m) => {
    const parceiro={ regime:m.regime_canonico,regime_versao:m.parceiro_regime_versao,regime_origem:m.parceiro_regime_origem };
    gravar.run(m.empresa_id,m.id,assinaturaOrigem(m,parceiro),Number(parceiro.regime_versao || 1),situacao,motivo || null,jobId);
  }))();
  return fontes.length;
}

module.exports = { ESTADOS, fonteCanonica, assinaturaOrigem, resultadoCompativel, reconciliar, marcar };
