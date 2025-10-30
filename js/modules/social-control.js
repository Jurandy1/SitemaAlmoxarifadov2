// js/modules/social-control.js
import { Timestamp, addDoc, updateDoc, serverTimestamp, getDocs, query, where, writeBatch, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
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

// Variáveis para as instâncias dos gráficos
let graficoCestaRelatorio = null;
let graficoEnxovalRelatorio = null;

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

/**
 * Obtém as datas inicial e final do período analisado.
 * @param {Array<Object>} movimentacoes Movimentações de saída.
 * @returns {Object} { dataInicial, dataFinal, totalDias }.
 */
function getPeriodoAnalise(movimentacoes) {
    if (movimentacoes.length === 0) return { dataInicial: null, dataFinal: null, totalDias: 0 };

    // Pega a data da movimentação mais antiga (primeira)
    const movsOrdenadas = [...movimentacoes].sort((a, b) => (a.data?.toMillis() || 0) - (b.data?.toMillis() || 0));
    
    const primeiraMovDate = movsOrdenadas[0].data.toDate();
    const ultimaMovDate = movsOrdenadas[movsOrdenadas.length - 1].data.toDate();

    // Cria Timestamps para exibição
    const dataInicial = Timestamp.fromDate(primeiraMovDate);
    const dataFinal = Timestamp.fromDate(ultimaMovDate);

    // Normaliza para o início do dia para cálculo preciso dos dias decorridos
    const inicioPrimeira = new Date(primeiraMovDate.getFullYear(), primeiraMovDate.getMonth(), primeiraMovDate.getDate());
    const fimUltima = new Date(ultimaMovDate.getFullYear(), ultimaMovDate.getMonth(), ultimaMovDate.getDate());

    // Cálculo dos dias: (diferença em ms / ms por dia) + 1 para incluir o dia final
    const diffTime = Math.abs(fimUltima.getTime() - inicioPrimeira.getTime());
    const totalDaysMs = 1000 * 60 * 60 * 24;
    // +1 para incluir o dia final. Se for no mesmo dia, (0 / X) + 1 = 1 dia.
    const totalDias = Math.ceil(diffTime / totalDaysMs) + 1; 

    return { dataInicial, dataFinal, totalDias };
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
    // CORREÇÃO: Força a renderização do histórico de saídas sempre que a aba Relatório é acessada
    if (subViewName === 'relatorio') {
        if (itemType === 'cesta') renderCestaMovimentacoesHistoryTable();
        if (itemType === 'enxoval') renderEnxovalMovimentacoesHistoryTable();
        // Esconde o relatório detalhado ao entrar na aba
        document.getElementById(`${itemType}-relatorio-output`)?.classList.add('hidden');
        // Preenche as datas do filtro de relatório com os últimos 30 dias
        const dataFimEl = document.getElementById(`${itemType}-rel-data-fim`);
        const dataInicioEl = document.getElementById(`${itemType}-rel-data-inicio`);
        if (dataFimEl) dataFimEl.value = getTodayDateString();
        if (dataInicioEl) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            dataInicioEl.value = thirtyDaysAgo.toISOString().split('T')[0];
        }
    }
    
    // NOVO: Renderiza os selects do formulário ao entrar na aba de lançamento
    if (subViewName === 'lancamento') {
        if (itemType === 'cesta') renderCestaLancamentoControls();
        if (itemType === 'enxoval') renderEnxovalLancamentoControls();
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
            custo: document.getElementById('cesta-entrada-custo-unitario'), 
            fornecedor: document.getElementById('cesta-entrada-fornecedor'),
            btn: DOM_ELEMENTS.btnSubmitCestaEntrada,
            alert: 'alert-cesta-estoque',
            collection: COLLECTIONS.cestaEstoque,
            itemLabel: 'Cesta(s) Básica(s)'
        },
        'enxoval': {
            form: DOM_ELEMENTS.formEnxovalEntrada,
            qtd: DOM_ELEMENTS.enxovalEntradaQuantidade,
            data: DOM_ELEMENTS.enxovalEntradaData,
            resp: DOM_ELEMENTS.enxovalEntradaResponsavel,
            nf: DOM_ELEMENTS.enxovalEntradaNf,
            custo: null, fornecedor: null, // Ignorados para enxoval
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
    
    // NOVO: Custo Unitário e Fornecedor (Apenas para Cesta)
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
 * Gera o HTML para o select de unidades, usado tanto no formulário quanto na edição.
 * @param {string} [selectedValue] - O valor (string formatada "TIPO: NOME" ou nome personalizado) que deve ser pré-selecionado.
 * @returns {string} HTML com as options.
 */
function getUnidadeOptionsHtml(selectedValue = '') {
    const unidades = getUnidades();
    let unidadeHtml = '';
    let foundInList = false;

    // 1. Agrupar unidades por tipo
    const grupos = unidades.reduce((acc, unidade) => {
        let tipo = (unidade.tipo || "Sem Tipo").toUpperCase();
        if (tipo === "SEMCAS") tipo = "SEDE";
        if (!acc[tipo]) acc[tipo] = [];
        acc[tipo].push(unidade);
        return acc;
    }, {});

    // 2. Gerar HTML dos <optgroup>
    Object.keys(grupos).sort().forEach(tipo => {
        unidadeHtml += `<optgroup label="Tipo: ${tipo}">`;
        grupos[tipo]
            .sort((a, b) => a.nome.localeCompare(b.nome))
            .forEach(unidade => {
                // O valor salvo no DB é "TIPO: NOME" (Ex: "CRAS: CRAS CENTRO")
                const optionValue = `${tipo.toUpperCase()}: ${unidade.nome}`;
                const isSelected = optionValue === selectedValue;
                if (isSelected) foundInList = true;
                
                unidadeHtml += `<option value="${optionValue}" ${isSelected ? 'selected' : ''}>${unidade.nome}</option>`;
            });
        unidadeHtml += `</optgroup>`;
    });

    // 3. Adicionar o valor atual (Personalizado/Importado) se não estiver na lista
    // Isso garante que nomes personalizados ou importados possam ser "corrigidos" para uma unidade padrão
    if (!foundInList && selectedValue) {
        unidadeHtml = `<option value="${selectedValue}" selected>Personalizado: ${selectedValue}</option>` + unidadeHtml;
    } else if (!selectedValue) {
        unidadeHtml = `<option value="">-- Selecione a Unidade --</option>` + unidadeHtml;
    }

    return unidadeHtml;
}


/**
 * Popula os controles de destinatário/unidade no formulário de lançamento de Cesta.
 */
function renderCestaLancamentoControls() {
    const selectUnidadeEl = document.getElementById('cesta-select-unidade');
    const inputPersonalizadoEl = document.getElementById('cesta-destinatario-personalizado');
    const selectTipoDestinatarioEl = document.getElementById('cesta-tipo-destinatario');

    if (!selectUnidadeEl || !inputPersonalizadoEl || !selectTipoDestinatarioEl) return;

    // Popula o seletor de unidades
    selectUnidadeEl.innerHTML = getUnidadeOptionsHtml();

    // Adiciona listener para alternar visibilidade
    selectTipoDestinatarioEl.onchange = () => {
        const tipo = selectTipoDestinatarioEl.value;
        const isPersonalizado = tipo === 'personalizado';
        
        // Oculta/Exibe os campos corretos
        selectUnidadeEl.parentElement.classList.toggle('hidden', isPersonalizado);
        selectUnidadeEl.required = !isPersonalizado;
        
        inputPersonalizadoEl.parentElement.classList.toggle('hidden', !isPersonalizado);
        inputPersonalizadoEl.disabled = !isPersonalizado; // Usa 'disabled' em vez de 'required' para evitar problemas de validação
        
        // Limpa os valores para evitar submissão de campos ocultos
        if (isPersonalizado) {
             selectUnidadeEl.value = "";
        } else {
             inputPersonalizadoEl.value = "";
        }
    };
    
    // Garante que o estado inicial esteja correto
    selectTipoDestinatarioEl.dispatchEvent(new Event('change'));
}

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
        // CORREÇÃO 2: Custo Unitário
        const custoUnitario = (e.custoUnitario || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); 

        const details = `Entrada de Estoque Cesta: ${e.quantidade} un., Custo: ${custoUnitario}, NF: ${notaFiscal}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${e.id}" data-type="estoque-cesta" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="Lançado em: ${dataLancamento} | Fornecedor: ${e.fornecedor || 'N/A'}">
            <td class="text-center font-medium">${e.quantidade}</td>
            <!-- CORREÇÃO 2: Exibir Custo Unitário -->
            <td class="whitespace-nowrap">${custoUnitario}</td>
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
 * CORREÇÃO 1: Adicionado Observações e padronizado cabeçalhos.
 * IMPLEMENTAÇÃO: Adicionado botão de editar destinatário.
 */
export function renderCestaMovimentacoesHistoryTable() {
    const movimentacoes = getCestaMovimentacoes();
    const tableBody = DOM_ELEMENTS.tableCestaHistorico; 
    if (!tableBody) return;

    const historicoOrdenado = [...movimentacoes]
        .filter(m => m.tipo === 'saida') 
        .sort((a, b) => (b.data?.toMillis() || 0) - (a.data?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-500">Nenhuma saída de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const canEdit = isAdmin || role === 'editor'; // Admin e Editor podem editar

    historicoOrdenado.forEach(m => {
        const dataMov = formatTimestamp(m.data);
        const statusClass = m.status === 'Entregue' ? 'badge-green' : 'badge-gray';

        const details = `Saída Cesta: ${m.quantidade} un. p/ ${m.destinatario}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="mov-cesta" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        // NOVO: Botão de Edição
        const editButtonHtml = canEdit
            ? `<button class="btn-icon btn-edit-destinatario ml-1" title="Editar Destinatário"><i data-lucide="pencil"></i></button>`
            : '';

        // NOVO: Célula de Destinatário Editável
        // Usamos encodeURIComponent para garantir que o valor no data-attribute seja seguro
        const destinatarioHtml = `
            <td id="destinatario-cell-${m.id}" data-item-type="cesta" data-doc-id="${m.id}" data-current-value="${encodeURIComponent(m.destinatario)}">
                <span class="destinatario-nome">${m.destinatario}</span>
                ${editButtonHtml}
            </td>
        `;

        // CORREÇÃO 1: Padronização das colunas
        html += `<tr>
            <td class="whitespace-nowrap">${dataMov}</td>
            ${destinatarioHtml}
            <td class="text-center font-medium">${m.quantidade}</td>
            <td>${capitalizeString(m.categoria)}</td>
            <td class="text-xs text-gray-600">${m.observacoes || 'N/A'}</td>
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
    
    // NOVO: Lógica para selecionar Destinatário baseado no tipo
    const tipoDestinatarioEl = document.getElementById('cesta-tipo-destinatario');
    const selectUnidadeEl = document.getElementById('cesta-select-unidade');
    const inputPersonalizadoEl = document.getElementById('cesta-destinatario-personalizado');
    
    let destinatario = '';
    const tipoDestinatario = tipoDestinatarioEl.value;

    if (tipoDestinatario === 'unidade') {
        destinatario = capitalizeString(selectUnidadeEl.value.trim()); // Ex: Cras: Cras Centro
    } else if (tipoDestinatario === 'personalizado') {
        destinatario = capitalizeString(inputPersonalizadoEl.value.trim()); // Ex: João da Silva
    } else {
        showAlert('alert-cesta-lancamento', 'Selecione o Tipo de Destinatário (Unidade ou Personalizado).', 'warning');
        return;
    }
    
    if (!destinatario) {
        showAlert('alert-cesta-lancamento', 'O nome do Destinatário não pode ser vazio.', 'warning');
        return;
    }
    // FIM NOVO

    const quantidade = parseInt(DOM_ELEMENTS.cestaQuantidade.value, 10);
    const unidade = DOM_ELEMENTS.cestaUnidade.value;
    // CORREÇÃO 3: Valor da categoria agora inclui Perecível/Não Perecível
    const categoria = DOM_ELEMENTS.cestaCategoria.value; 
    const observacoes = DOM_ELEMENTS.cestaObservacoes.value.trim();
    // Custo e fornecedor fixados em 0 e N/A para saída
    const custo = 0; 
    const fornecedor = 'N/A'; 
    const responsavel = capitalizeString(DOM_ELEMENTS.cestaResponsavel.value.trim());

    if (!data || !quantidade || quantidade <= 0 || !categoria || !responsavel) {
        showAlert('alert-cesta-lancamento', 'Preencha todos os campos obrigatórios (Data, Qtd, Categoria, Responsável).', 'warning');
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
        // Garante que os selects de destinatário voltem para o estado inicial
        if (tipoDestinatarioEl) tipoDestinatarioEl.value = 'unidade';
        if (selectUnidadeEl) selectUnidadeEl.value = '';
        if (inputPersonalizadoEl) inputPersonalizadoEl.value = '';
        renderCestaLancamentoControls(); // Re-renderiza para aplicar a visibilidade correta

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
 * Popula os controles de destinatário/unidade no formulário de lançamento de Enxoval.
 */
function renderEnxovalLancamentoControls() {
    const selectUnidadeEl = document.getElementById('enxoval-select-unidade');
    const inputPersonalizadoEl = document.getElementById('enxoval-destinatario-personalizado');
    const selectTipoDestinatarioEl = document.getElementById('enxoval-tipo-destinatario');

    if (!selectUnidadeEl || !inputPersonalizadoEl || !selectTipoDestinatarioEl) return;

    // Popula o seletor de unidades
    selectUnidadeEl.innerHTML = getUnidadeOptionsHtml();

    // Adiciona listener para alternar visibilidade
    selectTipoDestinatarioEl.onchange = () => {
        const tipo = selectTipoDestinatarioEl.value;
        const isPersonalizado = tipo === 'personalizado';
        
        selectUnidadeEl.parentElement.classList.toggle('hidden', isPersonalizado);
        selectUnidadeEl.required = !isPersonalizado;
        
        inputPersonalizadoEl.parentElement.classList.toggle('hidden', !isPersonalizado);
        inputPersonalizadoEl.disabled = !isPersonalizado; // Usa 'disabled'
        
        // Limpa os valores para evitar submissão de campos ocultos
        if (isPersonalizado) {
             selectUnidadeEl.value = "";
        } else {
             inputPersonalizadoEl.value = "";
        }
    };
    
    // Garante que o estado inicial esteja correto
    selectTipoDestinatarioEl.dispatchEvent(new Event('change'));
}

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
 * CORREÇÃO 1: Adicionado Observações e padronizado cabeçalhos (incluindo Memo).
 * IMPLEMENTAÇÃO: Adicionado botão de editar destinatário.
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
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const canEdit = isAdmin || role === 'editor'; // Admin e Editor podem editar

    historicoOrdenado.forEach(m => {
        const dataMov = formatTimestamp(m.data);
        const statusClass = m.status === 'Entregue' ? 'badge-green' : 'badge-gray';

        const details = `Saída Enxoval: ${m.quantidade} un. p/ ${m.destinatario}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="mov-enxoval" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;
        
        // NOVO: Botão de Edição
        const editButtonHtml = canEdit
            ? `<button class="btn-icon btn-edit-destinatario ml-1" title="Editar Destinatário"><i data-lucide="pencil"></i></button>`
            : '';

        // NOVO: Célula de Destinatário Editável
        const destinatarioHtml = `
            <td id="destinatario-cell-${m.id}" data-item-type="enxoval" data-doc-id="${m.id}" data-current-value="${encodeURIComponent(m.destinatario)}">
                <span class="destinatario-nome">${m.destinatario}</span>
                ${editButtonHtml}
            </td>
        `;

        // CORREÇÃO 1: Inclusão da Observação/Memo
        html += `<tr>
            <td class="whitespace-nowrap">${dataMov}</td>
            ${destinatarioHtml}
            <td class="text-center font-medium">${m.quantidade}</td>
            <td>${capitalizeString(m.categoria)}</td>
            <td class="text-xs text-gray-600">${m.memo || 'N/A'}</td>
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
    
    // NOVO: Lógica para selecionar Destinatário baseado no tipo
    const tipoDestinatarioEl = document.getElementById('enxoval-tipo-destinatario');
    const selectUnidadeEl = document.getElementById('enxoval-select-unidade');
    const inputPersonalizadoEl = document.getElementById('enxoval-destinatario-personalizado');
    
    let destinatario = '';
    const tipoDestinatario = tipoDestinatarioEl.value;

    if (tipoDestinatario === 'unidade') {
        destinatario = capitalizeString(selectUnidadeEl.value.trim()); // Ex: Cras: Cras Centro
    } else if (tipoDestinatario === 'personalizado') {
        destinatario = capitalizeString(inputPersonalizadoEl.value.trim()); // Ex: João da Silva
    } else {
        showAlert('alert-enxoval-lancamento', 'Selecione o Tipo de Destinatário (Unidade ou Personalizado).', 'warning');
        return;
    }
    
    if (!destinatario) {
        showAlert('alert-enxoval-lancamento', 'O nome do Destinatário não pode ser vazio.', 'warning');
        return;
    }
    // FIM NOVO
    
    const quantidade = parseInt(DOM_ELEMENTS.enxovalQuantidade.value, 10);
    const categoria = DOM_ELEMENTS.enxovalCategoria.value;
    const observacoes = DOM_ELEMENTS.enxovalObservacoes.value.trim();
    const memo = DOM_ELEMENTS.enxovalMemo.value.trim();
    const responsavel = capitalizeString(DOM_ELEMENTS.enxovalResponsavel.value.trim());

    if (!data || !quantidade || quantidade <= 0 || !categoria || !responsavel || !memo) {
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
        // Garante que os selects de destinatário voltem para o estado inicial
        if (tipoDestinatarioEl) tipoDestinatarioEl.value = 'unidade';
        if (selectUnidadeEl) selectUnidadeEl.value = '';
        if (inputPersonalizadoEl) inputPersonalizadoEl.value = '';
        renderEnxovalLancamentoControls(); // Re-renderiza para aplicar a visibilidade correta

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
// NOVO: LÓGICA DE EDIÇÃO DO DESTINATÁRIO NO HISTÓRICO
// =========================================================================

/**
 * Coloca a célula do destinatário em modo de edição.
 * @param {Event} e Evento de clique.
 */
function enterEditModeDestinatario(e) {
    const button = e.target.closest('.btn-edit-destinatario');
    if (!button) return;

    const td = button.closest('td');
    const docId = td.dataset.docId;
    const currentValue = decodeURIComponent(td.dataset.currentValue); // Decodifica o valor

    // Trava para não editar duas vezes
    if (td.classList.contains('editing')) return;
    td.classList.add('editing');

    // Gera o HTML do select com as unidades
    const selectOptionsHtml = getUnidadeOptionsHtml(currentValue);

    td.innerHTML = `
        <select id="edit-destinatario-select-${docId}" class="form-select form-select-sm" style="min-width: 200px;">
            ${selectOptionsHtml}
        </select>
        <div class="mt-1 space-x-1 flex">
            <button class="btn-icon btn-save-destinatario text-green-600" title="Salvar"><i data-lucide="save"></i></button>
            <button class="btn-icon btn-cancel-destinatario text-red-600" title="Cancelar"><i data-lucide="x-circle"></i></button>
        </div>
    `;

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

/**
 * Cancela a edição do destinatário e restaura o valor original.
 * @param {Event} e Evento de clique.
 */
function cancelDestinatarioEdit(e) {
    const button = e.target.closest('.btn-cancel-destinatario');
    if (!button) return;

    const td = button.closest('td');
    const currentValue = decodeURIComponent(td.dataset.currentValue); // Pega o valor original
    td.classList.remove('editing');

    // Restaura o HTML original
    const role = getUserRole();
    const canEdit = role === 'admin' || role === 'editor';
    const editButtonHtml = canEdit
        ? `<button class="btn-icon btn-edit-destinatario ml-1" title="Editar Destinatário"><i data-lucide="pencil"></i></button>`
        : '';

    td.innerHTML = `
        <span class="destinatario-nome">${currentValue}</span>
        ${editButtonHtml}
    `;

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

/**
 * Salva o novo nome do destinatário no Firestore.
 * @param {Event} e Evento de clique.
 */
async function saveDestinatarioEdit(e) {
    const button = e.target.closest('.btn-save-destinatario');
    if (!button) return;

    const td = button.closest('td');
    const docId = td.dataset.docId;
    const itemType = td.dataset.itemType; // 'cesta' ou 'enxoval'
    const select = td.querySelector(`#edit-destinatario-select-${docId}`);
    const newDestinatarioName = select.value;
    const alertId = `alert-${itemType}-relatorio`;

    if (!newDestinatarioName) {
        showAlert(alertId, 'O nome do destinatário não pode ser vazio.', 'warning');
        return;
    }

    button.disabled = true;
    td.querySelector('.btn-cancel-destinatario')?.remove();
    button.innerHTML = '<div class="loading-spinner-small mx-auto" style="width:16px; height:16px;"></div>';

    try {
        const collectionRef = itemType === 'cesta' ? COLLECTIONS.cestaMov : COLLECTIONS.enxovalMov;
        const docRef = doc(collectionRef, docId);
        
        await updateDoc(docRef, { destinatario: newDestinatarioName });

        // Atualiza o data-attribute para o novo valor
        td.dataset.currentValue = encodeURIComponent(newDestinatarioName);
        
        // Restaura a célula para o modo de exibição
        const role = getUserRole();
        const canEdit = role === 'admin' || role === 'editor';
        const editButtonHtml = canEdit
            ? `<button class="btn-icon btn-edit-destinatario ml-1" title="Editar Destinatário"><i data-lucide="pencil"></i></button>`
            : '';

        td.innerHTML = `
            <span class="destinatario-nome">${newDestinatarioName}</span>
            ${editButtonHtml}
        `;
        td.classList.remove('editing');
        
        showAlert(alertId, 'Destinatário atualizado com sucesso!', 'success', 3000);

    } catch (error) {
        console.error("Erro ao salvar destinatário:", error);
        showAlert(alertId, `Erro ao salvar: ${error.message}`, 'error');
        // Restaura o botão em caso de erro (pode chamar a função de cancelar)
        cancelDestinatarioEdit(e); // Reutiliza a lógica de cancelamento para restaurar
    } finally {
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    }
}

// =========================================================================
// NOVO PONTO 2: LÓGICA DE RELATÓRIO E GRÁFICO (MODIFICADA PARA SER MAIS ROBUSTA)
// =========================================================================

/**
 * Renderiza o gráfico de consumo por categoria (Mensal, Anual, etc.)
 * @param {string} itemType 'cesta' ou 'enxoval'.
 * @param {Array<Object>} dataSet Dados do gráfico.
 * @param {string} totalLabel Título do gráfico.
 */
function renderRelatorioChart(itemType, dataSet, totalLabel) {
    const canvasId = `grafico-${itemType}-relatorio`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    // Destrói instância anterior
    const currentChart = itemType === 'cesta' ? graficoCestaRelatorio : graficoEnxovalRelatorio;
    if (currentChart) {
        currentChart.destroy();
    }

    const itemLabel = itemType === 'cesta' ? 'Cestas' : 'Enxovais';

    const newChart = new Chart(ctx, {
        type: 'bar',
        data: dataSet,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { stacked: true },
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: `Quantidade de ${itemLabel}` },
                    ticks: { precision: 0 }
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: totalLabel
                },
                legend: {
                    position: 'bottom',
                }
            }
        }
    });

    if (itemType === 'cesta') {
        graficoCestaRelatorio = newChart;
    } else {
        graficoEnxovalRelatorio = newChart;
    }
}

/**
 * Renderiza o resumo textual robusto para a chefia.
 * **CORRIGIDO:** Substituído ** por <strong> para evitar caracteres bugados no HTML.
 * @param {string} itemType 'cesta' ou 'enxoval'.
 * @param {Array<Object>} movsFiltradas Movimentações de saída filtradas.
 * @param {Map<string, number>} categoriasMap Mapa de categorias e totais.
 * @param {number} totalSaidas Total de saídas no período.
 */
function renderRelatorioTextual(itemType, movsFiltradas, categoriasMap, totalSaidas) {
    const relatorioEl = DOM_ELEMENTS[`${itemType}RelatorioResumoTexto`];
    if (!relatorioEl) return;

    // 1. Cálculos Adicionais
    const { dataInicial, dataFinal, totalDias } = getPeriodoAnalise(movsFiltradas);
    const itemLabel = itemType === 'cesta' ? 'cesta' : 'enxoval';
    const itemLabelPlural = itemType === 'cesta' ? 'cestas básicas' : 'enxovais';

    const categoriasOrdenadas = Array.from(categoriasMap.entries()).sort((a, b) => b[1] - a[1]);
    const categoriaPrincipal = categoriasOrdenadas.length > 0 ? {
        nome: capitalizeString(categoriasOrdenadas[0][0]),
        total: categoriasOrdenadas[0][1],
        percentual: (categoriasOrdenadas[0][1] / totalSaidas) * 100
    } : null;

    // 2. Resumo da Distribuição por Categoria
    let distribuicaoHtml = '<ul>';
    categoriasOrdenadas.forEach(([nome, total]) => {
        const percentual = (total / totalSaidas) * 100;
        distribuicaoHtml += `
            <li class="flex justify-between border-b border-gray-100 py-1">
                <span class="font-medium text-gray-800">${capitalizeString(nome)}:</span>
                <span class="font-bold text-blue-700">${total} un. (${percentual.toFixed(1)}%)</span>
            </li>
        `;
    });
    distribuicaoHtml += '</ul>';
    
    // 3. Resumo da Distribuição Mensal (para indicar recorrência)
    const mesesMap = new Map();
    movsFiltradas.forEach(m => {
        const date = m.data.toDate();
        const mesKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        mesesMap.set(mesKey, (mesesMap.get(mesKey) || 0) + (m.quantidade || 0));
    });
    const totalMeses = mesesMap.size;
    const mediaMensal = totalSaidas / (totalMeses > 0 ? totalMeses : 1);
    
    const mesesOrdenados = Array.from(mesesMap.keys()).sort();
    
    // 4. Montagem do Relatório Textual (Robusto)
    // CORREÇÃO: Removendo asteriscos e usando tags <strong>
    let relatorioText = `
        <p>Este relatório analisa a distribuição de <strong>${itemLabelPlural}</strong> no período de <strong>${formatTimestamp(dataInicial)}</strong> a <strong>${formatTimestamp(dataFinal)}</strong>, cobrindo um total de <strong>${totalDias.toFixed(0)} dias</strong> de operações de saída.</p>
        
        <p class="font-bold pt-3">Indicadores Chave:</p>
        <ul class="list-disc list-inside space-y-1 ml-4">
            <li>O <strong>Total de Saídas</strong> no período foi de <strong>${totalSaidas} unidades</strong> de ${itemLabelPlural}.</li>
            <li>A média de saídas é de <strong>${(totalSaidas / totalDias).toFixed(2)} ${itemLabel}s por dia</strong>.</li>
            ${totalMeses > 1 ? `<li>A média mensal de saídas é de aproximadamente <strong>${mediaMensal.toFixed(1)} unidades</strong> (calculado em ${totalMeses} meses).</li>` : ''}
            ${categoriaPrincipal ? `<li>A <strong>Categoria Principal</strong> de distribuição foi <strong>${categoriaPrincipal.nome}</strong>, representando <strong>${categoriaPrincipal.total} unidades</strong> (${categoriaPrincipal.percentual.toFixed(1)}% do total).</li>` : ''}
        </ul>
        
        <p class="font-bold pt-3">Distribuição Detalhada por Categoria:</p>
        <div class="p-3 bg-white border border-gray-200 rounded-lg">${distribuicaoHtml}</div>
        
        <p class="text-xs text-gray-500 pt-3 italic"><strong>Sugestão:</strong> Focar a próxima compra ou reposição de estoque na categoria <strong>${categoriaPrincipal?.nome || 'N/A'}</strong>, considerando a média de consumo diário/mensal para evitar rupturas de estoque.</p>
    `;

    relatorioEl.innerHTML = relatorioText;
}


/**
 * Lida com a geração do relatório personalizado (Gráfico e Resumo Textual).
 * @param {string} itemType 'cesta' ou 'enxoval'.
 */
async function handleGerarSocialRelatorio(itemType) {
    if (!isReady()) { showAlert(`alert-${itemType}-relatorio`, 'Erro: Não autenticado.', 'error'); return; }

    const relatorioOutputEl = document.getElementById(`${itemType}-relatorio-output`);
    const alertId = `alert-${itemType}-relatorio`;

    // 1. Coletar filtros
    const dataInicioStr = document.getElementById(`${itemType}-rel-data-inicio`)?.value;
    const dataFimStr = document.getElementById(`${itemType}-rel-data-fim`)?.value;
    const categoriaFiltro = document.getElementById(`${itemType}-rel-categoria`)?.value;

    if (!dataInicioStr || !dataFimStr) { showAlert(alertId, 'Selecione a data de início e fim.', 'warning'); return; }

    const dataInicio = dateToTimestamp(dataInicioStr).toMillis();
    // Adiciona 23:59:59.999ms para incluir o dia final
    const dataFim = dateToTimestamp(dataFimStr).toMillis() + (24 * 60 * 60 * 1000 - 1); 

    const movimentacoes = itemType === 'cesta' ? getCestaMovimentacoes() : getEnxovalMovimentacoes();
    
    // 2. Filtrar as movimentações
    let movsFiltradas = movimentacoes.filter(m => { 
        const mData = m.data?.toMillis(); 
        const isSaida = m.tipo === 'saida';
        const dataMatch = mData >= dataInicio && mData <= dataFim;
        const categoriaMatch = categoriaFiltro === 'all' || m.categoria === categoriaFiltro;
        return isSaida && dataMatch && categoriaMatch; 
    });

    if (movsFiltradas.length === 0) { 
        showAlert(alertId, 'Nenhum dado de saída encontrado para os filtros selecionados.', 'info'); 
        relatorioOutputEl.classList.add('hidden');
        return; 
    }
    
    // 3. Processamento de dados
    const totalSaidas = movsFiltradas.reduce((sum, m) => sum + (m.quantidade || 0), 0);
    const categoriasMap = new Map();
    // const mesesMap = new Map(); // Removido para usar apenas no resumo

    movsFiltradas.forEach(m => {
        // Por Categoria (Gráfico)
        const categoria = m.categoria || 'Não Categorizado';
        categoriasMap.set(categoria, (categoriasMap.get(categoria) || 0) + (m.quantidade || 0));
    });

    const categoriasOrdenadas = Array.from(categoriasMap.entries()).sort((a, b) => b[1] - a[1]);
    
    // 4. Preparar dados do gráfico
    const chartLabels = categoriasOrdenadas.map(entry => capitalizeString(entry[0]));
    const chartData = categoriasOrdenadas.map(entry => entry[1]);

    const dataset = {
        labels: chartLabels,
        datasets: [{
            label: itemType === 'cesta' ? 'Qtd. Cestas' : 'Qtd. Enxovais',
            data: chartData, // Adicionando os dados aqui
            backgroundColor: 'rgba(236, 72, 153, 0.7)', // Pink-500
            borderColor: 'rgba(236, 72, 153, 1)',
            borderWidth: 1
        }]
    };
    
    // 5. Renderizar
    // CORREÇÃO 1: Renderiza o resumo textual robusto antes do gráfico
    renderRelatorioTextual(itemType, movsFiltradas, categoriasMap, totalSaidas);
    
    // Geração do Título
    const tituloRelatorio = `Distribuição de Saídas por Categoria (${formatTimestamp(Timestamp.fromMillis(dataInicio))} - ${formatTimestamp(Timestamp.fromMillis(dataFim))})`;
    renderRelatorioChart(itemType, dataset, tituloRelatorio);
    
    relatorioOutputEl.classList.remove('hidden');
    showAlert(alertId, 'Relatório gerado com sucesso!', 'success', 3000);
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
    
    // 9 colunas para Cesta Básica (Saída)
    if (numCols >= 9) { 
        collectionRef = COLLECTIONS.cestaMov;
        itemType = 'Cesta Básica';
    } 
    // 7 colunas para Enxoval (Saída)
    else if (numCols >= 7) { 
        collectionRef = COLLECTIONS.enxovalMov;
        itemType = 'Enxoval';
    } else {
        showAlert('alert-social-import', `Formato de colunas inválido (${numCols} colunas). Esperado 9 (Cesta) ou 7 (Enxoval).`, 'error');
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
        const cleaned = str.replace(/[^\d,\.]/g, '').replace(',', '.');
        return parseFloat(cleaned) || 0;
    };
    
    // Função auxiliar para converter data no formato DD/MM/YYYY ou YYYY-MM-DD
    const parseDateToTimestamp = (dateStr) => {
        if (!dateStr) return null;
        if (dateStr.includes('/')) {
            const parts = dateStr.split('/');
            if (parts.length === 3) {
                const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
                return dateToTimestamp(`${year}-${parts[1]}-${parts[0]}`);
            }
        }
        return dateToTimestamp(dateStr);
    };


    // Processa cada linha
    lines.forEach((line, index) => {
        const parts = line.split('\t').map(p => p.trim());
        
        const rawDate = parts[0];
        const data = parseDateToTimestamp(rawDate);
        
        if (!data) {
            errors.push(`Linha ${index + 1}: Data inválida ('${rawDate}').`);
            return;
        }

        try {
            if (itemType === 'Cesta Básica') {
                // Formato esperado (9 colunas):
                // 0: Data | 1: Destinatário | 2: Qtd. | 3: Unidade | 4: Categoria | 5: Observações | 6: Custo | 7: Responsável | 8: Fornecedor
                // NOTA: Ajustei a interpretação das colunas para bater com o formato mais lógico e o HTML.
                
                const destinatario = capitalizeString(parts[1] || '');
                const quantidade = parseInt(parts[2], 10);
                const unidade = parts[3] || 'cesta';
                const categoria = parts[4] || 'alimentacao';
                const observacoes = parts[5] || 'Importação em lote';
                
                // Custo (índice 6)
                const custo = sanitizeNumber(parts[6]);
                
                // Responsável (índice 7)
                const responsavel = capitalizeString(parts[7] || 'Importação');

                // Fornecedor (índice 8) - Usado aqui como dado extra, mas não obrigatório na saída
                const fornecedor = parts[8] || 'N/A';
                
                const status = 'Entregue'; // Assumindo entregue na importação de saída

                if (!destinatario) throw new Error("Destinatário ausente.");
                if (isNaN(quantidade) || quantidade <= 0) throw new Error("Quantidade inválida.");

                batch.set(doc(collectionRef), {
                    data, tipo: 'saida', destinatario, quantidade, unidade, categoria,
                    observacoes: observacoes, custo, responsavel, fornecedor,
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
                
                const status = 'Entregue'; // Assumindo entregue na importação de saída

                if (!destinatario) throw new Error("Destinatário ausente.");
                if (isNaN(quantidade) || quantidade <= 0) throw new Error("Quantidade inválida.");

                batch.set(doc(collectionRef), {
                    data, tipo: 'saida', destinatario, quantidade, categoria, observacoes,
                    memo, responsavel, status: status, registradoEm: timestamp
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
    DOM_ELEMENTS.formCestaEntrada?.addEventListener('submit', handleCestaEstoqueEntrySubmit); 
    // NOVO: Listener para gerar relatório
    document.getElementById('btn-cesta-gerar-relatorio')?.addEventListener('click', () => handleGerarSocialRelatorio('cesta'));


    // Listeners para sub-abas de Enxoval
    DOM_ELEMENTS.subNavEnxoval?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-subview]');
        if (btn) switchInternalSubView('enxoval', btn.dataset.subview.replace('enxoval-', ''));
    });
    DOM_ELEMENTS.formEnxovalLancamento?.addEventListener('submit', handleEnxovalLancamentoSubmit);
    DOM_ELEMENTS.formEnxovalEntrada?.addEventListener('submit', handleEnxovalEstoqueEntrySubmit); 
    // NOVO: Listener para gerar relatório
    document.getElementById('btn-enxoval-gerar-relatorio')?.addEventListener('click', () => handleGerarSocialRelatorio('enxoval'));
    
    // Listener de Importação
    DOM_ELEMENTS.btnSocialImportData?.addEventListener('click', handleSocialImportSubmit);
    
    // NOVO: Adiciona listeners de mudança para o tipo de destinatário para renderizar o select/input correto
    document.getElementById('cesta-tipo-destinatario')?.addEventListener('change', renderCestaLancamentoControls);
    document.getElementById('enxoval-tipo-destinatario')?.addEventListener('change', renderEnxovalLancamentoControls);

    // NOVO: Listeners para edição inline do destinatário (Tabelas de Histórico)
    const cestaHistoryTable = DOM_ELEMENTS.tableCestaHistorico;
    if (cestaHistoryTable) {
        cestaHistoryTable.addEventListener('click', (e) => {
            enterEditModeDestinatario(e);
            cancelDestinatarioEdit(e);
            saveDestinatarioEdit(e);
        });
    }
    
    const enxovalHistoryTable = DOM_ELEMENTS.tableEnxovalHistorico;
    if (enxovalHistoryTable) {
        enxovalHistoryTable.addEventListener('click', (e) => {
            enterEditModeDestinatario(e);
            cancelDestinatarioEdit(e);
            saveDestinatarioEdit(e);
        });
    }

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
    
    // Renderiza os controles de unidade
    renderCestaLancamentoControls();
    renderEnxovalLancamentoControls();
    
    // Limpa os gráficos ao mudar de aba principal
    if (graficoCestaRelatorio) { graficoCestaRelatorio.destroy(); graficoCestaRelatorio = null; }
    if (graficoEnxovalRelatorio) { graficoEnxovalRelatorio.destroy(); graficoEnxovalRelatorio = null; }
}
