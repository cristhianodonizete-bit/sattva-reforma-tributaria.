const assert = require('assert');
const fs = require('fs');
const path = require('path');

const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'api.js'), 'utf8');
const tela = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'telas4.js'), 'utf8');

// Contrato da API: somente fatos e identidade interna no lote.
assert.match(rota, /CAMPOS_TRIBUTARIOS_PROIBIDOS_CFC/, 'API deve bloquear campos tributários');
assert.match(rota, /validarPayloadSomenteFatos\(req\.body\)/, 'ações de fatos devem validar o payload');
assert.match(rota, /produtos_empresa_id/, 'API deve receber o vetor de identidades internas no lote');
assert.match(rota, /salvarLote\(\{ empresa_id:Number\(req\.params\.id\), produtos_empresa_id:produtosEmpresaId/, 'lote deve encaminhar produto_empresa_id ao serviço');
assert.match(rota, /responderPendencia\(Number\(req\.params\.pendenciaId\)/, 'resposta continua ancorada na pendência, não no código exibido');

// Contrato lógico da tela: seleção e payload usam a identidade, sem campos tributários editáveis.
assert.match(tela, /data-produto-empresa-id/, 'linha selecionável deve portar produto_empresa_id');
assert.match(tela, /produto_empresa_id:p\.produto_empresa_id\|\|null/, 'resposta individual deve enviar produto_empresa_id');
assert.match(tela, /produtos_empresa_id:selecionadas\.map\(p=>p\.produto_empresa_id\)/, 'lote deve enviar produto_empresa_id[]');
assert.match(tela, /p\.codigo_produto/, 'código continua disponível para exibição');
assert.doesNotMatch(tela, /name=["'](?:cst_pis|cst_cofins|pis_percentual|cofins_percentual|tratamento_pis_cofins)/i, 'tela não deve expor escolha tributária editável');
assert.match(tela, /NAO_SEI/, 'NÃO SEI deve continuar disponível');
console.log('classificacao-fiscal-complementar API/interface: 10 contratos aprovados');
