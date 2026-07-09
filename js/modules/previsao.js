// js/modules/previsao.js
import { Timestamp } from "firebase/firestore";
import Chart from 'chart.js/auto';
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
import { showAlert, DOM_ELEMENTS, escapeHTML } from "../utils/dom-helpers.js";
import { formatTimestamp, formatTimestampComTempo, dateToTimestamp } from "../utils/formatters.js";

let graficoAnaliseConsumo = { agua: null, gas: null };

// Estado local para evitar recriação desnecessária de listeners (Bugfix de UI)
let analiseListenersInitialized = { agua: false, gas: false };

// FERIADOS NACIONAIS FIXOS (Dia/Mês)
const FERIADOS_FIXOS = [
    '01/01', // Confraternização Universal
    '21/04', // Tiradentes
    '01/05', // Dia do Trabalho
    '07/09', // Independência do Brasil
    '12/10', // Nossa Senhora Aparecida
    '02/11', // Finados
    '15/11', // Proclamação da República
    '20/11', // Dia da Consciência Negra
    '25/12'  // Natal
];

const SEDE_INICIO_CONTABILIZACAO = new Date(2026, 0, 1, 0, 0, 0, 0);

function isFeriado(date) {
    const dia = String(date.getDate()).padStart(2, '0');
    const mes = String(date.getMonth() + 1).padStart(2, '0');
    const chave = `${dia}/${mes}`;
    return FERIADOS_FIXOS.includes(chave);
}

function countDiasUteis(startDate, endDate) {
    let count = 0;
    let curDate = new Date(startDate.getTime());
    const end = new Date(endDate.getTime());
    
    // Normalizar para meia-noite para evitar problemas de hora
    curDate.setHours(0,0,0,0);
    end.setHours(0,0,0,0);

    while (curDate <= end) {
        const dayOfWeek = curDate.getDay();
        // 0 = Domingo, 6 = Sábado
        if (dayOfWeek !== 0 && dayOfWeek !== 6 && !isFeriado(curDate)) {
            count++;
        }
        curDate.setDate(curDate.getDate() + 1);
    }
    return count;
}

function normalizeUnidadeType(tipo) {
    let tipoNormalizado = (tipo || 'OUTROS').toUpperCase();
    if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
    if (tipoNormalizado === 'ABRIGO' || tipoNormalizado === 'ACOLHER E AMAR') tipoNormalizado = 'ABRIGO';
    return tipoNormalizado;
}

function normalizeUnidadeNome(nome) {
    return (nome || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function isFuroDeEstoqueNome(nome) {
    return normalizeUnidadeNome(nome) === 'furo de estoque';
}

function toIntegerUnits(value, mode = 'round') {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (mode === 'ceil') return Math.ceil(n);
    if (mode === 'floor') return Math.floor(n);
    return Math.round(n);
}

function filterSedeBaselineIfNeeded(movs, unidades, includesSedeScope) {
    if (!includesSedeScope) return movs;
    if (!Array.isArray(movs) || movs.length === 0) return movs;
    const last = movs[movs.length - 1];
    if (!last?.data || typeof last.data.toDate !== 'function') return movs;
    const endDate = last.data.toDate();
    if (endDate < SEDE_INICIO_CONTABILIZACAO) return movs;
    return movs.filter(m => {
        if (!m?.data || typeof m.data.toDate !== 'function') return false;
        return m.data.toDate() >= SEDE_INICIO_CONTABILIZACAO;
    });
}

function parseDateInputToDate(dateVal) {
    if (!dateVal) return null;
    const ts = dateToTimestamp(dateVal);
    if (!ts) return null;
    return ts.toDate();
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
        const safeTipo = escapeHTML(tipo);
        tipoHtml += `<option value="${safeTipo}">${safeTipo}</option>`;
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
        const safeTipo = escapeHTML(tipo);
        unidadeHtml += `<optgroup label="${safeTipo}">`;
        grupos[tipo]
            .sort((a, b) => a.nome.localeCompare(b.nome))
            .forEach(unidade => {
                const safeId = escapeHTML(unidade.id);
                const safeNome = escapeHTML(unidade.nome);
                unidadeHtml += `<option value="${safeId}">${safeNome} (${safeTipo})</option>`;
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
    
    // CORREÇÃO: Usar dias úteis (Segunda a Sexta + Feriados)
    const totalDias = Math.max(1, countDiasUteis(inicioPrimeira, fimUltima));
    
    return { dataInicial, dataFinal, totalDias };
}

function gerarConsumoSemanalGasHistorico() {
    const tabelaSemanal = document.getElementById('tabela-consumo-semanal-gas');
    const resumoEl = document.getElementById('resumo-consumo-semanal-gas');
    if (!tabelaSemanal) return;

    tabelaSemanal.innerHTML = '';
    if (resumoEl) resumoEl.textContent = '';

    const unidades = getUnidades();
    const movimentacoes = getGasMovimentacoes() || [];

    let baseMovs = movimentacoes
        .filter(m => m && m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function');

    if (baseMovs.length === 0) {
        tabelaSemanal.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-gray-500 text-sm">Nenhuma unidade com consumo registrado no histórico.</td></tr>`;
        if (resumoEl) resumoEl.textContent = 'Nenhum consumo registrado no histórico para calcular o resumo.';
        return;
    }

    const periodo = getPeriodoAnalise(baseMovs);
    const totalDias = periodo.totalDias;
    const diasBase = totalDias > 0 ? totalDias : 1;

    const unidadesById = new Map();
    const unidadesByNome = new Map();
    unidades.forEach(u => {
        const tipo = normalizeUnidadeType(u.tipo);
        const entry = { id: u.id, nome: u.nome, tipo };
        unidadesById.set(u.id, entry);
        unidadesByNome.set(normalizeUnidadeNome(u.nome), entry);
    });

    const includesSedeScope = baseMovs.some(m => {
        const info = m.unidadeId ? unidadesById.get(m.unidadeId) : null;
        return normalizeUnidadeType(info?.tipo) === 'SEDE';
    });
    baseMovs = filterSedeBaselineIfNeeded(baseMovs.sort((a, b) => a.data.toMillis() - b.data.toMillis()), unidades, includesSedeScope);

    if (baseMovs.length === 0) {
        tabelaSemanal.innerHTML = `<tr><td colspan="4" class="text-center py-6 text-gray-500 text-sm">Nenhuma unidade com consumo registrado no histórico.</td></tr>`;
        if (resumoEl) resumoEl.textContent = 'Nenhum consumo registrado no histórico para calcular o resumo.';
        return;
    }

    const consumoMap = new Map();
    let totalConsumoGlobal = 0;

    baseMovs.forEach(mov => {
        const normNomeMov = normalizeUnidadeNome(mov.unidadeNome);
        let baseInfo = (mov.unidadeId && unidadesById.get(mov.unidadeId)) || unidadesByNome.get(normNomeMov);

        let key;
        if (baseInfo) {
            key = baseInfo.id || baseInfo.nome;
        } else if (mov.unidadeId || normNomeMov) {
            key = mov.unidadeId || normNomeMov;
            baseInfo = {
                id: mov.unidadeId || null,
                nome: mov.unidadeNome || 'Unidade não identificada',
                tipo: 'OUTROS'
            };
        } else {
            return;
        }

        const atual = consumoMap.get(key) || { nome: baseInfo.nome, tipo: baseInfo.tipo, consumo: 0, datas: [] };
        atual.consumo += mov.quantidade || 0;
        totalConsumoGlobal += mov.quantidade || 0;
        const d = mov.data.toDate();
        atual.datas.push(d);
        consumoMap.set(key, atual);
    });

    const linhas = Array.from(consumoMap.values())
        .map(entry => {
            const datasOrdenadasRaw = entry.datas
                .slice()
                .sort((a, b) => a.getTime() - b.getTime());
            const first = datasOrdenadasRaw[0];
            const last = datasOrdenadasRaw[datasOrdenadasRaw.length - 1] || first;
            const diasRef = Math.max(1, countDiasUteis(first, last));

            const mediaDiaria = entry.consumo / diasRef;
            const semanalFloat = mediaDiaria * 7;
            const semanal = entry.consumo > 0 && semanalFloat < 1 ? 1 : Math.round(semanalFloat);

            const datasOrdenadas = datasOrdenadasRaw
                .map(d => formatTimestamp(Timestamp.fromDate(d)));

            return {
                tipo: entry.tipo,
                nome: entry.nome,
                total: entry.consumo,
                semanal,
                datas: datasOrdenadas
            };
        })
        .sort((a, b) => {
            if (a.tipo === b.tipo) {
                return a.nome.localeCompare(b.nome);
            }
            return a.tipo.localeCompare(b.tipo);
        });

    if (linhas.length === 0) {
        tabelaSemanal.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-gray-500 text-sm">Nenhuma unidade com consumo registrado no histórico.</td></tr>`;
        return;
    }

    linhas.forEach(l => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${escapeHTML(l.tipo)}</td>
            <td>${escapeHTML(l.nome)}</td>
            <td>${l.datas.map(escapeHTML).join(', ')}</td>
            <td class="text-center font-medium text-gray-600">${l.total}</td>
            <td class="text-center font-semibold">${l.semanal}</td>
        `;
        tabelaSemanal.appendChild(row);
    });

    if (resumoEl) {
        const mediaDiariaGlobal = diasBase > 0 ? (totalConsumoGlobal / diasBase) : 0;
        const semanalGlobal = Math.round(mediaDiariaGlobal * 5);
        const mensalGlobal = Math.round(mediaDiariaGlobal * 22);
        const anualGlobal = Math.round(mediaDiariaGlobal * 252);
        const inicioStr = periodo.dataInicial ? formatTimestamp(periodo.dataInicial) : '-';
        const fimStr = periodo.dataFinal ? formatTimestamp(periodo.dataFinal) : '-';
        resumoEl.innerHTML = `
            <div class="mb-3">
                Período analisado: <strong>${inicioStr}</strong> a <strong>${fimStr}</strong> (<strong>${diasBase}</strong> dias).<br>
                Total de botijões entregues no período: <strong>${totalConsumoGlobal}</strong>.
            </div>
            <div class="mb-3">
                Para abastecer todas as unidades nesse ritmo seriam necessários, em média:<br>
                <span class="text-lg">
                    <strong>${semanalGlobal}</strong> botijões por semana (dias úteis), 
                    <strong>${mensalGlobal}</strong> por mês (dias úteis) e 
                    <strong>${anualGlobal}</strong> por ano (dias úteis).
                </span>
            </div>
            <div class="text-xs text-gray-500 bg-gray-50 p-3 rounded border border-gray-200">
                <strong>Metodologia do Cálculo:</strong><br>
                O sistema calculou a média diária dividindo o total consumido (${totalConsumoGlobal}) pelo número de dias (${diasBase}). 
                Os valores acima são projeções dessa média para 7, 30 e 365 dias, sempre arredondados para números inteiros.<br>
                <em>Atenção: Unidades com apenas uma data de entrega terão o período considerado como 1 dia, o que projeta o consumo daquele dia para a semana inteira.</em>
            </div>
        `;
    }
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
        const inicio = dataInicioVal ? parseDateInputToDate(dataInicioVal) : null;
        const fimBase = dataFimVal ? parseDateInputToDate(dataFimVal) : null;
        const fim = fimBase ? new Date(fimBase.getFullYear(), fimBase.getMonth(), fimBase.getDate(), 23, 59, 59, 999) : null;
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

    const isFuroMov = (mov) => {
        if (itemType !== 'agua') return false;
        const info = unidadeMap.get(mov.unidadeId);
        const nome = info?.nome || mov.unidadeNome || '';
        return isFuroDeEstoqueNome(nome);
    };

    const movsEntregaSemFuro = itemType === 'agua'
        ? movsEntrega.filter(m => !isFuroMov(m))
        : movsEntrega;

    const furoQuantidade = itemType === 'agua'
        ? movsEntrega.filter(m => isFuroMov(m)).reduce((s, m) => s + (m.quantidade || 0), 0)
        : 0;

    const { dataInicial, dataFinal, totalDias } = getPeriodoAnalise(movsEntrega);
    const consumoPorPeriodo = new Map();

    movsEntregaSemFuro.forEach(mov => {
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
    renderAnaliseTextual(itemType, movsEntrega, unidades, dataInicial, dataFinal, movsGroupFull, granularidade, mesRefVal || '', movimentacoes);
    showAlert(alertId, `Análise concluída. Período: ${formatTimestamp(dataInicial)} a ${formatTimestamp(dataFinal)} (${totalDias} dias úteis).`, 'success', 5000);
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

function renderAnaliseTextual(itemType, movsEntrega, unidades, dataInicial, dataFinal, movsGroupFull, granularidade, mesRefVal, allMovs = []) {
    const relatorioEl = document.getElementById(`analise-relatorio-textual-${itemType}`);
    const rankingEl = document.getElementById(`analise-ranking-${itemType}`);
    const resumoExecEl = document.getElementById(`analise-resumo-executivo-${itemType}`);
    if (!relatorioEl || !rankingEl) return;
    const { totalDias } = getPeriodoAnalise(movsEntrega);
    let furoQuantidade = 0;
    const consumoPorUnidade = movsEntrega.reduce((acc, mov) => {
        const unidadeInfo = unidades.find(u => u.id === mov.unidadeId);
        const nome = unidadeInfo?.nome || mov.unidadeNome || '';
        if (itemType === 'agua' && isFuroDeEstoqueNome(nome)) {
            furoQuantidade += mov.quantidade || 0;
            return acc;
        }
        if (nome) {
            acc[nome] = (acc[nome] || 0) + (mov.quantidade || 0);
        }
        return acc;
    }, {});
    const ranking = Object.entries(consumoPorUnidade)
        .map(([nome, consumo]) => ({ nome, consumo }))
        .sort((a, b) => b.consumo - a.consumo);
    const totalConsumoSemFuro = ranking.reduce((sum, item) => sum + item.consumo, 0);
    const totalConsumoComFuro = totalConsumoSemFuro + (itemType === 'agua' ? furoQuantidade : 0);
    const itemLabel = getItemLabel(itemType, 1);
    const itemLabelPluralSemFuro = getItemLabel(itemType, totalConsumoSemFuro);
    const itemLabelPluralComFuro = getItemLabel(itemType, totalConsumoComFuro);
    rankingEl.innerHTML = '';
    if (ranking.length > 0) {
        let rankingHtml = '';
        const top = ranking.slice(0, 5);
        const bottom = ranking.slice(-5).reverse();
        rankingHtml += `<h4 class="font-semibold mb-2 flex items-center gap-1"><i data-lucide="trophy" class="w-4 h-4 text-yellow-500"></i> Maiores consumidores</h4>`;
        top.forEach((item, index) => {
            rankingHtml += `
                <div class="ranking-item">
                    <span class="rank-number">${index + 1}º</span>
                    <span class="rank-name">${item.nome}</span>
                    <span class="rank-consumption text-red-600">${item.consumo} un.</span>
                </div>
            `;
        });
        rankingHtml += `<h4 class="font-semibold mt-4 mb-2 flex items-center gap-1"><i data-lucide="leaf" class="w-4 h-4 text-green-500"></i> Menores consumidores</h4>`;
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
    const mediaDiariaPeriodoSemFuro = totalDias > 0 ? (totalConsumoSemFuro / totalDias) : totalConsumoSemFuro;
    const mediaDiariaPeriodoComFuro = totalDias > 0 ? (totalConsumoComFuro / totalDias) : totalConsumoComFuro;
    const mediaDiariaPeriodoSemFuroInt = toIntegerUnits(mediaDiariaPeriodoSemFuro, 'round');
    const mediaDiariaPeriodoComFuroInt = toIntegerUnits(mediaDiariaPeriodoComFuro, 'round');

    const includesSedeScope = movsEntrega.some(m => {
        const u = unidades.find(x => x.id === m.unidadeId);
        return normalizeUnidadeType(u?.tipo) === 'SEDE';
    });
    let blocoEquivalencia = '';
    if (itemType === 'agua') {
        const semanalSemFuro = toIntegerUnits(mediaDiariaPeriodoSemFuro * 5, 'round');
        const mensalSemFuro = toIntegerUnits(mediaDiariaPeriodoSemFuro * 22, 'round');
        const anualSemFuro = toIntegerUnits(mediaDiariaPeriodoSemFuro * 252, 'round');

        const semanalComFuro = toIntegerUnits(mediaDiariaPeriodoComFuro * 5, 'round');
        const mensalComFuro = toIntegerUnits(mediaDiariaPeriodoComFuro * 22, 'round');
        const anualComFuro = toIntegerUnits(mediaDiariaPeriodoComFuro * 252, 'round');

        blocoEquivalencia = `
        <div class="bg-blue-50 p-4 rounded-lg border border-blue-100 mt-4">
            <h5 class="font-bold text-blue-800 mb-2 flex items-center"><i data-lucide="calendar-clock" class="w-4 h-4 mr-2"></i> Projeção de Consumo (Dias Úteis)</h5>
            <p class="text-sm text-blue-900 mb-3">Considerando apenas dias úteis (Seg-Sex, exceto feriados):</p>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div class="bg-white/60 rounded-lg border border-blue-100 p-3">
                    <div class="font-semibold text-blue-900 mb-2">Sem Furo De Estoque</div>
                    <ul class="list-none space-y-1 text-sm text-blue-800">
                        <li class="flex items-center"><span class="font-bold w-24">Semanal:</span> <span>~${semanalSemFuro} un.</span></li>
                        <li class="flex items-center"><span class="font-bold w-24">Mensal:</span> <span>~${mensalSemFuro} un.</span></li>
                        <li class="flex items-center"><span class="font-bold w-24">Anual:</span> <span>~${anualSemFuro} un.</span></li>
                    </ul>
                </div>
                <div class="bg-white/60 rounded-lg border border-blue-100 p-3">
                    <div class="font-semibold text-blue-900 mb-2">Incluindo Furo De Estoque</div>
                    <ul class="list-none space-y-1 text-sm text-blue-800">
                        <li class="flex items-center"><span class="font-bold w-24">Semanal:</span> <span>~${semanalComFuro} un.</span></li>
                        <li class="flex items-center"><span class="font-bold w-24">Mensal:</span> <span>~${mensalComFuro} un.</span></li>
                        <li class="flex items-center"><span class="font-bold w-24">Anual:</span> <span>~${anualComFuro} un.</span></li>
                    </ul>
                </div>
            </div>
            ${furoQuantidade > 0 ? `
            <div class="mt-3 bg-yellow-50 border border-yellow-200 text-yellow-900 rounded-lg p-3 text-sm">
                <div class="font-semibold mb-1 flex items-center"><i data-lucide="alert-triangle" class="w-4 h-4 mr-2"></i> Alerta: Furo De Estoque</div>
                <div>Há <strong>${furoQuantidade}</strong> ${getItemLabel('agua', furoQuantidade)} lançados em <strong>Furo De Estoque</strong> no período. Não é possível saber para qual unidade esses galões foram destinados.</div>
            </div>
            ` : ''}
        </div>
        `;
    }

    if (itemType === 'gas') {
        const tabelaSemanal = document.getElementById('tabela-consumo-semanal-gas');
        if (tabelaSemanal) {
            tabelaSemanal.innerHTML = '';

            let baseMovs = (Array.isArray(allMovs) && allMovs.length > 0
                ? allMovs
                : Array.isArray(movsGroupFull) && movsGroupFull.length > 0
                    ? movsGroupFull
                    : movsEntrega
            ).filter(m => m && m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function');
            baseMovs = filterSedeBaselineIfNeeded(baseMovs.sort((a, b) => a.data.toMillis() - b.data.toMillis()), unidades, includesSedeScope);

            if (baseMovs.length === 0) {
                tabelaSemanal.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-gray-500 text-sm">Nenhuma unidade com consumo registrado no histórico.</td></tr>`;
            } else {
                const unidadeInfoMap = new Map(unidades.map(u => [u.id, {
                    nome: u.nome,
                    tipo: (
                        (() => {
                            let t = (u.tipo || 'OUTROS').toUpperCase();
                            if (t === 'SEMCAS') t = 'SEDE';
                            if (t === 'ABRIGO' || t === 'ACOLHER E AMAR') t = 'ABRIGO';
                            return t;
                        })()
                    )
                }]));

                const movsPorUnidadeId = baseMovs.reduce((acc, mov) => {
                    const info = unidadeInfoMap.get(mov.unidadeId);
                    if (!info) return acc;
                    const arr = acc.get(mov.unidadeId) || [];
                    arr.push(mov);
                    acc.set(mov.unidadeId, arr);
                    return acc;
                }, new Map());

                const linhas = Array.from(movsPorUnidadeId.entries())
                    .map(([unidadeId, movs]) => {
                        const info = unidadeInfoMap.get(unidadeId);
                        if (!info) return null;
                        const movsOrdenadas = [...movs].sort((a, b) => a.data.toMillis() - b.data.toMillis());
                        const primeira = movsOrdenadas[0].data.toDate();
                        const ultima = movsOrdenadas[movsOrdenadas.length - 1].data.toDate();
                        const totalHistorico = movsOrdenadas.reduce((sum, m) => sum + (m.quantidade || 0), 0);
                        const qtdeUltima = movsOrdenadas[movsOrdenadas.length - 1].quantidade || 0;
                        const totalParaMedia = Math.max(0, totalHistorico - qtdeUltima);
                        const diasIntervalo = Math.max(1, countDiasUteis(primeira, ultima));
                        const mediaDiaria = totalParaMedia > 0 ? (totalParaMedia / diasIntervalo) : (movsOrdenadas[0].quantidade || 0);
                        const semanalFloat = mediaDiaria * 7;
                        const semanal = totalHistorico > 0 && semanalFloat < 1 ? 1 : toIntegerUnits(semanalFloat, 'round');
                        return {
                            tipo: info.tipo,
                            nome: info.nome,
                            semanal
                        };
                    })
                    .filter(Boolean)
                    .filter(l => l.semanal > 0)
                    .sort((a, b) => {
                        if (a.tipo === b.tipo) {
                            return a.nome.localeCompare(b.nome);
                        }
                        return a.tipo.localeCompare(b.tipo);
                    });

                if (linhas.length === 0) {
                    tabelaSemanal.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-gray-500 text-sm">Nenhuma unidade com consumo registrado no histórico.</td></tr>`;
                } else {
                    linhas.forEach(l => {
                        const row = document.createElement('tr');
                        row.innerHTML = `
                            <td>${escapeHTML(l.tipo)}</td>
                            <td>${escapeHTML(l.nome)}</td>
                            <td class="text-center font-semibold">${l.semanal}</td>
                        `;
                        tabelaSemanal.appendChild(row);
                    });
                }
            }
        }
    }

    let mediaDiariaHistorica = 0;
    const movsGroupFullBase = Array.isArray(movsGroupFull) ? movsGroupFull.filter(m => m && m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function').sort((a, b) => a.data.toMillis() - b.data.toMillis()) : [];
    const movsGroupFullAdj = filterSedeBaselineIfNeeded(movsGroupFullBase, unidades, includesSedeScope);
    if (Array.isArray(movsGroupFullAdj) && movsGroupFullAdj.length > 0) {
        const movsHistSemFuro = itemType === 'agua'
            ? movsGroupFullAdj.filter(m => {
                const u = unidades.find(x => x.id === m.unidadeId);
                const nome = u?.nome || m.unidadeNome || '';
                return !isFuroDeEstoqueNome(nome);
            })
            : movsGroupFullAdj;
        const { totalDias: diasHist } = getPeriodoAnalise(movsHistSemFuro);
        const totalHist = movsHistSemFuro.reduce((sum, m) => sum + (m.quantidade || 0), 0);
        mediaDiariaHistorica = diasHist > 0 ? (totalHist / diasHist) : totalHist;
    }
    const esperadoPeriodo = mediaDiariaHistorica * totalDias;
    const esperadoPeriodoInt = toIntegerUnits(esperadoPeriodo, 'round');
    const desvioAbs = totalConsumoSemFuro - esperadoPeriodoInt;
    const desvioPerc = esperadoPeriodoInt > 0 ? ((desvioAbs / esperadoPeriodoInt) * 100) : 0;
    const picoEntrega = movsEntrega.reduce((max, m) => Math.max(max, m.quantidade || 0), 0);

    let relatorioText = `
        <p><i data-lucide="calendar" class="w-3.5 h-3.5 inline-block mr-1"></i> Período: <strong>${formatTimestamp(dataInicial)}</strong> a <strong>${formatTimestamp(dataFinal)}</strong> (<strong>${totalDias} dias úteis</strong>).</p>
        <p><i data-lucide="package" class="w-3.5 h-3.5 inline-block mr-1"></i> Consumo total (sem Furo De Estoque): <strong>${totalConsumoSemFuro} un.</strong></p>
        ${itemType === 'agua' && furoQuantidade > 0 ? `<p><i data-lucide="alert-triangle" class="w-3.5 h-3.5 inline-block mr-1 text-yellow-600"></i> Furo De Estoque (destino desconhecido): <strong>${furoQuantidade} un.</strong></p>` : ``}
        ${itemType === 'agua' ? `<p><i data-lucide="package" class="w-3.5 h-3.5 inline-block mr-1"></i> Total incluindo Furo De Estoque: <strong>${totalConsumoComFuro} un.</strong></p>` : ``}
        <p><i data-lucide="scale" class="w-3.5 h-3.5 inline-block mr-1"></i> Média por dia útil (sem Furo): <strong>${mediaDiariaPeriodoSemFuroInt} un.</strong> (histórico: <strong>${toIntegerUnits(mediaDiariaHistorica, 'round')} un.</strong>).</p>
        ${itemType === 'agua' ? `<p><i data-lucide="scale" class="w-3.5 h-3.5 inline-block mr-1"></i> Média por dia útil (incluindo Furo): <strong>${mediaDiariaPeriodoComFuroInt} un.</strong></p>` : ``}
        <p><i data-lucide="trending-up" class="w-3.5 h-3.5 inline-block mr-1"></i> Desvio vs previsão histórica: <strong>${desvioAbs} un.</strong> (${desvioPerc.toFixed(1)}%).</p>
        ${blocoEquivalencia}
    `;
    if (ranking.length > 0) {
        relatorioText += `<p><i data-lucide="award" class="w-3.5 h-3.5 inline-block mr-1 text-yellow-500"></i> Destaque: <strong>${ranking[0].nome}</strong> consumiu <strong>${ranking[0].consumo} un.</strong> (${totalConsumoSemFuro > 0 ? ((ranking[0].consumo / totalConsumoSemFuro) * 100).toFixed(1) : '0.0'}% do total).</p>`;
        const menorConsumo = ranking[ranking.length - 1];
        relatorioText += `<p><i data-lucide="chevron-down" class="w-3.5 h-3.5 inline-block mr-1 text-blue-500"></i> Menor consumo: <strong>${menorConsumo.nome}</strong> com <strong>${menorConsumo.consumo} un.</strong>.</p>`;
    }
    const consumoAtualPorUnidadeId = movsEntrega.reduce((acc, m) => {
        acc[m.unidadeId] = (acc[m.unidadeId] || 0) + (m.quantidade || 0);
        return acc;
    }, {});
    const movsHistBaseParaUnidades = (itemType === 'agua'
        ? movsGroupFullAdj.filter(m => {
            const u = unidades.find(x => x.id === m.unidadeId);
            const nome = u?.nome || m.unidadeNome || '';
            return !isFuroDeEstoqueNome(nome);
        })
        : movsGroupFullAdj
    ).filter(m => m && m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function');
    const movsHistPorUnidade = movsHistBaseParaUnidades.reduce((acc, m) => {
        const arr = acc.get(m.unidadeId) || [];
        arr.push(m);
        acc.set(m.unidadeId, arr);
        return acc;
    }, new Map());
    const esperadoPorUnidade = new Map();
    movsHistPorUnidade.forEach((arr, uid) => {
        const movsOrdenadas = [...arr].sort((a, b) => a.data.toMillis() - b.data.toMillis());
        const primeira = movsOrdenadas[0].data.toDate();
        const ultima = movsOrdenadas[movsOrdenadas.length - 1].data.toDate();
        const totalHistorico = movsOrdenadas.reduce((sum, m) => sum + (m.quantidade || 0), 0);
        const qtdeUltima = movsOrdenadas[movsOrdenadas.length - 1].quantidade || 0;
        const totalParaMedia = Math.max(0, totalHistorico - qtdeUltima);
        const diasHist = Math.max(1, countDiasUteis(primeira, ultima));
        const mediaHistDia = totalParaMedia > 0 ? (totalParaMedia / diasHist) : (movsOrdenadas[0].quantidade || 0);
        esperadoPorUnidade.set(uid, mediaHistDia * totalDias);
    });
    const anomaliasAlta = [];
    const anomaliasBaixa = [];
    Object.keys(consumoAtualPorUnidadeId).forEach(uid => {
        const atual = consumoAtualPorUnidadeId[uid];
        const esperadoFloat = esperadoPorUnidade.get(uid) || 0;
        const esperado = Math.max(0, toIntegerUnits(esperadoFloat, 'round'));
        const diff = atual - esperado;
        const perc = esperado > 0 ? ((diff / esperado) * 100) : (atual > 0 ? 100 : 0);
        const unidade = unidades.find(u => u.id === uid);
        const nome = unidade ? unidade.nome : uid;
        const registro = { uid, nome, atual, esperado, diff, perc };
        if (diff >= 0) anomaliasAlta.push(registro); else anomaliasBaixa.push(registro);
    });
    anomaliasAlta.sort((a, b) => b.diff - a.diff);
    anomaliasBaixa.sort((a, b) => a.diff - b.diff);
    const limiarPerc = 25;
    const destaqueAlta = anomaliasAlta.filter(a => a.esperado > 0 && a.perc >= limiarPerc).slice(0, 5);
    const destaqueBaixa = anomaliasBaixa.filter(a => a.esperado > 0 && Math.abs(a.perc) >= limiarPerc).slice(0, 5);

    if (destaqueAlta.length > 0 || destaqueBaixa.length > 0) {
        relatorioText += `<p class="mt-3"><i data-lucide="alert-circle" class="w-3.5 h-3.5 inline-block mr-1 text-red-500"></i> <strong>Unidades fora do padrão (variação relevante):</strong></p>`;
        if (destaqueAlta.length > 0) {
            relatorioText += `<ul class="list-disc ml-5 text-sm text-gray-700">`;
            destaqueAlta.forEach(a => {
                const maisMenos = a.diff >= 0 ? 'a mais' : 'a menos';
                relatorioText += `<li><strong>${a.nome}</strong>: consumiu ${a.atual} un. no período. Normalmente consome cerca de ${a.esperado} un. nesse intervalo. Diferença: ${Math.abs(a.diff)} un. ${maisMenos} (${a.perc.toFixed(1)}%).</li>`;
            });
            relatorioText += `</ul>`;
        }
        if (destaqueBaixa.length > 0) {
            relatorioText += `<ul class="list-disc ml-5 text-sm text-gray-700 mt-2">`;
            destaqueBaixa.forEach(a => {
                const maisMenos = a.diff >= 0 ? 'a mais' : 'a menos';
                relatorioText += `<li><strong>${a.nome}</strong>: consumiu ${a.atual} un. no período. Normalmente consome cerca de ${a.esperado} un. nesse intervalo. Diferença: ${Math.abs(a.diff)} un. ${maisMenos} (${a.perc.toFixed(1)}%).</li>`;
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
        const movsHistAnoBase = (itemType === 'agua'
            ? movsGroupFullAdj.filter(m => {
                const u = unidades.find(x => x.id === m.unidadeId);
                const nome = u?.nome || m.unidadeNome || '';
                return !isFuroDeEstoqueNome(nome);
            })
            : movsGroupFullAdj
        ).filter(m => m && m.tipo === 'entrega' && m.data && typeof m.data.toDate === 'function');
        const movsHistAnoPorUnidade = movsHistAnoBase.reduce((acc, m) => {
            const arr = acc.get(m.unidadeId) || [];
            arr.push(m);
            acc.set(m.unidadeId, arr);
            return acc;
        }, new Map());
        const mediaDiaHistPorUnidade = new Map();
        movsHistAnoPorUnidade.forEach((arr, uid) => {
            const movsOrdenadas = [...arr].sort((a, b) => a.data.toMillis() - b.data.toMillis());
            const primeira = movsOrdenadas[0].data.toDate();
            const ultima = movsOrdenadas[movsOrdenadas.length - 1].data.toDate();
            const totalHistorico = movsOrdenadas.reduce((sum, m) => sum + (m.quantidade || 0), 0);
            const qtdeUltima = movsOrdenadas[movsOrdenadas.length - 1].quantidade || 0;
            const totalParaMedia = Math.max(0, totalHistorico - qtdeUltima);
            const diasHist = Math.max(1, countDiasUteis(primeira, ultima));
            const mediaHistDia = totalParaMedia > 0 ? (totalParaMedia / diasHist) : (movsOrdenadas[0].quantidade || 0);
            mediaDiaHistPorUnidade.set(uid, mediaHistDia);
        });
        const extremos = [];
        Object.keys(consumoPorMesUnidade).sort().forEach(k => {
            const [y, m] = k.split('-');
            const ano = parseInt(y, 10);
            const mes = parseInt(m, 10);
            const inicioMes = new Date(ano, mes - 1, 1, 0, 0, 0, 0);
            const fimMes = new Date(ano, mes, 0, 23, 59, 59, 999);
            const diasNoMes = Math.max(1, countDiasUteis(inicioMes, fimMes));
            const etiquetaMes = `${monthNames[parseInt(m,10)-1]}/${y}`;
            const porUnid = consumoPorMesUnidade[k];
            Object.keys(porUnid).forEach(uid => {
                const atual = porUnid[uid];
                const mediaDia = mediaDiaHistPorUnidade.get(uid) || 0;
                const esperadoFloat = mediaDia * diasNoMes;
                const esperado = Math.max(0, toIntegerUnits(esperadoFloat, 'round'));
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
                const iconStr = e.diff >= 0 ? '<i data-lucide="flame" class="w-3.5 h-3.5 inline-block mr-1 text-orange-500"></i>' : '<i data-lucide="arrow-down" class="w-3.5 h-3.5 inline-block mr-1 text-blue-500"></i>';
                return `<p>${iconStr} ${e.etiquetaMes}: <strong>${e.nome}</strong> consumiu ${Math.abs(e.diff)} un. ${maisMenos} do normal (atual ${e.atual} • esperado ${e.esperado}).</p>`;
            }).join('')}</div>`;
        }
    }

    relatorioEl.innerHTML = relatorioText;

    if (resumoExecEl) {
        resumoExecEl.innerHTML = `
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div class="text-xs text-gray-500">Consumo Total (Sem Furo)</div>
                <div class="text-2xl font-bold text-gray-800">${totalConsumoSemFuro}</div>
                <div class="text-xs text-gray-500">${formatTimestamp(dataInicial)} — ${formatTimestamp(dataFinal)}</div>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div class="text-xs text-gray-500">Furo De Estoque</div>
                <div class="text-2xl font-bold ${furoQuantidade > 0 ? 'text-yellow-700' : 'text-gray-800'}">${itemType === 'agua' ? furoQuantidade : 0}</div>
                <div class="text-xs text-gray-500">Destino desconhecido</div>
            </div>
            <div class="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                <div class="text-xs text-gray-500">Total (Incluindo Furo)</div>
                <div class="text-2xl font-bold text-gray-800">${totalConsumoComFuro}</div>
                <div class="text-xs text-gray-500">Pico: ${picoEntrega} un. • Desvio: ${desvioPerc.toFixed(1)}%</div>
            </div>
        `;
    }

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
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
        const nomeSafe = escapeHTML(nome);
        const unidadeIdSafe = escapeHTML(unidadeId);
        const itemTypeSafe = escapeHTML(itemType);
        html += `
            <span class="exclusao-item">
                ${nomeSafe}
                <button type="button" class="btn-remove-exclusao" data-item-type="${itemTypeSafe}" data-unidade-id="${unidadeIdSafe}" title="Remover">&times;</button>
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
                                    label += toIntegerUnits(context.parsed.y, 'round');
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
            let includesSedeScope = false;

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
                includesSedeScope = normalizeUnidadeType(unidade.tipo) === 'SEDE';

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
                includesSedeScope = String(tipo).toUpperCase() === 'SEDE';

            } else if (modo === 'completo') {
                tituloPrevisao = `Previsão Geral (Todas Unidades)`;
                const unidadesConsideradasObjs = unidades.filter(u => !exclusoes.includes(u.id));
                unidadesConsideradas = unidadesConsideradasObjs.map(u => u.nome).sort();
                const idsUnidadesConsideradas = unidadesConsideradasObjs.map(u => u.id);
                movsFiltradas = movsEntrega.filter(m => idsUnidadesConsideradas.includes(m.unidadeId));
                includesSedeScope = unidadesConsideradasObjs.some(u => normalizeUnidadeType(u.tipo) === 'SEDE');
            }

            movsFiltradas = filterSedeBaselineIfNeeded(movsFiltradas, unidades, includesSedeScope);

            if (movsFiltradas.length < 2) {
                 showAlert(alertId, `Dados insuficientes para calcular a previsão (${tituloPrevisao}). É necessário pelo menos 2 registros de entrega válidos no período.`, 'info');
                throw new Error("Dados insuficientes.");
            }

            // =========================================================================
            // CORREÇÃO MATEMÁTICA DA PREVISÃO: Lógica de Intervalo Real (DIAS ÚTEIS)
            // =========================================================================
            const primeiraMovDate = movsFiltradas[0].data.toDate();
            const ultimaMovDate = movsFiltradas[movsFiltradas.length - 1].data.toDate();
            const qtdeUltimaEntrega = movsFiltradas[movsFiltradas.length - 1].quantidade;

            const totalConsumidoHistorico = movsFiltradas.reduce((sum, m) => sum + m.quantidade, 0);
            
            // Para calcular a MÉDIA DIÁRIA de consumo, não devemos contar a última entrega inteira,
            // pois ela acabou de chegar e serve para o futuro. 
            // Consideramos que o total consumido no período [PrimeiraData -> ÚltimaData] 
            // é tudo o que foi entregue ANTES da última data.
            const totalParaCalculoMedia = totalConsumidoHistorico - qtdeUltimaEntrega;
            
            // Cálculo preciso de dias úteis entre a primeira e a última entrega
            const diasIntervalo = Math.max(1, countDiasUteis(primeiraMovDate, ultimaMovDate)); 

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
                 warningEl.textContent = `Aviso: O histórico de dados considerado é curto (${diasIntervalo} dias entre a primeira e última entrega). A previsão pode ser menos precisa.`;
                 if (alertEl) {
                     alertEl.appendChild(warningEl);
                     alertEl.style.display = 'block';
                 }
            }

            const previsaoBase = mediaDiaria * diasPrevisao;
            const valorMargem = previsaoBase * (margemSeguranca / 100);
            const previsaoFinal = previsaoBase + valorMargem;
            const previsaoFinalInt = toIntegerUnits(previsaoFinal, 'ceil');
            const previsaoBaseInt = toIntegerUnits(previsaoBase, 'ceil');
            const valorMargemInt = Math.max(0, previsaoFinalInt - previsaoBaseInt);
            const mediaDiariaInt = Math.max(0, toIntegerUnits(mediaDiaria, 'round'));
            const previsaoDiariaInt = Math.max(0, toIntegerUnits(previsaoFinalInt / diasPrevisao, 'round'));

            const unidadesExcluidasNomes = exclusoes
                .map(id => unidades.find(u => u.id === id)?.nome || `ID:${id.substring(0,4)}...`)
                .filter(Boolean)
                .sort();

            const tituloPrevisaoSafe = escapeHTML(tituloPrevisao);
            const unidadesConsideradasSafe = (unidadesConsideradas || []).map(escapeHTML);
            const unidadesExcluidasNomesSafe = (unidadesExcluidasNomes || []).map(escapeHTML);

            resultadoContentEl.innerHTML = `
                <h4 class="text-lg font-bold text-white mb-4">${tituloPrevisaoSafe}</h4>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-center">
                    <div class="bg-white/10 p-4 rounded-lg">
                        <span class="block text-sm text-white/80 uppercase">Período Analisado</span>
                        <span class="block text-2xl font-bold">${diasIntervalo} dias úteis</span>
                        <span class="block text-xs text-white/60">(${movsFiltradas.length} entregas)</span>
                    </div>
                    <div class="bg-white/10 p-4 rounded-lg">
                        <span class="block text-sm text-white/80 uppercase">Total Consumido (Histórico)</span>
                        <span class="block text-2xl font-bold">${totalConsumidoHistorico} un.</span>
                    </div>
                </div>
                <div class="bg-white/20 p-4 rounded-lg mt-4">
                    <span class="block text-center text-sm text-white/80 uppercase">Consumo Médio por Dia Útil</span>
                    <span class="block text-center text-4xl font-bold">${mediaDiariaInt} un./dia</span>
                </div>
                <hr class="border-white/20 my-4">
                <h4 class="text-lg font-bold text-white mb-2">Previsão para ${diasPrevisao} dias úteis:</h4>
                <div class="grid grid-cols-3 gap-2 text-center text-sm">
                    <div class="bg-white/10 p-3 rounded-lg">
                        <span class="block text-white/80">Base</span>
                        <span class="block font-bold text-lg">${previsaoBaseInt} un.</span>
                    </div>
                    <div class="bg-white/10 p-3 rounded-lg">
                        <span class="block text-white/80">+ Margem (${margemSeguranca}%)</span>
                        <span class="block font-bold text-lg">${valorMargemInt} un.</span>
                    </div>
                    <div class="bg-white/90 text-blue-900 p-3 rounded-lg">
                        <span class="block font-bold">Total Recomendado</span>
                        <span class="block font-bold text-xl">${previsaoFinalInt} un.</span>
                    </div>
                </div>
                ${ (modo === 'por-tipo' || modo === 'completo') ? `
                <details class="mt-4 text-xs text-white/70">
                    <summary class="cursor-pointer hover:text-white">Unidades consideradas (${unidadesConsideradas.length})</summary>
                    <p class="mt-1 bg-black/20 p-2 rounded">${unidadesConsideradasSafe.join(', ')}</p>
                </details>
                ` : ''}
                ${ exclusoes.length > 0 ? `
                <details class="mt-2 text-xs text-white/70">
                     <summary class="cursor-pointer hover:text-white">Unidades excluídas (${unidadesExcluidasNomes.length})</summary>
                     <p class="mt-1 bg-black/20 p-2 rounded">${unidadesExcluidasNomesSafe.join(', ')}</p>
                 </details>
                ` : ''}
            `;
            resultadoContainer.classList.remove('hidden');

            const chartData = {
                labels: ['Média Diária (Histórico)', `Previsão Diária (Próximos ${diasPrevisao} dias)`],
                datasets: [{
                    label: `Consumo Diário (${itemType === 'agua' ? 'Água' : 'Gás'})`,
                    data: [mediaDiariaInt, previsaoDiariaInt],
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
    DOM_ELEMENTS.btnAnalisarConsumoGas?.addEventListener('click', gerarConsumoSemanalGasHistorico);

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

    // Listeners para atualização dinâmica do relatório semanal de gás (intervalo de anos)
    const anoInicioGas = document.getElementById('analise-ano-inicio-gas');
    const anoFimGas = document.getElementById('analise-ano-fim-gas');
    if (anoInicioGas && anoFimGas) {
        const updateGas = () => analisarConsumoPorPeriodo('gas');
        anoInicioGas.addEventListener('change', updateGas);
        anoFimGas.addEventListener('change', updateGas);
    }

    console.log("[Previsão] Listeners inicializados.");
}
