const assert = require('node:assert');
const fs = require('node:fs');

const index = fs.readFileSync('public/index.html', 'utf8');

assert.match(index, /fetch\('\/auth\/status', \{ cache: 'no-store' \}\)/, 'a página deve consultar o commit realmente Live sem cache');
assert.match(index, /status\.commit_render/, 'o identificador do deploy deve versionar os arquivos da interface');
assert.match(index, /script\.src = `js\/\$\{arquivo\}\.js\?v=\$\{versao\}`/, 'todos os scripts devem carregar com a versão do commit Live');
assert.doesNotMatch(index, /<script src="js\/telas\.js"><\/script>/, 'a página não deve manter URL estática suscetível a versão antiga');

console.log('versao-interface-deploy: scripts vinculados ao commit Live: OK');
