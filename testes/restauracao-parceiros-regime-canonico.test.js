const assert=require('node:assert/strict');
const fs=require('fs');
const os=require('os');
const path=require('path');

process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-parceiro-canonico-'));
process.env.SUPABASE_URL='https://fake.supabase.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='chave-falsa';
process.env.SUPABASE_OPERACAO_COMPARTILHADA='true';

const db=require('../src/db');
const {restaurarParceirosEmpresa}=require('../src/services/operacaoCompartilhada');
const CNPJ_EMPRESA='11222333000181';
const CNPJ_PARCEIRO='25769548000121';

function consulta(linhas) {
  const q={
    select(){ return q; }, or(){ return q; }, eq(){ return q; }, in(){ return q; }, limit(){ return q; },
    then(resolver,rejeitar){ return Promise.resolve({data:linhas,error:null}).then(resolver,rejeitar); },
  };
  return q;
}

(async()=>{
  const empresaId=Number(db.prepare('INSERT INTO empresas(cnpj,razao_social) VALUES (?,?)').run(CNPJ_EMPRESA,'Empresa teste').lastInsertRowid);
  const remoto={ from(tabela) {
    if(tabela==='empresas') return consulta([{id:900,origem_local_id:empresaId,cnpj:CNPJ_EMPRESA}]);
    if(tabela==='parceiros') return consulta([{
      id:700,empresa_id:900,tipo:'fornecedor',cnpj:CNPJ_PARCEIRO,descricao:'Parceiro teste',regime:'simples_nacional',
      regime_origem:'MANUAL_USUARIO',regime_confirmado_em:'2026-01-01T00:00:00Z',ativo:true,
    }]);
    if(tabela==='cadastros_cnpj') return consulta([{cnpj:CNPJ_PARCEIRO,regime_derivado:'regime_regular',fonte:'Base RFB 2024',consultado_em:'2026-10-01T00:00:00Z'}]);
    throw new Error(`Tabela remota inesperada: ${tabela}`);
  }};
  await restaurarParceirosEmpresa(empresaId,remoto);
  const parceiro=db.prepare('SELECT regime,regime_origem,regime_confirmado_em FROM parceiros WHERE empresa_id=? AND cnpj=?').get(empresaId,CNPJ_PARCEIRO);
  assert.equal(parceiro.regime,'regime_regular');
  assert.equal(parceiro.regime_origem,'CADASTRO_COMPARTILHADO:Base RFB 2024');
  assert.equal(parceiro.regime_confirmado_em,'2026-10-01T00:00:00Z');
  console.log('restauracao-parceiros-regime-canonico: parceiro local igual ao cadastro compartilhado: OK');
})().catch((erro)=>{ console.error(erro); process.exitCode=1; });
