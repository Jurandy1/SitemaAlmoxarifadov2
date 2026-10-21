// js/modules/senha.js
// Troca de senha pelo próprio usuário, dentro do sistema (sem e-mail).
// - Botão "Trocar senha" no rodapé do menu (#btn-trocar-senha)
// - Sugerida ao entrar para quem ainda usa a senha padrão (user_metadata.must_change_password);
//   a pessoa pode clicar em "Agora não" e usar o sistema normalmente
import { onAuthStateChanged, updatePassword } from "firebase/auth";
import { auth } from "../services/firestore-service.js";

const MIN_LEN = 8;
const SENHAS_FRACAS = new Set(["12345678", "123456789", "87654321", "00000000", "11111111", "senha123", "password"]);

let modalEl = null;

function criarModal() {
  if (modalEl) return modalEl;
  modalEl = document.createElement("div");
  modalEl.id = "modal-trocar-senha";
  modalEl.style.cssText =
    "position:fixed;inset:0;z-index:9999;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.55);padding:16px";
  modalEl.innerHTML = `
    <form id="form-trocar-senha" style="background:#fff;border-radius:14px;max-width:400px;width:100%;padding:22px;box-shadow:0 20px 50px rgba(0,0,0,.25);font-family:inherit">
      <h3 style="margin:0 0 4px;font-size:17px;font-weight:800;color:#0f172a">Trocar senha</h3>
      <p id="trocar-senha-aviso" style="margin:0 0 14px;font-size:12px;color:#64748b">Escolha uma senha nova para a sua conta.</p>
      <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px" for="nova-senha">Nova senha</label>
      <input id="nova-senha" type="password" autocomplete="new-password" class="form-input" style="width:100%;margin-bottom:10px" required>
      <label style="display:block;font-size:11px;font-weight:700;color:#475569;margin-bottom:3px" for="nova-senha-2">Repita a nova senha</label>
      <input id="nova-senha-2" type="password" autocomplete="new-password" class="form-input" style="width:100%;margin-bottom:6px" required>
      <p style="margin:0 0 12px;font-size:11px;color:#64748b">Mínimo de ${MIN_LEN} caracteres. Não use a senha padrão.</p>
      <div id="trocar-senha-erro" style="display:none;margin-bottom:10px;padding:8px 10px;border-radius:8px;background:#fee2e2;color:#b91c1c;font-size:12px"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button type="button" id="btn-cancelar-senha" class="btn btn-s btn-sm">Cancelar</button>
        <button type="submit" id="btn-salvar-senha" class="btn btn-p btn-sm">Salvar nova senha</button>
      </div>
    </form>`;
  document.body.appendChild(modalEl);

  modalEl.querySelector("#btn-cancelar-senha").addEventListener("click", fecharModal);
  modalEl.querySelector("#form-trocar-senha").addEventListener("submit", salvar);
  return modalEl;
}

function mostrarErro(msg) {
  const el = modalEl.querySelector("#trocar-senha-erro");
  el.textContent = msg;
  el.style.display = msg ? "block" : "none";
}

export function abrirTrocarSenha({ sugestao = false } = {}) {
  const user = auth.currentUser;
  if (!user || user.isAnonymous) return;
  criarModal();
  modalEl.querySelector("#trocar-senha-aviso").textContent = sugestao
    ? "Você ainda está usando a senha padrão. Recomendamos criar uma senha só sua — ou clique em “Agora não” para continuar."
    : "Escolha uma senha nova para a sua conta.";
  modalEl.querySelector("#btn-cancelar-senha").textContent = sugestao ? "Agora não" : "Cancelar";
  modalEl.querySelector("#nova-senha").value = "";
  modalEl.querySelector("#nova-senha-2").value = "";
  mostrarErro("");
  modalEl.style.display = "flex";
  setTimeout(() => modalEl.querySelector("#nova-senha")?.focus(), 50);
}

function fecharModal() {
  if (modalEl) modalEl.style.display = "none";
}

async function salvar(ev) {
  ev.preventDefault();
  const s1 = modalEl.querySelector("#nova-senha").value;
  const s2 = modalEl.querySelector("#nova-senha-2").value;
  if (s1.length < MIN_LEN) return mostrarErro(`A senha precisa ter pelo menos ${MIN_LEN} caracteres.`);
  if (SENHAS_FRACAS.has(s1.toLowerCase())) return mostrarErro("Essa senha é muito fácil. Escolha outra.");
  if (s1 !== s2) return mostrarErro("As duas senhas não são iguais.");

  const btn = modalEl.querySelector("#btn-salvar-senha");
  btn.disabled = true;
  btn.textContent = "Salvando...";
  try {
    await updatePassword(auth.currentUser, s1);
    if (auth.currentUser?.userMetadata) auth.currentUser.userMetadata.must_change_password = false;
    fecharModal();
    alert("Senha alterada com sucesso!");
  } catch (err) {
    console.error("Erro ao trocar senha:", err);
    const msg = String(err?.message || "");
    if (err?.code === "auth/requires-recent-login") mostrarErro("Por segurança, saia e entre de novo antes de trocar a senha.");
    else if (/different from the old|same password/i.test(msg)) mostrarErro("A nova senha precisa ser diferente da atual.");
    else if (err?.code === "auth/weak-password") mostrarErro("Senha fraca. Escolha uma senha mais forte.");
    else mostrarErro("Não foi possível trocar a senha. Tente de novo.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Salvar nova senha";
  }
}

export function initTrocarSenha() {
  const btn = document.getElementById("btn-trocar-senha");
  if (btn) btn.addEventListener("click", () => abrirTrocarSenha());

  onAuthStateChanged(auth, (user) => {
    if (btn) btn.style.display = user && !user.isAnonymous ? "" : "none";
    if (!user) {
      fecharModal();
      return;
    }
    if (user.isAnonymous || user.userMetadata?.must_change_password !== true) return;
    // Sugere uma vez por sessão do navegador (não a cada recarga de página)
    const marca = `senhaSugerida:${user.uid}`;
    try {
      if (sessionStorage.getItem(marca)) return;
      sessionStorage.setItem(marca, "1");
    } catch (_) {}
    abrirTrocarSenha({ sugestao: true });
  });
}
