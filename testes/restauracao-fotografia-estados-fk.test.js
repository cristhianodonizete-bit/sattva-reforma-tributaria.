// Regressão: a restauração da fotografia precisa trazer também os movimentos
// citados apenas pelos estados. Antes, o INSERT de projecoes_movimentos_estado
// falhava com FOREIGN KEY e a Relotec ficava sem fotografia local.
const assert=require('node:assert/strict');
const os=require('os');
const fs=require('fs');
const path=require('path');

if(!process.env.SATTVA_DADOS) process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-restauracao-'));
process.env.SUPABASE_URL=process.env.SUPABASE_URL||'https://fake.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'chave-falsa';

const db=require('../src/db');
const {restaurarFotografiaMotorEmpresa}=require('../src/services/operacaoCompartilhada');

const CNPJ='11222333000181';
const EMPRESA_REMOTA=900;
const EXECUCAO=987654;
const MOVIMENTO_COM_RESULTADO=999001;
const MOVIMENTO_SO_ESTADO=999002;

// Tabelas remotas simuladas. Cada consulta é preguiçosa: filtros e paginação
// só são aplicados quando a consulta é aguardada, como no cliente real.
const tabelas={
  empresas:[{id:EMPRESA_REMOTA,cnpj:CNPJ,origem_local_id:null,razao_social:'Teste'}],
  motor_resultados_operacionais:[{id:1,empresa_id:EMPRESA_REMOTA,movimento_id:MOVIMENTO_COM_RESULTADO,execucao_id:EXECUCAO,ativo:true,dados:{cbs:1}}],
  motor_execucoes_operacionais:[{id:EXECUCAO,empresa_id:EMPRESA_REMOTA,ano:2026,itens:2,classificados:2,requer_validacao:0,sem_correspondencia:0,resumo:null,criado_em:'2026-01-01'}],
  movimentos:[],
  projecoes_movimentos_estado:[
    {empresa_id:EMPRESA_REMOTA,movimento_id:MOVIMENTO_COM_RESULTADO,assinatura_origem:'a',versao_origem:1,assinatura_calculada:'b',versao_calculada:1,situacao:'ok',motivo:null,job_id:null,atualizado_em:'2026-01-01'},
    {empresa_id:EMPRESA_REMOTA,movimento_id:MOVIMENTO_SO_ESTADO,assinatura_origem:'a2',versao_origem:1,assinatura_calculada:'b2',versao_calculada:1,situacao:'ok',motivo:null,job_id:null,atualizado_em:'2026-01-01'},
  ],
};

function consultaSobre(tabela){
  const filtros=[]; let ordem=null; let faixa=null; let limite=null; let cabecalho=false; let contagem=false;
  const aplicar=()=>{
    let linhas=(tabelas[tabela]||[]).filter((linha)=>filtros.every((f)=>f(linha)));
    if(ordem) linhas=[...linhas].sort((a,b)=>(a[ordem.campo]>b[ordem.campo]?1:-1)*(ordem.ascending?1:-1));
    if(faixa) linhas=linhas.slice(faixa[0],faixa[1]+1);
    if(limite!=null) linhas=linhas.slice(0,limite);
    return linhas;
  };
  const consulta={
    select(_colunas,opcoes={}){ if(opcoes.count) contagem=true; if(opcoes.head) cabecalho=true; return consulta; },
    eq(campo,valor){ filtros.push((linha)=>String(linha[campo])===String(valor)); return consulta; },
    in(campo,valores){ filtros.push((linha)=>valores.map(String).includes(String(linha[campo]))); return consulta; },
    gt(campo,valor){ filtros.push((linha)=>Number(linha[campo])>Number(valor)); return consulta; },
    or(texto){
      const condicoes=texto.split(',').map((parte)=>{ const [campo,,valor]=parte.split('.'); return {campo,valor}; });
      filtros.push((linha)=>condicoes.some((c)=>String(linha[c.campo])===String(c.valor)||String(linha[c.campo]).replace(/\D/g,'')===c.valor));
      return consulta;
    },
    order(campo,opcoes={}){ ordem={campo,ascending:opcoes.ascending!==false}; return consulta; },
    limit(n){ limite=n; return consulta; },
    range(de,ate){ faixa=[de,ate]; return consulta; },
    then(resolver,rejeitar){
      try {
        const linhas=aplicar();
        const resultado=cabecalho ? {data:null,error:null,count:linhas.length} : {data:linhas,error:null,count:contagem?linhas.length:null};
        return Promise.resolve(resultado).then(resolver,rejeitar);
      } catch(erro){ return Promise.reject(erro).then(resolver,rejeitar); }
    },
  };
  return consulta;
}
const remoto={ from:(tabela)=>consultaSobre(tabela) };

(async()=>{
  // Empresa local e movimento local que já existe; o movimento de estado não existe localmente.
  const empresaLocal=db.prepare('INSERT INTO empresas (cnpj,razao_social) VALUES (?,?)').run(CNPJ,'Teste Fotografia').lastInsertRowid;
  tabelas.empresas[0].origem_local_id=Number(empresaLocal);
  const movimentoBase={empresa_id:Number(empresaLocal),tipo:'cliente',nome:'Cliente',valor:1,base_calculo:1,sentido:'saida'};
  db.prepare('INSERT INTO movimentos (id,empresa_id,tipo,nome,valor,base_calculo,sentido) VALUES (?,?,?,?,?,?,?)')
    .run(MOVIMENTO_COM_RESULTADO,Number(empresaLocal),movimentoBase.tipo,movimentoBase.nome,1,1,'saida');
  // Movimentos remotos seguem o formato da fonte; o de estado existe só na fonte.
  tabelas.movimentos.push(
    {id:MOVIMENTO_COM_RESULTADO,empresa_id:EMPRESA_REMOTA,tipo:'cliente',nome:'Cliente',valor:1,base_calculo:1,sentido:'saida'},
    {id:MOVIMENTO_SO_ESTADO,empresa_id:EMPRESA_REMOTA,tipo:'cliente',nome:'Cliente 2',valor:2,base_calculo:2,sentido:'saida'},
  );

  const resultado=await restaurarFotografiaMotorEmpresa(Number(empresaLocal),remoto);
  assert.equal(resultado.ativo,true);
  assert.equal(resultado.resultados,1);
  const estados=db.prepare('SELECT COUNT(*) quantidade FROM projecoes_movimentos_estado WHERE empresa_id=?').get(Number(empresaLocal)).quantidade;
  assert.equal(estados,2,'todos os estados da fotografia devem ser gravados');
  const movimentoRestaurado=db.prepare('SELECT id FROM movimentos WHERE id=? AND empresa_id=?').get(MOVIMENTO_SO_ESTADO,Number(empresaLocal));
  assert.ok(movimentoRestaurado,'o movimento citado só pelo estado deve ser restaurado');
  const fotografia=db.prepare('SELECT quantidade_resultados,quantidade_estados FROM fotografia_oficial WHERE empresa_id=?').get(Number(empresaLocal));
  assert.deepEqual({...fotografia},{quantidade_resultados:1,quantidade_estados:2});
  // Execução inconsistente na fonte: a restauração precisa falhar sem tocar o
  // cache local, inclusive nos movimentos que estariam faltando.
  const EXECUCAO_2=987655;
  const MOVIMENTO_SO_ESTADO_2=999003;
  tabelas.motor_resultados_operacionais.push({id:2,empresa_id:EMPRESA_REMOTA,movimento_id:MOVIMENTO_COM_RESULTADO,execucao_id:EXECUCAO_2,ativo:true,dados:{cbs:2}});
  tabelas.projecoes_movimentos_estado.push({empresa_id:EMPRESA_REMOTA,movimento_id:MOVIMENTO_SO_ESTADO_2,assinatura_origem:'a3',versao_origem:1,assinatura_calculada:'b3',versao_calculada:1,situacao:'ok',motivo:null,job_id:null,atualizado_em:'2026-01-01'});
  tabelas.movimentos.push({id:MOVIMENTO_SO_ESTADO_2,empresa_id:EMPRESA_REMOTA,tipo:'cliente',nome:'Cliente 3',valor:3,base_calculo:3,sentido:'saida'});
  await assert.rejects(restaurarFotografiaMotorEmpresa(Number(empresaLocal),remoto),/mais de uma execução/);
  const gravadoIndevido=db.prepare('SELECT id FROM movimentos WHERE id=?').get(MOVIMENTO_SO_ESTADO_2);
  assert.equal(gravadoIndevido,undefined,'falha de execução não pode gravar movimentos locais');
  console.log('restauracao-fotografia-estados-fk: movimentos dos estados restaurados, FK preservada e falha sem escrita: OK');
})().catch((erro)=>{ console.error(erro); process.exitCode=1; });
