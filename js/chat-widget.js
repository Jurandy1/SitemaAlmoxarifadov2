/**
 * chat-widget.js — Widget flutuante de chat (index.html e status.html)
 *
 * Uso em index.html (usuário logado, nome automático):
 *   import { mountChatWidget } from './js/chat-widget.js';
 *   mountChatWidget({ modo: 'almox', db });
 *
 * Uso em status.html (unidade, precisa informar nome):
 *   import { mountChatWidget } from './js/chat-widget.js';
 *   mountChatWidget({ modo: 'unidade', db });
 */
 
 import { initChat, fmtHora } from "./chat-core.js";
 
 const LS_CHAT_ID = "semcas_chat_id_v1";
const LS_CHAT_NOTIFY = "semcas_chat_notify_v1";
 
 const CSS = `
 #semcas-chat-fab{
   position:fixed;bottom:24px;right:24px;z-index:9000;
   width:52px;height:52px;border-radius:50%;
   background:#1e40af;color:#fff;border:none;cursor:pointer;
   display:flex;align-items:center;justify-content:center;
   box-shadow:0 4px 14px rgba(30,64,175,.4);
   font-size:22px;transition:transform .15s;
 }
 #semcas-chat-fab:hover{transform:scale(1.07)}
 #semcas-chat-badge{
   position:absolute;top:-4px;right:-4px;
   background:#dc2626;color:#fff;border-radius:999px;
   font-size:10px;font-weight:700;padding:2px 5px;
   min-width:18px;text-align:center;display:none;
   font-family:system-ui,sans-serif;
 }
 #semcas-chat-panel{
   position:fixed;bottom:88px;right:24px;z-index:9001;
   width:340px;max-height:520px;
   background:#fff;border-radius:16px;
   border:1px solid #e2e8f0;
   box-shadow:0 8px 32px rgba(0,0,0,.14);
   display:none;flex-direction:column;overflow:hidden;
   font-family:system-ui,sans-serif;
 }
 #semcas-chat-panel.open{display:flex}
 .sc-header{
   padding:12px 14px;background:#1e3a8a;color:#fff;
   display:flex;align-items:center;gap:10px;
 }
 .sc-header-av{
   width:34px;height:34px;border-radius:50%;
   background:rgba(255,255,255,.2);
   display:flex;align-items:center;justify-content:center;
   font-size:13px;font-weight:600;flex-shrink:0;
 }
 .sc-header-info{flex:1;min-width:0}
 .sc-header-name{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
 .sc-header-sub{font-size:10px;opacity:.7;margin-top:1px}
.sc-bell{
  background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.22);
  color:#fff;cursor:pointer;border-radius:10px;
  height:28px;min-width:28px;padding:0 8px;
  display:flex;align-items:center;justify-content:center;
  font-size:14px;line-height:1;opacity:.92;
}
.sc-bell:hover{opacity:1}
.sc-bell.on{background:rgba(34,197,94,.25);border-color:rgba(34,197,94,.45)}
 .sc-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;padding:0;line-height:1;opacity:.8}
 .sc-close:hover{opacity:1}
 
 .sc-id-form{
   padding:12px 14px;background:#f8fafc;
   border-bottom:1px solid #e2e8f0;
 }
 .sc-id-form-title{font-size:11px;color:#64748b;margin-bottom:7px;font-weight:600}
 .sc-id-form input{
   width:100%;border:1px solid #cbd5e1;border-radius:8px;
   padding:7px 10px;font-size:12px;font-family:inherit;
   margin-bottom:6px;color:#0f172a;outline:none;
   background:#fff;box-sizing:border-box;
 }
 .sc-id-form input:focus{border-color:#2563eb}
 .sc-id-btn{
   width:100%;padding:8px;border-radius:8px;border:none;
   background:#1e40af;color:#fff;font-size:12px;font-weight:600;
   cursor:pointer;font-family:inherit;
 }
 .sc-id-btn:hover{background:#1e3a8a}
 
 .sc-msgs{
   flex:1;overflow-y:auto;padding:12px;
   display:flex;flex-direction:column;gap:7px;
   min-height:180px;
 }
 .sc-msg{max-width:80%;display:flex;flex-direction:column;gap:2px}
 .sc-msg.mine{align-self:flex-end;align-items:flex-end}
 .sc-msg.theirs{align-self:flex-start;align-items:flex-start}
 .sc-bubble{
   padding:7px 11px;border-radius:12px;
   font-size:13px;line-height:1.45;word-break:break-word;
 }
 .mine .sc-bubble{background:#1e40af;color:#fff;border-bottom-right-radius:3px}
 .theirs .sc-bubble{background:#f1f5f9;color:#0f172a;border-bottom-left-radius:3px}
 .sc-meta{font-size:10px;color:#94a3b8;padding:0 2px}
 .sc-sender{font-size:10px;font-weight:600;color:#64748b;padding:0 2px}
 .sc-sys{
   text-align:center;font-size:11px;color:#94a3b8;
   padding:3px 0;font-style:italic;
 }
 
 .sc-input-area{
   padding:10px 12px;border-top:1px solid #e2e8f0;
   display:flex;gap:8px;align-items:flex-end;
 }
 .sc-input-area.locked{
   background:#f8fafc;justify-content:center;
   font-size:12px;color:#94a3b8;
 }
 .sc-textarea{
   flex:1;border:1px solid #e2e8f0;border-radius:20px;
   padding:8px 12px;font-size:13px;font-family:inherit;
   color:#0f172a;background:#fff;outline:none;
   resize:none;max-height:80px;min-height:36px;line-height:1.4;
 }
 .sc-textarea:focus{border-color:#2563eb}
 .sc-send{
   width:36px;height:36px;border-radius:50%;
   background:#1e40af;border:none;cursor:pointer;
   display:flex;align-items:center;justify-content:center;
   flex-shrink:0;color:#fff;font-size:18px;
 }
 .sc-send:hover{background:#1e3a8a}
 .sc-warn{
   font-size:11px;color:#dc2626;
   padding:2px 12px 4px;display:none;
 }
 .sc-warn.show{display:block}
 .sc-online{
   width:8px;height:8px;border-radius:50%;background:#22c55e;flex-shrink:0;
 }
 @media(max-width:400px){
   #semcas-chat-panel{width:calc(100vw - 24px);right:12px;bottom:80px}
 }
 `;
 
 function injectCSS() {
   if (document.getElementById("semcas-chat-css")) return;
   const s = document.createElement("style");
   s.id = "semcas-chat-css";
   s.textContent = CSS;
   document.head.appendChild(s);
 }
 
 function initials(nome) {
   return (nome || "AL")
     .split(" ")
     .slice(0, 2)
     .map((p) => p[0])
     .join("")
     .toUpperCase();
 }
 
 export function mountChatWidget({ modo, db }) {
   injectCSS();
 
   const prev = document.getElementById("semcas-chat-host");
   if (prev) prev.remove();
 
   let exibicao, unidade, lado, identificado;
 
   if (modo === "almox") {
     exibicao = "Almoxarifado da SEMCAS";
     unidade = null;
     lado = "almox";
     identificado = true;
   } else {
     const saved = (() => {
       try {
         return JSON.parse(localStorage.getItem(LS_CHAT_ID) || "null");
       } catch {
         return null;
       }
     })();
     if (saved?.nome && saved?.unidade) {
       exibicao = saved.nome;
       unidade = saved.unidade;
       lado = "unidade";
       identificado = true;
     } else {
       identificado = false;
       lado = "unidade";
     }
   }
 
   const host = document.createElement("div");
   host.id = "semcas-chat-host";
   document.body.appendChild(host);
 
  const notificationsEnabled = (() => {
    try {
      const raw = localStorage.getItem(LS_CHAT_NOTIFY);
      if (raw === null) return false;
      return raw === "1";
    } catch {
      return false;
    }
  })();
  let notifyEnabled = notificationsEnabled && typeof Notification !== "undefined" && Notification.permission === "granted";

   host.innerHTML = `
     <button id="semcas-chat-fab" title="Abrir chat do almoxarifado" aria-label="Abrir chat">
       💬
       <span id="semcas-chat-badge"></span>
     </button>
 
     <div id="semcas-chat-panel" role="dialog" aria-label="Chat do Almoxarifado">
       <div class="sc-header">
         <div class="sc-header-av" id="sc-av">AL</div>
         <div class="sc-header-info">
           <div class="sc-header-name" id="sc-hname">Chat Almoxarifado</div>
           <div class="sc-header-sub" id="sc-hsub">Secretaria Municipal da Criança e Assistência Social</div>
         </div>
        <button class="sc-bell ${notifyEnabled ? "on" : ""}" id="sc-bell" aria-label="Notificações" title="Notificações">🔔</button>
         <div class="sc-online" title="Online"></div>
         <button class="sc-close" id="sc-close" aria-label="Fechar chat">×</button>
       </div>
 
       ${
         !identificado
           ? `
       <div class="sc-id-form" id="sc-id-form">
         <div class="sc-id-form-title">🔐 Identifique-se para enviar mensagens</div>
         <input id="sc-id-nome" placeholder="Seu nome completo" maxlength="50">
         <input id="sc-id-unidade" placeholder="Sua unidade (ex: CRAS Centro)" maxlength="60">
         <button class="sc-id-btn" id="sc-id-btn">✔ Confirmar e entrar no chat</button>
       </div>`
           : ""
       }
 
       <div class="sc-msgs" id="sc-msgs">
         <div class="sc-sys">Conectando…</div>
       </div>
 
       <div class="sc-warn" id="sc-warn"></div>
 
       ${
         identificado
           ? `
       <div class="sc-input-area" id="sc-input-area">
         <textarea class="sc-textarea" id="sc-textarea" placeholder="Mensagem…" rows="1"></textarea>
         <button class="sc-send" id="sc-send" aria-label="Enviar">➤</button>
       </div>`
           : `
       <div class="sc-input-area locked" id="sc-input-area">
         🔒 Informe seus dados acima para enviar
       </div>`
       }
     </div>
   `;
 
   const fab = document.getElementById("semcas-chat-fab");
   const panel = document.getElementById("semcas-chat-panel");
   const badge = document.getElementById("semcas-chat-badge");
   const msgs = document.getElementById("sc-msgs");
   const warn = document.getElementById("sc-warn");
   const avEl = document.getElementById("sc-av");
   const hnameEl = document.getElementById("sc-hname");
  const bellEl = document.getElementById("sc-bell");
 
   let panelOpen = false;
   let chatCtrl = null;
 
   function esc(s) {
     return String(s || "")
       .replace(/&/g, "&amp;")
       .replace(/</g, "&lt;")
       .replace(/>/g, "&gt;");
   }
 
   function showWarn(txt, dur = 3000) {
     warn.textContent = txt;
     warn.classList.add("show");
     setTimeout(() => warn.classList.remove("show"), dur);
   }
 
  function setNotifyEnabled(v) {
    notifyEnabled = !!v;
    if (bellEl) bellEl.classList.toggle("on", notifyEnabled);
    try {
      localStorage.setItem(LS_CHAT_NOTIFY, notifyEnabled ? "1" : "0");
    } catch {}
  }

  async function requestNotifyPermission() {
    if (typeof Notification === "undefined") {
      showWarn("⚠️ Seu navegador não suporta notificações.");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      showWarn("⚠️ Notificações bloqueadas no navegador.");
      return false;
    }
    try {
      const r = await Notification.requestPermission();
      if (r === "granted") return true;
      showWarn("⚠️ Permissão de notificação negada.");
      return false;
    } catch (_) {
      showWarn("⚠️ Não foi possível solicitar notificação.");
      return false;
    }
  }

  function notifyNewMessage(m) {
    if (!notifyEnabled) return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    if (panelOpen) return;

    const autor = m?.autor || "Nova mensagem";
    const u = m?.unidade ? ` · ${m.unidade}` : "";
    const texto = String(m?.texto || "").replace(/\s+/g, " ").trim();
    const body = texto ? `${autor}${u}: ${texto.slice(0, 120)}` : `${autor}${u}`;

    let icon;
    try {
      icon = new URL("./favicon.ico", location.href).href;
    } catch {
      icon = undefined;
    }

    try {
      const n = new Notification("Chat Almoxarifado", { body, tag: "semcas-chat", icon });
      n.onclick = () => {
        try { window.focus(); } catch (_) {}
        panelOpen = true;
        panel.classList.add("open");
        badge.style.display = "none";
        badge.textContent = "";
        chatCtrl?.resetUnread?.();
        document.getElementById("sc-textarea")?.focus();
        msgs.scrollTop = msgs.scrollHeight;
        try { n.close(); } catch (_) {}
      };
    } catch (_) {}
  }

  if (bellEl) {
    bellEl.addEventListener("click", async () => {
      if (notifyEnabled) {
        setNotifyEnabled(false);
        return;
      }
      const ok = await requestNotifyPermission();
      if (ok) setNotifyEnabled(true);
    });
  }

   fab.addEventListener("click", () => {
     panelOpen = !panelOpen;
     panel.classList.toggle("open", panelOpen);
     if (panelOpen) {
       badge.style.display = "none";
       badge.textContent = "";
       chatCtrl?.resetUnread?.();
       document.getElementById("sc-textarea")?.focus();
       msgs.scrollTop = msgs.scrollHeight;
     }
   });
 
   document.getElementById("sc-close").addEventListener("click", () => {
     panelOpen = false;
     panel.classList.remove("open");
   });
 
   function updateHeader() {
     avEl.textContent = initials(exibicao);
     hnameEl.textContent = modo === "almox" ? "Chat com Unidades" : `Chat — ${exibicao}`;
     const subEl = document.getElementById("sc-hsub");
     if (subEl && unidade) subEl.textContent = unidade;
   }
 
   function renderMsgs(lista) {
     msgs.innerHTML = "";
     if (!lista.length) {
       msgs.innerHTML = '<div class="sc-sys">Nenhuma mensagem ainda. Seja o primeiro! 👋</div>';
       return;
     }
     lista.forEach((m) => {
       if (m.sys) {
         const d = document.createElement("div");
         d.className = "sc-sys";
         d.textContent = m.texto;
         msgs.appendChild(d);
         return;
       }
       const mine = m.lado === lado;
       const d = document.createElement("div");
       d.className = "sc-msg " + (mine ? "mine" : "theirs");
       if (!mine) {
         d.innerHTML = `<div class="sc-sender">${esc(m.autor)}${m.unidade ? " · " + esc(m.unidade) : ""}</div>`;
       }
       d.innerHTML += `
         <div class="sc-bubble">${esc(m.texto)}</div>
         <div class="sc-meta">${fmtHora(m.ts)}</div>
       `;
       msgs.appendChild(d);
     });
     msgs.scrollTop = msgs.scrollHeight;
   }
 
   function startChat() {
     updateHeader();
     chatCtrl = initChat({
       db,
       exibicao,
       unidade,
       lado,
       onMessages: renderMsgs,
      onUnread: (n, lastMsg) => {
         if (!panelOpen) {
           badge.textContent = n > 9 ? "9+" : n;
           badge.style.display = "inline-block";
         }
        if (!panelOpen) notifyNewMessage(lastMsg);
       }
     });
   }
 
   function bindSend() {
     const ta = document.getElementById("sc-textarea");
     const btn = document.getElementById("sc-send");
     if (!ta || !btn) return;
 
     async function enviar() {
       const texto = ta.value.trim();
       if (!texto) return;
       ta.value = "";
       ta.style.height = "";
 
       const r = await chatCtrl.enviar(texto);
       if (!r.ok) {
         if (r.motivo === "palavrao") showWarn("⚠️ Mensagem bloqueada: use linguagem adequada.");
         else if (r.motivo === "longo") showWarn(`⚠️ Máximo ${r.max} caracteres.`);
         else if (r.motivo === "permissao") showWarn("⚠️ Chat sem permissão no Firestore. Atualize as regras.");
         else showWarn("⚠️ Erro ao enviar. Tente novamente.");
         ta.value = texto;
       }
     }
 
     btn.addEventListener("click", enviar);
     ta.addEventListener("keydown", (e) => {
       if (e.key === "Enter" && !e.shiftKey) {
         e.preventDefault();
         enviar();
       }
     });
     ta.addEventListener("input", () => {
       ta.style.height = "auto";
       ta.style.height = Math.min(ta.scrollHeight, 80) + "px";
     });
   }
 
   const idForm = document.getElementById("sc-id-form");
   if (idForm) {
     document.getElementById("sc-id-btn").addEventListener("click", () => {
       const nome = document.getElementById("sc-id-nome").value.trim();
       const unidadeVal = document.getElementById("sc-id-unidade").value.trim();
 
       if (!nome || !unidadeVal) {
         ["sc-id-nome", "sc-id-unidade"].forEach((id) => {
           const el = document.getElementById(id);
           if (!el.value.trim()) el.style.borderColor = "#dc2626";
           setTimeout(() => (el.style.borderColor = ""), 2000);
         });
         return;
       }
 
       try {
         localStorage.setItem(LS_CHAT_ID, JSON.stringify({ nome, unidade: unidadeVal }));
       } catch {}
 
       exibicao = nome;
       unidade = unidadeVal;
 
       idForm.remove();
 
       document.getElementById("sc-input-area").outerHTML = `
         <div class="sc-input-area" id="sc-input-area">
           <textarea class="sc-textarea" id="sc-textarea" placeholder="Mensagem…" rows="1"></textarea>
           <button class="sc-send" id="sc-send" aria-label="Enviar">➤</button>
         </div>
       `;
 
       startChat();
       bindSend();
       document.getElementById("sc-textarea")?.focus();
     });
 
     document.getElementById("sc-id-unidade").addEventListener("keydown", (e) => {
       if (e.key === "Enter") document.getElementById("sc-id-btn").click();
     });
   }
 
   if (identificado) {
     startChat();
     bindSend();
   }
 
   return {
     unmount() {
       try {
         chatCtrl?.unsub?.();
       } catch (_) {}
       try {
         host.remove();
       } catch (_) {}
     }
   };
 }
