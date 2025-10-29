// js/modules/previsao.js
// Este novo arquivo contém toda a lógica para a funcionalidade de Previsão Inteligente.
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getAguaMovimentacoes,
    getGasMovimentacoes,
    getUnidades,
    modoPrevisao,
    listaExclusoes,
    graficoPrevisao
    // Removido tipoSelecionadoPrevisao se não for usado globalmente
} from "../utils/cache.js";
import { showAlert, DOM_ELEMENTS } from "../utils/dom-helpers.js";
import { formatTimestamp, formatTimestampComTempo } from "../utils/formatters.js";

// Variável local para a instância do Chart.js de Análise de Consumo
let graficoAnaliseConsumo = { agua: null, gas: null };

// =========================================================================
// FUNÇÕES DE POPULAÇÃO E CONTROLE DE UI
// =========================================================================

/**
 * Normaliza o tipo de unidade para uso nos gráficos (ex: SEMCAS -> SEDE, Acolher e Amar -> ABRIGO).
 * CORREÇÃO: Usado para resolver o problema de agrupamento incorreto no Ponto 2.
 * @param {string} tipo Tipo da unidade.
 * @returns {string} Tipo normalizado.
 */
function normalizeUnidadeType(tipo) {
    let tipoNormalizado = (tipo || 'OUTROS').toUpperCase();
    if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
    // Adiciona uma regra específica para corrigir o tipo mencionado
    if (tipoNormalizado === 'ABRIGO' || tipoNormalizado === 'ACOLHER E AMAR') tipoNormalizado = 'ABRIGO';
    return tipoNormalizado;
}

/**
 * Configura os controles de seleção de unidades para a análise de consumo.
 * @param {string} itemType 'agua' ou 'gas'.
 */
export function setupAnaliseUnidadeControls(itemType) {
    const unidades = getUnidades();
    const service = itemType === 'agua' ? 'atendeAgua' : 'atendeGas';
    
    // Filtra unidades que atendem ao serviço
    const unidadesFiltradas = unidades.filter(u => u[service] ?? true);

    const selectTipo = DOM_ELEMENTS[`analiseAgrupamentoTipo${itemType === 'agua' ? 'Agua' : 'Gas'}`];
    const selectUnidade = DOM_ELEMENTS[`analiseAgrupamentoUnidade${itemType === 'agua' ? 'Agua' : 'Gas'}`];
    
    if (!selectTipo || !selectUnidade) return;

    // 1. Populando Agrupamento por Tipo
    const uniqueTypes = [...new Set(unidadesFiltradas.map(u => normalizeUnidadeType(u.tipo)))].sort();
    let tipoHtml = '<option value="todas">Todos os Tipos</option>';
    uniqueTypes.forEach(tipo => {
        tipoHtml += `<option value="${tipo}">${tipo}</option>`;
    });
    selectTipo.innerHTML = tipoHtml;

    // 2. Populando Agrupamento por Unidade Específica
    let unidadeHtml = '<option value="todas">Todas as Unidades</option>';
    
    const grupos = unidadesFiltradas.reduce((acc, unidade) => {
        const tipo = normalizeUnidadeType(unidade.tipo);
        if (!acc[tipo]) acc[tipo] = [];
        acc[tipo].push(unidade);
        return acc;
    }, {});

    Object.keys(grupos).sort().forEach(tipo => {
        unidadeHtml += `<optgroup label="${tipo}">`;
        grupos[tipo]
            .sort((a, b) => a.nome.localeCompare(b.nome))
            .forEach(unidade => {
                // Usar o ID da unidade como valor
                unidadeHtml += `<option value="${unidade.id}">${unidade.nome} (${tipo})</option>`;
            });
        unidadeHtml += `</optgroup>`;
    });
    selectUnidade.innerHTML = unidadeHtml;

    // 3. Adicionar Listener para o Agrupamento Principal
    const selectModoAgrupamento = DOM_ELEMENTS[`selectModoAgrupamento${itemType === 'agua' ? 'Agua' : 'Gas'}`];
    const tipoContainer = DOM_ELEMENTS[`analiseAgrupamentoTipoContainer${itemType === 'agua' ? 'Agua' : 'Gas'}`];
    const unidadeContainer = DOM_ELEMENTS[`analiseAgrupamentoUnidadeContainer${itemType === 'agua' ? 'Agua' : 'Gas'}`];

    if (selectModoAgrupamento && tipoContainer && unidadeContainer) {
        // Remove listeners antigos para evitar duplicação
        const newSelectModo = selectModoAgrupamento.cloneNode(true);
        selectModoAgrupamento.parentNode.replaceChild(newSelectModo, selectModoAgrupamento);
        
        newSelectModo.addEventListener('change', (e) => {
            const modo = e.target.value;
            // CORREÇÃO: Alterna a visibilidade dos selects de filtro (Tipo vs Unidade)
            tipoContainer.classList.toggle('hidden', modo !== 'tipo');
            unidadeContainer.classList.toggle('hidden', modo !== 'unidade');
        });
        
        // Garante que a UI comece no estado correto
        const initialMode = newSelectModo.value;
        tipoContainer.classList.toggle('hidden', initialMode !== 'tipo');
        unidadeContainer.classList.toggle('hidden', initialMode !== 'unidade');
    }
}


// =========================================================================
// PONTO 2: FUNÇÕES DE ANÁLISE DE CONSUMO POR PERÍODO
// =========================================================================

/**
 * Agrupa as movimentações de entrega (consumo) por Unidade ou Tipo de Unidade em períodos (Diário, Semanal, Mensal).
 * @param {string} itemType 'agua' ou 'gas'.
 */
function analisarConsumoPorPeriodo(itemType) {
    const alertId = `alert-analise-consumo-${itemType}`;
    const unidades = getUnidades();
    
    // 1. Coletar os parâmetros (CORRIGIDO)
    const selectModoAgrupamento = DOM_ELEMENTS[`selectModoAgrupamento${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; // 'tipo' ou 'unidade'
    const granularidade = DOM_ELEMENTS[`analiseGranularidade${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; // 'diario', 'semanal', 'mensal'
    
    // Agrupamento principal
    const agruparPor = selectModoAgrupamento; // 'tipo' ou 'unidade'
    
    let filtroAgrupamento = null; 
    let nomeFiltro = "Todas as Unidades";

    if (agruparPor === 'tipo') {
        filtroAgrupamento = DOM_ELEMENTS[`analiseAgrupamentoTipo${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; // Ex: 'CRAS', 'todas'
        nomeFiltro = filtroAgrupamento === 'todas' ? 'Todos os Tipos' : filtroAgrupamento;
    } else if (agruparPor === 'unidade') {
        filtroAgrupamento = DOM_ELEMENTS[`analiseAgrupamentoUnidade${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; // Ex: unidadeId, 'todas'
        if (filtroAgrupamento !== 'todas') {
             const unidade = unidades.find(u => u.id === filtroAgrupamento);
             nomeFiltro = unidade ? unidade.nome : 'Unidade Desconhecida';
        }
    }
    
    // Coleta as movimentações (apenas entregas, que representam consumo)
    const movimentacoes = (itemType === 'agua' ? getAguaMovimentacoes() : getGasMovimentacoes());
    let movsEntrega = movimentacoes
        .filter(m => m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function')
        .sort((a, b) => a.data.toMillis() - b.data.toMillis());
        
    // 2. Mapeamento de Unidades e Filtragem de Movimentações
    const unidadeMap = new Map(unidades.map(u => [u.id, { 
        nome: u.nome, 
        tipo: normalizeUnidadeType(u.tipo) // Normaliza SEMCAS para SEDE, etc.
    }]));
    
    // Filtrar as movimentações antes de calcular o consumo
    if (filtroAgrupamento !== 'todas') {
        if (agruparPor === 'tipo') {
            const unidadesParaFiltrar = unidades.filter(u => normalizeUnidadeType(u.tipo) === filtroAgrupamento).map(u => u.id);
            movsEntrega = movsEntrega.filter(m => unidadesParaFiltrar.includes(m.unidadeId));
        } else if (agruparPor === 'unidade') {
            movsEntrega = movsEntrega.filter(m => m.unidadeId === filtroAgrupamento);
        }
    }


    if (movsEntrega.length === 0) {
        showAlert(alertId, 'Nenhum dado de consumo (entrega) encontrado para o filtro selecionado.', 'info');
        if (graficoAnaliseConsumo[itemType]) graficoAnaliseConsumo[itemType].destroy();
        document.getElementById(`analise-resultado-container-${itemType}`).classList.add('hidden');
        return;
    }

    const { dataInicial, dataFinal, totalDias } = getPeriodoAnalise(movsEntrega);

    // 3. Estrutura para acúmulo dos dados
    // Key: Label do Período (ex: 2024-W40, 2024-10, 2024-10-28)
    // Value: Map<string, number> (Key: Nome da Unidade/Tipo, Value: Consumo Total)
    const consumoPorPeriodo = new Map();
    
    // 4. Processamento dos dados
    movsEntrega.forEach(mov => {
        const data = mov.data.toDate();
        const unidadeInfo = unidadeMap.get(mov.unidadeId);
        
        if (!unidadeInfo) return; // Ignora se a unidade não for encontrada
        
        // Define a chave de agrupamento para o gráfico (série de dados)
        let keyGroup;
        
        // Se o agrupamento principal for por TIPO, a série é o TIPO.
        // Se o agrupamento principal for por UNIDADE, a série é a UNIDADE.
        if (agruparPor === 'tipo') {
            keyGroup = unidadeInfo.tipo; 
        } else { // 'unidade'
            keyGroup = unidadeInfo.nome;
        }

        const periodKey = getPeriodKey(data, granularidade);

        if (!consumoPorPeriodo.has(periodKey)) {
            consumoPorPeriodo.set(periodKey, new Map());
        }
        
        const periodData = consumoPorPeriodo.get(periodKey);
        const consumoAtual = periodData.get(keyGroup) || 0;
        periodData.set(keyGroup, consumoAtual + mov.quantidade);
    });

    // 5. Preparação dos dados para o Chart.js
    const { chartLabels, chartDataSets } = formatDataForChart(consumoPorPeriodo, granularidade);

    // 6. Renderização
    renderGraficoAnalise(itemType, chartLabels, chartDataSets, granularidade, agruparPor, nomeFiltro);
    document.getElementById(`analise-resultado-container-${itemType}`).classList.remove('hidden');
    
    // Renderiza o resumo textual e o ranking
    renderAnaliseTextual(itemType, movsEntrega, unidades, dataInicial, dataFinal);

    showAlert(alertId, `Análise concluída. Período: ${formatTimestamp(dataInicial)} a ${formatTimestamp(dataFinal)} (${totalDias} dias).`, 'success', 5000);
}

/**
 * Obtém as datas inicial e final do período analisado.
 * @param {Array<Object>} movsEntrega Movimentações de entrega.
 * @returns {Object} { dataInicial, dataFinal, totalDias }.
 */
function getPeriodoAnalise(movsEntrega) {
    if (movsEntrega.length === 0) return { dataInicial: null, dataFinal: null, totalDias: 0 };
    
    // Pega a data da movimentação mais antiga (primeira)
    const primeiraMovDate = movsEntrega[0].data.toDate();
    // Pega a data da movimentação mais recente (última)
    const ultimaMovDate = movsEntrega[movsEntrega.length - 1].data.toDate();

    // Cria Timestamps para exibição
    const dataInicial = Timestamp.fromDate(primeiraMovDate);
    const dataFinal = Timestamp.fromDate(ultimaMovDate);

    // Normaliza para o início do dia para cálculo preciso dos dias decorridos
    const inicioPrimeira = new Date(primeiraMovDate.getFullYear(), primeiraMovDate.getMonth(), primeiraMovDate.getDate());
    const fimUltima = new Date(ultimaMovDate.getFullYear(), ultimaMovDate.getMonth(), ultimaMovDate.getDate());
    
    // Cálculo dos dias: (diferença em ms / ms por dia) + 1 para incluir o dia final
    const diffTime = Math.abs(fimUltima.getTime() - inicioPrimeira.getTime());
    const totalDaysMs = 1000 * 60 * 60 * 24;
    const totalDias = Math.ceil(diffTime / totalDaysMs) + 1;

    return { dataInicial, dataFinal, totalDias };
}


/**
 * Determina a chave de agrupamento temporal (Diário, Semanal, Mensal).
 * @param {Date} date Objeto Date da movimentação.
 * @param {string} agrupamento Tipo de agrupamento ('diario', 'semanal', 'mensal').
 * @returns {string} Chave formatada.
 */
function getPeriodKey(date, agrupamento) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    if (agrupamento === 'mensal') {
        return `${year}-${month}`; // Ex: 2024-10
    }
    
    if (agrupamento === 'diario') {
        return `${year}-${month}-${day}`; // Ex: 2024-10-28
    }

    // Semanal: Calcula o número da semana (ISO 8601 simplificado)
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    // Ajusta para ser a quinta-feira da semana para cálculo ISO
    d.setDate(d.getDate() + 4 - (d.getDay() || 7)); 
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`; // Ex: 2024-W44
}


/**
 * Formata os dados acumulados para a estrutura do Chart.js.
 * @param {Map<string, Map<string, number>>} consumoPorPeriodo Dados acumulados.
 * @param {string} agrupamento Tipo de agrupamento ('diario', 'semanal', 'mensal').
 * @returns {Object} { chartLabels, chartDataSets }.
 */
function formatDataForChart(consumoPorPeriodo, agrupamento) {
    // Ordena as chaves de período
    const sortedPeriodKeys = Array.from(consumoPorPeriodo.keys()).sort();
    
    // Obtém todas as categorias (unidades ou tipos) únicas
    const allCategoriesSet = new Set();
    consumoPorPeriodo.forEach(periodData => {
        periodData.forEach((_, category) => allCategoriesSet.add(category));
    });
    const allCategories = Array.from(allCategoriesSet).sort();

    // Mapeamento de cor fixa para consistência
    // Usando cores mais profissionais e consistentes
    const colors = [
        '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', 
        '#64748b', '#06b6d4', '#e879f9', '#4c4c4c', '#57534e'
    ]; 
    const colorMap = new Map();
    allCategories.forEach((cat, index) => {
        colorMap.set(cat, colors[index % colors.length]);
    });
    
    // Cria os rótulos de período formatados (Labels do Eixo X)
    const chartLabels = sortedPeriodKeys.map(key => {
        if (agrupamento === 'mensal') {
            const [year, month] = key.split('-');
            return `${month}/${year}`;
        }
        if (agrupamento === 'diario') {
            const [year, month, day] = key.split('-');
            return `${day}/${month}`;
        }
        // Semanal
        const [year, week] = key.split('-W');
        // Garante que o ano seja o do período
        return `Sem. ${parseInt(week)} (${year})`; 
    });

    // Cria os conjuntos de dados (DataSets)
    const chartDataSets = allCategories.map(category => {
        const data = sortedPeriodKeys.map(periodKey => {
            const periodData = consumoPorPeriodo.get(periodKey);
            return periodData.get(category) || 0; // Se não houver consumo, é zero
        });

        // Adiciona um pouco de transparência para o gráfico de barras empilhadas
        const baseColor = colorMap.get(category);
        const backgroundColor = baseColor + 'c0'; // Adiciona 75% de opacidade

        return {
            label: category,
            data: data,
            backgroundColor: backgroundColor,
            // Linha: 'bar' e 'line' misturam se borderwidth não for zero
            type: 'bar',
        };
    });
    
    return { chartLabels, chartDataSets };
}

/**
 * Renderiza o gráfico de barras da Análise de Consumo.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {Array<string>} labels Rótulos do eixo X.
 * @param {Array<Object>} datasets Dados do gráfico.
 * @param {string} granularidade Tipo de agrupamento temporal.
 * @param {string} agruparPor Agrupado por 'unidade' ou 'tipo'.
 * @param {string} nomeFiltro Nome do filtro (Tipo/Unidade).
 */
function renderGraficoAnalise(itemType, labels, datasets, granularidade, agruparPor, nomeFiltro) {
    const canvasId = `grafico-analise-consumo-${itemType}`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    
    // Destrói instância anterior
    if (graficoAnaliseConsumo[itemType]) {
        graficoAnaliseConsumo[itemType].destroy();
    }

    const itemLabel = itemType === 'agua' ? 'Galões' : 'Botijões';
    const agrupadoLabel = agruparPor === 'unidade' ? 'Unidade' : 'Tipo de Unidade';
    // CORRIGIDO: Inclui o filtro selecionado no título
    const titleText = `Consumo por ${granularidade} - Agrupado por ${agrupadoLabel} (${nomeFiltro})`;

    graficoAnaliseConsumo[itemType] = new Chart(ctx, {
        type: 'bar', // Tipo padrão
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    stacked: true,
                    title: { display: true, text: granularidade.toUpperCase() }
                },
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
                    text: titleText
                },
                legend: {
                    position: 'bottom',
                },
                 tooltip: {
                    callbacks: {
                        // Garante que o tooltip mostre valores inteiros
                        label: function(context) {
                            let label = context.dataset.label || '';
                            if (label) {
                                label += ': ';
                            }
                            if (context.parsed.y !== null) {
                                label += context.parsed.y.toFixed(0) + ' un.';
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

/**
 * Renderiza o resumo textual e o ranking de consumo.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {Array<Object>} movsEntrega Movimentações filtradas.
 * @param {Array<Object>} unidades Lista de unidades.
 * @param {Timestamp} dataInicial Data inicial do período.
 * @param {Timestamp} dataFinal Data final do período.
 */
function renderAnaliseTextual(itemType, movsEntrega, unidades, dataInicial, dataFinal) {
    const relatorioEl = document.getElementById(`analise-relatorio-textual-${itemType}`);
    const rankingEl = document.getElementById(`analise-ranking-${itemType}`);

    if (!relatorioEl || !rankingEl) return;

    // --- Cálculo de Consumo por Unidade (para Ranking) ---
    const consumoPorUnidade = movsEntrega.reduce((acc, mov) => {
        // CORREÇÃO: Usa normalizeUnidadeType para garantir o agrupamento correto dos tipos
        const unidadeInfo = unidades.find(u => u.id === mov.unidadeId);
        if (unidadeInfo) {
            const nome = unidadeInfo.nome;
            acc[nome] = (acc[nome] || 0) + mov.quantidade;
        }
        return acc;
    }, {});

    const ranking = Object.entries(consumoPorUnidade)
        .map(([nome, consumo]) => ({ nome, consumo }))
        .sort((a, b) => b.consumo - a.consumo);

    const totalConsumo = ranking.reduce((sum, item) => sum + item.consumo, 0);
    const mediaConsumo = totalConsumo / (ranking.length > 0 ? ranking.length : 1);
    const itemLabel = itemType === 'agua' ? 'galão' : 'botijão';
    const itemLabelPlural = itemLabel + (itemType === 'agua' ? 'es' : 'ões'); // Ajuste simples para plural

    // --- Renderiza Ranking ---
    rankingEl.innerHTML = '';
    if (ranking.length > 0) {
        let rankingHtml = '';
        ranking.slice(0, 5).forEach((item, index) => {
            rankingHtml += `
                <div class="ranking-item">
                    <span class="rank-number">${index + 1}º</span>
                    <span class="rank-name">${item.nome}</span>
                    <span class="rank-consumption text-red-600">${item.consumo} un.</span>
                </div>
            `;
        });
        if (ranking.length > 5) {
             rankingHtml += `<p class="text-xs text-gray-500 mt-2 text-center">Mais ${ranking.length - 5} unidades...</p>`;
        }
        rankingEl.innerHTML = rankingHtml;
    } else {
         rankingEl.innerHTML = `<p class="text-gray-500 italic text-sm">Nenhum consumo registrado.</p>`;
    }


    // --- Renderiza Relatório Textual ---
    let relatorioText = `
        <p>A análise abrange o período de **${formatTimestamp(dataInicial)}** a **${formatTimestamp(dataFinal)}**, totalizando **${getPeriodoAnalise(movsEntrega).totalDias} dias** de histórico de entregas.</p>
        <p>Neste período, o **consumo total** de ${itemLabelPlural} foi de **${totalConsumo} unidades**.</p>
        <p>A média de consumo por unidade considerada é de **${mediaConsumo.toFixed(1)} unidades** de ${itemLabel} (seja ${itemLabel} cheio para entrega ou vazio para troca).</p>
    `;

    if (ranking.length > 0) {
        relatorioText += `<p>O maior consumidor foi a unidade **${ranking[0].nome}**, com **${ranking[0].consumo} unidades** de ${itemLabelPlural} (ou ${((ranking[0].consumo / totalConsumo) * 100).toFixed(1)}% do total).</p>`;
        
        const menorConsumo = ranking[ranking.length - 1];
        relatorioText += `<p>O menor consumidor foi a unidade **${menorConsumo.nome}**, com **${menorConsumo.consumo} unidades**.</p>`;
    }

    relatorioEl.innerHTML = relatorioText;
}


// =========================================================================
// FUNÇÕES DE PREVISÃO INTELIGENTE (EXISTENTES)
// =========================================================================

/**
 * Seleciona o modo de previsão (unidade, tipo, completo) e atualiza a UI.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function selecionarModoPrevisao(itemType, modo) {
    modoPrevisao[itemType] = modo;
    console.log(`[Previsão ${itemType}] Modo selecionado: ${modo}`);

    const configEl = document.getElementById(`config-previsao-${itemType}`);
    const unidadeContainer = document.getElementById(`select-unidade-container-${itemType}`);
    const tipoContainer = document.getElementById(`select-tipo-container-${itemType}`);
    const exclusaoContainer = document.getElementById(`exclusao-container-${itemType}`);

    // Resetar UI
    if (configEl) configEl.classList.remove('hidden');
    if (unidadeContainer) unidadeContainer.classList.add('hidden');
    if (tipoContainer) tipoContainer.classList.add('hidden');
    // A exclusão agora é sempre visível se não for unidade específica
    if (exclusaoContainer) exclusaoContainer.classList.toggle('hidden', modo === 'unidade-especifica');

    // Resetar cards
    document.querySelectorAll(`#subview-analise-previsao-${itemType} .previsao-option-card`).forEach(card => {
        card.classList.remove('selected'); // Usando a classe 'selected' agora
    });
    // Marcar card selecionado
    const selectedCard = document.querySelector(`#subview-analise-previsao-${itemType} .previsao-option-card[data-modo="${modo}"]`);
    if (selectedCard) selectedCard.classList.add('selected');

    // Configurar UI para o modo
    if (modo === 'unidade-especifica') {
        if (unidadeContainer) unidadeContainer.classList.remove('hidden');
    } else if (modo === 'por-tipo') {
        if (tipoContainer) tipoContainer.classList.remove('hidden');
    }
    // Não precisa de else if (modo === 'completo'), pois só a exclusão fica visível (já tratado)

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

    const unidades = getUnidades(); // Pega a lista atualizada de unidades

    console.log(`[Previsão ${itemType}] Renderizando lista de exclusões:`, listaExclusoes[itemType]);

    if (listaExclusoes[itemType].length === 0) {
        listaEl.innerHTML = ''; // Limpa se vazio
        return;
    }

    let html = '';
    listaExclusoes[itemType].forEach(unidadeId => {
        const unidade = unidades.find(u => u.id === unidadeId);
        const nome = unidade ? unidade.nome : `ID: ${unidadeId.substring(0, 6)}...`;
        html += `
            <span class="exclusao-item">
                ${nome}
                <!-- Botão com data-attributes para event listener -->
                <button type="button" class="btn-remove-exclusao" data-item-type="${itemType}" data-unidade-id="${unidadeId}" title="Remover">&times;</button>
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
    const alertId = `alertas-previsao-${itemType}`; // ID do alerta dentro da subview de previsão
    if (!selectEl) {
         showAlert(alertId, 'Erro interno: select de exclusão não encontrado.', 'error');
         return;
    }

    const unidadeId = selectEl.value;
    console.log(`[Previsão ${itemType}] Tentando adicionar exclusão: ${unidadeId}`);
    if (!unidadeId) {
        showAlert(alertId, 'Selecione uma unidade para adicionar à lista de exclusão.', 'warning');
        return;
    }

    if (!listaExclusoes[itemType].includes(unidadeId)) {
        listaExclusoes[itemType].push(unidadeId);
        renderListaExclusoes(itemType);
        selectEl.value = ''; // Limpa o select após adicionar
    } else {
        showAlert(alertId, 'Essa unidade já está na lista de exclusão.', 'info');
    }
}

/**
 * Remove uma unidade da lista de exclusão.
 * @param {string} itemType 'agua' ou 'gas'.
 * @param {string} unidadeId ID da unidade a remover.
 */
function removerExclusao(itemType, unidadeId) {
    console.log(`[Previsão ${itemType}] Removendo exclusão: ${unidadeId}`);
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
    if (!ctx) {
        console.warn(`Canvas com ID "${canvasId}" não encontrado.`);
        return;
    }

     console.log(`[Previsão ${itemType}] Renderizando gráfico.`);

    // Destruir gráfico antigo, se existir
    if (graficoPrevisao[itemType]) {
        graficoPrevisao[itemType].destroy();
        graficoPrevisao[itemType] = null;
    }

    // Criar novo gráfico
    try {
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
                            text: `Consumo (Unidades de ${itemType === 'agua' ? 'Água' : 'Gás'})`
                        },
                         ticks: { // Garante ticks inteiros se possível
                            precision: 0
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
                                let label = context.dataset.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed.y !== null) {
                                    // Formata para 2 casas decimais, mas remove .00 se for inteiro
                                    label += parseFloat(context.parsed.y.toFixed(2));
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    } catch (error) {
        console.error("Erro ao criar o gráfico:", error);
        showAlert(`alertas-previsao-${itemType}`, 'Erro ao renderizar o gráfico.', 'error');
    }
}


/**
 * Função principal que calcula a previsão inteligente.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function calcularPrevisaoInteligente(itemType) {
    console.log(`[Previsão ${itemType}] Iniciando cálculo...`);

    const alertId = `alertas-previsao-${itemType}`;
    const resultadoContainer = document.getElementById(`resultado-previsao-${itemType}-v2`);
    const resultadoContentEl = document.getElementById(`resultado-content-${itemType}`);
    const btn = document.getElementById(`btn-calcular-previsao-${itemType}-v2`);
    const alertEl = document.getElementById(alertId); 

    // Limpa alertas anteriores
    if (alertEl) {
        // Remove alertas anteriores de cálculo (mas mantém o de análise de consumo se houver)
        alertEl.querySelectorAll('.alert-info, .alert-warning, .alert-error').forEach(el => el.remove()); 
        alertEl.style.display = 'none';
    }


    // 1. Coletar Inputs
    const diasPrevisaoInput = document.getElementById(`dias-previsao-${itemType}`);
    const margemSegurancaInput = document.getElementById(`margem-seguranca-${itemType}`);

    if (!resultadoContainer || !resultadoContentEl || !diasPrevisaoInput || !margemSegurancaInput || !btn) {
        console.error("Elementos DOM essenciais da previsão não encontrados.");
        showAlert(alertId, 'Erro interno: Elementos da página não encontrados. Recarregue.', 'error');
        return;
    }

    const diasPrevisao = parseInt(diasPrevisaoInput.value, 10);
    const margemSeguranca = parseInt(margemSegurancaInput.value, 10);
    const modo = modoPrevisao[itemType];

    // Validações básicas
     if (isNaN(diasPrevisao) || diasPrevisao <= 0) {
        showAlert(alertId, 'Por favor, insira um número válido de dias para a previsão (maior que zero).', 'warning');
        return;
    }
     if (isNaN(margemSeguranca) || margemSeguranca < 0 || margemSeguranca > 100) {
        showAlert(alertId, 'Por favor, insira uma margem de segurança válida (0 a 100%).', 'warning');
        return;
    }

    if (!modo) {
        showAlert(alertId, 'Selecione um modo de previsão (Unidade, Tipo ou Completo) antes de calcular.', 'warning');
        return;
    }
    console.log(`[Previsão ${itemType}] Inputs coletados: Dias=${diasPrevisao}, Margem=${margemSeguranca}, Modo=${modo}`);


    // Desabilitar botão
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    // Esconde resultado antigo enquanto calcula
    resultadoContainer.classList.add('hidden');

    // Usando setTimeout para dar tempo da UI atualizar (spinner)
    setTimeout(() => {
        try {
            console.log(`[Previsão ${itemType}] Coletando e filtrando dados...`);
            // 2. Coletar Dados
            const movimentacoes = (itemType === 'agua') ? getAguaMovimentacoes() : getGasMovimentacoes();
            const unidades = getUnidades();

            // Filtra apenas entregas VÁLIDAS (com data) e ordena
            const movsEntrega = movimentacoes
                .filter(m => m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function')
                .sort((a, b) => a.data.toMillis() - b.data.toMillis());

            let movsFiltradas = [];
            let tituloPrevisao = "";
            let unidadesConsideradas = []; 

            // 3. Filtrar Movimentações
            const exclusoes = listaExclusoes[itemType];

            if (modo === 'unidade-especifica') {
                const unidadeId = document.getElementById(`select-previsao-unidade-${itemType}-v2`)?.value; 
                if (!unidadeId) {
                    showAlert(alertId, 'Selecione uma unidade específica.', 'warning');
                    throw new Error("Unidade não selecionada.");
                }
                const unidade = unidades.find(u => u.id === unidadeId);
                if (!unidade) { 
                     showAlert(alertId, `Erro: Unidade com ID ${unidadeId} não encontrada.`, 'error');
                     throw new Error("Unidade não encontrada.");
                }
                tituloPrevisao = `Previsão para: ${unidade.nome}`;
                movsFiltradas = movsEntrega.filter(m => m.unidadeId === unidadeId);
                unidadesConsideradas.push(unidade.nome);

            } else if (modo === 'por-tipo') {
                const tipo = document.getElementById(`select-previsao-tipo-${itemType}`)?.value; 
                if (!tipo) {
                    showAlert(alertId, 'Selecione um tipo de unidade.', 'warning');
                    throw new Error("Tipo não selecionado.");
                }
                tituloPrevisao = `Previsão para Tipo: ${tipo}`;
                const unidadesDoTipo = unidades.filter(u => {
                    let uTipo = normalizeUnidadeType(u.tipo);
                    return uTipo === tipo && !exclusoes.includes(u.id);
                });

                const idsUnidadesDoTipo = unidadesDoTipo.map(u => u.id);
                unidadesConsideradas = unidadesDoTipo.map(u => u.nome).sort();
                movsFiltradas = movsEntrega.filter(m => idsUnidadesDoTipo.includes(m.unidadeId));

            } else if (modo === 'completo') {
                tituloPrevisao = `Previsão Geral (Todas Unidades)`;
                const unidadesConsideradasObjs = unidades.filter(u => !exclusoes.includes(u.id));
                unidadesConsideradas = unidadesConsideradasObjs.map(u => u.nome).sort();
                const idsUnidadesConsideradas = unidadesConsideradasObjs.map(u => u.id);
                movsFiltradas = movsEntrega.filter(m => idsUnidadesConsideradas.includes(m.unidadeId));
            }
             console.log(`[Previsão ${itemType}] Modo: ${modo}. Movimentações filtradas: ${movsFiltradas.length}`);


            // Validação de dados suficientes APÓS o filtro
            if (movsFiltradas.length < 2) {
                 showAlert(alertId, `Dados insuficientes para calcular a previsão (${tituloPrevisao}). É necessário pelo menos 2 registros de entrega válidos no período.`, 'info');
                throw new Error("Dados insuficientes.");
            }

            console.log(`[Previsão ${itemType}] Calculando média diária...`);
            // 4. Calcular Média Diária
            const primeiraMov = movsFiltradas[0].data.toMillis();
            const ultimaMov = movsFiltradas[movsFiltradas.length - 1].data.toMillis();

            // Usa a função getPeriodoAnalise para calcular os dias corretamente
            const totalDiasHistorico = getPeriodoAnalise(movsFiltradas).totalDias;
            // Se o período for 1 dia, a média é o consumo total
            const diasParaCalculo = totalDiasHistorico > 1 ? totalDiasHistorico : 1; 

            const totalConsumido = movsFiltradas.reduce((sum, m) => sum + m.quantidade, 0);
            const mediaDiaria = totalConsumido / diasParaCalculo;
             console.log(`[Previsão ${itemType}] Média diária calculada: ${mediaDiaria}`);


            if (totalDiasHistorico < 30) {
                 // Usa appendChild para adicionar múltiplos alertas se necessário
                 const warningEl = document.createElement('div');
                 warningEl.className = 'alert alert-info mt-2'; // Reutiliza estilo de alerta
                 warningEl.textContent = `Aviso: O histórico de dados considerado é de apenas ${totalDiasHistorico.toFixed(0)} dias (${movsFiltradas.length} entregas). A previsão pode ser menos precisa.`;
                 if (alertEl) {
                     alertEl.appendChild(warningEl);
                     alertEl.style.display = 'block';
                 }
            }

            console.log(`[Previsão ${itemType}] Calculando previsão final...`);
            // 5. Calcular Previsão
            const previsaoBase = mediaDiaria * diasPrevisao;
            const valorMargem = previsaoBase * (margemSeguranca / 100);
            const previsaoFinal = previsaoBase + valorMargem;
             console.log(`[Previsão ${itemType}] Previsão final: ${previsaoFinal}`);


            // 6. Renderizar Resultados
            const unidadesExcluidasNomes = exclusoes
                .map(id => unidades.find(u => u.id === id)?.nome || `ID:${id.substring(0,4)}...`)
                .filter(Boolean) 
                .sort();

            resultadoContentEl.innerHTML = `
                <h4 class="text-lg font-bold text-white mb-4">${tituloPrevisao}</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                    <div class="bg-white/10 p-4 rounded-lg">
                        <span class="block text-sm text-white/80 uppercase">Período Analisado</span>
                        <span class="block text-2xl font-bold">${totalDiasHistorico.toFixed(0)} dias</span>
                        <span class="block text-xs text-white/60">(${movsFiltradas.length} entregas)</span>
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
                ${ (modo === 'por-tipo' || modo === 'completo') ? `
                <details class="mt-4 text-xs text-white/70">
                    <summary class="cursor-pointer hover:text-white">Unidades consideradas (${unidadesConsideradas.length})</summary>
                    <p class="mt-1 bg-black/20 p-2 rounded">${unidadesConsideradas.join(', ')}</p>
                </details>
                ` : ''}
                ${ exclusoes.length > 0 ? `
                <details class="mt-2 text-xs text-white/70">
                     <summary class="cursor-pointer hover:text-white">Unidades excluídas (${unidadesExcluidasNomes.length})</summary>
                     <p class="mt-1 bg-black/20 p-2 rounded">${unidadesExcluidasNomes.join(', ')}</p>
                 </details>
                ` : ''}
            `;
            resultadoContainer.classList.remove('hidden');

            console.log(`[Previsão ${itemType}] Preparando dados do gráfico...`);
            // 7. Renderizar Gráfico
            const chartData = {
                // Usa Math.ceil no valor previsto para o gráfico ficar mais claro
                labels: ['Média Diária (Histórico)', `Previsão Diária (Próximos ${diasPrevisao} dias)`],
                datasets: [{
                    label: `Consumo Diário (${itemType === 'agua' ? 'Água' : 'Gás'})`,
                    data: [mediaDiaria, Math.ceil(previsaoFinal) / diasPrevisao], // Média prevista
                    backgroundColor: [
                        'rgba(255, 255, 255, 0.6)', // Branco semi-transparente para histórico
                        'rgba(191, 219, 254, 0.8)'  // Azul claro para previsão
                    ],
                    borderColor: [
                        'rgba(229, 231, 235, 1)', // Cinza claro
                        'rgba(59, 130, 246, 1)'   // Azul
                    ],
                    borderWidth: 1,
                    type: 'bar', // Força o tipo para garantir a consistência
                }] 
            };
            renderGraficoPrevisao(itemType, chartData);
             console.log(`[Previsão ${itemType}] Cálculo concluído com sucesso.`);


        } catch (error) {
             console.error(`[Previsão ${itemType}] Erro durante o cálculo:`, error);
            // Mostrar alerta apenas se não for um erro esperado (já tratado com showAlert antes)
            if (!error.message.includes("insuficientes") && !error.message.includes("selecionad") && !error.message.includes("encontrada")) {
                 showAlert(alertId, `Erro inesperado durante o cálculo: ${error.message}`, 'error');
            }
            resultadoContainer.classList.add('hidden'); // Esconde resultados se erro
            // Destruir gráfico se existir
            if (graficoPrevisao[itemType]) {
                graficoPrevisao[itemType].destroy();
                graficoPrevisao[itemType] = null;
            }
        } finally {
            // Reabilitar botão
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="calculator"></i> Calcular Previsão';
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                lucide.createIcons();
            }
            console.log(`[Previsão ${itemType}] Botão reabilitado.`);
        }
    }, 50); // Pequeno delay para UI
}


/**
 * Adiciona os event listeners corretos para a UI de previsão e Análise de Consumo.
 */
export function initPrevisaoListeners() {

    // --- Listeners para Análise de Consumo (NOVO PONTO 2) ---
    DOM_ELEMENTS.btnAnalisarConsumoAgua?.addEventListener('click', () => analisarConsumoPorPeriodo('agua'));
    DOM_ELEMENTS.btnAnalisarConsumoGas?.addEventListener('click', () => analisarConsumoPorPeriodo('gas'));
    
    // --- Listeners para ÁGUA (Previsão) ---
    const containerAgua = document.getElementById('previsao-modo-container-agua');
    if (containerAgua) {
        containerAgua.addEventListener('click', (e) => {
            const card = e.target.closest('.previsao-option-card[data-modo]');
            if (card) {
                selecionarModoPrevisao('agua', card.dataset.modo);
            }
        });
    }

    const btnAddExclusaoAgua = document.getElementById('btn-add-exclusao-agua');
    if (btnAddExclusaoAgua) {
        btnAddExclusaoAgua.addEventListener('click', () => adicionarExclusao('agua'));
    }

    const btnCalcAgua = document.getElementById('btn-calcular-previsao-agua-v2');
    if (btnCalcAgua) {
        btnCalcAgua.addEventListener('click', () => calcularPrevisaoInteligente('agua'));
    }

    // Listener para remover exclusão (delegação de evento)
    const listaExclusaoAgua = document.getElementById('lista-exclusoes-agua');
    if (listaExclusaoAgua) {
        listaExclusaoAgua.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-exclusao[data-item-type="agua"]');
            if (btn) {
                removerExclusao('agua', btn.dataset.unidadeId);
            }
        });
    }

    // --- Listeners para GÁS (Previsão) ---
    const containerGas = document.getElementById('previsao-modo-container-gas');
    if (containerGas) {
        containerGas.addEventListener('click', (e) => {
            const card = e.target.closest('.previsao-option-card[data-modo]');
            if (card) {
                selecionarModoPrevisao('gas', card.dataset.modo);
            }
        });
    }

    const btnAddExclusaoGas = document.getElementById('btn-add-exclusao-gas');
    if (btnAddExclusaoGas) {
        btnAddExclusaoGas.addEventListener('click', () => adicionarExclusao('gas'));
    }

    const btnCalcGas = document.getElementById('btn-calcular-previsao-gas-v2');
    if (btnCalcGas) {
        btnCalcGas.addEventListener('click', () => calcularPrevisaoInteligente('gas'));
    }

    // Listener para remover exclusão (delegação de evento)
    const listaExclusaoGas = document.getElementById('lista-exclusoes-gas');
    if (listaExclusaoGas) {
        listaExclusaoGas.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-exclusao[data-item-type="gas"]');
            if (btn) {
                removerExclusao('gas', btn.dataset.unidadeId);
            }
        });
    }

    console.log("[Previsão] Listeners inicializados.");
}
