#!/usr/bin/env node
/* Leitura da fotografia ativa: não invalida e não calcula. */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const empresaId = Number(process.argv[2] || 1);
const execucao = db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId);
if (!execucao) throw new Error('Execução ativa não encontrada.');
const linhas = db.prepare(`SELECT mr.movimento_id,mr.credito_cbs,mr.tipo_credito,mr.modalidade_credito,mr.status_credito_determinacao,
  mr.regime_cbs_emitente,mr.regime_cbs_adquirente,mr.detalhe,m.valor,m.inscr_federal,m.nome,m.documento,m.sentido
  FROM motor_resultados mr JOIN movimentos m ON m.id=mr.movimento_id
  WHERE mr.empresa_id=? AND mr.execucao_id=? AND lower(m.sentido)='entrada'
  AND upper(coalesce(mr.regime_cbs_emitente,'')) LIKE '%SIMPLES%'
  AND upper(coalesce(mr.regime_cbs_adquirente,''))='REGULAR'
  ORDER BY m.valor DESC`).all(empresaId, execucao.id);
const detalhar = (x) => { try { return JSON.parse(x.detalhe || '{}'); } catch (_) { return {}; } };
const saida = linhas.map((x) => { const d = detalhar(x); return { movimento_id: x.movimento_id, fornecedor: x.nome, cnpj: x.inscr_federal, documento: x.documento, valor: x.valor,
  credito_atual: x.credito_cbs, tipo_credito: x.tipo_credito, modalidade_credito: x.modalidade_credito, status_credito: x.status_credito_determinacao,
  origem_atual: d.credito?.origem || d.origem_credito || null, natureza_atual: d.credito?.natureza || d.natureza_credito || null,
  percentual_documental: d.credito?.aliquota_documento || d.aliquota_credito_cbs_simples || null }; });
const relatorio = { empresa_id: empresaId, execucao_id: execucao.id, total_dependentes: saida.length, valor_dependentes: saida.reduce((s,x) => s + Number(x.valor || 0), 0), operacoes: saida };
const diretorio = path.join(__dirname, '..', 'auditorias');
fs.mkdirSync(diretorio, { recursive: true });
const arquivo = path.join(diretorio, `fase2a-dependentes-simples-empresa-${empresaId}.json`);
fs.writeFileSync(arquivo, JSON.stringify(relatorio, null, 2));
console.log(JSON.stringify({ ...relatorio, operacoes: saida.slice(0, 20), arquivo, amostra_limitada: saida.length > 20 }, null, 2));
