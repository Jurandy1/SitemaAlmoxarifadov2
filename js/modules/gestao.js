// js/modules/gestao.js
import { addDoc, updateDoc, doc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getUnidades, getUserRole } from "../utils/cache.js"; // Adicionado getUserRole
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, openConfirmDeleteModal } from "../utils/dom-helpers.js"; 
import { normalizeString, capitalizeString } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";

// =========================================================================
// LÓGICA DE RENDERIZAÇÃO E FILTRO
// =========================================================================

/**
 * Renderiza a tabela de gestão de unidades com filtros.
 */
export function renderGestaoUnidades() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.tableGestaoUnidades) return;
    
    const unidades = getUnidades();
    const filtroNome = normalizeString(DOM_ELEMENTS.filtroUnidadeNome?.value || '');
    const filtroTipo = normalizeString(DOM_ELEMENTS.filtroUnidadeTipo?.value || '');
    const role = getUserRole(); // Obter o role para renderização condicional
    const isAdmin = role === 'admin';
    
    const unidadesFiltradas = unidades.filter(unidade => {
        const nomeNormalizado = normalizeString(unidade.nome);
        let tipoNormalizado = normalizeString(unidade.tipo);
        if (tipoNormalizado === 'semcas') tipoNormalizado = 'sede';
        
        const nomeMatch = !filtroNome || nomeNormalizado.includes(filtroNome);
        const tipoMatch = !filtroTipo || tipoNormalizado.includes(normalizeString(filtroTipo));
        return nomeMatch && tipoMatch;
    });

    if (unidadesFiltradas.length === 0) { 
        DOM_ELEMENTS.tableGestaoUnidades.innerHTML = `<tr><td colspan="6" class="text-center py-4 text-slate-500">Nenhuma unidade encontrada.</td></tr>`; 
        return; 
    }
    
    let html = '';
    unidadesFiltradas.forEach(unidade => {
         let tipoDisplay = (unidade.tipo || 'N/A').toUpperCase();
         if (tipoDisplay === 'SEMCAS') tipoDisplay = 'SEDE';
         
         const details = `${unidade.nome} (${tipoDisplay})`;

         // DESABILITA/OCULTA os botões/inputs de ação para não-Admin
         const toggleDisabled = isAdmin ? '' : 'disabled';
         const actionHtml = isAdmin 
            ? `<button class="btn-danger btn-remove" data-id="${unidade.id}" data-type="unidade" data-details="${details}" title="Remover esta unidade e seu histórico"><i data-lucide="trash-2"></i></button>`
            : `<span class="text-gray-400" title="Apenas Admin pode excluir"><i data-lucide="slash"></i></span>`;
         const editButtonHtml = isAdmin 
            ? `<button class="btn-icon btn-edit-unidade ml-1" title="Editar nome"><i data-lucide="pencil"></i></button>`
            : '';

         html += `<tr data-unidade-id="${unidade.id}">
                <td class="font-medium">
                    <span class="unidade-nome-display">${unidade.nome}</span>
                    ${editButtonHtml}
                </td>
                <td>${tipoDisplay}</td>
                <td class="text-center"><input type="checkbox" class="form-toggle gestao-toggle" data-field="atendeAgua" ${toggleDisabled} ${(unidade.atendeAgua ?? true) ? 'checked' : ''}></td>
                <td class="text-center"><input type="checkbox" class="form-toggle gestao-toggle" data-field="atendeGas" ${toggleDisabled} ${(unidade.atendeGas ?? true) ? 'checked' : ''}></td>
                <td class="text-center"><input type="checkbox" class="form-toggle gestao-toggle" data-field="atendeMateriais" ${toggleDisabled} ${(unidade.atendeMateriais ?? true) ? 'checked' : ''}></td>
                <td class="text-center">
                    ${actionHtml}
                </td>
            </tr>`;
    });
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    DOM_ELEMENTS.tableGestaoUnidades.innerHTML = html;

    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 
}

// =========================================================================
// LÓGICA DE AÇÕES (Toggle, Edição, Bulk Add)
// =========================================================================

/**
 * Lida com a mudança dos toggles de serviço.
 */
async function handleGestaoToggle(e) {
    const role = getUserRole();
    // PERMISSÃO: Admin-Only
    if (role !== 'admin') {
        showAlert('alert-gestao', "Permissão negada. Apenas Administradores podem alterar unidades.", 'error');
        // Reverter o estado do checkbox na UI se for Editor
        const checkbox = e.target.closest('.gestao-toggle');
        if (checkbox) checkbox.checked = !checkbox.checked;
        return;
    }

    const checkbox = e.target.closest('.gestao-toggle'); 
    if (!checkbox) return; 
    
    const row = checkbox.closest('tr');
    const id = row?.dataset.unidadeId; 
    const field = checkbox.dataset.field; 
    const value = checkbox.checked; 
    
    if (!isReady() || !id || !field) return; 
    
    checkbox.disabled = true; 
    
    try {
        const docRef = doc(COLLECTIONS.unidades, id); 
        await updateDoc(docRef, { [field]: value });
        showAlert('alert-gestao', 'Status atualizado!', 'success', 2000);
    } catch (error) { 
        console.error("Erro atualizar unidade:", error); 
        showAlert('alert-gestao', `Erro: ${error.message}`, 'error'); 
        checkbox.checked = !value; // Reverte na UI em caso de erro no DB
    } finally { 
        checkbox.disabled = false; 
    }
}

/**
 * Alterna a visualização para o modo de edição de nome.
 */
function handleEditUnidadeClick(e) {
    const button = e.target.closest('.btn-edit-unidade');
    if (!button) return;
    
    const role = getUserRole();
    // PERMISSÃO: Admin-Only
    if (role !== 'admin') {
        showAlert('alert-gestao', "Permissão negada. Apenas Administradores podem editar unidades.", 'error');
        return;
    }

    const td = button.closest('td');
    const row = button.closest('tr');
    const nomeSpan = td.querySelector('.unidade-nome-display');
    const currentName = nomeSpan.textContent;

    td.innerHTML = `
        <input type="text" value="${currentName}" class="edit-input form-input w-full" placeholder="Novo nome da unidade">
        <div class="mt-1 space-x-1">
            <button class="btn-icon btn-save-unidade text-green-600 hover:text-green-800" title="Salvar"><i data-lucide="save"></i></button>
            <button class="btn-icon btn-cancel-edit-unidade text-red-600 hover:text-red-800" title="Cancelar"><i data-lucide="x-circle"></i></button>
        </div>
    `;
    row.classList.add('editing-row'); 
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 
    td.querySelector('input').focus(); 
}

/**
 * Cancela a edição do nome da unidade.
 */
function handleCancelEditUnidadeClick(e) {
    const button = e.target.closest('.btn-cancel-edit-unidade');
    if (!button) return;
    
    const role = getUserRole();
    if (role !== 'admin') { return; } // Checagem para evitar que Editor "cancele" uma edição que não deveria ter iniciado

    const td = button.closest('td');
    const row = button.closest('tr');
    const unidadeId = row.dataset.unidadeId;
    const unidade = getUnidades().find(u => u.id === unidadeId);
    
    td.innerHTML = `
        <span class="unidade-nome-display">${unidade?.nome || 'Erro'}</span> 
        <button class="btn-icon btn-edit-unidade ml-1" title="Editar nome"><i data-lucide="pencil"></i></button>
    `;
    row.classList.remove('editing-row'); 
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 
}

/**
 * Salva o novo nome da unidade.
 */
async function handleSaveUnidadeClick(e) {
    const button = e.target.closest('.btn-save-unidade');
    if (!button) return;

    const role = getUserRole();
    // PERMISSÃO: Admin-Only
    if (role !== 'admin') {
        showAlert('alert-gestao', "Permissão negada. Apenas Administradores podem salvar edições de unidades.", 'error');
        return;
    }
    
    const td = button.closest('td');
    const row = button.closest('tr');
    const unidadeId = row.dataset.unidadeId;
    const input = td.querySelector('.edit-input');
    const newName = capitalizeString(input.value.trim()); 

    if (!newName) {
        showAlert('alert-gestao', 'O nome da unidade não pode ser vazio.', 'warning');
        input.focus();
        return;
    }

    button.disabled = true;
    const cancelButton = td.querySelector('.btn-cancel-edit-unidade');
    if(cancelButton) cancelButton.disabled = true;
    button.innerHTML = '<div class="loading-spinner-small inline-block" style="width: 1em; height: 1em; border-width: 2px;"></div>';

    try {
        const docRef = doc(COLLECTIONS.unidades, unidadeId);
        await updateDoc(docRef, { nome: newName });
        
        td.innerHTML = `
            <span class="unidade-nome-display">${newName}</span>
            <button class="btn-icon btn-edit-unidade ml-1" title="Editar nome"><i data-lucide="pencil"></i></button>
        `;
         row.classList.remove('editing-row'); 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
        showAlert('alert-gestao', 'Nome da unidade atualizado!', 'success', 2000);
    
    } catch (error) {
        console.error("Erro ao salvar nome da unidade:", error);
        showAlert('alert-gestao', `Erro ao salvar: ${error.message}`, 'error');
        button.disabled = false;
         if(cancelButton) cancelButton.disabled = false;
        button.innerHTML = '<i data-lucide="save"></i>'; 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Adiciona unidades em lote.
 */
export async function handleBulkAddUnidades() {
     const role = getUserRole();
     // PERMISSÃO: Admin-Only
     if (role !== 'admin') {
         showAlert('alert-gestao', "Permissão negada. Apenas Administradores podem adicionar unidades.", 'error');
         return;
     }

     // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
     if (!isReady() || !DOM_ELEMENTS.textareaBulkUnidades) return;
     
     const text = DOM_ELEMENTS.textareaBulkUnidades.value.trim();
     if (!text) { showAlert('alert-gestao', 'A área de texto está vazia.', 'warning'); return; }
     
     const lines = text.split('\n');
     const unidades = getUnidades();
     const unidadesParaAdd = [];
     const erros = [];
     
     lines.forEach((line, index) => {
         const parts = line.split('\t');
         if (parts.length === 2) {
             let tipo = parts[0].trim().toUpperCase(); 
             if (tipo === 'SEMCAS') tipo = 'SEDE';
             const nome = capitalizeString(parts[1].trim()); 
             
             if (tipo && nome) {
                 const existe = unidades.some(u => {
                     let uTipo = (u.tipo || '').toUpperCase();
                     if (uTipo === 'SEMCAS') uTipo = 'SEDE';
                     return normalizeString(u.nome) === normalizeString(nome) && uTipo === tipo;
                 });
                 if (!existe) {
                     unidadesParaAdd.push({ nome, tipo, atendeAgua: true, atendeGas: true, atendeMateriais: true });
                 } else {
                     console.log(`Unidade já existe (ignorada): ${tipo} - ${nome}`);
                 }
             } else { erros.push(`Linha ${index + 1}: Tipo ou Nome vazio.`); }
         } else if (line.trim()) { 
             erros.push(`Linha ${index + 1}: Formato inválido (use TIPO [TAB] NOME).`);
         }
     });

     if (unidadesParaAdd.length === 0) {
         showAlert('alert-gestao', 'Nenhuma unidade nova para adicionar (ou todas já existem/formato inválido).', 'info');
         if(erros.length > 0) console.warn("Erros na importação:", erros);
         return;
     }
     
     DOM_ELEMENTS.btnBulkAddUnidades.disabled = true; 
     DOM_ELEMENTS.btnBulkAddUnidades.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
     let adicionadasCount = 0;
     
     try {
         for (const unidade of unidadesParaAdd) {
             await addDoc(COLLECTIONS.unidades, unidade);
             adicionadasCount++;
         }
         showAlert('alert-gestao', `${adicionadasCount} unidade(s) adicionada(s) com sucesso!`, 'success');
         DOM_ELEMENTS.textareaBulkUnidades.value = ''; 
         
         if(erros.length > 0) {
              showAlert('alert-gestao', `Algumas linhas foram ignoradas. Verifique o console (F12) para detalhes.`, 'warning', 8000);
              console.warn("Erros/Avisos na importação:", erros);
         }
     } catch (error) {
         console.error("Erro ao adicionar unidades em lote:", error);
         showAlert('alert-gestao', `Erro ao adicionar unidades: ${error.message}. ${adicionadasCount} foram adicionadas antes do erro.`, 'error');
     } finally {
         DOM_ELEMENTS.btnBulkAddUnidades.disabled = false; 
         DOM_ELEMENTS.btnBulkAddUnidades.textContent = 'Adicionar Unidades';
     }
}

// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initGestaoListeners() {
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.tableGestaoUnidades) { 
        DOM_ELEMENTS.tableGestaoUnidades.addEventListener('click', handleEditUnidadeClick);
        DOM_ELEMENTS.tableGestaoUnidades.addEventListener('click', handleCancelEditUnidadeClick);
        DOM_ELEMENTS.tableGestaoUnidades.addEventListener('click', handleSaveUnidadeClick);
        DOM_ELEMENTS.tableGestaoUnidades.addEventListener('change', handleGestaoToggle); 
    }
    if (DOM_ELEMENTS.filtroUnidadeNome) {
        DOM_ELEMENTS.filtroUnidadeNome.addEventListener('input', renderGestaoUnidades); 
    }
    if (DOM_ELEMENTS.filtroUnidadeTipo) {
        DOM_ELEMENTS.filtroUnidadeTipo.addEventListener('input', renderGestaoUnidades); 
    }
    if (DOM_ELEMENTS.btnBulkAddUnidades) {
        DOM_ELEMENTS.btnBulkAddUnidades.addEventListener('click', handleBulkAddUnidades);
    }
}

/**
 * Função de orquestração para a tab de Gestão.
 */
export function onGestaoTabChange() {
    renderGestaoUnidades();
}
