// js/modules/previsao.js
// Este novo arquivo contém toda a lógica para a funcionalidade de Previsão Inteligente.
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
    getAguaMovimentacoes, 
    getGasMovimentacoes, 
    getUnidades, 
    modoPrevisao, 
    listaExclusoes, 
    graficoPrevisao, 
    tipoSelecionadoPrevisao 
} from "../utils/cache.js";
import { showAlert } from "../utils/dom-helpers.js";

/**
 * Seleciona o modo de previsão (unidade, tipo, completo) e atualiza a UI.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {string} modo 'unidade-especifica', 'por-tipo', 'completo'.
 */
function selecionarModoPrevisao(itemType, modo) {
    modoPrevisao[itemType] = modo;
    console.log(`Modo previsão ${itemType} definido para: ${modo}`);

    const configEl = document.getElementById(`config-previsao-${itemType}`);
    const unidadeContainer = document.getElementById(`select-unidade-container-${itemType}`);
    const tipoContainer = document.getElementById(`select-tipo-container-${itemType}`);
    const exclusaoContainer = document.getElementById(`exclusao-container-${itemType}`);
    
    // Resetar UI
    if (configEl) configEl.classList.remove('hidden');
    if (unidadeContainer) unidadeContainer.classList.add('hidden');
    if (tipoContainer) tipoContainer.classList.add('hidden');
    if (exclusaoContainer) exclusaoContainer.classList.add('hidden');
    
    // Resetar cards
    document.querySelectorAll(`#subview-previsao-${itemType} .previsao-option-card`).forEach(card => {
        card.classList.remove('selected');
    });
    // Marcar card selecionado
    const selectedCard = document.querySelector(`#subview-previsao-${itemType} .previsao-option-card[data-modo="${modo}"]`);
    if (selectedCard) selectedCard.classList.add('selected');

    // Configurar UI para o modo
    if (modo === 'unidade-especifica') {
        if (unidadeContainer) unidadeContainer.classList.remove('hidden');
    } else if (modo === 'por-tipo') {
        if (tipoContainer) tipoContainer.classList.remove('hidden');
        if (exclusaoContainer) exclusaoContainer.classList.remove('hidden');
    } else if (modo === 'completo') {
        if (exclusaoContainer) exclusaoContainer.classList.remove('hidden');
    }
    
    // Limpar resultados anteriores
    const resultadoEl = document.getElementById(`resultado-previsao-${itemType}-v2`);
    if (resultadoEl) resultadoEl.classList.add('hidden');
    if (graficoPrevisao[itemType]) {
        graficoPrevisao[itemType].destroy();
        graficoPrevisao[itemType] = null;
    }
}

/**
 * Renderiza a lista de unidades excluídas na UI.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function renderListaExclusoes(itemType) {
    const listaEl = document.getElementById(`lista-exclusoes-${itemType}`);
    if (!listaEl) return;

    const unidades = getUnidades();
    
    if (listaExclusoes[itemType].length === 0) {
        listaEl.innerHTML = '';
        return;
    }

    let html = '';
    listaExclusoes[itemType].forEach(unidadeId => {
        const unidade = unidades.find(u => u.id === unidadeId);
        const nome = unidade ? unidade.nome : `ID: ${unidadeId.substring(0, 6)}...`;
        html += `
            <span class="exclusao-item">
                ${nome}
                <button type="button" onclick="removerExclusao('${itemType}', '${unidadeId}')" title="Remover">&times;</button>
            </span>
        `;
    });
    listaEl.innerHTML = html;
}

/**
 * Adiciona uma unidade à lista de exclusão.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function adicionarExclusao(itemType) {
    const selectEl = document.getElementById(`select-exclusao-${itemType}`);
    if (!selectEl) return;

    const unidadeId = selectEl.value;
    if (!unidadeId) {
        showAlert(`alertas-previsao-${itemType}`, 'Selecione uma unidade para excluir.', 'warning');
        return;
    }

    if (!listaExclusoes[itemType].includes(unidadeId)) {
        listaExclusoes[itemType].push(unidadeId);
        renderListaExclusoes(itemType);
    } else {
        showAlert(`alertas-previsao-${itemType}`, 'Essa unidade já está na lista de exclusão.', 'info');
    }
}

/**
 * Remove uma unidade da lista de exclusão.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {string} unidadeId ID da unidade a remover.
 */
function removerExclusao(itemType, unidadeId) {
    listaExclusoes[itemType] = listaExclusoes[itemType].filter(id => id !== unidadeId);
    renderListaExclusoes(itemType);
}

/**
 * Renderiza o gráfico de previsão.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {object} data Dados do Chart.js.
 */
function renderGraficoPrevisao(itemType, data) {
    const canvasId = `grafico-previsao-${itemType}`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    // Destruir gráfico antigo, se existir
    if (graficoPrevisao[itemType]) {
        graficoPrevisao[itemType].destroy();
        graficoPrevisao[itemType] = null;
    }

    // Criar novo gráfico
    graficoPrevisao[itemType] = new Chart(ctx, {
        type: 'bar',
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: `Consumo (Unidades de ${itemType})`
                    }
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Função principal que calcula a previsão inteligente.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function calcularPrevisaoInteligente(itemType) {
    console.log(`Calculando previsão para: ${itemType}`);
    
    const alertId = `alertas-previsao-${itemType}`;
    const resultadoContainer = document.getElementById(`resultado-previsao-${itemType}-v2`);
    const resultadoContentEl = document.getElementById(`resultado-content-${itemType}`);
    const btn = document.getElementById(`btn-calcular-previsao-${itemType}-v2`);

    // 1. Coletar Inputs
    const diasPrevisaoInput = document.getElementById(`dias-previsao-${itemType}`);
    const margemSegurancaInput = document.getElementById(`margem-seguranca-${itemType}`);
    
    if (!resultadoContainer || !resultadoContentEl || !diasPrevisaoInput || !margemSegurancaInput || !btn) {
        console.error("Elementos DOM essenciais da previsão não encontrados.");
        return;
    }

    const diasPrevisao = parseInt(diasPrevisaoInput.value, 10) || 7;
    const margemSeguranca = parseInt(margemSegurancaInput.value, 10) || 15;
    const modo = modoPrevisao[itemType];

    if (!modo) {
        showAlert(alertId, 'Selecione um modo de previsão (Unidade, Tipo ou Completo) antes de calcular.', 'warning');
        return;
    }

    // Desabilitar botão
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        // 2. Coletar Dados
        const movimentacoes = (itemType === 'agua') ? getAguaMovimentacoes() : getGasMovimentacoes();
        const unidades = getUnidades();
        const movsEntrega = movimentacoes
            .filter(m => m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function')
            .sort((a, b) => a.data.toMillis() - b.data.toMillis());

        let movsFiltradas = [];
        let tituloPrevisao = "";

        // 3. Filtrar Movimentações
        const exclusoes = listaExclusoes[itemType];
        
        if (modo === 'unidade-especifica') {
            const unidadeId = document.getElementById(`select-previsao-unidade-${itemType}-v2`).value;
            if (!unidadeId) {
                showAlert(alertId, 'Selecione uma unidade específica.', 'warning');
                throw new Error("Unidade não selecionada.");
            }
            const unidade = unidades.find(u => u.id === unidadeId);
            tituloPrevisao = `Previsão para: ${unidade.nome}`;
            movsFiltradas = movsEntrega.filter(m => m.unidadeId === unidadeId);
        
        } else if (modo === 'por-tipo') {
            const tipo = document.getElementById(`select-previsao-tipo-${itemType}`).value;
            if (!tipo) {
                showAlert(alertId, 'Selecione um tipo de unidade.', 'warning');
                throw new Error("Tipo não selecionado.");
            }
            tituloPrevisao = `Previsão para Tipo: ${tipo}`;
            const unidadesDoTipo = unidades.filter(u => {
                let uTipo = (u.tipo || "").toUpperCase();
                if (uTipo === "SEMCAS") uTipo = "SEDE";
                return uTipo === tipo && !exclusoes.includes(u.id);
            }).map(u => u.id);
            
            movsFiltradas = movsEntrega.filter(m => unidadesDoTipo.includes(m.unidadeId));

        } else if (modo === 'completo') {
            tituloPrevisao = `Previsão Geral (Todas Unidades)`;
            movsFiltradas = movsEntrega.filter(m => !exclusoes.includes(m.unidadeId));
        }

        if (movsFiltradas.length < 2) {
            showAlert(alertId, 'Dados insuficientes para calcular a previsão. É necessário pelo menos 2 registros de entrega.', 'info');
            throw new Error("Dados insuficientes.");
        }

        // 4. Calcular Média Diária
        const primeiraMov = movsFiltradas[0].data.toMillis();
        const ultimaMov = movsFiltradas[movsFiltradas.length - 1].data.toMillis();
        
        let totalDiasHistorico = (ultimaMov - primeiraMov) / (1000 * 60 * 60 * 24);
        if (totalDiasHistorico < 1) totalDiasHistorico = 1; // Evita divisão por zero se houver 2+ movs no mesmo dia

        const totalConsumido = movsFiltradas.reduce((sum, m) => sum + m.quantidade, 0);
        const mediaDiaria = totalConsumido / totalDiasHistorico;

        if (totalDiasHistorico < 30) {
            showAlert(alertId, `Aviso: O histórico de dados é de apenas ${totalDiasHistorico.toFixed(0)} dias. A previsão pode ser menos precisa.`, 'info');
        }

        // 5. Calcular Previsão
        const previsaoBase = mediaDiaria * diasPrevisao;
        const valorMargem = previsaoBase * (margemSeguranca / 100);
        const previsaoFinal = previsaoBase + valorMargem;

        // 6. Renderizar Resultados
        resultadoContentEl.innerHTML = `
            <h4 class="text-lg font-bold text-white mb-4">${tituloPrevisao}</h4>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                <div class="bg-white/10 p-4 rounded-lg">
                    <span class="block text-sm text-white/80 uppercase">Período Analisado</span>
                    <span class="block text-2xl font-bold">${totalDiasHistorico.toFixed(0)} dias</span>
                </div>
                <div class="bg-white/10 p-4 rounded-lg">
                    <span class="block text-sm text-white/80 uppercase">Total Consumido</span>
                    <span class="block text-2xl font-bold">${totalConsumido} un.</span>
                </div>
            </div>
            <div class="bg-white/20 p-4 rounded-lg mt-4">
                <span class="block text-center text-sm text-white/80 uppercase">Consumo Médio Diário</span>
                <span class="block text-center text-4xl font-bold">${mediaDiaria.toFixed(2)} un./dia</span>
            </div>
            <hr class="border-white/20 my-4">
            <h4 class="text-lg font-bold text-white mb-2">Previsão para ${diasPrevisao} dias:</h4>
            <div class="grid grid-cols-3 gap-2 text-center text-sm">
                <div class="bg-white/10 p-3 rounded-lg">
                    <span class="block text-white/80">Base</span>
                    <span class="block font-bold text-lg">${previsaoBase.toFixed(1)} un.</span>
                </div>
                <div class="bg-white/10 p-3 rounded-lg">
                    <span class="block text-white/80">+ Margem (${margemSeguranca}%)</span>
                    <span class="block font-bold text-lg">${valorMargem.toFixed(1)} un.</span>
                </div>
                <div class="bg-white/90 text-blue-900 p-3 rounded-lg">
                    <span class="block font-bold">Total Recomendado</span>
                    <span class="block font-bold text-xl">${Math.ceil(previsaoFinal)} un.</span>
                </div>
            </div>
        `;
        resultadoContainer.classList.remove('hidden');

        // 7. Renderizar Gráfico
        const chartData = {
            labels: ['Média Diária Histórica', `Previsão para ${diasPrevisao} dias (com margem)`],
            datasets: [{
                label: 'Consumo',
                data: [mediaDiaria, previsaoFinal / diasPrevisao],
                backgroundColor: [
                    'rgba(255, 255, 255, 0.7)',
                    'rgba(191, 219, 254, 1)' 
                ],
                borderColor: [
                    'rgba(255, 255, 255, 1)',
                    'rgba(59, 130, 246, 1)'
                ],
                borderWidth: 1
            }]
        };
        renderGraficoPrevisao(itemType, chartData);

    } catch (error) {
        console.error(`Erro ao calcular previsão para ${itemType}:`, error);
        // Não mostrar alerta se for "Dados insuficientes" ou "Não selecionado"
        if (error.message.includes("insuficientes") || error.message.includes("selecionado")) {
             // O alerta já foi mostrado
        } else {
            showAlert(alertId, `Erro inesperado: ${error.message}`, 'error');
        }
        resultadoContainer.classList.add('hidden');
    } finally {
        // Reabilitar botão
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="calculator"></i> Calcular Previsão';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
            lucide.createIcons();
        }
    }
}

/**
 * Expõe as funções necessárias para o escopo global (window)
 * para que os atributos onclick no HTML possam chamá-las.
 */
export function initPrevisaoListeners() {
    window.selecionarModoPrevisao = selecionarModoPrevisao;
    window.adicionarExclusao = adicionarExclusao;
    window.removerExclusao = removerExclusao;
    window.calcularPrevisaoInteligente = calcularPrevisaoInteligente;

    // Adiciona listeners de evento nos containers de exclusão para lidar com cliques nos botões
    // de remoção (delegação de evento)
    const listasExclusao = document.querySelectorAll('[id^="lista-exclusoes-"]');
    listasExclusao.forEach(listaEl => {
        listaEl.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (button && button.getAttribute('onclick')) {
                // A função onclick já está definida, não precisamos fazer nada
                // Se não estivesse, faríamos a delegação aqui.
            }
        });
    });

    console.log("Listeners de Previsão (globais) inicializados.");
}
