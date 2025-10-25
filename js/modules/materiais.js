// js/modules/materiais.js
import { Timestamp, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getMateriais } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, filterTable, switchSubTabView } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestamp, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { uploadFile, deleteFile } from "../services/storage-service.js";

// =========================================================================
// LÓGICA DE LANÇAMENTO E SUBMISSÃO
// =========================================================================

/**
 * Submete o formulário de requisição de materiais.
 */
export async function handleMateriaisSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-materiais', 'Erro: Não autenticado.', 'error'); return; }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const selectValue = DOM_ELEMENTS.selectUnidadeMateriais.value; 
    if (!selectValue) { showAlert('alert-materiais', 'Selecione uma unidade.', 'warning'); return; }
    const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
    const tipoUnidade = (tipoUnidadeRaw || '').toUpperCase() === 'SEMCAS' ? 'SEDE' : (tipoUnidadeRaw || '').toUpperCase();

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const tipoMaterial = DOM_ELEMENTS.selectTipoMateriais.value;
    const dataSeparacao = DOM_ELEMENTS.inputDataSeparacao.value ? dateToTimestamp(DOM_ELEMENTS.inputDataSeparacao.value) : serverTimestamp();
    const itens = DOM_ELEMENTS.textareaItensMateriais.value.trim();
    const responsavelLancamento = capitalizeString(DOM_ELEMENTS.inputResponsavelMateriais.value.trim()); 
    const arquivo = DOM_ELEMENTS.inputArquivoMateriais.files[0];
     
    if (!unidadeId || !tipoMaterial || !responsavelLancamento) {
        showAlert('alert-materiais', 'Dados inválidos. Verifique unidade, tipo e Responsável pelo Lançamento.', 'warning'); return;
    }
    
    DOM_ELEMENTS.btnSubmitMateriais.disabled = true; 
    
    let fileURL = null;
    let storagePath = null;

    if (arquivo) {
        if (arquivo.size > 10 * 1024 * 1024) { 
            showAlert('alert-materiais', 'Erro: Arquivo muito grande (máx 10MB).', 'error');
            DOM_ELEMENTS.btnSubmitMateriais.disabled = false;
            return;
        }
        
        DOM_ELEMENTS.btnSubmitMateriais.innerHTML = '<div class="loading-spinner-small mx-auto"></div><span class="ml-2">Enviando arquivo...</span>';
        showAlert('alert-materiais', 'Enviando arquivo anexo...', 'info', 10000);

        try {
            const uploadResult = await uploadFile(arquivo);
            fileURL = uploadResult.fileURL;
            storagePath = uploadResult.storagePath;
            showAlert('alert-materiais', 'Arquivo enviado! Salvando registro...', 'info', 10000);

        } catch (error) {
            console.error("Erro no upload do arquivo:", error);
            showAlert('alert-materiais', `Erro ao enviar arquivo: ${error.message}`, 'error');
            DOM_ELEMENTS.btnSubmitMateriais.disabled = false; 
            DOM_ELEMENTS.btnSubmitMateriais.textContent = 'Registrar Requisição';
            return;
        }
    } else {
         DOM_ELEMENTS.btnSubmitMateriais.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    }
    
    try {
        await addDoc(COLLECTIONS.materiais, {
            unidadeId, unidadeNome, tipoUnidade, tipoMaterial,
            dataSeparacao: dataSeparacao, 
            itens,
            status: 'requisitado',
            dataInicioSeparacao: null, 
            dataRetirada: null,
            dataEntrega: null,
            responsavelLancamento: responsavelLancamento,
            responsavelSeparador: null,
            responsavelEntrega: null,
            responsavelRecebimento: null,
            registradoEm: serverTimestamp(),
            fileURL: fileURL,
            storagePath: storagePath,
            downloadInfo: { count: 0, lastDownload: null, blockedUntil: null }
        });
        showAlert('alert-materiais', 'Requisição registrada! O status inicial é "Para Separar".', 'success');
        DOM_ELEMENTS.formMateriais.reset(); 
        DOM_ELEMENTS.inputDataSeparacao.value = getTodayDateString(); 
    } catch (error) { 
        console.error("Erro salvar requisição:", error);
        showAlert('alert-materiais', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTS.btnSubmitMateriais.disabled = false; 
        DOM_ELEMENTS.btnSubmitMateriais.textContent = 'Registrar Requisição';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}


// =========================================================================
// LÓGICA DO FLUXO (WORKFLOW)
// =========================================================================

/**
 * Renderiza as sub-tabelas de materiais e os summaries.
 */
export function renderMateriaisStatus() {
    
    const materiais = getMateriais();
    
    const requisitado = materiais.filter(m => m.status === 'requisitado');
    const separacao = materiais.filter(m => m.status === 'separacao');
    const retirada = materiais.filter(m => m.status === 'retirada');
    const entregue = materiais.filter(m => m.status === 'entregue');
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.summaryMateriaisRequisitado) DOM_ELEMENTS.summaryMateriaisRequisitado.textContent = requisitado.length;
    if (DOM_ELEMENTS.summaryMateriaisSeparacao) DOM_ELEMENTS.summaryMateriaisSeparacao.textContent = separacao.length;
    if (DOM_ELEMENTS.summaryMateriaisRetirada) DOM_ELEMENTS.summaryMateriaisRetirada.textContent = retirada.length;
    
    // 1. Para Separar (Status: requisitado)
    renderMaterialSubTable(DOM_ELEMENTS.tableParaSeparar, requisitado, 'requisitado');
    
    // 2. Em Separação (Status: separacao)
    renderMaterialSubTable(DOM_ELEMENTS.tableEmSeparacao, separacao, 'separacao');
    
    // 3. Pronto p/ Entrega (Status: retirada)
    renderMaterialSubTable(DOM_ELEMENTS.tableProntoEntrega, retirada, 'retirada');
    
    // 4. Histórico (Status: entregue)
    renderMaterialSubTable(DOM_ELEMENTS.tableHistoricoEntregues, entregue.sort((a,b) => (b.dataEntrega?.toMillis() || 0) - (a.dataEntrega?.toMillis() || 0)), 'entregue');
}

/**
 * Função utilitária para renderizar uma tabela de materiais com base no status.
 */
function renderMaterialSubTable(tableBody, data, status) {
    if (!tableBody) return;
    
    if (data.length === 0) {
        let msg = '';
        if (status === 'requisitado') msg = 'Nenhuma requisição pendente de separação.';
        else if (status === 'separacao') msg = 'Nenhuma requisição em separação.';
        else if (status === 'retirada') msg = 'Nenhum material pronto para entrega.';
        else if (status === 'entregue') msg = 'Nenhuma entrega finalizada.';
        tableBody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-slate-500">' + msg + '</td></tr>';
        return;
    }

    let html = '';
    
    data.forEach(m => {
        let acoesHtml = '';
        let rowContent = '';
        const dataRequisicao = capitalizeString(m.tipoMaterial || 'N/D'); // Data da Requisicao
        const responsavelLancamento = m.responsavelLancamento || 'N/A';
        const separador = m.responsavelSeparador || 'N/A';
        const dataInicioSeparacao = formatTimestampComTempo(m.dataInicioSeparacao);
        
        if (status === 'requisitado') {
            const hasFile = m.fileURL;
            const downloadBtn = hasFile 
                ? '<button class="btn-icon btn-download-pedido text-blue-600 hover:text-blue-800" data-id="' + m.id + '" data-url="' + m.fileURL + '" title="Baixar Pedido"><i data-lucide="download-cloud"></i></button>'
                : '<span class="btn-icon text-gray-400" title="Sem anexo"><i data-lucide="file-x"></i></span>';
            
            acoesHtml = downloadBtn + 
                ' <button class="btn-icon btn-start-separacao text-green-600 hover:text-green-800" data-id="' + m.id + '" title="Informar Separador e Iniciar"><i data-lucide="play-circle"></i></button>' +
                ' <button class="btn-icon btn-remove text-red-600 hover:text-red-800" data-id="' + m.id + '" data-type="materiais" data-details="' + m.unidadeNome + ' - Requisitado" title="Remover Requisição"><i data-lucide="trash-2"></i></button>';
            
            rowContent = '<td>' + m.unidadeNome + '</td>' +
                '<td class="capitalize">' + m.tipoMaterial + '</td>' +
                '<td>' + formatTimestamp(m.dataSeparacao) + '</td>' +
                '<td>' + responsavelLancamento + '</td>' +
                '<td class="text-center space-x-2">' + acoesHtml + '</td>';
            
        } else if (status === 'separacao') {
             const hasFile = m.fileURL;
             const downloadBtn = hasFile 
                ? '<button class="btn-icon btn-download-pedido text-blue-600 hover:text-blue-800" data-id="' + m.id + '" data-url="' + m.fileURL + '" title="Baixar Pedido"><i data-lucide="download-cloud"></i></button>'
                : '<span class="btn-icon text-gray-400" title="Sem anexo"><i data-lucide="file-x"></i></span>';
            
            acoesHtml = downloadBtn + 
                ' <button class="btn-success btn-retirada text-xs py-1 px-2" data-id="' + m.id + '" title="Marcar como pronto para entrega">Pronto para Entrega</button>';
            
            rowContent = '<td>' + m.unidadeNome + '</td>' +
                '<td class="capitalize">' + m.tipoMaterial + '</td>' +
                '<td>' + separador + '</td>' +
                '<td class="text-xs">' + dataInicioSeparacao + '</td>' +
                '<td class="text-center space-x-2">' + acoesHtml + '</td>';
            
        } else if (status === 'retirada') {
            acoesHtml = 
                ' <button class="btn-success btn-entregue text-xs py-1 px-2" data-id="' + m.id + '" title="Finalizar entrega e registrar responsáveis">Entregue</button>';
            
            rowContent = '<td>' + m.unidadeNome + '</td>' +
                '<td class="capitalize">' + m.tipoMaterial + '</td>' +
                '<td>' + separador + '</td>' +
                '<td>' + (formatTimestamp(m.dataRetirada) || 'N/A') + '</td>' +
                '<td class="text-center space-x-2">' + acoesHtml + '</td>';
            
        } else if (status === 'entregue') {
            const dataEntrega = formatTimestamp(m.dataEntrega);
            const respUnidade = m.responsavelRecebimento || m.responsavelLancamento || 'N/A';
            const respAlmox = m.responsavelEntrega || m.responsavelSeparador || 'N/A';
            const dataLancamento = formatTimestampComTempo(m.registradoEm);

            const details = `Entrega ${m.unidadeNome} - Finalizada`;

            rowContent = '<td>' + m.unidadeNome + '</td>' +
                '<td class="capitalize">' + m.tipoMaterial + '</td>' +
                '<td>' + dataEntrega + '</td>' +
                '<td>' + respUnidade + '</td>' +
                '<td>' + respAlmox + '</td>' +
                '<td class="text-center text-xs">' + dataLancamento + '</td>' +
                 '<td class="text-center">' +
                    '<button class="btn-icon btn-remove text-red-600 hover:text-red-800" data-id="' + m.id + '" data-type="materiais" data-details="' + details + '" title="Remover Requisição"><i data-lucide="trash-2"></i></button>' +
                 '</td>';
        }
        
        // Linha principal
        html += '<tr>' + rowContent + '</tr>';
        
        // Incluir linha de observação se houver
        if (m.itens) {
            html += '<tr class="obs-row ' + (status === 'entregue' ? 'opacity-60' : '') + ' border-b border-slate-200">' +
                '<td colspan="7" class="pt-0 pb-1 px-6 text-xs text-slate-500 whitespace-pre-wrap italic">Obs: ' + m.itens + '</td>' +
                '</tr>';
        }
    });

    tableBody.innerHTML = html;
    
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}


/**
 * Marca o material como pronto para retirada.
 */
async function handleMarcarRetirada(e) {
    const button = e.target.closest('button.btn-retirada[data-id]');
    if (!button) return; 
    
    const materialId = button.dataset.id;
    if (!isReady() || !materialId) return;
    
    button.disabled = true; button.innerHTML = '<div class="loading-spinner-small mx-auto" style="width: 16px; height: 16px; border-width: 2px;"></div>';
    
    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, { 
            status: 'retirada', 
            dataRetirada: serverTimestamp() 
        });
        showAlert('alert-em-separacao', 'Material marcado como Pronto para Entrega!', 'success', 3000);
    } catch (error) { 
        console.error("Erro marcar p/ retirada:", error); 
        showAlert('alert-em-separacao', `Erro: ${error.message}`, 'error'); 
        button.disabled = false; 
        button.textContent = 'Pronto para Entrega'; 
    }
}

/**
 * Abre o modal para finalização de entrega.
 */
async function handleMarcarEntregue(e) {
    const button = e.target.closest('button.btn-entregue[data-id]');
    if (!button) return; 
    
    const materialId = button.dataset.id;
    if (!isReady() || !materialId) return;
    
    const material = getMateriais().find(m => m.id === materialId);
    if (!material) return;
    
    // Preenche e abre o modal de finalização
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.finalizarEntregaMaterialIdEl.value = materialId;
    DOM_ELEMENTS.inputEntregaResponsavelAlmox.value = material.responsavelSeparador || '';
    DOM_ELEMENTS.inputEntregaResponsavelUnidade.value = material.responsavelLancamento || '';
    DOM_ELEMENTS.alertFinalizarEntrega.style.display = 'none';

    DOM_ELEMENTS.finalizarEntregaModal.style.display = 'flex';
    DOM_ELEMENTS.inputEntregaResponsavelAlmox.focus();
}

/**
 * Finaliza a entrega do material (chamado pelo modal).
 */
export async function handleFinalizarEntregaSubmit() {
    if (!isReady()) return;
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const materialId = DOM_ELEMENTS.finalizarEntregaMaterialIdEl.value;
    const respAlmox = capitalizeString(DOM_ELEMENTS.inputEntregaResponsavelAlmox.value.trim());
    const respUnidade = capitalizeString(DOM_ELEMENTS.inputEntregaResponsavelUnidade.value.trim());
    
    if (!respAlmox || !respUnidade) {
        showAlert('alert-finalizar-entrega', 'Informe o responsável pela entrega (Almoxarifado) e quem recebeu (Unidade).', 'warning');
        return;
    }
    
    DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.disabled = true;
    DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    const material = getMateriais().find(m => m.id === materialId);
    const storagePath = material?.storagePath;
    
    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, { 
            status: 'entregue', 
            dataEntrega: serverTimestamp(),
            responsavelEntrega: respAlmox,
            responsavelRecebimento: respUnidade,
            registradoEm: serverTimestamp()
        });
        showAlert('alert-pronto-entrega', `Material entregue para ${respUnidade}! Processo finalizado.`, 'success', 3000);
        
        // Excluir arquivo do Storage
        if (storagePath) {
             await deleteFile(storagePath);
        }

    } catch (error) { 
        console.error("Erro finalizar entrega:", error); 
        showAlert('alert-finalizar-entrega', `Erro: ${error.message}`, 'error'); 
        showAlert('alert-pronto-entrega', `Erro ao finalizar: ${error.message}`, 'error'); 
    } finally {
        DOM_ELEMENTS.finalizarEntregaModal.style.display = 'none';
        DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.disabled = false;
        DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.innerHTML = '<i data-lucide="check-circle"></i> Confirmar Finalização';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Abre o modal para informar o nome do separador.
 */
function openSeparadorModal(materialId) {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.separadorModal) return;
    console.log("Abrindo modal para material ID:", materialId);
    DOM_ELEMENTS.separadorMaterialIdEl.value = materialId;
    DOM_ELEMENTS.inputSeparadorNome.value = '';
    DOM_ELEMENTS.inputSeparadorNome.disabled = false;
    DOM_ELEMENTS.btnSalvarSeparador.disabled = false;
    DOM_ELEMENTS.btnSalvarSeparador.innerHTML = 'Salvar Nome e Liberar';
    DOM_ELEMENTS.alertSeparador.style.display = 'none';
    DOM_ELEMENTS.separadorModal.style.display = 'flex';
    DOM_ELEMENTS.inputSeparadorNome.focus();
}

/**
 * Salva o nome do separador e move o status para 'separacao'.
 */
export async function handleSalvarSeparador() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!isReady() || !DOM_ELEMENTS.inputSeparadorNome) return;

    const nomeSeparador = capitalizeString(DOM_ELEMENTS.inputSeparadorNome.value.trim());
    const materialId = DOM_ELEMENTS.separadorMaterialIdEl.value;

    if (!nomeSeparador) {
        showAlert('alert-separador', 'Por favor, informe o nome do separador.', 'warning');
        return;
    }

    DOM_ELEMENTS.btnSalvarSeparador.disabled = true;
    DOM_ELEMENTS.inputSeparadorNome.disabled = true;
    DOM_ELEMENTS.btnSalvarSeparador.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, {
            status: 'separacao',
            responsavelSeparador: nomeSeparador,
            dataInicioSeparacao: serverTimestamp()
        });

        showAlert('alert-separador', 'Nome salvo! O status foi atualizado para "Em Separação".', 'success', 4000);
        setTimeout(() => {
            if (DOM_ELEMENTS.separadorModal) DOM_ELEMENTS.separadorModal.style.display = 'none';
        }, 2000);

        const material = getMateriais().find(m => m.id === materialId);
        if (material?.fileURL) {
             setTimeout(() => {
                 handleDownloadPedido(materialId, material.fileURL);
             }, 500);
        }

    } catch (error) {
        console.error("Erro ao salvar nome do separador:", error);
        showAlert('alert-separador', `Erro ao salvar: ${error.message}`, 'error');
        DOM_ELEMENTS.btnSalvarSeparador.disabled = false;
        DOM_ELEMENTS.inputSeparadorNome.disabled = false;
        DOM_ELEMENTS.btnSalvarSeparador.innerHTML = 'Salvar Nome e Liberar';
    }
}

/**
 * Realiza o download do pedido e atualiza o contador.
 */
async function handleDownloadPedido(materialId, fileURL) {
    if (!isReady() || !materialId || !fileURL) return;

    const material = getMateriais().find(m => m.id === materialId);
    if (!material) {
        showAlert('alert-materiais', 'Erro: Registro não encontrado.', 'error');
        return;
    }

    const alertId = 'alert-materiais'; // Alerta genérico para os subviews

    const now = Timestamp.now();
    const downloadInfo = material.downloadInfo || { count: 0, lastDownload: null, blockedUntil: null };

    // Verifica se está bloqueado
    if (downloadInfo.blockedUntil && downloadInfo.blockedUntil.toMillis() > now.toMillis()) {
        const blockTimeRemaining = Math.ceil((downloadInfo.blockedUntil.toMillis() - now.toMillis()) / (60 * 1000));
        showAlert(alertId, `Download temporariamente bloqueado. Tente novamente em ${blockTimeRemaining} minuto(s).`, 'warning');
        return;
    }

    // Verifica limite de downloads
    if (downloadInfo.count >= 2) {
        showAlert(alertId, 'Limite de 2 downloads atingido para este pedido.', 'warning');
        const blockedUntil = Timestamp.fromMillis(now.toMillis() + 3 * 60 * 1000);
        try {
            const docRef = doc(COLLECTIONS.materiais, materialId);
            await updateDoc(docRef, { 'downloadInfo.blockedUntil': blockedUntil });
        } catch (error) {
            console.error("Erro ao bloquear download:", error);
        }
        return;
    }

    // Incrementa contador e registra download
    const newCount = downloadInfo.count + 1;
    let newBlockedUntil = null;
    let blockDurationMinutes = 0;

    if (newCount === 2) {
        blockDurationMinutes = 3;
        newBlockedUntil = Timestamp.fromMillis(now.toMillis() + blockDurationMinutes * 60 * 1000);
    }

    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, {
            'downloadInfo.count': newCount,
            'downloadInfo.lastDownload': now,
            'downloadInfo.blockedUntil': newBlockedUntil
        });

        window.open(fileURL, '_blank');

        if (blockDurationMinutes > 0) {
            showAlert(alertId, `Download ${newCount}/2 realizado. Próximo download bloqueado por ${blockDurationMinutes} min.`, 'info', 6000);
        } else {
            showAlert(alertId, `Download ${newCount}/2 realizado.`, 'info', 4000);
        }

    } catch (error) {
        console.error("Erro ao registrar download:", error);
        showAlert(alertId, `Erro ao registrar download: ${error.message}`, 'error');
    }
}


// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initMateriaisListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.formMateriais) {
        DOM_ELEMENTS.formMateriais.addEventListener('submit', handleMateriaisSubmit);
    }

    // Listeners de clique centralizados para as tabelas de workflow
    const contentMateriais = document.querySelector('#content-materiais');
    if (contentMateriais) {
        contentMateriais.addEventListener('click', (e) => {
            const retiradaBtn = e.target.closest('button.btn-retirada[data-id]');
            const entregueBtn = e.target.closest('button.btn-entregue[data-id]');
            const startSeparacaoBtn = e.target.closest('button.btn-start-separacao[data-id]');
            const downloadPedidoBtn = e.target.closest('button.btn-download-pedido[data-id]');

            if (retiradaBtn) {
                 handleMarcarRetirada(e);
            } else if (entregueBtn) {
                 handleMarcarEntregue(e);
            } else if (startSeparacaoBtn) {
                 openSeparadorModal(startSeparacaoBtn.dataset.id);
            } else if (downloadPedidoBtn) {
                 handleDownloadPedido(downloadPedidoBtn.dataset.id, downloadPedidoBtn.dataset.url);
            }
        });
    }

    // Listener para o modal do separador
    if (DOM_ELEMENTS.btnSalvarSeparador) {
        DOM_ELEMENTS.btnSalvarSeparador.addEventListener('click', handleSalvarSeparador);
    }
    // Listener para o modal de finalização de entrega
    if (DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega) {
        DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.addEventListener('click', handleFinalizarEntregaSubmit);
    }
    // Listeners para filtros de busca (Histórico)
    if (document.getElementById('filtro-historico-entregues')) {
        document.getElementById('filtro-historico-entregues').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-entregues'), 'table-historico-entregues'));
    }
}

/**
 * Função de orquestração para a tab de Materiais.
 */
export function onMateriaisTabChange() {
    switchSubTabView('materiais', 'lancar-materiais');
    renderMateriaisStatus(); 
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.inputDataSeparacao) DOM_ELEMENTS.inputDataSeparacao.value = getTodayDateString();
}
