/* Carrega as abas da matriz LC 214 para a fonte compartilhada. */
require('dotenv').config();
const xlsx = require('xlsx');
const { Pool } = require('pg');
const arquivo = process.argv[2];
if (!arquivo) throw new Error('Informe o arquivo XLSX.');
const livro = xlsx.readFile(arquivo);
const linhas = [];
const texto = (v) => String(v ?? '').trim();
for (const r of xlsx.utils.sheet_to_json(livro.Sheets.Servicos_LC116, { defval: '' })) linhas.push({
  tipo: 'servico', chave: `${texto(r['Item LC 116'])}|${texto(r.NBS)}`, lc116: texto(r['Item LC 116']), nbs: texto(r.NBS),
  descricao: texto(r['Descrição NBS / hipótese']), tratamento: texto(r['Tratamento IBS/CBS']), cst: texto(r.CST), cclasstrib: texto(r.cClassTrib), indop: texto(r.IndOp), reducao: 60, aliquota_zero: false, ente_elegivel: texto(r['Para qual ente']), condicoes: texto(r.Observação), fundamento: texto(r.Fundamento), fonte: 'tabela_governo_lc116_ncm_ibscbs.xlsx' });
for (const r of xlsx.utils.sheet_to_json(livro.Sheets.Produtos_NCM, { defval: '' })) linhas.push({
  tipo: 'produto', chave: texto(r['NCM/SH']).replace(/\D/g, ''), ncm: texto(r['NCM/SH']).replace(/\D/g, ''), descricao: texto(r.Descrição), tratamento: texto(r['Tratamento quando ente elegível']), cst: texto(r.CST), cclasstrib: texto(r['cClassTrib governo']), reducao: 100, aliquota_zero: /zero/i.test(texto(r['Tratamento quando ente elegível'])), ente_elegivel: texto(r['Para qual ente']), condicoes: texto(r.Condições), fundamento: texto(r['Fundamento LC 214']), fonte: 'tabela_governo_lc116_ncm_ibscbs.xlsx' });
for (const r of xlsx.utils.sheet_to_json(livro.Sheets.Regras_Gerais, { defval: '' })) linhas.push({ tipo: 'geral', chave: texto(r.Regra), descricao: texto(r.Escopo), tratamento: texto(r.Efeito), condicoes: texto(r.Observação), fundamento: texto(r.Fundamento), vigencia: texto(r['Vigência/Marco']), fonte: 'tabela_governo_lc116_ncm_ibscbs.xlsx' });
const p = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
const unicas = [...new Map(linhas.map((x) => [`${x.tipo}|${x.chave}|${x.cclasstrib || ''}`, x])).values()];
(async () => { for (let i=0;i<unicas.length;i+=250) { const a=unicas.slice(i,i+250); const cols=['tipo','chave','lc116','nbs','ncm','descricao','tratamento','cst','cclasstrib','indop','reducao','aliquota_zero','ente_elegivel','condicoes','fundamento','vigencia','fonte']; const v=[]; const ph=a.map((x,j)=>`(${cols.map((_,k)=>'$'+(j*cols.length+k+1)).join(',')})`).join(','); a.forEach(x=>cols.forEach(c=>v.push(x[c]??null))); await p.query(`insert into public.regras_governo (${cols.join(',')}) values ${ph} on conflict(tipo,chave,cclasstrib) do update set descricao=excluded.descricao,tratamento=excluded.tratamento,cst=excluded.cst,condicoes=excluded.condicoes,fundamento=excluded.fundamento`,v); } console.log(JSON.stringify({importados:unicas.length})); await p.end(); })().catch(async e=>{console.error(e.message);await p.end();process.exitCode=1});
