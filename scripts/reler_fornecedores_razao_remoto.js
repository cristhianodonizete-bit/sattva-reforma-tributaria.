require('dotenv').config();
const { Client } = require('pg');

const empresaId = Number(process.argv[2]);
const aplicar = process.argv.includes('--aplicar');
if (!Number.isInteger(empresaId) || empresaId <= 0) throw new Error('Uso: node scripts/reler_fornecedores_razao_remoto.js <empresa_id> [--aplicar]');
if (!process.env.SUPABASE_DB_URL) throw new Error('SUPABASE_DB_URL não configurada.');

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function palavras(valor) {
  const ignorar = new Set(['PAGAMENTO','COMPRA','CONFORME','REFERENTE','VALOR','NOTA','NUMERO','BOLETO','SERVICO','PRESTACAO','SISTEMA','SISTEMAS','MATERIAL','MERCADORIA','DESPESA','LANCAMENTO','DOCUMENTO','FATURA','PARCELA','DUPLICATA','TRIBUTOS','IMPOSTOS','COMERCIO','COMERCIAL','EMPRESA','EMPRESAS','BRASIL','DO','DA','DE','DOS','DAS','E','EM','PARA','POR','COMPANHIA','SERVICOS','TECNOLOGIA','TECNOLOGIAS']);
  return [...new Set(normalizar(valor).split(' ').filter((x) => x.length >= 4 && !ignorar.has(x)))];
}
function chaveNome(valor) { return normalizar(valor).replace(/ /g, ''); }
function criterio(pessoa, historico) {
  const nome = normalizar(pessoa.nome);
  if (nome.length >= 8 && historico.includes(nome)) return 'NOME_LITERAL_QUESTOR';
  const historicoCompacto = chaveNome(historico);
  const nomeCompacto = chaveNome(pessoa.nome);
  if (nomeCompacto.length >= 12 && historicoCompacto.includes(nomeCompacto)) return 'NOME_COMPACTADO_QUESTOR';
  const a = palavras(pessoa.nome); const b = palavras(historico);
  const iguais = a.filter((x) => b.some((y) => {
    const tamanho = Math.min(x.length, y.length);
    return tamanho >= 5 && x.slice(0, tamanho) === y.slice(0, tamanho);
  }));
  return iguais.length >= 2 ? 'NOME_ABREVIADO_QUESTOR' : null;
}
function aliasTelecom(pessoas, historico, descricao) {
  const regras = [
    [/\bTIM\b/, /^TIM CELULAR\b/, 'ALIAS_TELECOM_TIM_QUESTOR', /TELECOMUNIC|TELEFON|CELULAR|INTERNET/],
    [/\bVIVO(?:\s+MG)?\b/, /^VIVO S\.? A\.?$/, 'ALIAS_TELECOM_VIVO_QUESTOR', /TELECOMUNIC|TELEFON|CELULAR|INTERNET/],
    [/\bALGAR TELECOM\b/, /^ALGAR MULTIMIDIA\b/, 'ALIAS_TELECOM_ALGAR_QUESTOR', /TELECOMUNIC|TELEFON|CELULAR|INTERNET/],
    [/\bCEMIG\b/, /^CEMIG DISTRIB\b/, 'ALIAS_ENERGIA_CEMIG_QUESTOR', /LUZ|ENERGIA|ELETRIC/],
    [/\bDMAE\b/, /^DMAE AGUA E ESGOTO\b/, 'ALIAS_AGUA_DMAE_QUESTOR', /AGUA|ESGOTO/],
    [/\bALSOL\b/, /^ALSOL ENERGIAS RENOVAVEIS\b/, 'ALIAS_ENERGIA_ALSOL_QUESTOR', /ENERGIA|BOLETO/],
  ];
  const contexto = `${normalizar(historico)} ${normalizar(descricao)}`;
  for (const [termo, nome, evidencia, exige] of regras) {
    if (!termo.test(normalizar(historico)) || !exige.test(contexto)) continue;
    const unicos = [...new Map(pessoas.filter((p) => nome.test(normalizar(p.nome))).map((p) => [p.inscr_federal, p])).values()];
    if (unicos.length === 1) return { pessoa: unicos[0], criterio: evidencia };
  }
  return null;
}

(async () => {
  const client = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows: pessoasBrutas } = await client.query(`select codigo_pessoa,nome,inscr_federal from public.questor_pessoas where length(regexp_replace(coalesce(inscr_federal,''),'\\D','','g'))=14`);
    const porCnpj = new Map();
    for (const p of pessoasBrutas) {
      p.inscr_federal = String(p.inscr_federal).replace(/\D/g, '');
      if (!porCnpj.has(p.inscr_federal)) porCnpj.set(p.inscr_federal, p);
    }
    const pessoas = [...porCnpj.values()];
    const indice = new Map();
    pessoas.forEach((pessoa, indicePessoa) => palavras(pessoa.nome).forEach((palavra) => {
      if (!indice.has(palavra)) indice.set(palavra, new Set());
      indice.get(palavra).add(indicePessoa);
    }));
    const { rows: movimentos } = await client.query(`select id,nome,descricao,normalizacao_evidencia from public.movimentos where empresa_id=$1 and origem='QUESTOR_RAZAO' and nome='Fornecedor genérico — Simples Nacional' order by id`, [empresaId]);
    const atualizacoes = []; const semCandidato = []; const ambiguos = [];
    for (const movimento of movimentos) {
      const evidencia = movimento.normalizacao_evidencia && typeof movimento.normalizacao_evidencia === 'object' ? movimento.normalizacao_evidencia : JSON.parse(movimento.normalizacao_evidencia || '{}');
      const historico = String(evidencia.historico || evidencia.participante || movimento.descricao || '');
      const possiveis = new Set();
      palavras(historico).forEach((palavra) => (indice.get(palavra) || []).forEach((i) => possiveis.add(i)));
      const candidatas = [...possiveis].map((i) => pessoas[i]);
      const encontradas = candidatas.map((pessoa) => ({ pessoa, criterio: criterio(pessoa, historico) })).filter((x) => x.criterio);
      let decisao = null;
      for (const nivel of ['NOME_LITERAL_QUESTOR','NOME_COMPACTADO_QUESTOR','NOME_ABREVIADO_QUESTOR']) {
        const unicas = [...new Map(encontradas.filter((x) => x.criterio === nivel).map((x) => [x.pessoa.inscr_federal, x.pessoa])).values()];
        if (unicas.length === 1) { decisao = { pessoa: unicas[0], criterio: nivel }; break; }
      }
      if (!decisao) decisao = aliasTelecom(candidatas, historico, movimento.descricao);
      if (!decisao) { (encontradas.length ? ambiguos : semCandidato).push(movimento.id); continue; }
      atualizacoes.push({ movimento, evidencia, pessoa: decisao.pessoa, criterio: decisao.criterio });
    }
    if (aplicar) {
      await client.query('begin');
      try {
        for (const { movimento, evidencia, pessoa, criterio } of atualizacoes) {
          evidencia.fornecedor_vinculado = { cnpj: pessoa.inscr_federal, descricao: pessoa.nome, regime: 'simples_nacional', origem: criterio.startsWith('ALIAS_') ? 'HISTORICO_ALIAS_QUESTOR' : 'HISTORICO_NOME_QUESTOR', evidencia_pessoa: { codigo_pessoa: String(pessoa.codigo_pessoa), nome: pessoa.nome, cnpj: pessoa.inscr_federal, criterio } };
          evidencia.fornecedor_relido_em = new Date().toISOString();
          await client.query(`update public.movimentos set nome=$1,inscr_federal=$2,normalizacao_evidencia=$3::jsonb where id=$4 and empresa_id=$5`, [pessoa.nome, pessoa.inscr_federal, JSON.stringify(evidencia), movimento.id, empresaId]);
        }
        await client.query('commit');
      } catch (erro) { await client.query('rollback'); throw erro; }
    }
    console.log(JSON.stringify({ empresa_id: empresaId, genericos_lidos: movimentos.length, identificados: atualizacoes.length, ambiguos: ambiguos.length, sem_candidato: semCandidato.length, aplicado: aplicar, amostra_ambiguos: ambiguos.slice(0, 20), amostra_sem_candidato: semCandidato.slice(0, 20) }, null, 2));
  } finally { await client.end(); }
})().catch((erro) => { console.error(erro.stack || erro.message); process.exit(1); });
