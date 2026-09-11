const assert = require('assert');
const monitor = require('../src/services/monitoramentoAtualizacoesReforma');

assert.equal(monitor.FONTES.length, 10);
for (const fonte of monitor.FONTES) assert.equal(monitor.fontePermitida(fonte.url), true, fonte.nome);
assert.equal(monitor.fontePermitida('https://exemplo.com/nao-permitido'), false);
assert.match(monitor.textoLimpo('<script>ignorar()</script><h1> Norma </h1> &nbsp; vigente'), /Norma vigente/);
assert.match(monitor.trechoRepresentativo('Menu. A Reforma Tributária institui regras para IBS e CBS. A publicação é informativa.'), /Reforma Tributária/);
(async () => {
  const fonte = monitor.FONTES[0];
  const leitura = await monitor.lerEResumirFonte(fonte.url, {
    fetcher: async () => ({ ok:true, text:async () => '<article><p>A Reforma Tributária estabelece a transição para IBS e CBS e orienta a adaptação dos contribuintes.</p><p>O conteúdo é informativo.</p></article>' }),
    chamarIa: async () => ({ texto:'A publicação oficial apresenta orientações sobre a transição para IBS e CBS.' }),
  });
  assert.equal(leitura.metodo, 'IA_SOBRE_FONTE_OFICIAL');
  assert.match(leitura.resumo, /IBS e CBS/);
  console.log('monitoramento-atualizacoes-reforma: fontes oficiais, leitura e resumo aprovados.');
})().catch((erro) => { console.error(erro); process.exit(1); });
