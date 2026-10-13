#!/usr/bin/env node
/*
 * Migração de dados pós-DDL, sem motor e sem alteração de fatos.
 *
 * Para cada empresa, reidrata a fonte e a fotografia ativa, compara as
 * assinaturas e persiste somente ATUAL/ATUALIZACAO_PENDENTE/FALHOU. O script
 * é propositalmente sequencial para não reproduzir o pico de memória que
 * derrubou o worker incremental.
 */
require('dotenv').config();
const db = require('../src/db');
const supabase = require('../src/services/supabase');
const operacao = require('../src/services/operacaoCompartilhada');
const projecoes = require('../src/services/projecoesMovimentos');

async function empresasAlvo() {
  const ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (ids.length) return ids;
  const { data,error }=await supabase.admin().from('empresas').select('origem_local_id').not('origem_local_id','is',null).order('origem_local_id');
  if (error) throw error;
  return [...new Set((data || []).map((x)=>Number(x.origem_local_id)).filter(Number.isInteger))];
}

async function main() {
  if (!supabase.configurado()) throw new Error('Supabase não configurado. A migração de estados exige a fonte compartilhada.');
  const empresas=await empresasAlvo(); const resumo=[];
  for (const empresaId of empresas) {
    await operacao.prepararContextoMotorEmpresa(empresaId);
    await operacao.restaurarFotografiaMotorEmpresa(empresaId);
    // Migração administrativa também não pode materializar a carteira: lê o
    // próximo lote por chave, persiste seu estado e grava o checkpoint antes
    // de seguir. Assim uma interrupção deixa somente os itens ainda não
    // processados para a próxima execução, sem reabrir os já confirmados.
    const total=Number(db.prepare('SELECT COUNT(*) AS total FROM movimentos WHERE empresa_id=?').get(empresaId)?.total || 0);
    const contagem={}; const lote=250; let depoisId=0; let processados=0;
    while (true) {
      const parte=db.prepare('SELECT id FROM movimentos WHERE empresa_id=? AND id>? ORDER BY id LIMIT ?')
        .all(empresaId, depoisId, lote).map((x) => Number(x.id));
      if (!parte.length) break;
      const estados=projecoes.reconciliar(db,empresaId,parte);
      await operacao.publicarEstadosProjecoes(empresaId,parte);
      for(const estado of estados.values()) contagem[estado.situacao]=(contagem[estado.situacao]||0)+1;
      depoisId=parte.at(-1); processados+=parte.length;
      console.log(JSON.stringify({empresa_id:empresaId,checkpoint:{depois_id:depoisId,processados,total}}));
    }
    resumo.push({ empresa_id:empresaId,total,processados,estados:contagem });
  }
  console.log(JSON.stringify({ empresas:resumo },null,2));
}
main().catch((erro)=>{ console.error(erro.stack || erro.message); process.exitCode=1; });
