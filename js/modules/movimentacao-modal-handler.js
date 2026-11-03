// js/modules/movimentacao-modal-handler.js
import { Timestamp, serverTimestamp, doc, increment, writeBatch } from "firebase/firestore";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { capitalizeString, formatTimestamp } from "../utils/formatters.js";
import { COLLECTIONS, db } from "../services/firestore-service.js";
import {
    getUserRole,
    getEstoqueAgua, setEstoqueAgua,
    getEstoqueGas, setEstoqueGas,
    getAguaMovimentacoes, setAguaMovimentacoes,
    getGasMovimentacoes, setGasMovimentacoes,
} from "../utils/cache.js";

const RESUMO_DOC_ID          = 'resumo-agua';
const RESUMO_DOC_TIPO        = '__resumo__';
const RESUMO_UNIDADES_DOC_ID = 'resumo-unidades-agua';
const RESUMO_GAS_DOC_ID      = 'resumo-gas';

// Mesmo corte usado em gas-control.js/dashboard.js: movimentações anteriores
// a esta data não contam no estoque de gás, logo não entram no resumo.
const GAS_CUTOFF_MS = new Date('2026-04-30T00:00:00.000').getTime();

function _reenableLancamentoButtons() {
    if (DOM_ELEMENTS.btnSubmitAgua) DOM_ELEMENTS.btnSubmitAgua.disabled = false;
    if (DOM_ELEMENTS.btnSubmitGas) DOM_ELEMENTS.btnSubmitGas.disabled = false;
}

/** Fecha o modal de confirmação e libera de novo os botões de lançar. */
export function cancelarMovimentacaoModal() {
    if (DOM_ELEMENTS.almoxarifadoResponsavelModal) {
        DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'none';
    }
    if (DOM_ELEMENTS.inputAlmoxResponsavelNome) DOM_ELEMENTS.inputAlmoxResponsavelNome.value = '';
    showAlert('alert-almox-responsavel', '', 'info', 1);
    _reenableLancamentoButtons();
}

/** Ajusta o cache local na hora, para o painel de estoque cair sem esperar o realtime. */
function _aplicarLancamentoNoCache({ itemType, unidadeId, unidadeNome, tipoUnidade, qtdEntregue, qtdRetorno, dataTemp, nomeAlmoxarifado, responsavelUnidade }) {
    const agora = Timestamp.now();
    const pushMov = (tipo, quantidade) => {
        if (quantidade <= 0) return;
        const mov = {
            id: `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            unidadeId, unidadeNome, tipoUnidade,
            tipo, quantidade,
            data: dataTemp,
            responsavel: responsavelUnidade,
            responsavelAlmoxarifado: nomeAlmoxarifado,
            registradoEm: agora,
        };
        if (itemType === 'agua') {
            setAguaMovimentacoes([mov, ...(getAguaMovimentacoes() || [])].slice(0, 90));
        } else {
            setGasMovimentacoes([mov, ...(getGasMovimentacoes() || [])].slice(0, 300));
        }
    };
    pushMov('entrega', qtdEntregue);
    pushMov('retorno', qtdRetorno);

    if (itemType === 'agua') {
        const est = [...(getEstoqueAgua() || [])];
        const bump = (id, tipo, fieldEnt, fieldRec) => {
            const idx = est.findIndex(e => e.id === id || e.tipo === tipo);
            const base = idx >= 0 ? { ...est[idx] } : { id, tipo };
            if (qtdEntregue > 0) {
                if (fieldEnt === 'totalSaidas') base.totalSaidas = (parseInt(base.totalSaidas, 10) || 0) + qtdEntregue;
                else {
                    base.saldos = { ...(base.saldos || {}) };
                    const u = { ...(base.saldos[unidadeId] || { entregues: 0, recebidos: 0 }) };
                    u.entregues = (parseInt(u.entregues, 10) || 0) + qtdEntregue;
                    base.saldos[unidadeId] = u;
                }
            }
            if (qtdRetorno > 0) {
                if (fieldRec === 'totalRetornos') base.totalRetornos = (parseInt(base.totalRetornos, 10) || 0) + qtdRetorno;
                else {
                    base.saldos = { ...(base.saldos || {}) };
                    const u = { ...(base.saldos[unidadeId] || { entregues: 0, recebidos: 0 }) };
                    u.recebidos = (parseInt(u.recebidos, 10) || 0) + qtdRetorno;
                    base.saldos[unidadeId] = u;
                }
            }
            if (idx >= 0) est[idx] = base; else est.push(base);
        };
        bump('resumo-agua', '__resumo__', 'totalSaidas', 'totalRetornos');
        if (unidadeId) bump('resumo-unidades-agua', '__resumo_unidades__', 'saldos', 'saldos');
        setEstoqueAgua(est);
    } else {
        const est = [...(getEstoqueGas() || [])];
        const idx = est.findIndex(e => e.id === 'resumo-gas' || e.tipo === '__resumo__');
        const base = idx >= 0 ? { ...est[idx] } : { id: 'resumo-gas', tipo: '__resumo__', saldos: {} };
        if (qtdEntregue > 0) base.totalSaidas = (parseInt(base.totalSaidas, 10) || 0) + qtdEntregue;
        if (qtdRetorno > 0) base.totalRetornos = (parseInt(base.totalRetornos, 10) || 0) + qtdRetorno;
        if (unidadeId && (qtdEntregue > 0 || qtdRetorno > 0)) {
            base.saldos = { ...(base.saldos || {}) };
            const u = { ...(base.saldos[unidadeId] || { entregues: 0, recebidos: 0 }) };
            if (qtdEntregue > 0) u.entregues = (parseInt(u.entregues, 10) || 0) + qtdEntregue;
            if (qtdRetorno > 0) u.recebidos = (parseInt(u.recebidos, 10) || 0) + qtdRetorno;
            base.saldos[unidadeId] = u;
        }
        if (idx >= 0) est[idx] = base; else est.push(base);
        setEstoqueGas(est);
    }
}

/**
 * Adiciona ao batch os increments dos docs de resumo (totais e saldos por
 * unidade), para que movimentação + resumo sejam gravados atomicamente.
 */
function _appendResumoToBatch(batch, { itemType, unidadeId, qtdEntregue, qtdRetorno, dataTemp }) {
    if (qtdEntregue <= 0 && qtdRetorno <= 0) return;

    const isGas = itemType === 'gas';
    if (isGas && dataTemp.toMillis() < GAS_CUTOFF_MS) return; // fora do corte: não contabiliza

    const estoqueCol = isGas ? COLLECTIONS.estoqueGas : COLLECTIONS.estoqueAgua;
    const resumoRef  = doc(estoqueCol, isGas ? RESUMO_GAS_DOC_ID : RESUMO_DOC_ID);

    const totais = { tipo: RESUMO_DOC_TIPO, atualizadoEm: serverTimestamp() };
    if (qtdEntregue > 0) totais.totalSaidas   = increment(qtdEntregue);
    if (qtdRetorno  > 0) totais.totalRetornos = increment(qtdRetorno);

    const saldoUnidade = {};
    if (qtdEntregue > 0) saldoUnidade.entregues = increment(qtdEntregue);
    if (qtdRetorno  > 0) saldoUnidade.recebidos = increment(qtdRetorno);

    if (isGas) {
        // Gás: totais e saldos por unidade no mesmo doc resumo-gas
        if (unidadeId) totais.saldos = { [unidadeId]: saldoUnidade };
        batch.set(resumoRef, totais, { merge: true });
    } else {
        batch.set(resumoRef, totais, { merge: true });
        if (unidadeId) {
            const saldosRef = doc(estoqueCol, RESUMO_UNIDADES_DOC_ID);
            batch.set(saldosRef, {
                tipo: '__resumo_unidades__',
                atualizadoEm: serverTimestamp(),
                saldos: { [unidadeId]: saldoUnidade }
            }, { merge: true });
        }
    }
}

/**
 * Abre o modal para confirmação do responsável do almoxarifado antes de salvar a movimentação.
 * @param {Object} data Dados da movimentação.
 */
export function executeFinalMovimentacao(data) {
    if (!DOM_ELEMENTS.almoxarifadoResponsavelModal) return;

    const { tipoMovimentacao, qtdEntregue, qtdRetorno, itemType } = data;
    const itemLabel = itemType === 'agua' ? 'galão(ões) 20L' : 'botijão(ões)';

    const tempUnidadeIdEl          = document.getElementById('almox-temp-unidadeId');
    const tempUnidadeNomeEl        = document.getElementById('almox-temp-unidadeNome');
    const tempTipoUnidadeRawEl     = document.getElementById('almox-temp-tipoUnidadeRaw');
    const tempTipoMovimentacaoEl   = document.getElementById('almox-temp-tipoMovimentacao');
    const tempQtdEntregueEl        = document.getElementById('almox-temp-qtdEntregue');
    const tempQtdRetornoEl         = document.getElementById('almox-temp-qtdRetorno');
    const tempDataEl               = document.getElementById('almox-temp-data');
    const tempResponsavelUnidadeEl = document.getElementById('almox-temp-responsavelUnidade');
    const tempItemTypeEl           = document.getElementById('almox-temp-itemType');

    if (!tempUnidadeIdEl || !tempUnidadeNomeEl || !tempTipoUnidadeRawEl || !tempTipoMovimentacaoEl ||
        !tempQtdEntregueEl || !tempQtdRetornoEl || !tempDataEl || !tempResponsavelUnidadeEl || !tempItemTypeEl) {
        console.error("Erro: Um ou mais campos hidden do modal de movimentação não foram encontrados no HTML.");
        showAlert(itemType === 'agua' ? 'alert-agua' : 'alert-gas', 'Erro interno: Falha ao preparar modal. Recarregue a página.', 'error');
        return;
    }

    tempUnidadeIdEl.value          = data.unidadeId || '';
    tempUnidadeNomeEl.value        = data.unidadeNome || '';
    tempTipoUnidadeRawEl.value     = data.tipoUnidadeRaw || '';
    tempTipoMovimentacaoEl.value   = tipoMovimentacao || '';
    tempQtdEntregueEl.value        = qtdEntregue || 0;
    tempQtdRetornoEl.value         = qtdRetorno || 0;
    tempDataEl.value               = data.data ? data.data.toMillis() : '';
    tempResponsavelUnidadeEl.value = data.responsavelUnidade || '';
    tempItemTypeEl.value           = itemType || '';

    const modalTitle = DOM_ELEMENTS.almoxarifadoResponsavelModal.querySelector('.modal-title');
    const modalBody  = DOM_ELEMENTS.almoxarifadoResponsavelModal.querySelector('.modal-body p');
    const btnConfirm = DOM_ELEMENTS.btnSalvarMovimentacaoFinal;

    let bodyText = '';
    let btnText  = '';
    let icon     = 'save';

    if (tipoMovimentacao === 'entrega' || (tipoMovimentacao === 'troca' && qtdEntregue > 0 && qtdRetorno === 0)) {
        bodyText = `Informe seu nome (Responsável do Almoxarifado) para registrar quem está realizando a **entrega** de **${qtdEntregue}** ${itemLabel} cheio(s). Esta informação é crucial para o rastreio.`;
        btnText  = `Confirmar Entrega`;
        icon     = 'package-open';
    } else if (tipoMovimentacao === 'retorno' || (tipoMovimentacao === 'troca' && qtdRetorno > 0 && qtdEntregue === 0)) {
        bodyText = `Informe seu nome (Responsável do Almoxarifado) para registrar quem está realizando o **recebimento** de **${qtdRetorno}** ${itemLabel} vazio(s). Esta informação é crucial para o rastreio.`;
        btnText  = `Confirmar Recebimento`;
        icon     = 'package-check';
    } else if (tipoMovimentacao === 'troca' && qtdEntregue > 0 && qtdRetorno > 0) {
        bodyText = `Informe seu nome (Responsável do Almoxarifado) para registrar a **troca**: entrega de **${qtdEntregue}** cheio(s) e recebimento de **${qtdRetorno}** vazio(s).`;
        btnText  = 'Confirmar Troca';
        icon     = 'refresh-cw';
    } else {
        bodyText = `Informe seu nome (Responsável do Almoxarifado) para finalizar a movimentação.`;
        btnText  = `Confirmar Movimentação`;
    }

    if (modalBody)   modalBody.innerHTML = bodyText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    if (btnConfirm)  btnConfirm.innerHTML = `<i data-lucide="${icon}"></i> ${btnText}`;
    if (modalTitle)  modalTitle.innerHTML = `<i data-lucide="box" class="w-5 h-5"></i> Confirmação de Movimentação (${itemType === 'agua' ? 'Água' : 'Gás'})`;

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'flex';
    if (DOM_ELEMENTS.inputAlmoxResponsavelNome) {
        DOM_ELEMENTS.inputAlmoxResponsavelNome.value = '';
        DOM_ELEMENTS.inputAlmoxResponsavelNome.focus();
    }
    showAlert('alert-almox-responsavel', '', 'info', 1);
}

/**
 * Handler para o clique final no modal de movimentação.
 */
export async function handleFinalMovimentacaoSubmit() {
    const nomeAlmoxarifado = capitalizeString(DOM_ELEMENTS.inputAlmoxResponsavelNome.value.trim());

    if (!nomeAlmoxarifado) {
        showAlert('alert-almox-responsavel', 'Por favor, informe seu nome (Almoxarifado) para registrar a entrega/recebimento.', 'warning');
        return;
    }

    const unidadeId          = document.getElementById('almox-temp-unidadeId')?.value;
    const unidadeNome        = document.getElementById('almox-temp-unidadeNome')?.value;
    const tipoUnidadeRaw     = document.getElementById('almox-temp-tipoUnidadeRaw')?.value;
    const tipoMovimentacao   = document.getElementById('almox-temp-tipoMovimentacao')?.value;
    const qtdEntregueStr     = document.getElementById('almox-temp-qtdEntregue')?.value;
    const qtdRetornoStr      = document.getElementById('almox-temp-qtdRetorno')?.value;
    const dataMillisStr      = document.getElementById('almox-temp-data')?.value;
    const responsavelUnidade = document.getElementById('almox-temp-responsavelUnidade')?.value;
    const itemType           = document.getElementById('almox-temp-itemType')?.value;

    if (!unidadeId || !unidadeNome || !tipoMovimentacao || !dataMillisStr || !responsavelUnidade || !itemType) {
        console.error("Erro: Falha ao ler dados temporários do modal.", {
            unidadeId, unidadeNome, tipoMovimentacao, dataMillisStr, responsavelUnidade, itemType
        });
        showAlert('alert-almox-responsavel', 'Erro interno ao recuperar dados da movimentação. Tente novamente.', 'error');
        return;
    }

    const qtdEntregue = parseInt(qtdEntregueStr, 10);
    const qtdRetorno  = parseInt(qtdRetornoStr, 10);
    const dataMillis  = parseInt(dataMillisStr, 10);
    const itemLabel   = itemType === 'agua' ? 'galão(ões) 20L' : 'botijão(ões)';

    if (isNaN(qtdEntregue) || isNaN(qtdRetorno) || isNaN(dataMillis)) {
        console.error("Erro: Falha ao converter quantidades ou data.", { qtdEntregueStr, qtdRetornoStr, dataMillisStr });
        showAlert('alert-almox-responsavel', 'Erro interno nos dados numéricos da movimentação. Tente novamente.', 'error');
        return;
    }

    const btnModal    = DOM_ELEMENTS.btnSalvarMovimentacaoFinal;
    const alertId     = itemType === 'agua' ? 'alert-agua' : 'alert-gas';
    const formToReset = itemType === 'agua' ? DOM_ELEMENTS.formAgua : DOM_ELEMENTS.formGas;
    const collection  = itemType === 'agua' ? COLLECTIONS.aguaMov : COLLECTIONS.gasMov;

    const role = getUserRole();
    if (role !== 'admin' && role !== 'editor') {
        showAlert(alertId, "Permissão negada. Apenas Admin/Editor pode registrar movimentações.", 'error');
        return;
    }

    btnModal.disabled   = true;
    btnModal.innerHTML  = '<div class="loading-spinner-small mx-auto"></div>';

    const dataTemp    = Timestamp.fromMillis(dataMillis);
    const tipoUnidade = (tipoUnidadeRaw || '').toUpperCase() === 'SEMCAS'
        ? 'SEDE'
        : (tipoUnidadeRaw || '').toUpperCase();

    let msgSucesso = [];

    try {
        // Água: só grava saída se ainda houver saldo (revalida no confirmar)
        if (itemType === 'agua' && qtdEntregue > 0) {
            const { assertSaidaAguaPermitida } = await import("./agua/agua-control.js");
            assertSaidaAguaPermitida(qtdEntregue);
        }

        const timestamp = serverTimestamp();

        // Movimentações + resumos gravados num ÚNICO batch atômico:
        // ou tudo entra (docs + increments dos resumos), ou nada entra.
        // Isso elimina o drift entre movimentações e o doc resumo.
        const batch = writeBatch(db);

        // 1. ENTREGA (SAÍDA DE ESTOQUE)
        if (qtdEntregue > 0) {
            batch.set(doc(collection), {
                unidadeId,
                unidadeNome,
                tipoUnidade,
                tipo: 'entrega',
                quantidade: qtdEntregue,
                data: dataTemp,
                responsavel: responsavelUnidade,
                responsavelAlmoxarifado: nomeAlmoxarifado,
                registradoEm: timestamp
            });
            msgSucesso.push(`${qtdEntregue} ${itemLabel} entregue(s)`);
        }

        // 2. RETORNO (ENTRADA EM ESTOQUE VAZIO/CRÉDITO)
        if (qtdRetorno > 0) {
            batch.set(doc(collection), {
                unidadeId,
                unidadeNome,
                tipoUnidade,
                tipo: 'retorno',
                quantidade: qtdRetorno,
                data: dataTemp,
                responsavel: responsavelUnidade,
                responsavelAlmoxarifado: nomeAlmoxarifado,
                registradoEm: timestamp
            });
            msgSucesso.push(`${qtdRetorno} ${itemLabel} recebido(s)`);
        }

        // 3. RESUMOS (totais + saldos por unidade), no mesmo batch
        _appendResumoToBatch(batch, { itemType, unidadeId, qtdEntregue, qtdRetorno, dataTemp });

        await batch.commit();

        // Estoque na tela cai na hora (antes do listener realtime)
        if (dataTemp.toMillis() >= GAS_CUTOFF_MS || itemType === 'agua') {
            _aplicarLancamentoNoCache({
                itemType, unidadeId, unidadeNome, tipoUnidade,
                qtdEntregue, qtdRetorno, dataTemp, nomeAlmoxarifado, responsavelUnidade,
            });
        }

        showAlert(alertId, `Movimentação salva! ${msgSucesso.join('; ')}.`, 'success');

        if (formToReset) formToReset.reset();

        const dataInputEl = itemType === 'agua' ? DOM_ELEMENTS.inputDataAgua : DOM_ELEMENTS.inputDataGas;
        if (dataInputEl) {
            const dateObj = dataTemp.toDate();
            const yyyy    = dateObj.getFullYear();
            const mm      = String(dateObj.getMonth() + 1).padStart(2, '0');
            const dd      = String(dateObj.getDate()).padStart(2, '0');
            dataInputEl.value = `${yyyy}-${mm}-${dd}`;
        }

        const tipoSelectEl = itemType === 'agua' ? DOM_ELEMENTS.selectTipoAgua : DOM_ELEMENTS.selectTipoGas;
        if (tipoSelectEl) tipoSelectEl.value = 'troca';

        DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'none';
        _reenableLancamentoButtons();

        try {
            if (itemType === 'agua') {
                const { renderEstoqueAgua, onAguaTabChange } = await import("./agua/agua-control.js");
                renderEstoqueAgua?.();
                onAguaTabChange?.();
            } else {
                const { renderEstoqueGas, onGasTabChange } = await import("./gas/gas-control.js");
                renderEstoqueGas?.();
                onGasTabChange?.();
            }
        } catch (e) {
            console.warn('Falha ao re-renderizar estoque após lançamento:', e?.message || e);
        }

    } catch (error) {
        console.error(`Erro final ao salvar movimentação (${itemType}):`, error);

        let displayMessage = `Falha ao salvar troca. Verifique o console.`;

        if (error.message && error.message.toLowerCase().includes('permission-denied')) {
            const collectionName = itemType === 'agua' ? 'controleAgua' : 'controleGas';
            displayMessage = `Erro de Permissão: O seu papel (**Editor**) não tem permissão de **Escrita** (write/create) para a coleção de movimentação (*${collectionName}*). **Verifique se as regras do Firestore estão corretamente publicadas!**`;
        } else if (error.message && /saldo disponível|estoque insuficiente|estoque inicial/i.test(error.message)) {
            displayMessage = error.message;
        } else if (error.message) {
            displayMessage = `Erro inesperado: ${error.message}`;
        }

        showAlert(alertId, `Erro ao salvar movimentação: ${displayMessage}`, 'error');
        showAlert('alert-almox-responsavel', `Erro ao salvar: ${displayMessage}. Tente novamente.`, 'error');
        _reenableLancamentoButtons();
    } finally {
        btnModal.disabled  = false;
        btnModal.innerHTML = '<i data-lucide="save"></i> Confirmar Movimentação';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        if (DOM_ELEMENTS.inputAlmoxResponsavelNome) DOM_ELEMENTS.inputAlmoxResponsavelNome.value = '';
    }
}
