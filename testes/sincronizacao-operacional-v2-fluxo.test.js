const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const fs = require('node:fs');
const path = require('node:path');

// Modelo determinístico do contrato SQL v2. Ele representa apenas a tabela
// probe da homologação: não usa motor, documentos fiscais ou produção.
class FilaV2Probe {
  constructor() { this.origem=[]; this.publicados=[]; this.proximoTecnico=1; this.proximoConsumo=1; this.checkpoints=new Map(); this.leases=new Map(); }
  alterar(id, anterior, novo, { confirmar=true } = {}) {
    const tecnico=this.proximoTecnico++;
    const negocio=(linha) => {
      if (linha == null) return linha;
      const { updated_at, atualizado_em, consultado_em, sincronizado_em, processado_em, acessado_em, ultimo_acesso_em, ...restante }=linha;
      return restante;
    };
    if (!confirmar || JSON.stringify(negocio(anterior)) === JSON.stringify(negocio(novo))) return { tecnico, evento:false };
    this.origem.push({ tecnico, id, operacao:novo == null ? 'DELETE' : anterior == null ? 'INSERT' : 'UPDATE', valor:novo });
    return { tecnico, evento:true };
  }
  publicar() {
    // Só eventos confirmados chegam aqui. A numeração de consumo é contígua e
    // independe da ordem em que sequências técnicas foram reservadas.
    for (const evento of this.origem.splice(0)) this.publicados.push({ ...evento, consumo:this.proximoConsumo++ });
  }
  registrar(consumidor, sessao) {
    const atual=this.leases.get(consumidor);
    if (atual && atual !== sessao) throw new Error('LEASE_OCUPADO');
    this.leases.set(consumidor,sessao);
    return this.checkpoints.get(consumidor) || 0;
  }
  eventosDepois(consumidor) { const marco=this.checkpoints.get(consumidor) || 0; return this.publicados.filter((x) => x.consumo > marco); }
  confirmar(consumidor, sessao, sequencia) {
    if (this.leases.get(consumidor) !== sessao) throw new Error('LEASE_INVALIDO');
    const anterior=this.checkpoints.get(consumidor) || 0;
    if (sequencia < anterior || sequencia >= this.proximoConsumo) throw new Error('CHECKPOINT_INVALIDO');
    this.checkpoints.set(consumidor,sequencia);
  }
}
function aplicar(cache, eventos) {
  for (const evento of eventos) {
    if (evento.operacao === 'DELETE') cache.delete(evento.id);
    else cache.set(evento.id, evento.valor);
  }
}

const fila=new FilaV2Probe();
const antes={ descricao:'A', atualizado_em:'1' };
const soTecnico={ descricao:'A', atualizado_em:'2' };
const real={ descricao:'B', atualizado_em:'2' };
assert.equal(fila.alterar(1,null,antes).evento,true, 'inclusão gera evento');
assert.equal(fila.alterar(1,antes,antes).evento,false, 'reprocessamento igual não gera evento');
assert.equal(fila.alterar(1,{ descricao:'A' },{ descricao:'A' }).evento,false, 'alteração sem negócio não gera evento');
assert.equal(fila.alterar(1,antes,soTecnico).evento,false, 'alteração exclusivamente técnica não gera evento');
assert.equal(fila.alterar(1,{ descricao:'A' },{ descricao:'B' }).evento,true, 'alteração real gera evento');
fila.alterar(1,real,null); // exclusão
fila.publicar();

const cacheA=new Map(), cacheB=new Map();
const a=fila.registrar('cache-a','sessao-a');
const b=fila.registrar('cache-b','sessao-b');
assert.equal(a,0); assert.equal(b,0);
const eventosA=fila.eventosDepois('cache-a'); aplicar(cacheA,eventosA);
// Falha após aplicar e antes do checkpoint: a repetição é idempotente.
aplicar(cacheA,fila.eventosDepois('cache-a'));
fila.confirmar('cache-a','sessao-a',eventosA.at(-1).consumo);
aplicar(cacheB,fila.eventosDepois('cache-b'));
fila.confirmar('cache-b','sessao-b',fila.eventosDepois('cache-b').at(-1).consumo);
assert.equal(cacheA.has(1),false); assert.equal(cacheB.has(1),false, 'exclusão chega aos consumidores independentes');

assert.throws(() => fila.registrar('cache-a','outra-sessao'), /LEASE_OCUPADO/, 'duas instâncias do mesmo consumidor não disputam checkpoint');

// Corrida da carga-base: uma alteração é confirmada depois que o consumidor
// leu seu lote, mas antes de confirmar o checkpoint. O checkpoint deve cobrir
// somente o lote aplicado; a alteração concorrente fica para o ciclo seguinte.
const corridaCarga=new FilaV2Probe();
corridaCarga.alterar(20,null,{ descricao:'fotografia' });
corridaCarga.publicar();
corridaCarga.registrar('cache-carga','sessao-carga');
const cacheCarga=new Map();
const loteLido=corridaCarga.eventosDepois('cache-carga');
aplicar(cacheCarga,loteLido);
const maiorAplicada=loteLido.at(-1).consumo;
corridaCarga.alterar(21,null,{ descricao:'durante confirmação' });
corridaCarga.publicar();
corridaCarga.confirmar('cache-carga','sessao-carga',maiorAplicada);
assert.equal(corridaCarga.checkpoints.get('cache-carga'),maiorAplicada, 'checkpoint não avança até a cabeça ainda não aplicada da fila');
const proximoLote=corridaCarga.eventosDepois('cache-carga');
assert.deepEqual(proximoLote.map((evento) => evento.id),[21], 'alteração concorrente permanece pendente');
aplicar(cacheCarga,proximoLote);
corridaCarga.confirmar('cache-carga','sessao-carga',proximoLote.at(-1).consumo);
assert.equal(cacheCarga.get(21).descricao,'durante confirmação', 'alteração concorrente é aplicada no ciclo seguinte');

// Reserva técnica 1 fica pendente; a 2 confirma primeiro. A fila v2 entrega
// 2 como consumo 1 e, depois da confirmação da 1, entrega-a como consumo 2.
const concorrente=new FilaV2Probe();
concorrente.proximoTecnico=1;
const txLonga={ tecnico:concorrente.proximoTecnico++, id:10, operacao:'INSERT', valor:'lenta' };
concorrente.alterar(11,null,'rápida'); concorrente.publicar();
concorrente.origem.push(txLonga); concorrente.publicar();
assert.deepEqual(concorrente.publicados.map((x) => [x.tecnico,x.consumo]), [[2,1],[1,2]], 'commit invertido não cria buraco de consumo');

const inicio=performance.now(); const medicao=new FilaV2Probe();
for (let i=0;i<5000;i++) medicao.alterar(i,{ valor:i },{ valor:i });
const semMudanca=medicao.origem.length;
for (let i=0;i<5000;i++) medicao.alterar(i,{ valor:i },{ valor:i + 1 });
medicao.publicar();
const duracao=Math.round((performance.now()-inicio)*100)/100;
assert.equal(semMudanca,0, '5 mil reprocessamentos iguais não geram eventos');
assert.equal(medicao.publicados.length,5000, '5 mil alterações reais chegam à fila');

const migration=fs.readFileSync(path.join(__dirname,'../supabase/migrations/20261015_sincronizacao_operacional_v2_homologacao.sql'),'utf8');
const consumidor=fs.readFileSync(path.join(__dirname,'../src/services/operacaoCompartilhada.js'),'utf8');
assert.match(migration, /to_jsonb\(OLD\) - campos_tecnicos/);
assert.match(migration, /to_jsonb\(NEW\) - campos_tecnicos/);
assert.match(consumidor, /sincronizarIncrementalV2/);
assert.match(consumidor, /confirmarCheckpointIncrementalV2/);
assert.match(consumidor, /forcarLegado/);
assert.match(consumidor, /confirmarCheckpointIncrementalV2\(remoto, consumidor, marcoAplicado, true\)/, 'carga-base confirma somente o maior marco aplicado');
assert.doesNotMatch(consumidor, /confirmarCheckpointIncrementalV2\(remoto, consumidor, fim, true\)/, 'carga-base não confirma a cabeça global da fila');
console.log(JSON.stringify({ fluxo:'v2-probe', eventos_sem_mudanca:semMudanca, eventos_reais:medicao.publicados.length, tempo_ms:duracao, consumidores_independentes:2, concorrencia_commit_invertido:'ok', concorrencia_carga_base:'evento permaneceu pendente e foi aplicado no ciclo seguinte', rollback:'evento não confirmado não foi publicado' }));
