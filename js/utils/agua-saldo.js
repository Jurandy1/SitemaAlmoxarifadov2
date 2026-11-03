// =========================================================================
// SALDO DE ÁGUA — fonte única do cálculo (painel de Água, cards e dashboard)
// -------------------------------------------------------------------------
// Saldo = Estoque Inicial + Entradas + Ajuste − Saídas.
//
// O histórico de movimentações é a fonte da verdade e NÃO é alterado.
// Se a conta antiga ficou negativa (mais saídas no histórico do que
// entradas registradas), essa diferença é ignorada: gravamos um único doc
// de ajuste ("ajuste-saldo-agua") em estoqueAgua que leva o saldo a 0.
// A partir daí cada Entrada soma e cada Saída diminui normalmente.
// =========================================================================
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { getEstoqueAgua, getAguaMovimentacoes, getUserRole } from "./cache.js";
import { COLLECTIONS } from "../services/firestore-service.js";

export const AJUSTE_SALDO_AGUA_DOC_ID = 'ajuste-saldo-agua';

// Tudo lançado antes desta data entra no "passado" que é zerado; Entradas
// a partir dela (inclusive as de hoje) somam normalmente no saldo.
const INICIO_NOVA_CONTAGEM_MS = new Date('2026-11-03T00:00:00-03:00').getTime();

let _ajustando = false;

function _toMs(v) {
    if (!v) return 0;
    if (typeof v === 'number') return v;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    return 0;
}

function _isHistImportado(m) {
    if (!m) return false;
    if (m.origem === 'importador_sql') return true;
    if (String(m.observacao ?? '').toLowerCase().includes('importado de sql')) return true;
    if (typeof m.referenciaAno === 'number' || typeof m.referenciaMes === 'number'
        || typeof m.referenciaSemana === 'number') return true;
    return false;
}

function _getResumo(estoque) {
    return (estoque || []).find(e =>
        e.tipo === '__resumo__' || e.tipo === 'resumo-acumulado' ||
        e.id === 'resumo-agua' || e.id === 'resumo-acumulado') || null;
}

function _soma(estoque, tipo) {
    return (estoque || [])
        .filter(e => e.tipo === tipo)
        .reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
}

/**
 * Calcula o saldo de água a partir do cache.
 * estoqueAtual: disponível para saída (nunca negativo).
 * estoqueBruto: valor do livro já com o ajuste.
 */
export function calcularSaldoAgua(fallbackResumo = null) {
    const estoque = getEstoqueAgua() || [];

    const estoqueInicial = _soma(estoque, 'inicial');
    const totalEntradas  = _soma(estoque, 'entrada');
    const ajuste         = _soma(estoque, 'ajuste');

    const resumo = _getResumo(estoque) || fallbackResumo;
    let totalSaidas;
    if (resumo && typeof resumo.totalSaidas === 'number') {
        totalSaidas = resumo.totalSaidas;
    } else {
        // Resumo ainda não carregado: cache limitado (só as mais recentes)
        totalSaidas = (getAguaMovimentacoes() || [])
            .filter(m => m.tipo === 'entrega' && !_isHistImportado(m))
            .reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);
    }

    const estoqueBruto = estoqueInicial + totalEntradas + ajuste - totalSaidas;
    return {
        estoqueInicial,
        totalEntradas,
        totalSaidas,
        ajuste,
        estoqueAtual: Math.max(0, estoqueBruto),
        estoqueBruto,
    };
}

/**
 * Se o passado (antes de INICIO_NOVA_CONTAGEM) deixou o saldo negativo, grava
 * (só no doc de ajuste, nunca no histórico) o valor que zera esse passado.
 * Entradas a partir dessa data aparecem no saldo normalmente.
 */
export async function zerarSaldoNegativoAgua() {
    if (_ajustando) return;
    const role = getUserRole();
    if (role !== 'admin' && role !== 'editor') return;

    const estoque = getEstoqueAgua() || [];
    if (!estoque.some(e => e.tipo === 'inicial')) return;
    // Ajuste é gravado UMA vez e fica congelado: depois dele, Saídas novas
    // diminuem o saldo normalmente (não podem ser "compensadas" de novo).
    if (estoque.some(e => e.tipo === 'ajuste' || e.id === AJUSTE_SALDO_AGUA_DOC_ID)) return;
    // Só com o resumo real carregado (o fallback do cache subconta saídas)
    const resumo = _getResumo(estoque);
    if (!resumo || typeof resumo.totalSaidas !== 'number') return;

    // Déficit do passado: Inicial + Entradas antigas − Saídas do histórico.
    // Entradas sem registradoEm ainda pendente (recém-lançadas) contam como novas.
    const entradasAntigas = estoque
        .filter(e => e.tipo === 'entrada')
        .filter(e => { const ms = _toMs(e.registradoEm) || _toMs(e.data); return ms && ms < INICIO_NOVA_CONTAGEM_MS; })
        .reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
    const deficitPassado = resumo.totalSaidas - _soma(estoque, 'inicial') - entradasAntigas;
    const ajusteNecessario = Math.max(0, deficitPassado);
    if (ajusteNecessario <= 0) return;

    _ajustando = true;
    try {
        const novoAjuste = ajusteNecessario;
        await setDoc(doc(COLLECTIONS.estoqueAgua, AJUSTE_SALDO_AGUA_DOC_ID), {
            tipo: 'ajuste',
            quantidade: novoAjuste,
            motivo: 'Saldo negativo antigo ignorado (histórico preservado). Contagem recomeça do zero.',
            atualizadoEm: serverTimestamp(),
        });
        console.info('[AGUA] Saldo negativo zerado com ajuste de', novoAjuste);
    } catch (err) {
        console.warn('[AGUA] Não foi possível zerar o saldo negativo:', err?.message || err);
    } finally {
        _ajustando = false;
    }
}
