// js/modules/movimentacao-modal-handler.js
import { Timestamp, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { capitalizeString, formatTimestamp } from "../utils/formatters.js";
import { COLLECTIONS } from "../services/firestore-service.js";

// Variáveis temporárias para o fluxo (mantidas caso sejam usadas em outro lugar, mas a leitura agora é pelos inputs hidden)
// let almoxTempFields = {}; // Pode remover se não for usado em outro lugar

/**
 * Abre o modal para confirmação do responsável do almoxarifado antes de salvar a movimentação.
 * @param {Object} data Dados da movimentação.
 */
export function executeFinalMovimentacao(data) {
    if (!DOM_ELEMENTS.almoxarifadoResponsavelModal) return;

    // almoxTempFields = data; // Armazena os dados nos campos hidden em vez de uma variável global

    const { tipoMovimentacao, qtdEntregue, qtdRetorno, itemType } = data;
    const itemLabel = itemType === 'agua' ? 'galão(ões) 20L' : 'botijão(ões)';

    // ** Preenche os campos hidden do modal **
    const tempUnidadeIdEl = document.getElementById('almox-temp-unidadeId');
    const tempUnidadeNomeEl = document.getElementById('almox-temp-unidadeNome');
    const tempTipoUnidadeRawEl = document.getElementById('almox-temp-tipoUnidadeRaw');
    const tempTipoMovimentacaoEl = document.getElementById('almox-temp-tipoMovimentacao');
    const tempQtdEntregueEl = document.getElementById('almox-temp-qtdEntregue');
    const tempQtdRetornoEl = document.getElementById('almox-temp-qtdRetorno');
    const tempDataEl = document.getElementById('almox-temp-data');
    const tempResponsavelUnidadeEl = document.getElementById('almox-temp-responsavelUnidade');
    const tempItemTypeEl = document.getElementById('almox-temp-itemType');

    // Validação básica para garantir que os elementos existem antes de setar
    if (!tempUnidadeIdEl || !tempUnidadeNomeEl || !tempTipoUnidadeRawEl || !tempTipoMovimentacaoEl ||
        !tempQtdEntregueEl || !tempQtdRetornoEl || !tempDataEl || !tempResponsavelUnidadeEl || !tempItemTypeEl) {
        console.error("Erro: Um ou mais campos hidden do modal de movimentação não foram encontrados no HTML.");
        showAlert(itemType === 'agua' ? 'alert-agua' : 'alert-gas', 'Erro interno: Falha ao preparar modal. Recarregue a página.', 'error');
        return;
    }

    tempUnidadeIdEl.value = data.unidadeId || '';
    tempUnidadeNomeEl.value = data.unidadeNome || '';
    tempTipoUnidadeRawEl.value = data.tipoUnidadeRaw || '';
    tempTipoMovimentacaoEl.value = tipoMovimentacao || '';
    tempQtdEntregueEl.value = qtdEntregue || 0;
    tempQtdRetornoEl.value = qtdRetorno || 0;
    // Armazena como string de milissegundos
    tempDataEl.value = data.data ? data.data.toMillis() : '';
    tempResponsavelUnidadeEl.value = data.responsavelUnidade || '';
    tempItemTypeEl.value = itemType || '';
    // ** Fim do preenchimento dos campos hidden **


    const modalTitle = DOM_ELEMENTS.almoxarifadoResponsavelModal.querySelector('.modal-title');
    const modalBody = DOM_ELEMENTS.almoxarifadoResponsavelModal.querySelector('.modal-body p'); // Apenas o primeiro P para descrição
    const btnConfirm = DOM_ELEMENTS.btnSalvarMovimentacaoFinal;

    let bodyText = '';
    let btnText = '';
    let icon = 'save';

    if (tipoMovimentacao === 'entrega' || (tipoMovimentacao === 'troca' && qtdEntregue > 0 && qtdRetorno === 0)) {
         bodyText = `Informe seu nome (Responsável do Almoxarifado) para registrar quem está realizando a **entrega** de **${qtdEntregue}** ${itemLabel} cheio(s). Esta informação é crucial para o rastreio.`;
         btnText = `Confirmar Entrega`;
         icon = 'package-open';
    } else if (tipoMovimentacao === 'retorno' || (tipoMovimentacao === 'troca' && qtdRetorno > 0 && qtdEntregue === 0)) {
         bodyText = `Informe seu nome (Responsável do Almoxarifado) para registrar quem está realizando o **recebimento** de **${qtdRetorno}** ${itemLabel} vazio(s). Esta informação é crucial para o rastreio.`;
         btnText = `Confirmar Recebimento`;
         icon = 'package-check';
    } else if (tipoMovimentacao === 'troca' && qtdEntregue > 0 && qtdRetorno > 0) {
        bodyText = `Informe seu nome (Responsável do Almoxarifado) para registrar a **troca**: entrega de **${qtdEntregue}** cheio(s) e recebimento de **${qtdRetorno}** vazio(s).`;
        btnText = 'Confirmar Troca';
        icon = 'refresh-cw';
    } else {
        // Fallback caso algo estranho aconteça
        bodyText = `Informe seu nome (Responsável do Almoxarifado) para finalizar a movimentação.`;
        btnText = `Confirmar Movimentação`;
    }

    if (modalBody) {
      modalBody.innerHTML = bodyText.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    }
    if (btnConfirm) {
      btnConfirm.innerHTML = `<i data-lucide="${icon}"></i> ${btnText}`;
    }

    if (modalTitle) modalTitle.innerHTML = `<i data-lucide="box" class="w-5 h-5"></i> Confirmação de Movimentação (${itemType === 'agua' ? 'Água' : 'Gás'})`;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'flex';
    if (DOM_ELEMENTS.inputAlmoxResponsavelNome) {
        DOM_ELEMENTS.inputAlmoxResponsavelNome.value = ''; // Limpa o campo
        DOM_ELEMENTS.inputAlmoxResponsavelNome.focus();
    }
    // Limpa alerta anterior
    showAlert('alert-almox-responsavel', '', 'info', 1); // Limpa rapidamente
}

/**
 * Handler para o clique final no modal de movimentação.
 */
export async function handleFinalMovimentacaoSubmit() {
    const nomeAlmoxarifado = capitalizeString(DOM_ELEMENTS.inputAlmoxResponsavelNome.value.trim());

    // ** Validação do nome do responsável **
    if (!nomeAlmoxarifado) {
        showAlert('alert-almox-responsavel', 'Por favor, informe seu nome (Almoxarifado) para registrar a entrega/recebimento.', 'warning');
        return;
    }

    // ** Recupera dados dos campos hidden **
    const unidadeId = document.getElementById('almox-temp-unidadeId')?.value;
    const unidadeNome = document.getElementById('almox-temp-unidadeNome')?.value;
    const tipoUnidadeRaw = document.getElementById('almox-temp-tipoUnidadeRaw')?.value;
    const tipoMovimentacao = document.getElementById('almox-temp-tipoMovimentacao')?.value;
    const qtdEntregueStr = document.getElementById('almox-temp-qtdEntregue')?.value;
    const qtdRetornoStr = document.getElementById('almox-temp-qtdRetorno')?.value;
    const dataMillisStr = document.getElementById('almox-temp-data')?.value;
    const responsavelUnidade = document.getElementById('almox-temp-responsavelUnidade')?.value;
    const itemType = document.getElementById('almox-temp-itemType')?.value;

    // ** Validação dos dados recuperados **
    if (!unidadeId || !unidadeNome || !tipoMovimentacao || !dataMillisStr || !responsavelUnidade || !itemType) {
        console.error("Erro: Falha ao ler dados temporários do modal.", {
            unidadeId, unidadeNome, tipoMovimentacao, dataMillisStr, responsavelUnidade, itemType
        });
        showAlert('alert-almox-responsavel', 'Erro interno ao recuperar dados da movimentação. Tente novamente.', 'error');
        return;
    }

    const qtdEntregue = parseInt(qtdEntregueStr, 10);
    const qtdRetorno = parseInt(qtdRetornoStr, 10);
    const dataMillis = parseInt(dataMillisStr, 10);

    if (isNaN(qtdEntregue) || isNaN(qtdRetorno) || isNaN(dataMillis)) {
         console.error("Erro: Falha ao converter quantidades ou data.", { qtdEntregueStr, qtdRetornoStr, dataMillisStr });
         showAlert('alert-almox-responsavel', 'Erro interno nos dados numéricos da movimentação. Tente novamente.', 'error');
         return;
    }
    // ** Fim das validações **

    const btnModal = DOM_ELEMENTS.btnSalvarMovimentacaoFinal;
    const alertId = itemType === 'agua' ? 'alert-agua' : 'alert-gas'; // Alerta na aba principal
    const formToReset = itemType === 'agua' ? DOM_ELEMENTS.formAgua : DOM_ELEMENTS.formGas;
    const collection = itemType === 'agua' ? COLLECTIONS.aguaMov : COLLECTIONS.gasMov;

    btnModal.disabled = true;
    btnModal.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    const dataTemp = Timestamp.fromMillis(dataMillis);
    const tipoUnidade = (tipoUnidadeRaw || '').toUpperCase() === 'SEMCAS' ? 'SEDE' : (tipoUnidadeRaw || '').toUpperCase();

    let msgSucesso = [];
    let operacoesComErro = 0;

    try {
        const timestamp = serverTimestamp(); // Timestamp para registro

        // 1. ENTREGA (SAÍDA DE ESTOQUE)
        if (qtdEntregue > 0) {
            try {
                await addDoc(collection, {
                    unidadeId: unidadeId,
                    unidadeNome: unidadeNome,
                    tipoUnidade: tipoUnidade,
                    tipo: 'entrega',
                    quantidade: qtdEntregue,
                    data: dataTemp, // Data da Movimentação
                    responsavel: responsavelUnidade,
                    responsavelAlmoxarifado: nomeAlmoxarifado, // Salva quem fez a operação
                    registradoEm: timestamp
                });
                msgSucesso.push(`${qtdEntregue} ${itemLabel} entregue(s)`);
            } catch (error) {
                console.error(`Erro ao salvar entrega (${itemType}):`, error);
                operacoesComErro++;
                throw error; // Re-lança para cair no catch externo e dar feedback
            }
        }

        // 2. RETORNO (ENTRADA EM ESTOQUE VAZIO/CRÉDITO)
        if (qtdRetorno > 0) {
             try {
                await addDoc(collection, {
                    unidadeId: unidadeId,
                    unidadeNome: unidadeNome,
                    tipoUnidade: tipoUnidade,
                    tipo: 'retorno',
                    quantidade: qtdRetorno,
                    data: dataTemp, // Data da Movimentação
                    responsavel: responsavelUnidade,
                    responsavelAlmoxarifado: nomeAlmoxarifado, // Salva quem fez a operação
                    registradoEm: timestamp
                });
                msgSucesso.push(`${qtdRetorno} ${itemLabel} recebido(s)`);
             } catch (error) {
                 console.error(`Erro ao salvar retorno (${itemType}):`, error);
                 operacoesComErro++;
                 throw error; // Re-lança para cair no catch externo
             }
        }

        // Se chegou aqui sem erro (o throw só ocorre dentro dos blocos try/catch acima)
        if (operacoesComErro > 0) {
             throw new Error("Erro de Escrita (Verifique o console para detalhes).");
        } else {
            // Sucesso completo
             showAlert(alertId, `Movimentação salva! ${msgSucesso.join('; ')}.`, 'success');
        }

        // Limpa o formulário apenas se tudo deu certo
        if (formToReset) formToReset.reset();

        // Reseta a data para a data da movimentação que acabou de ser salva
        const dataInputEl = itemType === 'agua' ? DOM_ELEMENTS.inputDataAgua : DOM_ELEMENTS.inputDataGas;
        if (dataInputEl) {
            // Formata o Timestamp de volta para 'YYYY-MM-DD'
             const dateObj = dataTemp.toDate();
             const yyyy = dateObj.getFullYear();
             const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
             const dd = String(dateObj.getDate()).padStart(2, '0');
             dataInputEl.value = `${yyyy}-${mm}-${dd}`;
        }

        // Reseta o select de tipo para 'troca'
        const tipoSelectEl = itemType === 'agua' ? DOM_ELEMENTS.selectTipoAgua : DOM_ELEMENTS.selectTipoGas;
        if (tipoSelectEl) tipoSelectEl.value = 'troca';


        DOM_ELEMENTS.almoxarifadoResponsavelModal.style.display = 'none'; // Fecha o modal

    } catch (error) {
        // Erro geral ou erro propagado das operações individuais
        console.error(`Erro final ao salvar movimentação (${itemType}):`, error);
        
        let displayMessage = `Falha ao salvar troca. Verifique o console.`;
        
        // Se a mensagem do erro contiver 'permission-denied', é uma falha de regra.
        if (error.message && error.message.toLowerCase().includes('permission-denied')) {
             const collectionName = itemType === 'agua' ? 'controleAgua' : 'controleGas';
             displayMessage = `Erro de Permissão: O seu papel (**Editor**) não tem permissão de **Escrita** (write/create) para a coleção de movimentação (*${collectionName}*). **Verifique se as regras do Firestore estão corretamente publicadas!**`;
        } else if (error.message) {
            displayMessage = `Erro inesperado: ${error.message}`;
        }
        
        // Mostra erro na aba principal e no modal
        showAlert(alertId, `Erro ao salvar movimentação: ${displayMessage}`, 'error');
        showAlert('alert-almox-responsavel', `Erro ao salvar: ${displayMessage}. Tente novamente.`, 'error');
    } finally {
        // Reabilita o botão do modal independentemente do resultado
        btnModal.disabled = false;
        // Restaura o texto original (pode precisar ajustar o ícone baseado no tipo original)
        btnModal.innerHTML = '<i data-lucide="save"></i> Confirmar Movimentação';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

        // Limpa o nome do responsável no modal
        if (DOM_ELEMENTS.inputAlmoxResponsavelNome) DOM_ELEMENTS.inputAlmoxResponsavelNome.value = '';
    }
}
