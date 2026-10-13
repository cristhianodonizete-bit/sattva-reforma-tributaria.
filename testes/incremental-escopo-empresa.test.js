#!/usr/bin/env node
/* O lote incremental não pode materializar movimentos de outras empresas. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fonte = fs.readFileSync(path.join(__dirname,'..','src','services','motorExec.js'),'utf8');
const carregar = fonte.slice(fonte.indexOf('function carregar('),fonte.indexOf('/**\n * @param {number} empresaId'));
assert.match(carregar,/WHERE mq\.empresa_id=\? AND mq\.tipo=\?/,
  'a CTE de regime Questor deve ser limitada à empresa e ao lado antes da materialização');
assert.match(carregar,/const p = \[empresaId, tipo, empresaId, tipo\]/,
  'os parâmetros da CTE e da consulta principal devem permanecer separados');
console.log('incremental-escopo-empresa.test: CTE incremental limitada à empresa aprovada.');
