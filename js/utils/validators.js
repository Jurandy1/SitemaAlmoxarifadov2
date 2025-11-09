// js/utils/validators.js

/**
 * Verifica se a quantidade fornecida é válida (número positivo).
 * @param {number} quantity Quantidade a ser verificada.
 * @returns {boolean} True se for um número positivo, false caso contrário.
 */
function isValidQuantity(quantity) {
    return typeof quantity === 'number' && quantity > 0 && Number.isInteger(quantity);
}

/**
 * Verifica se a string não é nula, vazia ou apenas espaços em branco.
 * @param {string} str String a ser verificada.
 * @returns {boolean} True se for um texto válido, false caso contrário.
 */
function isValidString(str) {
    return typeof str === 'string' && str.trim().length > 0;
}

export { isValidQuantity, isValidString };
