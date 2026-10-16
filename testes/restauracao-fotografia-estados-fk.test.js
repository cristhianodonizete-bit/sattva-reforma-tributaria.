// Regressão: a restauração da fotografia é somente leitura dos fatos. Um
// estado que referencia movimento ausente deve falhar sem criar movimento,
// pendência ou resultado local; a hidratação da carteira é outro fluxo.
const assert=require('node:assert/strict');
const os=require('os');
const fs=require('fs');
const path=require('path');

if(!process.env.SATTVA_DADOS) process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-restauracao-'));
process.env.SUPABASE_URL=process.env.SUPABASE_URL||'https://fake.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'chave-falsa';
// A fonte é simulada neste teste; habilitar somente o adaptador local evita
// que a flag global da suíte esconda o caminho de restauração testado.
process.env.SUPABASE_OPERACAO_COMPARTILHADA='true';

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
  // O movimento de estado existe apenas na fonte canônica.
  tabelas.movimentos.push(
    {id:MOVIMENTO_COM_RESULTADO,empresa_id:EMPRESA_REMOTA,tipo:'cliente',nome:'Cliente',valor:1,base_calculo:1,sentido:'saida'},
    {id:MOVIMENTO_SO_ESTADO,empresa_id:EMPRESA_REMOTA,tipo:'cliente',nome:'Cliente 2',valor:2,base_calculo:2,sentido:'saida'},
  );

  const pendenciasAntes=db.prepare('SELECT COUNT(*) quantidade FROM motor_pendencias WHERE empresa_id=?').get(Number(empresaLocal)).quantidade;
  await assert.rejects(restaurarFotografiaMotorEmpresa(Number(empresaLocal),remoto),/movimento\(s\) ausente/);
  const movimentoIndevido=db.prepare('SELECT id FROM movimentos WHERE id=? AND empresa_id=?').get(MOVIMENTO_SO_ESTADO,Number(empresaLocal));
  assert.equal(movimentoIndevido,undefined,'restauração não pode criar fato fiscal ausente');
  const resultados=db.prepare('SELECT COUNT(*) quantidade FROM motor_resultados WHERE empresa_id=?').get(Number(empresaLocal)).quantidade;
  const pendencias=db.prepare('SELECT COUNT(*) quantidade FROM motor_pendencias WHERE empresa_id=?').get(Number(empresaLocal)).quantidade;
  assert.equal(resultados,0,'falha de restauração não pode publicar resultado parcial');
  assert.equal(pendencias,pendenciasAntes,'restauração não pode criar pendência');
  console.log('restauracao-fotografia-estados-fk: fotografia sem escrita de fatos, resultados ou pendências: OK');
})().catch((erro)=>{ console.error(erro); process.exitCode=1; });
