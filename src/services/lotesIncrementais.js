function dividir(ids = [], tamanho = 100) {
  const limite=Math.max(25,Math.min(250,Number(tamanho)||100));
  const unicos=[...new Set(ids.map(Number).filter(Number.isInteger))];
  const lotes=[];
  for (let i=0;i<unicos.length;i+=limite) lotes.push(unicos.slice(i,i+limite));
  return lotes;
}

function pendentes(lotes = [], proximoLote = 0) {
  const indice=Math.max(0,Math.min(lotes.length,Number(proximoLote)||0));
  return lotes.slice(indice);
}

module.exports={ dividir,pendentes };
