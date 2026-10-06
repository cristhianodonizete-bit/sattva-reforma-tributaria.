require('dotenv').config();
const fs=require('fs');
const { Client }=require('pg');

const arquivo=process.argv[2];
const substituir=process.argv.includes('--substituir');
if (!arquivo) throw new Error('Informe o arquivo nomepessoa.txt do Questor.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
const somenteDigitos=(v)=>String(v || '').replace(/\D/g,'');
const linhas=fs.readFileSync(arquivo,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
const separar=(linha)=>String(linha).split(/\t?\|\t?|\t/).map((x)=>String(x).trim());
const cabecalho=separar(linhas.shift()).map((x)=>x.toUpperCase());
const posicao=(nome)=>cabecalho.indexOf(nome);
const codigo=posicao('CODIGOPESSOA')>=0 ? posicao('CODIGOPESSOA') : posicao('CONTACTBFOR');
const nome=posicao('NOMEPESSOA'), inscricao=posicao('INSCRFEDERAL');
if ([codigo,nome,inscricao].some((x)=>x<0)) throw new Error('Esperadas as colunas NOMEPESSOA, INSCRFEDERAL e CODIGOPESSOA ou CONTACTBFOR.');
const pessoas=[];
for (const linha of linhas) {
  const colunas=separar(linha); const chave=String(colunas[codigo] || '').trim();
  if (!chave) continue;
  pessoas.push({ codigo_pessoa:chave, nome:String(colunas[nome] || '').trim(), inscr_federal: somenteDigitos(colunas[inscricao]) || null });
}
const unicas=[...new Map(pessoas.map((x)=>[x.codigo_pessoa,x])).values()];

(async()=>{
  const client=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await client.connect();
  try {
    if (substituir) {
      await client.query('truncate table public.questor_pessoas');
      console.log('Base anterior de pessoas Questor removida para substituição integral.');
    }
    for(let inicio=0; inicio<unicas.length; inicio+=1000) {
      const lote=unicas.slice(inicio,inicio+1000); const valores=[]; const params=[];
      lote.forEach((p,i)=>{const n=i*3; valores.push(`($${n+1},$${n+2},$${n+3},now())`); params.push(p.codigo_pessoa,p.nome,p.inscr_federal);});
      await client.query(`insert into public.questor_pessoas (codigo_pessoa,nome,inscr_federal,atualizado_em) values ${valores.join(',')}
        on conflict (codigo_pessoa) do update set nome=excluded.nome,inscr_federal=excluded.inscr_federal,atualizado_em=excluded.atualizado_em`,params);
      if ((inicio/1000)%25===0) console.log(`Importadas ${Math.min(inicio+lote.length,unicas.length)} de ${unicas.length}`);
    }
    console.log(`Concluído: ${unicas.length} pessoas Questor importadas${substituir ? ' por substituição integral' : ''}.`);
  } finally { await client.end(); }
})().catch((e)=>{console.error(e.stack || e.message);process.exit(1);});
