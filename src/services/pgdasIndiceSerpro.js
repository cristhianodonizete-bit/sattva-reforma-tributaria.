const crypto = require('crypto');

const competencia = (v) => {
  const s = String(v || '').replace(/\D/g, '');
  return /^\d{6}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
};
const dataSerpro = (v) => {
  const s = String(v || '').replace(/\D/g, '');
  return /^\d{14}$/.test(s) ? `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)} ${s.slice(8,10)}:${s.slice(10,12)}:${s.slice(12,14)}` : null;
};
function periodos(resposta = {}) {
  const dados = resposta?.dados && typeof resposta.dados === 'object' ? resposta.dados : resposta;
  return Array.isArray(dados?.periodos) ? dados.periodos : [];
}
function extrair(resposta = {}) {
  return periodos(resposta).map((periodo) => {
    const comp = competencia(periodo.periodoApuracao);
    const operacoes = Array.isArray(periodo.operacoes) ? periodo.operacoes : [];
    const declaracoes = operacoes.filter((x) => x?.indiceDeclaracao).map((x) => ({
      tipo_operacao: x.tipoOperacao || 'Não informado', numero: String(x.indiceDeclaracao.numeroDeclaracao || ''),
      data_transmissao: dataSerpro(x.indiceDeclaracao.dataHoraTransmissao), indice: x,
    })).filter((x) => x.numero);
    const das = operacoes.filter((x) => x?.indiceDas).map((x) => ({
      tipo_operacao: x.tipoOperacao || 'Geração de DAS', numero: String(x.indiceDas.numeroDas || ''),
      data_emissao: dataSerpro(x.indiceDas.datahoraEmissaoDas || x.indiceDas.dataHoraEmissaoDas), pago: x.indiceDas.dasPago === true, indice: x,
    })).filter((x) => x.numero);
    return { competencia: comp, declaracoes, das, operacoes };
  }).filter((x) => x.competencia);
}
function persistir(db, empresaId, resposta, competenciaAlvo) {
  const bruto = JSON.stringify(resposta);
  const hash = crypto.createHash('sha256').update(bruto).digest('hex');
  const agora = new Date().toISOString();
  const linhas = extrair(resposta).filter((x) => !competenciaAlvo || x.competencia === competenciaAlvo);
  db.transaction(() => {
    for (const linha of linhas) {
      db.prepare(`INSERT OR IGNORE INTO integra_contador_respostas (empresa_id,competencia,id_servico,versao_servico,resposta_json,hash_resposta,consultado_em) VALUES (?,?,?,?,?,?,?)`)
        .run(empresaId, linha.competencia, 'CONSDECLARACAO13', '1.0', bruto, hash, agora);
      const vigenteDeclaracao = [...linha.declaracoes].sort((a,b) => String(a.data_transmissao).localeCompare(String(b.data_transmissao))).at(-1) || null;
      const vigenteDas = linha.das.at(-1) || null;
      db.prepare(`INSERT INTO pgdas_apuracoes_serpro (empresa_id,competencia,status_declaracao,status_das,status_pagamento,declaracao_vigente_numero,das_vigente_numero,ultima_consulta_em)
        VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(empresa_id,competencia) DO UPDATE SET status_declaracao=excluded.status_declaracao,status_das=excluded.status_das,status_pagamento=excluded.status_pagamento,declaracao_vigente_numero=excluded.declaracao_vigente_numero,das_vigente_numero=excluded.das_vigente_numero,ultima_consulta_em=excluded.ultima_consulta_em`)
        .run(empresaId, linha.competencia, linha.declaracoes.length ? 'TRANSMITIDA' : 'SEM_DECLARACAO', linha.das.length ? 'GERADO' : 'NAO_GERADO', vigenteDas ? (vigenteDas.pago ? 'PAGO' : 'PENDENTE') : 'NAO_IDENTIFICADO', vigenteDeclaracao?.numero || null, vigenteDas?.numero || null, agora);
      const apuracao = db.prepare('SELECT id FROM pgdas_apuracoes_serpro WHERE empresa_id=? AND competencia=?').get(empresaId, linha.competencia);
      db.prepare('UPDATE pgdas_declaracoes_serpro SET vigente=0 WHERE apuracao_id=?').run(apuracao.id);
      for (const d of linha.declaracoes) {
        db.prepare(`INSERT INTO pgdas_declaracoes_serpro (apuracao_id,numero_declaracao,tipo_operacao,data_transmissao,vigente,status,indice_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(numero_declaracao) DO UPDATE SET tipo_operacao=excluded.tipo_operacao,data_transmissao=excluded.data_transmissao,vigente=excluded.vigente,indice_json=excluded.indice_json`)
          .run(apuracao.id,d.numero,d.tipo_operacao,d.data_transmissao,d.numero===vigenteDeclaracao?.numero?1:0,'TRANSMITIDA',JSON.stringify(d.indice));
      }
      for (const x of linha.das) db.prepare(`INSERT INTO pgdas_das_serpro (apuracao_id,numero_das,data_emissao,pago,status,indice_json) VALUES (?,?,?,?,?,?) ON CONFLICT(numero_das) DO UPDATE SET data_emissao=excluded.data_emissao,pago=excluded.pago,status=excluded.status,indice_json=excluded.indice_json`).run(apuracao.id,x.numero,x.data_emissao,x.pago?1:0,'GERADO',JSON.stringify(x.indice));
      for (const x of linha.operacoes) { const numero = x?.indiceDeclaracao?.numeroDeclaracao || x?.indiceDas?.numeroDas; if (numero) db.prepare('INSERT OR IGNORE INTO pgdas_operacoes_serpro (apuracao_id,tipo_operacao,numero_referencia,indice_json) VALUES (?,?,?,?)').run(apuracao.id,x.tipoOperacao || 'Não informado',String(numero),JSON.stringify(x)); }
    }
  })();
  return linhas;
}
module.exports = { extrair, persistir, competencia, dataSerpro };
