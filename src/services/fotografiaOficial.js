'use strict';

function execucaoDaFotografiaOficial(db,empresaId){
  // A leitura analítica precisa usar exatamente a execução apontada pela
  // fotografia ativa. A maior chave local pode pertencer a staging, tentativa
  // interrompida ou cópia anterior à restauração canônica.
  const oficial=db.prepare(`SELECT fo.execucao_id id
    FROM fotografia_oficial fo
    JOIN motor_execucoes me ON me.id=fo.execucao_id AND me.empresa_id=fo.empresa_id
    WHERE fo.empresa_id=?`).get(Number(empresaId));
  if(oficial)return oficial;
  // Compatibilidade para instalação ainda sem ponteiro; os chamadores que
  // têm Supabase devem restaurar a fotografia antes de chegar aqui.
  return db.prepare('SELECT id FROM motor_execucoes WHERE empresa_id=? ORDER BY id DESC LIMIT 1').get(Number(empresaId));
}

module.exports={execucaoDaFotografiaOficial};
