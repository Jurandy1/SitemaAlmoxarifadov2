// js/modules/gas-control.js
import { Timestamp, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getGasMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueGas, getUserRole } from "../utils/cache.js"; 
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, filterTable, renderPermissionsUI } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";

// =========================================================================
// LÓGICA DE ESTOQUE (Movido de app.js)
// =========================================================================

/**
 * Renderiza o resumo do estoque de gás.
 */
export function renderEstoqueGas() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.estoqueGasAtualEl) return;
    
    if (DOM_ELEMENTS.loadingEstoqueGasEl) DOM_ELEMENTS.loadingEstoqueGasEl.style.display = 'none';
    
    if (isEstoqueInicialDefinido('gas')) {
        if(DOM_ELEMENTS.btnAbrirInicialGas) DOM_ELEMENTS.btnAbrirInicialGas.classList.add('hidden'); 
        if(DOM_ELEMENTS.formInicialGasContainer) DOM_ELEMENTS.formInicialGasContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueGasEl) DOM_ELEMENTS.resumoEstoqueGasEl.classList.remove('hidden');
    } else { 
        if(DOM_ELEMENTS.btnAbrirInicialGas) DOM_ELEMENTS.btnAbrirInicialGas.classList.remove('hidden'); 
        if(DOM_ELEMENTS.formInicialGasContainer) DOM_ELEMENTS.formInicialGasContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueGasEl) DOM_ELEMENTS.resumoEstoqueGasEl.classList.add('hidden'); 
    }

    const estoqueGas = getEstoqueGas();
    const movs = getGasMovimentacoes();

    const estoqueInicial = estoqueGas.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + e.quantidade, 0);
    const totalEntradas = estoqueGas.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + e.quantidade, 0);
    const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueAtual = estoqueInicial + totalEntradas - totalSaidas;

    if (DOM_ELEMENTS.estoqueGasInicialEl) DOM_ELEMENTS.estoqueGasInicialEl.textContent = estoqueInicial;
    if (DOM_ELEMENTS.estoqueGasEntradasEl) DOM_ELEMENTS.estoqueGasEntradasEl.textContent = `+${totalEntradas}`;
    if (DOM_ELEMENTS.estoqueGasSaidasEl) DOM_ELEMENTS.estoqueGasSaidasEl.textContent = `-${totalSaidas}`;
    if (DOM_ELEMENTS.estoqueGasAtualEl) DOM_ELEMENTS.estoqueGasAtualEl.textContent = estoqueAtual;

    // Garante que a permissão é re-aplicada no contêiner do formulário inicial se ele for exposto
    renderPermissionsUI(); 
}

/**
 * Lança o estoque inicial.
 */
export async function handleInicialEstoqueSubmit(e) {
    e.preventDefault();
    
    const role = getUserRole(); // Obter o role
    if (role === 'anon') { 
        showAlert('alert-inicial-gas', "Permissão negada. Usuário Anônimo não pode alterar o estoque.", 'error'); return; 
    }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const inputQtd = DOM_ELEMENTS.inputInicialQtdGas.value;
    const inputResp = DOM_ELEMENTS.inputInicialResponsavelGas.value;
    
    const quantidade = parseInt(inputQtd, 10);
    const responsavel = capitalizeString(inputResp.trim());

    if (isNaN(quantidade) || quantidade < 0 || !responsavel) { 
        showAlert('alert-inicial-gas', "Preencha a quantidade e o responsável.", 'warning'); return; 
    }
    
    if (isEstoqueInicialDefinido('gas')) {
         showAlert('alert-inicial-gas', "O estoque inicial já foi definido.", 'info'); return;
    }
    
    DOM_ELEMENTS.btnSubmitInicialGas.disabled = true; 
    DOM_ELEMENTS.btnSubmitInicialGas.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueGas, { 
            tipo: 'inicial', 
            quantidade: quantidade, 
            data: serverTimestamp(), // Data da entrada (Movimentação/Data)
            responsavel: responsavel, 
            notaFiscal: 'INICIAL', 
            registradoEm: serverTimestamp() // Data do Lançamento
        });
        showAlert('alert-inicial-gas', "Estoque inicial salvo!", 'success', 2000);
         DOM_ELEMENTS.formInicialGasContainer.classList.add('hidden');
         DOM_ELEMENTS.btnAbrirInicialGas.classList.add('hidden');
    } catch (error) {
        console.error("Erro ao salvar estoque inicial:", error);
        showAlert('alert-inicial-gas', `Erro ao salvar: ${error.message}`, 'error');
        DOM_ELEMENTS.btnSubmitInicialGas.disabled = false; 
        DOM_ELEMENTS.btnSubmitInicialGas.textContent = 'Salvar Inicial'; 
    }
}

/**
 * Lança a entrada de estoque (compra/reposição).
 */
export async function handleEntradaEstoqueSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; } 
    
    const role = getUserRole(); // Obter o role
    if (role === 'anon') { 
        showAlert('alert-gas', "Permissão negada. Usuário Anônimo não pode lançar entradas.", 'error'); return; 
    }

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const inputQtd = DOM_ELEMENTS.inputQtdEntradaGas.value;
    const inputData = DOM_ELEMENTS.inputDataEntradaGas.value;
    const inputResp = DOM_ELEMENTS.inputResponsavelEntradaGas.value;
    const inputNf = DOM_ELEMENTS.inputNfEntradaGas.value;
    
    const quantidade = parseInt(inputQtd, 10);
    const data = dateToTimestamp(inputData);
    const responsavel = capitalizeString(inputResp.trim());
    const notaFiscal = inputNf.trim() || 'N/A'; 

    if (!quantidade || quantidade <= 0 || !data || !responsavel) { 
        showAlert('alert-gas', 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning'); return; 
    }
    if (!isEstoqueInicialDefinido('gas')) { 
        showAlert('alert-gas', `Defina o Estoque Inicial de Gás antes de lançar entradas.`, 'warning'); return; 
    }
    
    DOM_ELEMENTS.btnSubmitEntradaGas.disabled = true; 
    DOM_ELEMENTS.btnSubmitEntradaGas.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueGas, { 
            tipo: 'entrada', 
            quantidade: quantidade, 
            data: data, // Data da entrada (Movimentação/Data)
            responsavel: responsavel, 
            notaFiscal: notaFiscal, 
            registradoEm: serverTimestamp() // Data do Lançamento
        });
        showAlert('alert-gas', 'Entrada no estoque salva!', 'success');
        DOM_ELEMENTS.formEntradaGas.reset(); 
        DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString(); 
    } catch (error) {
        console.error("Erro salvar entrada estoque:", error); 
        showAlert('alert-gas', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTS.btnSubmitEntradaGas.disabled = false; 
        DOM_ELEMENTS.btnSubmitEntradaGas.textContent = 'Salvar Entrada'; 
    }
}

// =========================================================================
// LÓGICA DE MOVIMENTAÇÃO (Saída/Retorno)
// =========================================================================

/**
 * Controla a visibilidade dos campos de quantidade no formulário de movimentação.
 */
export function toggleGasFormInputs() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.selectTipoGas) return; 
    const tipo = DOM_ELEMENTS.selectTipoGas.value;
    if (tipo === 'troca') {
        DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.remove('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.remove('hidden');
    } else if (tipo === 'entrega') {
        DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.remove('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.add('hidden');
        if(DOM_ELEMENTS.inputQtdRetornoGas) DOM_ELEMENTS.inputQtdRetornoGas.value = "0"; 
    } else if (tipo === 'retorno') {
        DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.add('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.remove('hidden');
        if(DOM_ELEMENTS.inputQtdEntregueGas) DOM_ELEMENTS.inputQtdEntregueGas.value = "0"; 
    }
}

/**
 * Obtém o saldo de botijões de gás de uma unidade.
 */
export function getUnidadeSaldoGas(unidadeId) {
    if (!unidadeId) return 0;
    const movimentacoes = getGasMovimentacoes();
    const entregues = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const recebidos = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);
    return entregues - recebidos;
}

/**
 * Verifica e exibe o alerta de saldo no formulário.
 */
export function checkUnidadeSaldoAlertGas() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.selectUnidadeGas) return;
    const selectValue = DOM_ELEMENTS.selectUnidadeGas.value;
    const saldoAlertaEl = DOM_ELEMENTS.unidadeSaldoAlertaGas;
    
    if (!selectValue || !saldoAlertaEl) {
        if(saldoAlertaEl) saldoAlertaEl.style.display = 'none';
        return;
    }
    
    const [unidadeId, unidadeNome] = selectValue.split('|');
    const saldo = getUnidadeSaldoGas(unidadeId);
    const itemLabel = 'botijão de gás';

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
 * Submete o formulário de movimentação de gás (inicia o fluxo do modal).
 */
export async function handleGasSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole(); // Obter o role
    if (role === 'anon') { 
        showAlert('alert-gas', "Permissão negada. Usuário Anônimo não pode lançar movimentações.", 'error'); return; 
    }

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const selectValue = DOM_ELEMENTS.selectUnidadeGas.value; 
    if (!selectValue) { showAlert('alert-gas', 'Selecione uma unidade.', 'warning'); return; }
    const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
    
    const tipoMovimentacao = DOM_ELEMENTS.selectTipoGas.value; 
    const qtdEntregue = parseInt(DOM_ELEMENTS.inputQtdEntregueGas.value, 10) || 0;
    const qtdRetorno = parseInt(DOM_ELEMENTS.inputQtdRetornoGas.value, 10) || 0;
    const data = dateToTimestamp(DOM_ELEMENTS.inputDataGas.value); // Data da Movimentação
    const responsavelUnidade = capitalizeString(DOM_ELEMENTS.inputResponsavelGas.value.trim()); 
    
    if (!unidadeId || !data || !responsavelUnidade) {
        showAlert('alert-gas', 'Dados inválidos. Verifique Unidade, Data e Nome de quem Recebeu/Devolveu.', 'warning'); return;
    }
    if (tipoMovimentacao === 'troca' && qtdEntregue === 0 && qtdRetorno === 0) {
         showAlert('alert-gas', 'Para "Troca", ao menos uma das quantidades deve ser maior que zero.', 'warning'); return;
    }
    if (tipoMovimentacao === 'entrega' && qtdEntregue <= 0) {
         showAlert('alert-gas', 'Para "Apenas Saída", a quantidade deve ser maior que zero.', 'warning'); return;
    }
    if (tipoMovimentacao === 'retorno' && qtdRetorno <= 0) {
         showAlert('alert-gas', 'Para "Apenas Retorno", a quantidade deve ser maior que zero.', 'warning'); return;
    }
    
    // Verifica estoque antes de abrir o modal (se houver saída)
    if (qtdEntregue > 0) {
        if (!isEstoqueInicialDefinido('gas')) {
            showAlert('alert-gas', 'Defina o Estoque Inicial de Gás antes de lançar saídas.', 'warning'); return;
        }
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        const estoqueAtual = parseInt(DOM_ELEMENTS.estoqueGasAtualEl.textContent) || 0;
        if (qtdEntregue > estoqueAtual) {
            showAlert('alert-gas', `Erro: Estoque insuficiente. Disponível: ${estoqueAtual}`, 'error'); return;
        }
    }
    
    // Abre o modal de confirmação do almoxarifado
    executeFinalMovimentacao({
        unidadeId, unidadeNome, tipoUnidadeRaw,
        tipoMovimentacao, qtdEntregue, qtdRetorno,
        data, responsavelUnidade, itemType: 'gas'
    });
}

/**
 * Renderiza a tabela de status/saldo de botijões.
 */
export function renderGasStatus(newFilter = null) {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.tableStatusGas) return;
    
    const currentFilter = newFilter || getCurrentStatusFilter('gas');
    if (newFilter) setCurrentStatusFilter('gas', newFilter);
    
    const statusMap = new Map();
     getUnidades().forEach(u => { 
        let tipoNormalizado = (u.tipo || 'N/A').toUpperCase();
        if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
        statusMap.set(u.id, { id: u.id, nome: u.nome, tipo: tipoNormalizado, entregues: 0, recebidos: 0, ultimosLancamentos: [] }); 
    });

     const movsOrdenadas = [...getGasMovimentacoes()].sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));
     
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
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.tableStatusGas.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-500">Nenhuma movimentação registrada.</td></tr>'; 
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
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.tableStatusGas.innerHTML = html;
     if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 

    const filtroStatusGasEl = document.getElementById('filtro-status-gas');
    if (filtroStatusGasEl && filtroStatusGasEl.value) {
        filterTable(filtroStatusGasEl, 'table-status-gas');
    }
}

/**
 * Renderiza a tabela de histórico geral de movimentações.
 */
export function renderGasMovimentacoesHistory() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.tableHistoricoGasAll) return;
    
    const movimentacoes = getGasMovimentacoes();
    const role = getUserRole();
    const isAdmin = role === 'admin';

    const historicoOrdenado = [...movimentacoes]
        .filter(m => m.tipo === 'entrega' || m.tipo === 'retorno')
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.tableHistoricoGasAll.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-500">Nenhuma movimentação de unidade registrada.</td></tr>`;
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

        // Renderiza o botão de remoção apenas para Admin
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove" data-id="${m.id}" data-type="gas" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="Lançado por: ${respAlmox}">
            <td>${m.unidadeNome || 'N/A'}</td>
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${respAlmox}</td>
            <td>${respUnidade}</td>
            <td class="text-center whitespace-nowrap text-xs">${dataLancamento}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.tableHistoricoGasAll.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = document.getElementById(`filtro-historico-gas`);
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTS.tableHistoricoGasAll.id); }
}


// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initGasListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.formGas) {
        DOM_ELEMENTS.formGas.addEventListener('submit', handleGasSubmit);
    }
    if (DOM_ELEMENTS.selectTipoGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.selectTipoGas.addEventListener('change', toggleGasFormInputs);
    }
    if (DOM_ELEMENTS.selectUnidadeGas) {
         // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
         DOM_ELEMENTS.selectUnidadeGas.addEventListener('change', checkUnidadeSaldoAlertGas);
    }
    if (DOM_ELEMENTS.formInicialGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.formInicialGas.addEventListener('submit', handleInicialEstoqueSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS (incluindo o uso dentro da função)
        DOM_ELEMENTS.btnAbrirInicialGas.addEventListener('click', () => { 
            DOM_ELEMENTS.formInicialGasContainer?.classList.remove('hidden'); 
            DOM_ELEMENTS.btnAbrirInicialGas?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaGas) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.formEntradaGas.addEventListener('submit', handleEntradaEstoqueSubmit);
    }
    if (document.getElementById('filtro-status-gas')) {
        document.getElementById('filtro-status-gas').addEventListener('input', () => filterTable(document.getElementById('filtro-status-gas'), 'table-status-gas'));
    }
    if (document.getElementById('filtro-historico-gas')) {
        document.getElementById('filtro-historico-gas').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-gas'), 'table-historico-gas-all'));
    }
    if (document.getElementById('sub-nav-gas')) {
        document.getElementById('sub-nav-gas').addEventListener('click', (e) => {
            const btn = e.target.closest('.sub-nav-btn');
            if (btn && btn.dataset.subview) switchSubTabView('gas', btn.dataset.subview);
        });
    }

    // Listener para o filtro de saldo na tabela de status
    document.querySelectorAll('#filtro-saldo-gas-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        handleSaldoFilterUI('gas', e, renderGasStatus);
    }));

    // Listener para as abas de formulário
    document.querySelectorAll('#content-gas .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-gas .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        if (DOM_ELEMENTS.formGas) DOM_ELEMENTS.formGas.classList.toggle('hidden', formName !== 'saida-gas');
        if (DOM_ELEMENTS.formEntradaGas) DOM_ELEMENTS.formEntradaGas.classList.toggle('hidden', formName !== 'entrada-gas');
    }));
}

/**
 * Função de orquestração para a tab de Gás.
 */
export function onGasTabChange() {
    switchSubTabView('gas', 'movimentacao-gas');
    toggleGasFormInputs(); 
    checkUnidadeSaldoAlertGas();
    renderEstoqueGas();
    renderGasStatus();
    renderGasMovimentacoesHistory();
    // Garante que o input de data está em dia
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.inputDataGas) DOM_ELEMENTS.inputDataGas.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaGas) DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();
    
    const filtroStatus = document.getElementById('filtro-status-gas');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-gas');
    if (filtroHistorico) filtroHistorico.value = '';

    // Aplica as permissões após a renderização
    renderPermissionsUI();
}
