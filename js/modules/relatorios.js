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

function moedaBRL(valor) {
    try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0); }
    catch { return `R$ ${(valor || 0).toFixed(2)}`; }
}

/**
 * Lida com a geração do relatório em PDF (usando jspdf).
 */
export async function handleGerarPdf() {
    if (!isReady()) { showAlert('alert-relatorio', 'Erro: Não autenticado.', 'error'); return; }
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined' || typeof window.jspdf.plugin.autotable === 'undefined') {
        showAlert('alert-relatorio', 'Erro: Bibliotecas PDF não carregadas. Tente recarregar a página.', 'error'); return;
    }
    
    const { jsPDF } = window.jspdf;
    const autoTable = window.jspdf.plugin.autotable; 

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
        const logoDataUrl = await toDataURL('SaoLuis.png');

        // Cabeçalho institucional
        if (logoDataUrl) {
            try { doc.addImage(logoDataUrl, 'PNG', 14, 10, 28, 14); } catch {}
        }
        doc.setFontSize(12);
        doc.setTextColor(11, 61, 145); // azul institucional
        doc.text('Prefeitura de São Luís — SEMCAS', 44, 16);
        doc.setTextColor(51, 65, 85);
        doc.setFontSize(10);
        const userEmail = (auth?.currentUser?.email) || 'Operador Anônimo';
        doc.text(`Relatório Técnico — ${tipoLabel} (Almoxarifado)`, 14, 30);
        doc.text(`Período: ${formatTimestamp(Timestamp.fromMillis(dataInicio))} a ${formatTimestamp(Timestamp.fromMillis(dataFim))}`, 14, 35);
        doc.text(`Emitido por: ${userEmail} em ${new Date().toLocaleString('pt-BR')}`, 14, 40);

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

            // Tabela detalhada por unidade com análise
            const analiseData = Array.from(abastecimentoMap.entries())
                .map(([unidade, galoesPeriodo]) => {
                    const litrosPeriodo = galoesPeriodo * litrosPorGalao;
                    const litrosMensalEstimado = Math.round((litrosPeriodo / diasPeriodo) * 30);
                    const galoesMensaisEstimados = Math.ceil(litrosMensalEstimado / litrosPorGalao);
                    const custoGalaoMensal = galoesMensaisEstimados * custoGalao;
                    const custoIndustrialMensal = custoMensalIndustrialEnergia + custoMensalIndustrialFiltro;
                    const custoFiltroMensal = custoMensalFiltroSimples;

                    let recomendacao = 'Galão 20L';
                    let justificativa = 'Consumo moderado, logística de galões é suficiente.';
                    if (litrosMensalEstimado <= limiteBaixo) {
                        recomendacao = 'Bebedouro com filtro (rede)';
                        justificativa = 'Baixo consumo; solução com filtro reduz custos e logística.';
                    } else if (litrosMensalEstimado > limiteAlto) {
                        recomendacao = 'Bebedouro industrial';
                        justificativa = 'Alto consumo; equipamento industrial é mais eficiente e contínuo.';
                    }

                    return [
                        unidade,
                        galoesPeriodo,
                        `${litrosPeriodo} L`,
                        `${litrosMensalEstimado} L/mês`,
                        moedaBRL(custoGalaoMensal),
                        moedaBRL(custoFiltroMensal),
                        moedaBRL(custoIndustrialMensal),
                        recomendacao,
                        justificativa
                    ];
                })
                .sort((a, b) => {
                    // ordena por litros/mês desc
                    const lA = parseInt(String(a[3]).replace(/\D/g, '')) || 0;
                    const lB = parseInt(String(b[3]).replace(/\D/g, '')) || 0;
                    return lB - lA;
                });

            // Seção: Análise por Unidade
            autoTable(doc, {
                startY: 46,
                head: [[
                    'Unidade', 'Galões (período)', 'Litros (período)', 'Consumo médio mensal',
                    'Custo com Galão', 'Custo com Filtro', 'Custo Industrial', 'Recomendação', 'Justificativa'
                ]],
                body: analiseData,
                theme: 'striped',
                headStyles: { fillColor: [11, 61, 145], textColor: 255 },
                styles: { fontSize: 9, cellPadding: 2 },
                columnStyles: {
                    0: { cellWidth: 35 },
                    1: { halign: 'right' },
                    2: { halign: 'right' },
                    3: { halign: 'right' },
                    4: { halign: 'right' },
                    5: { halign: 'right' },
                    6: { halign: 'right' },
                    7: { cellWidth: 30 },
                    8: { cellWidth: 52 }
                }
            });

            // Sumário e recomendações gerais
            const totalGaloes = Array.from(abastecimentoMap.values()).reduce((s, v) => s + v, 0);
            const totalLitrosPeriodo = totalGaloes * litrosPorGalao;
            const litrosMensalTotal = Math.round((totalLitrosPeriodo / diasPeriodo) * 30);
            const custoGalaoTotal = Math.ceil(litrosMensalTotal / litrosPorGalao) * custoGalao;
            const custoIndustrialTotal = custoMensalIndustrialEnergia + custoMensalIndustrialFiltro;
            const custoFiltroTotal = custoMensalFiltroSimples;

            const startY = (doc.lastAutoTable?.finalY || 46) + 6;
            doc.setFontSize(10); doc.setTextColor(11, 61, 145);
            doc.text('Sumário Executivo', 14, startY);
            doc.setTextColor(51, 65, 85);
            autoTable(doc, {
                startY: startY + 2,
                theme: 'plain',
                body: [
                    [`Dias no período: ${diasPeriodo}`],
                    [`Consumo total estimado: ${litrosMensalTotal} L/mês`],
                    [`Custo mensal (Galões): ${moedaBRL(custoGalaoTotal)}`],
                    [`Custo mensal (Filtro rede): ${moedaBRL(custoFiltroTotal)}`],
                    [`Custo mensal (Industrial): ${moedaBRL(custoIndustrialTotal)}`]
                ],
                styles: { fontSize: 10 }
            });

            const recomendacaoGeral = litrosMensalTotal > limiteAlto ? 'Investir em bebedouros industriais nas unidades de maior consumo.'
                : (litrosMensalTotal <= limiteBaixo ? 'Adotar bebedouros com filtro (rede) nas unidades de baixo consumo.'
                : 'Manter/otimizar abastecimento por galões nas unidades com consumo moderado.');
            autoTable(doc, {
                startY: (doc.lastAutoTable?.finalY || startY) + 4,
                theme: 'plain',
                head: [['Recomendação Geral']],
                body: [[recomendacaoGeral]],
                styles: { fontSize: 10, cellPadding: 2 }
            });

            // Seção adicional: Entregas por Responsável
            const responsavelData = Array.from(responsavelMap.entries())
                .sort((a,b) => b[1] - a[1])
                .map(entry => [entry[0], entry[1]]);
            autoTable(doc, {
                startY: (doc.lastAutoTable?.finalY || startY) + 8,
                head: [['Responsável', 'Entregas (galões)']],
                body: responsavelData,
                theme: 'striped',
                headStyles: { fillColor: [41, 128, 185] },
                styles: { fontSize: 9 }
            });
        } else {
            // Relatório de Gás (mantém estrutura anterior com melhorias de cabeçalho)
            const abastecimentoData = Array.from(abastecimentoMap.entries())
                .sort((a,b) => b[1] - a[1])
                .map(entry => [entry[0], entry[1]]);
            const responsavelData = Array.from(responsavelMap.entries())
                .sort((a,b) => b[1] - a[1])
                .map(entry => [entry[0], entry[1]]);

            autoTable(doc, {
                startY: 46,
                head: [['Unidade', 'Quantidade Fornecida']],
                body: abastecimentoData,
                theme: 'striped',
                headStyles: { fillColor: [22, 160, 133] },
                styles: { fontSize: 9 }
            });

            autoTable(doc, {
                startY: (doc.lastAutoTable?.finalY || 46) + 8,
                head: [['Responsável', 'Quantidade Recebida']],
                body: responsavelData,
                theme: 'striped',
                headStyles: { fillColor: [41, 128, 185] },
                styles: { fontSize: 9 }
            });
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
