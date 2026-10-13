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
    const ids=db.prepare('SELECT id FROM movimentos WHERE empresa_id=? ORDER BY id').all(empresaId).map(x=>x.id);
    const contagem={}; const lote=250;
    for(let inicio=0;inicio<ids.length;inicio+=lote) {
      const parte=ids.slice(inicio,inicio+lote);
      const estados=projecoes.reconciliar(db,empresaId,parte);
      await operacao.publicarEstadosProjecoes(empresaId,parte);
      for(const estado of estados.values()) contagem[estado.situacao]=(contagem[estado.situacao]||0)+1;
      console.log(JSON.stringify({empresa_id:empresaId,checkpoint:{inicio,inicio_proximo:inicio+parte.length,total:ids.length}}));
    }
    resumo.push({ empresa_id:empresaId,total:ids.length,estados:contagem });
    // Libera a cópia efêmera antes da empresa seguinte; o resultado oficial
    // já está no PostgreSQL e esta rotina não deve acumular carteiras no heap.
    db.prepare('DELETE FROM motor_resultados WHERE empresa_id=?').run(empresaId);
    db.prepare('DELETE FROM motor_execucoes WHERE empresa_id=?').run(empresaId);
  }
  console.log(JSON.stringify({ empresas:resumo },null,2));
}
main().catch((erro)=>{ console.error(erro.stack || erro.message); process.exitCode=1; });
