/**
 * Referência tardia ao banco.
 * Módulos carregados durante a própria inicialização do db.js não podem
 * exigi-lo no topo — o require circular devolveria um módulo vazio. Este
 * wrapper resolve o db só quando ele é de fato usado.
 */
module.exports = () => require('../db');
