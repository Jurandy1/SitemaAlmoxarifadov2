// js/modules/usuarios.js
import {
  query,
  onSnapshot,
  doc,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { DOM_ELEMENTS, showAlert } from "../utils/dom-helpers.js";
import { getUserRole } from "../utils/cache.js";
import { db, COLLECTIONS, auth } from "../services/firestore-service.js";
import { firebaseConfig } from "../firebase-config.js";
import { isReady } from "./auth.js";

let allUsers = [];
let unsubscribeUserRoles = null;

/* ===============================================================
   RENDERIZAÇÃO DA TABELA DE USUÁRIOS
================================================================= */
function renderUsuariosTable() {
  if (!DOM_ELEMENTS.tableUsuarios) return;

  const role = getUserRole();
  if (role !== "admin") {
    DOM_ELEMENTS.tableUsuarios.innerHTML =
      `<tr><td colspan="4" class="text-center py-4 text-slate-500">Apenas administradores podem ver esta página.</td></tr>`;
    return;
  }

  const filtroEmail = DOM_ELEMENTS.filtroUsuarios?.value.toLowerCase() || "";
  const usuariosFiltrados = allUsers.filter((u) =>
    (u.email || "").toLowerCase().includes(filtroEmail)
  );

  if (usuariosFiltrados.length === 0) {
    DOM_ELEMENTS.tableUsuarios.innerHTML =
      `<tr><td colspan="4" class="text-center py-4 text-slate-500">Nenhum usuário encontrado.</td></tr>`;
    return;
  }

  const adminEmail = auth.currentUser?.email || null;

  let html = "";
  usuariosFiltrados
    .sort((a, b) => (a.email || "").localeCompare(b.email || ""))
    .forEach((user) => {
      const isSelf = user.email === adminEmail;
      const roles = ["admin", "editor", "anon"];
      const options = roles
        .map(
          (r) =>
            `<option value="${r}" ${
              user.role === r ? "selected" : ""
            }>${r.toUpperCase()}</option>`
        )
        .join("");
      html += `
      <tr data-uid="${user.uid}">
        <td>${user.email} ${isSelf ? '<span class="badge-blue ml-2">(Você)</span>' : ""}</td>
        <td>${user.uid}</td>
        <td>
          <select class="form-select form-select-sm user-role-select" ${
            isSelf ? "disabled" : ""
          }>${options}</select>
        </td>
        <td class="text-center">
          <button class="btn-primary btn-sm btn-save-role" ${
            isSelf ? "disabled" : ""
          }>
            <i data-lucide="save"></i><span class="ml-1">Salvar</span>
          </button>
        </td>
      </tr>`;
    });

  DOM_ELEMENTS.tableUsuarios.innerHTML = html;
  if (lucide?.createIcons) lucide.createIcons();
}

/* ===============================================================
   SALVAR ALTERAÇÃO DE ROLE
================================================================= */
async function handleSaveRole(e) {
  const btn = e.target.closest(".btn-save-role");
  if (!btn) return;

  if (getUserRole() !== "admin") {
    showAlert("alert-usuarios", "Apenas admin pode alterar permissões.", "error");
    return;
  }

  const row = btn.closest("tr");
  const uid = row.dataset.uid;
  const select = row.querySelector(".user-role-select");
  const newRole = select.value;

  btn.disabled = true;
  btn.innerHTML =
    '<div class="loading-spinner-small mx-auto" style="width:16px;height:16px;"></div>';

  try {
    await updateDoc(doc(COLLECTIONS.userRoles, uid), { role: newRole });
    showAlert("alert-usuarios", "Permissão atualizada com sucesso!", "success");
    // MELHORIA UX: Renderiza a tabela imediatamente.
    renderUsuariosTable(); 
  } catch (err) {
    console.error("Erro ao atualizar permissão:", err);
    showAlert("alert-usuarios", `Erro: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="save"></i><span class="ml-1">Salvar</span>';
    if (lucide?.createIcons) lucide.createIcons();
  }
}

/* ===============================================================
   CRIAR NOVO USUÁRIO (Auth + Firestore)
================================================================= */
async function handleCreateUser(e) {
  e.preventDefault();

  if (getUserRole() !== "admin") {
    showAlert("alert-add-user", "Apenas administradores podem adicionar usuários.", "error");
    return;
  }

  const email = DOM_ELEMENTS.inputAddUserEmail?.value.trim().toLowerCase();
  const password = DOM_ELEMENTS.inputAddUserPassword?.value;
  const role = DOM_ELEMENTS.selectAddUserRole?.value;

  if (!email || !password || !role) {
    showAlert("alert-add-user", "Preencha todos os campos!", "warning");
    return;
  }

  const btn = DOM_ELEMENTS.btnSubmitAddUser;
  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

  try {
    // Usa uma instância Auth secundária para não trocar a sessão atual do admin
    const secondaryApp = initializeApp(firebaseConfig, "SecondaryAuthApp");
    const secondaryAuth = getAuth(secondaryApp);

    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);
    const uid = cred.user.uid;

    await setDoc(doc(COLLECTIONS.userRoles, uid), {
      uid,
      email,
      role,
      createdAt: serverTimestamp(),
    });

    // Tenta enviar o e-mail de redefinição de senha para o novo usuário
    let resetMsg = "";
    try {
      await sendPasswordResetEmail(auth, email);
      resetMsg = " E-mail de redefinição de senha enviado.";
    } catch (mailErr) {
      console.warn("Falha ao enviar e-mail de redefinição:", mailErr);
      resetMsg = " (Não foi possível enviar o e-mail de redefinição agora.)";
    }

    showAlert("alert-add-user", `Usuário '${email}' criado como '${role}'.${resetMsg}`, "success");
    DOM_ELEMENTS.formAddUser.reset();
    // MELHORIA UX: Renderiza a tabela imediatamente.
    renderUsuariosTable();

    // Encerra a app secundária para liberar recursos
    try { await deleteApp(secondaryApp); } catch (_) {}
  } catch (err) {
    console.error("Erro ao criar usuário:", err);
    showAlert("alert-add-user", `Erro: ${err.message}`, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i data-lucide="user-plus"></i> Adicionar Usuário';
  }
}

/* ===============================================================
   SNAPSHOT DE USUÁRIOS
================================================================= */
function startUserRolesListener() {
  // Para evitar múltiplos listeners simultâneos
  stopUserRolesListener();

  try {
    // Query simples em toda a coleção de roles
    const q = query(COLLECTIONS.userRoles);
    unsubscribeUserRoles = onSnapshot(
      q,
      (snap) => {
        allUsers = snap.docs.map((d) => {
          const data = d.data() || {};
          const role = ['admin', 'editor', 'anon'].includes(data.role)
            ? data.role
            : 'anon';
          return {
            uid: d.id,
            email: data.email || '',
            role,
          };
        });
        renderUsuariosTable();
      },
      (err) => {
        console.error('Erro listener userRoles:', err);
        showAlert('alert-usuarios', `Erro ao listar usuários: ${err.message}`, 'error');
      }
    );
  } catch (err) {
    console.error('Erro ao iniciar listener userRoles:', err);
    showAlert('alert-usuarios', `Erro ao iniciar listener: ${err.message}`, 'error');
  }
}

function stopUserRolesListener() {
  if (typeof unsubscribeUserRoles === 'function') {
    try {
      unsubscribeUserRoles();
    } catch (err) {
      console.warn('Falha ao cancelar listener userRoles:', err);
    }
    unsubscribeUserRoles = null;
  }
}

/* ===============================================================
   LISTENERS
================================================================= */
export function initUsuariosListeners() {
  DOM_ELEMENTS.filtroUsuarios?.addEventListener("input", renderUsuariosTable);
  DOM_ELEMENTS.tableUsuarios?.addEventListener("click", handleSaveRole);
  DOM_ELEMENTS.formAddUser?.addEventListener("submit", handleCreateUser);
}

export function onUsuariosTabChange() {
  if (getUserRole() === "admin" && isReady()) {
    startUserRolesListener();
  } else {
    stopUserRolesListener();
  }
  renderUsuariosTable();
}

export function onUserLogout() {
  stopUserRolesListener();
  allUsers = [];
}
