// js/modules/social-control.js
import { Timestamp, addDoc, serverTimestamp, getDocs, query, where, writeBatch, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getUnidades, 
    getCestaMovimentacoes, getCestaEstoque, 
    getEnxovalMovimentacoes, getEnxovalEstoque, 
    getUserRole 
} from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestamp } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS, db } from "../services/firestore-service.js";

// =========================================================================
// FUNÇÕES DE UTILIDADE E CÁLCULO DE ESTOQUE
// =========================================================================

/**
 * Calcula o estoque atual (Entradas - Saídas) para um item específico.
 * @param {Array<Object>} estoqueEntries Entradas de estoque (tipo 'entrada' ou 'inicial').
 * @param {Array<Object>} movimentacoes Movimentações (tipo 'saida').
 * @returns {number} Quantidade total em estoque.
 */
function calculateCurrentStock(estoqueEntries, movimentacoes) {
    const totalEntradas = estoqueEntries.reduce((sum, e) => sum + (e.quantidade || 0), 0);
    const totalSaidas = movimentacoes.filter(m => m.tipo === 'saida').reduce((sum, m) => sum + (m.quantidade || 0), 0);
    return totalEntradas - totalSaidas;
}


// =========================================================================
// LÓGICA DE CONTROLE DE UI (Módulos Principal e Secundários)
// =========================================================================

/**
 * Controla a visualização entre Cesta Básica, Enxoval e Importação.
 * @param {string} mainSubView 'cesta-basica', 'enxoval', ou 'importar-dados'.
 */
function switchMainSubModule(mainSubView) {
    // Altera a classe 'active' do botão principal
    DOM_ELEMENTS.subNavSocialMain.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subviewMain === mainSubView);
    });

    // Alterna a visibilidade dos containers de conteúdo
    document.getElementById('social-submodule-cesta-basica')?.classList.toggle('hidden', mainSubView !== 'cesta-basica');
    document.getElementById('social-submodule-enxoval')?.classList.toggle('hidden', mainSubView !== 'enxoval');
    document.getElementById('social-submodule-importar-dados')?.classList.toggle('hidden', mainSubView !== 'importar-dados');

    // Ao mudar o módulo, garante que a sub-view interna seja a padrão
    if (mainSubView === 'cesta-basica') {
        switchInternalSubView('cesta', 'lancamento');
        renderCestaEstoqueSummary();
    } else if (mainSubView === 'enxoval') {
        switchInternalSubView('enxoval', 'lancamento');
        renderEnxovalEstoqueSummary();
    }
}

/**
 * Controla a visualização das sub-vies internas (Lançamento, Estoque, Relatório).
 * @param {string} itemType 'cesta' ou 'enxoval'.
 * @param {string} subViewName 'lancamento', 'estoque' ou 'relatorio'.
 */
function switchInternalSubView(itemType, subViewName) {
    const prefix = `${itemType}-`;
    
    document.querySelectorAll(`#sub-nav-${itemType} button`).forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subview === `${prefix}${subViewName}`);
    });

    const views = ['lancamento', 'estoque', 'relatorio'];
    views.forEach(view => {
        const pane = document.getElementById(`subview-${prefix}${view}`);
        if (pane) {
            pane.classList.toggle('hidden', view !== subViewName);
        }
    });

    // Chama a renderização correta ao trocar para o histórico ou estoque
    if (subViewName === 'estoque') {
        if (itemType === 'cesta') renderCestaEstoqueSummary();
        if (itemType === 'enxoval') renderEnxovalEstoqueSummary();
    }
    if (subViewName === 'relatorio') {
        if (itemType === 'cesta') renderCestaMovimentacoesHistoryTable();
        if (itemType === 'enxoval') renderEnxovalMovimentacoesHistoryTable();
    }
}


// =========================================================================
// LÓGICA DE ENTRADA DE ESTOQUE (Entrada)
// =========================================================================

/**
 * Lida com a submissão do formulário de entrada (reposição/compra) de estoque.
 */
async function handleEstoqueEntrySubmit(e, itemType) {
    e.preventDefault();
    if (!isReady()) { showAlert(`alert-${itemType}-estoque`, 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole();
    if (role !== 'admin' && role !== 'editor') { 
        showAlert(`alert-${itemType}-estoque`, "Permissão negada. Apenas Administradores/Editores podem lançar entradas.", 'error'); return; 
    }

    // Mapeamento de DOM Elements para Cesta ou Enxoval
    const DOM_MAP = {
        'cesta': {
            form: DOM_ELEMENTS.formCestaEntrada,
            qtd: DOM_ELEMENTS.cestaEntradaQuantidade,
            data: DOM_ELEMENTS.cestaEntradaData,
            resp: DOM_ELEMENTS.cestaEntradaResponsavel,
            nf: DOM_ELEMENTS.cestaEntradaNf,
            // NOVO: Custo Unitário e Fornecedor
            custo: document.getElementById('cesta-entrada-custo-unitario'), 
            fornecedor: document.getElementById('cesta-entrada-fornecedor'),
            // FIM NOVO
            btn: DOM_ELEMENTS.btnSubmitCestaEntrada,
            alert: 'alert-cesta-estoque',
            collection: COLLECTIONS.cestaEstoque,
            itemLabel: 'Cesta(s) Básica(s)'
        },
        'enxoval': {
            form: DOM_ELEMENTs.formEnxovalEntrada,
            qtd: DOM_ELEMENTS.enxovalEntradaQuantidade,
            data: DOM_ELEMENTS.enxovalEntradaData,
            resp: DOM_ELEMENTS.enxovalEntradaResponsavel,
            nf: DOM_ELEMENTS.enxovalEntradaNf,
            // NOVOS CAMPOS IGNORADOS PARA ENXOVAL
            custo: null, fornecedor: null,
            // FIM NOVOS
            btn: DOM_ELEMENTS.btnSubmitEnxovalEntrada,
            alert: 'alert-enxoval-estoque',
            collection: COLLECTIONS.enxovalEstoque,
            itemLabel: 'Enxoval(is)'
        }
    };

    const map = DOM_MAP[itemType];
    if (!map) return;

    const quantidade = parseInt(map.qtd.value, 10);
    const data = dateToTimestamp(map.data.value);
    const responsavel = capitalizeString(map.resp.value.trim());
    const notaFiscal = map.nf.value.trim() || 'N/A';
    
    // NOVO: Custo Unitário
    const custoUnitario = map.custo ? parseFloat(map.custo.value) : 0;
    const fornecedor = map.fornecedor ? map.fornecedor.value.trim() : 'N/A';
    // FIM NOVO

    if (!quantidade || quantidade <= 0 || !data || !responsavel) { 
        showAlert(map.alert, 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning'); return; 
    }
    
    // NOVO: Validação específica para Cesta
    if (itemType === 'cesta' && (isNaN(custoUnitario) || custoUnitario < 0)) {
         showAlert(map.alert, 'O Custo Unitário da Cesta deve ser um valor positivo.', 'warning'); return;
    }
    // FIM NOVO

    map.btn.disabled = true; 
    map.btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(map.collection, { 
            tipo: 'entrada', 
            quantidade: quantidade, 
            data: data,
            responsavel: responsavel, 
            notaFiscal: notaFiscal, 
            // NOVO: Custo e Fornecedor
            custoUnitario: custoUnitario,
            fornecedor: fornecedor,
            // FIM NOVO
            registradoEm: serverTimestamp()
        });
        showAlert(map.alert, `Entrada de ${quantidade} ${map.itemLabel} no estoque salva!`, 'success');
        map.form.reset(); 
        map.data.value = getTodayDateString(); 
    } catch (error) {
        console.error(`Erro ao salvar entrada de estoque ${itemType}:`, error); 
        showAlert(map.alert, `Erro ao salvar: ${error.message}`, 'error');
    } finally { 
        map.btn.disabled = false; 
        map.btn.innerHTML = '<i data-lucide="plus-circle"></i> Registrar Entrada'; 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

export const handleCestaEstoqueEntrySubmit = (e) => handleEstoqueEntrySubmit(e, 'cesta');
export const handleEnxovalEstoqueEntrySubmit = (e) => handleEstoqueEntrySubmit(e, 'enxoval');


// =========================================================================
// LÓGICA DE CESTAS BÁSICAS (Lancamento e Estoque)
// =========================================================================

/**
 * Renderiza o resumo de estoque de cestas.
 */
export function renderCestaEstoqueSummary() {
    const estoqueEntries = getCestaEstoque();
    const movimentacoes = getCestaMovimentacoes();
    const estoqueAtual = calculateCurrentStock(estoqueEntries, movimentacoes);
    const totalEntradas = estoqueEntries.reduce((sum, e) => sum + (e.quantidade || 0), 0);
    const totalSaidas = movimentacoes.filter(m => m.tipo === 'saida').reduce((sum, m) => sum + (m.quantidade || 0), 0);

    const resumoEl = DOM_ELEMENTS.cestaEstoqueResumo;
    if (resumoEl) {
        resumoEl.innerHTML = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-start">
                <span class="text-sm text-gray-700">Total em Estoque:</span>
                <strong class="text-3xl font-extrabold text-pink-600 block">${estoqueAtual}</strong>
                <span class="text-xs text-gray-500 mt-1">unidades de cesta disponíveis</span>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-start">
                <span class="text-sm text-gray-700">Total Entradas:</span>
                <strong class="text-3xl font-extrabold text-green-600 block">+${totalEntradas}</strong>
                <span class="text-xs text-gray-500 mt-1">registradas</span>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-start">
                <span class="text-sm text-gray-700">Total Saídas:</span>
                <strong class="text-3xl font-extrabold text-red-600 block">-${totalSaidas}</strong>
                <span class="text-xs text-gray-500 mt-1">registradas</span>
            </div>
        `;
    }

    renderCestaEstoqueHistoryTable();
}

/**
 * Renderiza a tabela de histórico de entradas de estoque (Cesta).
 */
export function renderCestaEstoqueHistoryTable() {
    const estoque = getCestaEstoque();
    const tableBody = DOM_ELEMENTS.tableCestaEstoqueHistory;
    if (!tableBody) return;

    const historicoOrdenado = [...estoque]
        .filter(e => e.tipo === 'entrada') 
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-500">Nenhuma entrada de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    const isAdmin = getUserRole() === 'admin';

    historicoOrdenado.forEach(e => {
        const dataMov = formatTimestamp(e.data);
        const dataLancamento = formatTimestamp(e.registradoEm);
        const notaFiscal = e.notaFiscal || 'N/A';
        const responsavel = e.responsavel || 'N/A';
        const custoUnitario = (e.custoUnitario || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); // NOVO

        const details = `Entrada de Estoque Cesta: ${e.quantidade} un., Custo: ${custoUnitario}, NF: ${notaFiscal}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${e.id}" data-type="estoque-cesta" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="Lançado em: ${dataLancamento} | Fornecedor: ${e.fornecedor || 'N/A'}">
            <td class="text-center font-medium">${e.quantidade}</td>
            <td>${custoUnitario}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${notaFiscal}</td>
            <td>${responsavel}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    tableBody.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Renderiza a tabela de histórico de saídas (Cesta).
 */
export function renderCestaMovimentacoesHistoryTable() {
    const movimentacoes = getCestaMovimentacoes();
    const tableBody = DOM_ELEMENTS.tableCestaHistorico; 
    if (!tableBody) return;

    const historicoOrdenado = [...movimentacoes]
        .filter(m => m.tipo === 'saida') 
        .sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-500">Nenhuma saída de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    const isAdmin = getUserRole() === 'admin';

    historicoOrdenado.forEach(m => {
        const dataMov = formatTimestamp(m.data);
        const statusClass = m.status === 'Entregue' ? 'badge-green' : 'badge-gray';
        // Ajusta custo (agora sempre será 0 ou o valor da importação antiga)
        const custoDisplay = (m.custo || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });


        const details = `Saída Cesta: ${m.quantidade} un. p/ ${m.destinatario}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="mov-cesta" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${m.destinatario}</td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td>${m.categoria}</td>
            <td>${m.responsavel}</td>
            <td><span class="badge ${statusClass}">${m.status}</span></td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    tableBody.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Lida com a submissão do formulário de lançamento (SAÍDA) de Cestas.
 */
export async function handleCestaLancamentoSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-cesta-lancamento', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole();
    if (role === 'anon') { 
        showAlert('alert-cesta-lancamento', "Permissão negada. Usuário Anônimo não pode lançar dados.", 'error'); return; 
    }

    const data = dateToTimestamp(DOM_ELEMENTS.cestaData.value);
    const destinatario = capitalizeString(DOM_ELEMENTS.cestaDestinatario.value.trim());
    const quantidade = parseInt(DOM_ELEMENTS.cestaQuantidade.value, 10);
    const unidade = DOM_ELEMENTS.cestaUnidade.value;
    const categoria = DOM_ELEMENTS.cestaCategoria.value;
    const observacoes = DOM_ELEMENTS.cestaObservacoes.value.trim();
    // CORREÇÃO: Campos de custo e fornecedor não existem mais na SAÍDA
    const custo = 0; // Removido do formulário, fixado em 0 ou pode ser pego do estoque se houver tabela de preços
    const fornecedor = ''; // Removido do formulário de saída
    // FIM CORREÇÃO

    const responsavel = capitalizeString(DOM_ELEMENTS.cestaResponsavel.value.trim());

    if (!data || !destinatario || !quantidade || quantidade <= 0 || !categoria || !responsavel) {
        showAlert('alert-cesta-lancamento', 'Preencha todos os campos obrigatórios (Data, Destinatário, Qtd, Categoria, Responsável).', 'warning');
        return;
    }

    // *** CHECAGEM DE ESTOQUE (NOVO) ***
    const estoqueAtual = calculateCurrentStock(getCestaEstoque(), getCestaMovimentacoes());
    if (quantidade > estoqueAtual) { 
        showAlert('alert-cesta-lancamento', `Estoque insuficiente! Disponível: ${estoqueAtual} ${DOM_ELEMENTS.cestaUnidade.value}(s).`, 'error'); 
        return; 
    }
    // **********************************

    DOM_ELEMENTS.btnSubmitCestaLancamento.disabled = true;
    DOM_ELEMENTS.btnSubmitCestaLancamento.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        await addDoc(COLLECTIONS.cestaMov, {
            data,
            tipo: 'saida', // Saída do estoque
            destinatario,
            quantidade,
            unidade,
            categoria,
            observacoes,
            custo,
            responsavel,
            fornecedor,
            status: 'Entregue', 
            registradoEm: serverTimestamp()
        });

        showAlert('alert-cesta-lancamento', `Lançamento de ${quantidade} ${unidade}(s) para ${destinatario} salvo!`, 'success');
        DOM_ELEMENTS.formCestaLancamento.reset();
        DOM_ELEMENTS.cestaData.value = getTodayDateString();

    } catch (error) {
        console.error("Erro ao salvar lançamento de cesta:", error);
        showAlert('alert-cesta-lancamento', `Erro ao salvar: ${error.message}`, 'error');
    } finally {
        DOM_ELEMENTS.btnSubmitCestaLancamento.disabled = false;
        DOM_ELEMENTS.btnSubmitCestaLancamento.innerHTML = '<i data-lucide="save"></i> <span>Salvar Lançamento (Saída do Estoque)</span>';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}


// =========================================================================
// LÓGICA DE ENXOVAL (Lancamento e Estoque)
// =========================================================================

/**
 * Renderiza o resumo de estoque de enxovais.
 */
export function renderEnxovalEstoqueSummary() {
    const estoqueEntries = getEnxovalEstoque();
    const movimentacoes = getEnxovalMovimentacoes();
    const estoqueAtual = calculateCurrentStock(estoqueEntries, movimentacoes);
    const totalEntradas = estoqueEntries.reduce((sum, e) => sum + (e.quantidade || 0), 0);
    const totalSaidas = movimentacoes.filter(m => m.tipo === 'saida').reduce((sum, m) => sum + (m.quantidade || 0), 0);

    const resumoEl = DOM_ELEMENTS.enxovalEstoqueResumo;
    if (resumoEl) {
        resumoEl.innerHTML = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-start">
                <span class="text-sm text-gray-700">Total em Estoque:</span>
                <strong class="text-3xl font-extrabold text-pink-600 block">${estoqueAtual}</strong>
                <span class="text-xs text-gray-500 mt-1">unidades de enxoval disponíveis</span>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-start">
                <span class="text-sm text-gray-700">Total Entradas:</span>
                <strong class="text-3xl font-extrabold text-green-600 block">+${totalEntradas}</strong>
                <span class="text-xs text-gray-500 mt-1">registradas</span>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex flex-col items-start">
                <span class="text-sm text-gray-700">Total Saídas:</span>
                <strong class="text-3xl font-extrabold text-red-600 block">-${totalSaidas}</strong>
                <span class="text-xs text-gray-500 mt-1">registradas</span>
            </div>
        `;
    }
    renderEnxovalEstoqueHistoryTable();
}

/**
 * Renderiza a tabela de histórico de entradas de estoque (Enxoval).
 */
export function renderEnxovalEstoqueHistoryTable() {
    const estoque = getEnxovalEstoque();
    const tableBody = DOM_ELEMENTS.tableEnxovalEstoqueHistory;
    if (!tableBody) return;

    const historicoOrdenado = [...estoque]
        .filter(e => e.tipo === 'entrada')
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" class="text-center py-4 text-slate-500">Nenhuma entrada de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    const isAdmin = getUserRole() === 'admin';

    historicoOrdenado.forEach(e => {
        const dataMov = formatTimestamp(e.data);
        const dataLancamento = formatTimestamp(e.registradoEm);
        const notaFiscal = e.notaFiscal || 'N/A';
        const responsavel = e.responsavel || 'N/A';

        const details = `Entrada de Estoque Enxoval: ${e.quantidade} un., NF: ${notaFiscal}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${e.id}" data-type="estoque-enxoval" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="Lançado em: ${dataLancamento}">
            <td class="text-center font-medium">${e.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${notaFiscal}</td>
            <td>${responsavel}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    tableBody.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Renderiza a tabela de histórico de saídas (Enxoval).
 */
export function renderEnxovalMovimentacoesHistoryTable() {
    const movimentacoes = getEnxovalMovimentacoes();
    const tableBody = DOM_ELEMENTS.tableEnxovalHistorico; 
    if (!tableBody) return;

    const historicoOrdenado = [...movimentacoes]
        .filter(m => m.tipo === 'saida') 
        .sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-500">Nenhuma saída de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    const isAdmin = getUserRole() === 'admin';

    historicoOrdenado.forEach(m => {
        const dataMov = formatTimestamp(m.data);
        const statusClass = m.status === 'Entregue' ? 'badge-green' : 'badge-gray';

        const details = `Saída Enxoval: ${m.quantidade} un. p/ ${m.destinatario}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="mov-enxoval" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${m.destinatario}</td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td>${m.categoria}</td>
            <td>${m.memo}</td>
            <td>${m.responsavel}</td>
            <td><span class="badge ${statusClass}">${m.status}</span></td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    tableBody.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Lida com a submissão do formulário de lançamento (SAÍDA) de Enxoval.
 */
export async function handleEnxovalLancamentoSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-enxoval-lancamento', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole();
    if (role === 'anon') { 
        showAlert('alert-enxoval-lancamento', "Permissão negada. Usuário Anônimo não pode lançar dados.", 'error'); return; 
    }

    const data = dateToTimestamp(DOM_ELEMENTS.enxovalData.value);
    const destinatario = capitalizeString(DOM_ELEMENTS.enxovalDestinatario.value.trim());
    const quantidade = parseInt(DOM_ELEMENTS.enxovalQuantidade.value, 10);
    const categoria = DOM_ELEMENTS.enxovalCategoria.value;
    const observacoes = DOM_ELEMENTS.enxovalObservacoes.value.trim();
    const memo = DOM_ELEMENTS.enxovalMemo.value.trim();
    const responsavel = capitalizeString(DOM_ELEMENTS.enxovalResponsavel.value.trim());

    if (!data || !destinatario || !quantidade || quantidade <= 0 || !categoria || !responsavel || !memo) {
        showAlert('alert-enxoval-lancamento', 'Preencha todos os campos obrigatórios.', 'warning');
        return;
    }

    // *** CHECAGEM DE ESTOQUE (NOVO) ***
    const estoqueAtual = calculateCurrentStock(getEnxovalEstoque(), getEnxovalMovimentacoes());
    if (quantidade > estoqueAtual) { 
        showAlert('alert-enxoval-lancamento', `Estoque insuficiente! Disponível: ${estoqueAtual} enxoval(is).`, 'error'); 
        return; 
    }
    // **********************************

    DOM_ELEMENTS.btnSubmitEnxovalLancamento.disabled = true;
    DOM_ELEMENTS.btnSubmitEnxovalLancamento.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        await addDoc(COLLECTIONS.enxovalMov, {
            data,
            tipo: 'saida', // Saída do estoque
            destinatario,
            quantidade,
            categoria,
            observacoes,
            memo,
            responsavel,
            status: 'Entregue', 
            registradoEm: serverTimestamp()
        });

        showAlert('alert-enxoval-lancamento', `Lançamento de ${quantidade} Enxoval(is) para ${destinatario} salvo!`, 'success');
        DOM_ELEMENTS.formEnxovalLancamento.reset();
        DOM_ELEMENTS.enxovalData.value = getTodayDateString();

    } catch (error) {
        console.error("Erro ao salvar lançamento de enxoval:", error);
        showAlert('alert-enxoval-lancamento', `Erro ao salvar: ${error.message}`, 'error');
    } finally {
        DOM_ELEMENTS.btnSubmitEnxovalLancamento.disabled = false;
        DOM_ELEMENTS.btnSubmitEnxovalLancamento.innerHTML = '<i data-lucide="save"></i> <span>Salvar Lançamento (Saída do Estoque)</span>';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}


// =========================================================================
// LÓGICA DE IMPORTAÇÃO (CORRIGIDA)
// =========================================================================

/**
 * Lida com a importação de dados por colagem de planilha.
 */
export async function handleSocialImportSubmit() {
    if (!isReady()) { showAlert('alert-social-import', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole();
    if (role !== 'admin' && role !== 'editor') { 
        showAlert('alert-social-import', "Permissão negada. Apenas Administradores/Editores podem importar dados.", 'error'); return; 
    }

    const text = DOM_ELEMENTS.textareaSocialImport.value.trim();
    if (!text) {
        showAlert('alert-social-import', 'Cole os dados da planilha na caixa de texto.', 'warning');
        return;
    }

    const lines = text.split('\n').filter(line => line.trim().length > 0);
    if (lines.length === 0) {
        showAlert('alert-social-import', 'Nenhuma linha de dados válida encontrada.', 'warning');
        return;
    }

    DOM_ELEMENTS.btnSocialImportData.disabled = true;
    DOM_ELEMENTS.btnSocialImportData.innerHTML = '<div class="loading-spinner-small mx-auto"></div><span class="ml-2">Analisando...</span>';

    // Pega a primeira linha para determinar o formato (separador TAB)
    const firstLineParts = lines[0].split('\t');
    const numCols = firstLineParts.length;
    let collectionRef = null;
    let itemType = '';
    
    // CORREÇÃO: Usar 9 colunas (Data | Destinatário | Qtd. | Unidade | Categoria | Observações | Custo | Status | Responsável)
    // O status e o custo são flexíveis/adaptados.
    if (numCols >= 8) { // Mínimo 8 colunas para Cesta, 9 é o esperado.
        collectionRef = COLLECTIONS.cestaMov;
        itemType = 'Cesta Básica';
    } else if (numCols >= 7) { // Mínimo 7 colunas para Enxoval
        collectionRef = COLLECTIONS.enxovalMov;
        itemType = 'Enxoval';
    } else {
        showAlert('alert-social-import', `Formato de colunas inválido (${numCols} colunas). Esperado 8/9 (Cesta) ou 7 (Enxoval).`, 'error');
        DOM_ELEMENTS.btnSocialImportData.disabled = false;
        DOM_ELEMENTS.btnSocialImportData.innerHTML = '<i data-lucide="upload"></i> 📤 Importar Dados';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        return;
    }

    const batch = writeBatch(db);
    let successfullyParsedCount = 0;
    const errors = [];
    const timestamp = serverTimestamp();

    // Função auxiliar para sanitizar valores numéricos
    const sanitizeNumber = (str) => {
        if (!str) return 0;
        // Remove R$, espaços, e substitui vírgula por ponto (para decimal)
        const cleaned = str.replace(/[^\d,\.]/g, '').replace(',', '.');
        return parseFloat(cleaned) || 0;
    };
    
    // Função auxiliar para converter data no formato DD/MM/YYYY ou YYYY-MM-DD
    const parseDateToTimestamp = (dateStr) => {
        if (!dateStr) return null;
        // Converte DD/MM/YYYY para YYYY-MM-DD
        if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                 // Trata o ano, se for só 2 dígitos (ex: 27/08/25 -> 27/08/2025)
                const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                return dateToTimestamp(`${year}-${parts[1]}-${parts[0]}`);
            }
        }
        // Tenta usar o formato YYYY-MM-DD ou o nativo
        return dateToTimestamp(dateStr);
    };


    // Processa cada linha
    lines.forEach((line, index) => {
        // Usa regex para garantir que TABs sejam o único separador, removendo espaços indesejados
        const parts = line.split('\t').map(p => p.trim());
        
        // CORREÇÃO: O primeiro campo é a data, precisa ser parseada corretamente
        const rawDate = parts[0];
        const data = parseDateToTimestamp(rawDate);
        
        if (!data) {
            errors.push(`Linha ${index + 1}: Data inválida ('${rawDate}').`);
            return;
        }

        try {
            if (itemType === 'Cesta Básica') {
                // Formato esperado (9 colunas):
                // 0: Data | 1: Destinatário | 2: Qtd. | 3: Unidade | 4: Categoria | 5: Observações/Memo | 6: Custo/NF | 7: Status | 8: Responsável
                // O exemplo do usuário mostra 9 colunas, mas a ordem é diferente ou há dados extras/faltantes.
                // Usaremos a ordem mais comum e adaptamos o custo/status:

                const destinatario = capitalizeString(parts[1] || '');
                const quantidade = parseInt(parts[2], 10);
                const unidade = parts[3] || 'cesta';
                const categoria = parts[4] || 'alimentacao';
                const observacoes = parts[5] || 'Importação em lote';
                
                // Custo pode estar na coluna 6 ou 7. O exemplo do usuário tem 'R$ 113,31' na 7a (índice 6)
                const custo = sanitizeNumber(parts[6] || parts[7]);
                
                // Status pode estar na coluna 7 ou 8. O exemplo do usuário tem 'Entregue' na 8a (índice 7)
                const status = parts[7] || 'Entregue';
                
                // Responsável na coluna 8 ou 9
                const responsavel = capitalizeString(parts[8] || parts[9] || 'Importação');
                
                // Fornecedor é ignorado na importação de SAÍDA

                if (!destinatario) throw new Error("Destinatário ausente.");
                if (isNaN(quantidade) || quantidade <= 0) throw new Error("Quantidade inválida.");

                batch.set(doc(collectionRef), {
                    data, tipo: 'saida', destinatario, quantidade, unidade, categoria,
                    observacoes: observacoes, custo, responsavel, fornecedor: 'N/A', // Fornecedor fica N/A
                    status: status, registradoEm: timestamp
                });
            } else if (itemType === 'Enxoval') {
                 // Formato esperado (7 Colunas):
                 // 0: Data | 1: Qtd. | 2: Destinatário | 3: Observações | 4: Memo | 5: Categoria | 6: Responsável
                
                const quantidade = parseInt(parts[1], 10);
                const destinatario = capitalizeString(parts[2] || '');
                const observacoes = parts[3] || 'Importação em lote';
                const memo = parts[4] || 'N/A';
                const categoria = parts[5] || 'maternidade';
                const responsavel = capitalizeString(parts[6] || 'Importação');

                if (!destinatario) throw new Error("Destinatário ausente.");
                if (isNaN(quantidade) || quantidade <= 0) throw new Error("Quantidade inválida.");

                batch.set(doc(collectionRef), {
                    data, tipo: 'saida', destinatario, quantidade, categoria, observacoes,
                    memo, responsavel, status: 'Entregue', registradoEm: timestamp
                });
            }
            successfullyParsedCount++;

        } catch (error) {
            errors.push(`Linha ${index + 1}: Erro de conversão/validação - ${error.message}`);
        }
    });

    try {
        if (successfullyParsedCount > 0) {
            await batch.commit();
            showAlert('alert-social-import', `${successfullyParsedCount} registros de ${itemType} importados com sucesso!`, 'success');
            DOM_ELEMENTS.textareaSocialImport.value = '';
        } else {
            showAlert('alert-social-import', 'Nenhum registro importado. Verifique os erros no console.', 'warning');
        }

        if (errors.length > 0) {
            console.error(`Erros de importação em ${errors.length} linhas:`, errors);
            showAlert('alert-social-import', `Importação parcial: ${successfullyParsedCount} salvos. ${errors.length} erros. Verifique o console.`, 'warning', 10000);
        }

    } catch (error) {
        console.error("Erro ao fazer o commit do lote:", error);
        showAlert('alert-social-import', `Erro ao salvar no banco de dados: ${error.message}`, 'error');
    } finally {
        DOM_ELEMENTS.btnSocialImportData.disabled = false;
        DOM_ELEMENTS.btnSocialImportData.innerHTML = '<i data-lucide="upload"></i> 📤 Importar Dados';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}


// =========================================================================
// INICIALIZAÇÃO E ORQUESTRAÇÃO
// =========================================================================

export function initSocialListeners() {
    // Listener principal para trocar entre Cesta Básica, Enxoval e Importação
    DOM_ELEMENTS.subNavSocialMain?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-subview-main]');
        if (btn && btn.dataset.subviewMain) {
            switchMainSubModule(btn.dataset.subviewMain);
        }
    });

    // Listeners para sub-abas de Cesta Básica
    DOM_ELEMENTS.subNavCesta?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-subview]');
        if (btn) switchInternalSubView('cesta', btn.dataset.subview.replace('cesta-', ''));
    });
    DOM_ELEMENTS.formCestaLancamento?.addEventListener('submit', handleCestaLancamentoSubmit);
    DOM_ELEMENTS.formCestaEntrada?.addEventListener('submit', handleCestaEstoqueEntrySubmit); // NOVO


    // Listeners para sub-abas de Enxoval
    DOM_ELEMENTS.subNavEnxoval?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-subview]');
        if (btn) switchInternalSubView('enxoval', btn.dataset.subview.replace('enxoval-', ''));
    });
    DOM_ELEMENTS.formEnxovalLancamento?.addEventListener('submit', handleEnxovalLancamentoSubmit);
    DOM_ELEMENTS.formEnxovalEntrada?.addEventListener('submit', handleEnxovalEstoqueEntrySubmit); // NOVO
    
    // Listener de Importação
    DOM_ELEMENTS.btnSocialImportData?.addEventListener('click', handleSocialImportSubmit);

    console.log("[Social Control] Listeners inicializados.");
}

/**
 * Função de orquestração para a tab de Assistência Social.
 */
export function onSocialTabChange() {
    // Garante que a data está preenchida
    if (DOM_ELEMENTS.cestaData) DOM_ELEMENTS.cestaData.value = getTodayDateString();
    if (DOM_ELEMENTS.enxovalData) DOM_ELEMENTS.enxovalData.value = getTodayDateString();
    if (DOM_ELEMENTS.cestaEntradaData) DOM_ELEMENTS.cestaEntradaData.value = getTodayDateString();
    if (DOM_ELEMENTS.enxovalEntradaData) DOM_ELEMENTS.enxovalEntradaData.value = getTodayDateString();

    // Inicia na view Cesta Básica -> Lançamento
    switchMainSubModule('cesta-basica');
    switchInternalSubView('cesta', 'lancamento');
    
    // Força a renderização inicial dos resumos/históricos
    renderCestaEstoqueSummary(); 
    renderEnxovalEstoqueSummary(); 
    renderCestaMovimentacoesHistoryTable(); 
    renderEnxovalMovimentacoesHistoryTable(); 
}
