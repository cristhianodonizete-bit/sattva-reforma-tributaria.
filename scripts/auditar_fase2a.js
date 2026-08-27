#!/usr/bin/env node
/* Fotografia de cobertura da Fase 2A. Não executa motor nem reprocessa. */
const fs = require('fs');
const path = require('path');
const db = require('../src/db');
const cobertura = require('../src/services/coberturaDiagnostico');

const empresaId = Number(process.argv[2] || 1);
const empresa = db.prepare('SELECT id,razao_social FROM empresas WHERE id=?').get(empresaId);
if (!empresa) throw new Error('Empresa não encontrada.');
const inicial = cobertura.fotografia(empresaId);
const popular = cobertura.popularCadastrosMestre();
const final = cobertura.registrarFotografia(empresaId, 'FASE_2A_FINAL');
const saida = { fase: '2A', empresa, inicial, popular, final, criado_em: new Date().toISOString() };
const arquivo = path.join(__dirname, '..', 'auditorias', `fase2a-cobertura-empresa-${empresaId}-${new Date().toISOString().slice(0,10)}.json`);
fs.mkdirSync(path.dirname(arquivo), { recursive: true });
fs.writeFileSync(arquivo, JSON.stringify(saida, null, 2));
console.log(JSON.stringify({ arquivo, empresa, execucao: final.execucao, inicial: inicial.fotografia.cobertura, final: final.fotografia.cobertura, popular, excecoes: final.excecoes.resumo }, null, 2));
