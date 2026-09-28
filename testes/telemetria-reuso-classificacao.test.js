const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sattva-telemetria-reuso-'));
process.env.SATTVA_DADOS = pasta;
const { criar } = require('../src/services/telemetriaReusoClassificacao');

const contexto = { empresa:{ id:1 }, sentido:'saida', regimeContraparte:'normal', perfilDestinatario:'consumidor' };
const item = { cfop:'5102', ncm:'30049099', descricao:'Produto A', declarado:{ cst:'000', cclasstrib:'', ibs:'', cbs:'' } };

const desligada = criar();
desligada.registrar(item, contexto);
assert.equal(desligada.resumo().executada, false);

const telemetria = criar({ ativo:true });
telemetria.registrar(item, contexto);
telemetria.registrar({ ...item, valor:9999 }, contexto);
telemetria.registrar({ ...item, cfop:'6102' }, contexto);
const resumo = telemetria.resumo();
assert.deepEqual(resumo, {
  executada:true, natureza:'SOMBRA_OBSERVACIONAL_SEM_REUSO', itens_observados:3,
  contextos_distintos:2, classificacoes_potencialmente_reutilizaveis:1,
  taxa_reuso_potencial:33.33, alterou_resultado_oficial:false, divergencias_avaliadas:0,
});
console.log('telemetria-reuso-classificacao: observa sem alterar classificação: OK');
require('../src/db').close();
fs.rmSync(pasta, { recursive:true, force:true });
