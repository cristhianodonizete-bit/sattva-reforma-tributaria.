const crypto = require('crypto');

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

function fontePermitida(url) {
  const host = new URL(url).hostname.toLowerCase();
  return host === 'planalto.gov.br' || host.endsWith('.planalto.gov.br') || host === 'cgibs.gov.br' || host.endsWith('.gov.br');
}

async function verificarFonte(fonte, { banco, fetcher = fetch, agora = new Date(), forcar = false } = {}) {
  // Carregamento tardio mantém o módulo testável sem abrir o SQLite; na
  // execução normal, continua usando exatamente o banco da aplicação.
  banco ||= require('../db');
  if (!fontePermitida(fonte.url)) throw new Error(`Fonte não permitida: ${fonte.url}`);
  const anterior = banco.prepare('SELECT * FROM monitoramento_atualizacoes_reforma WHERE chave=?').get(fonte.chave);
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
      banco.prepare(`INSERT INTO monitoramento_atualizacoes_reforma
        (chave,fonte_nome,fonte_url,ultimo_hash,ultima_consulta_em,ultimo_sucesso_em)
        VALUES (?,?,?,?,?,?)`).run(fonte.chave, fonte.nome, fonte.url, atualHash, momento, momento);
      return { chave: fonte.chave, status: 'LINHA_DE_BASE_CRIADA' };
    }
    banco.prepare(`UPDATE monitoramento_atualizacoes_reforma
      SET ultimo_hash=?,ultima_consulta_em=?,ultimo_sucesso_em=?,ultimo_erro=NULL WHERE chave=?`)
      .run(atualHash, momento, momento, fonte.chave);
    if (anterior.ultimo_hash === atualHash) return { chave: fonte.chave, status: 'SEM_ALTERACAO' };

    const titulo = `Alteração detectada automaticamente — ${fonte.nome}`;
    const existe = banco.prepare(`SELECT id FROM atualizacoes_reforma
      WHERE titulo=? AND fonte_url=? AND status IN ('NOVA','EM_ANALISE') LIMIT 1`).get(titulo, fonte.url);
    if (!existe) {
      const resumo = `O monitoramento diário identificou mudança no conteúdo publicado. A alteração ainda não foi interpretada nem aplicada ao motor ou ao RAG. Revise a fonte oficial e registre a conclusão.`;
      const r = banco.prepare(`INSERT INTO atualizacoes_reforma
        (titulo,resumo,fonte_nome,fonte_url,data_publicacao,tema,impacto_potencial,modulos_afetados,status,observacao_analise,criado_por)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(titulo, resumo, fonte.nome, fonte.url, agora.toISOString().slice(0, 10), fonte.tema,
        'EM_ANALISE', 'BASE_DE_CONHECIMENTO', 'NOVA', 'Detecção automática: requer validação humana antes de atualizar RAG, catálogo ou motor.', 'MONITOR_AUTOMATICO');
      banco.prepare(`INSERT INTO atualizacoes_reforma_eventos (atualizacao_id,acao,usuario_id,dados_json)
        VALUES (?,?,?,?)`).run(Number(r.lastInsertRowid), 'DETECTADA_AUTOMATICAMENTE', 'MONITOR_AUTOMATICO', JSON.stringify({ chave: fonte.chave, hash_anterior: anterior.ultimo_hash, hash_atual: atualHash }));
      return { chave: fonte.chave, status: 'ALTERACAO_REGISTRADA', atualizacao_id: Number(r.lastInsertRowid) };
    }
    return { chave: fonte.chave, status: 'ALTERACAO_JA_PENDENTE', atualizacao_id: existe.id };
  } catch (erro) {
    const momento = agoraSql(agora);
    banco.prepare(`INSERT INTO monitoramento_atualizacoes_reforma (chave,fonte_nome,fonte_url,ultima_consulta_em,ultimo_erro)
      VALUES (?,?,?,?,?) ON CONFLICT(chave) DO UPDATE SET ultima_consulta_em=excluded.ultima_consulta_em,ultimo_erro=excluded.ultimo_erro`)
      .run(fonte.chave, fonte.nome, fonte.url, momento, erro.message);
    return { chave: fonte.chave, status: 'FALHOU', erro: erro.message };
  }
}

async function executar({ banco, fetcher = fetch, agora = new Date(), forcar = false } = {}) {
  banco ||= require('../db');
  const resultados = [];
  for (const fonte of FONTES) resultados.push(await verificarFonte(fonte, { banco, fetcher, agora, forcar }));
  return resultados;
}

module.exports = { FONTES, executar, verificarFonte, textoLimpo, fontePermitida };
