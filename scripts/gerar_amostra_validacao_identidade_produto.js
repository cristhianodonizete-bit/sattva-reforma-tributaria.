#!/usr/bin/env node
/* Gera planilhas locais para revisão humana; não acessa ou altera o banco. */
const fs = require('fs');
const path = require('path');

const entrada = process.argv[2];
const pastaSaida = process.argv[3] || path.dirname(entrada || '.');
const limite = Math.max(1, Number(process.argv[4]) || 200);
if (!entrada) throw new Error('Informe o relatório JSON de auditoria como primeiro argumento.');

const csv = (linhas) => linhas.map((linha) => linha.map((valor) => `"${String(valor ?? '').replaceAll('"', '""')}"`).join(';')).join('\r\n') + '\r\n';
const texto = (valores) => Array.isArray(valores) ? valores.join(' | ') : '';
const linha = (item, prioridade) => [
  prioridade, item.situacao, item.codigo_produto, item.ocorrencias, item.valor, item.competencias,
  texto(item.ncms), texto(item.descricoes),
  '', '', '', '',
];

const relatorio = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const cabecalho = ['prioridade','situacao','codigo_produto','ocorrencias','valor','competencias','ncms_encontrados','descricoes_encontradas','cadastro_confirmado','apresentacao_confirmada','decisao_revisor','observacao'];
const estaveis = (relatorio.codigos || []).filter((x) => x.situacao === 'CANDIDATO_ESTAVEL')
  .sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0)).slice(0, limite);
const ressalvas = (relatorio.codigos || []).filter((x) => x.situacao !== 'CANDIDATO_ESTAVEL')
  .sort((a, b) => Number(b.valor || 0) - Number(a.valor || 0));
fs.mkdirSync(pastaSaida, { recursive:true });
const base = path.basename(entrada, path.extname(entrada)).replace(/^auditoria-identidade-produto-/, '');
const amostra = path.join(pastaSaida, `amostra-validacao-identidade-${base}.csv`);
const excecoes = path.join(pastaSaida, `excecoes-validacao-identidade-${base}.csv`);
fs.writeFileSync(amostra, csv([cabecalho, ...estaveis.map((x, i) => linha(x, i + 1))]), 'utf8');
fs.writeFileSync(excecoes, csv([cabecalho, ...ressalvas.map((x, i) => linha(x, i + 1))]), 'utf8');
console.log(JSON.stringify({
  natureza:'ARQUIVOS_LOCAIS_PARA_REVISAO_HUMANA',
  criterio:'Amostra por maior valor; exceções completas. Arquivos não aprovam nem alteram produtos.',
  amostra:{ quantidade:estaveis.length, arquivo:path.resolve(amostra) },
  excecoes:{ quantidade:ressalvas.length, arquivo:path.resolve(excecoes) },
}, null, 2));
