/**
 * TABELAS DO SIMPLES NACIONAL (LC 123/2006, Anexos I a V)
 * ---------------------------------------------------------------------------
 * Usadas pelo motor para:
 *   a) determinar a alíquota efetiva quando o faturamento é CONHECIDO;
 *   b) simular faixas representativas quando o faturamento é DESCONHECIDO
 *      (item 12 da especificação — nunca assumir alíquota única).
 *
 * A coluna de repartição indica quanto da alíquota efetiva corresponde a cada
 * tributo. É dela que sai o crédito de IBS/CBS que o optante do Simples
 * transmite ao adquirente: a parcela de PIS+COFINS vira CBS e a parcela de
 * ICMS ou ISS vira IBS. As demais parcelas (IRPJ, CSLL, CPP) não geram crédito.
 *
 * Alíquota efetiva = (RBT12 × alíquota nominal − parcela a deduzir) ÷ RBT12
 *
 * Estes percentuais são carregados no banco na primeira execução e passam a
 * ser editáveis pelo sistema — o código não os consulta diretamente.
 */

// [faixa, limite superior RBT12, alíquota nominal, parcela a deduzir,
//  repartição: irpj, csll, cofins, pis, cpp, icms_iss]
const ANEXOS = {
  I: {
    nome: 'Anexo I — Comércio',
    tipo: 'mercadoria',
    faixas: [
      [1, 180000.00, 0.0400, 0.00, { irpj: 0.055, csll: 0.035, cofins: 0.1274, pis: 0.0276, cpp: 0.415, icms_iss: 0.340 }],
      [2, 360000.00, 0.0730, 5940.00, { irpj: 0.055, csll: 0.035, cofins: 0.1274, pis: 0.0276, cpp: 0.415, icms_iss: 0.340 }],
      [3, 720000.00, 0.0950, 13860.00, { irpj: 0.055, csll: 0.035, cofins: 0.1274, pis: 0.0276, cpp: 0.420, icms_iss: 0.335 }],
      [4, 1800000.00, 0.1070, 22500.00, { irpj: 0.055, csll: 0.035, cofins: 0.1274, pis: 0.0276, cpp: 0.420, icms_iss: 0.335 }],
      [5, 3600000.00, 0.1430, 87300.00, { irpj: 0.055, csll: 0.035, cofins: 0.1274, pis: 0.0276, cpp: 0.420, icms_iss: 0.335 }],
      [6, 4800000.00, 0.1900, 378000.00, { irpj: 0.135, csll: 0.100, cofins: 0.2827, pis: 0.0613, cpp: 0.421, icms_iss: 0.000 }],
    ],
  },
  II: {
    nome: 'Anexo II — Indústria',
    tipo: 'mercadoria',
    faixas: [
      [1, 180000.00, 0.0450, 0.00, { irpj: 0.055, csll: 0.035, cofins: 0.1151, pis: 0.0249, cpp: 0.375, icms_iss: 0.320, ipi: 0.075 }],
      [2, 360000.00, 0.0780, 5940.00, { irpj: 0.055, csll: 0.035, cofins: 0.1151, pis: 0.0249, cpp: 0.375, icms_iss: 0.320, ipi: 0.075 }],
      [3, 720000.00, 0.1000, 13860.00, { irpj: 0.055, csll: 0.035, cofins: 0.1151, pis: 0.0249, cpp: 0.375, icms_iss: 0.320, ipi: 0.075 }],
      [4, 1800000.00, 0.1120, 22500.00, { irpj: 0.055, csll: 0.035, cofins: 0.1151, pis: 0.0249, cpp: 0.375, icms_iss: 0.320, ipi: 0.075 }],
      [5, 3600000.00, 0.1470, 85500.00, { irpj: 0.055, csll: 0.035, cofins: 0.1151, pis: 0.0249, cpp: 0.375, icms_iss: 0.320, ipi: 0.075 }],
      [6, 4800000.00, 0.3000, 720000.00, { irpj: 0.085, csll: 0.075, cofins: 0.2096, pis: 0.0454, cpp: 0.235, icms_iss: 0.000, ipi: 0.350 }],
    ],
  },
  III: {
    nome: 'Anexo III — Serviços (locação, agências, escritórios, academias e outros)',
    tipo: 'servico',
    faixas: [
      [1, 180000.00, 0.0600, 0.00, { irpj: 0.040, csll: 0.035, cofins: 0.1282, pis: 0.0278, cpp: 0.434, icms_iss: 0.335 }],
      [2, 360000.00, 0.1120, 9360.00, { irpj: 0.040, csll: 0.035, cofins: 0.1405, pis: 0.0305, cpp: 0.434, icms_iss: 0.320 }],
      [3, 720000.00, 0.1350, 17640.00, { irpj: 0.040, csll: 0.035, cofins: 0.1364, pis: 0.0296, cpp: 0.434, icms_iss: 0.325 }],
      [4, 1800000.00, 0.1600, 35640.00, { irpj: 0.040, csll: 0.035, cofins: 0.1364, pis: 0.0296, cpp: 0.434, icms_iss: 0.325 }],
      [5, 3600000.00, 0.2100, 125640.00, { irpj: 0.125, csll: 0.155, cofins: 0.1782, pis: 0.0388, cpp: 0.288, icms_iss: 0.150 }],
      [6, 4800000.00, 0.3300, 648000.00, { irpj: 0.350, csll: 0.150, cofins: 0.1603, pis: 0.0347, cpp: 0.305, icms_iss: 0.000 }],
    ],
  },
  IV: {
    nome: 'Anexo IV — Serviços (construção, limpeza, vigilância, advocacia)',
    tipo: 'servico',
    faixas: [
      [1, 180000.00, 0.0450, 0.00, { irpj: 0.1880, csll: 0.1520, cofins: 0.1767, pis: 0.0383, cpp: 0.000, icms_iss: 0.445 }],
      [2, 360000.00, 0.0900, 8100.00, { irpj: 0.1980, csll: 0.1520, cofins: 0.2055, pis: 0.0445, cpp: 0.000, icms_iss: 0.400 }],
      [3, 720000.00, 0.1020, 12420.00, { irpj: 0.2080, csll: 0.1520, cofins: 0.1973, pis: 0.0427, cpp: 0.000, icms_iss: 0.400 }],
      [4, 1800000.00, 0.1400, 39780.00, { irpj: 0.1780, csll: 0.1920, cofins: 0.1890, pis: 0.0410, cpp: 0.000, icms_iss: 0.400 }],
      [5, 3600000.00, 0.2200, 183780.00, { irpj: 0.1880, csll: 0.1920, cofins: 0.1817, pis: 0.0393, cpp: 0.000, icms_iss: 0.400 }],
      [6, 4800000.00, 0.3300, 828000.00, { irpj: 0.5350, csll: 0.2150, cofins: 0.2055, pis: 0.0445, cpp: 0.000, icms_iss: 0.000 }],
    ],
  },
  V: {
    nome: 'Anexo V — Serviços (fator R inferior a 28%)',
    tipo: 'servico',
    faixas: [
      [1, 180000.00, 0.1550, 0.00, { irpj: 0.250, csll: 0.150, cofins: 0.1410, pis: 0.0305, cpp: 0.2885, icms_iss: 0.140 }],
      [2, 360000.00, 0.1800, 4500.00, { irpj: 0.230, csll: 0.150, cofins: 0.1410, pis: 0.0305, cpp: 0.2785, icms_iss: 0.170 }],
      [3, 720000.00, 0.1950, 9900.00, { irpj: 0.240, csll: 0.150, cofins: 0.1492, pis: 0.0323, cpp: 0.2385, icms_iss: 0.190 }],
      [4, 1800000.00, 0.2050, 17100.00, { irpj: 0.210, csll: 0.150, cofins: 0.1574, pis: 0.0341, cpp: 0.2385, icms_iss: 0.210 }],
      [5, 3600000.00, 0.2300, 62100.00, { irpj: 0.230, csll: 0.125, cofins: 0.1410, pis: 0.0305, cpp: 0.2385, icms_iss: 0.235 }],
      [6, 4800000.00, 0.3050, 540000.00, { irpj: 0.350, csll: 0.155, cofins: 0.1644, pis: 0.0356, cpp: 0.2950, icms_iss: 0.000 }],
    ],
  },
};

/**
 * Faixas representativas usadas na SIMULAÇÃO quando o faturamento do
 * fornecedor é desconhecido (item 12). Cinco cenários, do menor ao maior.
 * O RBT12 de referência é o ponto médio da faixa, para que a alíquota
 * efetiva calculada seja representativa e não o extremo do intervalo.
 */
const CENARIOS_SIMULACAO = [
  { faixa: 1, rotulo: 'Faixa inferior', rbt12: 120000 },
  { faixa: 2, rotulo: 'Faixa intermediária inferior', rbt12: 300000 },
  { faixa: 3, rotulo: 'Faixa intermediária', rbt12: 600000 },
  { faixa: 4, rotulo: 'Faixa intermediária superior', rbt12: 1400000 },
  { faixa: 5, rotulo: 'Faixa superior', rbt12: 3000000 },
];

module.exports = { ANEXOS, CENARIOS_SIMULACAO };
