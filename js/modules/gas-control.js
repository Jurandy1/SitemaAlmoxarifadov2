// js/modules/gas-control.js
import { Timestamp, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getGasMovimentacoes, isEstoqueInicialDefinido, getCurrentStatusFilter, setCurrentStatusFilter, getEstoqueGas, getUserRole } from "../utils/cache.js";
import { DOM_ELEMENTS, showAlert, switchSubTabView, handleSaldoFilterUI, filterTable, renderPermissionsUI } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestampComTempo, formatTimestamp } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { executeFinalMovimentacao } from "./movimentacao-modal-handler.js";

// VARIÁVEL DE ESTADO LOCAL (Movida para o topo)
let debitoGasMode = 'devendo';

function _normName(x) { return (x || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

// =========================================================================
// LÓGICA DE ESTOQUE
// =========================================================================

export function renderEstoqueGas() {
    if (!DOM_ELEMENTS.estoqueGasAtualEl) return;
    
    if (DOM_ELEMENTS.loadingEstoqueGasEl) DOM_ELEMENTS.loadingEstoqueGasEl.style.display = 'none';
    
    if (isEstoqueInicialDefinido('gas')) {
        if(DOM_ELEMENTS.btnAbrirInicialGas) DOM_ELEMENTS.btnAbrirInicialGas.classList.add('hidden'); 
        if(DOM_ELEMENTS.formInicialGasContainer) DOM_ELEMENTS.formInicialGasContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueGasEl) DOM_ELEMENTS.resumoEstoqueGasEl.classList.remove('hidden');
    } else { 
        if(DOM_ELEMENTS.btnAbrirInicialGas) DOM_ELEMENTS.btnAbrirInicialGas.classList.remove('hidden'); 
        if(DOM_ELEMENTS.formInicialGasContainer) DOM_ELEMENTS.formInicialGasContainer.classList.add('hidden'); 
        if(DOM_ELEMENTS.resumoEstoqueGasEl) DOM_ELEMENTS.resumoEstoqueGasEl.classList.add('hidden'); 
    }

    const estoqueGas = getEstoqueGas();
    const movs = getGasMovimentacoes();

    const estoqueInicial = estoqueGas.filter(e => e.tipo === 'inicial').reduce((sum, e) => sum + e.quantidade, 0);
    const totalEntradas = estoqueGas.filter(e => e.tipo === 'entrada').reduce((sum, e) => sum + e.quantidade, 0);
    const totalSaidas = movs.filter(m => m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const estoqueAtual = estoqueInicial + totalEntradas - totalSaidas;

    if (DOM_ELEMENTS.estoqueGasInicialEl) DOM_ELEMENTS.estoqueGasInicialEl.textContent = estoqueInicial;
    if (DOM_ELEMENTS.estoqueGasEntradasEl) DOM_ELEMENTS.estoqueGasEntradasEl.textContent = `+${totalEntradas}`;
    if (DOM_ELEMENTS.estoqueGasSaidasEl) DOM_ELEMENTS.estoqueGasSaidasEl.textContent = `-${totalSaidas}`;
    if (DOM_ELEMENTS.estoqueGasAtualEl) DOM_ELEMENTS.estoqueGasAtualEl.textContent = estoqueAtual;

    renderPermissionsUI(); 
}

export async function handleInicialEstoqueSubmit(e) {
    e.preventDefault();
    
    const role = getUserRole(); 
    if (role !== 'admin') { 
        showAlert('alert-inicial-gas', "Permissão negada. Apenas Administradores podem definir o estoque inicial.", 'error'); return; 
    }
    
    const inputQtd = DOM_ELEMENTS.inputInicialQtdGas.value;
    const inputResp = DOM_ELEMENTS.inputInicialResponsavelGas.value;
    
    const quantidade = parseInt(inputQtd, 10);
    const responsavel = capitalizeString(inputResp.trim());

    if (isNaN(quantidade) || quantidade < 0 || !responsavel) { 
        showAlert('alert-inicial-gas', "Preencha a quantidade e o responsável.", 'warning'); return; 
    }
    
    if (isEstoqueInicialDefinido('gas')) {
         showAlert('alert-inicial-gas', "O estoque inicial já foi definido.", 'info'); return;
    }
    
    DOM_ELEMENTS.btnSubmitInicialGas.disabled = true; 
    DOM_ELEMENTS.btnSubmitInicialGas.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueGas, { 
            tipo: 'inicial', 
            quantidade: quantidade, 
            data: serverTimestamp(), 
            responsavel: responsavel, 
            notaFiscal: 'INICIAL', 
            registradoEm: serverTimestamp() 
        });
        showAlert('alert-inicial-gas', "Estoque inicial salvo!", 'success', 2000);
         DOM_ELEMENTS.formInicialGasContainer.classList.add('hidden');
         DOM_ELEMENTS.btnAbrirInicialGas.classList.add('hidden');
    } catch (error) {
        console.error("Erro ao salvar estoque inicial:", error);
        showAlert('alert-inicial-gas', `Erro ao salvar: ${error.message}`, 'error');
        DOM_ELEMENTS.btnSubmitInicialGas.disabled = false; 
        DOM_ELEMENTS.btnSubmitInicialGas.textContent = 'Salvar Inicial'; 
    }
}

export async function handleEntradaEstoqueSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; } 
    
    const role = getUserRole(); 
    if (role !== 'admin') { 
        showAlert('alert-gas', "Permissão negada. Apenas Administradores podem lançar entradas no estoque.", 'error'); return; 
    }

    const inputQtd = DOM_ELEMENTS.inputQtdEntradaGas.value;
    const inputData = DOM_ELEMENTS.inputDataEntradaGas.value;
    const inputResp = DOM_ELEMENTS.inputResponsavelEntradaGas.value;
    const inputNf = DOM_ELEMENTS.inputNfEntradaGas.value;
    
    const quantidade = parseInt(inputQtd, 10);
    const data = dateToTimestamp(inputData);
    const responsavel = capitalizeString(inputResp.trim());
    const notaFiscal = inputNf.trim() || 'N/A'; 

    if (!quantidade || quantidade <= 0 || !data || !responsavel) { 
        showAlert('alert-gas', 'Dados inválidos. Verifique quantidade, data e responsável.', 'warning'); return; 
    }
    if (!isEstoqueInicialDefinido('gas')) { 
        showAlert('alert-gas', `Defina o Estoque Inicial de Gás antes de lançar entradas.`, 'warning'); return; 
    }
    
    DOM_ELEMENTS.btnSubmitEntradaGas.disabled = true; 
    DOM_ELEMENTS.btnSubmitEntradaGas.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    try {
        await addDoc(COLLECTIONS.estoqueGas, { 
            tipo: 'entrada', 
            quantidade: quantidade, 
            data: data, 
            responsavel: responsavel, 
            notaFiscal: notaFiscal, 
            registradoEm: serverTimestamp() 
        });
        showAlert('alert-gas', 'Entrada no estoque salva!', 'success');
        DOM_ELEMENTS.formEntradaGas.reset(); 
        DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString(); 
    } catch (error) {
        console.error("Erro salvar entrada estoque:", error); 
        showAlert('alert-gas', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTS.btnSubmitEntradaGas.disabled = false; 
        DOM_ELEMENTS.btnSubmitEntradaGas.textContent = 'Salvar Entrada'; 
    }
}

// =========================================================================
// LÓGICA DE MOVIMENTAÇÃO
// =========================================================================

export function toggleGasFormInputs() {
    if (!DOM_ELEMENTS.selectTipoGas) return; 
    const tipo = DOM_ELEMENTS.selectTipoGas.value;
    if (tipo === 'troca') {
        DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.remove('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.remove('hidden');
    } else if (tipo === 'entrega') {
        DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.remove('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.add('hidden');
        if(DOM_ELEMENTS.inputQtdRetornoGas) DOM_ELEMENTS.inputQtdRetornoGas.value = "0"; 
    } else if (tipo === 'retorno') {
        DOM_ELEMENTS.formGroupQtdEntregueGas?.classList.add('hidden');
        DOM_ELEMENTS.formGroupQtdRetornoGas?.classList.remove('hidden');
        if(DOM_ELEMENTS.inputQtdEntregueGas) DOM_ELEMENTS.inputQtdEntregueGas.value = "0"; 
    }
}

export function getUnidadeSaldoGas(unidadeId) {
    if (!unidadeId) return 0;
    const movimentacoes = getGasMovimentacoes();
    const entregues = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'entrega').reduce((sum, m) => sum + m.quantidade, 0);
    const recebidos = movimentacoes.filter(m => m.unidadeId === unidadeId && m.tipo === 'retorno').reduce((sum, m) => sum + m.quantidade, 0);
    return entregues - recebidos;
}

export function checkUnidadeSaldoAlertGas() {
    if (!DOM_ELEMENTS.selectUnidadeGas) return;
    const selectValue = DOM_ELEMENTS.selectUnidadeGas.value;
    const saldoAlertaEl = DOM_ELEMENTS.unidadeSaldoAlertaGas;
    
    if (!selectValue || !saldoAlertaEl) {
        if(saldoAlertaEl) saldoAlertaEl.style.display = 'none';
        return;
    }
    
    const [unidadeId, unidadeNome] = selectValue.split('|');
    const saldo = getUnidadeSaldoGas(unidadeId);
    const itemLabel = 'botijão de gás';

    let message = '';
    let type = 'info';
    
    if (saldo > 0) {
        message = `<i data-lucide="alert-triangle" class="w-5 h-5 inline-block -mt-1 mr-2"></i> <strong>ALERTA DE DÉBITO:</strong> A unidade **${unidadeNome}** está devendo **${saldo}** ${itemLabel}${saldo > 1 ? 's' : ''} vazio${saldo > 1 ? 's' : ''}.<br><strong>Ação:</strong> Ao fazer a entrega, certifique-se de pegar os vazios pendentes.`;
        type = 'error'; 
    } else if (saldo < 0) {
        const credito = Math.abs(saldo);
        message = `<i data-lucide="check-circle" class="w-5 h-5 inline-block -mt-1 mr-2"></i> <strong>SALDO POSITIVO (CRÉDITO):</strong> A unidade **${unidadeNome}** tem um crédito de **${credito}** ${itemLabel}${credito > 1 ? 's' : ''}.<br><strong>Motivo:</strong> Ela devolveu mais vasilhames vazios do que recebeu cheios. O saldo está negativo (em crédito).`;
        type = 'success'; 
    } else {
        message = `<i data-lucide="thumbs-up" class="w-5 h-5 inline-block -mt-1 mr-2"></i> <strong>SALDO ZERADO:</strong> A unidade **${unidadeNome}** está com o saldo quite (0).<br><strong>Ação:</strong> Situação ideal para uma troca (entregar 1, receber 1).`;
        type = 'info'; 
    }

    saldoAlertaEl.className = `alert alert-${type} mt-2`;
    saldoAlertaEl.innerHTML = message.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    saldoAlertaEl.style.display = 'block';
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
        lucide.createIcons();
    }
}

export async function handleGasSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-gas', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole(); 
    if (role === 'anon') { 
        showAlert('alert-gas', "Permissão negada. Usuário Anônimo não pode lançar movimentações.", 'error'); return; 
    }

    const selectValue = DOM_ELEMENTS.selectUnidadeGas.value; 
    if (!selectValue) { showAlert('alert-gas', 'Selecione uma unidade.', 'warning'); return; }
    const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
    
    const tipoMovimentacao = DOM_ELEMENTS.selectTipoGas.value; 
    const qtdEntregue = parseInt(DOM_ELEMENTS.inputQtdEntregueGas.value, 10) || 0;
    const qtdRetorno = parseInt(DOM_ELEMENTS.inputQtdRetornoGas.value, 10) || 0;
    const data = dateToTimestamp(DOM_ELEMENTS.inputDataGas.value); 
    const responsavelUnidade = capitalizeString(DOM_ELEMENTS.inputResponsavelGas.value.trim()); 
    
    if (!unidadeId || !data || !responsavelUnidade) {
        showAlert('alert-gas', 'Dados inválidos. Verifique Unidade, Data e Nome de quem Recebeu/Devolveu.', 'warning'); return;
    }
    if (tipoMovimentacao === 'troca' && qtdEntregue === 0 && qtdRetorno === 0) {
         showAlert('alert-gas', 'Para "Troca", ao menos uma das quantidades deve ser maior que zero.', 'warning'); return;
    }
    if (tipoMovimentacao === 'entrega' && qtdEntregue <= 0) {
         showAlert('alert-gas', 'Para "Apenas Saída", a quantidade deve ser maior que zero.', 'warning'); return;
    }
    if (tipoMovimentacao === 'retorno' && qtdRetorno <= 0) {
         showAlert('alert-gas', 'Para "Apenas Retorno", a quantidade deve ser maior que zero.', 'warning'); return;
    }
    
    if (qtdEntregue > 0) {
        if (!isEstoqueInicialDefinido('gas')) {
            showAlert('alert-gas', 'Defina o Estoque Inicial de Gás antes de lançar saídas.', 'warning'); return;
        }
        const estoqueAtual = parseInt(DOM_ELEMENTS.estoqueGasAtualEl.textContent) || 0;
        if (qtdEntregue > estoqueAtual) {
            showAlert('alert-gas', `Erro: Estoque insuficiente. Disponível: ${estoqueAtual}`, 'error'); return;
        }
    }
    
    executeFinalMovimentacao({
        unidadeId, unidadeNome, tipoUnidadeRaw,
        tipoMovimentacao, qtdEntregue, qtdRetorno,
        data, responsavelUnidade, itemType: 'gas'
    });
}

export function renderGasStatus(newFilter = null) {
    if (!DOM_ELEMENTS.tableStatusGas) return;
    
    const currentFilter = newFilter || getCurrentStatusFilter('gas');
    if (newFilter) setCurrentStatusFilter('gas', newFilter);
    
    const statusMap = new Map();
    const nameIndex = new Map();
     getUnidades().forEach(u => { 
        let tipoNormalizado = (u.tipo || 'N/A').toUpperCase();
        if (tipoNormalizado === 'SEMCAS') tipoNormalizado = 'SEDE';
        const obj = { id: u.id, nome: u.nome, tipo: tipoNormalizado, entregues: 0, recebidos: 0, ultimosLancamentos: [] };
        statusMap.set(u.id, obj);
        nameIndex.set(_normName(u.nome), obj);
    });

     const movsOrdenadas = [...getGasMovimentacoes()].sort((a, b) => {
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
         if (m.tipo === 'entrega') unidadeStatus.entregues += m.quantidade;
         else if (m.tipo === 'retorno' || m.tipo === 'retirada') unidadeStatus.recebidos += m.quantidade;
          
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
        DOM_ELEMENTS.tableStatusGas.innerHTML = '<tr><td colspan="6" class="text-center py-4 text-slate-500">Nenhuma movimentação registrada.</td></tr>'; 
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
        
        html += `<tr title="${s.nome} - Saldo: ${saldoText.replace(/<[^>]*>?/gm, '')}">
            <td class="font-medium">${s.nome}</td><td>${s.tipo || 'N/A'}</td>
            <td class="text-center">${s.entregues}</td><td class="text-center">${s.recebidos}</td>
            <td class="text-center font-bold ${saldoClass}">${saldoText}</td>
            <td class="space-x-1 whitespace-nowrap text-xs text-gray-600">
                ${lancamentoDetalhes}
            </td>
        </tr>`;
    });
    DOM_ELEMENTS.tableStatusGas.innerHTML = html;
     if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 

    const filtroStatusGasEl = document.getElementById('filtro-status-gas');
    if (filtroStatusGasEl && filtroStatusGasEl.value) {
        filterTable(filtroStatusGasEl, 'table-status-gas');
    }
}

export function renderGasDebitosResumo() {
    if (!DOM_ELEMENTS.tableDebitoGasResumo) return;
    const statusMap = new Map();
    const nameIndex = new Map();
    getUnidades().forEach(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        const obj = { id: u.id, nome: u.nome, tipo, entregues: 0, recebidos: 0, ultimo: null };
        statusMap.set(u.id, obj);
        nameIndex.set(_normName(u.nome), obj);
    });

    const movsOrdenadas = [...getGasMovimentacoes()].sort((a, b) => {
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
        if (m.tipo === 'entrega') s.entregues += m.quantidade; else if (m.tipo === 'retorno' || m.tipo === 'retirada') s.recebidos += m.quantidade;
        if (!s.ultimo) s.ultimo = { id: m.id, data: m.data, tipo: m.tipo, quantidade: m.quantidade, respUnidade: m.responsavel, respAlmox: m.responsavelAlmoxarifado || 'N/A' };
    });

    const listaBase = Array.from(statusMap.values()).map(s => ({ ...s, pendentes: s.entregues - s.recebidos }));
    let lista = (debitoGasMode === 'credito')
        ? listaBase.filter(s => s.pendentes < 0)
        : listaBase.filter(s => s.pendentes > 0);

    const nomeFiltro = (DOM_ELEMENTS.filtroDebitoGas?.value || '').trim().toLowerCase();
    if (nomeFiltro) lista = lista.filter(s => s.nome.toLowerCase().includes(nomeFiltro));

    const tipoFiltro = DOM_ELEMENTS.filtroResumoGasTipo?.value || '';
    if (tipoFiltro) lista = lista.filter(s => s.tipo === tipoFiltro);

    const pendMinStr = DOM_ELEMENTS.filtroResumoGasPendMin?.value || '';
    const pendMin = pendMinStr ? parseInt(pendMinStr, 10) : null;
    if (pendMin !== null && !isNaN(pendMin)) {
        lista = lista.filter(s => (debitoGasMode === 'credito' ? Math.abs(s.pendentes) : s.pendentes) >= pendMin);
    }

    const dataIniStr = DOM_ELEMENTS.filtroResumoGasDataIni?.value || '';
    const dataFimStr = DOM_ELEMENTS.filtroResumoGasDataFim?.value || '';
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
        const pa = debitoGasMode === 'credito' ? Math.abs(a.pendentes) : a.pendentes;
        const pb = debitoGasMode === 'credito' ? Math.abs(b.pendentes) : b.pendentes;
        return pb - pa || a.nome.localeCompare(b.nome);
    });

    if (lista.length === 0) {
        const vazioMsg = debitoGasMode === 'credito' ? 'Nenhuma unidade com crédito no momento.' : 'Nenhuma unidade devendo vazios no momento.';
        DOM_ELEMENTS.tableDebitoGasResumo.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-500">${vazioMsg}</td></tr>`;
        return;
    }

    const grupos = lista.reduce((acc, s) => { (acc[s.tipo] ||= []).push(s); return acc; }, {});
    const tiposOrdenadosSrc = Object.keys(grupos).sort();
    const tiposUnicos = tiposOrdenadosSrc;
    if (DOM_ELEMENTS.filtroResumoGasTipo && DOM_ELEMENTS.filtroResumoGasTipo.options.length <= 1) {
        const html = ['<option value="">Todos</option>'].concat(tiposUnicos.map(t => `<option value="${t}">${t}</option>`)).join('');
        DOM_ELEMENTS.filtroResumoGasTipo.innerHTML = html;
    }
    const tiposOrdenados = tiposOrdenadosSrc;
    const rows = [];
    tiposOrdenados.forEach(tipo => {
        rows.push(`<tr class="table-group-header"><td colspan="4">${tipo}</td></tr>`);
        grupos[tipo].forEach(s => {
            const ultimoData = s.ultimo ? formatTimestampComTempo(s.ultimo.data) : 'N/A';
            const ultimoTipo = s.ultimo?.tipo || '';
            const ultimoQtd = s.ultimo?.quantidade || '';
            const ultimoResp = s.ultimo ? `Almox: ${s.ultimo.respAlmox} • Unid: ${s.ultimo.respUnidade}` : '';
            const pendText = debitoGasMode === 'credito' ? Math.abs(s.pendentes) : s.pendentes;
            const pendClass = debitoGasMode === 'credito' ? 'text-blue-600' : 'text-red-600';
            rows.push(`<tr>
                <td class="font-medium">${s.nome}</td>
                <td><span class="badge badge-gray">${s.tipo}</span></td>
                <td class="text-center ${pendClass} font-extrabold">${pendText}</td>
                <td class="text-xs text-gray-700">
                    <div class="flex flex-col">
                        <span class="font-medium">${ultimoData}</span>
                        <span class="mt-1 flex items-center gap-2"><span class="badge ${(ultimoTipo==='retorno' || ultimoTipo==='retirada') ? 'badge-green' : 'badge-blue'}">${(ultimoTipo==='retorno' || ultimoTipo==='retirada') ? 'vazio' : 'cheio'}</span><span>${ultimoQtd}</span></span>
                        <span class="text-gray-500">${ultimoResp}</span>
                        <span class="text-gray-400 text-xs">ID: ${s.ultimo?.id || 'N/A'}</span>
                    </div>
                </td>
            </tr>`);
        });
    });
    DOM_ELEMENTS.tableDebitoGasResumo.innerHTML = rows.join('');
}

export function getDebitosGasResumoList() {
    const statusMap = new Map();
    const nameIndex = new Map();
    getUnidades().forEach(u => {
        let tipo = (u.tipo || 'N/A').toUpperCase();
        if (tipo === 'SEMCAS') tipo = 'SEDE';
        const obj = { id: u.id, nome: u.nome, tipo, entregues: 0, recebidos: 0, ultimo: null };
        statusMap.set(u.id, obj);
        nameIndex.set(_normName(u.nome), obj);
    });

    const movsOrdenadas = [...getGasMovimentacoes()].sort((a, b) => {
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
        if (m.tipo === 'entrega') s.entregues += m.quantidade; else if (m.tipo === 'retorno' || m.tipo === 'retirada') s.recebidos += m.quantidade;
        if (!s.ultimo) s.ultimo = { id: m.id, data: m.data, tipo: m.tipo, quantidade: m.quantidade, respUnidade: m.responsavel, respAlmox: m.responsavelAlmoxarifado || 'N/A' };
    });

    const lista = Array.from(statusMap.values())
        .map(s => ({ ...s, pendentes: s.entregues - s.recebidos }))
        .filter(s => s.pendentes > 0)
        .sort((a, b) => b.pendentes - a.pendentes || a.nome.localeCompare(b.nome));

    const mensagens = lista.map(s => {
        const ultimoData = s.ultimo ? formatTimestamp(s.ultimo.data) : 'data não informada';
        const ultimoTipo = s.ultimo?.tipo || '';
        const ultimoQtd = s.ultimo?.quantidade || 0;
        let detalhe = '';
        if (ultimoTipo === 'entrega') detalhe = `última movimentação ${ultimoData}: levou ${ultimoQtd} botijão cheio`;
        else if (ultimoTipo === 'retorno' || ultimoTipo === 'retirada') detalhe = `última movimentação ${ultimoData}: deixou ${ultimoQtd} botijão vazio`;
        return `⚠️ CRAS ${s.nome}: devendo ${s.pendentes} botijão vazio de gás • ${detalhe}`;
    });

    return mensagens;
}

export function renderGasEstoqueHistory() {
    if (!DOM_ELEMENTS.tableHistoricoEstoqueGas) return;
    
    const estoque = getEstoqueGas();
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const itemType = 'gás';

    const historicoOrdenado = [...estoque]
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoEstoqueGas.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-slate-500">Nenhuma entrada de estoque registrada.</td></tr>`;
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
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="entrada-gas" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400 btn-icon" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;

        html += `<tr title="Lançado em: ${dataLancamento}">
            <td><span class="badge ${tipoClass}">${tipoText}</span></td>
            <td class="text-center font-medium">${m.quantidade}</td>
            <td class="whitespace-nowrap">${dataMov}</td>
            <td>${notaFiscal}</td>
            <td>${responsavel}</td>
            <td class="text-center whitespace-nowrap text-xs">${dataLancamento}</td>
            <td class="text-center">${actionHtml}</td>
        </tr>`;
    });

    DOM_ELEMENTS.tableHistoricoEstoqueGas.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = DOM_ELEMENTS.filtroHistoricoEstoqueGas;
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTS.tableHistoricoEstoqueGas.id); }
}

export function renderGasMovimentacoesHistory() {
    if (!DOM_ELEMENTS.tableHistoricoGasAll) return;
    
    const role = getUserRole();
    const isAdmin = role === 'admin';

    const historicoOrdenado = getFilteredGasMovimentacoes()
        .sort((a, b) => (b.registradoEm?.toMillis() || 0) - (a.registradoEm?.toMillis() || 0));

    if (historicoOrdenado.length === 0) {
        DOM_ELEMENTS.tableHistoricoGasAll.innerHTML = `<tr><td colspan="8" class="text-center py-4 text-slate-500">Nenhuma movimentação de unidade registrada.</td></tr>`;
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
            ? `<button class="btn-danger btn-remove btn-icon" data-id="${m.id}" data-type="gas" data-details="${details}" title="Remover este lançamento"><i data-lucide="trash-2"></i></button>`
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

    DOM_ELEMENTS.tableHistoricoGasAll.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }

    const filtroEl = document.getElementById(`filtro-historico-gas`);
    if (filtroEl && filtroEl.value) { filterTable(filtroEl, DOM_ELEMENTS.tableHistoricoGasAll.id); }

    checkGasHistoryIntegrity();
}

function populateGasFilterUnidades() {
    const sel = document.getElementById('filtro-unidade-gas');
    if (!sel) return;
    const tipoSelecionado = document.getElementById('filtro-tipo-gas')?.value || '';
    const tipoUnidadeSelecionado = (document.getElementById('filtro-unidade-tipo-gas')?.value || '').toUpperCase();

    const movs = getGasMovimentacoes().filter(m => (m.tipo === 'entrega' || m.tipo === 'retorno' || m.tipo === 'retirada') && (!tipoSelecionado || m.tipo === tipoSelecionado));
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

function getFilteredGasMovimentacoes() {
    const tipoEl = document.getElementById('filtro-tipo-gas');
    const unidadeEl = document.getElementById('filtro-unidade-gas');
    const unidadeTipoEl = document.getElementById('filtro-unidade-tipo-gas');
    const respEl = document.getElementById('filtro-responsavel-gas');
    const origemEl = document.getElementById('filtro-origem-gas');
    const dataIniEl = document.getElementById('filtro-data-ini-gas') || document.getElementById('filtro-data-inicio-gas');
    const dataFimEl = document.getElementById('filtro-data-fim-gas') || document.getElementById('filtro-data-fim-gas');

    const tipo = tipoEl?.value || '';
    const unidadeId = unidadeEl?.value || '';
    const unidadeTipoSelecionado = (unidadeTipoEl?.value || '').toUpperCase();
    const respQuery = (respEl?.value || '').trim().toLowerCase();
    const origem = origemEl?.value || '';
    const dataIniStr = dataIniEl?.value || '';
    const dataFimStr = dataFimEl?.value || '';

    const base = getGasMovimentacoes().filter(m => (m.tipo === 'entrega' || m.tipo === 'retorno' || m.tipo === 'retirada'));
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
        const isImport = ((m.responsavel || '').toLowerCase().includes('importa')) || ((m.observacao || '').toLowerCase().includes('importado'));
        if (origem === 'importacao' && !isImport) return false;
        if (origem === 'manual' && isImport) return false;
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

function checkGasHistoryIntegrity() {
    const movs = getGasMovimentacoes().filter(m => m.tipo === 'entrega' || m.tipo === 'retorno');
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

    const estoque = getEstoqueGas();
    let inconsistenciasEstoque = 0;
    estoque.forEach(e => {
        if (!e.id) inconsistenciasEstoque++;
        if (!['inicial', 'entrada'].includes(e.tipo)) inconsistenciasEstoque++;
        if (!e.data || typeof e.data.toMillis !== 'function') inconsistenciasEstoque++;
        if (!e.registradoEm || typeof e.registradoEm.toMillis !== 'function') inconsistenciasEstoque++;
        if (!e.quantidade || e.quantidade <= 0) inconsistenciasEstoque++;
    });

    const movMsg = inconsistenciasMov === 0
        ? 'Nenhuma inconsistência detectada nas movimentações de Gás.'
        : `Foram encontradas ${inconsistenciasMov} possíveis inconsistências nas movimentações de Gás. Revise os lançamentos mais antigos.`;
    const estoqueMsg = inconsistenciasEstoque === 0
        ? 'Nenhuma inconsistência detectada nas entradas de estoque de Gás.'
        : `Foram encontradas ${inconsistenciasEstoque} possíveis inconsistências nas entradas de estoque de Gás. Verifique registros de NF e datas.`;

    if (document.getElementById('alert-historico-gas')) {
        showAlert('alert-historico-gas', movMsg, inconsistenciasMov === 0 ? 'info' : 'warning');
    }
    if (document.getElementById('alert-historico-estoque-gas')) {
        showAlert('alert-historico-estoque-gas', estoqueMsg, inconsistenciasEstoque === 0 ? 'info' : 'warning');
    }
}

export function initGasListeners() {
    if (DOM_ELEMENTS.formGas) {
        DOM_ELEMENTS.formGas.addEventListener('submit', handleGasSubmit);
    }
    if (DOM_ELEMENTS.selectTipoGas) {
        DOM_ELEMENTS.selectTipoGas.addEventListener('change', toggleGasFormInputs);
    }
    if (DOM_ELEMENTS.selectUnidadeGas) {
         DOM_ELEMENTS.selectUnidadeGas.addEventListener('change', checkUnidadeSaldoAlertGas);
    }
    if (DOM_ELEMENTS.formInicialGas) {
        DOM_ELEMENTS.formInicialGas.addEventListener('submit', handleInicialEstoqueSubmit);
    }
    if (DOM_ELEMENTS.btnAbrirInicialGas) {
        DOM_ELEMENTS.btnAbrirInicialGas.addEventListener('click', () => { 
            DOM_ELEMENTS.formInicialGasContainer?.classList.remove('hidden'); 
            DOM_ELEMENTS.btnAbrirInicialGas?.classList.add('hidden'); 
        });
    }
    if (DOM_ELEMENTS.formEntradaGas) {
        DOM_ELEMENTS.formEntradaGas.addEventListener('submit', handleEntradaEstoqueSubmit);
    }
    if (document.getElementById('filtro-status-gas')) {
        document.getElementById('filtro-status-gas').addEventListener('input', () => filterTable(document.getElementById('filtro-status-gas'), 'table-status-gas'));
    }
    if (document.getElementById('filtro-historico-gas')) {
        document.getElementById('filtro-historico-gas').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-gas'), 'table-historico-gas-all'));
    }
    if (DOM_ELEMENTS.filtroDebitoGas) {
        DOM_ELEMENTS.filtroDebitoGas.addEventListener('input', () => renderGasDebitosResumo());
    }
    if (DOM_ELEMENTS.filtroResumoGasTipo) DOM_ELEMENTS.filtroResumoGasTipo.addEventListener('change', renderGasDebitosResumo);
    if (DOM_ELEMENTS.filtroResumoGasPendMin) DOM_ELEMENTS.filtroResumoGasPendMin.addEventListener('input', renderGasDebitosResumo);
    if (DOM_ELEMENTS.filtroResumoGasDataIni) DOM_ELEMENTS.filtroResumoGasDataIni.addEventListener('change', renderGasDebitosResumo);
    if (DOM_ELEMENTS.filtroResumoGasDataFim) DOM_ELEMENTS.filtroResumoGasDataFim.addEventListener('change', renderGasDebitosResumo);
    if (DOM_ELEMENTS.btnDebitoGas) {
        DOM_ELEMENTS.btnDebitoGas.addEventListener('click', () => {
            debitoGasMode = 'devendo';
            DOM_ELEMENTS.btnDebitoGas?.classList.add('active');
            DOM_ELEMENTS.btnCreditoGas?.classList.remove('active');
            renderGasDebitosResumo();
        });
    }
    if (DOM_ELEMENTS.btnCreditoGas) {
        DOM_ELEMENTS.btnCreditoGas.addEventListener('click', () => {
            debitoGasMode = 'credito';
            DOM_ELEMENTS.btnCreditoGas?.classList.add('active');
            DOM_ELEMENTS.btnDebitoGas?.classList.remove('active');
            renderGasDebitosResumo();
        });
    }
    if (DOM_ELEMENTS.btnVerStatusGas) {
        DOM_ELEMENTS.btnVerStatusGas.addEventListener('click', () => switchSubTabView('gas', 'status-gas'));
    }
    ['filtro-tipo-gas','filtro-unidade-gas','filtro-responsavel-gas','filtro-origem-gas','filtro-data-ini-gas','filtro-data-fim-gas']
        .forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('input', () => {
                renderGasMovimentacoesHistory();
                const free = document.getElementById('filtro-historico-gas');
                if (free && free.value) filterTable(free, 'table-historico-gas-all');
            });
        });
    const tipoGas = document.getElementById('filtro-tipo-gas');
    if (tipoGas) tipoGas.addEventListener('input', populateGasFilterUnidades);
    const tipoUnidadeGas = document.getElementById('filtro-unidade-tipo-gas');
    if (tipoUnidadeGas) tipoUnidadeGas.addEventListener('input', () => {
        populateGasFilterUnidades();
        renderGasMovimentacoesHistory();
    });
    const btnClear = document.getElementById('btn-limpar-filtros-gas');
    if (btnClear) btnClear.addEventListener('click', () => {
        ['filtro-tipo-gas','filtro-unidade-tipo-gas','filtro-unidade-gas','filtro-responsavel-gas','filtro-origem-gas','filtro-data-ini-gas','filtro-data-fim-gas']
            .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        populateGasFilterUnidades();
        renderGasMovimentacoesHistory();
        const free = document.getElementById('filtro-historico-gas');
        if (free && free.value) filterTable(free, 'table-historico-gas-all');
    });
    populateGasFilterUnidades();
    if (DOM_ELEMENTS.filtroHistoricoEstoqueGas) {
        DOM_ELEMENTS.filtroHistoricoEstoqueGas.addEventListener('input', () => filterTable(DOM_ELEMENTS.filtroHistoricoEstoqueGas, DOM_ELEMENTS.tableHistoricoEstoqueGas.id));
    }
    
    if (document.getElementById('sub-nav-gas')) {
        document.getElementById('sub-nav-gas').addEventListener('click', (e) => {
            const btn = e.target.closest('.sub-nav-btn');
            if (btn && btn.dataset.subview) switchSubTabView('gas', btn.dataset.subview);
        });
    }

    document.querySelectorAll('#filtro-saldo-gas-controls button').forEach(btn => btn.addEventListener('click', (e) => {
        handleSaldoFilterUI('gas', e, renderGasStatus);
    }));

    document.querySelectorAll('#content-gas .form-tab-btn').forEach(btn => btn.addEventListener('click', () => {
        const formName = btn.dataset.form;
        document.querySelectorAll('#content-gas .form-tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (DOM_ELEMENTS.formGas) DOM_ELEMENTS.formGas.classList.toggle('hidden', formName !== 'saida-gas');
        if (DOM_ELEMENTS.formEntradaGas) DOM_ELEMENTS.formEntradaGas.classList.toggle('hidden', formName !== 'entrada-gas');
        renderPermissionsUI(); 
    }));

    const innerNavGas = document.querySelector('#subview-movimentacao-gas .module-inner-subnav');
    if (innerNavGas) {
        innerNavGas.addEventListener('click', (e) => {
            const btn = e.target.closest('button.sub-nav-btn[data-inner]');
            if (!btn) return;
            const target = btn.dataset.inner;
            document.querySelectorAll('#subview-movimentacao-gas .module-inner-subnav .sub-nav-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (target === 'resumo') {
                DOM_ELEMENTS.innerGasResumo?.classList.remove('hidden');
                DOM_ELEMENTS.innerGasLancamento?.classList.add('hidden');
            } else {
                DOM_ELEMENTS.innerGasLancamento?.classList.remove('hidden');
                DOM_ELEMENTS.innerGasResumo?.classList.add('hidden');
            }
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') {
                setTimeout(() => lucide.createIcons(), 50);
            }
        });
    }
    if (DOM_ELEMENTS.btnInnerGasResumo) {
        DOM_ELEMENTS.btnInnerGasResumo.addEventListener('click', () => {
            DOM_ELEMENTS.btnInnerGasResumo.classList.add('active');
            DOM_ELEMENTS.btnInnerGasLancamento?.classList.remove('active');
            DOM_ELEMENTS.innerGasResumo?.classList.remove('hidden');
            DOM_ELEMENTS.innerGasLancamento?.classList.add('hidden');
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { setTimeout(() => lucide.createIcons(), 50); }
        });
    }
    if (DOM_ELEMENTS.btnInnerGasLancamento) {
        DOM_ELEMENTS.btnInnerGasLancamento.addEventListener('click', () => {
            DOM_ELEMENTS.btnInnerGasLancamento.classList.add('active');
            DOM_ELEMENTS.btnInnerGasResumo?.classList.remove('active');
            DOM_ELEMENTS.innerGasLancamento?.classList.remove('hidden');
            DOM_ELEMENTS.innerGasResumo?.classList.add('hidden');
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { setTimeout(() => lucide.createIcons(), 50); }
        });
    }
}

export function onGasTabChange() {
    const currentSubView = document.querySelector('#sub-nav-gas .sub-nav-btn.active')?.dataset.subview || 'movimentacao-gas';
    
    switchSubTabView('gas', currentSubView);
    
    toggleGasFormInputs(); 
    checkUnidadeSaldoAlertGas();
    renderEstoqueGas();
    renderGasDebitosResumo();
    renderGasEstoqueHistory(); 
    renderGasStatus();
    renderGasMovimentacoesHistory();
    if (DOM_ELEMENTS.inputDataGas) DOM_ELEMENTS.inputDataGas.value = getTodayDateString();
    if (DOM_ELEMENTS.inputDataEntradaGas) DOM_ELEMENTS.inputDataEntradaGas.value = getTodayDateString();
    
    const filtroStatus = document.getElementById('filtro-status-gas');
    if (filtroStatus) filtroStatus.value = '';
    const filtroHistorico = document.getElementById('filtro-historico-gas');
    if (filtroHistorico) filtroHistorico.value = '';

    populateGasFilterUnidades();
    checkGasHistoryIntegrity();
    renderPermissionsUI();
}
