// js/utils/formatters.js
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js"; 

/**
 * Retorna a string de data de hoje no formato YYYY-MM-DD.
 * @returns {string} Data de hoje.
 */
function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

/**
 * Converte uma string de data (YYYY-MM-DD) para um Timestamp do Firestore.
 * @param {string} dateString Data no formato YYYY-MM-DD.
 * @returns {Timestamp | null} Timestamp do Firestore.
 */
function dateToTimestamp(dateString) {
     if (!dateString) return null;
    try {
        const date = new Date(dateString + 'T00:00:00'); 
        if (isNaN(date.getTime())) return null; 
        return Timestamp.fromDate(date);
    } catch (e) { console.error("Erro ao converter data:", dateString, e); return null; }
}

/**
 * Formata um Timestamp para DD/MM/YYYY.
 * @param {Timestamp} timestamp Timestamp do Firestore.
 * @returns {string} Data formatada.
 */
function formatTimestamp(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') return 'N/A';
    try {
        const date = timestamp.toDate();
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        if (yyyy < 2000) return 'Data Inválida';
        return `${dd}/${mm}/${yyyy}`;
    } catch (e) { console.error("Erro ao formatar timestamp:", timestamp, e); return 'Erro Data'; }
}

/**
 * Formata um Timestamp para DD/MM/YYYY HH:MM.
 * @param {Timestamp} timestamp Timestamp do Firestore.
 * @returns {string} Data e hora formatada.
 */
function formatTimestampComTempo(timestamp) {
    if (!timestamp || typeof timestamp.toDate !== 'function') return 'N/A';
    try {
        return timestamp.toDate().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { console.error("Erro ao formatar timestamp com tempo:", timestamp, e); return 'Erro Data'; }
}

/**
 * Normaliza uma string (minúsculas, sem acentos).
 * @param {string} str String a ser normalizada.
 * @returns {string} String normalizada.
 */
function normalizeString(str) {
    if (!str) return '';
    return String(str).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Capitaliza cada palavra de uma string.
 * @param {string} str String a ser capitalizada.
 * @returns {string} String capitalizada.
 */
function capitalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/\b\w/g, char => char.toUpperCase());
}


export { 
    getTodayDateString, 
    dateToTimestamp, 
    formatTimestamp, 
    formatTimestampComTempo, 
    normalizeString, 
    capitalizeString 
};
