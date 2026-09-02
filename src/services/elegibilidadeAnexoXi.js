const db = require('./db_ref');

const normalizarCodigo = (v) => String(v || '').replace(/\D/g, '');

// Mantém o cache local utilizável antes da primeira restauração do Supabase.
// A fonte/versionamento da matriz oficial permanece na migration correspondente.
const MATRIZ_PADRAO = [
  ['1015','Órgão Público do Poder Executivo Federal','ADMINISTRACAO_DIRETA'], ['1023','Órgão Público do Poder Executivo Estadual ou do Distrito Federal','ADMINISTRACAO_DIRETA'], ['1031','Órgão Público do Poder Executivo Municipal','ADMINISTRACAO_DIRETA'],
  ['1040','Órgão Público do Poder Legislativo Federal','ADMINISTRACAO_DIRETA'], ['1058','Órgão Público do Poder Legislativo Estadual ou do Distrito Federal','ADMINISTRACAO_DIRETA'], ['1066','Órgão Público do Poder Legislativo Municipal','ADMINISTRACAO_DIRETA'], ['1074','Órgão Público do Poder Judiciário Federal','ADMINISTRACAO_DIRETA'], ['1082','Órgão Público do Poder Judiciário Estadual','ADMINISTRACAO_DIRETA'],
  ['1104','Autarquia Federal','AUTARQUIA'], ['1112','Autarquia Estadual ou do Distrito Federal','AUTARQUIA'], ['1120','Autarquia Municipal','AUTARQUIA'],
  ['1139','Fundação Pública de Direito Público Federal','FUNDACAO_PUBLICA'], ['1147','Fundação Pública de Direito Público Estadual ou do Distrito Federal','FUNDACAO_PUBLICA'], ['1155','Fundação Pública de Direito Público Municipal','FUNDACAO_PUBLICA'],
  ['1252','Fundação Pública de Direito Privado Federal','FUNDACAO_PUBLICA'], ['1260','Fundação Pública de Direito Privado Estadual ou do Distrito Federal','FUNDACAO_PUBLICA'], ['1279','Fundação Pública de Direito Privado Municipal','FUNDACAO_PUBLICA'],
  ['1236','Estado ou Distrito Federal','ADMINISTRACAO_DIRETA'], ['1244','Município','ADMINISTRACAO_DIRETA'],
];

function garantirMatrizLocal() {
  const banco = db();
  const existe = banco.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='param_naturezas_juridicas_anexo_xi'").get();
  if (!existe) return;
  const inserir = banco.prepare(`INSERT OR IGNORE INTO param_naturezas_juridicas_anexo_xi
    (codigo_natureza_juridica,descricao,categoria,elegivel_200043,fonte,versao,vigencia_inicio,status)
    VALUES (?,?,?,?,?,'1','2026-01-01','ATIVO')`);
  banco.transaction(() => MATRIZ_PADRAO.forEach(([codigo, descricao, categoria]) =>
    inserir.run(codigo, descricao, categoria, 1, 'RFB - Tabela de Natureza Jurídica')))();
}

function naturezaAdquirente(dados = {}) {
  garantirMatrizLocal();
  const codigo = normalizarCodigo(dados.codigo_natureza_juridica);
  const natureza = String(dados.natureza_juridica || '');
  if (!codigo) return { status: 'PENDENTE', codigo, motivo: 'Natureza jurídica do adquirente não disponível após a consulta cadastral.', fonte: dados.fonte || null };
  const regra = db().prepare(`SELECT * FROM param_naturezas_juridicas_anexo_xi
    WHERE codigo_natureza_juridica=? AND elegivel_200043=1 AND status='ATIVO'`).get(codigo);
  if (regra) return { status: 'SIM', codigo, categoria: regra.categoria, motivo: `Natureza jurídica ${codigo} elegível: ${regra.descricao}.`, fonte: dados.fonte || regra.fonte };
  return { status: 'NAO', codigo, motivo: `Natureza jurídica ${codigo}${natureza ? ` (${natureza})` : ''} não integra a matriz elegível de administração direta, autarquia ou fundação pública.`, fonte: dados.fonte || null };
}

function qsaEmpresa(empresaId) {
  const socios = db().prepare('SELECT * FROM empresa_qsa WHERE empresa_id=? ORDER BY id').all(empresaId);
  if (!socios.length) return { status: 'PENDENTE', socios, motivo: 'Quadro societário ainda não disponível para verificar participação brasileira de 20%.' };
  const atende = socios.find((s) => Number(s.brasileiro) === 1 && Number(s.percentual_participacao) >= 20);
  if (atende) return { status: 'SIM', socios, socio: atende, motivo: 'Há sócio brasileiro com participação no capital igual ou superior a 20%.' };
  const percentualAusente = socios.some((s) => s.percentual_participacao == null || s.percentual_participacao === '');
  if (percentualAusente) return { status: 'PENDENTE', socios, motivo: 'O QSA foi localizado, mas o percentual de participação não foi informado; é necessária confirmação manual.' };
  return { status: 'NAO', socios, motivo: 'Nenhum sócio brasileiro possui participação no capital igual ou superior a 20%.' };
}

function filtrarCandidatos(candidatos, contexto = {}) {
  const excluidos = []; const pendentes = [];
  const filtrados = (candidatos || []).filter((c) => {
    if (c.cclasstrib === '200043') {
      const e = contexto.adquirente || { status: 'PENDENTE', motivo: 'Adquirente não identificado.' };
      if (e.status === 'NAO') { excluidos.push({ codigo: '200043', motivo: e.motivo }); return false; }
      if (e.status === 'PENDENTE') pendentes.push({ codigo: '200043', motivo: e.motivo });
    }
    if (c.cclasstrib === '200044') {
      const e = contexto.qsa || { status: 'PENDENTE', motivo: 'QSA do emitente não identificado.' };
      if (e.status === 'NAO') { excluidos.push({ codigo: '200044', motivo: e.motivo }); return false; }
      if (e.status === 'PENDENTE') pendentes.push({ codigo: '200044', motivo: e.motivo });
    }
    return true;
  });
  return { candidatos: filtrados, excluidos, pendentes };
}

module.exports = { normalizarCodigo, garantirMatrizLocal, naturezaAdquirente, qsaEmpresa, filtrarCandidatos, MATRIZ_PADRAO };
