// js/modules/movimentacao-modal-handler.js
import { Timestamp, addDoc, serverTimestamp, doc, setDoc, increment } from "firebase/firestore";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { capitalizeString, formatTimestamp } from "../utils/formatters.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { getUserRole } from "../utils/cache.js";

const RESUMO_DOC_ID   = 'resumo-agua';
const RESUMO_DOC_TIPO = '__resumo__';

/**
 * Atualiza o doc resumo-agua em estoqueAgua com os totais
 * acumulados de saídas e retornos. Usa increment() — atomicamente seguro.
 * Não lança exceção (falha silenciosa para não bloquear o fluxo principal).
 */
async function _atualizarResumo(itemType, qtdEntregue, qtdRetorno) {
    try {
        const estoqueCol = itemType === 'agua' ? COLLECTIONS.estoqueAgua : null;
        if (!estoqueCol) return; // Gas ainda usa abordagem legacy
        const resumoRef = doc(estoqueCol, RESUMO_DOC_ID);
        const update = { tipo: RESUMO_DOC_TIPO, atualizadoEm: serverTimestamp() };
        if (qtdEntregue > 0) update.totalSaidas   = increment(qtdEntregue);
        if (qtdRetorno  > 0) update.totalRetornos = increment(qtdRetorno);
        if (qtdEntregue > 0 || qtdRetorno > 0) {
            await setDoc(resumoRef, update, { merge: true });
        }
    } catch (err) {
        console.warn('[resumo-agua] Falha ao atualizar (não crítico):', err);
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

    let msgSucesso       = [];
    let operacoesComErro = 0;

    try {
        const timestamp = serverTimestamp();

        // 1. ENTREGA (SAÍDA DE ESTOQUE)
        if (qtdEntregue > 0) {
            try {
                await addDoc(collection, {
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
            } catch (error) {
                console.error(`Erro ao salvar entrega (${itemType}):`, error);
                operacoesComErro++;
                throw error;
            }
        }

        // 2. RETORNO (ENTRADA EM ESTOQUE VAZIO/CRÉDITO)
        if (qtdRetorno > 0) {
            try {
                await addDoc(collection, {
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
            } catch (error) {
                console.error(`Erro ao salvar retorno (${itemType}):`, error);
                operacoesComErro++;
                throw error;
            }
        }

        if (operacoesComErro > 0) {
            throw new Error("Erro de Escrita (Verifique o console para detalhes).");
        }

        showAlert(alertId, `Movimentação salva! ${msgSucesso.join('; ')}.`, 'success');

        if (itemType === 'agua') {
            _atualizarResumo('agua', qtdEntregue > 0 ? qtdEntregue : 0, qtdRetorno > 0 ? qtdRetorno : 0);
        }

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

    } catch (error) {
        console.error(`Erro final ao salvar movimentação (${itemType}):`, error);

        let displayMessage = `Falha ao salvar troca. Verifique o console.`;

        if (error.message && error.message.toLowerCase().includes('permission-denied')) {
            const collectionName = itemType === 'agua' ? 'controleAgua' : 'controleGas';
            displayMessage = `Erro de Permissão: O seu papel (**Editor**) não tem permissão de **Escrita** (write/create) para a coleção de movimentação (*${collectionName}*). **Verifique se as regras do Firestore estão corretamente publicadas!**`;
        } else if (error.message) {
            displayMessage = `Erro inesperado: ${error.message}`;
        }

        showAlert(alertId, `Erro ao salvar movimentação: ${displayMessage}`, 'error');
        showAlert('alert-almox-responsavel', `Erro ao salvar: ${displayMessage}. Tente novamente.`, 'error');
    } finally {
        btnModal.disabled  = false;
        btnModal.innerHTML = '<i data-lucide="save"></i> Confirmar Movimentação';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        if (DOM_ELEMENTS.inputAlmoxResponsavelNome) DOM_ELEMENTS.inputAlmoxResponsavelNome.value = '';
    }
}
