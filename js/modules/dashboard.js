// js/modules/dashboard.js

// ...
// existing code continues below

// Narração da TV: fala só a mudança de status, uma frase por vez.
const tvNarracaoFila = [];
let tvNarracaoBasePronta = false;
let tvPrimeiroDadoEm = 0;
const tvStatusAnterior = new Map();

const TV_VOZ_STORAGE_KEY = 'tv-voz-liberada';

function carregarEstadoVozPersistido() {
    try {
        const valor = localStorage.getItem(TV_VOZ_STORAGE_KEY);
        if (valor === '1') {
            tvVozLiberada = true;
            esconderAvisoVoz();
            logVoz('voz liberada restaurada do storage');
        }
    } catch (_) {}
}

function salvarEstadoVozPersistido() {
    try {
        localStorage.setItem(TV_VOZ_STORAGE_KEY, tvVozLiberada ? '1' : '0');
    } catch (_) {}
}

function nomeParaFala(nome) {
    return String(nome || 'Unidade')
        .replace(/[\/|–—-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ─── Motor de som da TV ───────────────────���───────────────────────
// ...
