/* Perfil de parâmetros devolvido pelo próprio nWeb.
 *
 * Cada instalação Questor pode expor um conjunto diferente de controles. O
 * Sattva preserva a descoberta como evidência e só envia parâmetros que a
 * instalação declarou, sem depender de nomes genéricos ou de tentativa e
 * erro. Na ausência de descoberta, mantém o perfil compatível conhecido.
 */
const PADRAO = {
  PMODELO: '2', PDATAINICIAL: '', PDATAFINAL: '', PTIPOMOVIMENTO: '1;2',
  PDETALHARPRODUTOS: '1', PQUEBRAPORMOVIMENTO: '0', PVALOR: '0',
  PCODIGOEMPRESA: '', PORDENAR: '1', PAGRUPAR: '1', PGERARTOTALIZACAO: '1',
};
const OBRIGATORIOS = new Set(['PMODELO', 'PDATAINICIAL', 'PDATAFINAL', 'PCODIGOEMPRESA']);

const chave = (valor) => String(valor || '').replace(/[^a-z0-9]/ig, '').toUpperCase();
function camposRetornados(retorno) {
  const textoOriginal = typeof retorno === 'string' ? retorno : JSON.stringify(retorno || {});
  // Alguns nWebs encapsulam o JSON de parâmetros como string escapada.
  const texto = textoOriginal.replace(/\\"/g, '"');
  const encontrados = new Set();
  // O nWeb pode devolver JSON normal, JSON serializado dentro de JSON ou uma
  // estrutura Delphi. Capturamos exclusivamente nomes que começam por "p".
  const re = /["']?(?:name|nome)["']?\s*[:=]\s*["'](p[a-z0-9_]+)/ig;
  let m; while ((m = re.exec(texto))) encontrados.add(chave(m[1]));
  return [...encontrados];
}
function construir({ competencia, codigoEmpresa, campos = [] }) {
  const aceitos = new Set(campos.map(chave));
  const usarDescoberta = aceitos.size > 0;
  const valores = {
    ...PADRAO,
    PDATAINICIAL: `${competencia}-01`,
    PDATAFINAL: new Date(`${competencia}-01T12:00:00Z`).toISOString().slice(0, 10).replace(/\d{2}$/, '01'),
    PCODIGOEMPRESA: String(codigoEmpresa || ''),
  };
  // O último dia do mês não pode depender do fuso do servidor.
  const [ano, mes] = String(competencia || '').split('-').map(Number);
  if (ano && mes) valores.PDATAFINAL = new Date(Date.UTC(ano, mes, 0)).toISOString().slice(0, 10);
  const parametros = Object.fromEntries(Object.entries(valores)
    .filter(([nome]) => !usarDescoberta || aceitos.has(nome) || OBRIGATORIOS.has(nome)));
  return { parametros, modo: usarDescoberta ? 'DESCOBERTO_NO_QUESTOR' : 'COMPATIBILIDADE_PADRAO', campos: [...aceitos] };
}

module.exports = { camposRetornados, construir, PADRAO };
