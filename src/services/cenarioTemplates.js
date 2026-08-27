/**
 * Templates oficiais de cenário. Eles descrevem hipóteses editáveis; jamais
 * carregam resultado tributário, classificação ou percentual fiscal pronto.
 */
const TEMPLATES = [
  { chave: 'A_REFERENCIA', codigo: 'A', nome: 'Atual / Referência',
    descricao: 'Fotografia atual, sem hipótese. Usa o cenário-base imutável.', base: true },
  { chave: 'B_SEM_ACAO', codigo: 'B', nome: 'Reforma sem ação',
    descricao: 'Mesma cadeia, mix e preços. Somente os efeitos tributários obrigatórios do motor.', premissas: [] },
  { chave: 'C_PRESERVAR_PRECO', codigo: 'C', nome: 'Preservação de preço',
    descricao: 'Mantém o preço final por operação quando o motor consegue resolver a hipótese; a margem é medida apenas com formação de custo explícita.',
    premissas: [{ nivel: 'global', lado: 'vendas', campo: 'estrategia_preco', valor_simulado: 'PRESERVAR_PRECO_FINAL', justificativa: 'Template C — preservar preço final', fonte: 'TEMPLATE_2C' }] },
  { chave: 'D_PRESERVAR_MARGEM', codigo: 'D', nome: 'Preservação de margem',
    descricao: 'Busca o preço necessário para preservar a margem somente nas saídas com formação de custo completa e vínculo explícito.',
    premissas: [{ nivel: 'global', lado: 'vendas', campo: 'estrategia_preco', valor_simulado: 'PRESERVAR_MARGEM', justificativa: 'Template D — preservar margem econômica', fonte: 'TEMPLATE_2C' }] },
  { chave: 'E_FORNECEDORES', codigo: 'E', nome: 'Otimização da composição de fornecedores',
    descricao: 'Cria uma hipótese de compras para migrações parciais editáveis. Não recomenda destino automaticamente.', premissas: [] },
  { chave: 'F_B2B_SENSIVEL', codigo: 'F', nome: 'Mercado B2B sensível a crédito',
    descricao: 'Cria uma hipótese de vendas para migrar participação comercial de forma editável, sem alterar classificação fiscal.', premissas: [] },
  { chave: 'G_B2C', codigo: 'G', nome: 'Mercado B2C',
    descricao: 'Cria uma hipótese de vendas com foco em preço cheio, margem e caixa; a composição é definida pelo consultor.', premissas: [] },
  { chave: 'H_SIMPLES', codigo: 'H', nome: 'Simples Nacional',
    descricao: 'Comparação reservada a formas de apuração legalmente cabíveis; exige confirmação explícita do regime da empresa.',
    exigeSimples: true, premissas: [] },
];

function listar() { return TEMPLATES.map((x) => ({ ...x, premissas: undefined })); }
function obter(chave) { return TEMPLATES.find((x) => x.chave === chave) || null; }

module.exports = { listar, obter };
