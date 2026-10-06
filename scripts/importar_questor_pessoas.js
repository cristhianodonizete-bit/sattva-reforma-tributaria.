require('dotenv').config();
const fs=require('fs');
const { Client }=require('pg');

const arquivo=process.argv[2];
if (!arquivo) throw new Error('Informe o arquivo nomepessoa.txt do Questor.');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');
const somenteDigitos=(v)=>String(v || '').replace(/\D/g,'');
const linhas=fs.readFileSync(arquivo,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
const cabecalho=linhas.shift().split('\t').map((x)=>String(x).trim().toUpperCase());
const posicao=(nome)=>cabecalho.indexOf(nome);
const codigo=posicao('CODIGOPESSOA'), nome=posicao('NOMEPESSOA'), inscricao=posicao('INSCRFEDERAL');
if ([codigo,nome,inscricao].some((x)=>x<0)) throw new Error('Esperadas as colunas CODIGOPESSOA, NOMEPESSOA e INSCRFEDERAL.');
const pessoas=[];
for (const linha of linhas) {
  const colunas=linha.split('\t'); const chave=String(colunas[codigo] || '').trim();
  if (!chave) continue;
  pessoas.push({ codigo_pessoa:chave, nome:String(colunas[nome] || '').trim(), inscr_federal: somenteDigitos(colunas[inscricao]) || null });
}
const unicas=[...new Map(pessoas.map((x)=>[x.codigo_pessoa,x])).values()];

(async()=>{
  const client=new Client({connectionString:process.env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await client.connect();
  try {
    for(let inicio=0; inicio<unicas.length; inicio+=1000) {
      const lote=unicas.slice(inicio,inicio+1000); const valores=[]; const params=[];
      lote.forEach((p,i)=>{const n=i*3; valores.push(`($${n+1},$${n+2},$${n+3},now())`); params.push(p.codigo_pessoa,p.nome,p.inscr_federal);});
      await client.query(`insert into public.questor_pessoas (codigo_pessoa,nome,inscr_federal,atualizado_em) values ${valores.join(',')}
        on conflict (codigo_pessoa) do update set nome=excluded.nome,inscr_federal=excluded.inscr_federal,atualizado_em=excluded.atualizado_em`,params);
      if ((inicio/1000)%25===0) console.log(`Importadas ${Math.min(inicio+lote.length,unicas.length)} de ${unicas.length}`);
    }
    console.log(`Concluído: ${unicas.length} pessoas Questor importadas.`);
  } finally { await client.end(); }
})().catch((e)=>{console.error(e.stack || e.message);process.exit(1);});
