// Read-only preflight. Production mode has strict identity requirements.
const fs=require('fs'),path=require('path');const raiz=path.resolve(__dirname,'..');
const migrations=['20260918_percentuais_pontos_percentuais_pis_cofins.sql','20260919_regime_pis_cofins_regras_enquadramento.sql','20260920_fatos_assistivos_cadastro_fiscal.sql'];
const resumo=JSON.parse(fs.readFileSync(path.join(raiz,'outputs','catalogo_fiscal_mestre_pis_cofins_resumo.json')));
if(migrations.some(n=>!fs.existsSync(path.join(raiz,'supabase','migrations',n)))||resumo.total_chaves_mestre!==3680||resumo.percentuais_suspeitos)throw Error('Preflight local reprovado.');
const producao=process.argv.includes('--production');
if(producao){const arquivo=path.join(raiz,'.env'),env=fs.existsSync(arquivo)?fs.readFileSync(arquivo,'utf8'):'';const appEnv=(env.match(/^APP_ENV=(.+)$/m)||[])[1],url=(env.match(/^SUPABASE_URL=(.+)$/m)||[])[1],conexao=/^(DATABASE_URL|POSTGRES_URL)=/m.test(env);if(appEnv!=='production'||!url||!conexao)throw Error('GATE_IDENTIDADE_REPROVADO: APP_ENV=production, SUPABASE_URL e conexão PostgreSQL são obrigatórios.');}
console.log(JSON.stringify({preflight:producao?'APROVADO_PRODUCAO':'APROVADO_LOCALMENTE',migrations_necessarias:migrations,escrita:false,postgres_dev_homologado:'NAO'},null,2));
