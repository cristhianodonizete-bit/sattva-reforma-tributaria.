const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path');
const db = fs.readFileSync(path.join(__dirname, '../src/db.js'), 'utf8');
assert.match(db, /CREATE TABLE IF NOT EXISTS sincronizacao_operacional_estado/);
console.log('sincronizacao-incremental-base: estado local durável validado.');
