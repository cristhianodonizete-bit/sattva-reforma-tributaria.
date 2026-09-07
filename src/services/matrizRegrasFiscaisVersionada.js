// Carga controlada de conteúdo fiscal. A tabela é deliberadamente fora do
// motor: importar cria somente RASCUNHOS e nunca publica PIS/Cofins ou CBS.
const XLSX = require('xlsx');
const crypto = require('crypto');
const dbPadrao = require('../db');

const texto = (v) => String(v == null ? '' : v).trim();
const digitos = (v) => texto(v).replace(/\D/g, '');
const ncm = (v) => { const x = digitos(v); return x ? x.padStart(8, '0').slice(-8) : ''; };
const cabecalho = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function campo(linha, nomes) { const chaves = Object.keys(linha); for (const nome of nomes) { const k = chaves.find((x) => cabecalho(x) === cabecalho(nome)); if (k) return linha[k]; } return ''; }
function percentual(v) { if (v === '' || v == null) return null; const x = Number(texto(v).replace('%', '').replace(',', '.')); if (!Number.isFinite(x) || x < 0 || x > 100) throw new Error(`Percentual inválido: ${v}`); return x; }
function json(v) { if (!texto(v)) return []; try { const x = JSON.parse(v); if (!Array.isArray(x)) throw new Error(); return x; } catch (_) { throw new Error('Condições JSON deve conter uma lista válida.'); } }

function gerarModelo() {
  const wb = XLSX.utils.book_new();
  const linhas = [
    { ID: 'PIS_NCM_EXEMPLO_001', Tributo: 'PIS_COFINS', NCM: '30049099', 'Vigência início': '2026-01-01', 'Vigência fim': '', Prioridade: 100, 'Condições JSON': '[]', 'Tratamento PIS/COFINS': 'ALIQUOTA_ZERO_PIS_COFINS', 'CST PIS': '06', 'CST COFINS': '06', 'PIS (%)': 0, 'COFINS (%)': 0, 'CST IBS/CBS': '', cClassTrib: '', 'Redução IBS (%)': '', 'Redução CBS (%)': '', Fundamento: 'Dispositivo legal aplicável', Fonte: 'URL ou ato oficial', 'Versão fonte': '2026-01' },
    { ID: 'CBS_NCM_EXEMPLO_001', Tributo: 'CBS', NCM: '30049099', 'Vigência início': '2026-01-01', 'Vigência fim': '', Prioridade: 100, 'Condições JSON': '[]', 'Tratamento PIS/COFINS': '', 'CST PIS': '', 'CST COFINS': '', 'PIS (%)': '', 'COFINS (%)': '', 'CST IBS/CBS': '200', cClassTrib: '200038', 'Redução IBS (%)': 60, 'Redução CBS (%)': 60, Fundamento: 'Dispositivo legal aplicável', Fonte: 'URL ou ato oficial', 'Versão fonte': '2026-01' },
  ];
  const ws = XLSX.utils.json_to_sheet(linhas); ws['!cols'] = Object.keys(linhas[0]).map((x) => ({ wch: Math.max(14, Math.min(32, x.length + 5)) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Regras PIS Cofins CBS');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Instrução: 'Uma linha por tributo e NCM. A importação cria somente RASCUNHO. Não use esta planilha para substituir a base operacional.' }]), 'Instruções');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function ler(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer', raw: false });
  const aba = wb.SheetNames.find((x) => cabecalho(x) === cabecalho('Regras PIS Cofins CBS')) || wb.SheetNames[0];
  return { aba, linhas: XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '' }) };
}
function validar(linha, indice, db) {
  const id = texto(campo(linha, ['ID'])); const tributo = texto(campo(linha, ['Tributo'])).toUpperCase(); const codigo = ncm(campo(linha, ['NCM']));
  if (!id) throw new Error(`Linha ${indice}: ID é obrigatório.`); if (!['PIS_COFINS', 'CBS'].includes(tributo)) throw new Error(`Linha ${indice}: tributo deve ser PIS_COFINS ou CBS.`);
  if (!codigo || !db.prepare("SELECT 1 FROM referencias_fiscais_oficiais WHERE dominio='NCM' AND codigo=? AND situacao='VIGENTE'").get(codigo)) throw new Error(`Linha ${indice}: NCM ${codigo || 'vazio'} não existe na referência oficial vigente.`);
  const inicio = texto(campo(linha, ['Vigência início'])); if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio)) throw new Error(`Linha ${indice}: vigência inicial deve estar em AAAA-MM-DD.`);
  const fim = texto(campo(linha, ['Vigência fim'])) || null; if (fim && (!/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio)) throw new Error(`Linha ${indice}: vigência final inválida.`);
  const fonte = texto(campo(linha, ['Fonte'])), fundamento = texto(campo(linha, ['Fundamento'])); if (!fonte || !fundamento) throw new Error(`Linha ${indice}: fonte e fundamento são obrigatórios.`);
  const resultado = tributo === 'PIS_COFINS' ? { tratamento: texto(campo(linha, ['Tratamento PIS/COFINS'])), cst_pis: texto(campo(linha, ['CST PIS'])), cst_cofins: texto(campo(linha, ['CST COFINS'])), pis_percentual: percentual(campo(linha, ['PIS (%)'])), cofins_percentual: percentual(campo(linha, ['COFINS (%)'])) } : { cst: texto(campo(linha, ['CST IBS/CBS'])), cclasstrib: texto(campo(linha, ['cClassTrib'])), reducao_ibs: percentual(campo(linha, ['Redução IBS (%)'])), reducao_cbs: percentual(campo(linha, ['Redução CBS (%)'])) };
  if (tributo === 'PIS_COFINS' && !Object.values(resultado).some((x) => x !== '' && x !== null)) throw new Error(`Linha ${indice}: informe ao menos um resultado PIS/Cofins.`);
  if (tributo === 'CBS' && !Object.values(resultado).some((x) => x !== '' && x !== null)) throw new Error(`Linha ${indice}: informe ao menos um resultado CBS.`);
  return { id, tributo, tipo_chave: 'NCM', ncm: codigo, vigencia_inicio: inicio, vigencia_fim: fim, prioridade: Number(campo(linha, ['Prioridade']) || 0), condicoes_json: json(campo(linha, ['Condições JSON'])), resultado_json: resultado, fundamento, fonte, versao_fonte: texto(campo(linha, ['Versão fonte'])) };
}
function previsualizar(buffer, { db = dbPadrao } = {}) { const l = ler(buffer); const regras = l.linhas.map((x, i) => validar(x, i + 2, db)); return { aba: l.aba, regras, resumo: { total: regras.length, pis_cofins: regras.filter((x) => x.tributo === 'PIS_COFINS').length, cbs: regras.filter((x) => x.tributo === 'CBS').length, hash: crypto.createHash('sha256').update(buffer).digest('hex') } }; }
function importar(buffer, { db = dbPadrao } = {}) { const previa = previsualizar(buffer, { db }); const existeProtegida = db.prepare("SELECT status FROM matriz_regras_fiscais_versionada WHERE id=?"); const upsert = db.prepare(`INSERT INTO matriz_regras_fiscais_versionada (id,tributo,tipo_chave,ncm,vigencia_inicio,vigencia_fim,prioridade,condicoes_json,resultado_json,fundamento,fonte,versao_fonte,status,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'RASCUNHO', datetime('now','localtime')) ON CONFLICT(id) DO UPDATE SET tributo=excluded.tributo,tipo_chave=excluded.tipo_chave,ncm=excluded.ncm,vigencia_inicio=excluded.vigencia_inicio,vigencia_fim=excluded.vigencia_fim,prioridade=excluded.prioridade,condicoes_json=excluded.condicoes_json,resultado_json=excluded.resultado_json,fundamento=excluded.fundamento,fonte=excluded.fonte,versao_fonte=excluded.versao_fonte,atualizado_em=excluded.atualizado_em WHERE matriz_regras_fiscais_versionada.status='RASCUNHO'`);
  db.transaction(() => previa.regras.forEach((r) => { const atual = existeProtegida.get(r.id); if (atual && atual.status !== 'RASCUNHO') throw new Error(`Regra ${r.id} não pode sobrescrever status ${atual.status}.`); upsert.run(r.id,r.tributo,r.tipo_chave,r.ncm,r.vigencia_inicio,r.vigencia_fim,r.prioridade,JSON.stringify(r.condicoes_json),JSON.stringify(r.resultado_json),r.fundamento,r.fonte,r.versao_fonte); }))();
  return { ...previa.resumo, status: 'RASCUNHO', regras_importadas: previa.regras.length };
}
function resumo({ db = dbPadrao } = {}) { return db.prepare("SELECT tributo,status,COUNT(*) quantidade FROM matriz_regras_fiscais_versionada GROUP BY tributo,status ORDER BY tributo,status").all(); }
module.exports = { gerarModelo, previsualizar, importar, resumo };
