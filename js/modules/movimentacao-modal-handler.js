// js/modules/movimentacao-modal-handler.js
import { Timestamp, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { capitalizeString, formatTimestamp } from "../utils/formatters.js";
import { COLLECTIONS } from "../services/firestore-service.js";

// Variáveis temporárias para o fluxo
let almoxTempFields = {};

/**
 * Abre o modal para confirmação do responsável do almoxarifado antes de salvar a movimentação.
 * @param {Object} data Dados da movimentação.
 */
export function executeFinalMovimentacao(data) {
    if (!DOM_ELEMENTS.almoxarifadoResponsavelModal) return;

    almoxTempFields = data;
    
    const { tipoMovimentacao, qtdEntregue, qtdRetorno, itemType } = data;
    const itemLabel = itemType === 'agua' ? 'galão(ões)' : 'botijão(ões)';

    // Preenche os campos hidden do modal (assumindo que existem no HTML)
    const tempUnidadeIdEl = document.getElementById('almox-temp-unidadeId');
    const tempUnidadeNomeEl = document.getElementById('almox-temp-unidadeNome');
    const tempTipoUnidadeRawEl = document.getElementById('almox-temp-tipoUnidadeRaw');
    const tempTipoMovimentacaoEl = document.getElementById('almox-temp-tipoMovimentacao');
    const tempQtdEntregueEl = document.getElementById('almox-temp-qtdEntregue');
    const tempQtdRetornoEl = document.getElementById('almox-temp-qtdRetorno');
    const tempDataEl = document.getElementById('almox-temp-data');
    const tempResponsavelUnidadeEl = document.getElementById('almox-temp-responsavelUnidade');
    const tempItemTypeEl = document.getElementById('almox-temp-itemType');

    if (tempUnidadeIdEl) tempUnidadeIdEl.value = data.unidadeId;
    if (tempUnidadeNomeEl) tempUnidadeNomeEl.value = data.unidadeNome;
    if (tempTipoUnidadeRawEl) tempTipoUnidadeRawEl.value = data.tipoUnidadeRaw;
    if (tempTipoMovimentacaoEl) tempTipoMovimentacaoEl.value = tipoMovimentacao;
    if (tempQtdEntregueEl) tempQtdEntregueEl.value = qtdEntregue;
    if (tempQtdRetornoEl) tempQtdRetornoEl.value = qtdRetorno;
    if (tempDataEl) tempDataEl.value = data.data.toMillis();
    if (tempResponsavelUnidadeEl) tempResponsavelUnidadeEl.value = data.responsavelUnidade;
    if (tempItemTypeEl) tempItemTypeEl.value = itemType;


    const modalTitle = DOM_ELEMENTS.almoxarifadoResponsavelModal.querySelector('.modal-title');
    const modalBody = DOM_ELEMENTS.almoxarifadoResponsavelModal.querySelector('.modal-body p');
    const btnConfirm = DOM_ELEMENTS.btnSalvarMovimentacaoFinal;
    
    if (tipoMovimentacao === 'entrega' || (tipoMovimentacao === 'troca' && qtdEntregue > 0)) {
         modalBody.innerHTML = `Informe seu nome (Responsável do Almoxarifado) para registrar quem está realizando a **entrega** de **${qtdEntregue}** ${itemLabel} cheio(s). Esta informação é crucial para o rastreio.`;
         btnConfirm.innerHTML = `<i data-lucide="package-open"></i> Confirmar Entrega`;
    } else if (tipoMovimentacao === 'retorno' || (tipoMovimentacao === 'troca' && qtdRetorno > 0)) {
         modalBody.innerHTML = `Informe seu nome (Responsável do Almoxarifado) para registrar quem está realizando o **recebimento** de **${qtdRetorno}** ${itemLabel} vazio(s). Esta informação é crucial para o rastreio.`;
         btnConfirm.innerHTML = `<i data-lucide="package-check"></i> Confirmar Recebimento`;
    } else {
        modalBody.innerHTML = `Informe seu nome (Responsável do Almoxarifado) para finalizar a movimentação.`;
        btnConfirm.innerHTML = `<i data-lucide="save"></i> Confirmar Movimentação`;
    }

    if (modalTitle) modalTitle.innerHTML = `<i data-lucide="box" class="w-5 h-5"></i> Confirmação de Movimentação (${itemType === 'agua' ? 'Água' : 'Gás'})`;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 
    
    DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'flex';
    if (DOM_ELEMENTS.inputAlmoxResponsavelNome) DOM_ELEMENTS.inputAlmoxResponsavelNome.focus();
}

/**
 * Handler para o clique final no modal de movimentação.
 */
export async function handleFinalMovimentacaoSubmit() {
    const nomeAlmoxarifado = capitalizeString(DOM_ELEMENTS.inputAlmoxResponsavelNome.value.trim());
    const itemType = document.getElementById('almox-temp-itemType').value;
    
    if (!nomeAlmoxarifado) {
        showAlert('alert-almox-responsavel', 'Por favor, informe seu nome (Almoxarifado) para registrar a entrega/recebimento.', 'warning');
        return;
    }
    
    const btnModal = DOM_ELEMENTS.btnSalvarMovimentacaoFinal;
    const alertId = itemType === 'agua' ? 'alert-agua' : 'alert-gas';
    const formToReset = itemType === 'agua' ? DOM_ELEMENTS.formAgua : DOM_ELEMENTS.formGas;
    const inputData = itemType === 'agua' ? DOM_ELEMENTS.inputDataAgua : DOM_ELEMENTS.inputDataGas;
    const collection = itemType === 'agua' ? COLLECTIONS.aguaMov : COLLECTIONS.gasMov;
    
    btnModal.disabled = true;
    btnModal.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    // Coleta dados do formulário temporário
    const dataMillis = parseInt(document.getElementById('almox-temp-data').value, 10);
    const dataTemp = Timestamp.fromMillis(dataMillis);
    
    const finalData = {
        unidadeId: document.getElementById('almox-temp-unidadeId').value,
        unidadeNome: document.getElementById('almox-temp-unidadeNome').value,
        tipoUnidadeRaw: document.getElementById('almox-temp-tipoUnidadeRaw').value,
        tipoMovimentacao: document.getElementById('almox-temp-tipoMovimentacao').value,
        qtdEntregue: parseInt(document.getElementById('almox-temp-qtdEntregue').value, 10),
        qtdRetorno: parseInt(document.getElementById('almox-temp-qtdRetorno').value, 10),
        data: dataTemp, // Data da Movimentação
        responsavelUnidade: document.getElementById('almox-temp-responsavelUnidade').value,
        responsavelAlmoxarifado: nomeAlmoxarifado, // NOVO CAMPO SALVO
        itemType: itemType
    };
    
    const tipoUnidade = (finalData.tipoUnidadeRaw || '').toUpperCase() === 'SEMCAS' ? 'SEDE' : (finalData.tipoUnidadeRaw || '').toUpperCase();
    
    let msgSucesso = [];
    
    try {
        const timestamp = serverTimestamp();
        
        // 1. ENTREGA (SAÍDA DE ESTOQUE)
        if (finalData.qtdEntregue > 0) {
            await addDoc(collection, { 
                unidadeId: finalData.unidadeId, 
                unidadeNome: finalData.unidadeNome, 
                tipoUnidade: tipoUnidade, 
                tipo: 'entrega', 
                quantidade: finalData.qtdEntregue, 
                data: finalData.data,
                responsavel: finalData.responsavelUnidade,
                responsavelAlmoxarifado: finalData.responsavelAlmoxarifado,
                registradoEm: timestamp
            });
            msgSucesso.push(`${finalData.qtdEntregue} ${itemType === 'agua' ? 'galão(ões)' : 'botijão(ões)'} entregue(s)`);
        }
        
        // 2. RETORNO (ENTRADA EM ESTOQUE VAZIO/CRÉDITO)
        if (finalData.qtdRetorno > 0) {
             await addDoc(collection, { 
                 unidadeId: finalData.unidadeId, 
                 unidadeNome: finalData.unidadeNome, 
                 tipoUnidade: tipoUnidade, 
                 tipo: 'retorno', 
                 quantidade: finalData.qtdRetorno, 
                 data: finalData.data,
                 responsavel: finalData.responsavelUnidade,
                 responsavelAlmoxarifado: finalData.responsavelAlmoxarifado,
                 registradoEm: timestamp
            });
             msgSucesso.push(`${finalData.qtdRetorno} ${itemType === 'agua' ? 'galão(ões)' : 'botijão(ões)'} recebido(s)`);
        }
        
        showAlert(alertId, `Movimentação salva! ${msgSucesso.join('; ')}.`, 'success');
        
        if(formToReset) formToReset.reset(); 
        
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        const dataInputEl = itemType === 'agua' ? DOM_ELEMENTS.inputDataAgua : DOM_ELEMENTS.inputDataGas;
        if(dataInputEl) dataInputEl.value = formatTimestamp(dataTemp);
        
        DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'none';

    } catch (error) { 
        console.error(`Erro salvar movimentação (${itemType}):`, error); 
        showAlert(alertId, `Erro: ${error.message}`, 'error');
        showAlert('alert-almox-responsavel', `Erro ao salvar: ${error.message}. Tente novamente.`, 'error');
    } finally { 
        btnModal.disabled = false;
        btnModal.innerHTML = '<i data-lucide="package-open"></i> Confirmar Movimentação';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

        if (DOM_ELEMENTS.inputAlmoxResponsavelNome) DOM_ELEMENTS.inputAlmoxResponsavelNome.value = '';
    }
}
