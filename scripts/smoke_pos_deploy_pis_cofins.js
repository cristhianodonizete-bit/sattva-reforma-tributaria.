// Smoke seguro: não escreve e recusa banco remoto sem identificação explícita de DEV.
const fs=require('fs'),path=require('path'),os=require('os');
if(!process.env.SATTVA_DADOS)process.env.SATTVA_DADOS=fs.mkdtempSync(path.join(os.tmpdir(),'sattva-smoke-'));
const {aplicarPercentual,arredondarMoeda}=require('../src/services/percentual');
const esperado=[[0,0],[.065,6.5],[.165,16.5],[.30,30],[.76,76],[1.65,165],[7.6,760]];
for(const [p,v] of esperado)if(arredondarMoeda(aplicarPercentual(10000,p))!==v)throw Error(`Percentual inválido: ${p}`);
const regras=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../outputs/condicionais_370_modeladas.json')));
if(regras.some(r=>r.status!=='RASCUNHO'))throw Error('Há rascunho com status inseguro.');
const motor=require('../src/services/motorCondicionalPisCofins');const regra={regra_id:'SMOKE',prioridade:1,vigencia_inicio:'2026-04-01',vigencia_fim:'2099-12-31',regime_pis_cofins:'CUMULATIVO',condicoes:[{fato:'defensivo_agropecuario',operador:'VERDADEIRO'}],resultado:{cst_pis:'06',pis:0.065,cofins:0.30}};
if(motor.selecionar([regra],{data_operacao:'2026-09-05',regime_pis_cofins:'CUMULATIVO',fatos_documento:{defensivo_agropecuario:true}}).status!=='APLICAVEL')throw Error('TRUE falhou');if(motor.selecionar([regra],{data_operacao:'2026-09-05',regime_pis_cofins:'CUMULATIVO',fatos_documento:{defensivo_agropecuario:false}}).status!=='NAO_APLICAVEL')throw Error('FALSE/fallback falhou');if(motor.selecionar([regra],{data_operacao:'2026-09-05',regime_pis_cofins:'CUMULATIVO'}).status!=='INDETERMINADA')throw Error('NULL seguro falhou');
console.log(JSON.stringify({smoke_local:'PASSOU',regras:regras.length,cobre:['geral','condicional TRUE/FALSE/NULL','cumulativo','CST06 não-zero','vigência','valor','fallback'],remoto:'NAO_EXECUTADO'},null,2));
