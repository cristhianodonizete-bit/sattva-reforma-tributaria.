const db = require('../db');

// Fatos materiais autorizados nesta etapa. Nenhum deles escolhe CST, alíquota
// ou tratamento. Novos fatos podem ser guardados em fatos_extras_json, mas só
// entram no resolvedor quando forem declarados aqui e tiverem regra publicada.
const FATOS = {
  fabricacao_propria: 'Este produto é de fabricação própria?',
  importador: 'Este produto foi importado pela própria empresa?',
  revendedor: 'Este produto é adquirido de terceiros para revenda?',
  defensivo_agropecuario: 'Este produto é classificado como defensivo agropecuário?',
  fertilizante: 'Este produto é fertilizante?',
  uso_veterinario: 'Este produto é de uso veterinário?',
  corretivo_solo: 'Este produto é corretivo de solo?',
  origem_mineral: 'Este produto é de origem mineral?',
  possui_sintetizador_voz: 'Este produto possui sintetizador de voz conforme a hipótese legal?',
  adaptado_para_pessoa_com_deficiencia: 'Este dispositivo possui adaptação específica para pessoa com deficiência?',
  acionador_pressao: 'Este produto é um acionador de pressão da hipótese legal?',
  receita_construcao_civil_enquadrada: 'A receita decorre de construção civil nas modalidades legais?',
  pj_financeira_ou_equiparada: 'A empresa se enquadra como financeira ou equiparada?',
  receita_servico_informatica_enquadrada: 'A receita decorre de serviço de informática legalmente listado?',
  receita_agencia_viagem_enquadrada: 'A receita decorre de serviço de agência de viagem ou turismo?',
  receita_servico_saude_listado: 'A receita decorre de serviço de saúde expressamente listado?',
  receita_educacao_nivel_legal: 'A receita decorre de educação nos níveis legalmente listados?',
  empresa_jornalistica_ou_radiodifusao: 'A empresa é jornalística ou de radiodifusão abrangida?',
  receita_telecomunicacoes: 'A receita decorre de serviço de telecomunicações?',
  prestadora_seguranca_privada_enquadrada: 'A empresa se enquadra como prestadora de segurança privada?',
  receita_concessionaria_rodovia: 'A receita decorre de serviço público de concessionária de rodovia?',
  receita_hotelaria_enquadrada: 'A receita é de hotelaria enquadrada na definição legal?',
  receita_organizacao_eventos_enquadrada: 'A receita é de organização de feira ou evento enquadrada na definição legal?',
  receita_transporte_turismo_apoio_enquadrada: 'A receita é de transporte, turismo ou apoio enquadrada na hipótese legal?',
  empresa_call_center: 'A empresa presta serviço de call center, telemarketing, telecobrança ou teleatendimento?',
};
const FATOS_EXTRAS = { papel_vendedor: { tipo:'enum', valores:['FABRICANTE','PRODUTOR','IMPORTADOR','REVENDEDOR','ATACADISTA','DISTRIBUIDOR','VAREJISTA'] } };
const FONTES = ['DOCUMENTO', 'XML_SPED', 'CFOP', 'CADASTRO_EMPRESA_PRODUTO', 'CADASTRO_PRODUTO', 'CADASTRO_EMPRESA', 'USUARIO', 'OUTRO'];
const bool = (v) => v === true || v === 1 || String(v || '').toUpperCase() === 'SIM';
const nuloOuBool = (v) => ['','NAO_SEI','NULL','UNDEFINED'].includes(String(v ?? '').trim().toUpperCase()) ? null : (bool(v) ? 1 : 0);
const texto = (v) => String(v ?? '').trim();
const dataValida = (r, data) => (!r.vigencia_inicio || r.vigencia_inicio <= data) && (!r.vigencia_fim || r.vigencia_fim >= data);
const dataDaOperacao = (v) => texto(v || new Date().toISOString().slice(0, 10)).slice(0, 10);

function validarFato(fato) { if (!FATOS[fato]) throw new Error('Fato fiscal não permitido.'); }
function validarFatosExtras(fatos = {}) {
  if (!fatos || Array.isArray(fatos) || typeof fatos !== 'object') throw new Error('Fatos extras devem ser um objeto.');
  const normalizados = {};
  for (const [fato, valor] of Object.entries(fatos)) {
    const regra = FATOS_EXTRAS[fato]; if (!regra) throw new Error(`Fato extra não reconhecido: ${fato}.`);
    const v = texto(valor).toUpperCase(); if (!regra.valores.includes(v)) throw new Error(`Valor inválido para ${fato}.`); normalizados[fato] = v;
  }
  return normalizados;
}
function validarSobreposicao({ empresa_id, produto_empresa_id = null, codigo_produto, fato, vigencia_inicio, vigencia_fim, ignorar_id = null }) {
  const inicio = texto(vigencia_inicio) || '0000-01-01', fim = texto(vigencia_fim) || '9999-12-31';
  const porIdentidade = produto_empresa_id != null;
  const registros = db.prepare(`SELECT id,vigencia_inicio,vigencia_fim FROM empresa_produto_fiscal WHERE empresa_id=? AND ${porIdentidade ? 'produto_empresa_id=?' : 'codigo_produto=?'} AND ativo=1 AND ${fato} IS NOT NULL`)
    .all(empresa_id, porIdentidade ? Number(produto_empresa_id) : texto(codigo_produto));
  const conflito = registros.find(r => Number(r.id) !== Number(ignorar_id) && (r.vigencia_inicio || '0000-01-01') <= fim && (r.vigencia_fim || '9999-12-31') >= inicio);
  if (conflito) throw new Error(`Há vigência sobreposta para este produto e fato (cadastro #${conflito.id}).`);
}
function registroVigente(empresaId, produtoEmpresaId, codigoProduto, data) {
  const porIdentidade = produtoEmpresaId != null;
  return db.prepare(`SELECT * FROM empresa_produto_fiscal WHERE empresa_id=? AND ${porIdentidade ? 'produto_empresa_id=?' : 'codigo_produto=?'} AND ativo=1
    AND (vigencia_inicio IS NULL OR vigencia_inicio<=?) AND (vigencia_fim IS NULL OR vigencia_fim>=?)
    ORDER BY COALESCE(vigencia_inicio,'0000-01-01') DESC, id DESC`).all(empresaId, porIdentidade ? produtoEmpresaId : texto(codigoProduto), data, data);
}

function resolverFato(contexto = {}, fato) {
  validarFato(fato);
  const data = dataDaOperacao(contexto.data_operacao || contexto.data);
  const fontes = [
    ['DADO_EXPLICITO_OPERACAO', contexto.fatos_operacao], ['XML_SPED_MOVIMENTO', contexto.fatos_documento],
    ['CFOP', contexto.fatos_cfop],
  ];
  for (const [origem, fatos] of fontes) {
    if (fatos && Object.prototype.hasOwnProperty.call(fatos, fato) && fatos[fato] !== null && fatos[fato] !== undefined) {
      const cadastro = registroVigente(Number(contexto.empresa_id), contexto.produto_empresa_id ?? null, texto(contexto.codigo_produto), data).find((r) => r[fato] !== null && r[fato] !== undefined);
      const valor = bool(fatos[fato]);
      if (cadastro && cadastro[fato] !== null && Boolean(cadastro[fato]) !== valor) registrarConflito({ empresa_id: contexto.empresa_id, codigo_produto: contexto.codigo_produto, movimento_id: contexto.movimento_id, fato, valor_precedente: valor, origem_precedente: origem, valor_menor_precedencia: Boolean(cadastro[fato]), origem_menor_precedencia: 'CADASTRO_EMPRESA_PRODUTO' });
      return { fato, status: 'COMPROVADO', valor, origem, cadastro_id: null };
    }
  }
  const registros = registroVigente(Number(contexto.empresa_id), contexto.produto_empresa_id ?? null, texto(contexto.codigo_produto), data);
  const ncmDocumento = texto(contexto.ncm);
  for (const r of registros) if (ncmDocumento && texto(r.ncm) && texto(r.ncm) !== ncmDocumento) registrarConflito({ empresa_id:contexto.empresa_id,codigo_produto:contexto.codigo_produto,movimento_id:contexto.movimento_id,fato:'CONFLITO_NCM_PRODUTO',valor_precedente:ncmDocumento,origem_precedente:'XML_SPED_MOVIMENTO',valor_menor_precedencia:r.ncm,origem_menor_precedencia:'CADASTRO_EMPRESA_PRODUTO' });
  const comFato = registros.filter((r) => r[fato] !== null && r[fato] !== undefined);
  if (comFato.length === 1) return { fato, status: 'COMPROVADO', valor: Boolean(comFato[0][fato]), origem: 'CADASTRO_EMPRESA_PRODUTO', cadastro_id: comFato[0].id, vigencia_inicio: comFato[0].vigencia_inicio || null, vigencia_fim: comFato[0].vigencia_fim || null };
  if (comFato.length > 1) return { fato, status: 'CONFLITO_DE_FATO', valor: null, origem: 'CADASTRO_EMPRESA_PRODUTO', cadastro_ids: comFato.map((r) => r.id) };
  for (const [origem, fatos] of [['CADASTRO_PRODUTO', contexto.fatos_produto], ['CADASTRO_EMPRESA', contexto.fatos_empresa]]) if (fatos && Object.prototype.hasOwnProperty.call(fatos, fato) && fatos[fato] != null) return { fato, status:'COMPROVADO', valor:bool(fatos[fato]), origem, cadastro_id:null };
  return { fato, status: 'NAO_DETERMINADO', valor: null, origem: null };
}

function registrarConflito(d) {
  const existente = db.prepare(`SELECT id FROM conflitos_fatos_fiscais WHERE empresa_id=? AND COALESCE(codigo_produto,'')=? AND fato=? AND status='ABERTO'`).get(d.empresa_id, texto(d.codigo_produto), d.fato);
  if (existente) return existente.id;
  return db.prepare(`INSERT INTO conflitos_fatos_fiscais (empresa_id,codigo_produto,movimento_id,fato,valor_precedente,origem_precedente,valor_menor_precedencia,origem_menor_precedencia) VALUES (?,?,?,?,?,?,?,?)`)
    .run(d.empresa_id, texto(d.codigo_produto), d.movimento_id || null, d.fato, String(d.valor_precedente), d.origem_precedente, String(d.valor_menor_precedencia), d.origem_menor_precedencia).lastInsertRowid;
}

function salvarFato({ empresa_id, produto_empresa_id = null, codigo_produto, ncm, produto_id, chave_produto, fato, valor, observacao, origem_evidencia, vigencia_inicio, vigencia_fim, usuario_id, transacao_externa = false }) {
  validarFato(fato); const valorNormalizado = nuloOuBool(valor);
  if (valorNormalizado === null) throw new Error('Informe SIM ou NÃO para salvar o fato. “Não sei” mantém a pendência sem cadastrar um fato.');
  if (!Number.isInteger(Number(empresa_id)) || Number(empresa_id) <= 0 || !db.prepare('SELECT 1 FROM empresas WHERE id=?').get(Number(empresa_id))) throw new Error('Empresa fiscal não encontrada.');
  const possuiIdentidade = produto_empresa_id !== null && produto_empresa_id !== undefined && texto(produto_empresa_id) !== '';
  const produtoEmpresaId = possuiIdentidade ? Number(produto_empresa_id) : null;
  if (possuiIdentidade && (!Number.isInteger(produtoEmpresaId) || produtoEmpresaId <= 0)) throw new Error('Produto da empresa inválido.');
  let produtoEmpresa = null;
  if (possuiIdentidade) {
    produtoEmpresa = db.prepare('SELECT id,empresa_id,codigo_produto_atual FROM produtos_empresa WHERE id=?').get(produtoEmpresaId);
    if (!produtoEmpresa) throw new Error('Produto da empresa não encontrado.');
    if (Number(produtoEmpresa.empresa_id) !== Number(empresa_id)) throw new Error('O produto informado não pertence à empresa.');
  } else if (!texto(codigo_produto)) throw new Error('Informe o código do produto quando não houver identidade interna.');
  const codigoSnapshot = texto(codigo_produto) || texto(produtoEmpresa?.codigo_produto_atual) || null;
  const inicio = texto(vigencia_inicio) || null; const fim = texto(vigencia_fim) || null;
  if (inicio && fim && inicio > fim) throw new Error('A vigência inicial não pode ser posterior à final.');
  const anterior = db.prepare(`SELECT * FROM empresa_produto_fiscal WHERE empresa_id=? AND ${possuiIdentidade ? 'produto_empresa_id=?' : 'produto_empresa_id IS NULL AND codigo_produto=?'} AND vigencia_inicio IS ?`)
    .get(Number(empresa_id), possuiIdentidade ? produtoEmpresaId : texto(codigo_produto), inicio);
  const agora = new Date().toISOString(); let id;
  validarSobreposicao({empresa_id:Number(empresa_id),produto_empresa_id:produtoEmpresaId,codigo_produto,fato,vigencia_inicio:inicio,vigencia_fim:fim,ignorar_id:anterior?.id});
  const executar = () => {
    if (anterior) {
      db.prepare(`UPDATE empresa_produto_fiscal SET produto_empresa_id=?, codigo_produto=?, ncm=?, produto_id=?, chave_produto=?, ${fato}=?, fonte_dado='USUARIO', origem_evidencia=?, observacao=?, validado_por=?, validado_em=?, vigencia_fim=?, ativo=1, updated_at=? WHERE id=?`)
        .run(produtoEmpresaId, codigoSnapshot || anterior.codigo_produto || null, texto(ncm) || anterior.ncm, produto_id || anterior.produto_id, texto(chave_produto) || anterior.chave_produto, valorNormalizado, texto(origem_evidencia) || null, texto(observacao) || null, usuario_id || null, agora, fim, agora, anterior.id); id = anterior.id;
    } else {
      const colunas = ['empresa_id','produto_empresa_id','codigo_produto','produto_id','chave_produto','ncm',fato,'fonte_dado','origem_evidencia','observacao','validado_por','validado_em','vigencia_inicio','vigencia_fim'];
      const valores = [Number(empresa_id),produtoEmpresaId,codigoSnapshot,produto_id || null,texto(chave_produto) || null,texto(ncm) || null,valorNormalizado,'USUARIO',texto(origem_evidencia) || null,texto(observacao) || null,usuario_id || null,agora,inicio,fim];
      id = db.prepare(`INSERT INTO empresa_produto_fiscal (${colunas.join(',')}) VALUES (${colunas.map(() => '?').join(',')})`).run(...valores).lastInsertRowid;
    }
    db.prepare(`INSERT INTO empresa_produto_fiscal_historico (cadastro_id,empresa_id,produto_empresa_id,codigo_produto,fato,valor_anterior,valor_novo,fonte,observacao,usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?)`)
      .run(id, Number(empresa_id), produtoEmpresaId, codigoSnapshot, fato, anterior?.[fato] == null ? null : String(Boolean(anterior[fato])), String(Boolean(valorNormalizado)), 'USUARIO', texto(observacao) || null, usuario_id || null);
  }; if (transacao_externa) executar(); else db.transaction(executar)(); return { id: Number(id), fato, valor: Boolean(valorNormalizado) };
}
function salvarFatosExtras({ empresa_id,produto_empresa_id = null,codigo_produto,fatos_extras,usuario_id,observacao }) {
  const fatos = validarFatosExtras(fatos_extras); const possuiIdentidade = produto_empresa_id !== null && produto_empresa_id !== undefined && texto(produto_empresa_id) !== '';
  const atual = db.prepare(`SELECT * FROM empresa_produto_fiscal WHERE empresa_id=? AND ${possuiIdentidade ? 'produto_empresa_id=?' : 'produto_empresa_id IS NULL AND codigo_produto=?'} AND ativo=1 ORDER BY id DESC LIMIT 1`).get(empresa_id,possuiIdentidade ? Number(produto_empresa_id) : texto(codigo_produto));
  if (!atual) throw new Error('Cadastre ao menos um fato principal antes de complementar fatos extras.');
  const antes = JSON.parse(atual.fatos_extras_json || '{}'); const depois = {...antes,...fatos};
  db.prepare('UPDATE empresa_produto_fiscal SET fatos_extras_json=?,observacao=?,validado_por=?,validado_em=?,updated_at=? WHERE id=?').run(JSON.stringify(depois),texto(observacao)||atual.observacao,usuario_id||null,new Date().toISOString(),new Date().toISOString(),atual.id);
  for(const [fato,valor] of Object.entries(fatos)) db.prepare('INSERT INTO empresa_produto_fiscal_historico (cadastro_id,empresa_id,produto_empresa_id,codigo_produto,fato,valor_anterior,valor_novo,fonte,observacao,usuario_id) VALUES (?,?,?,?,?,?,?,?,?,?)').run(atual.id,empresa_id,atual.produto_empresa_id || null,texto(codigo_produto) || atual.codigo_produto || null,fato,antes[fato]||null,valor,'USUARIO',texto(observacao)||null,usuario_id||null);
  return {id:atual.id,fatos_extras:depois};
}

function identidadePendencia({ empresa_id, produto_empresa_id = null, codigo_produto }) {
  if (!Number.isInteger(Number(empresa_id)) || Number(empresa_id) <= 0 || !db.prepare('SELECT 1 FROM empresas WHERE id=?').get(Number(empresa_id))) throw new Error('Empresa fiscal não encontrada.');
  const possuiIdentidade = produto_empresa_id !== null && produto_empresa_id !== undefined && texto(produto_empresa_id) !== '';
  if (!possuiIdentidade) {
    if (!texto(codigo_produto)) throw new Error('Informe o código do produto quando não houver identidade interna.');
    return { empresaId:Number(empresa_id), produtoEmpresaId:null, codigoSnapshot:texto(codigo_produto), possuiIdentidade:false };
  }
  const produtoEmpresaId=Number(produto_empresa_id);
  if (!Number.isInteger(produtoEmpresaId) || produtoEmpresaId <= 0) throw new Error('Produto da empresa inválido.');
  const produto=db.prepare('SELECT id,empresa_id,codigo_produto_atual FROM produtos_empresa WHERE id=?').get(produtoEmpresaId);
  if (!produto) throw new Error('Produto da empresa não encontrado.');
  if (Number(produto.empresa_id)!==Number(empresa_id)) throw new Error('O produto informado não pertence à empresa.');
  return { empresaId:Number(empresa_id), produtoEmpresaId, codigoSnapshot:texto(codigo_produto)||texto(produto.codigo_produto_atual)||'', possuiIdentidade:true };
}
function ondePendenciaEquivalente({ empresaId, produtoEmpresaId, codigoSnapshot, fato, regraId, familiaRegra }) {
  const porIdentidade=produtoEmpresaId!==null;
  return {
    sql:`empresa_id=? AND ${porIdentidade ? 'produto_empresa_id=?' : 'produto_empresa_id IS NULL AND codigo_produto=?'} AND fato_faltante=? AND COALESCE(regra_id,COALESCE(regra_candidata,''))=COALESCE(?, '') AND COALESCE(familia_regra,'')=COALESCE(?, '')`,
    parametros:[empresaId,porIdentidade ? produtoEmpresaId : codigoSnapshot,fato,regraId||null,familiaRegra||null],
  };
}
function criarPendencia(d) {
  validarFato(d.fato_faltante);
  const identidade=identidadePendencia(d); const regraId=texto(d.regra_id)||texto(d.regra_candidata)||null; const familiaRegra=texto(d.familia_regra)||null;
  const chave=ondePendenciaEquivalente({...identidade,fato:d.fato_faltante,regraId,familiaRegra});
  const existente=db.prepare(`SELECT * FROM pendencias_fiscais_produtos WHERE ${chave.sql} AND status='PENDENTE'`).get(...chave.parametros);
  if (existente) return { ...existente, duplicada:true };
  const status=texto(d.status)||'PENDENTE';
  const id=db.prepare(`INSERT INTO pendencias_fiscais_produtos (empresa_id,produto_empresa_id,codigo_produto,produto_descricao,ncm,regra_id,familia_regra,regra_candidata,fato_faltante,pergunta,status,origem_dados_existentes,movimento_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(identidade.empresaId,identidade.produtoEmpresaId,identidade.codigoSnapshot||null,texto(d.produto_descricao)||null,texto(d.ncm)||null,regraId,familiaRegra,texto(d.regra_candidata)||null,d.fato_faltante,texto(d.pergunta)||FATOS[d.fato_faltante],status,texto(d.origem_dados_existentes)||null,d.movimento_id||null).lastInsertRowid;
  return db.prepare('SELECT * FROM pendencias_fiscais_produtos WHERE id=?').get(id);
}
function listarPendencias(empresaId, filtros = {}) {
  const where=['p.empresa_id=?']; const par=[empresaId];
  for (const [campo,coluna] of Object.entries({ status:'p.status', ncm:'p.ncm', fato:'p.fato_faltante' })) if (texto(filtros[campo])) { where.push(`${coluna}=?`); par.push(texto(filtros[campo])); }
  if (texto(filtros.produto)) { where.push('(p.codigo_produto LIKE ? OR p.produto_descricao LIKE ?)'); par.push(`%${texto(filtros.produto)}%`,`%${texto(filtros.produto)}%`); }
  return db.prepare(`SELECT p.*, e.razao_social empresa FROM pendencias_fiscais_produtos p JOIN empresas e ON e.id=p.empresa_id WHERE ${where.join(' AND ')} ORDER BY p.criado_em DESC`).all(...par);
}
function responderPendencia(id, resposta, contexto) {
  const p=db.prepare('SELECT * FROM pendencias_fiscais_produtos WHERE id=?').get(id); if(!p) throw new Error('Pendência fiscal não encontrada.');
  const r=texto(resposta).toUpperCase(); if(!['SIM','NAO','NÃO','NAO_SEI','NÃO SEI'].includes(r)) throw new Error('Resposta inválida.');
  if (r.includes('SEI')) { db.prepare("UPDATE pendencias_fiscais_produtos SET status='IGNORADA',respondida_por=?,respondida_em=?,updated_at=? WHERE id=?").run(contexto.usuario_id||null,new Date().toISOString(),new Date().toISOString(),id); return { status:'IGNORADA', cadastro:null }; }
  const cadastro=salvarFato({...contexto,empresa_id:p.empresa_id,produto_empresa_id:p.produto_empresa_id || null,codigo_produto:p.codigo_produto,ncm:p.ncm,fato:p.fato_faltante,valor:r==='SIM'});
  const agora=new Date().toISOString(); const chave=ondePendenciaEquivalente({empresaId:p.empresa_id,produtoEmpresaId:p.produto_empresa_id || null,codigoSnapshot:p.codigo_produto,fato:p.fato_faltante,regraId:p.regra_id || p.regra_candidata || null,familiaRegra:p.familia_regra || null});
  db.prepare(`UPDATE pendencias_fiscais_produtos SET status='RESOLVIDA_AUTOMATICAMENTE',resolvida_em=?,updated_at=? WHERE ${chave.sql} AND status='PENDENTE' AND id<>?`).run(agora,agora,...chave.parametros,id);
  db.prepare("UPDATE pendencias_fiscais_produtos SET status='RESPONDIDA',respondida_por=?,respondida_em=?,updated_at=? WHERE id=?").run(contexto.usuario_id||null,agora,agora,id); return { status:'RESPONDIDA', cadastro };
}
function salvarLote({empresa_id,produtos_empresa_id,itens,fato,valor,observacao,vigencia_inicio,vigencia_fim,usuario_id}) {
  validarFato(fato);
  const porIdentidade=Array.isArray(produtos_empresa_id) && produtos_empresa_id.length;
  const selecionados=porIdentidade
    ? produtos_empresa_id.map((produto_empresa_id)=>({produto_empresa_id}))
    : (Array.isArray(itens) ? itens : []);
  if(!selecionados.length) throw new Error('Nenhum produto selecionado.');
  if(selecionados.length>500) throw new Error('Selecione entre 1 e 500 produtos para classificação em lote.');
  const unicos=new Set();
  for(const item of selecionados) {
    const chave=porIdentidade ? `produto_empresa_id:${Number(item.produto_empresa_id)}` : `codigo_produto:${texto(item.codigo_produto)}`;
    if(unicos.has(chave)) throw new Error(`O lote contém produto repetido (${chave}).`);
    unicos.add(chave);
  }
  let resultado=[];
  db.transaction(()=>{
    resultado=selecionados.map((item)=>{
      try {
        return salvarFato({...item,empresa_id,fato,valor,observacao,vigencia_inicio,vigencia_fim,usuario_id,transacao_externa:true});
      } catch(e) {
        const alvo=porIdentidade ? `produto_empresa_id ${item.produto_empresa_id}` : `código ${texto(item.codigo_produto)}`;
        throw new Error(`Lote rejeitado no ${alvo}: ${e.message}`);
      }
    });
  })();
  return resultado;
}
module.exports={ FATOS, FATOS_EXTRAS, FONTES, resolverFato, salvarFato, salvarFatosExtras, salvarLote, criarPendencia, listarPendencias, responderPendencia, registrarConflito, validarFatosExtras };
