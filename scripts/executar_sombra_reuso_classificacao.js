#!/usr/bin/env node
/*
 * Compara classificação normal x reutilizada sobre uma cópia temporária local.
 * Não acessa Supabase, não publica, não grava resultados e não altera o banco
 * de origem. A cópia é removida ao final.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const empresaId = Number(process.argv[2] || 38);
const limite = Math.max(1, Number(process.argv[3] || 20000));
const raiz = path.join(__dirname, '..');
const origem = path.join(raiz, 'dados', 'reforma.db');
const temporario = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-sombra-reuso-'));
const destino = path.join(raiz, 'outputs', `sombra-reuso-classificacao-empresa-${empresaId}.json`);

if (!fs.existsSync(origem)) throw new Error(`Base local não encontrada: ${origem}`);
fs.copyFileSync(origem, path.join(temporario, 'reforma.db'));
process.env.SATTVA_DADOS = temporario;

const db = require('../src/db');
const motorExec = require('../src/services/motorExec');
const motor = require('../src/engine/motor');
const elegibilidade = require('../src/services/elegibilidadeAnexoXi');
const { comparar } = require('../src/services/sombraReusoClassificacao');

try {
  const empresa = db.prepare('SELECT * FROM empresas WHERE id=?').get(empresaId);
  if (!empresa) {
    const disponiveis = db.prepare('SELECT id,razao_social FROM empresas ORDER BY id LIMIT 20').all();
    throw new Error(`Empresa não encontrada na cópia local. Disponíveis: ${disponiveis.map((x) => `${x.id} ${x.razao_social}`).join(' | ') || 'nenhuma'}`);
  }
  const movimentos = db.prepare(`SELECT m.*,p.regime AS regime_cadastro,p.perfil_economico AS perfil_cadastro,p.descricao AS nome_cadastro
    FROM movimentos m LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo AND p.cnpj=m.inscr_federal
    WHERE m.empresa_id=? AND COALESCE(m.situacao_documento,'AUTORIZADO') NOT IN ('CANCELADO','DENEGADO','INUTILIZADO')
    ORDER BY m.id LIMIT ?`).all(empresaId, limite);
  const qsa = elegibilidade.qsaEmpresa(empresaId);
  const cadastroCnpj = db.prepare('SELECT * FROM cnpj_cache WHERE cnpj=?');
  const operacoes = movimentos.map((m) => {
    const sentido = m.tipo === 'cliente' ? 'saida' : 'entrada';
    const regime = m.regime_cadastro || m.regime || null;
    const perfil = sentido === 'saida'
      ? (m.perfil_cadastro === 'governo' ? 'governo' : motor.classificarDestinatario({ regime, cnpj:m.inscr_federal }).perfil)
      : null;
    const adquirente = elegibilidade.naturezaAdquirente(cadastroCnpj.get(String(m.inscr_federal || '').replace(/\D/g, '')) || {});
    return {
      movimento_id:Number(m.id), item:motorExec.normalizar(m),
      contexto:{ empresa, sentido, ano:2027, regimeContraparte:regime, perfilDestinatario:perfil,
        elegibilidadeAnexoXi: sentido === 'saida' ? { adquirente, qsa } : { adquirente, qsa:{ status:'PENDENTE', motivo:'Sombra sem QSA do fornecedor.' } } },
    };
  });
  const resultado = comparar(operacoes);
  const relatorio = {
    natureza:'SOMBRA_SEM_PERSISTENCIA', gerado_em:new Date().toISOString(),
    origem:'Cópia temporária descartável da base local; nenhum resultado foi salvo.',
    empresa:{ id:empresa.id, razao_social:empresa.razao_social }, limite, carregados:movimentos.length,
    resumo:{ itens:resultado.itens, contextos:resultado.contextos, reusos:resultado.reusos, divergencias:resultado.divergencias, aprovado:resultado.aprovado },
    campos_divergentes:resultado.resultados.flatMap((x) => x.divergencias).reduce((total, campo) => ({ ...total, [campo]:(total[campo] || 0) + 1 }), {}),
    divergencias:resultado.resultados.filter((x) => x.divergencias.length).slice(0, 100).map((x) => ({ movimento_id:x.movimento_id, divergencias:x.divergencias })),
  };
  fs.mkdirSync(path.dirname(destino), { recursive:true });
  fs.writeFileSync(destino, JSON.stringify(relatorio, null, 2));
  console.log(JSON.stringify({ ...relatorio.resumo, arquivo:destino }, null, 2));
  assert.equal(resultado.aprovado, true, 'A sombra encontrou divergências; nenhum reuso deve ser aplicado.');
} finally {
  try { db.close(); } catch (_) { /* encerramento */ }
  fs.rmSync(temporario, { recursive:true, force:true });
}
