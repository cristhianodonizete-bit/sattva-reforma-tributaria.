const dbPadrao = require('../db');
const periodoAnalisado = require('./periodoAnalisado');
const supabase = require('./supabase');

const TIPOS = new Set(['DOCUMENTOS_SEM_MOVIMENTO', 'OUTRAS_RECEITAS_NAO_APLICAVEL', 'FOLHA_SEM_MOVIMENTO', 'APURACAO_HISTORICO_NAO_APLICAVEL', 'MARGEM_NAO_APLICAVEL']);
const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;
const ANO = /^\d{4}$/;
const esperado = (inicio, fim) => { const r=[]; for (let c=inicio;c<=fim;) { r.push(c); const [a,m]=c.split('-').map(Number); c=`${m===12?a+1:a}-${String(m===12?1:m+1).padStart(2,'0')}`; } return r; };
const unicos = (linhas) => [...new Set(linhas.map((x) => String(x.competencia || '')).filter((x) => COMPETENCIA.test(x)))];

function declaracoes(empresaId, tipo, banco) { return new Set(banco.prepare('SELECT referencia FROM empresa_prontidao_declaracoes WHERE empresa_id=? AND tipo=?').all(empresaId,tipo).map((x)=>x.referencia)); }
function etapa(id, titulo, pendencias, extras = {}) { return { id, titulo, status:pendencias.length ? 'VERMELHO' : 'VERDE', pendencias, ...extras }; }

function obter(empresaId, { banco=dbPadrao } = {}) {
  const empresa = banco.prepare("SELECT e.id,e.regime,COALESCE(NULLIF(e.cnae,''),c.cnae) cnae,e.cnaes_secundarios FROM empresas e LEFT JOIN cnpj_cache c ON c.cnpj=e.cnpj WHERE e.id=?").get(Number(empresaId));
  if (!empresa) throw new Error('Empresa não encontrada.');
  const periodo = periodoAnalisado.obter(empresaId,{banco});
  if (!periodo) {
    const sem = etapa('periodo','Período analisado',['Defina a competência inicial e final antes de importar dados.']);
    return { periodo:null, etapas:[sem], motor:etapa('motor','Executar motor',['Defina o Período analisado.', 'Complete Documentos fiscais e Outras receitas.']) };
  }
  const competencias = esperado(periodo.competencia_inicio, periodo.competencia_fim);
  const faltam = (encontradas, declaradas) => competencias.filter((c)=>!encontradas.has(c)&&!declaradas.has(c));
  const docs = new Set(unicos(banco.prepare('SELECT DISTINCT competencia FROM movimentos WHERE empresa_id=?').all(empresaId)));
  const docsFaltam = faltam(docs,declaracoes(empresaId,'DOCUMENTOS_SEM_MOVIMENTO',banco));
  const receitas = new Set(unicos(banco.prepare("SELECT DISTINCT competencia FROM receitas_sem_dfe WHERE empresa_id=? AND status_validacao<>'POSSIVEL_DUPLICIDADE'").all(empresaId)));
  const receitasFaltam = faltam(receitas,declaracoes(empresaId,'OUTRAS_RECEITAS_NAO_APLICAVEL',banco));
  const folhas = new Set(unicos(banco.prepare('SELECT DISTINCT competencia FROM folhas_pagamento_competencias WHERE empresa_id=?').all(empresaId)));
  const folhaFaltam = faltam(folhas,declaracoes(empresaId,'FOLHA_SEM_MOVIMENTO',banco));
  const margem = banco.prepare('SELECT id FROM margens_operacionais_premissas WHERE empresa_id=? AND periodo_inicio<=? AND periodo_fim>=? LIMIT 1').get(empresaId,periodo.competencia_inicio,periodo.competencia_fim);
  const margemDeclarada = declaracoes(empresaId,'MARGEM_NAO_APLICAVEL',banco).has('PERIODO_ANALISADO');
  const anoFinal = Number(periodo.competencia_fim.slice(0,4)); const anos=[anoFinal,anoFinal-1,anoFinal-2];
  const simples = empresa.regime === 'simples_nacional';
  const linhasApuracao = simples
    ? banco.prepare('SELECT competencia FROM perfil_tributario WHERE empresa_id=? AND COALESCE(das,0)>0').all(empresaId)
    : banco.prepare("SELECT competencia FROM pis_cofins_apuracoes_historicas WHERE empresa_id=? AND status_validacao='VALIDADO_USUARIO'").all(empresaId);
  const apuracoes = new Set(unicos(linhasApuracao)); const declaradosAnos=declaracoes(empresaId,'APURACAO_HISTORICO_NAO_APLICAVEL',banco);
  const apuracaoFaltas=[];
  anos.forEach((ano) => { const meses=Array.from({length:12},(_,i)=>`${ano}-${String(i+1).padStart(2,'0')}`); if (!declaradosAnos.has(String(ano))) meses.filter((c)=>!apuracoes.has(c)).forEach((c)=>apuracaoFaltas.push(c)); });
  const socios = banco.prepare('SELECT percentual_participacao,brasileiro FROM empresa_qsa WHERE empresa_id=?').all(empresaId);
  const percentual = socios.reduce((s,x)=>s+(Number(x.percentual_participacao)||0),0);
  const pendCadastro=[]; if (!String(empresa.cnae||'').trim()) pendCadastro.push('Informe o CNAE principal.'); if (!socios.length) pendCadastro.push('Preencha o quadro societário.'); if (socios.some((x)=>x.percentual_participacao===null || x.percentual_participacao==='')) pendCadastro.push('Informe a participação de cada sócio.'); if (socios.some((x)=>!([0,1].includes(Number(x.brasileiro))))) pendCadastro.push('Marque brasileiro ou estrangeiro para cada sócio.'); if (socios.length && Math.abs(percentual-100)>0.01) pendCadastro.push(`O quadro societário totaliza ${percentual.toFixed(2)}%; ele deve totalizar 100%.`);
  const etapas=[
    etapa('periodo','Período analisado',[] ,{ periodo,competencias }),
    etapa('documentos','Documentos fiscais',docsFaltam.map((c)=>`Sem documento fiscal ou declaração de ausência em ${c}.`),{ competencias, cobertas:[...docs], declaracao_tipo:'DOCUMENTOS_SEM_MOVIMENTO' }),
    etapa('folha','Folha',folhaFaltam.map((c)=>`Sem folha/pró-labore ou declaração em ${c}.`),{ competencias, cobertas:[...folhas], declaracao_tipo:'FOLHA_SEM_MOVIMENTO' }),
    etapa('receitas','Outras receitas',receitasFaltam.map((c)=>`Sem receita complementar ou declaração “não se aplica” em ${c}.`),{ competencias, cobertas:[...receitas], declaracao_tipo:'OUTRAS_RECEITAS_NAO_APLICAVEL' }),
    etapa('apuracoes','Apurações',apuracaoFaltas.map((c)=>`Apuração de ${simples?'PGDAS':'PIS/Cofins'} ausente em ${c}.`),{ anos, regime:empresa.regime, declaracao_tipo:'APURACAO_HISTORICO_NAO_APLICAVEL' }),
    etapa('margem','Margem operacional',margem||margemDeclarada?[]:['Informe a margem operacional ou registre que não se aplica.'],{ declaracao_tipo:'MARGEM_NAO_APLICAVEL' }),
    etapa('empresa','Empresas e estabelecimentos',pendCadastro),
  ];
  const documentos=etapas.find((x)=>x.id==='documentos'); const outras=etapas.find((x)=>x.id==='receitas');
  return { periodo, etapas, motor:etapa('motor','Executar motor',[...(documentos.status==='VERMELHO'?['Complete Documentos fiscais.']:[]),...(outras.status==='VERMELHO'?['Complete Outras receitas.']:[])],{ liberado:documentos.status==='VERDE'&&outras.status==='VERDE' }) };
}

function declarar(empresaId, dados, usuarioId=null, { banco=dbPadrao } = {}) {
  const tipo=String(dados.tipo||''); const referencia=String(dados.referencia||'').trim(); const motivo=String(dados.motivo||'').trim();
  if (!TIPOS.has(tipo)) throw new Error('Tipo de declaração inválido.');
  if (!motivo) throw new Error('Informe o motivo da declaração.');
  if ((tipo==='APURACAO_HISTORICO_NAO_APLICAVEL' && !ANO.test(referencia)) || (tipo!=='APURACAO_HISTORICO_NAO_APLICAVEL' && tipo!=='MARGEM_NAO_APLICAVEL' && !COMPETENCIA.test(referencia)) || (tipo==='MARGEM_NAO_APLICAVEL' && referencia!=='PERIODO_ANALISADO')) throw new Error('Referência da declaração inválida.');
  banco.prepare(`INSERT INTO empresa_prontidao_declaracoes (empresa_id,tipo,referencia,motivo,justificativa,usuario_id) VALUES (?,?,?,?,?,?) ON CONFLICT(empresa_id,tipo,referencia) DO UPDATE SET motivo=excluded.motivo,justificativa=excluded.justificativa,usuario_id=excluded.usuario_id,criado_em=datetime('now','localtime')`).run(empresaId,tipo,referencia,motivo,String(dados.justificativa||''),usuarioId||null);
  return obter(empresaId,{banco});
}

async function empresaRemota(empresaId, banco) {
  const local=banco.prepare('SELECT cnpj FROM empresas WHERE id=?').get(Number(empresaId));
  if (!local || !supabase.configurado()) return null;
  const cnpj=String(local.cnpj||'').replace(/\D/g,'');
  const filtro=cnpj ? `origem_local_id.eq.${Number(empresaId)},cnpj.eq.${cnpj}` : `origem_local_id.eq.${Number(empresaId)}`;
  const {data,error}=await supabase.admin().from('empresas').select('id').or(filtro).limit(2);
  if(error) throw new Error(`Não foi possível localizar a empresa compartilhada: ${error.message}`);
  if((data||[]).length>1) throw new Error('Foram encontradas duas identidades compartilhadas para a empresa. Nenhuma declaração foi alterada.');
  return data?.[0]||null;
}

async function sincronizarCompartilhado(empresaId,{banco=dbPadrao}={}) {
  if(!supabase.configurado()) return;
  const empresa=await empresaRemota(empresaId,banco); if(!empresa) return;
  const {data,error}=await supabase.admin().from('empresa_prontidao_declaracoes').select('*').eq('empresa_id',empresa.id);
  if(error) throw new Error(`Não foi possível ler as declarações compartilhadas: ${error.message}`);
  const inserir=banco.prepare(`INSERT INTO empresa_prontidao_declaracoes (empresa_id,tipo,referencia,motivo,justificativa,usuario_id,criado_em)
    VALUES (?,?,?,?,?,?,?) ON CONFLICT(empresa_id,tipo,referencia) DO UPDATE SET motivo=excluded.motivo,justificativa=excluded.justificativa,usuario_id=excluded.usuario_id,criado_em=excluded.criado_em`);
  banco.transaction(()=>{ for(const item of data||[]) inserir.run(Number(empresaId),item.tipo,item.referencia,item.motivo,item.justificativa||'',item.usuario_id||null,item.criado_em||new Date().toISOString()); })();
}

async function declararCompartilhado(empresaId,dados,usuarioId=null,{banco=dbPadrao}={}) {
  if(!supabase.configurado()) return declarar(empresaId,dados,usuarioId,{banco});
  const tipo=String(dados.tipo||''); const referencia=String(dados.referencia||'').trim(); const motivo=String(dados.motivo||'').trim();
  // Reutiliza toda a validação local em uma base temporária lógica: nenhuma
  // escrita é feita antes de a identidade compartilhada ser confirmada.
  if(!TIPOS.has(tipo) || !motivo) return declarar(empresaId,dados,usuarioId,{banco});
  if((tipo==='APURACAO_HISTORICO_NAO_APLICAVEL'&&!ANO.test(referencia)) || (tipo!=='APURACAO_HISTORICO_NAO_APLICAVEL'&&tipo!=='MARGEM_NAO_APLICAVEL'&&!COMPETENCIA.test(referencia)) || (tipo==='MARGEM_NAO_APLICAVEL'&&referencia!=='PERIODO_ANALISADO')) return declarar(empresaId,dados,usuarioId,{banco});
  const empresa=await empresaRemota(empresaId,banco);
  if(!empresa) throw new Error('Empresa ainda não está disponível na base compartilhada. A declaração não foi gravada para evitar perda de sincronização.');
  const registro={empresa_id:empresa.id,tipo,referencia,motivo,justificativa:String(dados.justificativa||''),usuario_id:usuarioId||null};
  const {error}=await supabase.admin().from('empresa_prontidao_declaracoes').upsert(registro,{onConflict:'empresa_id,tipo,referencia'});
  if(error) throw new Error(`Não foi possível gravar a declaração compartilhada: ${error.message}`);
  return declarar(empresaId,dados,usuarioId,{banco});
}
module.exports={ obter,declarar,sincronizarCompartilhado,declararCompartilhado };
