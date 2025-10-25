// js/modules/relatorios.js
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getAguaMovimentacoes, getGasMovimentacoes } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { dateToTimestamp, formatTimestamp } from "../utils/formatters.js";
import { isReady } from "./auth.js";

/**
 * Lida com a geração do relatório em PDF (usando jspdf).
 */
export function handleGerarPdf() {
    if (!isReady()) { showAlert('alert-relatorio', 'Erro: Não autenticado.', 'error'); return; }
    if (typeof window.jspdf === 'undefined' || typeof window.jspdf.jsPDF === 'undefined') {
        showAlert('alert-relatorio', 'Erro: Bibliotecas PDF não carregadas. Tente recarregar a página.', 'error'); return;
    }
    
    const { jsPDF } = window.jspdf;
    const autoTable = window.jspdf.AutoTable; 

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
    
    DOM_ELEMENTS.btnGerarPdf.disabled = true; 
    DOM_ELEMENTOS.btnGerarPdf.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        const doc = new jsPDF(); 

        const abastecimentoMap = new Map(); 
        movsFiltradas.forEach(m => { 
            const nome = m.unidadeNome || 'Desconhecida'; 
            const atual = abastecimentoMap.get(nome) || 0; 
            abastecimentoMap.set(nome, atual + m.quantidade); 
        });
        const abastecimentoData = Array.from(abastecimentoMap.entries())
            .sort((a,b) => b[1] - a[1]) 
            .map(entry => [entry[0], entry[1]]); 

        const responsavelMap = new Map(); 
        movsFiltradas.forEach(m => { 
            const nome = m.responsavel || 'Não identificado'; 
            const atual = responsavelMap.get(nome) || 0; 
            responsavelMap.set(nome, atual + m.quantidade); 
        });
        const responsavelData = Array.from(responsavelMap.entries())
            .sort((a,b) => b[1] - a[1])
            .map(entry => [entry[0], entry[1]]);

        doc.setFontSize(16); doc.text(`Relatório de Fornecimento - ${tipoLabel}`, 14, 20);
        doc.setFontSize(10); doc.text(`Período: ${formatTimestamp(Timestamp.fromMillis(dataInicio))} a ${formatTimestamp(Timestamp.fromMillis(dataFim))}`, 14, 26);
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 32);

        autoTable(doc, { 
            startY: 40, 
            head: [['Relatório de Entregas por Unidade']], 
            body: [[]], 
            theme: 'plain', 
            styles: { fontSize: 12, fontStyle: 'bold' } 
        });
        autoTable(doc, { 
            head: [['Unidade', 'Quantidade Fornecida']], 
            body: abastecimentoData, 
            theme: 'striped', 
            headStyles: { fillColor: [22, 160, 133] } 
        });

        autoTable(doc, { 
            startY: doc.lastAutoTable.finalY + 15, 
            head: [['Relatório de Recebimento por Responsável (Unidade)']],
            body: [[]], 
            theme: 'plain', 
            styles: { fontSize: 12, fontStyle: 'bold' } 
        });
        autoTable(doc, { 
            head: [['Responsável', 'Quantidade Recebida']], 
            body: responsavelData, 
            theme: 'striped', 
            headStyles: { fillColor: [41, 128, 185] } 
        });

        doc.save(`Relatorio_${tipoLabel}_${dataInicioStr}_a_${dataFimStr}.pdf`);
        showAlert('alert-relatorio', 'Relatório PDF gerado com sucesso!', 'success');
    } catch (error) { 
        console.error("Erro ao gerar PDF:", error); 
        showAlert('alert-relatorio', `Erro ao gerar PDF: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTOS.btnGerarPdf.disabled = false; 
        DOM_ELEMENTOS.btnGerarPdf.textContent = 'Gerar Relatório PDF'; 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initRelatoriosListeners() {
    if (DOM_ELEMENTS.btnGerarPdf) {
        DOM_ELEMENTOS.btnGerarPdf.addEventListener('click', handleGerarPdf);
    }
}

/**
 * Função de orquestração para a tab de Relatório.
 */
export function onRelatorioTabChange() {
    // Garante que as datas estão preenchidas
    if (DOM_ELEMENTOS.relatorioDataInicio) DOM_ELEMENTOS.relatorioDataInicio.value = formatTimestamp(Timestamp.fromMillis(Date.now() - 30 * 24 * 60 * 60 * 1000));
    if (DOM_ELEMENTOS.relatorioDataFim) DOM_ELEMENTOS.relatorioDataFim.value = formatTimestamp(Timestamp.now());
}
