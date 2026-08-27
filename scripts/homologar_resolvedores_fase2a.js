#!/usr/bin/env node
require('dotenv').config();
const supabase = require('../src/services/supabase');
const perfil = require('../src/services/resolvedorPerfil');
const regra = require('../src/services/resolvedorRegra');

async function contar(remoto, tabela) { const { count, error } = await remoto.from(tabela).select('*', { count: 'exact', head: true }); if (error) throw new Error(`${tabela}: ${error.message}`); return count || 0; }
async function main() {
  const remoto = supabase.admin();
  const { data: conhecidos, error } = await remoto.from('cadastro_parceiros_mestre').select('cnpj').not('regime_atual', 'is', null).limit(1);
  if (error) throw new Error(`cadastro_parceiros_mestre: ${error.message}`);
  const conhecido = conhecidos?.[0]?.cnpj;
  const perfilConhecido = conhecido ? await perfil.resolverCompartilhado({ cnpj: conhecido }) : null;
  const perfilDesconhecido = await perfil.resolverCompartilhado({ cnpj: '99999999000199' });
  const regraCompartilhada = await regra.resolverCompartilhado({ tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2027-01-01' });
  const regraCondicional = await regra.resolverCompartilhado({ tipo_operacao: 'FORNECIMENTO_ONEROSO', data: '2027-01-01' });
  const regraDocumento = await regra.resolverCompartilhado({ documento_conclusivo: true, cst: '000', cclasstrib: '000001', tratamento_documento: 'DOCUMENTO_FIXTURE', tipo_operacao: 'FORNECIMENTO_ONEROSO', contraprestacao: true, data: '2027-01-01' });
  if (perfilDesconhecido.status !== 'INDETERMINADO' || regraCompartilhada.status !== 'DETERMINADO' || regraCondicional.status !== 'SUJEITO_VALIDACAO' || regraDocumento.origem !== 'DOCUMENTO') throw new Error('Resolvedores compartilhados não passaram na homologação.');
  console.log(JSON.stringify({ contagens: { parceiros: await contar(remoto, 'cadastro_parceiros_mestre'), produtos: await contar(remoto, 'cadastro_produtos_mestre'), servicos: await contar(remoto, 'cadastro_servicos_mestre'), regras: await contar(remoto, 'regras_enquadramento'), fotografias: await contar(remoto, 'cobertura_fotografias') },
    perfil: { conhecido: perfilConhecido ? { status: perfilConhecido.status, origem: perfilConhecido.origem, perfil: perfilConhecido.perfil } : 'sem cadastro com regime para amostra', desconhecido: { status: perfilDesconhecido.status, origem: perfilDesconhecido.origem } },
    regra: { ativo: { status: regraCompartilhada.status, regra: regraCompartilhada.regra?.id }, condicional: { status: regraCondicional.status, pendencias: regraCondicional.pendencias }, documento: { origem: regraDocumento.origem } } }, null, 2));
}
main().catch((erro) => { console.error(`Homologação dos resolvedores Fase 2A: ${erro.message}`); process.exit(1); });
