// js/modules/usuarios.js
import { 
    query, 
    onSnapshot, 
    doc, 
    updateDoc,
    setDoc, // Adicionado para criar/definir o documento de role
    serverTimestamp, // Adicionado para registrar a data de criação
    getDocs // Mantido para busca inicial
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { getUserRole } from "../utils/cache.js";
import { db, COLLECTIONS, auth } from "../services/firestore-service.js"; // Importar auth
import { isReady } from "./auth.js";

let allUsers = []; // Cache local para os dados dos usuários
let unsubscribeUserRoles = null; // Para guardar o listener do onSnapshot

/**
 * Renderiza a tabela de gestão de usuários.
 */
function renderUsuariosTable() {
    if (!DOM_ELEMENTS.tableUsuarios) return;
    
    const role = getUserRole();
    if (role !== 'admin') {
        DOM_ELEMENTS.tableUsuarios.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-500">Acesso negado. Apenas administradores podem ver esta página.</td></tr>`;
        return;
    }

    const filtroEmail = DOM_ELEMENTS.filtroUsuarios?.value.toLowerCase() || '';

    const usuariosFiltrados = allUsers.filter(user => {
        const email = (user.email || 'N/A').toLowerCase();
        return email.includes(filtroEmail);
    });
    
    if (usuariosFiltrados.length === 0 && allUsers.length > 0) { 
        DOM_ELEMENTS.tableUsuarios.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-slate-500">Nenhum usuário encontrado com esse filtro.</td></tr>`; 
        return; 
    }
    if (allUsers.length === 0) {
         DOM_ELEMENTS.tableUsuarios.innerHTML = `<tr><td colspan="4" class="text-center py-10"><div class="loading-spinner-small mx-auto"></div><p>Carregando usuários...</p></td></tr>`;
         return;
    }

    // Pega o email do admin logado para desabilitar a edição do próprio role
    const adminEmail = auth.currentUser ? auth.currentUser.email : null;

    let html = '';
    usuariosFiltrados.sort((a,b) => (a.email || '').localeCompare(b.email || '')).forEach(user => {
        const email = user.email || '(E-mail não registrado)';
        const currentRole = user.role || 'anon';
        const isSelf = user.email === adminEmail; // Verifica se é o próprio admin
        
        // Opções do seletor
        const roles = ['admin', 'editor', 'anon'];
        const optionsHtml = roles.map(r => 
            `<option value="${r}" ${currentRole === r ? 'selected' : ''}>
                ${r.charAt(0).toUpperCase() + r.slice(1)}
            </option>`
        ).join('');

        html += `<tr data-uid="${user.uid}">
            <td class="font-medium">${email} ${isSelf ? '<span class="badge-blue ml-2">(Você)</span>' : ''}</td>
            <td class="text-xs text-gray-600">${user.uid}</td>
            <td>
                <select class="form-select form-select-sm user-role-select" ${isSelf ? 'disabled' : ''} title="${isSelf ? 'Você não pode alterar sua própria permissão.' : 'Mudar permissão'}">
                    ${optionsHtml}
                </select>
            </td>
            <td class="text-center">
                <button class="btn-primary btn-sm btn-save-role" ${isSelf ? 'disabled' : ''}>
                    <i data-lucide="save" class="w-4 h-4"></i>
                    <span class="ml-1">Salvar</span>
                </button>
            </td>
        </tr>`;
    });

    DOM_ELEMENTS.tableUsuarios.innerHTML = html;
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); } 
}

/**
 * Lida com o clique no botão "Salvar" de uma linha de usuário.
 */
async function handleSaveRole(e) {
    const button = e.target.closest('.btn-save-role');
    if (!button) return;

    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-usuarios', 'Acesso negado. Apenas administradores podem alterar permissões.', 'error');
        return;
    }

    const row = button.closest('tr');
    const uid = row.dataset.uid;
    const select = row.querySelector('.user-role-select');
    const newRole = select.value;

    if (!uid || !newRole) {
         showAlert('alert-usuarios', 'Erro: UID do usuário ou nova permissão não encontrados.', 'error');
        return;
    }
    
    // Segunda checagem para garantir que o admin não mude o próprio role
    const userToChange = allUsers.find(u => u.uid === uid);
    if (auth.currentUser && userToChange.email === auth.currentUser.email) {
        showAlert('alert-usuarios', 'Você não pode alterar sua própria permissão.', 'warning');
        return;
    }

    button.disabled = true;
    button.innerHTML = '<div class="loading-spinner-small mx-auto" style="width: 16px; height: 16px;"></div>';

    try {
        const docRef = doc(COLLECTIONS.userRoles, uid);
        await updateDoc(docRef, { role: newRole });
        showAlert('alert-usuarios', 'Permissão atualizada com sucesso!', 'success', 2000);
    } catch (error) {
        console.error("Erro ao atualizar permissão:", error);
        showAlert('alert-usuarios', `Erro ao salvar: ${error.message}`, 'error');
        // Reverte o select visualmente em caso de erro
        const user = allUsers.find(u => u.uid === uid);
        if (user) select.value = user.role; 
    } finally {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="save" class="w-4 h-4"></i><span class="ml-1">Salvar</span>';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Lida com a submissão do formulário para adicionar um novo usuário (apenas registra a permissão).
 * NOTA DE SEGURANÇA: Esta função NÃO cria o usuário na Autenticação do Firebase.
 * Ela apenas adiciona a entrada de role no Firestore.
 */
async function handleCreateUser(e) {
    e.preventDefault();
    const role = getUserRole();
    if (role !== 'admin') {
        showAlert('alert-add-user', 'Acesso negado. Apenas administradores podem adicionar usuários.', 'error');
        return;
    }

    const email = DOM_ELEMENTS.inputAddUserEmail?.value.trim().toLowerCase();
    const password = DOM_ELEMENTS.inputAddUserPassword?.value; // Senha não é salva no Firestore
    const selectedRole = DOM_ELEMENTS.selectAddUserRole?.value;

    // Validações básicas
    if (!email || !password || !selectedRole) {
        showAlert('alert-add-user', 'Preencha todos os campos: E-mail, Senha e Permissão.', 'warning');
        return;
    }
    if (password.length < 6) {
        showAlert('alert-add-user', 'A senha deve ter no mínimo 6 caracteres.', 'warning');
        return;
    }
    // Validação simples de email
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showAlert('alert-add-user', 'Formato de e-mail inválido.', 'warning');
        return;
    }

    // Verifica se o usuário já existe na lista local (evita criar role duplicado visualmente)
    if (allUsers.some(user => user.email === email)) {
        showAlert('alert-add-user', `O e-mail '${email}' já está registrado no sistema de permissões.`, 'warning');
        return;
    }

    const btn = DOM_ELEMENTS.btnSubmitAddUser;
    btn.disabled = true;
    btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        // *** IMPLEMENTAÇÃO ATUAL (APENAS SALVA ROLE, SEM CRIAR AUTH USER) ***
        // Gerar um UID temporário, pois a coleção userRoles usa UID como ID do documento.
        // O admin deve ser avisado para criar a conta real no Firebase Console depois.
        const tempUID = `temp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        console.warn(`Gerando UID temporário ${tempUID} para ${email}. A conta de autenticação PRECISA ser criada separadamente no Firebase Console ou via script de admin.`);

        const userRoleRef = doc(COLLECTIONS.userRoles, tempUID); // Usando UID temporário
        await setDoc(userRoleRef, {
            email: email,
            role: selectedRole,
            uid: tempUID, // Salva o UID temporário
            createdAt: serverTimestamp()
        });

        showAlert('alert-add-user', `Permissão '${selectedRole}' registrada para '${email}' (UID: ${tempUID.substring(0, 10)}...). Lembre-se de criar a conta de login no Firebase Authentication se ainda não existir.`, 'success', 10000);
        DOM_ELEMENTS.formAddUser.reset(); // Limpa o formulário

    } catch (error) {
        console.error("Erro ao registrar permissão do usuário:", error);
        showAlert('alert-add-user', `Erro ao registrar permissão: ${error.message}`, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="user-plus"></i> Adicionar Usuário';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Inicia o listener de snapshot para a coleção de userRoles.
 */
function startUserRolesListener() {
    if (unsubscribeUserRoles) {
        return; // Listener já ativo
    }
    
    console.log("Iniciando listener de usuários...");
    const q = query(COLLECTIONS.userRoles);
    unsubscribeUserRoles = onSnapshot(q, (snapshot) => {
        console.log("Recebidos dados dos usuários:", snapshot.docs.length);
        allUsers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        // Re-renderiza a tabela com os novos dados
        renderUsuariosTable(); 
    }, (error) => {
        console.error("Erro ao buscar usuários:", error);
        showAlert('alert-usuarios', `Erro ao carregar usuários: ${error.message}`, 'error');
        if (DOM_ELEMENTS.tableUsuarios) {
            DOM_ELEMENTS.tableUsuarios.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-red-500">Erro ao carregar dados.</td></tr>`;
        }
    });
}

/**
 * Para o listener de snapshot.
 */
function stopUserRolesListener() {
     if (unsubscribeUserRoles) {
        console.log("Parando listener de usuários.");
        unsubscribeUserRoles();
        unsubscribeUserRoles = null;
    }
}

/**
 * Inicializa os listeners da aba de Gestão de Usuários.
 */
export function initUsuariosListeners() {
    // Listener do filtro
    if (DOM_ELEMENTS.filtroUsuarios) {
        DOM_ELEMENTS.filtroUsuarios.addEventListener('input', renderUsuariosTable);
    }
    // Listener para salvar roles na tabela
    if (DOM_ELEMENTS.tableUsuarios) {
        DOM_ELEMENTS.tableUsuarios.addEventListener('click', handleSaveRole);
    }
    // Listener para o novo formulário de adicionar usuário
    if (DOM_ELEMENTS.formAddUser) {
        DOM_ELEMENTS.formAddUser.addEventListener('submit', handleCreateUser);
    }
}

/**
 * Função de orquestração para a tab de Gestão de Usuários.
 * Chamada quando a aba é clicada.
 */
export function onUsuariosTabChange() {
    // Apenas inicia o listener se for admin e estiver autenticado
    if (getUserRole() === 'admin' && isReady()) {
        startUserRolesListener(); 
        renderUsuariosTable(); // Faz a renderização inicial
    } else {
         stopUserRolesListener(); // Para o listener se não for admin
         renderUsuariosTable(); // Renderiza (vai mostrar msg de "acesso negado")
    }
}

/**
 * Função chamada quando o usuário faz logout.
 * Garante que o listener de usuários seja interrompido.
 */
export function onUserLogout() {
    stopUserRolesListener();
    allUsers = []; // Limpa o cache local
}
