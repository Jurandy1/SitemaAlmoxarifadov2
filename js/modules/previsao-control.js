// js/modules/previsao-control.js
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getAguaMovimentacoes, getGasMovimentacoes, listaExclusoes, modoPrevisao, graficoPrevisao, tipoSelecionadoPrevisao } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { normalizeString } from "../utils/formatters.js";

let ChartInstance = { agua: null, gas: null };

// Função auxiliar (importada de control-helpers para preencher os selects)
// NOTA: É necessário que a função renderUnidadeControls (de control-helpers) esteja acessível no escopo
// Para fins de modularização, assumimos que ela será injetada via control-helpers no initAllListeners
function renderUnidadeControls() { 
    // Esta chamada é resolvida em control-helpers.js (renderUIModules)
    if (typeof window.renderUnidadeControls === 'function') {
        window.renderUnidadeControls();
    } else {
        console.warn('renderUnidadeControls não está disponível. Não foi possível preencher os selects de unidade/tipo.');
    }
}


// =========================================================================
// FUNÇÕES DE UTILIDADE E CONTROLE DE ESTADO
// =========================================================================

/**
 * Filtra e calcula o consumo de um item (entrega) por dia.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {string} unidadeId ID da unidade para filtrar, ou null.
 * @param {string} tipoUnidade Tipo da unidade para filtrar ('CRAS', 'SEDE', etc.), ou null.
 * @param {Array<string>} exclusoes Lista de IDs de unidades a serem excluídas.
 * @returns {Object} { consumoDiario: number, consumoTotal: number, dataConsumo: Map<string, number> }
 */
function calcularConsumo(itemType, unidadeId = null, tipoUnidade = null, exclusoes = []) {
    const movimentacoes = itemType === 'agua' ? getAguaMovimentacoes() : getGasMovimentacoes();
    const dataConsumo = new Map();
    let numDias = 0;
    
    // 1. Filtrar movimentações
    const movsFiltradas = movimentacoes.filter(m => {
        if (m.tipo !== 'entrega' || !m.data) return false;
        if (unidadeId && m.unidadeId !== unidadeId) return false;
        if (exclusoes.includes(m.unidadeId)) return false;
        
        let mTipoUnidade = (m.tipoUnidade || 'N/A').toUpperCase();
        if (mTipoUnidade === 'SEMCAS') mTipoUnidade = 'SEDE';
        if (tipoUnidade && mTipoUnidade !== tipoUnidade) return false;

        return true;
    });

    if (movsFiltradas.length === 0) {
        return { consumoDiario: 0, consumoTotal: 0, dataConsumo: new Map(), numDias: 0 };
    }

    // 2. Agrupar por dia e encontrar o range de datas
    let minDate = Infinity;
    let maxDate = -Infinity;

    movsFiltradas.forEach(m => {
        const date = m.data.toDate();
        date.setHours(0, 0, 0, 0);
        const dateKey = date.toISOString().split('T')[0];
        const quantidade = m.quantidade || 0;
        
        dataConsumo.set(dateKey, (dataConsumo.get(dateKey) || 0) + quantidade);
        
        minDate = Math.min(minDate, date.getTime());
        maxDate = Math.max(maxDate, date.getTime());
    });
    
    // 3. Calcular o total de dias no período
    if (minDate !== Infinity) {
        // Incluir o dia de início e o dia de fim
        numDias = Math.floor((maxDate - minDate) / (1000 * 60 * 60 * 24)) + 1;
    }

    const consumoTotal = Array.from(dataConsumo.values()).reduce((sum, q) => sum + q, 0);
    const consumoDiario = numDias > 0 ? consumoTotal / numDias : 0;
    
    return { consumoDiario, consumoTotal, dataConsumo, numDias };
}


// =========================================================================
// LÓGICA DE AÇÕES DO DOM
// =========================================================================

/**
 * Alterna a visualização de configuração com base no modo selecionado.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {string} mode Modo de previsão.
 */
function selecionarModoPrevisao(itemType, mode) {
    const cardOptions = document.querySelectorAll(`#subview-previsao-${itemType} .previsao-option-card`);
    const configContainer = DOM_ELEMENTS[`configPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    const unidadeContainer = document.getElementById(`select-unidade-container-${itemType}`);
    const tipoContainer = document.getElementById(`select-tipo-container-${itemType}`);
    
    modoPrevisao[itemType] = mode;

    // Atualiza a seleção visual
    cardOptions.forEach(card => card.classList.toggle('selected', card.dataset.modo === mode));

    // Exibe o container de configuração
    if (configContainer) configContainer.classList.remove('hidden');

    // Configura os selects
    if (unidadeContainer) unidadeContainer.classList.toggle('hidden', mode !== 'unidade-especifica');
    if (tipoContainer) tipoContainer.classList.toggle('hidden', mode !== 'por-tipo');
    
    // Esconde o resultado anterior
    const resultadoContainer = DOM_ELEMENTS[`resultadoPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}Container`];
    if (resultadoContainer) resultadoContainer.classList.add('hidden');
    
    // Garante que o select do tipo de unidade é populado se for o modo 'por-tipo'
    if (mode === 'por-tipo') {
         renderUnidadeControls(); // Funcao de control-helpers para repopular os selects de tipo
    }
}

/**
 * Adiciona uma unidade à lista de exclusão.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function adicionarExclusao(itemType) {
    const selectEl = DOM_ELEMENTS[`selectExclusao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    if (!selectEl) return;
    
    const unidadeId = selectEl.value;
    const unidadeNome = selectEl.options[selectEl.selectedIndex]?.text;
    
    if (!unidadeId) {
        showAlert(`alertas-previsao-${itemType}`, 'Selecione uma unidade válida para excluir.', 'warning');
        return;
    }
    
    if (listaExclusoes[itemType].some(e => e.id === unidadeId)) {
        showAlert(`alertas-previsao-${itemType}`, `A unidade ${unidadeNome} já está na lista de exclusão.`, 'info');
        return;
    }

    listaExclusoes[itemType].push({ id: unidadeId, nome: unidadeNome });
    showAlert(`alertas-previsao-${itemType}`, `Unidade ${unidadeNome} adicionada à exclusão.`, 'success', 2000);
    
    // Limpa o select e renderiza a lista
    selectEl.value = '';
    renderListaExclusoes(itemType);
}

/**
 * Remove uma unidade da lista de exclusão.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {string} unidadeId ID da unidade a ser removida.
 */
function removerExclusao(itemType, unidadeId) {
    listaExclusoes[itemType] = listaExclusoes[itemType].filter(e => e.id !== unidadeId);
    renderListaExclusoes(itemType);
    showAlert(`alertas-previsao-${itemType}`, 'Unidade removida da exclusão.', 'info', 2000);
}

/**
 * Renderiza os botões de unidades excluídas.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function renderListaExclusoes(itemType) {
    const listaEl = DOM_ELEMENTS[`listaExclusoes${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    if (!listaEl) return;
    
    if (listaExclusoes[itemType].length === 0) {
        listaEl.innerHTML = '<p class="text-sm text-gray-500 italic">Nenhuma unidade excluída.</p>';
        return;
    }

    listaEl.innerHTML = listaExclusoes[itemType].map(e => `
        <span class="exclusao-item">
            ${e.nome}
            <button type="button" data-id="${e.id}" class="btn-remove-exclusao" title="Remover"><i data-lucide="x" class="w-3 h-3"></i></button>
        </span>
    `).join('');
    
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    
    // Adiciona listener para remoção (usando delegação de eventos para o elemento pai)
    listaEl.querySelectorAll('.btn-remove-exclusao').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            removerExclusao(itemType, id);
        });
    });
}

/**
 * Função principal que executa o cálculo da previsão e renderiza o resultado.
 * @param {string} itemType 'agua' ou 'gas'.
 */
export function calcularPrevisaoInteligente(itemType) {
    const itemLabel = itemType === 'agua' ? 'galão(ões)' : 'botijão(ões)';
    const alertId = `alertas-previsao-${itemType}`;
    const btnCalcular = DOM_ELEMENTS[`btnCalcularPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    const resultadoContainer = DOM_ELEMENTS[`resultadoPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}Container`];
    const resultadoContentEl = DOM_ELEMENTS[`resultadoContent${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    const diasInput = DOM_ELEMENTS[`inputDiasPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}`];
    const margemInput = DOM_ELEMENTS[`inputMargemSeguranca${itemType === 'agua' ? 'Agua' : 'Gas'}`];
    const configContainer = DOM_ELEMENTS[`configPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];

    if (!modoPrevisao[itemType] || !configContainer || configContainer.classList.contains('hidden')) {
        showAlert(alertId, 'Por favor, selecione e configure o modo de previsão (Etapas 1 e 2).', 'warning');
        return;
    }

    const diasPrevisao = parseInt(diasInput.value, 10);
    const margemSeguranca = parseInt(margemInput.value, 10) / 100;
    
    if (isNaN(diasPrevisao) || diasPrevisao <= 0 || isNaN(margemSeguranca) || margemSeguranca < 0) {
        showAlert(alertId, 'Verifique os campos de Período e Margem de Segurança.', 'warning');
        return;
    }

    btnCalcular.disabled = true;
    btnCalcular.innerHTML = '<div class="loading-spinner-small mx-auto"></div> <span class="ml-2">Calculando...</span>';

    try {
        let unidadeId = null;
        let tipoUnidade = null;
        let nomeAlvo = 'Todas as Unidades';
        let unidadeCount = 0;
        
        const exclusoesIds = listaExclusoes[itemType].map(e => e.id);
        
        // 1. Coleta dados de filtro
        if (modoPrevisao[itemType] === 'unidade-especifica') {
            const selectEl = DOM_ELEMENTS[`selectPrevisaoUnidade${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
            unidadeId = selectEl.value;
            nomeAlvo = selectEl.options[selectEl.selectedIndex]?.text || nomeAlvo;
            if (!unidadeId) { showAlert(alertId, 'Selecione uma Unidade Específica.', 'warning'); return; }
            unidadeCount = 1;
        } else if (modoPrevisao[itemType] === 'por-tipo') {
            const selectEl = DOM_ELEMENTS[`selectPrevisaoTipo${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
            tipoUnidade = selectEl.value;
            nomeAlvo = `Unidades do Tipo: ${tipoUnidade}`;
            if (!tipoUnidade) { showAlert(alertId, 'Selecione um Tipo de Unidade.', 'warning'); return; }
            unidadeCount = getUnidades().filter(u => {
                let uTipo = (u.tipo || 'N/A').toUpperCase();
                if (uTipo === 'SEMCAS') uTipo = 'SEDE';
                return uTipo === tipoUnidade && !exclusoesIds.includes(u.id);
            }).length;
        } else if (modoPrevisao[itemType] === 'completo') {
            unidadeCount = getUnidades().filter(u => !exclusoesIds.includes(u.id)).length;
        }

        // 2. Executa o cálculo
        const { consumoDiario, consumoTotal, dataConsumo, numDias } = calcularConsumo(
            itemType, 
            unidadeId, 
            tipoUnidade, 
            exclusoesIds
        );
        
        if (consumoTotal === 0 || numDias < 5) {
            showAlert(alertId, `Dados insuficientes para a previsão. Encontrado ${consumoTotal} ${itemLabel} em ${numDias} dias. É necessário mais histórico.`, 'error');
            return;
        }
        
        // 3. Cálculos da Previsão
        const consumoDiarioMedio = consumoDiario;
        const previsaoConsumoBase = consumoDiarioMedio * diasPrevisao;
        const previsaoAjustada = previsaoConsumoBase * (1 + margemSeguranca);

        // 4. Renderiza resultados textuais
        const resultadosHtml = `
            <p class="text-sm text-blue-100 mb-4"><strong>Alvo:</strong> ${nomeAlvo} (${unidadeCount} unidades)</p>
            <div class="space-y-2">
                <div class="flex justify-between border-b border-blue-800 pb-1">
                    <span class="font-medium">Período Histórico Analisado:</span>
                    <span>${numDias} dias</span>
                </div>
                <div class="flex justify-between border-b border-blue-800 pb-1">
                    <span class="font-medium">Consumo Total Registrado:</span>
                    <span>${consumoTotal.toFixed(0)} ${itemLabel}</span>
                </div>
                <div class="flex justify-between border-b border-blue-800 pb-1">
                    <span class="font-medium">Consumo Diário Médio:</span>
                    <span>${consumoDiarioMedio.toFixed(2)} ${itemLabel}/dia</span>
                </div>
                <div class="pt-2 border-t border-blue-700 mt-2">
                    <h4 class="font-bold text-xl mb-1">PREVISÃO (Próximos ${diasPrevisao} dias)</h4>
                    <div class="flex justify-between pt-1">
                        <span class="font-medium text-lg">Consumo Base:</span>
                        <span class="text-xl font-extrabold">${previsaoConsumoBase.toFixed(0)} ${itemLabel}</span>
                    </div>
                    <div class="flex justify-between pt-1 text-yellow-300">
                        <span class="font-medium text-lg">Margem (${(margemSeguranca * 100).toFixed(0)}%):</span>
                        <span class="text-lg font-extrabold">${(previsaoAjustada - previsaoConsumoBase).toFixed(0)} ${itemLabel}</span>
                    </div>
                    <div class="flex justify-between pt-2 border-t border-blue-700 mt-2 text-white">
                        <span class="font-bold text-2xl">TOTAL RECOMENDADO:</span>
                        <span class="text-3xl font-extrabold">${Math.ceil(previsaoAjustada)} ${itemLabel}</span>
                    </div>
                </div>
            </div>
        `;
        resultadoContentEl.innerHTML = resultadosHtml;

        // 5. Renderiza o gráfico
        renderGraficoPrevisao(itemType, dataConsumo, diasPrevisao, consumoDiarioMedio);

        // 6. Exibe o resultado
        resultadoContainer.classList.remove('hidden');
        showAlert(alertId, 'Previsão calculada com sucesso!', 'success', 3000);

    } catch (error) {
        console.error(`Erro ao calcular previsão (${itemType}):`, error);
        showAlert(alertId, `Erro interno ao processar a previsão: ${error.message}`, 'error');
    } finally {
        btnCalcular.disabled = false;
        btnCalcular.innerHTML = '<i data-lucide="calculator"></i> Calcular Previsão';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Renderiza o gráfico de consumo diário.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {Map<string, number>} dataConsumo Consumo por data (YYYY-MM-DD).
 * @param {number} diasPrevisao Dias para frente na previsão.
 * @param {number} consumoDiarioMedio Consumo médio diário.
 */
function renderGraficoPrevisao(itemType, dataConsumo, diasPrevisao, consumoDiarioMedio) {
    const canvas = DOM_ELEMENTS[`graficoPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    if (!canvas || typeof Chart === 'undefined') return;

    // 1. Preparar dados históricos (ordenados)
    const sortedDates = Array.from(dataConsumo.keys()).sort();
    const historyLabels = sortedDates.map(d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
    const historyData = sortedDates.map(d => dataConsumo.get(d));
    
    // 2. Gerar labels de previsão
    const lastDate = sortedDates.length > 0 ? new Date(sortedDates[sortedDates.length - 1]) : new Date();
    const forecastLabels = [];
    const forecastData = [];
    for (let i = 1; i <= diasPrevisao; i++) {
        const nextDay = new Date(lastDate);
        nextDay.setDate(lastDate.getDate() + i);
        forecastLabels.push(nextDay.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }));
        // Adiciona o valor médio diário para a linha de previsão
        forecastData.push(consumoDiarioMedio); 
    }
    
    // 3. Combinar e preencher a data de previsão
    const combinedLabels = [...historyLabels, ...forecastLabels];
    const combinedHistoryData = [...historyData, ...Array(forecastLabels.length).fill(null)];
    const combinedForecastData = [...Array(historyLabels.length).fill(null), ...forecastData];
    
    // 4. Média diária (linha de base)
    const averageLine = combinedLabels.map(() => consumoDiarioMedio);

    // 5. Destruir instância anterior e criar nova
    if (ChartInstance[itemType]) {
        ChartInstance[itemType].destroy();
    }
    
    ChartInstance[itemType] = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: combinedLabels,
            datasets: [
                {
                    label: 'Consumo Diário (Histórico)',
                    data: combinedHistoryData,
                    borderColor: itemType === 'agua' ? 'rgba(59, 130, 246, 1)' : 'rgba(251, 146, 60, 1)', // blue-500 or orange-500
                    backgroundColor: itemType === 'agua' ? 'rgba(59, 130, 246, 0.2)' : 'rgba(251, 146, 60, 0.2)',
                    fill: false,
                    tension: 0.1,
                    segment: {
                        borderColor: ctx => {
                            if (ctx.p0DataIndex < historyLabels.length - 1) {
                                return itemType === 'agua' ? 'rgba(59, 130, 246, 1)' : 'rgba(251, 146, 60, 1)';
                            }
                            return 'transparent'; // Esconde a linha entre o histórico e a previsão
                        }
                    }
                },
                {
                    label: 'Previsão (Base Média)',
                    data: combinedForecastData,
                    borderColor: 'rgba(75, 85, 99, 0.8)', // gray-600
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0,
                    pointStyle: false, // Sem pontos para a linha de previsão
                },
                 {
                    label: 'Média Histórica',
                    data: averageLine,
                    borderColor: 'rgba(16, 185, 129, 0.5)', // green-500
                    borderDash: [2, 2],
                    fill: false,
                    tension: 0,
                    pointStyle: false, 
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, title: { display: true, text: 'Qtd. Entregue' }, ticks: { precision: 0 } },
                x: { title: { display: true, text: 'Data' } }
            },
            plugins: { legend: { position: 'top' }, tooltip: { mode: 'index', intersect: false } }
        }
    });
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS
// =========================================================================

/**
 * Inicializa os listeners para a aba de Previsão.
 */
export function initPrevisaoListeners() {
    ['agua', 'gas'].forEach(itemType => {
        const subviewId = `subview-previsao-${itemType}`;
        const container = document.getElementById(subviewId);
        if (!container) return;

        // Event delegation para os cards de seleção de modo
        container.querySelectorAll('.previsao-option-card').forEach(card => {
            card.addEventListener('click', (e) => {
                const mode = e.currentTarget.dataset.modo;
                selecionarModoPrevisao(itemType, mode);
            });
        });

        // Botão Adicionar Exclusão
        const btnAdd = DOM_ELEMENTS[`btnAddExclusao${itemType === 'agua' ? 'Agua' : 'Gas'}`];
        if (btnAdd) btnAdd.addEventListener('click', () => adicionarExclusao(itemType));

        // Botão Calcular
        const btnCalcular = DOM_ELEMENTS[`btnCalcularPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
        if (btnCalcular) btnCalcular.addEventListener('click', () => calcularPrevisaoInteligente(itemType));

        // Inicializa a lista de exclusões (em branco)
        renderListaExclusoes(itemType);
        
        // Garante que o container de configuração está escondido no início
        const configContainer = DOM_ELEMENTS[`configPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
        if (configContainer) configContainer.classList.add('hidden');
    });
}

/**
 * Função de orquestração para a tab de Água/Gás que carrega a Previsão.
 */
export function onPrevisaoTabChange(itemType) {
    // Garante que o cache de unidades/tipos está atualizado para preencher os selects
    renderUnidadeControls(); 

    // Garante que a lista de exclusão é renderizada e o resultado é escondido
    renderListaExclusoes(itemType);
    
    // Reseta o modo de previsão e o container de resultados
    modoPrevisao[itemType] = null;
    const configContainer = DOM_ELEMENTS[`configPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}El`];
    if (configContainer) configContainer.classList.add('hidden');
    
    const resultadoContainer = DOM_ELEMENTS[`resultadoPrevisao${itemType === 'agua' ? 'Agua' : 'Gas'}Container`];
    if (resultadoContainer) resultadoContainer.classList.add('hidden');
    
    document.querySelectorAll(`#subview-previsao-${itemType} .previsao-option-card`).forEach(card => card.classList.remove('selected'));
}
