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
let _gestaoVincCreateKey = null;
let _gestaoVincMode = 'lista'; // 'lista' | 'massa'
let _gestaoVincSelected = new Set(); // keys selecionadas (modo massa)

function _guessTipoFromRaw(raw = '') {
    const s = _norm(raw);
    if (/\bCRAS\b/.test(s)) return 'CRAS';
    if (/\bCREAS\b/.test(s)) return 'CREAS';
    if (/\bCT\b/.test(s) || /CONSELHO\s+TUTELAR/.test(s)) return 'CT';
    if (/\bPOP\b/.test(s) || /CENTRO\s+POP/.test(s)) return 'POP';
    if (/\bABRIGO\b/.test(s) || /\bACOLH/.test(s)) return 'ABRIGO';
    if (/\bSEMCAS\b/.test(s) || /\bSEDE\b/.test(s)) return 'SEDE';
    return 'OUTROS';
}

function _suggestUnitsForRaw(raw, unidades, limit = 3) {
    const rawNorm = _norm(raw).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!rawNorm) return [];
    const stop = new Set(['DE','DA','DO','DAS','DOS','E','EM','NA','NO','NAS','NOS','A','O']);
    const rawTokens = rawNorm.split(' ').filter(t => t.length >= 2 && !stop.has(t));
    const rawSet = new Set(rawTokens);

    const score = (u) => {
        const nome = String(u?.nome || '').trim();
        const sigla = String(u?.sigla || '').trim();
        const hay0 = _norm(`${nome} ${sigla}`).replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!hay0) return { nome, score: 0 };
        if (hay0 === rawNorm) return { nome, score: 100 };
        let s = 0;
        if (hay0.includes(rawNorm) || rawNorm.includes(hay0)) s += 60;
        const tokens = hay0.split(' ').filter(t => t.length >= 2 && !stop.has(t));
        let hit = 0;
        tokens.forEach(t => { if (rawSet.has(t)) hit++; });
        if (rawSet.size) s += Math.round((hit / Math.max(rawSet.size, 1)) * 35);
        if (rawTokens.length && tokens.length && rawTokens[0] === tokens[0]) s += 10;
        return { nome, score: s };
    };

    return (unidades || [])
        .map(score)
        .filter(x => x.score > 0 && x.nome)
        .sort((a,b) => b.score - a.score || a.nome.localeCompare(b.nome, 'pt-BR'))
        .slice(0, limit)
        .map(x => x.nome);
}

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

async function saveGestaoAliasesBulk(pairs) {
    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-gestao', 'Permissão negada. Apenas Administradores podem criar vínculos.', 'error');
        return false;
    }
    const entries = Array.isArray(pairs) ? pairs : [];
    if (!entries.length) return true;
    const aliases = { ...(getSemcasAliases() || {}), ...(_aliasesOverride || {}) };
    entries.forEach(({ rawKey, canonicalName }) => {
        const k = _norm(rawKey);
        const v = String(canonicalName || '').trim();
        if (!k || !v) return;
        aliases[k] = v;
    });
    try {
        await setDoc(doc(COLLECTIONS.semcasAliases, 'config'), { aliases }, { merge: true });
        _aliasesOverride = aliases;
        showAlert('alert-gestao', `${entries.length} vínculo(s) salvo(s) com sucesso.`, 'success', 2500);
        return true;
    } catch (error) {
        showAlert('alert-gestao', `Erro ao salvar vínculos: ${error.message}`, 'error');
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
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const escHtml = (s) => String(s ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

    const rawCandidates = new Map();
    (getSemcasHistDB() || []).forEach(entry => {
        (entry.units || []).forEach(u => {
            const raw = String(u?.rawUnit || u?.unitName || '').trim();
            if (!raw) return;
            const k = _norm(raw);
            if (!rawCandidates.has(k)) rawCandidates.set(k, { raw, count: 1 });
            else rawCandidates.get(k).count += 1;
        });
    });

    let rows = [...rawCandidates.entries()].map(([k, v]) => ({ key: k, raw: v.raw, count: v.count, mapped: aliases[k] || '' }));
    if (busca) rows = rows.filter(r => _norm(r.raw).toLowerCase().includes(busca) || _norm(r.mapped).toLowerCase().includes(busca));
    if (modo === 'pendentes') rows = rows.filter(r => !r.mapped);
    rows.sort((a,b) => (b.count - a.count) || a.raw.localeCompare(b.raw, 'pt-BR'));

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
            return `<option value="${escHtml(u.nome)}">${escHtml(label)}</option>`;
        }).join('');

    const tipoOpts = ['SEDE','CT','CRAS','CREAS','POP','ABRIGO','OUTROS']
        .map(t => `<option value="${t}">${t}</option>`).join('');

    const datalist = unidades
        .slice()
        .sort((a,b) => String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'))
        .map((u) => {
            let t = String(u?.tipo || '').toUpperCase();
            if (t === 'SEMCAS') t = 'SEDE';
            const nome = String(u?.nome || '').trim();
            const sigla = String(u?.sigla || '').trim().toUpperCase();
            const label = (t ? t + ': ' : '') + nome + (sigla ? ` [${sigla}]` : '');
            return `<option value="${escHtml(nome)}" label="${escHtml(label)}"></option>`;
        }).join('');

    const modeBtns = `
        <div class="flex flex-wrap items-center gap-2 mb-4">
            <button type="button" class="btn-secondary ${_gestaoVincMode === 'lista' ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800' : ''} !py-1.5 !px-3 text-xs" data-gestao-vinc-mode="lista">Lista</button>
            <button type="button" class="btn-secondary ${_gestaoVincMode === 'massa' ? 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800' : ''} !py-1.5 !px-3 text-xs" data-gestao-vinc-mode="massa">Seleção múltipla</button>
            <span class="text-xs text-slate-500 ml-2">Manual: use o campo “Digite para achar a unidade…” ou o select.</span>
        </div>
    `;

    const bulkPanel = (() => {
        if (_gestaoVincMode !== 'massa') return '';
        const selectedCount = _gestaoVincSelected?.size || 0;
        return `
            <div class="p-3 border border-gray-200 rounded-lg bg-slate-50 mb-4">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
                    <div class="md:col-span-2">
                        <label class="form-label text-xs">Unidade destino (para aplicar nos selecionados)</label>
                        <input type="search" class="form-input" id="gestao-vinc-bulk-pick" list="gestao-unidades-datalist" placeholder="Digite para achar a unidade..." ${isAdmin ? '' : 'disabled'}>
                    </div>
                    <div>
                        <label class="form-label text-xs">Ou selecione</label>
                        <select class="form-select" id="gestao-vinc-bulk-select" ${isAdmin ? '' : 'disabled'}>
                            <option value="">-- Selecione --</option>
                            ${opts}
                        </select>
                    </div>
                </div>
                <div class="flex flex-wrap gap-2 mt-3">
                    <button type="button" class="btn-secondary !py-1 !px-3 text-xs" id="gestao-vinc-select-all">Selecionar todos (filtrados)</button>
                    <button type="button" class="btn-secondary !py-1 !px-3 text-xs" id="gestao-vinc-clear-sel">Limpar seleção</button>
                    <div class="flex-1"></div>
                    <span class="text-xs text-slate-600 self-center">Selecionados: <b id="gestao-vinc-selected-count">${selectedCount}</b></span>
                    <button type="button" class="btn-primary !py-1 !px-3 text-xs" id="gestao-vinc-apply-bulk" ${isAdmin ? '' : 'disabled'}>Aplicar vínculo</button>
                </div>
                <div class="text-xs text-slate-500 mt-2">Dica: marque vários “Nomes na planilha” e aponte todos para uma unidade cadastrada.</div>
            </div>
        `;
    })();

    let html = `${modeBtns}${bulkPanel}<div class="overflow-x-auto border border-gray-200 rounded-lg"><table class="table w-full text-sm"><thead class="bg-gray-50"><tr>${_gestaoVincMode === 'massa' ? '<th class="text-center">Sel.</th>' : ''}<th>Nome na planilha</th><th class="text-center">Ocorr.</th><th>Sugestões</th><th>Unidade vinculada</th><th>Tipo</th><th class="text-right">Ação</th></tr></thead><tbody>`;
    rows.forEach((r, i) => {
        const sugg = _suggestUnitsForRaw(r.raw, unidades, 3);
        const suggHtml = sugg.length
            ? `<div class="flex flex-wrap gap-2">${sugg.map(n => `<button type="button" class="btn-secondary !py-1 !px-2 text-xs gestao-vinc-suggest" data-key="${escHtml(r.key)}" data-name="${escHtml(n)}">${escHtml(n)}</button>`).join('')}</div>`
            : `<span class="text-xs text-slate-400">—</span>`;

        const isCreate = _gestaoVincCreateKey === r.key;
        const createNome = r.raw;
        const createTipo = _guessTipoFromRaw(r.raw);
        const isSelected = _gestaoVincSelected?.has?.(r.key) === true;

        html += `<tr data-vrow="${i}" data-vkey="${escHtml(r.key)}">
            ${_gestaoVincMode === 'massa'
                ? `<td class="text-center"><input type="checkbox" class="form-toggle gestao-vinc-check" data-key="${escHtml(r.key)}" ${isSelected ? 'checked' : ''}></td>`
                : ''
            }
            <td class="font-medium">${escHtml(r.raw)}</td>
            <td class="text-center text-slate-600">${r.count}</td>
            <td>${suggHtml}</td>
            <td>
                ${isCreate
                    ? `<div class="grid grid-cols-1 md:grid-cols-3 gap-2 min-w-[320px]">
                           <input type="text" class="form-input gestao-vinc-new-nome md:col-span-2" value="${escHtml(createNome)}" placeholder="Nome da unidade">
                           <input type="text" class="form-input gestao-vinc-new-sigla" placeholder="Sigla (opcional)">
                       </div>
                       <div class="mt-2">
                           <select class="form-select gestao-vinc-new-tipo">
                               ${tipoOpts}
                           </select>
                       </div>`
                    : `<div style="min-width:320px;display:grid;gap:6px">
                           <input type="search" class="form-input gestao-vinc-pick" data-key="${escHtml(r.key)}" list="gestao-unidades-datalist" placeholder="Digite para achar a unidade..." value="${escHtml(r.mapped || '')}" ${isAdmin ? '' : 'disabled'}>
                           <select class="form-select gestao-vinc-select" data-key="${escHtml(r.key)}" data-current="${escHtml(r.mapped)}" ${isAdmin ? '' : 'disabled'}><option value="">-- Selecione --</option>${opts}</select>
                       </div>`
                }
            </td>
            <td class="gestao-vinc-tipo text-slate-500"></td>
            <td class="text-right whitespace-nowrap">
                ${isCreate
                    ? `<button type="button" class="btn-primary !py-1 !px-3 text-xs gestao-vinc-create-save" data-key="${escHtml(r.key)}" ${isAdmin ? '' : 'disabled'}>Criar e vincular</button>
                       <button type="button" class="btn-secondary !py-1 !px-3 text-xs ml-2 gestao-vinc-create-cancel" data-key="${escHtml(r.key)}">Cancelar</button>`
                    : `<button type="button" class="btn-primary !py-1 !px-3 text-xs gestao-vinc-save" data-key="${escHtml(r.key)}" ${isAdmin ? '' : 'disabled'}>Salvar</button>
                       ${r.mapped ? `<button type="button" class="btn-danger !py-1 !px-3 text-xs gestao-vinc-del ml-2" data-key="${escHtml(r.key)}" ${isAdmin ? '' : 'disabled'}>Remover</button>` : ''}
                       <button type="button" class="btn-secondary !py-1 !px-3 text-xs ml-2 gestao-vinc-create" data-key="${escHtml(r.key)}" ${isAdmin ? '' : 'disabled'}>➕ Criar</button>`
                }
            </td>
        </tr>`;
    });
    html += `</tbody></table></div><datalist id="gestao-unidades-datalist">${datalist}</datalist>`;
    container.innerHTML = html;

    const tipoFromName = (name) => {
        const u = unidades.find(x => String(x.nome || '').toLowerCase() === String(name || '').toLowerCase());
        let t = String(u?.tipo || '').toUpperCase();
        if (t === 'SEMCAS') t = 'SEDE';
        return t;
    };

    container.querySelectorAll('.gestao-vinc-new-tipo').forEach(sel => {
        sel.value = _guessTipoFromRaw(sel.closest('tr')?.querySelector('td')?.textContent || '') || 'OUTROS';
    });

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
        const pick = tr?.querySelector('.gestao-vinc-pick');
        const refreshTipo = () => { if (tipoEl) tipoEl.textContent = tipoFromName(sel.value) || '—'; };
        sel.addEventListener('change', refreshTipo);
        sel.addEventListener('change', () => { if (pick) pick.value = sel.value || ''; });
        refreshTipo();
    });

    container.querySelectorAll('.gestao-vinc-pick').forEach(inp => {
        const key = inp.dataset.key;
        const sel = container.querySelector(`.gestao-vinc-select[data-key="${key}"]`);
        if (!sel) return;

        const resolveToSelect = () => {
            const typed = String(inp.value || '').trim();
            if (!typed) return;
            const typedNorm = _norm(typed);
            const exact = [...sel.options].find(o => _norm(o.value) === typedNorm);
            if (exact) {
                sel.value = exact.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
                return;
            }
            const partial = [...sel.options].find(o => typedNorm.length >= 3 && _norm(o.value).includes(typedNorm));
            if (partial) {
                sel.value = partial.value;
                sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
        };

        inp.addEventListener('change', resolveToSelect);
        inp.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                resolveToSelect();
            }
        });
    });

    container.querySelectorAll('[data-gestao-vinc-mode]').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.getAttribute('data-gestao-vinc-mode') || 'lista';
            _gestaoVincMode = mode === 'massa' ? 'massa' : 'lista';
            renderGestaoVinculos();
        });
    });

    const syncBulkPickToSelect = () => {
        const pick = document.getElementById('gestao-vinc-bulk-pick');
        const sel = document.getElementById('gestao-vinc-bulk-select');
        if (!pick || !sel) return;
        const typed = String(pick.value || '').trim();
        if (!typed) return;
        const typedNorm = _norm(typed);
        const exact = [...sel.options].find(o => _norm(o.value) === typedNorm);
        if (exact) { sel.value = exact.value; return; }
        const partial = [...sel.options].find(o => typedNorm.length >= 3 && _norm(o.value).includes(typedNorm));
        if (partial) sel.value = partial.value;
    };

    const bulkPick = document.getElementById('gestao-vinc-bulk-pick');
    if (bulkPick) {
        bulkPick.addEventListener('change', syncBulkPickToSelect);
        bulkPick.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); syncBulkPickToSelect(); }
        });
    }
    const bulkSel = document.getElementById('gestao-vinc-bulk-select');
    if (bulkSel) {
        bulkSel.addEventListener('change', () => {
            if (bulkPick) bulkPick.value = bulkSel.value || '';
        });
    }

    container.querySelectorAll('.gestao-vinc-check').forEach(chk => {
        chk.addEventListener('change', () => {
            const key = chk.dataset.key || '';
            if (!key) return;
            if (chk.checked) _gestaoVincSelected.add(key);
            else _gestaoVincSelected.delete(key);
            const cnt = document.getElementById('gestao-vinc-selected-count');
            if (cnt) cnt.textContent = String(_gestaoVincSelected.size);
        });
    });

    const btnSelAll = document.getElementById('gestao-vinc-select-all');
    if (btnSelAll) {
        btnSelAll.addEventListener('click', () => {
            container.querySelectorAll('.gestao-vinc-check').forEach(chk => {
                chk.checked = true;
                const key = chk.dataset.key || '';
                if (key) _gestaoVincSelected.add(key);
            });
            const cnt = document.getElementById('gestao-vinc-selected-count');
            if (cnt) cnt.textContent = String(_gestaoVincSelected.size);
        });
    }
    const btnClr = document.getElementById('gestao-vinc-clear-sel');
    if (btnClr) {
        btnClr.addEventListener('click', () => {
            _gestaoVincSelected = new Set();
            renderGestaoVinculos();
        });
    }
    const btnApply = document.getElementById('gestao-vinc-apply-bulk');
    if (btnApply) {
        btnApply.addEventListener('click', async () => {
            if (!isAdmin) { showAlert('alert-gestao', 'Permissão negada. Apenas Administradores podem salvar vínculos.', 'error'); return; }
            const sel = document.getElementById('gestao-vinc-bulk-select');
            const dest = String(sel?.value || '').trim();
            if (!dest) { showAlert('alert-gestao', 'Selecione a unidade destino para aplicar.', 'warning'); return; }
            const keys = [...(_gestaoVincSelected || [])];
            if (!keys.length) { showAlert('alert-gestao', 'Selecione pelo menos um nome na planilha.', 'warning'); return; }
            const pairs = keys.map((k) => ({ rawKey: k, canonicalName: dest }));
            btnApply.disabled = true;
            try {
                const ok = await saveGestaoAliasesBulk(pairs);
                if (ok) {
                    _gestaoVincSelected = new Set();
                    renderGestaoVinculos();
                }
            } finally {
                btnApply.disabled = false;
            }
        });
    }

    container.querySelectorAll('.gestao-vinc-suggest').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.key;
            const name = btn.dataset.name;
            const sel = container.querySelector(`.gestao-vinc-select[data-key="${key}"]`);
            if (!sel) return;
            sel.value = name;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
    });

    container.querySelectorAll('.gestao-vinc-create').forEach(btn => {
        btn.addEventListener('click', () => {
            _gestaoVincCreateKey = btn.dataset.key || null;
            renderGestaoVinculos();
        });
    });

    container.querySelectorAll('.gestao-vinc-create-cancel').forEach(btn => {
        btn.addEventListener('click', () => {
            _gestaoVincCreateKey = null;
            renderGestaoVinculos();
        });
    });

    container.querySelectorAll('.gestao-vinc-create-save').forEach(btn => {
        btn.addEventListener('click', async () => {
            const key = btn.dataset.key;
            const tr = btn.closest('tr');
            const nome = String(tr?.querySelector('.gestao-vinc-new-nome')?.value || '').trim().replace(/\s+/g, ' ');
            let tipo = String(tr?.querySelector('.gestao-vinc-new-tipo')?.value || '').trim().toUpperCase();
            const sigla = String(tr?.querySelector('.gestao-vinc-new-sigla')?.value || '').trim().toUpperCase();
            if (!nome) { showAlert('alert-gestao', 'Informe o nome da unidade.', 'warning'); return; }
            if (!tipo) { showAlert('alert-gestao', 'Selecione o tipo da unidade.', 'warning'); return; }
            if (!isAdmin) { showAlert('alert-gestao', 'Permissão negada. Apenas Administradores podem criar unidades.', 'error'); return; }

            const tipoNorm = tipo === 'SEMCAS' ? 'SEDE' : tipo;
            const exists = (getUnidades() || []).some((u) => {
                const uNome = String(u?.nome || '').trim();
                let uTipo = String(u?.tipo || '').trim().toUpperCase();
                if (uTipo === 'SEMCAS') uTipo = 'SEDE';
                return _norm(uNome) === _norm(nome) && uTipo === tipoNorm;
            });
            if (exists) { showAlert('alert-gestao', 'Essa unidade já existe no sistema.', 'warning'); return; }

            btn.disabled = true;
            try {
                const payload = { nome: capitalizeString(nome), tipo: tipoNorm, atendeAgua: true, atendeGas: true, atendeMateriais: true };
                if (sigla) payload.sigla = sigla;
                await addDoc(COLLECTIONS.unidades, payload);
                const ok = await saveGestaoAlias(key, payload.nome);
                if (ok) {
                    _gestaoVincCreateKey = null;
                    renderGestaoVinculos();
                }
            } catch (e) {
                console.error(e);
                showAlert('alert-gestao', `Erro ao criar unidade: ${e.message}`, 'error');
            } finally {
                btn.disabled = false;
            }
        });
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
