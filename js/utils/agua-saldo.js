// =========================================================================
// SALDO DE ÁGUA — fonte única do cálculo (painel de Água, cards e dashboard)
// -------------------------------------------------------------------------
// Saldo = Estoque Inicial + Entradas − Saídas feitas DEPOIS do Inicial.
//
// O doc resumo-agua acumula as saídas de TODO o histórico (inclusive as
// entregas registradas antes de o Estoque Inicial ser definido, que já
// estavam refletidas na contagem física do Inicial). Contar essas saídas
// de novo deixava o saldo negativo — e, como a tela mostrava no mínimo 0,
// as Entradas novas "sumiam" (só pagavam a dívida invisível).
//
// Aqui calculamos, só lendo (nada é regravado no histórico nem no resumo),
// quanto do resumo veio de antes do Inicial e descontamos esse valor.
// =========================================================================
import { getDocs, query, where } from "firebase/firestore";
import { getEstoqueAgua, getAguaMovimentacoes } from "./cache.js";
import { COLLECTIONS } from "../services/firestore-service.js";

const LS_KEY = 'semcas_agua_saidas_pre_inicial_v1';
const RECALC_MS = 24 * 60 * 60 * 1000;

let _preInicial = _loadFromStorage(); // { key, value, at }
let _computing = false;

function _toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
}

// Mesmo critério usado para montar o resumo-agua (movimentações importadas
// do sistema antigo nunca entraram no resumo).
function _isHistImportado(m) {
    if (!m) return false;
    if (m.origem === 'importador_sql') return true;
    if (String(m.observacao ?? '').toLowerCase().includes('importado de sql')) return true;
    if (typeof m.referenciaAno === 'number' || typeof m.referenciaMes === 'number'
        || typeof m.referenciaSemana === 'number') return true;
    return false;
}

function _loadFromStorage() {
    try {
        const raw = globalThis.localStorage?.getItem(LS_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        return v && typeof v.value === 'number' ? v : null;
    } catch (_) { return null; }
}

function _saveToStorage(v) {
    try { globalThis.localStorage?.setItem(LS_KEY, JSON.stringify(v)); } catch (_) {}
}

function _getInicial(estoque) {
    const inicials = (estoque || []).filter(e => e.tipo === 'inicial');
    if (!inicials.length) return null;
    // Mais antigo = momento da contagem física de referência
    return inicials.reduce((a, b) => {
        const ma = _toMs(a.registradoEm) || _toMs(a.data);
        const mb = _toMs(b.registradoEm) || _toMs(b.data);
        return (mb && (!ma || mb < ma)) ? b : a;
    });
}

function _inicialKey(inicial) {
    if (!inicial) return '';
    return `${inicial.id}:${_toMs(inicial.registradoEm) || _toMs(inicial.data)}`;
}

function _getResumo(estoque) {
    return (estoque || []).find(e =>
        e.tipo === '__resumo__' || e.tipo === 'resumo-acumulado' ||
        e.id === 'resumo-agua' || e.id === 'resumo-acumulado') || null;
}

/** Saídas (já contadas no resumo) que foram registradas antes do Estoque Inicial. */
function _getSaidasPreInicial(estoque) {
    const key = _inicialKey(_getInicial(estoque));
    if (!key || !_preInicial || _preInicial.key !== key) return 0;
    return _preInicial.value;
}

/**
 * Calcula o saldo de água a partir do cache.
 * estoqueAtual: o que está disponível para saída (nunca negativo).
 * estoqueBruto: o valor real do livro (pode ficar negativo).
 */
export function calcularSaldoAgua(fallbackResumo = null) {
    const estoque = getEstoqueAgua() || [];

    const estoqueInicial = estoque
        .filter(e => e.tipo === 'inicial')
        .reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);

    const totalEntradas = estoque
        .filter(e => e.tipo === 'entrada')
        .reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);

    const resumo = _getResumo(estoque) || fallbackResumo;

    let totalSaidas;
    if (resumo && typeof resumo.totalSaidas === 'number') {
        totalSaidas = Math.max(0, resumo.totalSaidas - _getSaidasPreInicial(estoque));
    } else {
        // Resumo ainda não carregado: cache limitado (só as mais recentes),
        // contando apenas o que foi registrado depois do Inicial.
        const iniMs = (() => { const i = _getInicial(estoque); return i ? (_toMs(i.registradoEm) || _toMs(i.data)) : 0; })();
        totalSaidas = (getAguaMovimentacoes() || [])
            .filter(m => m.tipo === 'entrega' && !_isHistImportado(m))
            .filter(m => !iniMs || !_toMs(m.registradoEm) || _toMs(m.registradoEm) >= iniMs)
            .reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);
    }

    const estoqueBruto = estoqueInicial + totalEntradas - totalSaidas;
    return {
        estoqueInicial,
        totalEntradas,
        totalSaidas,
        estoqueAtual: Math.max(0, estoqueBruto),
        estoqueBruto,
    };
}

/**
 * Garante (1x por Estoque Inicial, revalidado a cada 24h) o desconto das
 * saídas anteriores ao Inicial. Somente LEITURA no Firestore.
 * Chama onUpdated() quando o valor muda, para re-renderizar as telas.
 */
export async function ensureAguaSaidasPreInicial(onUpdated) {
    if (_computing) return;
    const estoque = getEstoqueAgua() || [];
    const inicial = _getInicial(estoque);
    const key = _inicialKey(inicial);
    const iniMs = inicial ? (_toMs(inicial.registradoEm) || _toMs(inicial.data)) : 0;
    if (!key || !iniMs) return; // Inicial ainda sem timestamp do servidor

    const fresh = _preInicial && _preInicial.key === key && (Date.now() - (_preInicial.at || 0)) < RECALC_MS;
    if (fresh) return;

    _computing = true;
    try {
        const iniTs = inicial.registradoEm && typeof inicial.registradoEm.toMillis === 'function'
            ? inicial.registradoEm
            : inicial.data;
        // Saídas registradas DEPOIS do Inicial (campo único: índice automático).
        // Tudo o que o resumo tem além disso é anterior ao Inicial — inclusive
        // movimentações antigas que nem têm registradoEm.
        const snapPos = await getDocs(query(COLLECTIONS.aguaMov, where('registradoEm', '>=', iniTs)));
        let posInicial = 0;
        snapPos.docs.forEach(d => {
            const m = d.data();
            if (m.tipo !== 'entrega' || _isHistImportado(m)) return;
            posInicial += parseInt(m.quantidade, 10) || 0;
        });
        const resumo = _getResumo(getEstoqueAgua() || []);
        if (!resumo || typeof resumo.totalSaidas !== 'number') return; // tenta de novo no próximo snapshot
        const value = Math.max(0, resumo.totalSaidas - posInicial);

        const changed = !_preInicial || _preInicial.key !== key || _preInicial.value !== value;
        _preInicial = { key, value, at: Date.now() };
        _saveToStorage(_preInicial);
        console.info('[AGUA] Saídas anteriores ao Estoque Inicial (descontadas do saldo):', value);
        if (changed && typeof onUpdated === 'function') onUpdated();
    } catch (err) {
        console.warn('[AGUA] Não foi possível calcular saídas anteriores ao Inicial:', err?.message || err);
    } finally {
        _computing = false;
    }
}
