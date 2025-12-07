// js/modules/previsao.js// js/modules/previsao.js
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import {
    getAguaMovimentacoes,
    getGasMovimentacoes,
    getUnidades,
    modoPrevisao, 
    listaExclusoes, 
    graficoPrevisao, 
    setModoPrevisao, 
    setListaExclusoes, 
    setGraficoPrevisao 
} from "../utils/cache.js";
import { showAlert, DOM_ELEMENTS } from "../utils/dom-helpers.js";
import { formatTimestamp, formatTimestampComTempo } from "../utils/formatters.js";

let graficoAnaliseConsumo = { agua: null, gas: null };

// Estado local para evitar recriação desnecessária de listeners (Bugfix de UI)
let analiseListenersInitialized = { agua: false, gas: false };

function normalizeUnidadeType(tipo) {
    let tipoNormalizado = (tipo || 'OUTROS').toUpperCase();
    if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
    if (tipoNormalizado === 'ABRIGO' || tipoNormalizado === 'ACOLHER E AMAR') tipoNormalizado = 'ABRIGO';
    return tipoNormalizado;
}

/**
 * Configura os controles de seleção de unidades para a análise de consumo.
 */
export function setupAnaliseUnidadeControls(itemType) {
    const unidades = getUnidades();
    const service = itemType === 'agua' ? 'atendeAgua' : 'atendeGas';
    const unidadesFiltradas = unidades.filter(u => u[service] ?? true);

    const capType = itemType === 'agua' ? 'Agua' : 'Gas';
    const selectTipo = DOM_ELEMENTS[`analiseAgrupamentoTipo${capType}`];
    const selectUnidade = DOM_ELEMENTS[`analiseAgrupamentoUnidade${capType}`];

    if (!selectTipo || !selectUnidade) return;

    // Salva valores atuais para não perder seleção ao atualizar
    const currentTipoVal = selectTipo.value;
    const currentUnidadeVal = selectUnidade.value;

    // 1. Populando Agrupamento por Tipo
    const uniqueTypes = [...new Set(unidadesFiltradas.map(u => normalizeUnidadeType(u.tipo)))].sort();
    let tipoHtml = '<option value="todas">Todos os Tipos</option>';
    uniqueTypes.forEach(tipo => {
        tipoHtml += `<option value="${tipo}">${tipo}</option>`;
    });
    
    if (selectTipo.innerHTML !== tipoHtml) {
        selectTipo.innerHTML = tipoHtml;
        if (currentTipoVal) selectTipo.value = currentTipoVal;
    }

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
                unidadeHtml += `<option value="${unidade.id}">${unidade.nome} (${tipo})</option>`;
            });
        unidadeHtml += `</optgroup>`;
    });
    
    if (selectUnidade.innerHTML !== unidadeHtml) {
        selectUnidade.innerHTML = unidadeHtml;
        if (currentUnidadeVal) selectUnidade.value = currentUnidadeVal;
    }

    // 3. Adicionar Listener para o Agrupamento Principal (apenas uma vez)
    const selectModoAgrupamento = DOM_ELEMENTS[`selectModoAgrupamento${capType}`];
    const tipoContainer = DOM_ELEMENTS[`analiseAgrupamentoTipoContainer${capType}`];
    const unidadeContainer = DOM_ELEMENTS[`analiseAgrupamentoUnidadeContainer${capType}`];

    if (selectModoAgrupamento && tipoContainer && unidadeContainer) {
        if (!analiseListenersInitialized[itemType]) {
            selectModoAgrupamento.addEventListener('change', (e) => {
                const modo = e.target.value;
                tipoContainer.classList.toggle('hidden', modo !== 'tipo');
                unidadeContainer.classList.toggle('hidden', modo !== 'unidade');
            });
            analiseListenersInitialized[itemType] = true;
        }

        // Garante estado inicial da UI
        const initialMode = selectModoAgrupamento.value;
        tipoContainer.classList.toggle('hidden', initialMode !== 'tipo');
        unidadeContainer.classList.toggle('hidden', initialMode !== 'unidade');
    }
}

function getPeriodoAnalise(movimentacoes) {
    if (movimentacoes.length === 0) return { dataInicial: null, dataFinal: null, totalDias: 0 };
    const movsOrdenadas = [...movimentacoes].sort((a, b) => (a.data?.toMillis() || 0) - (b.data?.toMillis() || 0));
    const primeiraMovDate = movsOrdenadas[0].data.toDate();
    const ultimaMovDate = movsOrdenadas[movsOrdenadas.length - 1].data.toDate();
    const dataInicial = Timestamp.fromDate(primeiraMovDate);
    const dataFinal = Timestamp.fromDate(ultimaMovDate);
    const inicioPrimeira = new Date(primeiraMovDate.getFullYear(), primeiraMovDate.getMonth(), primeiraMovDate.getDate());
    const fimUltima = new Date(ultimaMovDate.getFullYear(), ultimaMovDate.getMonth(), ultimaMovDate.getDate());
    const diffTime = Math.abs(fimUltima.getTime() - inicioPrimeira.getTime());
    const totalDaysMs = 1000 * 60 * 60 * 24;
    const totalDias = Math.ceil(diffTime / totalDaysMs) + 1; 
    return { dataInicial, dataFinal, totalDias };
}

function analisarConsumoPorPeriodo(itemType) {
    const alertId = `alert-analise-consumo-${itemType}`;
    const unidades = getUnidades();
    const selectModoAgrupamento = DOM_ELEMENTS[`selectModoAgrupamento${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; 
    const granularidade = DOM_ELEMENTS[`analiseGranularidade${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; 
    const agruparPor = selectModoAgrupamento; 

    let filtroAgrupamento = null;
    let nomeFiltro = "Todas as Unidades";

    if (agruparPor === 'tipo') {
        filtroAgrupamento = DOM_ELEMENTS[`analiseAgrupamentoTipo${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; 
        nomeFiltro = filtroAgrupamento === 'todas' ? 'Todos os Tipos' : filtroAgrupamento;
    } else if (agruparPor === 'unidade') {
        filtroAgrupamento = DOM_ELEMENTS[`analiseAgrupamentoUnidade${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value; 
        if (filtroAgrupamento !== 'todas') {
             const unidade = unidades.find(u => u.id === filtroAgrupamento);
             nomeFiltro = unidade ? unidade.nome : 'Unidade Desconhecida';
        }
    }

    const movimentacoes = (itemType === 'agua' ? getAguaMovimentacoes() : getGasMovimentacoes());
    let movsEntrega = movimentacoes
        .filter(m => m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function')
        .sort((a, b) => a.data.toMillis() - b.data.toMillis());

    const unidadeMap = new Map(unidades.map(u => [u.id, {
        nome: u.nome,
        tipo: normalizeUnidadeType(u.tipo) 
    }]));

    if (filtroAgrupamento !== 'todas') {
        if (agruparPor === 'tipo') {
            const unidadesParaFiltrar = unidades.filter(u => normalizeUnidadeType(u.tipo) === filtroAgrupamento).map(u => u.id);
            movsEntrega = movsEntrega.filter(m => unidadesParaFiltrar.includes(m.unidadeId));
        } else if (agruparPor === 'unidade') {
            movsEntrega = movsEntrega.filter(m => m.unidadeId === filtroAgrupamento);
        }
    }

    const dataInicioVal = DOM_ELEMENTS[`analiseDataInicio${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value;
    const dataFimVal = DOM_ELEMENTS[`analiseDataFim${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value;
    const mesRefVal = DOM_ELEMENTS[`analiseMes${itemType === 'agua' ? 'Agua' : 'Gas'}`]?.value;
    const movsGroupFull = [...movsEntrega];

    if (mesRefVal) {
        const [y, m] = mesRefVal.split('-').map(x => parseInt(x, 10));
        const inicio = new Date(y, m - 1, 1, 0, 0, 0, 0);
        const fim = new Date(y, m, 0, 23, 59, 59, 999);
        movsEntrega = movsEntrega.filter(m => {
            const d = m.data.toDate();
            return d >= inicio && d <= fim;
        });
    } else if (dataInicioVal || dataFimVal) {
        const inicio = dataInicioVal ? new Date(`${dataInicioVal}T00:00:00`) : null;
        const fim = dataFimVal ? new Date(`${dataFimVal}T23:59:59`) : null;
        movsEntrega = movsEntrega.filter(m => {
            const d = m.data.toDate();
            const okIni = inicio ? d >= inicio : true;
            const okFim = fim ? d <= fim : true;
            return okIni && okFim;
        });
    }

    if (movsEntrega.length === 0) {
        showAlert(alertId, 'Nenhum dado de consumo (entrega) encontrado para o filtro selecionado.', 'info');
        if (graficoAnaliseConsumo[itemType]) graficoAnaliseConsumo[itemType].destroy();
        document.getElementById(`analise-resultado-container-${itemType}`).classList.add('hidden');
        return;
    }

    const { dataInicial, dataFinal, totalDias } = getPeriodoAnalise(movsEntrega);
    const consumoPorPeriodo = new Map();

    movsEntrega.forEach(mov => {
        const data = mov.data.toDate();
        const unidadeInfo = unidadeMap.get(mov.unidadeId);
        if (!unidadeInfo) return; 
        let keyGroup;
        if (agruparPor === 'tipo') {
            keyGroup = unidadeInfo.tipo;
        } else { 
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

    const { chartLabels, chartDataSets } = formatDataForChart(consumoPorPeriodo, granularidade);
    renderGraficoAnalise(itemType, chartLabels, chartDataSets, granularidade, agruparPor, nomeFiltro);
    document.getElementById(`analise-resultado-container-${itemType}`).classList.remove('hidden');
    renderAnaliseTextual(itemType, movsEntrega, unidades, dataInicial, dataFinal, movsGroupFull, granularidade, mesRefVal || '');
    showAlert(alertId, `Análise concluída. Período: ${formatTimestamp(dataInicial)} a ${formatTimestamp(dataFinal)} (${totalDias} dias).`, 'success', 5000);
}

function getItemLabel(itemType, qty) {
    if (itemType === 'agua') {
        return qty === 1 ? 'galão' : 'galões';
    }
    return qty === 1 ? 'botijão' : 'botijões';
}

function getPeriodKey(date, agrupamento) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    if (agrupamento === 'mensal') {
        return `${year}-${month}`; 
    }
    if (agrupamento === 'diario') {
        return `${year}-${month}-${day}`; 
    }
    if (agrupamento === 'anual') {
        return `${year}`;
    }
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const yearStart = new Date(d.getFullYear(), 0, 1);
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getFullYear()}-W${String(weekNo).padStart(2, '0')}`; 
}

function formatDataForChart(consumoPorPeriodo, agrupamento) {
    const sortedPeriodKeys = Array.from(consumoPorPeriodo.keys()).sort();
    const allCategoriesSet = new Set();
    consumoPorPeriodo.forEach(periodData => {
        periodData.forEach((_, category) => allCategoriesSet.add(category));
    });
    const allCategories = Array.from(allCategoriesSet).sort();
    const colors = [
        '#2563eb', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
        '#64748b', '#06b6d4', '#e879f9', '#4c4c4c', '#57534e'
    ];
    const colorMap = new Map();
    allCategories.forEach((cat, index) => {
        colorMap.set(cat, colors[index % colors.length]);
    });
    const chartLabels = sortedPeriodKeys.map(key => {
        if (agrupamento === 'mensal') {
            const [year, month] = key.split('-');
            return `${month}/${year}`;
        }
        if (agrupamento === 'diario') {
            const [year, month, day] = key.split('-');
            return `${day}/${month}`;
        }
        if (agrupamento === 'anual') {
            return key;
        }
        const [year, week] = key.split('-W');
        return `Sem. ${parseInt(week)} (${year})`;
    });
    const chartDataSets = allCategories.map(category => {
        const data = sortedPeriodKeys.map(periodKey => {
            const periodData = consumoPorPeriodo.get(periodKey);
            return periodData.get(category) || 0; 
        });
        const baseColor = colorMap.get(category);
        const backgroundColor = baseColor + 'c0'; 
        return {
            label: category,
            data: data,
            backgroundColor: backgroundColor,
            type: 'bar',
        };
    });
    return { chartLabels, chartDataSets };
}

function renderGraficoAnalise(itemType, labels, datasets, granularidade, agruparPor, nomeFiltro) {
    const canvasId = `grafico-analise-consumo-${itemType}`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;
    if (graficoAnaliseConsumo[itemType]) {
        graficoAnaliseConsumo[itemType].destroy();
    }
    const itemLabel = itemType === 'agua' ? 'Galões' : 'Botijões';
    const agrupadoLabel = agruparPor === 'unidade' ? 'Unidade' : 'Tipo de Unidade';
    const titleText = `Consumo por ${granularidade} - Agrupado por ${agrupadoLabel} (${nomeFiltro})`;
    graficoAnaliseConsumo[itemType] = new Chart(ctx, {
        type: 'bar', 
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

function renderAnaliseTextual(itemType, movsEntrega, unidades, dataInicial, dataFinal, movsGroupFull, granularidade, mesRefVal) {
    const relatorioEl = document.getElementById(`analise-relatorio-textual-${itemType}`);
    const rankingEl = document.getElementById(`analise-ranking-${itemType}`);
    const resumoExecEl = document.getElementById(`analise-resumo-executivo-${itemType}`);
    if (!relatorioEl || !rankingEl) return;
    const consumoPorUnidade = movsEntrega.reduce((acc, mov) => {
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
    const itemLabel = getItemLabel(itemType, 1);
    const itemLabelPlural = getItemLabel(itemType, totalConsumo);
    rankingEl.innerHTML = '';
    if (ranking.length > 0) {
        let rankingHtml = '';
        const top = ranking.slice(0, 5);
        const bottom = ranking.slice(-5).reverse();
        rankingHtml += `<h4 class="font-semibold mb-2">🏆 Maiores consumidores</h4>`;
        top.forEach((item, index) => {
            rankingHtml += `
                <div class="ranking-item">
                    <span class="rank-number">${index + 1}º</span>
                    <span class="rank-name">${item.nome}</span>
                    <span class="rank-consumption text-red-600">${item.consumo} un.</span>
                </div>
            `;
        });
        rankingHtml += `<h4 class="font-semibold mt-4 mb-2">🌱 Menores consumidores</h4>`;
        bottom.forEach((item, index) => {
            rankingHtml += `
                <div class="ranking-item">
                    <span class="rank-number">${index + 1}º</span>
                    <span class="rank-name">${item.nome}</span>
                    <span class="rank-consumption text-green-600">${item.consumo} un.</span>
                </div>
            `;
        });
        rankingEl.innerHTML = rankingHtml;
    } else {
        rankingEl.innerHTML = `<p class="text-gray-500 italic text-sm">Nenhum consumo registrado.</p>`;
    }
    const { totalDias } = getPeriodoAnalise(movsEntrega);
    const mediaDiariaPeriodo = totalDias > 0 ? (totalConsumo / totalDias) : totalConsumo;

    let mediaDiariaHistorica = 0;
    if (Array.isArray(movsGroupFull) && movsGroupFull.length > 0) {
        const { totalDias: diasHist } = getPeriodoAnalise(movsGroupFull);
        const totalHist = movsGroupFull.reduce((sum, m) => sum + m.quantidade, 0);
        mediaDiariaHistorica = diasHist > 0 ? (totalHist / diasHist) : totalHist;
    }
    const esperadoPeriodo = mediaDiariaHistorica * totalDias;
    const desvioAbs = totalConsumo - esperadoPeriodo;
    const desvioPerc = esperadoPeriodo > 0 ? ((desvioAbs / esperadoPeriodo) * 100) : 0;
    const picoEntrega = movsEntrega.reduce((max, m) => Math.max(max, m.quantidade || 0), 0);

    let relatorioText = `
        <p>📅 Período: <strong>${formatTimestamp(dataInicial)}</strong> a <strong>${formatTimestamp(dataFinal)}</strong> (<strong>${totalDias} dias</strong>).</p>
        <p>📦 Consumo total de ${itemLabelPlural}: <strong>${totalConsumo} un.</strong></p>
        <p>⚖️ Média diária: <strong>${mediaDiariaPeriodo.toFixed(2)} un./dia</strong> (histórico: <strong>${mediaDiariaHistorica.toFixed(2)} un./dia</strong>).</p>
        <p>📈 Desvio vs previsão histórica no período: <strong>${desvioAbs.toFixed(1)} un.</strong> (${desvioPerc.toFixed(1)}%).</p>
    `;
    if (ranking.length > 0) {
        relatorioText += `<p>🏅 Destaque: <strong>${ranking[0].nome}</strong> consumiu <strong>${ranking[0].consumo} un.</strong> (${((ranking[0].consumo / totalConsumo) * 100).toFixed(1)}% do total).</p>`;
        const menorConsumo = ranking[ranking.length - 1];
        relatorioText += `<p>🔻 Menor consumo: <strong>${menorConsumo.nome}</strong> com <strong>${menorConsumo.consumo} un.</strong>.</p>`;
    }
    const diasHistFull = Array.isArray(movsGroupFull) ? getPeriodoAnalise(movsGroupFull).totalDias : 0;
    const consumoHistPorUnidade = Array.isArray(movsGroupFull) ? movsGroupFull.reduce((acc, m) => {
        acc[m.unidadeId] = (acc[m.unidadeId] || 0) + (m.quantidade || 0);
        return acc;
    }, {}) : {};
    const consumoAtualPorUnidadeId = movsEntrega.reduce((acc, m) => {
        acc[m.unidadeId] = (acc[m.unidadeId] || 0) + (m.quantidade || 0);
        return acc;
    }, {});
    const esperadoPorUnidade = {};
    Object.keys(consumoHistPorUnidade).forEach(uid => {
        const mediaHistDia = diasHistFull > 0 ? (consumoHistPorUnidade[uid] / diasHistFull) : 0;
        esperadoPorUnidade[uid] = mediaHistDia * totalDias;
    });
    const anomaliasAlta = [];
    const anomaliasBaixa = [];
    Object.keys(consumoAtualPorUnidadeId).forEach(uid => {
        const atual = consumoAtualPorUnidadeId[uid];
        const esperado = esperadoPorUnidade[uid] || 0;
        const diff = atual - esperado;
        const perc = esperado > 0 ? ((diff / esperado) * 100) : (atual > 0 ? 100 : 0);
        const unidade = unidades.find(u => u.id === uid);
        const nome = unidade ? unidade.nome : uid;
        const registro = { uid, nome, atual, esperado: Math.max(0, esperado), diff, perc };
        if (diff >= 0) anomaliasAlta.push(registro); else anomaliasBaixa.push(registro);
    });
    anomaliasAlta.sort((a, b) => b.diff - a.diff);
    anomaliasBaixa.sort((a, b) => a.diff - b.diff);
    const limiarPerc = 25;
    const destaqueAlta = anomaliasAlta.filter(a => a.esperado > 0 && a.perc >= limiarPerc).slice(0, 5);
    const destaqueBaixa = anomaliasBaixa.filter(a => a.esperado > 0 && Math.abs(a.perc) >= limiarPerc).slice(0, 5);

    if (destaqueAlta.length > 0 || destaqueBaixa.length > 0) {
        relatorioText += `<p class="mt-3">🚨 <strong>Unidades fora do padrão (variação relevante):</strong></p>`;
        if (destaqueAlta.length > 0) {
            relatorioText += `<ul class="list-disc ml-5 text-sm text-gray-700">`;
            destaqueAlta.forEach(a => {
                const maisMenos = a.diff >= 0 ? 'a mais' : 'a menos';
                relatorioText += `<li><strong>${a.nome}</strong>: consumiu ${a.atual} un. no período. Normalmente consome cerca de ${a.esperado.toFixed(1)} un. nesse intervalo. Diferença: ${Math.abs(a.diff).toFixed(1)} un. ${maisMenos} (${a.perc.toFixed(1)}%).</li>`;
            });
            relatorioText += `</ul>`;
        }
        if (destaqueBaixa.length > 0) {
            relatorioText += `<ul class="list-disc ml-5 text-sm text-gray-700 mt-2">`;
            destaqueBaixa.forEach(a => {
                const maisMenos = a.diff >= 0 ? 'a mais' : 'a menos';
                relatorioText += `<li><strong>${a.nome}</strong>: consumiu ${a.atual} un. no período. Normalmente consome cerca de ${a.esperado.toFixed(1)} un. nesse intervalo. Diferença: ${Math.abs(a.diff).toFixed(1)} un. ${maisMenos} (${a.perc.toFixed(1)}%).</li>`;
            });
            relatorioText += `</ul>`;
        }
    }

    if (granularidade === 'anual') {
        const monthNames = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
        const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        const consumoPorMesUnidade = {};
        movsEntrega.forEach(m => {
            const d = m.data.toDate();
            const k = monthKey(d);
            const u = m.unidadeId;
            consumoPorMesUnidade[k] ||= {};
            consumoPorMesUnidade[k][u] = (consumoPorMesUnidade[k][u] || 0) + (m.quantidade || 0);
        });
        const mediaDiaHistPorUnidade = {};
        const diasHistFull = Array.isArray(movsGroupFull) ? getPeriodoAnalise(movsGroupFull).totalDias : 0;
        movsGroupFull.forEach(m => {
            const u = m.unidadeId;
            mediaDiaHistPorUnidade[u] = (mediaDiaHistPorUnidade[u] || 0) + (m.quantidade || 0);
        });
        Object.keys(mediaDiaHistPorUnidade).forEach(u => {
            mediaDiaHistPorUnidade[u] = diasHistFull > 0 ? (mediaDiaHistPorUnidade[u] / diasHistFull) : 0;
        });
        const extremos = [];
        Object.keys(consumoPorMesUnidade).sort().forEach(k => {
            const [y, m] = k.split('-');
            const diasNoMes = new Date(parseInt(y,10), parseInt(m,10), 0).getDate();
            const etiquetaMes = `${monthNames[parseInt(m,10)-1]}/${y}`;
            const porUnid = consumoPorMesUnidade[k];
            Object.keys(porUnid).forEach(uid => {
                const atual = porUnid[uid];
                const mediaDia = mediaDiaHistPorUnidade[uid] || 0;
                const esperado = mediaDia * diasNoMes;
                const diff = atual - esperado;
                const peso = Math.abs(diff);
                if (peso >= 1) {
                    const unidade = unidades.find(u => u.id === uid);
                    const nome = unidade ? unidade.nome : uid;
                    extremos.push({ etiquetaMes, uid, nome, atual, esperado, diff, peso });
                }
            });
        });
        extremos.sort((a, b) => b.peso - a.peso);
        const top = extremos.slice(0, 5);
        if (top.length > 0) {
            relatorioText += `<div class="mt-3"><p><strong>Meses com maior variação no ano:</strong></p>${top.map(e => {
                const maisMenos = e.diff >= 0 ? 'bem acima' : 'bem abaixo';
                const emoji = e.diff >= 0 ? '🔥' : '⬇️';
                return `<p>${emoji} ${e.etiquetaMes}: <strong>${e.nome}</strong> consumiu ${Math.abs(e.diff).toFixed(0)} un. ${maisMenos} do normal (atual ${e.atual} • esperado ${e.esperado.toFixed(1)}).</p>`;
            }).join('')}</div>`;
        }
    }

    relatorioEl.innerHTML = relatorioText;

    if (resumoExecEl) {
        resumoExecEl.innerHTML = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div class="text-xs text-gray-500">Consumo Total</div>
                <div class="text-2xl font-bold text-gray-800">${totalConsumo}</div>
                <div class="text-xs text-gray-500">${formatTimestamp(dataInicial)} — ${formatTimestamp(dataFinal)}</div>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div class="text-xs text-gray-500">Média Diária</div>
                <div class="text-2xl font-bold text-gray-800">${mediaDiariaPeriodo.toFixed(2)} un./dia</div>
                <div class="text-xs text-gray-500">Histórico: ${mediaDiariaHistorica.toFixed(2)} un./dia</div>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div class="text-xs text-gray-500">Desvio vs Previsão</div>
                <div class="text-2xl font-bold ${desvioAbs >= 0 ? 'text-green-700' : 'text-red-700'}">${desvioAbs.toFixed(1)} un.</div>
                <div class="text-xs text-gray-500">${desvioPerc.toFixed(1)}% • Pico: ${picoEntrega} un.</div>
            </div>
        `;
    }
}

function selecionarModoPrevisao(itemType, modo) {
    setModoPrevisao(itemType, modo); 
    const configEl = document.getElementById(`config-previsao-${itemType}`);
    const unidadeContainer = document.getElementById(`select-unidade-container-${itemType}`);
    const tipoContainer = document.getElementById(`select-tipo-container-${itemType}`);
    const exclusaoContainer = document.getElementById(`exclusao-container-${itemType}`);
    if (configEl) configEl.classList.remove('hidden');
    if (unidadeContainer) unidadeContainer.classList.add('hidden');
    if (tipoContainer) tipoContainer.classList.add('hidden');
    if (exclusaoContainer) exclusaoContainer.classList.toggle('hidden', modo === 'unidade-especifica');
    document.querySelectorAll(`#subview-analise-previsao-${itemType} .previsao-option-card`).forEach(card => {
        card.classList.remove('selected');
    });
    const selectedCard = document.querySelector(`#subview-analise-previsao-${itemType} .previsao-option-card[data-modo="${modo}"]`);
    if (selectedCard) selectedCard.classList.add('selected');
    if (modo === 'unidade-especifica') {
        if (unidadeContainer) unidadeContainer.classList.remove('hidden');
    } else if (modo === 'por-tipo') {
        if (tipoContainer) tipoContainer.classList.remove('hidden');
    }
    const resultadoEl = document.getElementById(`resultado-previsao-${itemType}-v2`);
    if (resultadoEl) resultadoEl.classList.add('hidden');
    const currentGrafico = graficoPrevisao[itemType]; 
    if (currentGrafico) {
        currentGrafico.destroy();
        setGraficoPrevisao(itemType, null); 
    }
}

function renderListaExclusoes(itemType) {
    const listaEl = document.getElementById(`lista-exclusoes-${itemType}`);
    if (!listaEl) return;
    const unidades = getUnidades();
    const currentExclusoes = listaExclusoes[itemType]; 
    if (currentExclusoes.length === 0) {
        listaEl.innerHTML = '';
        return;
    }
    let html = '';
    currentExclusoes.forEach(unidadeId => {
        const unidade = unidades.find(u => u.id === unidadeId);
        const nome = unidade ? unidade.nome : `ID: ${unidadeId.substring(0, 6)}...`;
        html += `
            <span class="exclusao-item">
                ${nome}
                <button type="button" class="btn-remove-exclusao" data-item-type="${itemType}" data-unidade-id="${unidadeId}" title="Remover">&times;</button>
            </span>
        `;
    });
    listaEl.innerHTML = html;
}

function adicionarExclusao(itemType) {
    const selectEl = document.getElementById(`select-exclusao-${itemType}`);
    const alertId = `alertas-previsao-${itemType}`;
    if (!selectEl) {
         showAlert(alertId, 'Erro interno: select de exclusão não encontrado.', 'error');
         return;
    }
    const unidadeId = selectEl.value;
    if (!unidadeId) {
        showAlert(alertId, 'Selecione uma unidade para adicionar à lista de exclusão.', 'warning');
        return;
    }
    const currentExclusoes = [...listaExclusoes[itemType]]; 
    if (!currentExclusoes.includes(unidadeId)) {
        currentExclusoes.push(unidadeId);
        setListaExclusoes(itemType, currentExclusoes); 
        renderListaExclusoes(itemType);
        selectEl.value = '';
    } else {
        showAlert(alertId, 'Essa unidade já está na lista de exclusão.', 'info');
    }
}

function removerExclusao(itemType, unidadeId) {
    const currentExclusoes = listaExclusoes[itemType].filter(id => id !== unidadeId);
    setListaExclusoes(itemType, currentExclusoes); 
    renderListaExclusoes(itemType);
}

function renderGraficoPrevisao(itemType, data) {
    const canvasId = `grafico-previsao-${itemType}`;
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) {
        return;
    }
    const currentGrafico = graficoPrevisao[itemType]; 
    if (currentGrafico) {
        currentGrafico.destroy();
        setGraficoPrevisao(itemType, null); 
    }
    try {
        const newChart = new Chart(ctx, {
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
                         ticks: {
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
                                    label += parseFloat(context.parsed.y.toFixed(2));
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
        setGraficoPrevisao(itemType, newChart); 
    } catch (error) {
        console.error("Erro ao criar o gráfico:", error);
        showAlert(`alertas-previsao-${itemType}`, 'Erro ao renderizar o gráfico.', 'error');
    }
}

function calcularPrevisaoInteligente(itemType) {
    const alertId = `alertas-previsao-${itemType}`;
    const resultadoContainer = document.getElementById(`resultado-previsao-${itemType}-v2`);
    const resultadoContentEl = document.getElementById(`resultado-content-${itemType}`);
    const btn = document.getElementById(`btn-calcular-previsao-${itemType}-v2`);
    const alertEl = document.getElementById(alertId);

    if (alertEl) {
        alertEl.querySelectorAll('.alert-info, .alert-warning, .alert-error').forEach(el => el.remove());
        alertEl.style.display = 'none';
    }

    const diasPrevisaoInput = document.getElementById(`dias-previsao-${itemType}`);
    const margemSegurancaInput = document.getElementById(`margem-seguranca-${itemType}`);

    if (!resultadoContainer || !resultadoContentEl || !diasPrevisaoInput || !margemSegurancaInput || !btn) {
        showAlert(alertId, 'Erro interno: Elementos da página não encontrados. Recarregue.', 'error');
        return;
    }

    const diasPrevisao = parseInt(diasPrevisaoInput.value, 10);
    const margemSeguranca = parseInt(margemSegurancaInput.value, 10);
    const modo = modoPrevisao[itemType]; 

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

    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    resultadoContainer.classList.add('hidden');

    setTimeout(() => {
        try {
            const movimentacoes = (itemType === 'agua') ? getAguaMovimentacoes() : getGasMovimentacoes();
            const unidades = getUnidades();

            const movsEntrega = movimentacoes
                .filter(m => m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function')
                .sort((a, b) => a.data.toMillis() - b.data.toMillis());

            let movsFiltradas = [];
            let tituloPrevisao = "";
            let unidadesConsideradas = [];

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

            if (movsFiltradas.length < 2) {
                 showAlert(alertId, `Dados insuficientes para calcular a previsão (${tituloPrevisao}). É necessário pelo menos 2 registros de entrega válidos no período.`, 'info');
                throw new Error("Dados insuficientes.");
            }

            // =========================================================================
            // CORREÇÃO MATEMÁTICA DA PREVISÃO: Lógica de Intervalo Real
            // =========================================================================
            const primeiraMov = movsFiltradas[0].data.toMillis();
            const ultimaMov = movsFiltradas[movsFiltradas.length - 1].data.toMillis();
            const qtdeUltimaEntrega = movsFiltradas[movsFiltradas.length - 1].quantidade;

            const totalConsumidoHistorico = movsFiltradas.reduce((sum, m) => sum + m.quantidade, 0);
            
            // Para calcular a MÉDIA DIÁRIA de consumo, não devemos contar a última entrega inteira,
            // pois ela acabou de chegar e serve para o futuro. 
            // Consideramos que o total consumido no período [PrimeiraData -> ÚltimaData] 
            // é tudo o que foi entregue ANTES da última data.
            const totalParaCalculoMedia = totalConsumidoHistorico - qtdeUltimaEntrega;
            
            // Cálculo preciso de dias entre a primeira e a última entrega
            const diffMs = ultimaMov - primeiraMov;
            const diasIntervalo = Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60 * 24))); 

            // Se só tivermos 2 entregas no mesmo dia ou muito próximas, usamos o total histórico como fallback seguro
            // para não dividir por 1 um valor pequeno e subestimar, ou dividir 0 e dar erro.
            let mediaDiaria;
            if (totalParaCalculoMedia <= 0) {
                // Fallback para casos de dados muito escassos (ex: 2 entregas no mesmo dia)
                // Assume que a primeira entrega foi consumida em 1 dia.
                mediaDiaria = movsFiltradas[0].quantidade; 
            } else {
                mediaDiaria = totalParaCalculoMedia / diasIntervalo;
            }

            if (diasIntervalo < 30) {
                 const warningEl = document.createElement('div');
                 warningEl.className = 'alert alert-info mt-2';
                 warningEl.textContent = `Aviso: O histórico de dados considerado é curto (${diasIntervalo.toFixed(0)} dias entre a primeira e última entrega). A previsão pode ser menos precisa.`;
                 if (alertEl) {
                     alertEl.appendChild(warningEl);
                     alertEl.style.display = 'block';
                 }
            }

            const previsaoBase = mediaDiaria * diasPrevisao;
            const valorMargem = previsaoBase * (margemSeguranca / 100);
            const previsaoFinal = previsaoBase + valorMargem;

            const unidadesExcluidasNomes = exclusoes
                .map(id => unidades.find(u => u.id === id)?.nome || `ID:${id.substring(0,4)}...`)
                .filter(Boolean)
                .sort();

            resultadoContentEl.innerHTML = `
                <h4 class="text-lg font-bold text-white mb-4">${tituloPrevisao}</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                    <div class="bg-white/10 p-4 rounded-lg">
                        <span class="block text-sm text-white/80 uppercase">Período Analisado</span>
                        <span class="block text-2xl font-bold">${diasIntervalo.toFixed(0)} dias</span>
                        <span class="block text-xs text-white/60">(${movsFiltradas.length} entregas)</span>
                    </div>
                    <div class="bg-white/10 p-4 rounded-lg">
                        <span class="block text-sm text-white/80 uppercase">Total Consumido (Histórico)</span>
                        <span class="block text-2xl font-bold">${totalConsumidoHistorico} un.</span>
                    </div>
                </div>
                <div class="bg-white/20 p-4 rounded-lg mt-4">
                    <span class="block text-center text-sm text-white/80 uppercase">Consumo Médio Diário Real</span>
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

            const chartData = {
                labels: ['Média Diária (Histórico)', `Previsão Diária (Próximos ${diasPrevisao} dias)`],
                datasets: [{
                    label: `Consumo Diário (${itemType === 'agua' ? 'Água' : 'Gás'})`,
                    data: [mediaDiaria, Math.ceil(previsaoFinal) / diasPrevisao],
                    backgroundColor: [
                        'rgba(255, 255, 255, 0.6)',
                        'rgba(191, 219, 254, 0.8)'
                    ],
                    borderColor: [
                        'rgba(229, 231, 235, 1)',
                        'rgba(59, 130, 246, 1)'
                    ],
                    borderWidth: 1,
                    type: 'bar',
                }]
            };
            renderGraficoPrevisao(itemType, chartData);

        } catch (error) {
             console.error(`[Previsão ${itemType}] Erro durante o cálculo:`, error);
            if (!error.message.includes("insuficientes") && !error.message.includes("selecionad") && !error.message.includes("encontrada")) {
                 showAlert(alertId, `Erro inesperado durante o cálculo: ${error.message}`, 'error');
            }
            resultadoContainer.classList.add('hidden');
            const currentGrafico = graficoPrevisao[itemType]; 
            if (currentGrafico) {
                currentGrafico.destroy();
                setGraficoPrevisao(itemType, null); 
            }
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<i data-lucide="calculator"></i> Calcular Previsão';
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                lucide.createIcons();
            }
        }
    }, 50);
}

export function initPrevisaoListeners() {
    DOM_ELEMENTS.btnAnalisarConsumoAgua?.addEventListener('click', () => analisarConsumoPorPeriodo('agua'));
    DOM_ELEMENTS.btnAnalisarConsumoGas?.addEventListener('click', () => analisarConsumoPorPeriodo('gas'));

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

    const listaExclusaoAgua = document.getElementById('lista-exclusoes-agua');
    if (listaExclusaoAgua) {
        listaExclusaoAgua.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-remove-exclusao[data-item-type="agua"]');
            if (btn) {
                removerExclusao('agua', btn.dataset.unidadeId);
            }
        });
    }

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
