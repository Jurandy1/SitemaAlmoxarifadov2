
import { addDoc, serverTimestamp } from "firebase/firestore";
import { getUnidades, getUserRole, isEstoqueInicialDefinido } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, renderPermissionsUI } from "../utils/dom-helpers.js";
import { capitalizeString } from "../utils/formatters.js";
import { isReady } from "./auth.js";

/**
 * Classe base para controle de estoque e movimentações (Água e Gás).
 * Centraliza a lógica repetida de renderização, cálculo de estoque e formulários.
 */
export class BaseControl {
    constructor(config) {
        this.type = config.type; // 'agua' or 'gas'
        this.collectionMov = config.collectionMov;
        this.collectionEstoque = config.collectionEstoque;
        this.getMovimentacoes = config.getMovimentacoes;
        this.getEstoque = config.getEstoque;
    }

    getElements() {
        const cap = capitalizeString(this.type);
        return {
            estoqueAtual: DOM_ELEMENTS[`estoque${cap}AtualEl`],
            estoqueInicial: DOM_ELEMENTS[`estoque${cap}InicialEl`],
            estoqueEntradas: DOM_ELEMENTS[`estoque${cap}EntradasEl`],
            estoqueSaidas: DOM_ELEMENTS[`estoque${cap}SaidasEl`],
            loading: DOM_ELEMENTS[`loadingEstoque${cap}El`],
            btnAbrirInicial: DOM_ELEMENTS[`btnAbrirInicial${cap}`],
            formInicialContainer: DOM_ELEMENTS[`formInicial${cap}Container`],
            resumoEstoque: DOM_ELEMENTS[`resumoEstoque${cap}El`],
            btnSubmitInicial: DOM_ELEMENTS[`btnSubmitInicial${cap}`],
            inputInicialQtd: DOM_ELEMENTS[`inputInicialQtd${cap}`],
            inputInicialResp: DOM_ELEMENTS[`inputInicialResponsavel${cap}`],
            alertInicial: `alert-inicial-${this.type}`,
            alertGeneral: `alert-${this.type}`
        };
    }

    /**
     * Renderiza o painel de estoque (cálculo de saldo atual).
     */
    renderEstoque() {
        const elements = this.getElements();
        if (!elements.estoqueAtual) return;

        if (elements.loading) elements.loading.style.display = 'none';

        const isDefined = isEstoqueInicialDefinido(this.type);
        
        if (elements.btnAbrirInicial) elements.btnAbrirInicial.classList.toggle('hidden', isDefined);
        if (elements.formInicialContainer) elements.formInicialContainer.classList.add('hidden');
        if (elements.resumoEstoque) elements.resumoEstoque.classList.toggle('hidden', !isDefined);

        const estoqueData = this.getEstoque() || [];
        const movs = (this.getMovimentacoes() || []).filter(m => !this.isHistoricoImportado(m));

        const estoqueInicial = estoqueData.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
        const totalEntradas  = estoqueData.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);

        // Usa __resumo__ se disponível (totalSaidas histórico acumulado, sem limit de leituras).
        // Fallback: soma os movimentos em cache (válido enquanto __resumo__ ainda não existir).
        const resumo = (this.type === 'agua') ? estoqueData.find(e => e.tipo === '__resumo__') : null;
        const totalSaidas = resumo
            ? (resumo.totalSaidas || 0)
            : movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);

        const estoqueAtual = Math.max(0, estoqueInicial + totalEntradas - totalSaidas);

        if (elements.estoqueInicial) elements.estoqueInicial.textContent = estoqueInicial;
        if (elements.estoqueEntradas) elements.estoqueEntradas.textContent = `+${totalEntradas}`;
        if (elements.estoqueSaidas) elements.estoqueSaidas.textContent = `-${totalSaidas}`;
        if (elements.estoqueAtual) elements.estoqueAtual.textContent = estoqueAtual;

        renderPermissionsUI();
    }

    /**
     * Handler para submissão do estoque inicial.
     */
    async handleInicialEstoqueSubmit(e) {
        e.preventDefault();
        const elements = this.getElements();

        const role = getUserRole();
        if (role !== 'admin') {
            showAlert(elements.alertInicial, "Permissão negada. Apenas Administradores podem definir o estoque inicial.", 'error');
            return;
        }

        const inputQtd = elements.inputInicialQtd?.value;
        const inputResp = elements.inputInicialResp?.value;

        const quantidade = parseInt(inputQtd, 10);
        const responsavel = capitalizeString((inputResp || '').trim());

        if (isNaN(quantidade) || quantidade < 0 || !responsavel) {
            showAlert(elements.alertInicial, "Preencha a quantidade e o responsável.", 'warning');
            return;
        }

        if (isEstoqueInicialDefinido(this.type)) {
            showAlert(elements.alertInicial, "O estoque inicial já foi definido.", 'info');
            return;
        }

        if (elements.btnSubmitInicial) {
            elements.btnSubmitInicial.disabled = true;
            elements.btnSubmitInicial.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
        }

        try {
            await addDoc(this.collectionEstoque, {
                tipo: 'inicial',
                quantidade: quantidade,
                data: serverTimestamp(),
                responsavel: responsavel,
                notaFiscal: 'INICIAL',
                registradoEm: serverTimestamp()
            });
            showAlert(elements.alertInicial, "Estoque inicial salvo!", 'success', 2000);
            if (elements.formInicialContainer) elements.formInicialContainer.classList.add('hidden');
            if (elements.btnAbrirInicial) elements.btnAbrirInicial.classList.add('hidden');
        } catch (error) {
            console.error("Erro ao salvar estoque inicial:", error);
            showAlert(elements.alertInicial, `Erro ao salvar: ${error.message}`, 'error');
        } finally {
            if (elements.btnSubmitInicial) {
                elements.btnSubmitInicial.disabled = false;
                elements.btnSubmitInicial.innerHTML = '<i data-lucide="save"></i><span>Salvar Inicial</span>';
            }
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        }
    }

    /**
     * Verifica se o movimento é um histórico importado (legado).
     */
    isHistoricoImportado(m) {
        if (!m) return false;
        const idStr = String(m.id || '').toLowerCase();
        const origemStr = String(m.origem || '').toLowerCase();
        const obs = String(m.observacao || m.obs || '').toLowerCase();

        if (origemStr === 'importador_sql') return true;
        if (origemStr.includes('importa') || origemStr.includes('automatica')) return true;
        if (idStr.includes('__sql') || idStr.endsWith('_sql')) return true;

        if (obs.includes('importado de sql') || obs.includes('importação automática') || obs.includes('migração')) return true;

        // Verifica data zerada (comum em imports sem hora)
        const d = m.data?.toDate?.();
        if (d && d.getHours() === 0 && d.getMinutes() === 0 && (!m.responsavelAlmoxarifado || m.responsavelAlmoxarifado.toLowerCase().includes('import'))) return true;

        return false;
    }
}
