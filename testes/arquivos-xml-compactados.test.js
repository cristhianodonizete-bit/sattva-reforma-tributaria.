const assert = require('assert');
const arquivos = require('../src/services/arquivosXmlCompactados');

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function zipArmazenado(nome, conteudo) {
  const nomeBuffer = Buffer.from(nome), dados = Buffer.from(conteudo), crc = crc32(dados);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14); local.writeUInt32LE(dados.length, 18); local.writeUInt32LE(dados.length, 22);
  local.writeUInt16LE(nomeBuffer.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(dados.length, 20); central.writeUInt32LE(dados.length, 24);
  central.writeUInt16LE(nomeBuffer.length, 28);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(1, 8); fim.writeUInt16LE(1, 10);
  fim.writeUInt32LE(central.length + nomeBuffer.length, 12); fim.writeUInt32LE(local.length + nomeBuffer.length + dados.length, 16);
  return Buffer.concat([local, nomeBuffer, dados, central, nomeBuffer, fim]);
}

(async () => {
  const zip = zipArmazenado('subpasta/nota.xml', '<NFe><infNFe/></NFe>');
  const resultado = await arquivos.preparar([
    { originalname:'notas.zip', buffer:zip },
    { originalname:'evento.xml', buffer:Buffer.from('<evento/>') },
    { originalname:'ignorar.txt', buffer:Buffer.from('x') },
  ]);
  assert.equal(resultado.arquivos.length, 2);
  assert.equal(resultado.estatistica.compactados, 1);
  assert.equal(resultado.estatistica.xml_extraidos, 1);
  assert.equal(resultado.arquivos[0].originalname, 'notas.zip/subpasta/nota.xml');
  await assert.rejects(arquivos.preparar([]), /Nenhum XML/);
  console.log('arquivos-xml-compactados.test: ZIP extraído com limites e XMLs preservados.');
})().catch((erro) => { console.error(erro); process.exit(1); });
