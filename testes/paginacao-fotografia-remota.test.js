const assert=require('node:assert/strict');
const {lerResultadosAtivosPorChave}=require('../src/services/operacaoCompartilhada');

const linhas=Array.from({length:1001},(_,i)=>({ id:i+1,empresa_id:23,execucao_id:8825,ativo:true,dados:{cbs:i} }));
let falhou=false;
const chamadas=[];
const remoto={
  from(tabela) {
    assert.equal(tabela,'motor_resultados_operacionais');
    const estado={ cursor:null,limite:null,empresa:null,ativo:null };
    const consulta={
      select(colunas) { assert.equal(colunas,'*'); return consulta; },
      eq(campo,valor) { if(campo==='empresa_id') estado.empresa=valor; if(campo==='ativo') estado.ativo=valor; return consulta; },
      gt(campo,valor) { assert.equal(campo,'id'); estado.cursor=valor; return consulta; },
      order(campo,opcoes) { assert.equal(campo,'id'); assert.equal(opcoes.ascending,true); return consulta; },
      limit(valor) {
        estado.limite=valor; chamadas.push({...estado});
        if(!falhou) { falhou=true; return Promise.resolve({data:null,error:{message:'timeout transitório'}}); }
        return Promise.resolve({ data:linhas.filter((x)=>x.id>estado.cursor).slice(0,estado.limite),error:null });
      },
    };
    return consulta;
  },
};

(async()=>{
  const recebidas=await lerResultadosAtivosPorChave(remoto,23,{esperar:async()=>{}});
  assert.equal(recebidas.length,1001);
  assert.deepEqual(recebidas.map((x)=>x.id),linhas.map((x)=>x.id));
  assert.equal(chamadas.length,4,'uma falha transitória e três páginas devem ser consultadas');
  assert.ok(chamadas.every((x)=>x.limite===500 && x.empresa===23 && x.ativo===true));
  assert.deepEqual(chamadas.map((x)=>x.cursor),[0,0,500,1000]);
  console.log('paginacao-fotografia-remota: keyset de 500 e nova tentativa transitória: OK');
})().catch((erro)=>{ console.error(erro); process.exitCode=1; });
