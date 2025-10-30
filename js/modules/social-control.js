// js/modules/social-control.js
import { Timestamp, addDoc, serverTimestamp, getDocs, query, where, writeBatch, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getUnidades, 
    getCestaMovimentacoes, getCestaEstoque, 
    getEnxovalMovimentacoes, getEnxovalEstoque, 
    getUserRole 
} from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestamp, formatTimestampComTempo } from "../utils/formatters.js";
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
        
        // Esconde o relatório detalhado e reseta filtros customizados
        document.getElementById(`resultado-relatorio-${itemType}`)?.classList.add('hidden');
        document.getElementById(`${itemType}-datas-custom`)?.classList.add('hidden');
        document.getElementById(`${itemType}-datas-custom-fim`)?.classList.add('hidden');

        // Preenche as datas do filtro de relatório com os últimos 30 dias (lógica do usuário)
        const dataFimEl = DOM_ELEMENTS[`${itemType}DataFimRelatorio`];
        const dataInicioEl = DOM_ELEMENTS[`${itemType}DataInicioRelatorio`];
        const periodoEl = DOM_ELEMENTS[`${itemType}PeriodoRelatorio`];
        
        if (dataFimEl) dataFimEl.value = getTodayDateString();
        if (dataInicioEl) {
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            dataInicioEl.value = thirtyDaysAgo.toISOString().split('T')[0];
        }
        if (periodoEl) periodoEl.value = '30'; // Seleciona "Últimos 30 dias"
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
 * Popula os controles de destinatário/unidade no formulário de lançamento de Cesta.
 */
function renderCestaLancamentoControls() {
    const unidades = getUnidades();
    const selectUnidadeEl = document.getElementById('cesta-select-unidade');
    const inputPersonalizadoEl = document.getElementById('cesta-destinatario-personalizado');
    const selectTipoDestinatarioEl = document.getElementById('cesta-tipo-destinatario');

    if (!selectUnidadeEl || !inputPersonalizadoEl || !selectTipoDestinatarioEl) return;

    // Popula o seletor de unidades com tipos relevantes
    let unidadeHtml = '<option value="">-- Selecione a Unidade --</option>';

    const grupos = unidades.reduce((acc, unidade) => {
        let tipo = (unidade.tipo || "Sem Tipo").toUpperCase();
        if (tipo === "SEMCAS") tipo = "SEDE";
        if (!acc[tipo]) acc[tipo] = [];
        acc[tipo].push(unidade);
        return acc;
    }, {});

    Object.keys(grupos).sort().forEach(tipo => {
        unidadeHtml += `<optgroup label="Tipo: ${tipo}">`;
        grupos[tipo]
            .sort((a, b) => a.nome.localeCompare(b.nome))
            // Valor: TIPO-NOME (Ex: CRAS: Cras Centro)
            .forEach(unidade => {
                unidadeHtml += `<option value="${tipo.toUpperCase()}: ${unidade.nome}">${unidade.nome}</option>`;
            });
        unidadeHtml += `</optgroup>`;
    });

    selectUnidadeEl.innerHTML = unidadeHtml;

    // Adiciona listener para alternar visibilidade
    selectTipoDestinatarioEl.onchange = () => {
        const tipo = selectTipoDestinatarioEl.value;
        const isPersonalizado = tipo === 'personalizado';
        
        // Containers dos campos
        const containerUnidade = selectUnidadeEl.closest('.md\\:col-span-2');
        const containerPersonalizado = inputPersonalizadoEl.closest('.md\\:col-span-2');

        if (containerUnidade) containerUnidade.classList.toggle('hidden', isPersonalizado);
        selectUnidadeEl.required = !isPersonalizado;
        
        if (containerPersonalizado) containerPersonalizado.classList.toggle('hidden', !isPersonalizado);
        inputPersonalizadoEl.required = isPersonalizado;
        
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
    const isAdmin = getUserRole() === 'admin';

    historicoOrdenado.forEach(m => {
        const dataMov = formatTimestamp(m.data);
        const statusClass = m.status === 'Entregue' ? 'badge-green' : 'badge-gray';

        const details = `Saída Cesta: ${m.quantidade} un. p/ ${m.destinatario}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="mov-cesta" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        // CORREÇÃO 1: Padronização das colunas
        html += `<tr>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${m.destinatario}</td>
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
    const unidades = getUnidades();
    const selectUnidadeEl = document.getElementById('enxoval-select-unidade');
    const inputPersonalizadoEl = document.getElementById('enxoval-destinatario-personalizado');
    const selectTipoDestinatarioEl = document.getElementById('enxoval-tipo-destinatario');

    if (!selectUnidadeEl || !inputPersonalizadoEl || !selectTipoDestinatarioEl) return;

    // Popula o seletor de unidades com tipos relevantes
    let unidadeHtml = '<option value="">-- Selecione a Unidade --</option>';

    const grupos = unidades.reduce((acc, unidade) => {
        let tipo = (unidade.tipo || "Sem Tipo").toUpperCase();
        if (tipo === "SEMCAS") tipo = "SEDE";
        if (!acc[tipo]) acc[tipo] = [];
        acc[tipo].push(unidade);
        return acc;
    }, {});

    Object.keys(grupos).sort().forEach(tipo => {
        unidadeHtml += `<optgroup label="Tipo: ${tipo}">`;
        grupos[tipo]
            .sort((a, b) => a.nome.localeCompare(b.nome))
            // Valor: TIPO-NOME (Ex: CRAS-CRAS CENTRO)
            .forEach(unidade => {
                unidadeHtml += `<option value="${tipo.toUpperCase()}: ${unidade.nome}">${unidade.nome}</option>`;
            });
        unidadeHtml += `</optgroup>`;
    });

    selectUnidadeEl.innerHTML = unidadeHtml;

    // Adiciona listener para alternar visibilidade
    selectTipoDestinatarioEl.onchange = () => {
        const tipo = selectTipoDestinatarioEl.value;
        const isPersonalizado = tipo === 'personalizado';
        
        // Containers dos campos
        const containerUnidade = selectUnidadeEl.closest('.md\\:col-span-2');
        const containerPersonalizado = inputPersonalizadoEl.closest('.md\\:col-span-2');

        if (containerUnidade) containerUnidade.classList.toggle('hidden', isPersonalizado);
        selectUnidadeEl.required = !isPersonalizado;
        
        if (containerPersonalizado) containerPersonalizado.classList.toggle('hidden', !isPersonalizado);
        inputPersonalizadoEl.required = isPersonalizado;
        
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
        
        // CORREÇÃO 1: Inclusão da Observação/Memo
        html += `<tr>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${m.destinatario}</td>
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
// NOVO PONTO 2: LÓGICA DE RELATÓRIO E GRÁFICO (MODIFICADA PARA SER MAIS ROBUSTA)
// =========================================================================

/**
 * Normaliza o nome da unidade/tipo para ser usado como chave de agrupamento
 * @param {string} destinatario Nome do destinatário (pode incluir prefixo TIPO:).
 * @returns {string} Nome da unidade ou tipo da unidade.
 */
function normalizeDestinatario(destinatario) {
    if (!destinatario) return 'Não Informado';
    const parts = destinatario.split(':').map(p => p.trim());
    if (parts.length > 1) {
        // Ex: "CRAS: Cras Centro" -> "Cras Centro" (Unidade)
        return parts[1];
    }
    return destinatario; // Nome personalizado ou não formatado
}

/**
 * Calcula a chave temporal para agrupamento (Mensal ou Semanal).
 * @param {Timestamp} timestamp Timestamp do Firestore.
 * @param {string} agrupamento 'mensal' ou 'semanal'.
 * @returns {string} Chave formatada.
 */
function getPeriodKey(timestamp, agrupamento) {
    if (!timestamp || typeof timestamp.toDate !== 'function') return 'N/A';
    const date = timestamp.toDate();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    if (agrupamento === 'mensal') {
        return `${year}-${month}`; // Ex: 2024-10
    }
    
    if (agrupamento === 'semanal') {
        // Calcula o início da semana (domingo)
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - d.getDay()); // Início da semana (Domingo)
        // Usa o formato AAAA-MM-DD para garantir a ordem
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; 
    }
    
    return `${year}-${month}-${day}`; // Agrupamento diário
}

/**
 * Processa os dados de movimentação com base no tipo de agrupamento.
 * @param {Array<Object>} movsFiltradas Movimentações de saída filtradas.
 * @param {string} agrupamento 'unidade', 'tipo-unidade', 'mensal', 'semanal'.
 * @returns {Object} Dados processados para KPIs, Ranking e Gráfico.
 */
function processSocialReportData(movsFiltradas, agrupamento) {
    const dadosProcessados = {
        totalSaidas: 0,
        unidadesUnicas: new Set(),
        dadosAgrupados: new Map(), // Agrupa por Unidade, Tipo, Mês ou Semana
        maiorVolumeDia: { data: null, quantidade: 0 },
        distribuicaoDiaria: new Map(), // Para KPI de maior volume
        ranking: new Map(), // Para Ranking de Unidades/Tipos
    };

    const unidadesMap = new Map(getUnidades().map(u => [`${u.tipo.toUpperCase()}: ${u.nome}`, u]));

    movsFiltradas.forEach(mov => {
        const quantidade = mov.quantidade || 0;
        if (quantidade === 0) return;

        dadosProcessados.totalSaidas += quantidade;

        // 1. Agrupamento principal (para Ranking e Gráfico)
        let chaveAgrupamento = '';

        if (agrupamento === 'unidade') {
            chaveAgrupamento = normalizeDestinatario(mov.destinatario);
        } else if (agrupamento === 'tipo-unidade') {
            // Tenta extrair o tipo da unidade (Ex: "CRAS: Cras Centro" -> "CRAS")
            const parts = mov.destinatario.split(':').map(p => p.trim());
            const tipo = parts.length > 1 ? parts[0] : 'Personalizado';
            chaveAgrupamento = capitalizeString(tipo);
        } else if (agrupamento === 'mensal' || agrupamento === 'semanal') {
            chaveAgrupamento = getPeriodKey(mov.data, agrupamento);
        }
        
        // Acumula no agrupamento principal
        dadosProcessados.dadosAgrupados.set(chaveAgrupamento, (dadosProcessados.dadosAgrupados.get(chaveAgrupamento) || 0) + quantidade);


        // 2. Cálculo para KPIs (Unidades Atendidas, Maior Dia)
        
        // Unidades Únicas: conta o destinatário se for unidade
        const destinatarioNormalizado = normalizeDestinatario(mov.destinatario);
        if (destinatarioNormalizado !== 'Não Informado') {
             dadosProcessados.unidadesUnicas.add(destinatarioNormalizado);
        }
        
        // Distribuição Diária
        const diaKey = getPeriodKey(mov.data, 'diario');
        dadosProcessados.distribuicaoDiaria.set(diaKey, (dadosProcessados.distribuicaoDiaria.get(diaKey) || 0) + quantidade);
    });

    // 3. Finaliza KPI: Maior Volume
    dadosProcessados.distribuicaoDiaria.forEach((qtd, dia) => {
        if (qtd > dadosProcessados.maiorVolumeDia.quantidade) {
            dadosProcessados.maiorVolumeDia = { data: dia, quantidade: qtd };
        }
    });

    // 4. Cria o Ranking (Top 10)
    dadosProcessados.ranking = Array.from(dadosProcessados.dadosAgrupados.entries())
        .map(([nome, quantidade]) => ({ nome, quantidade }))
        .sort((a, b) => b.quantidade - a.quantidade)
        .slice(0, 10);
        
    return dadosProcessados;
}


/**
 * Atualiza os KPIs na UI.
 */
function renderSocialReportKPIs(itemType, dadosProcessados, totalDias) {
    const itemLabel = itemType === 'cesta' ? 'cestas' : 'enxovais';
    
    // Mapeamento dos IDs de KPI
    const kpiMap = {
        total: DOM_ELEMENTS[`kpiTotal${capitalizeString(itemLabel)}`],
        unidades: DOM_ELEMENTS[`kpiUnidadesAtendidas${capitalizeString(itemType)}`],
        media: DOM_ELEMENTS[`kpiMediaDiaria${capitalizeString(itemType)}`],
        maiorVolume: DOM_ELEMENTS[`kpiMaiorVolumeData${capitalizeString(itemType)}`]
    };

    if (kpiMap.total) {
        kpiMap.total.textContent = dadosProcessados.totalSaidas.toLocaleString('pt-BR');
    }
    if (kpiMap.unidades) {
        kpiMap.unidades.textContent = dadosProcessados.unidadesUnicas.size;
    }
    if (kpiMap.media) {
        const mediaDiaria = totalDias > 0 ? (dadosProcessados.totalSaidas / totalDias) : 0;
        kpiMap.media.textContent = mediaDiaria.toFixed(1);
    }
    if (kpiMap.maiorVolume) {
        if (dadosProcessados.maiorVolumeDia.data) {
             const [ano, mes, dia] = dadosProcessados.maiorVolumeDia.data.split('-');
             const dataFormatada = `${dia}/${mes}/${ano.substring(2)}`;
             kpiMap.maiorVolume.textContent = `${dadosProcessados.maiorVolumeDia.quantidade} un. em ${dataFormatada}`;
        } else {
             kpiMap.maiorVolume.textContent = '-';
        }
    }
}

/**
 * Renderiza o ranking de recebimento.
 */
function renderSocialReportRanking(itemType, ranking, totalSaidas) {
    const container = DOM_ELEMENTS[`rankingUnidades${capitalizeString(itemType)}`];
    if (!container) return;

    if (ranking.length === 0) {
        container.innerHTML = '<p class="text-gray-500 italic text-sm">Nenhum dado de distribuição encontrado para o ranking.</p>';
        return;
    }
    
    const rankingHTML = ranking.map((item, index) => {
        const medalha = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}º`;
        const percentual = ((item.quantidade / totalSaidas) * 100).toFixed(1);
        const itemClasse = index < 3 ? 'bg-yellow-50' : 'bg-gray-50';
        
        return `            
            <div class="flex items-center justify-between p-2 rounded-lg ${itemClasse}">                
                <div class="flex items-center gap-2">                    
                    <span class="text-lg">${medalha}</span>                    
                    <div>                        
                        <p class="font-medium text-sm">${item.nome}</p>                        
                        <p class="text-xs text-gray-500">${percentual}% do total</p>                    
                    </div>                
                </div>                
                <span class="font-bold text-lg text-blue-600">${item.quantidade}</span>            
            </div>        
        `;
    }).join('');

    container.innerHTML = rankingHTML;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}

/**
 * Renderiza o gráfico principal (Barras para tempo, Rosca para Unidade/Tipo).
 */
function renderSocialReportChart(itemType, dadosProcessados, agrupamento) {
    const canvas = DOM_ELEMENTS[`grafico${capitalizeString(itemType)}RelatorioCanvas`];
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Destrói gráfico anterior se existir
    const chartInstance = itemType === 'cesta' ? graficoCestaRelatorio : graficoEnxovalRelatorio;
    if (chartInstance) {
        chartInstance.destroy();
        if (itemType === 'cesta') graficoCestaRelatorio = null;
        else graficoEnxovalRelatorio = null;
    }

    const labels = Array.from(dadosProcessados.dadosAgrupados.keys());
    const valores = Array.from(dadosProcessados.dadosAgrupados.values());
    const total = valores.reduce((a, b) => a + b, 0);

    // Mapeamento de cores
    const cores = [
        '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
        '#FF9F40', '#E7E9ED', '#8B0000', '#006400', '#4B0082'
    ];

    const isTemporal = agrupamento === 'mensal' || agrupamento === 'semanal';
    const chartType = isTemporal ? 'bar' : 'doughnut';
    const itemLabel = itemType === 'cesta' ? 'Cestas Básicas' : 'Enxovais';

    // Formata rótulos temporais para exibição
    const formattedLabels = labels.map(label => {
        if (agrupamento === 'mensal') {
            const [year, month] = label.split('-');
            return new Date(year, month - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
        }
        if (agrupamento === 'semanal') {
             const [year, month, day] = label.split('-');
             return `Sem. de ${day}/${month}`;
        }
        return label;
    });

    const config = {
        type: chartType,
        data: {
            labels: formattedLabels,
            datasets: [{
                label: itemLabel,
                data: valores,
                backgroundColor: isTemporal ? 'rgba(59, 130, 246, 0.7)' : cores.slice(0, labels.length),
                borderColor: isTemporal ? 'rgba(59, 130, 246, 1)' : 'white',
                borderWidth: isTemporal ? 1 : 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: isTemporal ? 'top' : 'right',
                    labels: {
                        boxWidth: 12,
                        padding: 15
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const percentual = ((context.parsed / total) * 100).toFixed(1);
                            return `${context.label}: ${context.parsed} un. (${percentual}%)`;
                        }
                    }
                }
            },
            scales: isTemporal ? {
                x: { title: { display: true, text: capitalizeString(agrupamento) } },
                y: { beginAtZero: true, ticks: { stepSize: 1, precision: 0 } }
            } : {}
        }
    };

    const newChartInstance = new Chart(ctx, config);
    if (itemType === 'cesta') graficoCestaRelatorio = newChartInstance;
    else graficoEnxovalRelatorio = newChartInstance;

    // Atualiza título
    const tituloEl = DOM_ELEMENTS[`tituloGrafico${capitalizeString(itemType)}`];
    if (tituloEl) {
        const titulos = {
            'unidade': `Distribuição por Unidade (${total} total)`,
            'tipo-unidade': `Distribuição por Tipo de Unidade (${total} total)`,
            'mensal': 'Evolução Mensal',
            'semanal': 'Evolução Semanal',
        };
        tituloEl.textContent = titulos[agrupamento] || `Distribuição de ${itemLabel}`;
    }
}

/**
 * Renderiza o relatório textual robusto para a chefia.
 * @param {string} itemType 'cesta' ou 'enxoval'.
 * @param {Array<Object>} movsFiltradas Movimentações de saída filtradas.
 * @param {Object} dadosProcessados Dados processados.
 */
function renderSocialReportTextual(itemType, movsFiltradas, dadosProcessados) {
    const container = DOM_ELEMENTS[`relatorioTextual${capitalizeString(itemType)}`];
    if (!container) return;
    
    const { totalSaidas, unidadesUnicas, ranking } = dadosProcessados;
    const { dataInicial, dataFinal, totalDias } = getPeriodoAnalise(movsFiltradas);
    
    const itemLabel = itemType === 'cesta' ? 'cestas básicas' : 'enxovais';
    const mediaDiaria = totalDias > 0 ? (totalSaidas / totalDias).toFixed(1) : '0';
    
    const maisRecebeu = ranking.length > 0 ? ranking[0] : null;
    let relatorioHTML = '';
    
    if (totalSaidas === 0) {
         container.innerHTML = `<p class="text-gray-500 italic">Nenhum dado encontrado para o período.</p>`;
         return;
    }
    
    // --- Resumo Executivo ---
    relatorioHTML += `
        <div class="bg-blue-50 p-3 rounded-lg border-l-4 border-blue-500">
            <h4 class="font-semibold text-blue-800 mb-2">📊 Resumo Executivo</h4>
            <p><strong>Período analisado:</strong> ${formatTimestamp(dataInicial)} a ${formatTimestamp(dataFinal)} (${totalDias} dias)</p>
            <p><strong>Total distribuído:</strong> ${totalSaidas} ${itemLabel}</p>
            <p><strong>Média diária:</strong> ${mediaDiaria} ${itemLabel.replace(' básicas', '')}/dia</p>
            <p><strong>Unidades atendidas:</strong> ${unidadesUnicas.size} diferentes</p>
        </div>
    `;

    // --- Destaque - Maior Recebimento ---
    if (maisRecebeu) {
        const percentualMaior = ((maisRecebeu.quantidade / totalSaidas) * 100).toFixed(1);
        relatorioHTML += `
            <div class="bg-green-50 p-3 rounded-lg border-l-4 border-green-500">
                <h4 class="font-semibold text-green-800 mb-2">🏆 Destaque - Maior Recebimento</h4>
                <p>A categoria/unidade <strong>${maisRecebeu.nome}</strong> mais recebeu ${itemLabel}:</p>
                <p><strong>${maisRecebeu.quantidade} unidades</strong> (${percentualMaior}% do total)</p>
            </div>
        `;
    }

    // --- Top 3 de Recebimento ---
    if (ranking.length > 3) {
        relatorioHTML += `
            <div class="bg-yellow-50 p-3 rounded-lg border-l-4 border-yellow-500">
                <h4 class="font-semibold text-yellow-800 mb-2">📈 Análise de Distribuição (Top 3)</h4>
                <p>As <strong>3 maiores fontes de distribuição</strong> foram:</p>
                <ol class="list-decimal list-inside mt-2 space-y-1">
                    ${ranking.slice(0, 3).map(item => 
                         `<li><strong>${item.nome}:</strong> ${item.quantidade} un. (${((item.quantidade/totalSaidas)*100).toFixed(1)}%)</li>`
                    ).join('')}
                </ol>
            </div>
        `;
    }

    container.innerHTML = relatorioHTML;
}

/**
 * Renderiza a tabela de detalhes.
 */
function renderSocialReportDetailTable(itemType, dadosProcessados, agrupamento) {
    const tableBody = DOM_ELEMENTS[`tabelaDetalhes${capitalizeString(itemType)}`];
    const tableHeader = DOM_ELEMENTS[`headerTabela${capitalizeString(itemType)}`];
    
    if (!tableBody || !tableHeader) return;

    // 1. Define Headers
    let headerText = '';
    let bodyData = [];
    
    if (agrupamento === 'unidade') {
        headerText = '<th>Unidade</th><th>Qtd. Total Recebida</th>';
        bodyData = dadosProcessados.ranking.map(item => `<tr><td>${item.nome}</td><td class="text-center font-bold">${item.quantidade}</td></tr>`);
    } else if (agrupamento === 'tipo-unidade') {
        headerText = '<th>Tipo de Unidade</th><th>Qtd. Total Recebida</th>';
        bodyData = dadosProcessados.ranking.map(item => `<tr><td>${item.nome}</td><td class="text-center font-bold">${item.quantidade}</td></tr>`);
    } else { // Mensal / Semanal
        headerText = `<th>Período</th><th>Qtd. Total Distribuída</th>`;
        // Converte Map para Array e ordena cronologicamente
        const sortedData = Array.from(dadosProcessados.dadosAgrupados.entries()).sort((a, b) => a[0].localeCompare(b[0]));
        bodyData = sortedData.map(([periodoKey, quantidade]) => {
            let periodoDisplay = periodoKey;
            if (agrupamento === 'mensal') {
                const [year, month] = periodoKey.split('-');
                periodoDisplay = `${month}/${year}`;
            } else if (agrupamento === 'semanal') {
                 const [year, month, day] = periodoKey.split('-');
                 periodoDisplay = `Semana de ${day}/${month}/${year.substring(2)}`;
            }
            return `<tr><td>${periodoDisplay}</td><td class="text-center font-bold">${quantidade}</td></tr>`;
        });
    }

    tableHeader.innerHTML = headerText;
    
    if (bodyData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="2" class="text-center py-10">Nenhum dado encontrado para este agrupamento no período.</td></tr>`;
    } else {
        tableBody.innerHTML = bodyData.join('');
    }
}


/**
 * Lida com a geração do relatório personalizado (Gráfico e Resumo Textual).
 * @param {string} itemType 'cesta' ou 'enxoval'.
 */
async function handleGerarSocialRelatorio(itemType) {
    if (!isReady()) { showAlert(`alert-relatorio-${itemType}`, 'Erro: Não autenticado.', 'error'); return; }

    const relatorioOutputEl = DOM_ELEMENTS[`resultadoRelatorio${capitalizeString(itemType)}`];
    const alertId = `alertRelatorio${capitalizeString(itemType)}`;

    // 1. Coletar filtros
    const periodo = DOM_ELEMENTS[`${itemType}PeriodoRelatorio`].value;
    const agrupamento = DOM_ELEMENTS[`${itemType}Agrupamento`].value;
    let dataInicioStr = DOM_ELEMENTS[`${itemType}DataInicioRelatorio`].value;
    let dataFimStr = DOM_ELEMENTS[`${itemType}DataFimRelatorio`].value;
    
    // Calcula datas se não for customizado
    if (periodo !== 'custom') {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - parseInt(periodo));
        dataInicioStr = startDate.toISOString().split('T')[0];
        dataFimStr = endDate.toISOString().split('T')[0];
    } else {
        if (!dataInicioStr || !dataFimStr) {
             showAlert(alertId, 'Para "Período personalizado", informe as datas de início e fim.', 'warning'); 
             return;
        }
    }
    
    // Converte datas para Milissegundos (com +1 dia para o fim)
    const dataInicioMillis = dateToTimestamp(dataInicioStr).toMillis();
    const dataFimMillis = dateToTimestamp(dataFimStr).toMillis() + (24 * 60 * 60 * 1000 - 1); 

    const movimentacoes = itemType === 'cesta' ? getCestaMovimentacoes() : getEnxovalMovimentacoes();

    // 2. Filtrar as movimentações
    let movsFiltradas = movimentacoes.filter(m => { 
        const mData = m.data?.toMillis(); 
        const isSaida = m.tipo === 'saida';
        const dataMatch = mData >= dataInicioMillis && mData <= dataFimMillis;
        return isSaida && dataMatch; 
    });
    
    if (movsFiltradas.length === 0) { 
        showAlert(alertId, 'Nenhum dado de saída encontrado para os filtros selecionados.', 'info'); 
        relatorioOutputEl.classList.add('hidden');
        return; 
    }
    
    // 3. Processamento de dados
    const totalDaysCount = Math.ceil((dataFimMillis - dataInicioMillis) / (1000 * 60 * 60 * 24));
    const dadosProcessados = processSocialReportData(movsFiltradas, agrupamento);
    
    // 4. Renderizar
    renderSocialReportKPIs(itemType, dadosProcessados, totalDaysCount);
    renderSocialReportTextual(itemType, movsFiltradas, dadosProcessados);
    renderSocialReportRanking(itemType, dadosProcessados.ranking, dadosProcessados.totalSaidas);
    renderSocialReportChart(itemType, dadosProcessados, agrupamento);
    renderSocialReportDetailTable(itemType, dadosProcessados, agrupamento);
    
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
    DOM_ELEMENTS.btnGerarRelatorioCesta?.addEventListener('click', () => handleGerarSocialRelatorio('cesta'));
    // NOVO: Listener para alternar datas customizadas
    DOM_ELEMENTS.cestaPeriodoRelatorio?.addEventListener('change', function() {
        const customDiv = DOM_ELEMENTS.cestaDatasCustom;
        const customDivFim = DOM_ELEMENTS.cestaDatasCustomFim;
        if (this.value === 'custom') {
            customDiv?.classList.remove('hidden');
            customDivFim?.classList.remove('hidden');
        } else {
            customDiv?.classList.add('hidden');
            customDivFim?.classList.add('hidden');
        }
    });


    // Listeners para sub-abas de Enxoval
    DOM_ELEMENTS.subNavEnxoval?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-subview]');
        if (btn) switchInternalSubView('enxoval', btn.dataset.subview.replace('enxoval-', ''));
    });
    DOM_ELEMENTS.formEnxovalLancamento?.addEventListener('submit', handleEnxovalLancamentoSubmit);
    DOM_ELEMENTS.formEnxovalEntrada?.addEventListener('submit', handleEnxovalEstoqueEntrySubmit); 
    // NOVO: Listener para gerar relatório
    DOM_ELEMENTS.btnGerarRelatorioEnxoval?.addEventListener('click', () => handleGerarSocialRelatorio('enxoval'));
    // NOVO: Listener para alternar datas customizadas
    DOM_ELEMENTS.enxovalPeriodoRelatorio?.addEventListener('change', function() {
        const customDiv = DOM_ELEMENTS.enxovalDatasCustom;
        const customDivFim = DOM_ELEMENTS.enxovalDatasCustomFim;
        if (this.value === 'custom') {
            customDiv?.classList.remove('hidden');
            customDivFim?.classList.remove('hidden');
        } else {
            customDiv?.classList.add('hidden');
            customDivFim?.classList.add('hidden');
        }
    });
    
    // Listener de Importação
    DOM_ELEMENTS.btnSocialImportData?.addEventListener('click', handleSocialImportSubmit);
    
    // NOVO: Adiciona listeners de mudança para o tipo de destinatário para renderizar o select/input correto
    document.getElementById('cesta-tipo-destinatario')?.addEventListener('change', renderCestaLancamentoControls);
    document.getElementById('enxoval-tipo-destinatario')?.addEventListener('change', renderEnxovalLancamentoControls);

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
