#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
process.env.SATTVA_DADOS = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-questor-cancelamentos-'));
const rota = require('../src/routes/conectorQuestor');

const cabecalho = 'RELOTEC COMERCIO LTDA  Período: 01/04/2026 a 30/04/2026';
const comSituacao = '  39001  1234 Cliente de teste                 14/04/2026  21668NFE     1      5.102    2.379,07 Cancelado';
const semSituacao = '  39002  1234 Cliente de teste                 15/04/2026  21669NFE     1      5.102    1.000,00';
const numeroEmFaixa = '  39003  1234 Cliente de teste                 16/04/2026  21670-21670 NFE  1      5.102    900,00 Cancelado';
// Linha real: o nome do cliente excede a largura e cola na data.
const nomeTruncado = '  38604 5353485  SPDM - Associacao PAulista para o Desen13/04/202     21668NFE      1             5.102                0,00';
const registros = rota.lerCancelamentosQuestor(`${cabecalho}\r\n${comSituacao}\r\n${semSituacao}\r\n${numeroEmFaixa}\r\n${nomeTruncado}`);

assert.deepEqual(registros.map((r) => [r.data, r.numero, r.modelo, r.serie]), [
  ['2026-04-14', '21668', 'nfe', '1'],
  ['2026-04-15', '21669', 'nfe', '1'],
  ['2026-04-16', '21670', 'nfe', '1'],
  ['2026-04-13', '21668', 'nfe', '1'],
]);
console.log('leitura-relatorio-cancelamentos-questor.test: linhas com e sem coluna de situação são conciliadas.');
