// js/modules/agua-control.js// js/modules/agua-control.js
import { Timestamp, addDoc, updateDoc, serverTimestamp, query, where, getDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getAguaMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueAgua, getUserRole } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, openConfirmDeleteModal, filterTable, renderPermissionsUI } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady, getUserId } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";

let debitoAguaMode = 'devendo';

// =========================================================================
// LÓGICA DE ESTOQUE (Movido de app.js)
// =========================================================================

/**
 * Renderiza o resumo do estoque de água.
 */
export function renderEstoqueAgua() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.estoqueAguaAtualEl) return; 
    
    if (DOM_ELEMENTS.loadingEstoqueAguaEl) DOM_ELEMENTS.loadingEstoqueAguaEl.style.display = 'none'; 
    
    if (isEstoqueInicialDefinido('agua')) {
        if(DOM_ELEMENTS.btnAbrirInicialAgua) DOM_ELEMENTS.btnAbrirInicialAgua.classList.add('hidden'); 
        if(DOM_ELEMENTS.formInicialAguaContainer) DOM_ELEMENTS.formInicialAguaContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueAguaEl) DOM_ELEMENTS.resumoEstoqueAguaEl.classList.remove('hidden'); 
    } else { 
        if(DOM_ELEMENTS.btnAbrirInicialAgua) DOM_ELEMENTS.btnAbrirInicialAgua.classList.remove('hidden'); 
        if(DOM_ELEMENTS.formInicialAguaContainer) DOM_ELEMENTS.formInicialAguaContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueAguaEl) DOM_ELEMENTS.resumoEstoqueAguaEl.classList.add('hidden'); 
    }

    const estoqueAgua = getEstoqueAgua();
    const movs = getAguaMovimentacoes();

    const estoqueInicial = estoqueAgua.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + e.quantidade, 0);
    const totalEntradas = estoqueAgua.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + e.quantidade, 0);
    const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueAtual = estoqueInicial + totalEntradas - totalSaidas;

    if (DOM_ELEMENTS.estoqueAguaInicialEl) DOM_ELEMENTS.estoqueAguaInicialEl.textContent = estoqueInicial;
    if (DOM_ELEMENTS.estoqueAguaEntradasEl) DOM_ELEMENTS.estoqueAguaEntradasEl.textContent = `+${totalEntradas}`;
    if (DOM_ELEMENTS.estoqueAguaSaidasEl) DOM_ELEMENTS.estoqueAguaSaidasEl.textContent = `-${totalSaidas}`;
    if (DOM_ELEMENTS.estoqueAguaAtualEl) DOM_ELEMENTS.estoqueAguaAtualEl.textContent = estoqueAtual;

    // Garante que a permissão é re-aplicada no contêiner do formulário inicial se ele for exposto
    renderPermissionsUI(); 
}

/**
 * Lança o estoque inicial.
 */
export async function handleInicialEstoqueSubmit(e) {
    e.preventDefault();
    
    const role = getUserRole(); // Obter o role
    // CORRIGIDO: Estoque inicial é Admin-only.
    if (role !== 'admin') { 
        showAlert('alert-inicial-agua', "Permissão negada. Apenas Administradores podem definir o estoque inicial.", 'error'); return; 
    }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
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
    
    const role = getUserRole(); // Obter o role
    // CORRIGIDO: Entrada de estoque é Admin-only.
    if (role !== 'admin') { 
        showAlert('alert-agua', "Permissão negada. Apenas Administradores podem lançar entradas no estoque.", 'error'); return; 
    }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
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
    DOM_ELEMENTS.btnSubmitEntradaAgua.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
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
        DOM_ELEMENTS.formEntradaAgua.reset(); 
        DOM_ELEMENTS.inputDataEntradaAgua.value = getTodayDateString(); 
    } catch (error) {
        console.error("Erro salvar entrada estoque:", error); 
        showAlert('alert-agua', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTS.btnSubmitEntradaAgua.disabled = false; 
        DOM_ELEMENTS.btnSubmitEntradaAgua.textContent = 'Salvar Entrada'; 
    }
}

// =========================================================================
// LÓGICA DE MOVIMENTAÇÃO (Saída/Retorno)
// =========================================================================

/**
 * Controla a visibilidade dos campos de quantidade no formulário de movimentação.
 */
export function toggleAguaFormInputs() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.selectTipoAgua) return; 
    const tipo = DOM_ELEMENTS.selectTipoAgua.value;
    if (tipo === 'troca') {
        DOM_ELEMENTS.formGroupQtdEntregueAgua?.classList.remove('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoAgua?.classList.remove('hidden');
    } else if (tipo === 'entrega') {
        DOM_ELEMENTS.formGroupQtdEntregueAgua?.classList.remove('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoAgua?.classList.add('hidden');
        if (DOM_ELEMENTS.inputQtdRetornoAgua) DOM_ELEMENTS.inputQtdRetornoAgua.value = "0"; 
    } else if (tipo === 'retorno') {
        DOM_ELEMENTS.formGroupQtdEntregueAgua?.classList.add('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoAgua?.classList.remove('hidden');
        if (DOM_ELEMENTS.inputQtdEntregueAgua) DOM_ELEMENTS.inputQtdEntregueAgua.value = "0"; 
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
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.selectUnidadeAgua) return;
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
        message = `<i data-lucide="alert-triangle" class="w-5 h-5 inline-block -mt-1 mr-2"></i> <strong>ALERTA DE DÉBITO:</strong> A unidade **${unidadeNome}** está devendo **${saldo}** ${itemLabel}${saldo > 1 ? 's' : ''} vazio${saldo > 1 ? 's' : ''}.<br><strong>Ação:</strong> Ao fazer a entrega, certifique-se de pegar os vazios pendentes.`;
        type = 'error'; // Mudar de 'warning' (amarelo) para 'error' (vermelho) para ser mais forte
    } else if (saldo < 0) {
        const credito = Math.abs(saldo);
        message = `<i data-lucide="check-circle" class="w-5 h-5 inline-block -mt-1 mr-2"></i> <strong>SALDO POSITIVO (CRÉDITO):</strong> A unidade **${unidadeNome}** tem um crédito de **${credito}** ${itemLabel}${credito > 1 ? 's' : ''}.<br><strong>Motivo:</strong> Ela devolveu mais vasilhames vazios do que recebeu cheios. O saldo está negativo (em crédito).`;
        type = 'success'; // Manter 'success' (verde)
    } else {
        message = `<i data-lucide="thumbs-up" class="w-5 h-5 inline-block -mt-1 mr-2"></i> <strong>SALDO ZERADO:</strong> A unidade **${unidadeNome}** está com o saldo quite (0).<br><strong>Ação:</strong> Situação ideal para uma troca (entregar 1, receber 1).`;
        type = 'info'; // Manter 'info' (azul)
    }

    saldoAlertaEl.className = `alert alert-${type} mt-2`;
    saldoAlertaEl.innerHTML = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    saldoAlertaEl.style.display = 'block';
    // Força a renderização do ícone lucide
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

/**
 * Submete o formulário de movimentação de água (inicia o fluxo do modal).
 */
export async function handleAguaSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-agua', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole(); // Obter o role
    // PERMISSÃO: Editor/Admin (Anon bloqueado na UI)
    if (role === 'anon') { 
        showAlert('alert-agua', "Permissão negada. Usuário Anônimo não pode lançar movimentações.", 'error'); return; 
    }

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const selectValue = DOM_ELEMENTS.selectUnidadeAgua.value; 
    if (!selectValue) { showAlert('alert-agua', 'Selecione uma unidade.', 'warning'); return; }
    const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
    
    const tipoMovimentacao = DOM_ELEMENTS.selectTipoAgua.value; 
    const qtdEntregue = parseInt(DOM_ELEMENTS.inputQtdEntregueAgua.value, 10) || 0;
    const qtdRetorno = parseInt(DOM_ELEMENTS.inputQtdRetornoAgua.value, 10) || 0;
    const data = dateToTimestamp(DOM_ELEMENTS.inputDataAgua.value); // Data da Movimentação
    const responsavelUnidade = capitalizeString(DOM_ELEMENTS.inputResponsavelAgua.value.trim()); 
    
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
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        const estoqueAtual = parseInt(DOM_ELEMENTS.estoqueAguaAtualEl.textContent) || 0;
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
     // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
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
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
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
    DOM_ELEMENTS.tableStatusAgua.innerHTML = html;
     if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 

    const filtroStatusAguaEl = document.getElementById('filtro-status-agua');
    if (filtroStatusAguaEl && filtroStatusAguaEl.value) {
        filterTable(filtroStatusAguaEl, 'table-status-agua');
    }
}

/**
 * Renderiza um resumo compacto das unidades devendo galões vazios
 * para exibir no topo da subview de movimentação.
 */
export function renderAguaDebitosResumo() {
    if (!DOM_ELEMENTS.tableDebitoAguaResumo) return;
    const statusMap = new Map();
    getUnidades().forEach(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        statusMap.set(u.id, { id: u.id, nome: u.nome, tipo, entregues: 0, recebidos: 0, ultimo: null });
    });

    const movsOrdenadas = [...getAguaMovimentacoes()].sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));
    movsOrdenadas.forEach(m => {
        const s = statusMap.get(m.unidadeId);
        if (!s) return;
        if (m.tipo === 'entrega') s.entregues += m.quantidade; else if (m.tipo === 'retorno') s.recebidos += m.quantidade;
        if (!s.ultimo) s.ultimo = { data: m.data, tipo: m.tipo, quantidade: m.quantidade, respUnidade: m.responsavel, respAlmox: m.responsavelAlmoxarifado || 'N/A' };
    });

    const listaBase = Array.from(statusMap.values()).map(s => ({ ...s, pendentes: s.entregues - s.recebidos }));
    const lista = (debitoAguaMode === 'credito')
        ? listaBase.filter(s => s.pendentes < 0).sort((a, b) => (Math.abs(b.pendentes) - Math.abs(a.pendentes)) || a.nome.localeCompare(b.nome))
        : listaBase.filter(s => s.pendentes > 0).sort((a, b) => (b.pendentes - a.pendentes) || a.nome.localeCompare(b.nome));

    if (lista.length === 0) {
        const vazioMsg = debitoAguaMode === 'credito' ? 'Nenhuma unidade com crédito no momento.' : 'Nenhuma unidade devendo vazios no momento.';
        DOM_ELEMENTS.tableDebitoAguaResumo.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-500">${vazioMsg}</td></tr>`;
        return;
    }

    const grupos = lista.reduce((acc, s) => { (acc[s.tipo] ||= []).push(s); return acc; }, {});
    const tiposOrdenados = Object.keys(grupos).sort();
    const rows = [];
    tiposOrdenados.forEach(tipo => {
        rows.push(`<tr class="table-group-header"><td colspan="4">${tipo}</td></tr>`);
        grupos[tipo].forEach(s => {
            const ultimo = s.ultimo ? `${formatTimestampComTempo(s.ultimo.data)} • ${s.ultimo.tipo} (${s.ultimo.quantidade})` : 'N/A';
            const pendText = debitoAguaMode === 'credito' ? Math.abs(s.pendentes) : s.pendentes;
            const pendClass = debitoAguaMode === 'credito' ? 'text-blue-600' : 'text-red-600';
            rows.push(`<tr>
                <td class="font-medium">${s.nome}</td>
                <td><span class="badge badge-gray">${s.tipo}</span></td>
                <td class="text-center ${pendClass} font-extrabold">${pendText}</td>
                <td class="text-xs text-gray-600">${ultimo}</td>
            </tr>`);
        });
    });
    DOM_ELEMENTS.tableDebitoAguaResumo.innerHTML = rows.join('');
}

// NOVO PONTO 1: Renderiza Histórico de Entradas (Estoque)
export function renderAguaEstoqueHistory() {
    if (!DOM_ELEMENTS.tableHistoricoEstoqueAgua) return;
    
    const estoque = getEstoqueAgua();
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const itemType = 'água';

    // Ordena pelo momento do registro (registradoEm)
    const historicoOrdenado = [...estoque]
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoEstoqueAgua.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-500">Nenhuma entrada de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    
    historicoOrdenado.forEach(m => {
        const isInicial = m.tipo === 'inicial';
        const tipoClass = isInicial ? 'badge-blue' : 'badge-green';
        const tipoText = isInicial ? 'Inicial' : 'Entrada';
        
        const dataMov = formatTimestampComTempo(m.data);
        const dataLancamento = formatTimestampComTempo(m.registradoEm);
        const notaFiscal = m.notaFiscal || 'N/A';
        const responsavel = m.responsavel || 'N/A';

        const details = isInicial 
            ? `Estoque Inicial (${itemType}): ${m.quantidade} unidades.`
            : `Entrada de Estoque (${itemType}): ${m.quantidade} unidades, NF: ${notaFiscal}.`;
        
        // Renderiza o botão de remoção apenas para Admin
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="entrada-agua" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="Lançado em: ${dataLancamento}">
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${notaFiscal}</td>
            <td>${responsavel}</td>
            <td class="text-center whitespace-nowrap text-xs">${dataLancamento}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    DOM_ELEMENTS.tableHistoricoEstoqueAgua.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = DOM_ELEMENTS.filtroHistoricoEstoqueAgua;
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTS.tableHistoricoEstoqueAgua.id); }
}


/**
 * Renderiza a tabela de histórico geral de movimentações.
 */
export function renderAguaMovimentacoesHistory() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.tableHistoricoAguaAll) return;
    
    const role = getUserRole();
    const isAdmin = role === 'admin';

    const historicoOrdenado = getFilteredAguaMovimentacoes()
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
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
        
        // Renderiza o botão de remoção apenas para Admin
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="agua" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

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
    DOM_ELEMENTS.tableHistoricoAguaAll.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = document.getElementById(`filtro-historico-agua`);
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTS.tableHistoricoAguaAll.id); }

    // Checagem de integridade após renderização
    checkAguaHistoryIntegrity();
}


// =====================================================
// Filtros avançados e verificação de integridade (helpers)
// =====================================================

function populateAguaFilterUnidades() {
    const sel = document.getElementById('filtro-unidade-agua');
    if (!sel) return;
    const tipoSelecionado = document.getElementById('filtro-tipo-agua')?.value || '';
    const tipoUnidadeSelecionado = (document.getElementById('filtro-unidade-tipo-agua')?.value || '').toUpperCase();

    // Unidades permitidas conforme o Tipo selecionado (Entrega/Retorno)
    const movs = getAguaMovimentacoes().filter(m => (m.tipo === 'entrega' || m.tipo === 'retorno') && (!tipoSelecionado || m.tipo === tipoSelecionado));
    const unidadeIdsPermitidas = new Set(movs.map(m => m.unidadeId).filter(Boolean));
    const unidades = getUnidades().filter(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        const matchTipoMov = (!tipoSelecionado || unidadeIdsPermitidas.has(u.id));
        const matchTipoUnidade = (!tipoUnidadeSelecionado || uTipo === tipoUnidadeSelecionado);
        return matchTipoMov && matchTipoUnidade;
    });

    const valorAnterior = sel.value;
    sel.innerHTML = '<option value="">Todas</option>';
    unidades
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.nome;
            sel.appendChild(opt);
        });
    // Mantém seleção se ainda for válida; caso contrário, zera
    if (valorAnterior && (!tipoSelecionado || unidadeIdsPermitidas.has(valorAnterior))) {
        sel.value = valorAnterior;
    } else {
        sel.value = '';
    }
}

function getFilteredAguaMovimentacoes() {
    const tipoEl = document.getElementById('filtro-tipo-agua');
    const unidadeEl = document.getElementById('filtro-unidade-agua');
    const unidadeTipoEl = document.getElementById('filtro-unidade-tipo-agua');
    const respEl = document.getElementById('filtro-responsavel-agua');
    const dataIniEl = document.getElementById('filtro-data-ini-agua') || document.getElementById('filtro-data-inicio-agua');
    const dataFimEl = document.getElementById('filtro-data-fim-agua') || document.getElementById('filtro-data-fim-agua');

    const tipo = tipoEl?.value || '';
    const unidadeId = unidadeEl?.value || '';
    const unidadeTipoSelecionado = (unidadeTipoEl?.value || '').toUpperCase();
    const respQuery = (respEl?.value || '').trim().toLowerCase();
    const dataIniStr = dataIniEl?.value || '';
    const dataFimStr = dataFimEl?.value || '';

    const base = getAguaMovimentacoes().filter(m => m.tipo === 'entrega' || m.tipo === 'retorno');
    const dataIniMs = dataIniStr ? dateToTimestamp(dataIniStr)?.toMillis() : null;
    const dataFimMs = dataFimStr ? dateToTimestamp(dataFimStr)?.toMillis() : null;

    const unidadesMap = new Map(getUnidades().map(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        return [u.id, { tipo: uTipo }];
    }));

    return base.filter(m => {
        if (tipo && m.tipo !== tipo) return false;
        if (unidadeId && m.unidadeId !== unidadeId) return false;
        if (unidadeTipoSelecionado) {
            const info = unidadesMap.get(m.unidadeId);
            if (!info || info.tipo !== unidadeTipoSelecionado) return false;
        }
        if (respQuery) {
            const ru = (m.responsavel || '').toLowerCase();
            const ra = (m.responsavelAlmoxarifado || '').toLowerCase();
            if (!ru.includes(respQuery) && !ra.includes(respQuery)) return false;
        }
        const movMs = m.data?.toMillis?.() || null;
        if (dataIniMs && movMs && movMs < dataIniMs) return false;
        if (dataFimMs && movMs && movMs > dataFimMs) return false;
        return true;
    });
}

function checkAguaHistoryIntegrity() {
    const movs = getAguaMovimentacoes().filter(m => m.tipo === 'entrega' || m.tipo === 'retorno');
    const unidadesMap = new Map(getUnidades().map(u => [u.id, u]));
    let inconsistenciasMov = 0;
    movs.forEach(m => {
        if (!m.id) inconsistenciasMov++;
        if (!m.unidadeId || !unidadesMap.has(m.unidadeId)) inconsistenciasMov++;
        if (!m.data || typeof m.data.toMillis !== 'function') inconsistenciasMov++;
        if (!m.registradoEm || typeof m.registradoEm.toMillis !== 'function') inconsistenciasMov++;
        if (!['entrega', 'retorno'].includes(m.tipo)) inconsistenciasMov++;
        if (!m.quantidade || m.quantidade <= 0) inconsistenciasMov++;
    });

    const estoque = getEstoqueAgua();
    let inconsistenciasEstoque = 0;
    estoque.forEach(e => {
        if (!e.id) inconsistenciasEstoque++;
        if (!['inicial', 'entrada'].includes(e.tipo)) inconsistenciasEstoque++;
        if (!e.data || typeof e.data.toMillis !== 'function') inconsistenciasEstoque++;
        if (!e.registradoEm || typeof e.registradoEm.toMillis !== 'function') inconsistenciasEstoque++;
        if (!e.quantidade || e.quantidade <= 0) inconsistenciasEstoque++;
    });

    const movMsg = inconsistenciasMov === 0
        ? 'Nenhuma inconsistência detectada nas movimentações de Água.'
        : `Foram encontradas ${inconsistenciasMov} possíveis inconsistências nas movimentações de Água. Revise os lançamentos mais antigos.`;
    const estoqueMsg = inconsistenciasEstoque === 0
        ? 'Nenhuma inconsistência detectada nas entradas de estoque de Água.'
        : `Foram encontradas ${inconsistenciasEstoque} possíveis inconsistências nas entradas de estoque de Água. Verifique registros de NF e datas.`;

    if (document.getElementById('alert-historico-agua')) {
        showAlert('alert-historico-agua', movMsg, inconsistenciasMov === 0 ? 'info' : 'warning');
    }
    if (document.getElementById('alert-historico-estoque-agua')) {
        showAlert('alert-historico-estoque-agua', estoqueMsg, inconsistenciasEstoque === 0 ? 'info' : 'warning');
    }
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initAguaListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.formAgua) {
        DOM_ELEMENTS.formAgua.addEventListener('submit', handleAguaSubmit);
    }
    if (DOM_ELEMENTS.selectTipoAgua) {
        DOM_ELEMENTS.selectTipoAgua.addEventListener('change', toggleAguaFormInputs);
    }
    if (DOM_ELEMENTS.selectUnidadeAgua) {
         DOM_ELEMENTS.selectUnidadeAgua.addEventListener('change', checkUnidadeSaldoAlertAgua);
    }
    if (DOM_ELEMENTS.formInicialAgua) {
        DOM_ELEMENTS.formInicialAgua.addEventListener('submit', handleInicialEstoqueSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialAgua) {
        DOM_ELEMENTS.btnAbrirInicialAgua.addEventListener('click', () => { 
            DOM_ELEMENTS.formInicialAguaContainer?.classList.remove('hidden'); 
            DOM_ELEMENTS.btnAbrirInicialAgua?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaAgua) {
        DOM_ELEMENTS.formEntradaAgua.addEventListener('submit', handleEntradaEstoqueSubmit);
    }
    if (document.getElementById('filtro-status-agua')) {
        document.getElementById('filtro-status-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-status-agua'), 'table-status-agua'));
    }
    if (document.getElementById('filtro-historico-agua')) {
        document.getElementById('filtro-historico-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-agua'), 'table-historico-agua-all'));
    }
    if (DOM_ELEMENTS.filtroDebitoAgua) {
        DOM_ELEMENTS.filtroDebitoAgua.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroDebitoAgua, 'table-debito-agua-resumo'));
    }
    if (DOM_ELEMENTS.btnDebitoAgua) {
        DOM_ELEMENTS.btnDebitoAgua.addEventListener('click', () => {
            debitoAguaMode = 'devendo';
            DOM_ELEMENTS.btnDebitoAgua?.classList.add('active');
            DOM_ELEMENTS.btnCreditoAgua?.classList.remove('active');
            renderAguaDebitosResumo();
        });
    }
    if (DOM_ELEMENTS.btnCreditoAgua) {
        DOM_ELEMENTS.btnCreditoAgua.addEventListener('click', () => {
            debitoAguaMode = 'credito';
            DOM_ELEMENTS.btnCreditoAgua?.classList.add('active');
            DOM_ELEMENTS.btnDebitoAgua?.classList.remove('active');
            renderAguaDebitosResumo();
        });
    }
    if (DOM_ELEMENTS.btnVerStatusAgua) {
        DOM_ELEMENTS.btnVerStatusAgua.addEventListener('click', () => switchSubTabView('agua', 'status-agua'));
    }
    if (DOM_ELEMENTS.filtroDebitoAgua) {
        DOM_ELEMENTS.filtroDebitoAgua.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroDebitoAgua, 'table-debito-agua-resumo'));
    }
    // Filtros avançados (Histórico Água)
    ['filtro-tipo-agua','filtro-unidade-agua','filtro-responsavel-agua','filtro-data-ini-agua','filtro-data-fim-agua']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => {
                renderAguaMovimentacoesHistory();
                const free = document.getElementById('filtro-historico-agua');
                if (free && free.value) filterTable(free, 'table-historico-agua-all');
            });
        });
    // Atualiza opções de Unidade conforme o Tipo selecionado
    const tipoAgua = document.getElementById('filtro-tipo-agua');
    if (tipoAgua) tipoAgua.addEventListener('input', populateAguaFilterUnidades);
    const tipoUnidadeAgua = document.getElementById('filtro-unidade-tipo-agua');
    if (tipoUnidadeAgua) tipoUnidadeAgua.addEventListener('input', () => {
        populateAguaFilterUnidades();
        renderAguaMovimentacoesHistory();
    });
    const btnClear = document.getElementById('btn-limpar-filtros-agua');
    if (btnClear) btnClear.addEventListener('click', () => {
        ['filtro-tipo-agua','filtro-unidade-tipo-agua','filtro-unidade-agua','filtro-responsavel-agua','filtro-data-ini-agua','filtro-data-fim-agua']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        populateAguaFilterUnidades();
        renderAguaMovimentacoesHistory();
        const free = document.getElementById('filtro-historico-agua');
        if (free && free.value) filterTable(free, 'table-historico-agua-all');
    });
    // Popular unidades do filtro ao iniciar
    populateAguaFilterUnidades();
    // NOVO PONTO 1: Listener para o filtro de Histórico de Estoque
    if (DOM_ELEMENTS.filtroHistoricoEstoqueAgua) {
        DOM_ELEMENTS.filtroHistoricoEstoqueAgua.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroHistoricoEstoqueAgua, DOM_ELEMENTS.tableHistoricoEstoqueAgua.id));
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
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        if (DOM_ELEMENTS.formAgua) DOM_ELEMENTS.formAgua.classList.toggle('hidden', formName !== 'saida-agua');
        if (DOM_ELEMENTS.formEntradaAgua) DOM_ELEMENTS.formEntradaAgua.classList.toggle('hidden', formName !== 'entrada-agua');
        // Re-aplica as permissões aqui para garantir que o formulário de Entrada seja desabilitado para Editor
        renderPermissionsUI(); 
    }));

}

/**
 * Função de orquestração para a tab de Água.
 */
export function onAguaTabChange() {
    // Ao trocar a aba, forçamos a subview de movimentação como default
    const currentSubView = document.querySelector('#sub-nav-agua .sub-nav-btn.active')?.dataset.subview || 'movimentacao-agua';
    
    // Atualiza a UI para a subview correta (ou movimentaço como fallback)
    switchSubTabView('agua', currentSubView);
    
    toggleAguaFormInputs(); 
    checkUnidadeSaldoAlertAgua();
    renderEstoqueAgua();
    renderAguaDebitosResumo();
    renderAguaEstoqueHistory(); // NOVO PONTO 1: Adicionado para carregar o histórico
    renderAguaStatus();
    renderAguaMovimentacoesHistory();
    // Garante que o input de data está em dia
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.inputDataAgua) DOM_ELEMENTS.inputDataAgua.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaAgua) DOM_ELEMENTS.inputDataEntradaAgua.value = getTodayDateString();
    
    // CORRIGIDO: Usar verificação `if` em vez de encadeamento opcional na atribuição (linha 466)
    const filtroStatus = document.getElementById('filtro-status-agua');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-agua');
    if (filtroHistorico) filtroHistorico.value = '';

    // Popular filtros e checar integridade ao trocar para a aba
    populateAguaFilterUnidades();
    checkAguaHistoryIntegrity();
    // Aplica as permissões após a renderização
    renderPermissionsUI();
    const innerNavAgua = document.querySelector('#subview-movimentacao-agua .module-inner-subnav');
    if (innerNavAgua) {
        innerNavAgua.addEventListener('click', (e) => {
            const btn = e.target.closest('button.sub-nav-btn[data-inner]');
            if (!btn) return;
            const target = btn.dataset.inner;
            document.querySelectorAll('#subview-movimentacao-agua .module-inner-subnav .sub-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (target === 'resumo') {
                DOM_ELEMENTS.innerAguaResumo?.classList.remove('hidden');
                DOM_ELEMENTS.innerAguaLancamento?.classList.add('hidden');
            } else {
                DOM_ELEMENTS.innerAguaLancamento?.classList.remove('hidden');
                DOM_ELEMENTS.innerAguaResumo?.classList.add('hidden');
            }
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                setTimeout(() => lucide.createIcons(), 50);
            }
        });
    }
    if (DOM_ELEMENTS.btnInnerAguaResumo) {
        DOM_ELEMENTS.btnInnerAguaResumo.addEventListener('click', () => {
            DOM_ELEMENTS.btnInnerAguaResumo.classList.add('active');
            DOM_ELEMENTS.btnInnerAguaLancamento?.classList.remove('active');
            DOM_ELEMENTS.innerAguaResumo?.classList.remove('hidden');
            DOM_ELEMENTS.innerAguaLancamento?.classList.add('hidden');
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { setTimeout(() => lucide.createIcons(), 50); }
        });
    }
    if (DOM_ELEMENTS.btnInnerAguaLancamento) {
        DOM_ELEMENTS.btnInnerAguaLancamento.addEventListener('click', () => {
            DOM_ELEMENTS.btnInnerAguaLancamento.classList.add('active');
            DOM_ELEMENTS.btnInnerAguaResumo?.classList.remove('active');
            DOM_ELEMENTS.innerAguaLancamento?.classList.remove('hidden');
            DOM_ELEMENTS.innerAguaResumo?.classList.add('hidden');
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { setTimeout(() => lucide.createIcons(), 50); }
        });
    }
}
