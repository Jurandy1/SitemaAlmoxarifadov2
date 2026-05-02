// js/modules/gestao.js
import { addDoc, updateDoc, doc, setDoc } from "firebase/firestore";
import { getUnidades, getUserRole, getSemcasAliases, getSemcasHistDB } from "../utils/cache.js"; // Adicionado getUserRole
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, openConfirmDeleteModal } from "../utils/dom-helpers.js"; 
import { normalizeString, capitalizeString } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";

function _norm(v = "") {
    return String(v || "")
        .replace(/\u00A0/g, ' ')
        .replace(/[\u2010-\u2015\u2212]/g, '-')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim()
        .replace(/\s+/g, ' ');
}

let _gestaoSubview = 'unidades';
let _aliasesOverride = null;

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
         
         const details = `${unidade.nome}${unidade.sigla ? ' [' + unidade.sigla + ']' : ''} (${tipoDisplay})`;

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
                    ${unidade.sigla ? `<span class="unidade-sigla-display ml-2 inline-block text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">${unidade.sigla}</span>` : ''}
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

    const rowDataId = row.dataset.unidadeId;
    const unidade = getUnidades().find(u => u.id === rowDataId);
    const currentSigla = unidade?.sigla || '';
    td.innerHTML = `
        <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
            <input type="text" value="${currentName}" class="edit-input-nome form-input md:col-span-2" placeholder="Novo nome da unidade">
            <input type="text" value="${currentSigla}" class="edit-input-sigla form-input" placeholder="Sigla (opcional)">
        </div>
        <div class="mt-2 space-x-1">
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
        ${unidade?.sigla ? `<span class="unidade-sigla-display ml-2 inline-block text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">${unidade.sigla}</span>` : ''}
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
    const inputNome = td.querySelector('.edit-input-nome');
    const inputSigla = td.querySelector('.edit-input-sigla');
    const newName = capitalizeString(inputNome.value.trim()); 
    const newSigla = (inputSigla?.value || '').trim().toUpperCase();

    if (!newName) {
        showAlert('alert-gestao', 'O nome da unidade não pode ser vazio.', 'warning');
        inputNome.focus();
        return;
    }

    button.disabled = true;
    const cancelButton = td.querySelector('.btn-cancel-edit-unidade');
    if(cancelButton) cancelButton.disabled = true;
    button.innerHTML = '<div class="loading-spinner-small inline-block" style="width: 1em; height: 1em; border-width: 2px;"></div>';

    try {
        const docRef = doc(COLLECTIONS.unidades, unidadeId);
        await updateDoc(docRef, { nome: newName, sigla: newSigla });
        
        td.innerHTML = `
            <span class="unidade-nome-display">${newName}</span>
            ${newSigla ? `<span class="unidade-sigla-display ml-2 inline-block text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700">${newSigla}</span>` : ''}
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
         if (parts.length === 2 || parts.length === 3) {
             let tipo = parts[0].trim().toUpperCase(); 
             if (tipo === 'SEMCAS') tipo = 'SEDE';
             const nome = capitalizeString(parts[1].trim()); 
             const sigla = (parts[2] || '').trim().toUpperCase();
             
             if (tipo && nome) {
                 const existe = unidades.some(u => {
                     let uTipo = (u.tipo || '').toUpperCase();
                     if (uTipo === 'SEMCAS') uTipo = 'SEDE';
                     return normalizeString(u.nome) === normalizeString(nome) && uTipo === tipo;
                 });
                 if (!existe) {
                     const novaUnidade = { nome, tipo, atendeAgua: true, atendeGas: true, atendeMateriais: true };
                     if (sigla) novaUnidade.sigla = sigla;
                     unidadesParaAdd.push(novaUnidade);
                 } else {
                     console.log(`Unidade já existe (ignorada): ${tipo} - ${nome}`);
                 }
             } else { erros.push(`Linha ${index + 1}: Tipo ou Nome vazio.`); }
         } else if (line.trim()) { 
             erros.push(`Linha ${index + 1}: Formato inválido (use TIPO [TAB] NOME [TAB] SIGLA(opcional)).`);
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
         DOM_ELEMENTS.btnBulkAddUnidades.innerHTML = '<i data-lucide="plus-circle"></i><span>Adicionar Unidades</span>';
         if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
     }
}

function setGestaoSubview(subview) {
    _gestaoSubview = subview === 'vinculos' ? 'vinculos' : 'unidades';
    document.querySelectorAll('[data-subview-gestao]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.subviewGestao === _gestaoSubview);
    });
    const vUn = document.getElementById('gestao-sub-unidades');
    const vVi = document.getElementById('gestao-sub-vinculos');
    if (vUn) vUn.classList.toggle('hidden', _gestaoSubview !== 'unidades');
    if (vVi) vVi.classList.toggle('hidden', _gestaoSubview !== 'vinculos');
    if (_gestaoSubview === 'vinculos') renderGestaoVinculos();
}

async function saveGestaoAlias(rawKey, canonicalName) {
    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-gestao', 'Permissão negada. Apenas Administradores podem criar vínculos.', 'error');
        return false;
    }
    const aliases = { ...(getSemcasAliases() || {}), ...(_aliasesOverride || {}) };
    aliases[_norm(rawKey)] = canonicalName;
    try {
        await setDoc(doc(COLLECTIONS.semcasAliases, 'config'), { aliases }, { merge: true });
        _aliasesOverride = aliases;
        showAlert('alert-gestao', 'Vínculo salvo com sucesso.', 'success', 2500);
        return true;
    } catch (error) {
        showAlert('alert-gestao', `Erro ao salvar vínculo: ${error.message}`, 'error');
        return false;
    }
}

async function removeGestaoAlias(rawKey) {
    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-gestao', 'Permissão negada. Apenas Administradores podem remover vínculos.', 'error');
        return false;
    }
    const aliases = { ...(getSemcasAliases() || {}), ...(_aliasesOverride || {}) };
    delete aliases[_norm(rawKey)];
    try {
        await setDoc(doc(COLLECTIONS.semcasAliases, 'config'), { aliases }, { merge: true });
        _aliasesOverride = aliases;
        showAlert('alert-gestao', 'Vínculo removido com sucesso.', 'success', 2500);
        return true;
    } catch (error) {
        showAlert('alert-gestao', `Erro ao remover vínculo: ${error.message}`, 'error');
        return false;
    }
}

function renderGestaoVinculos() {
    const container = document.getElementById('gestao-vinc-list');
    if (!container) return;

    const busca = _norm(document.getElementById('gestao-vinc-busca')?.value || '').toLowerCase();
    const modo = document.getElementById('gestao-vinc-filtro')?.value || 'pendentes';
    const unidades = (getUnidades() || []).filter(u => (u?.atendeMateriais ?? true) === true);
    const aliases = { ...(getSemcasAliases() || {}), ...(_aliasesOverride || {}) };

    const rawCandidates = new Map();
    (getSemcasHistDB() || []).forEach(entry => {
        (entry.units || []).forEach(u => {
            const raw = String(u?.rawUnit || u?.unitName || '').trim();
            if (!raw) return;
            const k = _norm(raw);
            if (!rawCandidates.has(k)) rawCandidates.set(k, raw);
        });
    });

    let rows = [...rawCandidates.entries()].map(([k, raw]) => ({ key: k, raw, mapped: aliases[k] || '' }));
    if (busca) rows = rows.filter(r => _norm(r.raw).toLowerCase().includes(busca) || _norm(r.mapped).toLowerCase().includes(busca));
    if (modo === 'pendentes') rows = rows.filter(r => !r.mapped);
    rows.sort((a,b) => a.raw.localeCompare(b.raw, 'pt-BR'));

    if (!rows.length) {
        container.innerHTML = `<div class="text-sm text-slate-500 p-4 border border-dashed rounded-lg">Nenhum vínculo pendente encontrado.</div>`;
        return;
    }

    const opts = unidades
        .slice()
        .sort((a,b) => String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'))
        .map(u => {
            let t = String(u?.tipo || '').toUpperCase();
            if (t === 'SEMCAS') t = 'SEDE';
            const label = (t ? t + ': ' : '') + String(u.nome || '');
            return `<option value="${u.nome}">${label}</option>`;
        }).join('');

    let html = `<div class="overflow-x-auto border border-gray-200 rounded-lg"><table class="table w-full text-sm"><thead class="bg-gray-50"><tr><th>Nome na planilha</th><th>Unidade vinculada</th><th>Tipo</th><th class="text-right">Ação</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
        html += `<tr data-vrow="${i}">
            <td class="font-medium">${r.raw}</td>
            <td><select class="form-select gestao-vinc-select" data-key="${r.key}" data-current="${r.mapped}" style="min-width:280px"><option value="">-- Selecione --</option>${opts}</select></td>
            <td class="gestao-vinc-tipo text-slate-500"></td>
            <td class="text-right whitespace-nowrap">
                <button type="button" class="btn-primary !py-1 !px-3 text-xs gestao-vinc-save" data-key="${r.key}">Salvar</button>
                ${r.mapped ? `<button type="button" class="btn-danger !py-1 !px-3 text-xs gestao-vinc-del ml-2" data-key="${r.key}">Remover</button>` : ''}
            </td>
        </tr>`;
    });
    html += `</tbody></table></div>`;
    container.innerHTML = html;

    const tipoFromName = (name) => {
        const u = unidades.find(x => String(x.nome || '').toLowerCase() === String(name || '').toLowerCase());
        let t = String(u?.tipo || '').toUpperCase();
        if (t === 'SEMCAS') t = 'SEDE';
        return t;
    };

    container.querySelectorAll('.gestao-vinc-select').forEach(sel => {
        const current = String(sel.dataset.current || '').trim();
        sel.value = current;
        if (current && !sel.value) {
            const curNorm = _norm(current);
            const opt = [...sel.options].find(o => _norm(o.value) === curNorm);
            if (opt) sel.value = opt.value;
        }
        const tr = sel.closest('tr');
        const tipoEl = tr?.querySelector('.gestao-vinc-tipo');
        const refreshTipo = () => { if (tipoEl) tipoEl.textContent = tipoFromName(sel.value) || '—'; };
        sel.addEventListener('change', refreshTipo);
        refreshTipo();
    });

    container.querySelectorAll('.gestao-vinc-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.dataset.key;
            const sel = container.querySelector(`.gestao-vinc-select[data-key="${key}"]`);
            const val = sel?.value || '';
            if (!val) {
                showAlert('alert-gestao', 'Selecione uma unidade para salvar o vínculo.', 'warning');
                return;
            }
            const ok = await saveGestaoAlias(key, val);
            if (ok) renderGestaoVinculos();
        });
    });

    container.querySelectorAll('.gestao-vinc-del').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (!confirm('Remover este vínculo de materiais?')) return;
            const ok = await removeGestaoAlias(btn.dataset.key);
            if (ok) renderGestaoVinculos();
        });
    });
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
    document.querySelectorAll('[data-subview-gestao]').forEach(btn => {
        btn.addEventListener('click', () => setGestaoSubview(btn.dataset.subviewGestao));
    });
    const vincBusca = document.getElementById('gestao-vinc-busca');
    if (vincBusca) vincBusca.addEventListener('input', renderGestaoVinculos);
    const vincFiltro = document.getElementById('gestao-vinc-filtro');
    if (vincFiltro) vincFiltro.addEventListener('change', renderGestaoVinculos);
}

/**
 * Função de orquestração para a tab de Gestão.
 */
export function onGestaoTabChange() {
    renderGestaoUnidades();
    setGestaoSubview(_gestaoSubview);
}
