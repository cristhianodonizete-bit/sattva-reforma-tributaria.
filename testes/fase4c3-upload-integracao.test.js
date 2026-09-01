const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const multer = require('multer');

async function executar() {
  // O teste de tela assegura que o handler usa exatamente o modal que o criou:
  // IDs globais podem resolver um input de outra modal ou de uma tela anterior.
  const tela = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'telas.js'), 'utf8');
  assert.match(tela, /aoConfirmar: async \(_dados, fundo\)/, 'handler deve receber o contêiner da modal');
  assert.match(tela, /fundo\.querySelector\('#arquivoApuracao'\)\?\.files\?\.\[0\]/, 'handler deve ler o arquivo do modal ativo');
  assert.match(tela, /fundo\.querySelector\('#tipoApuracao'\)\?\.value/, 'tipo deve vir do mesmo modal');
  assert.match(tela, /fd\.append\('arquivo', arquivo\)/, 'FormData deve conter o arquivo');
  assert.match(tela, /apuracoes-pis-cofins\/ingestao/, 'handler deve chamar a rota de ingestão');
  const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
  assert.match(app, /opcoes\.corpo instanceof FormData/, 'A.api deve preservar FormData');
  assert.match(app, /body: opcoes\.corpo instanceof FormData \? opcoes\.corpo/, 'fetch deve enviar o multipart sem serialização JSON');
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api.js'), 'utf8');
  assert.match(rota, /router\.post\('\/empresas\/:id\/apuracoes-pis-cofins\/ingestao', upload\.single\('arquivo'\)/, 'a rota deve usar o mesmo campo multipart');
  assert.match(rota, /if \(!req\.file\?\.buffer\)/, 'a rota deve exigir o buffer entregue pelo middleware');

  // Integração HTTP real, sem Azure nem banco: FormData -> multipart -> multer
  // -> endpoint -> serviço. O handler do endpoint verifica o mesmo contrato
  // usado pela rota de produção: req.file.buffer e req.body.tipo_documento.
  const appHttp = express();
  const upload = multer({ storage: multer.memoryStorage() });
  let recebidoPeloServico = null;
  appHttp.post('/api/empresas/77/apuracoes-pis-cofins/ingestao', upload.single('arquivo'), (req, res) => {
    recebidoPeloServico = { arquivo: req.file, tipo_documento: req.body.tipo_documento };
    if (!req.file?.buffer) return res.status(400).json({ ok: false });
    return res.json({ ok: true, nome: req.file.originalname, bytes: req.file.buffer.length, tipo: req.body.tipo_documento });
  });
  const servidor = await new Promise((resolve) => {
    const s = appHttp.listen(0, '127.0.0.1', () => resolve(s));
  });
  try {
    const fd = new FormData();
    const conteudo = 'documento de teste de transporte multipart';
    fd.append('arquivo', new Blob([conteudo], { type: 'application/pdf' }), 'apuracao.pdf');
    fd.append('tipo_documento', 'PDF');
    assert.strictEqual(fd.get('arquivo').name, 'apuracao.pdf', 'input selecionado deve chegar ao FormData');
    const { port } = servidor.address();
    const resposta = await fetch(`http://127.0.0.1:${port}/api/empresas/77/apuracoes-pis-cofins/ingestao`, { method: 'POST', body: fd });
    const corpo = await resposta.json();
    assert.strictEqual(resposta.status, 200, 'fetch deve enviar multipart aceito pela rota');
    assert.strictEqual(corpo.ok, true);
    assert.strictEqual(corpo.nome, 'apuracao.pdf');
    assert.strictEqual(corpo.bytes, Buffer.byteLength(conteudo));
    assert.strictEqual(corpo.tipo, 'PDF');
    assert.ok(recebidoPeloServico?.arquivo?.buffer, 'multer deve entregar o buffer ao serviço');
    assert.strictEqual(recebidoPeloServico.arquivo.fieldname, 'arquivo');
    assert.strictEqual(recebidoPeloServico.tipo_documento, 'PDF');
  } finally {
    await new Promise((resolve, reject) => servidor.close((erro) => erro ? reject(erro) : resolve()));
  }
  console.log('Upload PIS/Cofins: modal, FormData, fetch multipart e multer verificados.');
}

executar().catch((erro) => { console.error(erro); process.exitCode = 1; });
