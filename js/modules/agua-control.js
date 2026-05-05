import { 
    getFirestore,
    collection,
    addDoc, 
    updateDoc, 
    serverTimestamp, 
    query, 
    where, 
    getDoc, 
    doc,
    getDocs,
    orderBy,
    limit,
    Timestamp 
} from "firebase/firestore";

import { getUnidades, getAguaMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueAgua, getUserRole } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView, switchTab, openConfirmDeleteModal, filterTable, renderPermissionsUI, escapeHTML } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo, formatTimestamp } from "../utils/formatters.js";
import { isReady, getUserId } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";
import { BaseControl } from "./base-control.js";

// VARIÁVEIS DE ESTADO LOCAL
let debitoAguaMode = 'devendo';
let listenersInitialized = false; // Proteção contra duplicação de eventos

// Instância do BaseControl para Água
const aguaControl = new BaseControl({
    type: 'agua',
    collectionMov: COLLECTIONS.aguaMov,
    collectionEstoque: COLLECTIONS.estoqueAgua,
    getMovimentacoes: getAguaMovimentacoes,
    getEstoque: getEstoqueAgua
});

// Normalização de nomes
function _normName(x) { return (x || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// Verificação de histórico importado (legado)
function isHistoricoImportado(m) {
    return aguaControl.isHistoricoImportado(m);
}

// =========================================================================
// LÓGICA DE ESTOQUE (Delegada para BaseControl)
// =========================================================================

export function renderEstoqueAgua() {
    aguaControl.renderEstoque();
}

export async function handleInicialEstoqueSubmit(e) {
    await aguaControl.handleInicialEstoqueSubmit(e);
}

export async function handleEntradaEstoqueSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-agua', 'Erro: Não autenticado.', 'error'); return; } 
    
    const role = getUserRole(); 
    if (role !== 'admin') { 
        showAlert('alert-agua', "Permissão negada. Apenas Administradores podem lançar entradas no estoque.", 'error'); return; 
    }
    
    const inputQtd = DOM_ELEMENTS.inputQtdEntradaAgua.value;
    const inputData = DOM_ELEMENTS.inputDataEntradaAgua.value;
    const inputResp = DOM_ELEMENTS.inputResponsavelEntradaAgua.value;
    const inputNf = DOM_ELEMENTS.inputNfEntradaAgua.value;
    
    // CORREÇÃO: parseInt com base 10 explícita
    const quantidade = parseInt(inputQtd, 10);
    const data = dateToTimestamp(inputData);
    const responsavel = capitalizeString(inputResp.trim());
    const notaFiscal = inputNf.trim() || 'N/A'; 

    if (!quantidade || quantidade <= 0 || !data || !responsavel) { 
        showAlert('alert-agua', 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning'); return; 
    }
    if (!isEstoqueInicialDefinido('agua')) { 
        showAlert('alert-agua', `Defina o Estoque Inicial de Água antes de lançar entradas.`, 'warning'); return; 
    }
    
    DOM_ELEMENTS.btnSubmitEntradaAgua.disabled = true; 
    DOM_ELEMENTS.btnSubmitEntradaAgua.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueAgua, { 
            tipo: 'entrada', 
            quantidade: quantidade, 
            data: data, 
            responsavel: responsavel, 
            notaFiscal: notaFiscal, 
            registradoEm: serverTimestamp() 
        });
        showAlert('alert-agua', 'Entrada no estoque salva!', 'success');
        DOM_ELEMENTS.formEntradaAgua.reset(); 
        DOM_ELEMENTS.inputDataEntradaAgua.value = getTodayDateString(); 
    } catch (error) {
        console.error("Erro salvar entrada estoque:", error); 
        showAlert('alert-agua', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTS.btnSubmitEntradaAgua.disabled = false; 
        DOM_ELEMENTS.btnSubmitEntradaAgua.innerHTML = '<i data-lucide="save"></i> <span>Salvar Entrada</span>'; 
    }
}

// =========================================================================
// LÓGICA DE MOVIMENTAÇÃO
// =========================================================================

export function toggleAguaFormInputs() {
    if (!DOM_ELEMENTS.selectTipoAgua) return; 
    
    // Forçar apenas Saída/Entrega
    const tipo = DOM_ELEMENTS.selectTipoAgua.value;
    
    // Esconder sempre o retorno, pois não controlamos mais vazios
    if (DOM_ELEMENTS.formGroupQtdEntregueAgua) DOM_ELEMENTS.formGroupQtdEntregueAgua.classList.remove('hidden');
    if (DOM_ELEMENTS.formGroupQtdRetornoAgua) DOM_ELEMENTS.formGroupQtdRetornoAgua.classList.add('hidden');
    if (DOM_ELEMENTS.inputQtdRetornoAgua) DOM_ELEMENTS.inputQtdRetornoAgua.value = "0";
}

export function getUnidadeSaldoAgua(unidadeId) {
    if (!unidadeId) return 0;
    const movimentacoes = getAguaMovimentacoes().filter(m => !isHistoricoImportado(m));
    const entregues = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'entrega').reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);
    const recebidos = movimentacoes.filter(m => m.unidadeId === unidadeId && (m.tipo === 'retorno' || m.tipo === 'retirada')).reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);
    return entregues - recebidos;
}

export function checkUnidadeSaldoAlertAgua() {
    // DESATIVADO: Controle de galão vazio foi removido.
    if (DOM_ELEMENTS.unidadeSaldoAlertaAgua) {
        DOM_ELEMENTS.unidadeSaldoAlertaAgua.style.display = 'none';
    }
}

export async function handleAguaSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-agua', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole(); 
    if (role === 'anon') { 
        showAlert('alert-agua', "Permissão negada. Usuário Anônimo não pode lançar movimentações.", 'error'); return; 
    }

    // Desabilitar botão para evitar duplo clique e TRAVAR MÚLTIPLOS ENVIOS
    const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
    if(submitBtn) {
        submitBtn.disabled = true;
        // Opcional: mudar texto para "Salvando..."
    }

    try {
        const selectValue = DOM_ELEMENTS.selectUnidadeAgua.value; 
        if (!selectValue) { throw new Error('Selecione uma unidade.'); }
        const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
        
        const tipoMovimentacao = 'entrega'; // Forçar sempre entrega
        // CORREÇÃO: parseInt para evitar erro de concatenação
        const qtdEntregue = parseInt(DOM_ELEMENTS.inputQtdEntregueAgua.value, 10) || 0;
        const qtdRetorno = 0; // Forçar sempre 0
        const data = dateToTimestamp(DOM_ELEMENTS.inputDataAgua.value); 
        const responsavelUnidade = capitalizeString(DOM_ELEMENTS.inputResponsavelAgua.value.trim()); 
        
        if (!unidadeId || !data || !responsavelUnidade) {
            throw new Error('Dados inválidos. Verifique Unidade, Data e Nome de quem Recebeu/Devolveu.');
        }
        
        if (qtdEntregue <= 0) {
             throw new Error('A quantidade deve ser maior que zero.');
        }
        
        if (qtdEntregue > 0) {
            if (!isEstoqueInicialDefinido('agua')) {
                throw new Error('Defina o Estoque Inicial de Água antes de lançar saídas.');
            }
            // BUG-03 fix: calcular estoque do cache, não do DOM
            const estoqueData = getEstoqueAgua() || [];
            const movsAll = (getAguaMovimentacoes() || []).filter(m => !isHistoricoImportado(m));
            const estoqueInicialVal = estoqueData.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
            const totalEntradasVal = estoqueData.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + (parseInt(e.quantidade, 10) || 0), 0);
            const totalSaidasVal = movsAll.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + (parseInt(m.quantidade, 10) || 0), 0);
            const estoqueAtual = Math.max(0, estoqueInicialVal + totalEntradasVal - totalSaidasVal);
            if (qtdEntregue > estoqueAtual) {
                throw new Error(`Erro: Estoque insuficiente. Disponível: ${estoqueAtual}`);
            }
        }
        
        await executeFinalMovimentacao({
            unidadeId, unidadeNome, tipoUnidadeRaw,
            tipoMovimentacao, qtdEntregue, qtdRetorno,
            data, responsavelUnidade, itemType: 'agua'
        });

    } catch (error) {
        showAlert('alert-agua', error.message, 'warning');
        // Reativa botão apenas em erro
        if(submitBtn) submitBtn.disabled = false;
    }
    // Nota: Em caso de sucesso, o modal geralmente fecha ou recarrega, 
    // então o botão pode continuar disabled até lá.
}

export function renderAguaStatus(newFilter = null) {
     if (!DOM_ELEMENTS.tableStatusAgua) return;
     
     // FIX: salva o novo filtro ANTES de ler, evitando filtro defasado na primeira chamada
     if (newFilter) setCurrentStatusFilter('agua', newFilter);
     const currentFilter = getCurrentStatusFilter('agua');
     
    const statusMap = new Map();
    const nameIndex = new Map();
    getUnidades().forEach(u => { 
        let tipoNormalizado = (u.tipo || 'N/A').toUpperCase();
        if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
        const obj = { id: u.id, nome: u.nome, tipo: tipoNormalizado, entregues: 0, recebidos: 0, ultimosLancamentos: [] };
        statusMap.set(u.id, obj);
        nameIndex.set(_normName(u.nome), obj);
    });

     const movsOrdenadas = [...getAguaMovimentacoes()].filter(m => !isHistoricoImportado(m)).sort((a, b) => {
         const ad = a.data?.toMillis() || 0;
         const bd = b.data?.toMillis() || 0;
         if (bd !== ad) return bd - ad;
         const ar = a.registradoEm?.toMillis?.() || 0;
         const br = b.registradoEm?.toMillis?.() || 0;
         return br - ar;
     });
     
     movsOrdenadas.forEach(m => {
         let unidadeStatus = statusMap.get(m.unidadeId) || nameIndex.get(_normName(m.unidadeNome));
         if (!unidadeStatus) return;
         if (m.tipo === 'entrega') unidadeStatus.entregues += (parseInt(m.quantidade,10)||0);
         else if (m.tipo === 'retorno' || m.tipo === 'retirada') unidadeStatus.recebidos += (parseInt(m.quantidade,10)||0);
         
         if (unidadeStatus.ultimosLancamentos.length === 0) {
             unidadeStatus.ultimosLancamentos.push({
                 id: m.id, respUnidade: m.responsavel, respAlmox: m.responsavelAlmoxarifado || 'N/A', 
                 data: m.data, registradoEm: m.registradoEm, tipo: m.tipo, quantidade: m.quantidade
            });
         }
     });

     let statusArray = Array.from(statusMap.values())
         .map(s => ({ ...s, pendentes: s.entregues - s.recebidos })) 
         .filter(s => s.entregues > 0 || s.recebidos > 0 || s.pendentes !== 0) 
         .sort((a, b) => b.pendentes - a.pendentes || a.nome.localeCompare(b.nome)); 

    if (currentFilter === 'devendo') {
        statusArray = statusArray.filter(s => s.pendentes > 0);
    } else if (currentFilter === 'credito') {
        statusArray = statusArray.filter(s => s.pendentes < 0);
    } else if (currentFilter === 'zero') {
        statusArray = statusArray.filter(s => s.pendentes === 0);
    }

    if (statusArray.length === 0) { 
        DOM_ELEMENTS.tableStatusAgua.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-500">Nenhuma movimentação registrada.</td></tr>'; 
        return; 
    }
    
    let html = '';
    statusArray.forEach(s => {
        const saldo = s.pendentes;
        const saldoText = saldo > 0 ? `Faltando ${saldo}` : (saldo < 0 ? `Crédito ${Math.abs(saldo)}` : 'Zerado');
        const saldoClass = saldo > 0 ? 'text-red-600 font-extrabold' : (saldo < 0 ? 'text-blue-600' : 'text-green-600');
        
        const ultimoLancamento = s.ultimosLancamentos[0];
        let lancamentoDetalhes = 'N/A';
        
        if(ultimoLancamento) {
            const dataMovimentacao = formatTimestampComTempo(ultimoLancamento.data);
            const respAlmox = ultimoLancamento.respAlmox;
            const respUnidade = ultimoLancamento.respUnidade;
            
            lancamentoDetalhes = `<span>${dataMovimentacao}</span> (Almox: ${respAlmox} / Unid: ${respUnidade})`;
        }
        
        html += `<tr title="${escapeHTML(s.nome)} - Saldo: ${saldoText.replace(/<[^>]*>?/gm, '')}">
            <td class="font-medium">${escapeHTML(s.nome)}</td><td>${escapeHTML(s.tipo || 'N/A')}</td>
            <td class="text-center">${s.entregues}</td><td class="text-center">${s.recebidos}</td>
            <td class="text-center font-bold ${saldoClass}">${saldoText}</td>
            <td class="space-x-1 whitespace-nowrap text-xs text-gray-600">
                ${lancamentoDetalhes}
            </td>
        </tr>`;
    });
    DOM_ELEMENTS.tableStatusAgua.innerHTML = html;
     if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 

    const filtroStatusAguaEl = document.getElementById('filtro-status-agua');
    if (filtroStatusAguaEl && filtroStatusAguaEl.value) {
        filterTable(filtroStatusAguaEl, 'table-status-agua');
    }
}

export function renderAguaDebitosResumo() {
    if (!DOM_ELEMENTS.tableDebitoAguaResumo) return;
    const statusMap = new Map();
    const nameIndex = new Map();
    getUnidades().forEach(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        const obj = { id: u.id, nome: u.nome, tipo, entregues: 0, recebidos: 0, ultimosLancamentos: [] };
        statusMap.set(u.id, obj);
        nameIndex.set(_normName(u.nome), obj);
    });

    const movsOrdenadas = [...getAguaMovimentacoes()].filter(m => !isHistoricoImportado(m)).sort((a, b) => {
        const ad = a.data?.toMillis() || 0;
        const bd = b.data?.toMillis() || 0;
        if (bd !== ad) return bd - ad;
        const ar = a.registradoEm?.toMillis?.() || 0;
        const br = b.registradoEm?.toMillis?.() || 0;
        return br - ar;
    });
    movsOrdenadas.forEach(m => {
        let s = statusMap.get(m.unidadeId) || nameIndex.get(_normName(m.unidadeNome));
        if (!s) return;
        if (m.tipo === 'entrega') s.entregues += (parseInt(m.quantidade,10)||0); 
        else if (m.tipo === 'retorno' || m.tipo === 'retirada') s.recebidos += (parseInt(m.quantidade,10)||0);
        
        if (!s.ultimo) s.ultimo = { id: m.id, data: m.data, tipo: m.tipo, quantidade: m.quantidade, respUnidade: m.responsavel, respAlmox: m.responsavelAlmoxarifado || 'N/A' };
    });

    // Determina o movimento que iniciou a dívida atual (cruzamento do saldo para > 0)
    const porUnidade = new Map();
    movsOrdenadas.forEach(m => {
        const arr = porUnidade.get(m.unidadeId) || [];
        arr.push(m);
        porUnidade.set(m.unidadeId, arr);
    });
    Array.from(statusMap.values()).forEach(s => {
        const arrDesc = (porUnidade.get(s.id) || []).sort((a, b) => {
            const ad = a.data?.toMillis() || 0;
            const bd = b.data?.toMillis() || 0;
            if (bd !== ad) return bd - ad;
            const ar = a.registradoEm?.toMillis?.() || 0;
            const br = b.registradoEm?.toMillis?.() || 0;
            return br - ar;
        });
        const arrAsc = [...arrDesc].reverse();
        let saldo = 0;
        let origem = null;
        arrAsc.forEach(m => {
            const delta = (m.tipo === 'entrega') ? (parseInt(m.quantidade,10) || 0) : - (parseInt(m.quantidade,10) || 0);
            const prev = saldo;
            saldo += delta;
            if (prev <= 0 && saldo > 0) origem = m;
            if (saldo <= 0) origem = null;
        });
        s.origemDivida = origem ? { id: origem.id, data: origem.data, tipo: origem.tipo, quantidade: origem.quantidade, respUnidade: origem.responsavel, respAlmox: origem.responsavelAlmoxarifado || 'N/A' } : null;
    });

    const listaBase = Array.from(statusMap.values()).map(s => ({ ...s, pendentes: s.entregues - s.recebidos }));
    let lista = (debitoAguaMode === 'credito')
        ? listaBase.filter(s => s.pendentes < 0)
        : listaBase.filter(s => s.pendentes > 0);

    const nomeFiltro = (DOM_ELEMENTS.filtroDebitoAgua?.value || '').trim().toLowerCase();
    if (nomeFiltro) lista = lista.filter(s => s.nome.toLowerCase().includes(nomeFiltro));

    const tipoFiltro = DOM_ELEMENTS.filtroResumoAguaTipo?.value || '';
    if (tipoFiltro) lista = lista.filter(s => s.tipo === tipoFiltro);

    const pendMinStr = DOM_ELEMENTS.filtroResumoAguaPendMin?.value || '';
    const pendMin = pendMinStr ? parseInt(pendMinStr, 10) : null;
    if (pendMin !== null && !isNaN(pendMin)) {
        lista = lista.filter(s => (debitoAguaMode === 'credito' ? Math.abs(s.pendentes) : s.pendentes) >= pendMin);
    }

    const dataIniStr = DOM_ELEMENTS.filtroResumoAguaDataIni?.value || '';
    const dataFimStr = DOM_ELEMENTS.filtroResumoAguaDataFim?.value || '';
    let iniMillis = null, fimMillis = null;
    if (dataIniStr) iniMillis = dateToTimestamp(dataIniStr)?.toMillis();
    if (dataFimStr) fimMillis = dateToTimestamp(dataFimStr)?.toMillis();
    if (iniMillis || fimMillis) {
        lista = lista.filter(s => {
            const t = s.ultimo?.data?.toMillis() || 0;
            if (iniMillis && t < iniMillis) return false;
            if (fimMillis && t > fimMillis) return false;
            return true;
        });
    }

    lista = lista.sort((a, b) => {
        const pa = debitoAguaMode === 'credito' ? Math.abs(a.pendentes) : a.pendentes;
        const pb = debitoAguaMode === 'credito' ? Math.abs(b.pendentes) : b.pendentes;
        return pb - pa || a.nome.localeCompare(b.nome);
    });

    if (lista.length === 0) {
        const vazioMsg = debitoAguaMode === 'credito' ? 'Nenhuma unidade com crédito no momento.' : 'Nenhuma unidade devendo vazios no momento.';
        DOM_ELEMENTS.tableDebitoAguaResumo.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-500">${vazioMsg}</td></tr>`;
        return;
    }

    const grupos = lista.reduce((acc, s) => { (acc[s.tipo] ||= []).push(s); return acc; }, {});
    const tiposOrdenadosSrc = Object.keys(grupos).sort();
    const tiposUnicos = tiposOrdenadosSrc;
    if (DOM_ELEMENTS.filtroResumoAguaTipo && DOM_ELEMENTS.filtroResumoAguaTipo.options.length <= 1) {
        const html = ['<option value="">Todos</option>'].concat(tiposUnicos.map(t => `<option value="${t}">${t}</option>`)).join('');
        DOM_ELEMENTS.filtroResumoAguaTipo.innerHTML = html;
    }
    const tiposOrdenados = tiposOrdenadosSrc;
    const rows = [];
    tiposOrdenados.forEach(tipo => {
        rows.push(`<tr class="table-group-header"><td colspan="4">${tipo}</td></tr>`);
        grupos[tipo].forEach(s => {
            const origemMov = s.origemDivida;
            const origemData = origemMov ? formatTimestampComTempo(origemMov.data) : 'N/A';
            const origemTipo = origemMov?.tipo || '';
            const origemQtd = origemMov?.quantidade || '';
            const origemResp = origemMov ? `Almox: ${origemMov.respAlmox} • Unid: ${origemMov.respUnidade}` : '';
            const pendText = debitoAguaMode === 'credito' ? Math.abs(s.pendentes) : s.pendentes;
            const pendClass = debitoAguaMode === 'credito' ? 'text-blue-600' : 'text-red-600';
            rows.push(`<tr>
                <td class="font-medium">${escapeHTML(s.nome)}</td>
                <td><span class="badge badge-gray">${escapeHTML(s.tipo)}</span></td>
                <td class="text-center ${pendClass} font-extrabold">${pendText}</td>
                <td class="text-xs text-gray-700">
                    <div class="flex flex-col">
                        <span class="font-medium">${origemData}</span>
                        <span class="mt-1 flex items-center gap-2"><span class="badge ${(origemTipo==='retorno' || origemTipo==='retirada') ? 'badge-green' : 'badge-blue'}">${(origemTipo==='retorno' || origemTipo==='retirada') ? 'vazio' : 'cheio'}</span><span>${origemQtd}</span></span>
                        <span class="text-gray-500">${escapeHTML(origemResp)}</span>
                        <span class="text-gray-400 text-xs">ID: ${origemMov?.id || 'N/A'}</span>
                        ${origemMov ? `<button class="btn-primary btn-sm mt-2 rounded-full px-3 py-1 btn-ver-dia-divida" title="Abrir histórico do dia da origem" data-item="agua" data-unidade-id="${s.id}" data-date="${(new Date(origemMov.data.toDate())).toISOString().slice(0,10)}"><i data-lucide="calendar"></i> Ver histórico do dia</button>` : ''}
                    </div>
                </td>
            </tr>`);
        });
    });
    DOM_ELEMENTS.tableDebitoAguaResumo.innerHTML = rows.join('');
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    // Listener para botões de "Ver dia da dívida" na tabela
    DOM_ELEMENTS.tableDebitoAguaResumo.querySelectorAll('.btn-ver-dia-divida').forEach(btn => {
        btn.addEventListener('click', () => {
            const unidadeId = btn.getAttribute('data-unidade-id');
            const dateStr = btn.getAttribute('data-date');
            if (!unidadeId || !dateStr) return;
            switchTab('agua');
            switchSubTabView('agua', 'historico-agua');
            const unidadeEl = document.getElementById('filtro-unidade-agua');
            const dataIniEl = document.getElementById('filtro-data-inicio-agua');
            const dataFimEl = document.getElementById('filtro-data-fim-agua');
            const origemEl = document.getElementById('filtro-origem-agua');
            if (unidadeEl) unidadeEl.value = unidadeId;
            if (dataIniEl) dataIniEl.value = dateStr;
            if (dataFimEl) dataFimEl.value = dateStr;
            if (origemEl) origemEl.value = '';
            renderAguaMovimentacoesHistory();
        });
    });
}

export function getDebitosAguaResumoList() {
    // DESATIVADO: Controle de galão vazio foi removido.
    return [];
}

// -------------------------------------------------------------------------
// NOVA FUNÇÃO: Renderização do Histórico de Estoque COM FILTROS NO HEADER
// -------------------------------------------------------------------------
export function renderAguaEstoqueHistory() {
    if (!DOM_ELEMENTS.tableHistoricoEstoqueAgua) return;
    
    // Encontrar a tabela pai para manipular o thead
    const tableElement = DOM_ELEMENTS.tableHistoricoEstoqueAgua.closest('table');
    if (!tableElement) return;

    // Configuração dos Cabeçalhos com Filtros
    // Verifica se já inserimos os filtros para evitar duplicação (ou recria se necessário)
    let thead = tableElement.querySelector('thead');
    
    // Se não tiver a classe 'filtered-header' (marcação nossa), vamos criar
    if (!thead || !thead.classList.contains('filtered-header')) {
        const columns = [
            { key: 'tipo', label: 'Tipo' },
            { key: 'quantidade', label: 'Qtd.' },
            { key: 'data', label: 'Data' },
            { key: 'notaFiscal', label: 'Nota Fiscal' },
            { key: 'responsavel', label: 'Resp. Estoque' },
            { key: 'registradoEm', label: 'Lançado Em' },
            { key: 'actions', label: 'Ações', noFilter: true }
        ];

        const tr = document.createElement('tr');
        columns.forEach(col => {
            const th = document.createElement('th');
            th.className = "px-6 py-3 bg-gray-50 text-left text-xs font-medium text-gray-500 uppercase tracking-wider align-top";
            
            const divContainer = document.createElement('div');
            divContainer.className = "flex flex-col gap-2";
            
            const spanLabel = document.createElement('span');
            spanLabel.className = "font-bold";
            spanLabel.textContent = col.label;
            divContainer.appendChild(spanLabel);

            if (!col.noFilter) {
                const input = document.createElement('input');
                input.type = "text";
                input.className = "filter-estoque-input w-full p-1.5 text-xs border border-gray-300 rounded focus:ring-blue-500 focus:border-blue-500 font-normal normal-case text-gray-700";
                input.placeholder = `Filtrar...`;
                input.dataset.colKey = col.key;
                
                // Listener para filtrar
                input.addEventListener('keyup', () => filterEstoqueTable(tableElement));
                
                divContainer.appendChild(input);
            }
            
            th.appendChild(divContainer);
            tr.appendChild(th);
        });

        if (thead) {
            thead.innerHTML = '';
            thead.appendChild(tr);
            thead.classList.add('filtered-header');
        } else {
            thead = document.createElement('thead');
            thead.classList.add('filtered-header');
            thead.appendChild(tr);
            tableElement.prepend(thead);
        }
    }

    const estoque = getEstoqueAgua();
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const itemType = 'água';

    const historicoOrdenado = [...estoque]
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoEstoqueAgua.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-500">Nenhuma entrada de estoque registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    
    historicoOrdenado.forEach(m => {
        const isInicial = m.tipo === 'inicial';
        const tipoClass = isInicial ? 'badge-blue' : 'badge-green';
        const tipoText = isInicial ? 'Inicial' : 'Entrada';
        
        const dataMov = formatTimestampComTempo(m.data);
        const dataLancamento = formatTimestampComTempo(m.registradoEm);
        const notaFiscal = m.notaFiscal || 'N/A';
        const responsavel = m.responsavel || 'N/A';

        const details = isInicial 
            ? `Estoque Inicial (${itemType}): ${m.quantidade} unidades.`
            : `Entrada de Estoque (${itemType}): ${m.quantidade} unidades, NF: ${notaFiscal}.`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="entrada-agua" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        // A ordem das TDs deve corresponder à ordem dos THs definidos acima
        // Colunas: Tipo, Qtd, Data, NF, Resp, LancadoEm, Ações
        html += `<tr title="Lançado em: ${dataLancamento}" class="hover:bg-gray-50 transition-colors">
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="font-medium">${m.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${notaFiscal}</td>
            <td>${responsavel}</td>
            <td class="whitespace-nowrap text-xs text-gray-500">${dataLancamento}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    DOM_ELEMENTS.tableHistoricoEstoqueAgua.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    // Reaplica filtro se houver valores nos inputs
    filterEstoqueTable(tableElement);
}

// Função auxiliar de filtro para a tabela de estoque
function filterEstoqueTable(table) {
    const inputs = table.querySelectorAll('.filter-estoque-input');
    const tbody = table.querySelector('tbody');
    const rows = tbody.querySelectorAll('tr');

    rows.forEach(row => {
        let showRow = true;
        const cells = row.querySelectorAll('td');
        
        // Mapeia inputs para colunas
        // Assume que a ordem dos inputs nos THs corresponde à ordem das TDs (excluindo colunas sem filtro)
        // Mas a lógica mais segura é pelo índice da coluna
        
        inputs.forEach(input => {
            const th = input.closest('th');
            // Encontra o índice da coluna deste TH na linha do cabeçalho
            const colIndex = Array.from(th.parentNode.children).indexOf(th);
            
            const cell = cells[colIndex];
            if (cell) {
                const filterVal = input.value.toLowerCase().trim();
                const cellVal = cell.textContent.toLowerCase();
                
                if (filterVal && !cellVal.includes(filterVal)) {
                    showRow = false;
                }
            }
        });

        row.style.display = showRow ? '' : 'none';
    });
}

export function renderAguaMovimentacoesHistory() {
    if (!DOM_ELEMENTS.tableHistoricoAguaAll) return;
    
    const role = getUserRole();
    const isAdmin = role === 'admin';

    const historicoOrdenado = getFilteredAguaMovimentacoes()
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoAguaAll.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-500">Nenhuma movimentação de unidade registrada.</td></tr>`;
        return;
    }
    
    let html = '';
    
    historicoOrdenado.forEach(m => {
        const isEntrega = m.tipo === 'entrega';
        const tipoClass = isEntrega ? 'badge-red' : 'badge-green';
        const tipoText = isEntrega ? 'Entrega' : 'Retirada';
        
        const dataMov = formatTimestampComTempo(m.data);
        const dataLancamento = formatTimestampComTempo(m.registradoEm);
        const respAlmox = m.responsavelAlmoxarifado || 'N/A';
        const respUnidade = m.responsavel || 'N/A';

        const details = `Movimentação ${m.unidadeNome} - ${tipoText} (${m.quantidade})`;
        
        const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="agua" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="ID: ${m.id} • Lançado por: ${respAlmox}">
            <td class="text-xs text-gray-500">${m.id}</td>
            <td>${m.unidadeNome || 'N/A'}</td>
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${respAlmox}</td>
            <td>${respUnidade}</td>
            <td class="text-center whitespace-nowrap text-xs">${dataLancamento}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    DOM_ELEMENTS.tableHistoricoAguaAll.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = document.getElementById(`filtro-historico-agua`);
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTS.tableHistoricoAguaAll.id); }

    checkAguaHistoryIntegrity();
}

function populateAguaFilterUnidades() {
    const sel = document.getElementById('filtro-unidade-agua');
    if (!sel) return;
    const tipoSelecionado = document.getElementById('filtro-tipo-agua')?.value || '';
    const tipoUnidadeSelecionado = (document.getElementById('filtro-unidade-tipo-agua')?.value || '').toUpperCase();

    const movs = getAguaMovimentacoes().filter(m => (m.tipo === 'entrega' || m.tipo === 'retorno' || m.tipo === 'retirada') && (!tipoSelecionado || m.tipo === tipoSelecionado));
    const unidadeIdsPermitidas = new Set(movs.map(m => m.unidadeId).filter(Boolean));
    const unidades = getUnidades().filter(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        const matchTipoMov = (!tipoSelecionado || unidadeIdsPermitidas.has(u.id));
        const matchTipoUnidade = (!tipoUnidadeSelecionado || uTipo === tipoUnidadeSelecionado);
        return matchTipoMov && matchTipoUnidade;
    });

    const valorAnterior = sel.value;
    sel.innerHTML = '<option value="">Todas</option>';
    unidades
        .sort((a, b) => a.nome.localeCompare(b.nome))
        .forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.textContent = u.nome;
            sel.appendChild(opt);
        });
    if (valorAnterior && (!tipoSelecionado || unidadeIdsPermitidas.has(valorAnterior))) {
        sel.value = valorAnterior;
    } else {
        sel.value = '';
    }
}

function getFilteredAguaMovimentacoes() {
    const tipoEl = document.getElementById('filtro-tipo-agua');
    const unidadeEl = document.getElementById('filtro-unidade-agua');
    const unidadeTipoEl = document.getElementById('filtro-unidade-tipo-agua');
    const respEl = document.getElementById('filtro-responsavel-agua');
    const origemEl = document.getElementById('filtro-origem-agua');
    const dataIniEl = document.getElementById('filtro-data-ini-agua') || document.getElementById('filtro-data-inicio-agua');
    // FIX: ID alternativo correto para data fim (era duplicado, causando filtro inoperante)
    const dataFimEl = document.getElementById('filtro-data-fim-agua') || document.getElementById('filtro-data-fim-agua-historico');

    const tipo = tipoEl?.value || '';
    const unidadeId = unidadeEl?.value || '';
    const unidadeTipoSelecionado = (unidadeTipoEl?.value || '').toUpperCase();
    const respQuery = (respEl?.value || '').trim().toLowerCase();
    const origem = origemEl?.value || '';
    const dataIniStr = dataIniEl?.value || '';
    const dataFimStr = dataFimEl?.value || '';

    const base = getAguaMovimentacoes().filter(m => (m.tipo === 'entrega' || m.tipo === 'retorno' || m.tipo === 'retirada'));
    const dataIniMs = dataIniStr ? dateToTimestamp(dataIniStr)?.toMillis() : null;
    const dataFimMs = dataFimStr ? dateToTimestamp(dataFimStr)?.toMillis() : null;

    const unidadesMap = new Map(getUnidades().map(u => {
        let uTipo = (u.tipo || 'N/A').toUpperCase();
        if (uTipo === 'SEMCAS') uTipo = 'SEDE';
        return [u.id, { tipo: uTipo }];
    }));

    return base.filter(m => {
        if (tipo && m.tipo !== tipo) return false;
        if (unidadeId && m.unidadeId !== unidadeId) return false;
        if (unidadeTipoSelecionado) {
            const info = unidadesMap.get(m.unidadeId);
            if (!info || info.tipo !== unidadeTipoSelecionado) return false;
        }
        if (origem === 'importacao' && !isHistoricoImportado(m)) return false;
        if (origem === 'manual' && isHistoricoImportado(m)) return false;
        if (respQuery) {
            const ru = (m.responsavel || '').toLowerCase();
            const ra = (m.responsavelAlmoxarifado || '').toLowerCase();
            if (!ru.includes(respQuery) && !ra.includes(respQuery)) return false;
        }
        const movMs = m.data?.toMillis?.() || null;
        if (dataIniMs && movMs && movMs < dataIniMs) return false;
        if (dataFimMs && movMs && movMs > dataFimMs) return false;
        return true;
    });
}

function checkAguaHistoryIntegrity() {
    const movs = getAguaMovimentacoes().filter(m => m.tipo === 'entrega' || m.tipo === 'retorno');
    const unidadesMap = new Map(getUnidades().map(u => [u.id, u]));
    let inconsistenciasMov = 0;
    movs.forEach(m => {
        if (!m.id) inconsistenciasMov++;
        if (!m.unidadeId || !unidadesMap.has(m.unidadeId)) inconsistenciasMov++;
        if (!m.data || typeof m.data.toMillis !== 'function') inconsistenciasMov++;
        if (!m.registradoEm || typeof m.registradoEm.toMillis !== 'function') inconsistenciasMov++;
        if (!['entrega', 'retorno', 'retirada'].includes(m.tipo)) inconsistenciasMov++;
        if (!m.quantidade || m.quantidade <= 0) inconsistenciasMov++;
    });

    const estoque = getEstoqueAgua();
    let inconsistenciasEstoque = 0;
    estoque.forEach(e => {
        if (!e.id) inconsistenciasEstoque++;
        if (!['inicial', 'entrada'].includes(e.tipo)) inconsistenciasEstoque++;
        if (!e.data || typeof e.data.toMillis !== 'function') inconsistenciasEstoque++;
        if (!e.registradoEm || typeof e.registradoEm.toMillis !== 'function') inconsistenciasEstoque++;
        if (!e.quantidade || e.quantidade <= 0) inconsistenciasEstoque++;
    });

    const movMsg = inconsistenciasMov === 0
        ? 'Nenhuma inconsistência detectada nas movimentações de Água.'
        : `Foram encontradas ${inconsistenciasMov} possíveis inconsistências nas movimentações de Água. Revise os lançamentos mais antigos.`;
    const estoqueMsg = inconsistenciasEstoque === 0
        ? 'Nenhuma inconsistência detectada nas entradas de estoque de Água.'
        : `Foram encontradas ${inconsistenciasEstoque} possíveis inconsistências nas entradas de estoque de Água. Verifique registros de NF e datas.`;

    if (document.getElementById('alert-historico-agua')) {
        showAlert('alert-historico-agua', movMsg, inconsistenciasMov === 0 ? 'info' : 'warning');
    }
    if (document.getElementById('alert-historico-estoque-agua')) {
        showAlert('alert-historico-estoque-agua', estoqueMsg, inconsistenciasEstoque === 0 ? 'info' : 'warning');
    }
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initAguaListeners() {
    // CORREÇÃO: Evita duplicar listeners se a função for chamada 2x
    if (listenersInitialized) return;
    
    if (DOM_ELEMENTS.formAgua) {
        DOM_ELEMENTS.formAgua.addEventListener('submit', handleAguaSubmit);
    }
    if (DOM_ELEMENTS.selectTipoAgua) {
        DOM_ELEMENTS.selectTipoAgua.addEventListener('change', toggleAguaFormInputs);
    }
    if (DOM_ELEMENTS.selectUnidadeAgua) {
         DOM_ELEMENTS.selectUnidadeAgua.addEventListener('change', checkUnidadeSaldoAlertAgua);
    }
    if (DOM_ELEMENTS.formInicialAgua) {
        DOM_ELEMENTS.formInicialAgua.addEventListener('submit', handleInicialEstoqueSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialAgua) {
        DOM_ELEMENTS.btnAbrirInicialAgua.addEventListener('click', () => { 
            DOM_ELEMENTS.formInicialAguaContainer?.classList.remove('hidden'); 
            DOM_ELEMENTS.btnAbrirInicialAgua?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaAgua) {
        DOM_ELEMENTS.formEntradaAgua.addEventListener('submit', handleEntradaEstoqueSubmit);
    }
    if (document.getElementById('filtro-status-agua')) {
        document.getElementById('filtro-status-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-status-agua'), 'table-status-agua'));
    }
    if (document.getElementById('filtro-historico-agua')) {
        document.getElementById('filtro-historico-agua').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-agua'), 'table-historico-agua-all'));
    }
    if (DOM_ELEMENTS.filtroDebitoAgua) {
        DOM_ELEMENTS.filtroDebitoAgua.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroDebitoAgua, 'table-debito-agua-resumo'));
    }
    if (DOM_ELEMENTS.btnDebitoAgua) {
        DOM_ELEMENTS.btnDebitoAgua.addEventListener('click', () => {
            debitoAguaMode = 'devendo';
            DOM_ELEMENTS.btnDebitoAgua?.classList.add('active');
            DOM_ELEMENTS.btnCreditoAgua?.classList.remove('active');
            renderAguaDebitosResumo();
        });
    }
    if (DOM_ELEMENTS.btnCreditoAgua) {
        DOM_ELEMENTS.btnCreditoAgua.addEventListener('click', () => {
            debitoAguaMode = 'credito';
            DOM_ELEMENTS.btnCreditoAgua?.classList.add('active');
            DOM_ELEMENTS.btnDebitoAgua?.classList.remove('active');
            renderAguaDebitosResumo();
        });
    }
    if (DOM_ELEMENTS.btnVerStatusAgua) {
        DOM_ELEMENTS.btnVerStatusAgua.addEventListener('click', () => switchSubTabView('agua', 'status-agua'));
    }
    if (DOM_ELEMENTS.filtroDebitoAgua) {
        DOM_ELEMENTS.filtroDebitoAgua.addEventListener('input', () => renderAguaDebitosResumo());
    }
    if (DOM_ELEMENTS.filtroResumoAguaTipo) DOM_ELEMENTS.filtroResumoAguaTipo.addEventListener('change', renderAguaDebitosResumo);
    if (DOM_ELEMENTS.filtroResumoAguaPendMin) DOM_ELEMENTS.filtroResumoAguaPendMin.addEventListener('input', renderAguaDebitosResumo);
    if (DOM_ELEMENTS.filtroResumoAguaDataIni) DOM_ELEMENTS.filtroResumoAguaDataIni.addEventListener('change', renderAguaDebitosResumo);
    if (DOM_ELEMENTS.filtroResumoAguaDataFim) DOM_ELEMENTS.filtroResumoAguaDataFim.addEventListener('change', renderAguaDebitosResumo);
    // Filtros avançados
    ['filtro-tipo-agua','filtro-unidade-agua','filtro-responsavel-agua','filtro-origem-agua','filtro-data-ini-agua','filtro-data-fim-agua']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => {
                renderAguaMovimentacoesHistory();
                const free = document.getElementById('filtro-historico-agua');
                if (free && free.value) filterTable(free, 'table-historico-agua-all');
            });
        });
    const tipoAgua = document.getElementById('filtro-tipo-agua');
    if (tipoAgua) tipoAgua.addEventListener('input', populateAguaFilterUnidades);
    const tipoUnidadeAgua = document.getElementById('filtro-unidade-tipo-agua');
    if (tipoUnidadeAgua) tipoUnidadeAgua.addEventListener('input', () => {
        populateAguaFilterUnidades();
        renderAguaMovimentacoesHistory();
    });
    const btnClear = document.getElementById('btn-limpar-filtros-agua');
    if (btnClear) btnClear.addEventListener('click', () => {
        ['filtro-tipo-agua','filtro-unidade-tipo-agua','filtro-unidade-agua','filtro-responsavel-agua','filtro-origem-agua','filtro-data-ini-agua','filtro-data-fim-agua']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        populateAguaFilterUnidades();
        renderAguaMovimentacoesHistory();
        const free = document.getElementById('filtro-historico-agua');
        if (free && free.value) filterTable(free, 'table-historico-agua-all');
    });
    populateAguaFilterUnidades();
    if (DOM_ELEMENTS.filtroHistoricoEstoqueAgua) {
        DOM_ELEMENTS.filtroHistoricoEstoqueAgua.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroHistoricoEstoqueAgua, DOM_ELEMENTS.tableHistoricoEstoqueAgua.id));
    }
    
    if (document.getElementById('sub-nav-agua')) {
        document.getElementById('sub-nav-agua').addEventListener('click', (e) => {
            const btn = e.target.closest('.sub-nav-btn');
            if (btn && btn.dataset.subview) switchSubTabView('agua', btn.dataset.subview);
        });
    }

    document.querySelectorAll('#filtro-saldo-agua-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        handleSaldoFilterUI('agua', e, renderAguaStatus);
    }));

    document.querySelectorAll('#content-agua .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-agua .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (DOM_ELEMENTS.formAgua) DOM_ELEMENTS.formAgua.classList.toggle('hidden', formName !== 'saida-agua');
        if (DOM_ELEMENTS.formEntradaAgua) DOM_ELEMENTS.formEntradaAgua.classList.toggle('hidden', formName !== 'entrada-agua');
        renderPermissionsUI(); 
    }));
    
    // BUG-05 fix: inner nav listeners moved here from onAguaTabChange to avoid accumulation
    const innerNavAgua = document.querySelector('#subview-movimentacao-agua .module-inner-subnav');
    if (innerNavAgua) {
        innerNavAgua.addEventListener('click', (e) => {
            const btn = e.target.closest('button.sub-nav-btn[data-inner]');
            if (!btn) return;
            const target = btn.dataset.inner;
            document.querySelectorAll('#subview-movimentacao-agua .module-inner-subnav .sub-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (target === 'resumo') {
                DOM_ELEMENTS.innerAguaResumo?.classList.remove('hidden');
                DOM_ELEMENTS.innerAguaLancamento?.classList.add('hidden');
            } else {
                DOM_ELEMENTS.innerAguaLancamento?.classList.remove('hidden');
                DOM_ELEMENTS.innerAguaResumo?.classList.add('hidden');
            }
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                setTimeout(() => lucide.createIcons(), 50);
            }
        });
    }
    if (DOM_ELEMENTS.btnInnerAguaResumo) {
        DOM_ELEMENTS.btnInnerAguaResumo.addEventListener('click', () => {
            DOM_ELEMENTS.btnInnerAguaResumo.classList.add('active');
            DOM_ELEMENTS.btnInnerAguaLancamento?.classList.remove('active');
            DOM_ELEMENTS.innerAguaResumo?.classList.remove('hidden');
            DOM_ELEMENTS.innerAguaLancamento?.classList.add('hidden');
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { setTimeout(() => lucide.createIcons(), 50); }
        });
    }

    listenersInitialized = true;
    console.log('Módulo Água: Listeners inicializados (blindado contra duplicação).');
}

export function onAguaTabChange() {
    const currentSubView = document.querySelector('#sub-nav-agua .sub-nav-btn.active')?.dataset.subview || 'movimentacao-agua';
    
    switchSubTabView('agua', currentSubView);
    
    toggleAguaFormInputs(); 
    checkUnidadeSaldoAlertAgua();
    renderEstoqueAgua();
    renderAguaDebitosResumo();
    renderAguaEstoqueHistory(); 
    renderAguaStatus();
    renderAguaMovimentacoesHistory();
    if (DOM_ELEMENTS.inputDataAgua) DOM_ELEMENTS.inputDataAgua.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaAgua) DOM_ELEMENTS.inputDataEntradaAgua.value = getTodayDateString();
    
    const filtroStatus = document.getElementById('filtro-status-agua');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-agua');
    if (filtroHistorico) filtroHistorico.value = '';

    populateAguaFilterUnidades();
    checkAguaHistoryIntegrity();
    renderPermissionsUI();
}
