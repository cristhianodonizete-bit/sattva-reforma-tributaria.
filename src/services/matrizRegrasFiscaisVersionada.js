// Importação operacional incremental. Uma regra completa alimenta o mesmo
// catálogo que o motor usa; nenhuma carga executa DELETE global.
const XLSX = require('xlsx');
const crypto = require('crypto');
const dbPadrao = require('../db');

const texto = (v) => String(v == null ? '' : v).trim();
const digitos = (v) => texto(v).replace(/\D/g, '');
const ncm = (v) => { const x = digitos(v); return x ? x.padStart(8, '0').slice(-8) : ''; };
const nbs = (v) => { const x = digitos(v); return x ? x.padStart(9, '0').slice(-9) : ''; };
const lc116 = (v) => { const x = digitos(v); return x ? x.slice(0, 4).padStart(4, '0') : ''; };
const cabecalho = (v) => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function campo(linha, nomes) { const chaves = Object.keys(linha); for (const nome of nomes) { const k = chaves.find((x) => cabecalho(x) === cabecalho(nome)); if (k) return linha[k]; } return ''; }
function percentual(v, nome) { if (v === '' || v == null) return null; const x = Number(texto(v).replace('%', '').replace(',', '.')); if (!Number.isFinite(x) || x < 0 || x > 100) throw new Error(`${nome}: percentual inválido (${v}).`); return x; }
function fatorReducao(v, nome) { const p = percentual(v, nome); return p === null ? 0 : p / 100; }
function json(v) { if (!texto(v)) return []; try { const x = JSON.parse(v); if (!Array.isArray(x)) throw new Error(); return x; } catch (_) { throw new Error('Condições JSON deve conter uma lista válida.'); } }
const hash = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const vigente = (db, dominio, codigo) => !!db.prepare("SELECT 1 FROM referencias_fiscais_oficiais WHERE dominio=? AND codigo=? AND situacao='VIGENTE'").get(dominio, codigo);
const reducao = (ibs, cbs, cst, codigo) => { const r = Math.max(Number(ibs) || 0, Number(cbs) || 0); if (String(cst) === '410' || String(codigo).startsWith('4')) return 'imune'; if (r >= .99) return 'reducao_100'; if (r >= .55 && r <= .65) return 'reducao_60'; if (r >= .25 && r <= .35) return 'reducao_30'; return r <= .001 ? 'integral' : 'especifico'; };

function gerarModelo() {
  const wb = XLSX.utils.book_new();
  const linha = { 'ID Regra': 'NCM_MEDICAMENTO_001', 'Tipo de chave': 'NCM', NCM: '30049099', NBS: '', 'Item LC 116': '', 'Vigência início': '2026-01-01', 'Vigência fim': '', Prioridade: 100, 'Condições JSON': '[]', 'Descrição / classificação CBS': 'Redução de alíquota', 'CST IBS/CBS': '200', cClassTrib: '200038', 'Redução IBS (%)': 60, 'Redução CBS (%)': 60, 'Tratamento PIS/COFINS': 'REGRA_RESIDUAL_REGIME', 'CST PIS': '', 'CST COFINS': '', 'PIS (%)': '', 'COFINS (%)': '', 'Operação PIS/COFINS': 'VENDA', 'Regime PIS/COFINS': '', 'Cumulatividade obrigatória': 'NÃO', 'Grau de determinação': 'DETERMINADA', 'Natureza para reconstrução': 'REGRA_ESPECIFICA', 'Percentual reconstrução sugerido': '', 'Regra de precedência': 'Matriz integrada', Fundamento: 'Dispositivo legal aplicável', Fonte: 'URL ou ato oficial', 'Versão fonte': '2026-01' };
  const ws = XLSX.utils.json_to_sheet([linha]); ws['!cols'] = Object.keys(linha).map((x) => ({ wch: Math.max(14, Math.min(34, x.length + 4)) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Regras operacionais');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Instrução: 'Uma linha integra CBS e PIS/Cofins para a mesma chave. Reduções CBS/IBS e alíquotas PIS/Cofins são pontos percentuais: 60 significa 60%; 1,65 significa 1,65%. Condições JSON só pode ser usado em regra exclusivamente PIS/Cofins; CBS condicional exige modelagem específica.' }]), 'Instruções');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
function ler(buffer) { const wb = XLSX.read(buffer, { type: 'buffer', raw: false }); const aba = wb.SheetNames.find((x) => cabecalho(x) === cabecalho('Regras operacionais')) || wb.SheetNames[0]; return { aba, linhas: XLSX.utils.sheet_to_json(wb.Sheets[aba], { defval: '' }) }; }

function validar(linha, indice, db) {
  const id = texto(campo(linha, ['ID Regra', 'ID'])); const codigoNcm = ncm(campo(linha, ['NCM'])); const codigoNbs = nbs(campo(linha, ['NBS'])); const codigoLc = lc116(campo(linha, ['Item LC 116', 'LC116'])); const tipo = texto(campo(linha, ['Tipo de chave'])).toUpperCase() || (codigoNcm ? 'NCM' : 'NBS_LC116');
  if (!id) throw new Error(`Linha ${indice}: ID Regra é obrigatório.`); if (!['NCM', 'NBS_LC116'].includes(tipo)) throw new Error(`Linha ${indice}: Tipo de chave deve ser NCM ou NBS_LC116.`);
  if (tipo === 'NCM' && (!codigoNcm || !vigente(db, 'NCM', codigoNcm))) throw new Error(`Linha ${indice}: NCM ${codigoNcm || 'vazio'} não existe na referência oficial vigente.`);
  if (tipo === 'NBS_LC116' && (!codigoNbs || !codigoLc || !vigente(db, 'NBS', codigoNbs) || !vigente(db, 'LC116', codigoLc))) throw new Error(`Linha ${indice}: NBS e Item LC 116 vigentes são obrigatórios.`);
  const inicio = texto(campo(linha, ['Vigência início'])); const fim = texto(campo(linha, ['Vigência fim'])) || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(inicio) || (fim && (!/^\d{4}-\d{2}-\d{2}$/.test(fim) || fim < inicio))) throw new Error(`Linha ${indice}: vigência inválida.`);
  const fonte = texto(campo(linha, ['Fonte'])), fundamento = texto(campo(linha, ['Fundamento'])); if (!fonte || !fundamento) throw new Error(`Linha ${indice}: fonte e fundamento são obrigatórios.`);
  const condicoes = json(campo(linha, ['Condições JSON'])); const pis = { tratamento: texto(campo(linha, ['Tratamento PIS/COFINS'])), cst_pis: texto(campo(linha, ['CST PIS'])), cst_cofins: texto(campo(linha, ['CST COFINS'])), pis_percentual: percentual(campo(linha, ['PIS (%)']), `Linha ${indice}`), cofins_percentual: percentual(campo(linha, ['COFINS (%)']), `Linha ${indice}`) };
  const cbs = { classificacao: texto(campo(linha, ['Descrição / classificação CBS', 'Classificação'])), cst: texto(campo(linha, ['CST IBS/CBS'])), cclasstrib: texto(campo(linha, ['cClassTrib'])), reducao_ibs: fatorReducao(campo(linha, ['Redução IBS (%)']), `Linha ${indice}`), reducao_cbs: fatorReducao(campo(linha, ['Redução CBS (%)']), `Linha ${indice}`) };
  const temPis = Object.values(pis).some((x) => x !== '' && x !== null); const temCbs = Boolean(cbs.cst || cbs.cclasstrib);
  if (!temPis) throw new Error(`Linha ${indice}: tratamento PIS/Cofins é obrigatório.`); if (!condicoes.length && (!temCbs || !cbs.cst || !cbs.cclasstrib)) throw new Error(`Linha ${indice}: regra operacional direta exige CST IBS/CBS e cClassTrib.`); if (condicoes.length && temCbs) throw new Error(`Linha ${indice}: CBS condicional não pode ser publicado genericamente. Remova CBS da linha ou modele a condição específica.`);
  return { id, tipo, ncm: codigoNcm || null, nbs: codigoNbs || null, lc116: codigoLc || null, inicio, fim, fonte, fundamento, versao_fonte: texto(campo(linha, ['Versão fonte'])), prioridade: Number(campo(linha, ['Prioridade']) || 0), condicoes, pis, cbs, operacao_pis_cofins: texto(campo(linha, ['Operação PIS/COFINS'])), regime_pis_cofins: texto(campo(linha, ['Regime PIS/COFINS'])), cumulatividade_obrigatoria: texto(campo(linha, ['Cumulatividade obrigatória'])), grau_determinacao: texto(campo(linha, ['Grau de determinação'])) || (condicoes.length ? 'CONDICIONADA' : 'DETERMINADA'), natureza_reconstrucao: texto(campo(linha, ['Natureza para reconstrução'])), percentual_reconstrucao_sugerido: percentual(campo(linha, ['Percentual reconstrução sugerido']), `Linha ${indice}`), regra_precedencia: texto(campo(linha, ['Regra de precedência'])), hash: '' };
}
function previsualizar(buffer, { db = dbPadrao } = {}) { const l = ler(buffer); const regras = l.linhas.map((x, i) => validar(x, i + 2, db)).map((r) => ({ ...r, hash: hash(r) })); return { aba: l.aba, regras, resumo: { total: regras.length, ncm: regras.filter((x) => x.tipo === 'NCM').length, servicos: regras.filter((x) => x.tipo === 'NBS_LC116').length, condicionais_pis: regras.filter((x) => x.condicoes.length).length } }; }

function importar(buffer, { db = dbPadrao } = {}) {
  const previa = previsualizar(buffer, { db }); const ids = new Set(); for (const r of previa.regras) { if (ids.has(r.id)) throw new Error(`ID Regra duplicado: ${r.id}.`); ids.add(r.id); }
  const mapa = db.prepare('SELECT * FROM catalogo_regras_operacionais_importadas WHERE chave_regra=?');
  const apagarMapa = db.prepare('DELETE FROM catalogo_regras_operacionais_importadas WHERE chave_regra=?');
  const inserirNcm = db.prepare(`INSERT INTO base_ncm (ncm,descricao,cst,cclasstrib,classificacao,fundamento,reducao_ibs,reducao_cbs,regra,fonte,candidatos,reducao,operacao_pis_cofins,cst_pis_atual,cst_cofins_atual,pis_percentual,cofins_percentual,regime_pis_cofins_receita,tratamento_pis_cofins,papel_na_cadeia_necessario,papel_na_cadeia,tratamento_efetivo_saida,natureza_reconstrucao,percentual_reconstrucao_sugerido,regra_precedencia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const atualizarNcm = db.prepare(`UPDATE base_ncm SET ncm=?,descricao=?,cst=?,cclasstrib=?,classificacao=?,fundamento=?,reducao_ibs=?,reducao_cbs=?,regra=?,fonte=?,reducao=?,operacao_pis_cofins=?,cst_pis_atual=?,cst_cofins_atual=?,pis_percentual=?,cofins_percentual=?,regime_pis_cofins_receita=?,tratamento_pis_cofins=?,natureza_reconstrucao=?,percentual_reconstrucao_sugerido=?,regra_precedencia=? WHERE id=?`);
  const inserirServico = db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,descricao_nbs,cclasstrib,nome_cclasstrib,reducao,operacao_pis_cofins,cst_pis_atual,cst_cofins_atual,pis_percentual,cofins_percentual,cumulatividade_obrigatoria,grau_determinacao,regime_pis_cofins_receita,tratamento_pis_cofins,natureza_reconstrucao,percentual_reconstrucao_sugerido,regra_precedencia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const atualizarServico = db.prepare(`UPDATE base_servicos SET lc116=?,nbs=?,descricao_item=?,descricao_nbs=?,cclasstrib=?,nome_cclasstrib=?,reducao=?,operacao_pis_cofins=?,cst_pis_atual=?,cst_cofins_atual=?,pis_percentual=?,cofins_percentual=?,cumulatividade_obrigatoria=?,grau_determinacao=?,regime_pis_cofins_receita=?,tratamento_pis_cofins=?,natureza_reconstrucao=?,percentual_reconstrucao_sugerido=?,regra_precedencia=? WHERE id=?`);
  const salvarMapa = db.prepare(`INSERT INTO catalogo_regras_operacionais_importadas (chave_regra,tipo_chave,base_ncm_id,base_servico_id,regra_enquadramento_id,hash_conteudo,fonte,fundamento,vigencia_inicio,vigencia_fim,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','localtime')) ON CONFLICT(chave_regra) DO UPDATE SET tipo_chave=excluded.tipo_chave,base_ncm_id=excluded.base_ncm_id,base_servico_id=excluded.base_servico_id,regra_enquadramento_id=excluded.regra_enquadramento_id,hash_conteudo=excluded.hash_conteudo,fonte=excluded.fonte,fundamento=excluded.fundamento,vigencia_inicio=excluded.vigencia_inicio,vigencia_fim=excluded.vigencia_fim,atualizado_em=excluded.atualizado_em`);
  const resultado = { regras_importadas: 0, ncm: 0, servicos: 0, condicionais_pis: 0, criadas: 0, atualizadas: 0, status: 'OPERACIONAL' };
  db.transaction(() => previa.regras.forEach((r) => {
    const chaveCobertura = r.tipo === 'NCM' ? `COBERTURA_NCM_${r.ncm}` : `COBERTURA_NBS_${r.nbs}`;
    const existente = mapa.get(r.id) || mapa.get(chaveCobertura);
    if (r.condicoes.length) {
      const regraId = existente?.regra_enquadramento_id || `CATALOGO_${r.id}`;
      db.prepare(`INSERT INTO regras_enquadramento (id,familia,ncm,nbs,lc116,regime_pis_cofins,condicoes_obrigatorias,tratamento_resultante,fundamento_legal,vigencia_inicio,vigencia_fim,prioridade,versao,status,fonte,evidencia,cst_pis,cst_cofins,pis_percentual,cofins_percentual,atualizado_em) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,'ATIVA',?,?,?,?,?,?,datetime('now','localtime')) ON CONFLICT(id) DO UPDATE SET ncm=excluded.ncm,nbs=excluded.nbs,lc116=excluded.lc116,regime_pis_cofins=excluded.regime_pis_cofins,condicoes_obrigatorias=excluded.condicoes_obrigatorias,tratamento_resultante=excluded.tratamento_resultante,fundamento_legal=excluded.fundamento_legal,vigencia_inicio=excluded.vigencia_inicio,vigencia_fim=excluded.vigencia_fim,prioridade=excluded.prioridade,status='ATIVA',fonte=excluded.fonte,evidencia=excluded.evidencia,cst_pis=excluded.cst_pis,cst_cofins=excluded.cst_cofins,pis_percentual=excluded.pis_percentual,cofins_percentual=excluded.cofins_percentual,versao=regras_enquadramento.versao+1,atualizado_em=excluded.atualizado_em`).run(regraId, 'IMPORTADA_OPERACIONAL', r.ncm, r.nbs, r.lc116, r.regime_pis_cofins || null, JSON.stringify(r.condicoes), r.pis.tratamento, r.fundamento, r.inicio, r.fim, r.prioridade, r.fonte, r.versao_fonte, r.pis.cst_pis || null, r.pis.cst_cofins || null, r.pis.pis_percentual, r.pis.cofins_percentual);
      salvarMapa.run(r.id, 'PIS_CONDICIONAL', null, null, regraId, r.hash, r.fonte, r.fundamento, r.inicio, r.fim); resultado.condicionais_pis++; resultado.regras_importadas++; existente ? resultado.atualizadas++ : resultado.criadas++; return;
    }
    const valoresNcm = [r.ncm, r.cbs.classificacao, r.cbs.cst, r.cbs.cclasstrib, r.cbs.classificacao, r.fundamento, r.cbs.reducao_ibs, r.cbs.reducao_cbs, r.regra_precedencia, r.fonte, 1, reducao(r.cbs.reducao_ibs,r.cbs.reducao_cbs,r.cbs.cst,r.cbs.cclasstrib), r.operacao_pis_cofins, r.pis.cst_pis, r.pis.cst_cofins, r.pis.pis_percentual, r.pis.cofins_percentual, r.regime_pis_cofins, r.pis.tratamento, '', '', '', r.natureza_reconstrucao, r.percentual_reconstrucao_sugerido, r.regra_precedencia];
    const valoresServico = [r.lc116, r.nbs, r.cbs.classificacao, r.cbs.classificacao, r.cbs.cclasstrib, r.cbs.classificacao, reducao(r.cbs.reducao_ibs,r.cbs.reducao_cbs,r.cbs.cst,r.cbs.cclasstrib), r.operacao_pis_cofins, r.pis.cst_pis, r.pis.cst_cofins, r.pis.pis_percentual, r.pis.cofins_percentual, r.cumulatividade_obrigatoria, r.grau_determinacao, r.regime_pis_cofins, r.pis.tratamento, r.natureza_reconstrucao, r.percentual_reconstrucao_sugerido, r.regra_precedencia];
    if (r.tipo === 'NCM') { let id; if (existente?.base_ncm_id) { atualizarNcm.run(...valoresNcm.slice(0, 10), valoresNcm[11], ...valoresNcm.slice(12, 19), ...valoresNcm.slice(22, 25), existente.base_ncm_id); id = existente.base_ncm_id; resultado.atualizadas++; } else { try { id = Number(inserirNcm.run(...valoresNcm).lastInsertRowid); } catch (e) { throw new Error(`Não foi possível inserir a regra NCM ${r.id}: ${e.message}`); } resultado.criadas++; } db.prepare('UPDATE base_ncm SET candidatos=(SELECT COUNT(*) FROM base_ncm b WHERE b.ncm=base_ncm.ncm) WHERE ncm=?').run(r.ncm); salvarMapa.run(r.id, 'NCM', id, null, null, r.hash, r.fonte, r.fundamento, r.inicio, r.fim); if (existente && existente.chave_regra !== r.id) apagarMapa.run(existente.chave_regra); resultado.ncm++; }
    else { let id; if (existente?.base_servico_id) { atualizarServico.run(...valoresServico, existente.base_servico_id); id = existente.base_servico_id; resultado.atualizadas++; } else { id = Number(inserirServico.run(...valoresServico).lastInsertRowid); resultado.criadas++; } salvarMapa.run(r.id, 'NBS_LC116', null, id, null, r.hash, r.fonte, r.fundamento, r.inicio, r.fim); if (existente && existente.chave_regra !== r.id) apagarMapa.run(existente.chave_regra); resultado.servicos++; }
    resultado.regras_importadas++;
  }))();
  return resultado;
}
function resumo({ db = dbPadrao } = {}) { return db.prepare('SELECT tipo_chave,COUNT(*) quantidade FROM catalogo_regras_operacionais_importadas GROUP BY tipo_chave ORDER BY tipo_chave').all(); }
// Cobertura não é benefício fiscal: ela torna explícita a regra residual já
// usada pelo motor para códigos oficiais sem hipótese específica cadastrada.
function completarCoberturaTotal({ db = dbPadrao } = {}) {
  const inserirNcm = db.prepare(`INSERT INTO base_ncm (ncm,descricao,cst,cclasstrib,classificacao,fundamento,reducao_ibs,reducao_cbs,regra,fonte,candidatos,reducao,operacao_pis_cofins,tratamento_pis_cofins,regra_precedencia) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const inserirServico = db.prepare(`INSERT INTO base_servicos (lc116,nbs,descricao_item,descricao_nbs,cclasstrib,nome_cclasstrib,reducao,operacao_pis_cofins,tratamento_pis_cofins,grau_determinacao,regra_precedencia) VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const salvarMapa = db.prepare(`INSERT OR IGNORE INTO catalogo_regras_operacionais_importadas (chave_regra,tipo_chave,base_ncm_id,base_servico_id,regra_enquadramento_id,hash_conteudo,fonte,fundamento,vigencia_inicio,vigencia_fim) VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const oficialNcm = db.prepare("SELECT codigo,descricao,vigencia_inicio,vigencia_fim,fonte FROM referencias_fiscais_oficiais WHERE dominio='NCM' AND situacao='VIGENTE' ORDER BY codigo").all();
  const oficialNbs = db.prepare("SELECT r.codigo,r.descricao,r.vigencia_inicio,r.vigencia_fim,r.fonte,(SELECT destino.codigo FROM referencias_fiscais_relacoes x JOIN referencias_fiscais_oficiais destino ON destino.id=x.destino_id WHERE x.origem_id=r.id AND x.tipo='NBS_LC116' ORDER BY x.id LIMIT 1) lc116 FROM referencias_fiscais_oficiais r WHERE r.dominio='NBS' AND r.situacao='VIGENTE' ORDER BY r.codigo").all();
  const existeNcm = db.prepare('SELECT 1 FROM base_ncm WHERE ncm=? LIMIT 1'); const existeNbs = db.prepare('SELECT 1 FROM base_servicos WHERE nbs=? LIMIT 1');
  const resultado = { ncm_oficiais: oficialNcm.length, nbs_oficiais: oficialNbs.length, ncm_residuais_criados: 0, nbs_residuais_criados: 0, existentes_preservados: 0, status: 'COBERTURA_TOTAL' };
  db.transaction(() => {
    for (const r of oficialNcm) {
      if (existeNcm.get(r.codigo)) { resultado.existentes_preservados++; continue; }
      const fundamento = 'Regra residual operacional: não há tratamento específico homologado para este NCM no catálogo.';
      const id = Number(inserirNcm.run(r.codigo,r.descricao,'000','000001','Tributação integral — regra residual',fundamento,0,0,'REGRA_RESIDUAL',r.fonte,1,'integral','REGRA_RESIDUAL_REGIME','REGRA_RESIDUAL_REGIME',fundamento).lastInsertRowid);
      salvarMapa.run(`COBERTURA_NCM_${r.codigo}`,'NCM',id,null,null,hash({ tipo:'NCM', codigo:r.codigo, residual:true }),r.fonte,fundamento,r.vigencia_inicio || '1900-01-01',r.vigencia_fim || null); resultado.ncm_residuais_criados++;
    }
    for (const r of oficialNbs) {
      if (existeNbs.get(r.codigo)) { resultado.existentes_preservados++; continue; }
      const fundamento = 'Regra residual operacional: não há tratamento específico homologado para este NBS no catálogo.';
      const id = Number(inserirServico.run(r.lc116 || '0000',r.codigo,r.descricao,r.descricao,'000001','Tributação integral — regra residual','integral','REGRA_RESIDUAL_REGIME','REGRA_RESIDUAL_REGIME','DETERMINADA',fundamento).lastInsertRowid);
      salvarMapa.run(`COBERTURA_NBS_${r.codigo}`,'NBS_LC116',null,id,null,hash({ tipo:'NBS', codigo:r.codigo, residual:true }),r.fonte,fundamento,r.vigencia_inicio || '1900-01-01',r.vigencia_fim || null); resultado.nbs_residuais_criados++;
    }
  })();
  return resultado;
}
module.exports = { gerarModelo, previsualizar, importar, resumo, completarCoberturaTotal };
