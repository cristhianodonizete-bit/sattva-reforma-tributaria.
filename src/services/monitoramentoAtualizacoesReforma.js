const crypto = require('crypto');
const supabase = require('./supabase');

// Lista fechada de fontes públicas e oficiais. Não há URL fornecida pelo
// usuário, redirecionamento para domínio externo ou extração de conteúdo de
// terceiros sem revisão.
const FONTES = [
  {
    chave: 'planalto_ec_132', nome: 'Presidência da República — EC 132/2023', tema: 'CBS_IBS',
    url: 'https://www.planalto.gov.br/ccivil_03/constituicao/emendas/emc/emc132.htm'
  },
  {
    chave: 'planalto_lc_214', nome: 'Presidência da República — LC 214/2025', tema: 'CBS_IBS',
    url: 'https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp214.htm'
  },
  {
    chave: 'cgibs_portal', nome: 'CGIBS — Comitê Gestor do IBS', tema: 'CBS_IBS',
    url: 'https://cgibs.gov.br/inicial'
  },
  {
    chave: 'cgibs_noticias', nome: 'CGIBS — notícias e comunicados', tema: 'CBS_IBS',
    url: 'https://cgibs.gov.br/noticias'
  },
  {
    chave: 'cgibs_guia_orientativo', nome: 'CGIBS — Guia orientativo da Reforma Tributária', tema: 'CBS_IBS',
    url: 'https://www.cgibs.gov.br/guia-de-orientacoes-para-impactos-administrativos-da-reforma-tributaria'
  },
  {
    chave: 'rfb_legislacao_rtc', nome: 'Receita Federal — legislação da Reforma Tributária', tema: 'CBS_IBS',
    url: 'https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/legislacao'
  },
  {
    chave: 'rfb_normas_pis_cofins', nome: 'Receita Federal — normas PIS/Cofins', tema: 'PIS_COFINS',
    url: 'https://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action?termoBusca=pis+cofins'
  },
  {
    chave: 'nfe_cclasstrib', nome: 'Portal NF-e — tabela cClassTrib IBS/CBS', tema: 'DOCUMENTOS_FISCAIS',
    url: 'https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?AspxAutoDetectCookieSupport=1&tipoConteudo=%2FNJarYc9nus%3D'
  },
  {
    chave: 'nfse_rtc', nome: 'Portal NFS-e — documentação técnica RTC', tema: 'DOCUMENTOS_FISCAIS',
    url: 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc'
  }
  ,{
    chave: 'nfse_anexo_viii', nome: 'Portal NFS-e — Anexo VIII (LC 116 × NBS × cIndOp × cClassTrib)', tema: 'DOCUMENTOS_FISCAIS',
    url: 'https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexoviii-correlacaoitemnbsindopcclasstrib_ibscbs_v1-00-00.xlsx/view'
  }
];

const LIMITE_INTERVALO_MS = 20 * 60 * 60 * 1000;
const textoLimpo = (html) => String(html || '')
  .replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ').trim();
const hash = (texto) => crypto.createHash('sha256').update(texto).digest('hex');
const agoraSql = (agora) => agora.toISOString().slice(0, 19).replace('T', ' ');

function trechoRepresentativo(texto, limite = 900) {
  const frases = String(texto || '').match(/[^.!?]+[.!?]+/g) || [];
  const uteis = frases.map((x) => x.trim()).filter((x) => x.length > 45)
    .filter((x) => /reforma|tribut|ibs|cbs|pis|cofins|lei complementar|nota fiscal|class/i.test(x));
  const escolhido = (uteis.length ? uteis : frases.map((x) => x.trim()).filter((x) => x.length > 45)).slice(0, 3).join(' ');
  return (escolhido || String(texto || '').slice(0, limite)).slice(0, limite).trim();
}

async function resumirConteudoOficial(fonte, texto, { chamarIa = null } = {}) {
  const trecho = trechoRepresentativo(texto, 12_000);
  if (!trecho) throw new Error('A fonte oficial não apresentou texto suficiente para resumo.');
  const chamar = chamarIa || (async (...args) => {
    const ia = require('./ia');
    if (!ia.config().ativo) return null;
    return ia.chamar(...args);
  });
  const resposta = await chamar([{ role: 'user', content: `Fonte: ${fonte.nome}\nURL: ${fonte.url}\n\nConteúdo oficial lido:\n${trecho}` }], {
    sistema: 'Você resume exclusivamente conteúdo oficial brasileiro sobre a reforma tributária. Produza 3 a 5 frases objetivas, em português, descrevendo o que a publicação informa e seus temas práticos. Não invente fatos, não conclua efeito tributário, não altere regra alguma e deixe explícito quando o conteúdo for apenas informativo.',
    maxTokens: 500, temperatura: 0, fallback: true,
  });
  const resumo = String(resposta?.texto || '').replace(/\s+/g, ' ').trim();
  return { resumo: resumo || trechoRepresentativo(texto), metodo: resposta ? 'IA_SOBRE_FONTE_OFICIAL' : 'TRECHO_OFICIAL' };
}

async function lerEResumirFonte(url, { fetcher = fetch, chamarIa = null } = {}) {
  const fonte = FONTES.find((item) => item.url === url);
  if (!fonte) throw new Error('A fonte da atualização não pertence ao monitor oficial.');
  if (!fontePermitida(fonte.url)) throw new Error(`Fonte não permitida: ${fonte.url}`);
  const resposta = await fetcher(fonte.url, { headers: { 'user-agent': 'Sattva-Reforma-Monitor/1.0' }, signal: AbortSignal.timeout(20_000) });
  if (!resposta.ok) throw new Error(`Não foi possível ler a fonte oficial (HTTP ${resposta.status}).`);
  const texto = textoLimpo(await resposta.text());
  if (texto.length < 80) throw new Error('Conteúdo oficial insuficiente para gerar resumo.');
  return { fonte, ...(await resumirConteudoOficial(fonte, texto, { chamarIa })) };
}

function fontePermitida(url) {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'planalto.gov.br' || host.endsWith('.planalto.gov.br') || host === 'cgibs.gov.br' || host.endsWith('.gov.br');
}

async function verificarFonte(fonte, { banco, fetcher = fetch, agora = new Date(), forcar = false } = {}) {
  // Carregamento tardio mantém o módulo testável sem abrir o SQLite; na
  // execução normal, continua usando exatamente o banco da aplicação.
  banco ||= require('../db');
  if (!fontePermitida(fonte.url)) throw new Error(`Fonte não permitida: ${fonte.url}`);
  const remoto = supabase.configurado() ? supabase.admin() : null;
  const consultarAnterior = async () => {
    if (!remoto) return banco.prepare('SELECT * FROM monitoramento_atualizacoes_reforma WHERE chave=?').get(fonte.chave);
    const { data, error } = await remoto.from('monitoramento_atualizacoes_reforma').select('*').eq('chave', fonte.chave).maybeSingle();
    if (error) throw new Error(`Estado do monitor: ${error.message}`);
    return data;
  };
  const salvarEstado = async (registro) => {
    if (!remoto) {
      banco.prepare(`INSERT INTO monitoramento_atualizacoes_reforma
        (chave,fonte_nome,fonte_url,ultimo_hash,ultima_consulta_em,ultimo_sucesso_em,ultimo_erro)
        VALUES (?,?,?,?,?,?,?) ON CONFLICT(chave) DO UPDATE SET fonte_nome=excluded.fonte_nome,fonte_url=excluded.fonte_url,ultimo_hash=excluded.ultimo_hash,ultima_consulta_em=excluded.ultima_consulta_em,ultimo_sucesso_em=excluded.ultimo_sucesso_em,ultimo_erro=excluded.ultimo_erro`)
        .run(registro.chave, registro.fonte_nome, registro.fonte_url, registro.ultimo_hash || null, registro.ultima_consulta_em || null, registro.ultimo_sucesso_em || null, registro.ultimo_erro || null);
      return;
    }
    const { error } = await remoto.from('monitoramento_atualizacoes_reforma').upsert(registro, { onConflict: 'chave' });
    if (error) throw new Error(`Estado do monitor: ${error.message}`);
  };
  const anterior = await consultarAnterior();
  if (!forcar && anterior?.ultima_consulta_em) {
    const decorrido = agora.getTime() - new Date(`${anterior.ultima_consulta_em.replace(' ', 'T')}Z`).getTime();
    if (Number.isFinite(decorrido) && decorrido < LIMITE_INTERVALO_MS) return { chave: fonte.chave, status: 'NAO_DEVIDO' };
  }
  let resposta;
  try {
    resposta = await fetcher(fonte.url, { headers: { 'user-agent': 'Sattva-Reforma-Monitor/1.0' }, signal: AbortSignal.timeout(20_000) });
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const texto = textoLimpo(await resposta.text());
    if (texto.length < 80) throw new Error('Conteúdo oficial insuficiente para monitoramento.');
    const atualHash = hash(texto);
    const momento = agoraSql(agora);
    if (!anterior) {
      await salvarEstado({ chave: fonte.chave, fonte_nome: fonte.nome, fonte_url: fonte.url, ultimo_hash: atualHash, ultima_consulta_em: momento, ultimo_sucesso_em: momento, ultimo_erro: null });
      return { chave: fonte.chave, status: 'LINHA_DE_BASE_CRIADA' };
    }
    await salvarEstado({ chave: fonte.chave, fonte_nome: fonte.nome, fonte_url: fonte.url, ultimo_hash: atualHash, ultima_consulta_em: momento, ultimo_sucesso_em: momento, ultimo_erro: null });
    if (anterior.ultimo_hash === atualHash) return { chave: fonte.chave, status: 'SEM_ALTERACAO' };

    const titulo = `Alteração detectada automaticamente — ${fonte.nome}`;
    let existe;
    if (remoto) {
      const { data, error } = await remoto.from('atualizacoes_reforma').select('id').eq('titulo', titulo).eq('fonte_url', fonte.url).in('status', ['NOVA', 'EM_ANALISE']).limit(1);
      if (error) throw new Error(`Atualizações: ${error.message}`);
      existe = data?.[0];
    } else existe = banco.prepare(`SELECT id FROM atualizacoes_reforma WHERE titulo=? AND fonte_url=? AND status IN ('NOVA','EM_ANALISE') LIMIT 1`).get(titulo, fonte.url);
    if (!existe) {
      // A mudança só entra no mural depois de a própria fonte ser lida. O
      // resumo não produz regra, parecer ou cálculo: serve exclusivamente
      // para orientar a revisão humana antes de abrir a publicação oficial.
      const leitura = await resumirConteudoOficial(fonte, texto);
      const resumo = leitura.resumo;
      let id;
      if (remoto) {
        const { data, error } = await remoto.from('atualizacoes_reforma').insert({ titulo, resumo, fonte_nome: fonte.nome, fonte_url: fonte.url, data_publicacao: agora.toISOString().slice(0, 10), tema: fonte.tema, impacto_potencial: 'EM_ANALISE', modulos_afetados: 'BASE_DE_CONHECIMENTO', status: 'NOVA', observacao_analise: 'Detecção automática: requer validação humana antes de atualizar RAG, catálogo ou motor.' }).select('id').single();
        if (error) throw new Error(`Atualizações: ${error.message}`);
        id = data.id;
        const evento = await remoto.from('atualizacoes_reforma_eventos').insert({ atualizacao_id: id, acao: 'DETECTADA_AUTOMATICAMENTE', dados_json: { chave: fonte.chave, hash_anterior: anterior.ultimo_hash, hash_atual: atualHash, metodo_resumo: leitura.metodo } });
        if (evento.error) throw new Error(`Eventos de atualização: ${evento.error.message}`);
      } else {
        const r = banco.prepare(`INSERT INTO atualizacoes_reforma (titulo,resumo,fonte_nome,fonte_url,data_publicacao,tema,impacto_potencial,modulos_afetados,status,observacao_analise,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(titulo, resumo, fonte.nome, fonte.url, agora.toISOString().slice(0, 10), fonte.tema, 'EM_ANALISE', 'BASE_DE_CONHECIMENTO', 'NOVA', 'Detecção automática: requer validação humana antes de atualizar RAG, catálogo ou motor.', 'MONITOR_AUTOMATICO');
        id = Number(r.lastInsertRowid);
        banco.prepare(`INSERT INTO atualizacoes_reforma_eventos (atualizacao_id,acao,usuario_id,dados_json) VALUES (?,?,?,?)`).run(id, 'DETECTADA_AUTOMATICAMENTE', 'MONITOR_AUTOMATICO', JSON.stringify({ chave: fonte.chave, hash_anterior: anterior.ultimo_hash, hash_atual: atualHash, metodo_resumo: leitura.metodo }));
      }
      return { chave: fonte.chave, status: 'ALTERACAO_REGISTRADA', atualizacao_id: id };
    }
    return { chave: fonte.chave, status: 'ALTERACAO_JA_PENDENTE', atualizacao_id: existe.id };
  } catch (erro) {
    const momento = agoraSql(agora);
    await salvarEstado({ chave: fonte.chave, fonte_nome: fonte.nome, fonte_url: fonte.url, ultimo_hash: anterior?.ultimo_hash || null, ultima_consulta_em: momento, ultimo_sucesso_em: anterior?.ultimo_sucesso_em || null, ultimo_erro: erro.message });
    return { chave: fonte.chave, status: 'FALHOU', erro: erro.message };
  }
}

async function executar({ banco, fetcher = fetch, agora = new Date(), forcar = false } = {}) {
  banco ||= require('../db');
  const resultados = [];
  for (const fonte of FONTES) resultados.push(await verificarFonte(fonte, { banco, fetcher, agora, forcar }));
  return resultados;
}

module.exports = { FONTES, executar, verificarFonte, textoLimpo, fontePermitida, trechoRepresentativo, resumirConteudoOficial, lerEResumirFonte };
