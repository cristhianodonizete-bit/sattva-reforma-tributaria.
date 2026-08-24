/* Carrega as abas da matriz LC 214 para a fonte compartilhada. */
require('dotenv').config();
const xlsx = require('xlsx');
const { Pool } = require('pg');
const arquivo = process.argv[2];
if (!arquivo) throw new Error('Informe o arquivo XLSX.');
const livro = xlsx.readFile(arquivo);
const linhas = [];
const texto = (v) => String(v ?? '').trim();
for (const [indice, r] of xlsx.utils.sheet_to_json(livro.Sheets.Servicos_LC116, { defval: '' }).entries()) linhas.push({
  tipo: 'servico', chave: `${texto(r['Item LC 116'])}|${texto(r.NBS)}`, lc116: texto(r['Item LC 116']), nbs: texto(r.NBS), origem_linha: `Servicos_LC116:${indice + 2}`,
  descricao: texto(r['Descrição NBS / hipótese']), tratamento: texto(r['Tratamento IBS/CBS']), cst: texto(r.CST), cclasstrib: texto(r.cClassTrib), indop: texto(r.IndOp), reducao: 60, aliquota_zero: false, ente_elegivel: texto(r['Para qual ente']), condicoes: texto(r.Observação), fundamento: texto(r.Fundamento), fonte: 'tabela_governo_lc116_ncm_ibscbs.xlsx' });
for (const [indice, r] of xlsx.utils.sheet_to_json(livro.Sheets.Produtos_NCM, { defval: '' }).entries()) linhas.push({
  tipo: 'produto', chave: texto(r['NCM/SH']).replace(/\D/g, ''), ncm: texto(r['NCM/SH']).replace(/\D/g, ''), origem_linha: `Produtos_NCM:${indice + 2}`, descricao: texto(r.Descrição), tratamento: texto(r['Tratamento quando ente elegível']), cst: texto(r.CST), cclasstrib: texto(r['cClassTrib governo']), reducao: 100, aliquota_zero: /zero/i.test(texto(r['Tratamento quando ente elegível'])), ente_elegivel: texto(r['Para qual ente']), condicoes: texto(r.Condições), fundamento: texto(r['Fundamento LC 214']), fonte: 'tabela_governo_lc116_ncm_ibscbs.xlsx' });
for (const [indice, r] of xlsx.utils.sheet_to_json(livro.Sheets.Regras_Gerais, { defval: '' }).entries()) linhas.push({ tipo: 'geral', chave: texto(r.Regra), origem_linha: `Regras_Gerais:${indice + 2}`, descricao: texto(r.Escopo), tratamento: texto(r.Efeito), condicoes: texto(r.Observação), fundamento: texto(r.Fundamento), vigencia: texto(r['Vigência/Marco']), fonte: 'tabela_governo_lc116_ncm_ibscbs.xlsx' });
const p = new Pool({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await p.query('alter table public.regras_governo add column if not exists origem_linha text');
  await p.query('alter table public.regras_governo drop constraint if exists regras_governo_tipo_chave_cclasstrib_key');
  await p.query('create unique index if not exists regras_governo_fonte_origem_linha_key on public.regras_governo (fonte, origem_linha)');
  await p.query("delete from public.regras_governo where fonte = 'tabela_governo_lc116_ncm_ibscbs.xlsx'");
  for (let i=0;i<linhas.length;i+=250) { const a=linhas.slice(i,i+250); const cols=['tipo','chave','lc116','nbs','ncm','descricao','tratamento','cst','cclasstrib','indop','reducao','aliquota_zero','ente_elegivel','condicoes','fundamento','vigencia','fonte','origem_linha']; const v=[]; const ph=a.map((x,j)=>`(${cols.map((_,k)=>'$'+(j*cols.length+k+1)).join(',')})`).join(','); a.forEach(x=>cols.forEach(c=>v.push(x[c]??null))); await p.query(`insert into public.regras_governo (${cols.join(',')}) values ${ph}`,v); }
  console.log(JSON.stringify({ importados: linhas.length })); await p.end();
})().catch(async e=>{console.error(e.message);await p.end();process.exitCode=1});
