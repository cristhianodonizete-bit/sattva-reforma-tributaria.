const fs=require('fs'),path=require('path');const out=path.resolve(__dirname,'../outputs');
const regras=JSON.parse(fs.readFileSync(path.join(out,'pacote_regras_publicaveis_pis_cofins.json'))),bloqueadas=JSON.parse(fs.readFileSync(path.join(out,'pacote_regras_nao_publicaveis_pis_cofins.json'))),ids=new Set(regras.map(r=>r.id));
if(ids.size!==regras.length||bloqueadas.some(r=>ids.has(r.id))||regras.some(r=>r.status_publicacao!=='RASCUNHO_VALIDO'))throw Error('Pacote inválido; carga abortada.');
if(process.argv.includes('--write')){if(process.env.APP_ENV!=='production'||process.env.CONFIRMAR_CARGA_PIS_COFINS!=='SIM')throw Error('Escrita bloqueada por contrato.');throw Error('Escrita não autorizada nesta rodada: execute após preflight e snapshot.');}
console.log(JSON.stringify({modo:'DRY_RUN',regras_publicaveis:regras.length,regras_obsoletas:bloqueadas.length,escrita_realizada:false},null,2));
