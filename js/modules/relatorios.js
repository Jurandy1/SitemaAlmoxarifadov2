// js/modules/relatorios.js
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAguaMovimentacoes, getGasMovimentacoes } from "../utils/cache.js";
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { dateToTimestamp, formatTimestamp, getTodayDateString } from "../utils/formatters.js"; // Importa getTodayDateString
import { isReady } from "./auth.js";
import { auth } from "../services/firestore-service.js";

/**
 * Converte uma URL de imagem em DataURL base64 para uso no PDF.
 */
async function toDataURL(url) {
    try {
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const blob = await resp.blob();
        return await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Falha ao ler imagem'));
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn('Logo não carregada, seguindo sem imagem:', e);
        return null;
    }
}

// Reencode de imagem via Canvas para evitar PNGs inválidos
async function loadImageDataUrl(url) {
    try {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = `${url}?v=${Date.now()}`;
        await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = () => reject(new Error('Falha ao carregar imagem'));
        });
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        return canvas.toDataURL('image/png', 0.92);
    } catch (e) {
        // Fallback para leitor de blob
        try { return await toDataURL(url); } catch { return null; }
    }
}

// Inserção segura de imagem no jsPDF sem abortar o relatório
function safeAddImage(doc, dataUrl, defaultFormat, x, y, w, h) {
    if (!dataUrl) return false;
    try {
        const fmt = dataUrl.startsWith('data:image/png') ? 'PNG'
            : dataUrl.startsWith('data:image/jpeg') ? 'JPEG'
            : (defaultFormat || 'PNG');
        doc.addImage(dataUrl, fmt, x, y, w, h);
        return true;
    } catch (e) {
        console.warn('Imagem inválida ao inserir no PDF, seguindo sem imagem.', e);
        return false;
    }
}

function moedaBRL(valor) {
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0); }
    catch { return `R$ ${(valor || 0).toFixed(2)}`; }
}

/**
 * Lida com a geração do relatório em PDF (usando jspdf).
 */
export async function handleGerarPdf() {
    if (!isReady()) { showAlert('alert-relatorio', 'Erro: Não autenticado.', 'error'); return; }
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        showAlert('alert-relatorio', 'Erro: Biblioteca jsPDF não carregada. Tente recarregar a página.', 'error'); return;
    }
    
    const { jsPDF } = window.jspdf;

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const tipo = DOM_ELEMENTS.relatorioTipo.value; 
    const dataInicioStr = DOM_ELEMENTS.relatorioDataInicio.value;
    const dataFimStr = DOM_ELEMENTS.relatorioDataFim.value;

    if (!dataInicioStr || !dataFimStr) { showAlert('alert-relatorio', 'Selecione a data de início e fim.', 'warning'); return; }

    const dataInicio = dateToTimestamp(dataInicioStr).toMillis();
    const dataFim = dateToTimestamp(dataFimStr).toMillis() + (24 * 60 * 60 * 1000 - 1); 

    const movimentacoes = (tipo === 'agua' ? getAguaMovimentacoes() : getGasMovimentacoes());
    const tipoLabel = (tipo === 'agua' ? 'Água' : 'Gás');

    const movsFiltradas = movimentacoes.filter(m => { 
        const mData = m.data?.toMillis(); 
        return m.tipo === 'entrega' && mData >= dataInicio && mData <= dataFim; 
    });

    if (movsFiltradas.length === 0) { showAlert('alert-relatorio', 'Nenhum dado de entrega encontrado para este período.', 'info'); return; }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.btnGerarPdf.disabled = true; 
    DOM_ELEMENTS.btnGerarPdf.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        const doc = new jsPDF('p', 'mm', 'a4');
        if (typeof doc.autoTable !== 'function') {
            showAlert('alert-relatorio', 'Erro: Módulo AutoTable não carregado. Verifique a internet ou recarregue a página.', 'error');
            return;
        }
        const logoDataUrl = await loadImageDataUrl('SaoLuis.png');

        // Cabeçalho institucional aprimorado
        const MARGIN_LEFT = 14;
        const MARGIN_RIGHT = 14;
        const CONTENT_WIDTH = doc.internal.pageSize.getWidth() - MARGIN_LEFT - MARGIN_RIGHT;
        safeAddImage(doc, logoDataUrl, 'PNG', MARGIN_LEFT, 10, 22, 22);
        doc.setFillColor(11, 61, 145);
        doc.roundedRect(MARGIN_LEFT + 26, 10, CONTENT_WIDTH - 26, 14, 3, 3, 'F');
        doc.setTextColor(255);
        doc.setFontSize(14);
        doc.text('Relatório de Consumo e Custos', MARGIN_LEFT + 32, 20);
        doc.setTextColor(51, 65, 85);
        doc.setFontSize(10);
        const userEmail = (auth?.currentUser?.email) || 'Operador Anônimo';
        doc.text(`Tipo: ${tipoLabel} | Período: ${formatTimestamp(Timestamp.fromMillis(dataInicio))} a ${formatTimestamp(Timestamp.fromMillis(dataFim))}`, MARGIN_LEFT, 36);
        doc.text(`Emitido por: ${userEmail} em ${new Date().toLocaleString('pt-BR')}`, MARGIN_LEFT, 41);

        // Dados agregados básicos
        const abastecimentoMap = new Map();
        const responsavelMap = new Map();
        movsFiltradas.forEach(m => {
            const unidade = m.unidadeNome || 'Desconhecida';
            const resp = m.responsavel || 'Não identificado';
            const qtd = Number(m.quantidade || 0);
            abastecimentoMap.set(unidade, (abastecimentoMap.get(unidade) || 0) + qtd);
            responsavelMap.set(resp, (responsavelMap.get(resp) || 0) + qtd);
        });

        const diasPeriodo = Math.max(1, Math.ceil((dataFim - dataInicio + 1) / (1000 * 60 * 60 * 24)));

        // Função de gráfico diário (se Chart.js disponível)
        const makeDailyChartImage = (movs, label) => {
            try {
                if (!window.Chart) return null;
                const canvas = document.createElement('canvas');
                canvas.width = 800; canvas.height = 300;
                const ctx = canvas.getContext('2d');
                const dias = {};
                movs.forEach((m) => {
                    const d = new Date(m.data?.toMillis ? m.data.toMillis() : m.data);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    dias[key] = (dias[key] || 0) + 1;
                });
                const labels = Object.keys(dias).sort();
                const dataVals = labels.map((k) => dias[k]);
                const chart = new window.Chart(ctx, {
                    type: 'line',
                    data: { labels, datasets: [{ label, data: dataVals, borderColor: '#0B3D91', backgroundColor: 'rgba(11,61,145,0.15)', tension: 0.35 }] },
                    options: { plugins: { legend: { display: true } }, scales: { y: { beginAtZero: true } } }
                });
                const url = canvas.toDataURL('image/png');
                chart.destroy();
                return url;
            } catch (_) { return null; }
        };

        if (tipo === 'agua') {
            // Parâmetros de custo (lidos da UI com defaults)
            const parseOrDefault = (value, fallback) => {
                const n = Number(String(value || '').replace(',', '.'));
                return Number.isFinite(n) && n >= 0 ? n : fallback;
            };
            const custoGalao = parseOrDefault(DOM_ELEMENTS.relatorioCustoGalao?.value, 12.0); // custo médio por galão 20L
            const litrosPorGalao = parseOrDefault(DOM_ELEMENTS.relatorioLitrosPorGalao?.value, 20);
            const custoMensalIndustrialEnergia = parseOrDefault(DOM_ELEMENTS.relatorioCustoIndustrialEnergia?.value, 80);
            const custoMensalIndustrialFiltro = parseOrDefault(DOM_ELEMENTS.relatorioCustoIndustrialFiltro?.value, 50);
            const custoMensalFiltroSimples = parseOrDefault(DOM_ELEMENTS.relatorioCustoFiltroRede?.value, 50);
            const limiteBaixo = parseOrDefault(DOM_ELEMENTS.relatorioLimiteBaixoLitros?.value, 300);
            const limiteAlto = parseOrDefault(DOM_ELEMENTS.relatorioLimiteAltoLitros?.value, 1200);
            // Análise por unidade (objetos) para tabelas separadas
            const analiseAgua = Array.from(abastecimentoMap.entries()).map(([unidade, galoesPeriodo]) => {
                const litrosPeriodo = galoesPeriodo * litrosPorGalao;
                const litrosMensalEstimado = Math.round((litrosPeriodo / diasPeriodo) * 30);
                const galoesMensaisEstimados = Math.ceil(litrosMensalEstimado / litrosPorGalao);
                const custos = {
                    galoesMes: galoesMensaisEstimados * custoGalao,
                    industrialMes: custoMensalIndustrialEnergia + custoMensalIndustrialFiltro,
                    filtroMes: custoMensalFiltroSimples,
                };
                let recomendacao = 'Galão 20L';
                let justificativa = 'Consumo moderado, logística de galões é suficiente.';
                if (litrosMensalEstimado <= limiteBaixo) {
                    recomendacao = 'Filtro (rede)'; justificativa = 'Baixo consumo; filtro reduz custos e logística.';
                } else if (litrosMensalEstimado > limiteAlto) {
                    recomendacao = 'Bebedouro industrial'; justificativa = 'Alto consumo; equipamento contínuo e eficiente.';
                }
                return { unidade, galoesPeriodo, litrosPeriodo, litrosMensalEstimado, custos, recomendacao, justificativa };
            }).sort((a,b) => b.litrosMensalEstimado - a.litrosMensalEstimado);

            // KPIs
            const totalGaloes = Array.from(abastecimentoMap.values()).reduce((s, v) => s + v, 0);
            const totalLitrosPeriodo = totalGaloes * litrosPorGalao;
            const litrosMensalTotal = Math.round((totalLitrosPeriodo / diasPeriodo) * 30);
            const drawKpiBox = (x, y, title, value, color = [11, 61, 145]) => {
                doc.setDrawColor(color[0], color[1], color[2]);
                doc.setFillColor(color[0], color[1], color[2]);
                doc.roundedRect(x, y, 55, 22, 3, 3, 'FD');
                doc.setTextColor(255);
                doc.setFontSize(9); doc.text(title, x + 6, y + 9);
                doc.setFontSize(13); doc.text(String(value), x + 6, y + 16);
                doc.setTextColor(40);
            };
            let y = 48;
            drawKpiBox(MARGIN_LEFT, y, 'Galões entregues', totalGaloes);
            drawKpiBox(MARGIN_LEFT + 60, y, 'Litros entregues', totalLitrosPeriodo);
            drawKpiBox(MARGIN_LEFT + 120, y, 'Consumo mensal (L)', litrosMensalTotal);
            y += 30;

            // Tabela 1: Abastecimento por Unidade
            doc.setFontSize(12); doc.setTextColor(40);
            doc.text('Abastecimento por Unidade (Água)', MARGIN_LEFT, y);
            y += 6;
            doc.autoTable({
                startY: y,
                head: [['Unidade', 'Galões (período)', 'Litros (período)', 'Consumo mensal (L)']],
                body: analiseAgua.map(a => [a.unidade, a.galoesPeriodo, a.litrosPeriodo, a.litrosMensalEstimado]),
                theme: 'striped',
                headStyles: { fillColor: [11, 61, 145], textColor: 255, fontSize: 10, halign: 'center', valign: 'middle' },
                styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, overflow: 'linebreak', minCellHeight: 8 },
                columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 35, halign: 'right' }, 2: { cellWidth: 35, halign: 'right' }, 3: { cellWidth: 38, halign: 'right' } },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });
            y = (doc.lastAutoTable?.finalY || y) + 8;

            // Tabela 2: Recomendações e Custos
            doc.setFontSize(12); doc.setTextColor(40);
            doc.text('Recomendações e Custos', MARGIN_LEFT, y);
            y += 6;
            doc.autoTable({
                startY: y,
                head: [['Unidade', 'Recomendação', 'Custo Galão/mês', 'Custo Filtro/mês', 'Custo Industrial/mês']],
                body: analiseAgua.map(a => [a.unidade, a.recomendacao, moedaBRL(a.custos.galoesMes), moedaBRL(a.custos.filtroMes), moedaBRL(a.custos.industrialMes)]),
                theme: 'striped',
                headStyles: { fillColor: [11, 61, 145], textColor: 255, fontSize: 10, halign: 'center', valign: 'middle' },
                styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 }, overflow: 'linebreak', minCellHeight: 8 },
                columnStyles: { 0: { cellWidth: 40 }, 1: { cellWidth: 60, overflow: 'linebreak' }, 2: { cellWidth: 28, halign: 'right' }, 3: { cellWidth: 28, halign: 'right' }, 4: { cellWidth: 28, halign: 'right' } },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });
            y = (doc.lastAutoTable?.finalY || y) + 8;

            // Tabela 3: Entregas por Responsável
            const responsavelData = Array.from(responsavelMap.entries()).sort((a,b) => b[1] - a[1]).map(entry => [entry[0], entry[1]]);
            doc.setFontSize(12); doc.setTextColor(40); doc.text('Entregas por Responsável', MARGIN_LEFT, y);
            y += 6;
            doc.autoTable({
                startY: y,
                head: [['Responsável', 'Entregas (galões)']],
                body: responsavelData,
                theme: 'striped',
                headStyles: { fillColor: [41, 128, 185], fontSize: 10, halign: 'center' },
                styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 } },
                columnStyles: { 0: { cellWidth: 120 }, 1: { halign: 'right' } },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });
            y = (doc.lastAutoTable?.finalY || y) + 8;

            // Ranking Top 10 — Água
            const rankingAgua = analiseAgua.map(a => ({ unidade: a.unidade, litrosMes: a.litrosMensalEstimado }))
                .sort((a,b) => b.litrosMes - a.litrosMes).slice(0, 10);
            doc.setFontSize(12); doc.setTextColor(40); doc.text('Ranking de Consumo — Água (Top 10)', MARGIN_LEFT, y);
            y += 6;
            doc.autoTable({
                startY: y,
                head: [['Posição', 'Unidade', 'Consumo mensal (L)']],
                body: rankingAgua.map((r, idx) => [idx + 1, r.unidade, r.litrosMes]),
                theme: 'striped',
                headStyles: { fillColor: [11, 61, 145], textColor: 255, fontSize: 10, halign: 'center' },
                styles: { fontSize: 10, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 } },
                columnStyles: { 0: { cellWidth: 22, halign: 'center' }, 1: { cellWidth: 95 }, 2: { halign: 'right' } },
                didParseCell: (data) => {
                    if (data.section === 'body' && data.row.index <= 2) { data.cell.styles.fillColor = [253, 247, 228]; }
                },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });
            y = (doc.lastAutoTable?.finalY || y) + 8;

            // Gráfico diário
            const chartImg = makeDailyChartImage(movsFiltradas, 'Entregas por dia');
            if (chartImg) {
                doc.setFontSize(12); doc.setTextColor(40); doc.text('Tendência de Entregas (diária)', MARGIN_LEFT, y);
                y += 6;
                const ok = safeAddImage(doc, chartImg, 'PNG', MARGIN_LEFT, y, CONTENT_WIDTH, 60);
                y += ok ? 68 : 0;
            }

            // Recomendações gerais
            doc.setFontSize(12); doc.setTextColor(40); doc.text('Recomendações Gerais', MARGIN_LEFT, y);
            y += 6; doc.setFontSize(10); doc.setTextColor(80);
            const pontos = [
                'Padronizar filtros nas unidades de baixo volume para reduzir custos.',
                'Avaliar fornecimento industrial nas unidades de alto consumo para ganho de escala.',
                'Redistribuir rotas se houver picos de entregas por responsável.'
            ];
            pontos.forEach(p => { doc.text(`• ${p}`, MARGIN_LEFT, y); y += 5; });
        } else {
            // Relatório de Gás (mantém estrutura anterior com melhorias de cabeçalho)
            const abastecimentoData = Array.from(abastecimentoMap.entries())
                .sort((a,b) => b[1] - a[1])
                .map(entry => [entry[0], entry[1]]);
            const responsavelData = Array.from(responsavelMap.entries())
                .sort((a,b) => b[1] - a[1])
                .map(entry => [entry[0], entry[1]]);

            // KPIs de gás
            const totalBotijoes = Array.from(abastecimentoMap.values()).reduce((s, v) => s + v, 0);
            const consumoMensalEstimado = Math.round((totalBotijoes / diasPeriodo) * 30);
            const drawKpiBox = (x, y, title, value, color = [11, 61, 145]) => {
                doc.setDrawColor(color[0], color[1], color[2]);
                doc.setFillColor(color[0], color[1], color[2]);
                doc.roundedRect(x, 48, 55, 22, 3, 3, 'FD');
                doc.setTextColor(255);
                doc.setFontSize(9); doc.text(title, x + 6, 57);
                doc.setFontSize(13); doc.text(String(value), x + 6, 64);
                doc.setTextColor(40);
            };
            drawKpiBox(MARGIN_LEFT, 48, 'Botijões entregues', totalBotijoes);
            drawKpiBox(MARGIN_LEFT + 60, 48, 'Consumo mensal (botijões)', consumoMensalEstimado);

            doc.autoTable({
                startY: 74,
                head: [['Unidade', 'Quantidade Fornecida']],
                body: abastecimentoData,
                theme: 'striped',
                headStyles: { fillColor: [22, 160, 133], fontSize: 10, halign: 'center' },
                styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 } },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });

            doc.autoTable({
                startY: (doc.lastAutoTable?.finalY || 74) + 8,
                head: [['Responsável', 'Quantidade Recebida']],
                body: responsavelData,
                theme: 'striped',
                headStyles: { fillColor: [41, 128, 185], fontSize: 10, halign: 'center' },
                styles: { fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 } },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });

            // Ranking Top 10 — Gás
            const rankingGas = Array.from(abastecimentoMap.entries()).map(([unidade, qtdPeriodo]) => ({
                unidade,
                botijoesMes: Math.round((qtdPeriodo / diasPeriodo) * 30)
            })).sort((a,b) => b.botijoesMes - a.botijoesMes).slice(0, 10);
            doc.setFontSize(12); doc.setTextColor(40); doc.text('Ranking de Consumo — Gás (Top 10)', MARGIN_LEFT, (doc.lastAutoTable?.finalY || 74) + 16);
            doc.autoTable({
                startY: (doc.lastAutoTable?.finalY || 74) + 22,
                head: [['Posição', 'Unidade', 'Consumo mensal (botijões)']],
                body: rankingGas.map((r, idx) => [idx + 1, r.unidade, r.botijoesMes]),
                theme: 'striped',
                headStyles: { fillColor: [11, 61, 145], textColor: 255, fontSize: 10, halign: 'center' },
                styles: { fontSize: 10, cellPadding: { top: 3, bottom: 3, left: 2, right: 2 } },
                columnStyles: { 0: { cellWidth: 22, halign: 'center' }, 1: { cellWidth: 95 }, 2: { halign: 'right' } },
                didParseCell: (data) => {
                    if (data.section === 'body' && data.row.index <= 2) { data.cell.styles.fillColor = [253, 247, 228]; }
                },
                margin: { left: MARGIN_LEFT, right: MARGIN_RIGHT },
                tableWidth: CONTENT_WIDTH
            });
        }

        // Rodapé com paginação
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(9); doc.setTextColor(130);
            doc.text(`Página ${i} de ${pageCount}`, doc.internal.pageSize.getWidth() - MARGIN_RIGHT, doc.internal.pageSize.getHeight() - 10, { align: 'right' });
        }

        doc.save(`Relatorio_${tipoLabel}_${dataInicioStr}_a_${dataFimStr}.pdf`);
        showAlert('alert-relatorio', 'Relatório PDF gerado com sucesso!', 'success');
    } catch (error) { 
        console.error("Erro ao gerar PDF:", error); 
        showAlert('alert-relatorio', `Erro ao gerar PDF: ${error.message}`, 'error');
    } finally { 
        // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
        DOM_ELEMENTS.btnGerarPdf.disabled = false; 
        DOM_ELEMENTS.btnGerarPdf.textContent = 'Gerar Relatório PDF'; 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initRelatoriosListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.btnGerarPdf) {
        DOM_ELEMENTS.btnGerarPdf.addEventListener('click', handleGerarPdf);
    }
}

/**
 * Função de orquestração para a tab de Relatório.
 */
export function onRelatorioTabChange() {
    // Garante que as datas estão preenchidas
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.relatorioDataInicio) {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        DOM_ELEMENTS.relatorioDataInicio.value = thirtyDaysAgo.toISOString().split('T')[0];
    }
    if (DOM_ELEMENTS.relatorioDataFim) {
        DOM_ELEMENTS.relatorioDataFim.value = getTodayDateString();
    }
}
