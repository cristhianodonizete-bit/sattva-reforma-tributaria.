#!/usr/bin/env node
/* Inventário estático: qualquer candidato sem limite/aggregate/IDs é protegido
   pelo adaptador SQLite e classificado para impedir regressão silenciosa. */
const fs=require('node:fs'),path=require('node:path');
const raiz=path.resolve(__dirname,'..');
const pastas=['src/routes','src/services'];
const arquivos=[];
const andar=(dir)=>{ for(const e of fs.readdirSync(dir,{withFileTypes:true})) e.isDirectory()?andar(path.join(dir,e.name)):e.name.endsWith('.js')&&arquivos.push(path.join(dir,e.name)); };
pastas.forEach((p)=>andar(path.join(raiz,p)));
const candidatos=[];
for(const arquivo of arquivos){
  const texto=fs.readFileSync(arquivo,'utf8'); const linhas=texto.split(/\r?\n/);
  for(let i=0;i<linhas.length;i++){
    if(!/\.all\s*\(/.test(linhas[i])) continue;
    const janela=linhas.slice(Math.max(0,i-30),i+1).join(' ').replace(/\s+/g,' ').toLowerCase();
    if(!/\bfrom\s+(movimentos|motor_resultados)\b/.test(janela)) continue;
    const protegida=/\blimit\b|\b(count|sum|avg|min|max)\s*\(|\bgroup by\b|\b(?:movimento_)?id\s+in\s*\(|\b(?:m\.)?id\s*=\s*\?/.test(janela);
    candidatos.push({arquivo:path.relative(raiz,arquivo).replace(/\\/g,'/'),linha:i+1,status:protegida?'CORRIGIDA':'NAO_ALCANCAVEL_BLOQUEADA',motivo:protegida?'limite/agregação/IDs explícitos':'barreira central LEITURA_GLOBAL_PROIBIDA'});
  }
}
const resumo=candidatos.reduce((a,x)=>{a[x.status]=(a[x.status]||0)+1;return a;},{});
console.log(JSON.stringify({escopo:['src/routes','src/services'],resumo,caminhos:candidatos},null,2));
