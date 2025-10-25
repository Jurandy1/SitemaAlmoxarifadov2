// js/modules/agua-control.js
import { Timestamp, addDoc, updateDoc, serverTimestamp, query, where, getDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getAguaMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueAgua } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, openConfirmDeleteModal, filterTable } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady, getUserId } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";

// =========================================================================
// LÓGICA DE ESTOQUE (Movido de app.js)
// =========================================================================

/**
 * Renderiza o resumo do estoque de água.
 */
export function renderEstoqueAgua() {
    if (!DOM_ELEMENTS.estoqueAguaAtualEl) return; 
    
    if (DOM_ELEMENTS.loadingEstoqueAguaEl) DOM_ELEMENTS.loadingEstoqueAguaEl.style.display = 'none'; 
    
    if (isEstoqueInicialDefinido('agua')) {
        if(DOM_ELEMENTS.btnAbrirInicialAgua) DOM_ELEMENTS.btnAbrirInicialAgua.classList.add('hidden'); 
        if(DOM_ELEMENTS.formInicialAguaContainer) DOM_ELEMENTS.formInicialAguaContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueAguaEl) DOM_ELEMENTS.resumoEstoqueAguaEl.classList.remove('hidden'); 
    } else { 
        if(DOM_ELEMENTS.btnAbrirInicialAgua) DOM_ELEMENTS.btnAbrirInicialAgua.classList.remove('hidden'); 
        if(DOM_ELEMENTS.formInicialAguaContainer) DOM_ELEMENTS.formInicialAguaContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueAguaEl) DOM_ELEMENTOS.resumoEstoqueAguaEl.classList.add('hidden'); 
    }

    const estoqueAgua = getEstoqueAgua();
    const movs = getAguaMovimentacoes();

    const estoqueInicial = estoqueAgua.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + e.quantidade, 0);
    const totalEntradas = estoqueAgua.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + e.quantidade, 0);
    const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueAtual = estoqueInicial + totalEntradas - totalSaidas;

    if (DOM_ELEMENTS.estoqueAguaInicialEl) DOM_ELEMENTOS.estoqueAguaInicialEl.textContent = estoqueInicial;
    if (DOM_ELEMENTS.estoqueAguaEntradasEl) DOM_ELEMENTOS.estoqueAguaEntradasEl.textContent = `+${totalEntradas}`;
    if (DOM_ELEMENTS.estoqueAguaSaidasEl) DOM_ELEMENTOS.estoqueAguaSaidasEl.textContent = `-${totalSaidas}`;
    if (DOM_ELEMENTS.estoqueAguaAtualEl) DOM_ELEMENTOS.estoqueAguaAtualEl.textContent = estoqueAtual;
}

/**
 * Lança o estoque inicial.
 */
export async function handleInicialEstoqueSubmit(e) {
    e.preventDefault();
    
    const inputQtd = DOM_ELEMENTS.inputInicialQtdAgua.value;
    const inputResp = DOM_ELEMENTS.inputInicialResponsavelAgua.value;
    
    const quantidade = parseInt(inputQtd, 10);
    const responsavel = capitalizeString(inputResp.trim());

    if (isNaN(quantidade) || quantidade < 0 || !responsavel) { 
        showAlert('alert-inicial-agua', "Preencha a quantidade e o responsável.", 'warning'); return; 
    }
    
    if (isEstoqueInicialDefinido('agua')) {
         showAlert('alert-inicial-agua', "O estoque inicial já foi definido.", 'info'); return;
    }
    
    DOM_ELEMENTS.btnSubmitInicialAgua.disabled = true; 
    DOM_ELEMENTS.btnSubmitInicialAgua.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueAgua, { 
            tipo: 'inicial', 
            quantidade: quantidade, 
            data: serverTimestamp(), // Data da entrada (Movimentação/Data)
            responsavel: responsavel, 
            notaFiscal: 'INICIAL', 
            registradoEm: serverTimestamp() // Data do Lançamento
        });
        showAlert('alert-inicial-agua', "Estoque inicial salvo!", 'success', 2000);
         DOM_ELEMENTS.formInicialAguaContainer.classList.add('hidden');
         DOM_ELEMENTS.btnAbrirInicialAgua.classList.add('hidden');
    } catch (error) {
        console.error("Erro ao salvar estoque inicial:", error);
        showAlert('alert-inicial-agua', `Erro ao salvar: ${error.message}`, 'error');
        DOM_ELEMENTS.btnSubmitInicialAgua.disabled = false; 
        DOM_ELEMENTS.btnSubmitInicialAgua.textContent = 'Salvar Inicial'; 
    }
}

/**
 * Lança a entrada de estoque (compra/reposição).
 */
export async function handleEntradaEstoqueSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-agua', 'Erro: Não autenticado.', 'error'); return; } 
    
    const inputQtd = DOM_ELEMENTS.inputQtdEntradaAgua.value;
    const inputData = DOM_ELEMENTS.inputDataEntradaAgua.value;
    const inputResp = DOM_ELEMENTS.inputResponsavelEntradaAgua.value;
    const inputNf = DOM_ELEMENTS.inputNfEntradaAgua.value;
    
    const quantidade = parseInt(inputQtd, 10);
    const data = dateToTimestamp(inputData);
    const responsavel = capitalizeString(inputResp.trim());
    const notaFiscal = inputNf.trim() || 'N/A'; 

    if (!quantidade || quantidade <= 0 || !data || !responsavel) { 
        showAlert('alert-agua', 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning'); return; 
    }
    if (!isEstoqueInicialDefinido('agua')) { 
        showAlert('alert-agua', `Defina o Estoque Inicial de Água antes de lançar entradas.`, 'warning'); return; 
    }
    
    DOM_ELEMENTS.btnSubmitEntradaAgua.disabled = true; 
    DOM_ELEMENTOS.btnSubmitEntradaAgua.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueAgua, { 
            tipo: 'entrada', 
            quantidade: quantidade, 
            data: data, // Data da entrada (Movimentação/Data)
            responsavel: responsavel, 
            notaFiscal: notaFiscal, 
            registradoEm: serverTimestamp() // Data do Lançamento
        });
        showAlert('alert-agua', 'Entrada no estoque salva!', 'success');
        DOM_ELEMENTOS.formEntradaAgua.reset(); 
        DOM_ELEMENTOS.inputDataEntradaAgua.value = getTodayDateString(); 
    } catch (error) {
        console.error("Erro salvar entrada estoque:", error); 
        showAlert('alert-agua', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTOS.btnSubmitEntradaAgua.disabled = false; 
        DOM_ELEMENTOS.btnSubmitEntradaAgua.textContent = 'Salvar Entrada'; 
    }
}


// =========================================================================
// LÓGICA DE MOVIMENTAÇÃO (Saída/Retorno)
// =========================================================================

/**
 * Controla a visibilidade dos campos de quantidade no formulário de movimentação.
 */
export function toggleAguaFormInputs() {
    if (!DOM_ELEMENTS.selectTipoAgua) return; 
    const tipo = DOM_ELEMENTOS.selectTipoAgua.value;
    if (tipo === 'troca') {
        DOM_ELEMENTOS.formGroupQtdEntregueAgua?.classList.remove('hidden');
        DOM_ELEMENTOS.formGroupQtdRetornoAgua?.classList.remove('hidden');
    } else if (tipo === 'entrega') {
        DOM_ELEMENTOS.formGroupQtdEntregueAgua?.classList.remove('hidden');
        DOM_ELEMENTOS.formGroupQtdRetornoAgua?.classList.add('hidden');
        if (DOM_ELEMENTOS.inputQtdRetornoAgua) DOM_ELEMENTOS.inputQtdRetornoAgua.value = "0"; 
    } else if (tipo === 'retorno') {
        DOM_ELEMENTOS.formGroupQtdEntregueAgua?.classList.add('hidden');
        DOM_ELEMENTOS.formGroupQtdRetornoAgua?.classList.remove('hidden');
        if (DOM_ELEMENTOS.inputQtdEntregueAgua) DOM_ELEMENTOS.inputQtdEntregueAgua.value = "0"; 
    }
}

/**
 * Obtém o saldo de galões de uma unidade.
 */
export function getUnidadeSaldoAgua(unidadeId) {
    if (!unidadeId) return 0;
    const movimentacoes = getAguaMovimentacoes();
    const entregues = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const recebidos = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);
    return entregues - recebidos;
}

/**
 * Verifica e exibe o alerta de saldo no formulário.
 */
export function checkUnidadeSaldoAlertAgua() {
    const selectValue = DOM_ELEMENTS.selectUnidadeAgua.value;
    const saldoAlertaEl = DOM_ELEMENTS.unidadeSaldoAlertaAgua;
    
    if (!selectValue || !saldoAlertaEl) {
        if(saldoAlertaEl) saldoAlertaEl.style.display = 'none';
        return;
    }
    
    const [unidadeId, unidadeNome] = selectValue.split('|');
    const saldo = getUnidadeSaldoAgua(unidadeId);
    const itemLabel = 'galão de água';

    let message = '';
    let type = 'info';
    
    if (saldo > 0) {
        message = `⚠️ Atenção! A unidade **${unidadeNome}** está devendo **${saldo}** ${itemLabel}${saldo > 1 ? 's' : ''} vazio${saldo > 1 ? 's' : ''}. Confirme se o saldo está correto antes de entregar mais.`;
        type = 'warning';
    } else if (saldo < 0) {
        message = `👍 A unidade **${unidadeNome}** tem um crédito de **${Math.abs(saldo)}** ${itemLabel}${Math.abs(saldo) > 1 ? 's' : ''} (recebeu a mais). Lançamento OK para troca/saída.`;
        type = 'success';
    } else {
        message = `✅ A unidade **${unidadeNome}** tem saldo zero. Perfeito para uma troca 1:1.`;
        type = 'info';
    }

    saldoAlertaEl.className = `alert alert-${type} mt-2`;
    saldoAlertaEl.innerHTML = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    saldoAlertaEl.style.display = 'block';
}

/**
 * Submete o formulário de movimentação de água (inicia o fluxo do modal).
 */
export async function handleAguaSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-agua', 'Erro: Não autenticado.', 'error'); return; }
    
    const selectValue = DOM_ELEMENTS.selectUnidadeAgua.value; 
    if (!selectValue) { showAlert('alert-agua', 'Selecione uma unidade.', 'warning'); return; }
    const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
    
    const tipoMovimentacao = DOM_ELEMENTS.selectTipoAgua.value; 
    const qtdEntregue = parseInt(DOM_ELEMENTOS.inputQtdEntregueAgua.value, 10) || 0;
    const qtdRetorno = parseInt(DOM_ELEMENTOS.inputQtdRetornoAgua.value, 10) || 0;
    const data = dateToTimestamp(DOM_ELEMENTOS.inputDataAgua.value); // Data da Movimentação
    const responsavelUnidade = capitalizeString(DOM_ELEMENTOS.inputResponsavelAgua.value.trim()); 
    
    if (!unidadeId || !data || !responsavelUnidade) {
        showAlert('alert-agua', 'Dados inválidos. Verifique Unidade, Data e Nome de quem Recebeu/Devolveu.', 'warning'); return;
    }
    if (tipoMovimentacao === 'troca' && qtdEntregue === 0 && qtdRetorno === 0) {
         showAlert('alert-agua', 'Para "Troca", ao menos uma das quantidades deve ser maior que zero.', 'warning'); return;
    }
    if (tipoMovimentacao === 'entrega' && qtdEntregue <= 0) {
         showAlert('alert-agua', 'Para "Apenas Saída", a quantidade deve ser maior que zero.', 'warning'); return;
    }
    if (tipoMovimentacao === 'retorno' && qtdRetorno <= 0) {
         showAlert('alert-agua', 'Para "Apenas Retorno", a quantidade deve ser maior que zero.', 'warning'); return;
    }
    
    // Verifica estoque antes de abrir o modal (se houver saída)
    if (qtdEntregue > 0) {
        if (!isEstoqueInicialDefinido('agua')) {
            showAlert('alert-agua', 'Defina o Estoque Inicial de Água antes de lançar saídas.', 'warning'); return;
        }
        const estoqueAtual = parseInt(DOM_ELEMENTOS.estoqueAguaAtualEl.textContent) || 0;
        if (qtdEntregue > estoqueAtual) {
            showAlert('alert-agua', `Erro: Estoque insuficiente. Disponível: ${estoqueAtual}`, 'error'); return;
        }
    }
    
    // Abre o modal de confirmação do almoxarifado
    executeFinalMovimentacao({
        unidadeId, unidadeNome, tipoUnidadeRaw,
        tipoMovimentacao, qtdEntregue, qtdRetorno,
        data, responsavelUnidade, itemType: 'agua'
    });
}

/**
 * Renderiza a tabela de status/saldo de galões.
 */
export function renderAguaStatus(newFilter = null) {
     if (!DOM_ELEMENTS.tableStatusAgua) return;
     
     const currentFilter = newFilter || getCurrentStatusFilter('agua');
     if (newFilter) setCurrentStatusFilter('agua', newFilter); // Atualiza o cache se um novo filtro for passado
     
     const statusMap = new Map();
     getUnidades().forEach(u => { 
        let tipoNormalizado = (u.tipo || 'N/A').toUpperCase();
        if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
        statusMap.set(u.id, { id: u.id, nome: u.nome, tipo: tipoNormalizado, entregues: 0, recebidos: 0, ultimosLancamentos: [] }); 
    });

     const movsOrdenadas = [...getAguaMovimentacoes()].sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));
     
     movsOrdenadas.forEach(m => {
         if (statusMap.has(m.unidadeId)) {
             const unidadeStatus = statusMap.get(m.unidadeId);
             if (m.tipo === 'entrega') unidadeStatus.entregues += m.quantidade;
             else if (m.tipo === 'retorno') unidadeStatus.recebidos += m.quantidade;
             
             if (unidadeStatus.ultimosLancamentos.length === 0) {
                 unidadeStatus.ultimosLancamentos.push({
                     id: m.id, respUnidade: m.responsavel, respAlmox: m.responsavelAlmoxarifado || 'N/A', 
                     data: m.data, registradoEm: m.registradoEm, tipo: m.tipo, quantidade: m.quantidade
                });
             }
         }
     });

     let statusArray = Array.from(statusMap.values())
         .map(s => ({ ...s, pendentes: s.entregues - s.recebidos })) 
         .filter(s => s.entregues > 0 || s.recebidos > 0 || s.pendentes !== 0) 
         .sort((a, b) => b.pendentes - a.pendentes || a.nome.localeCompare(b.nome)); 

    // Aplica filtro de saldo
    if (currentFilter === 'devendo') {
        statusArray = statusArray.filter(s => s.pendentes > 0);
    } else if (currentFilter === 'credito') {
        statusArray = statusArray.filter(s => s.pendentes < 0);
    } else if (currentFilter === 'zero') {
        statusArray = statusArray.filter(s => s.pendentes === 0);
    }

    if (statusArray.length === 0) { 
        DOM_ELEMENTS.tableStatusAgua.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-500">Nenhuma movimentação registrada.</td></tr>'; 
        return; 
    }
    
    let html = '';
    statusArray.forEach(s => {
        const saldo = s.pendentes;
        const saldoText = saldo > 0 ? `Faltando ${saldo}` : (saldo < 0 ? `Crédito ${Math.abs(saldo)}` : 'Zerado');
        const saldoClass = saldo > 0 ? 'text-red-600 font-extrabold' : (saldo < 0 ? 'text-blue-600' : 'text-green-600');
        
        const ultimoLancamento = s.ultimosLancamentos[0];
        let lancamentoDetalhes = 'N/A';
        
        if(ultimoLancamento) {
            const acao = ultimoLancamento.tipo === 'entrega' ? 'Entrega' : 'Retirada';
            const dataMovimentacao = formatTimestampComTempo(ultimoLancamento.data);
            const respAlmox = ultimoLancamento.respAlmox;
            const respUnidade = ultimoLancamento.respUnidade;
            
            lancamentoDetalhes = `<span>${dataMovimentacao}</span> (Almox: ${respAlmox} / Unid: ${respUnidade})`;
        }
        
        html += `<tr title="${s.nome} - Saldo: ${saldoText.replace(/<[^>]*>?/gm, '')}">
            <td class="font-medium">${s.nome}</td><td>${s.tipo || 'N/A'}</td>
            <td class="text-center">${s.entregues}</td><td class="text-center">${s.recebidos}</td>
            <td class="text-center font-bold ${saldoClass}">${saldoText}</td>
            <td class="space-x-1 whitespace-nowrap text-xs text-gray-600">
                ${lancamentoDetalhes}
            </td>
        </tr>`;
    });
    DOM_ELEMENTOS.tableStatusAgua.innerHTML = html;
     if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 

    const filtroStatusAguaEl = document.getElementById('filtro-status-agua');
    if (filtroStatusAguaEl && filtroStatusAguaEl.value) {
        filterTable(filtroStatusAguaEl, 'table-status-agua');
    }
}

/**
 * Renderiza a tabela de histórico geral de movimentações.
 */
export function renderAguaMovimentacoesHistory() {
    if (!DOM_ELEMENTS.tableHistoricoAguaAll) return;
    
    const movimentacoes = getAguaMovimentacoes();

    const historicoOrdenado = [...movimentacoes]
        .filter(m => m.tipo === 'entrega' || m.tipo === 'retorno')
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoAguaAll.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-500">Nenhuma movimentação de unidade registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    
    historicoOrdenado.forEach(m => {
        const isEntrega = m.tipo === 'entrega';
        const tipoClass = isEntrega ? 'badge-red' : 'badge-green';
        const tipoText = isEntrega ? 'Entrega' : 'Retirada';
        
        const dataMov = formatTimestampComTempo(m.data);
        const dataLancamento = formatTimestampComTempo(m.registradoEm);
        const respAlmox = m.responsavelAlmoxarifado || 'N/A';
        const respUnidade = m.responsavel || 'N/A';

        const details = `Movimentação ${m.unidadeNome} - ${tipoText} (${m.quantidade})`;

        html += `<tr title="Lançado por: ${respAlmox}">
            <td>${m.unidadeNome || 'N/A'}</td>
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${respAlmox}</td>
            <td>${respUnidade}</td>
            <td class="text-center whitespace-nowrap text-xs">${dataLancamento}</td>
            <td class="text-center">
                <button class="btn-danger btn-remove" data-id="${m.id}" data-type="agua" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>
            </td>
        </tr>`;
    });

    DOM_ELEMENTS.tableHistoricoAguaAll.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = document.getElementById(`filtro-historico-agua`);
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTOS.tableHistoricoAguaAll.id); }
}


// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initAguaListeners() {
    if (DOM_ELEMENTS.formAgua) {
        DOM_ELEMENTS.formAgua.addEventListener('submit', handleAguaSubmit);
    }
    if (DOM_ELEMENTS.selectTipoAgua) {
        DOM_ELEMENTS.selectTipoAgua.addEventListener('change', toggleAguaFormInputs);
    }
    if (DOM_ELEMENTS.selectUnidadeAgua) {
         DOM_ELEMENTOS.selectUnidadeAgua.addEventListener('change', checkUnidadeSaldoAlertAgua);
    }
    if (DOM_ELEMENTS.formInicialAgua) {
        DOM_ELEMENTOS.formInicialAgua.addEventListener('submit', handleInicialEstoqueSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialAgua) {
        DOM_ELEMENTOS.btnAbrirInicialAgua.addEventListener('click', () => { 
            DOM_ELEMENTOS.formInicialAguaContainer?.classList.remove('hidden'); 
            DOM_ELEMENTOS.btnAbrirInicialAgua?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaAgua) {
        DOM_ELEMENTOS.formEntradaAgua.addEventListener('submit', handleEntradaEstoqueSubmit);
    }
    if (document.getElementById('filtro-status-agua')) {
        document.getElementById('filtro-status-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-status-agua'), 'table-status-agua'));
    }
    if (document.getElementById('filtro-historico-agua')) {
        document.getElementById('filtro-historico-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-agua'), 'table-historico-agua-all'));
    }
    if (document.getElementById('sub-nav-agua')) {
        document.getElementById('sub-nav-agua').addEventListener('click', (e) => {
            const btn = e.target.closest('.sub-nav-btn');
            if (btn && btn.dataset.subview) switchSubTabView('agua', btn.dataset.subview);
        });
    }

    // Listener para o filtro de saldo na tabela de status
    document.querySelectorAll('#filtro-saldo-agua-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        handleSaldoFilterUI('agua', e, renderAguaStatus);
    }));

    // Listener para as abas de formulário
    document.querySelectorAll('#content-agua .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-agua .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        DOM_ELEMENTS.formAgua.classList.toggle('hidden', formName !== 'saida-agua');
        DOM_ELEMENTS.formEntradaAgua.classList.toggle('hidden', formName !== 'entrada-agua');
    }));

}

/**
 * Função de orquestração para a tab de Água.
 */
export function onAguaTabChange() {
    switchSubTabView('agua', 'movimentacao-agua');
    toggleAguaFormInputs(); 
    checkUnidadeSaldoAlertAgua();
    renderEstoqueAgua();
    renderAguaStatus();
    renderAguaMovimentacoesHistory();
    // Garante que o input de data está em dia
    if (DOM_ELEMENTS.inputDataAgua) DOM_ELEMENTOS.inputDataAgua.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaAgua) DOM_ELEMENTOS.inputDataEntradaAgua.value = getTodayDateString();
    
    // CORRIGIDO: Usar verificação `if` em vez de encadeamento opcional na atribuição (linha 466)
    const filtroStatus = document.getElementById('filtro-status-agua');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-agua');
    if (filtroHistorico) filtroHistorico.value = '';
}
