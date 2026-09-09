#!/usr/bin/env node
/* O estado dos grupos é intencionalmente da sessão, não persistente. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fonte = fs.readFileSync('public/js/app.js', 'utf8');
const estilo = fs.readFileSync('public/css/app.css', 'utf8');

assert.match(fonte, /menuAbertos:\s*new Set\(\)/, 'menu inicia com grupos fechados');
assert.match(fonte, /const aberto = S\.menuAbertos\.has\(grupo\.id\)/, 'abertura depende do estado da sessão');
assert.match(fonte, /S\.menuAbertos\.delete\(bloco\.dataset\.grupo\)/, 'clique permite retrair o grupo');
assert.match(fonte, /MENU\.forEach\(\(grupo\) => localStorage\.removeItem\(`sattva_menu_grupo_\$\{grupo\.id\}`\)\)/, 'limpa estados gravados por versões anteriores');
assert.doesNotMatch(fonte, /localStorage\.getItem\(`sattva_menu_grupo_/, 'não restaura estado aberto de sessões anteriores');
assert.match(estilo, /\.menu-subgrupo\{[^}]*border-left:/, 'submenu deve possuir recuo e guia visual própria');
assert.match(estilo, /\.menu-subtitulo:before\{content:'↳'/, 'submenu deve ter marcador de hierarquia');
console.log('menu-retraivel: grupos iniciam fechados e podem abrir/retrair na sessão.');
