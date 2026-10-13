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
const publicacaoEstados = require('../src/services/publicacaoEstadosProjecoes');

// A migração não calcula nem compara regras. Evitar importar o motor aqui é
// essencial: a carga do motor inclui catálogos que não pertencem a este
// checkpoint e podia esgotar a memória antes do primeiro lote.
function marcarEstado(db, empresaId, movimentoIds, situacao, motivo) {
  const ids=[...new Set((movimentoIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return 0;
  const marcas=ids.map(() => '?').join(',');
  const fontes=db.prepare(`SELECT m.id,m.empresa_id,COALESCE(d.valor,p.regime,m.regime,'indeterminado') regime,
      COALESCE(d.versao,p.regime_versao,1) versao
    FROM movimentos m LEFT JOIN parceiros p ON p.empresa_id=m.empresa_id AND p.tipo=m.tipo
      AND replace(replace(replace(replace(coalesce(p.cnpj,''),'.',''),'/',''),'-',''),' ','')=replace(replace(replace(replace(coalesce(m.inscr_federal,''),'.',''),'/',''),'-',''),' ','')
    LEFT JOIN movimento_decisoes_fiscais d ON d.empresa_id=m.empresa_id AND d.movimento_id=m.id AND d.campo='REGIME_FORNECEDOR' AND d.revogado_em IS NULL
    WHERE m.empresa_id=? AND m.id IN (${marcas})`).all(Number(empresaId),...ids);
  const gravar=db.prepare(`INSERT INTO projecoes_movimentos_estado(empresa_id,movimento_id,assinatura_origem,versao_origem,situacao,motivo,atualizado_em)
    VALUES (?,?,?,?,?,?,datetime('now','localtime'))
    ON CONFLICT(empresa_id,movimento_id) DO UPDATE SET situacao=excluded.situacao,motivo=excluded.motivo,atualizado_em=excluded.atualizado_em`);
  db.transaction(() => fontes.forEach((m) => gravar.run(m.empresa_id,m.id,`LEGADO_PENDENTE:${m.id}:${m.regime}`,Number(m.versao)||1,situacao,motivo)))();
  return fontes.length;
}

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
    // Esta rotina só governa a validade de uma fotografia que já foi
    // restaurada pelo worker. Reidratar a empresa inteira aqui voltava a
    // materializar resultados/JSONs antes da paginação e era justamente o
    // padrão que esta migração existe para eliminar.
    const fotografia = db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(empresaId);
    if (!fotografia) throw new Error(`Fotografia local ausente para a empresa ${empresaId}; execute a restauração paginada do worker antes do backfill.`);
    // Migração administrativa também não pode materializar a carteira: lê o
    // próximo lote por chave, persiste seu estado e grava o checkpoint antes
    // de seguir. Assim uma interrupção deixa somente os itens ainda não
    // processados para a próxima execução, sem reabrir os já confirmados.
    const total=Number(db.prepare('SELECT COUNT(*) AS total FROM movimentos WHERE empresa_id=?').get(empresaId)?.total || 0);
    const contagem={}; const lote=250; let processados=0;
    while (true) {
      // O próprio estado persistido é o checkpoint durável: após uma queda,
      // a próxima execução seleciona somente movimentos ainda sem marcação.
      const parte=db.prepare(`SELECT m.id,
          CASE WHEN EXISTS(SELECT 1 FROM motor_resultados r WHERE r.empresa_id=m.empresa_id AND r.movimento_id=m.id) THEN 1 ELSE 0 END AS possui_resultado
        FROM movimentos m
        LEFT JOIN projecoes_movimentos_estado pe ON pe.empresa_id=m.empresa_id AND pe.movimento_id=m.id
        WHERE m.empresa_id=? AND pe.movimento_id IS NULL ORDER BY m.id LIMIT ?`)
        .all(empresaId, lote);
      if (!parte.length) break;
      // Uma fotografia anterior à assinatura de origem nunca é assumida como
      // atual. O backfill a torna explicitamente pendente (ou pendência real
      // sem resultado), deixando o worker incremental produzir a nova
      // assinatura. Isso é seguro e não executa cálculo durante migração.
      const comResultado=parte.filter((x) => Number(x.possui_resultado) === 1).map((x) => Number(x.id));
      const semResultado=parte.filter((x) => Number(x.possui_resultado) !== 1).map((x) => Number(x.id));
      if (comResultado.length) marcarEstado(db,empresaId,comResultado,'ATUALIZACAO_PENDENTE','Fotografia legada sem assinatura de origem; aguardando atualização incremental.');
      if (semResultado.length) marcarEstado(db,empresaId,semResultado,'PENDENCIA_REAL','Não existe resultado ativo para este movimento.');
      const ids=parte.map((x) => Number(x.id));
      await publicacaoEstados.publicar(db,empresaId,ids);
      if (comResultado.length) contagem.ATUALIZACAO_PENDENTE=(contagem.ATUALIZACAO_PENDENTE||0)+comResultado.length;
      if (semResultado.length) contagem.PENDENCIA_REAL=(contagem.PENDENCIA_REAL||0)+semResultado.length;
      processados+=parte.length;
      console.log(JSON.stringify({empresa_id:empresaId,checkpoint:{ultimo_id:parte.at(-1).id,processados,total}}));
    }
    resumo.push({ empresa_id:empresaId,total,processados,estados:contagem });
  }
  console.log(JSON.stringify({ empresas:resumo },null,2));
}
main().catch((erro)=>{ console.error(erro.stack || erro.message); process.exitCode=1; });
