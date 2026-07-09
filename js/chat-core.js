/**
 * chat-core.js — Chat do Almoxarifado SEMCAS
 *
 * ESTRATÉGIA DE CUSTO MÍNIMO:
 *   • 1 único documento Firestore: chat/sala_principal
 *   • Mensagens armazenadas como ARRAY dentro desse documento
 *   • onSnapshot em 1 doc = 1 leitura por update (não 1 por mensagem)
 *   • Array limitado a MAX_MSGS: nunca cresce, nunca cobra mais
 *   • Estimativa: 100 msgs/dia, 10 usuários ativos → ~$0.001/dia
 */
 
 import { doc, onSnapshot, runTransaction } from "firebase/firestore";
 
 const CHAT_COLLECTION = "chat";
 const CHAT_DOC_ID = "sala_principal";
 const MAX_MSGS = 50;
 const MAX_CHARS = 300;
 
 const PALAVROES = [
   "merda",
   "porra",
   "foda",
   "fodase",
   "caralho",
   "buceta",
   "viado",
   "corno",
   "idiota",
   "imbecil",
   "otario",
   "babaca",
   "palhaço",
   "desgraça",
   "desgraçado",
   "retardado",
   "inutil",
   "burro",
   "lixo",
   "vadia",
   "safado",
   "safada",
   "arrombado",
   "arrombada",
   "cuzao",
   "cuzão",
   "filhadaputa",
   "filho da puta",
   "puta",
   "prostituta",
   "vagabundo",
   "vagabunda",
   "lazaro",
   "lazarento"
 ];
 
 function normStr(s) {
   return String(s || "")
     .toLowerCase()
     .normalize("NFD")
     .replace(/[\u0300-\u036f]/g, "")
     .replace(/[^a-z\s]/g, "");
 }
 
 export function temPalavrão(texto) {
   const palavras = normStr(texto).split(/\s+/);
   return PALAVROES.some((p) => palavras.includes(normStr(p)));
 }
 
 function msgId() {
   return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
 }
 
 export function initChat({ db, exibicao, unidade, lado, onMessages, onUnread }) {
   const ref = doc(db, CHAT_COLLECTION, CHAT_DOC_ID);
   let prevCount = null;
   let unreadCount = 0;
 
  const unsub = onSnapshot(
    ref,
    (snap) => {
      const msgs = snap.exists() ? snap.data().msgs || [] : [];

      if (prevCount !== null && msgs.length > prevCount && onUnread) {
        const novas = msgs.slice(prevCount).filter((m) => m.lado !== lado);
        if (novas.length > 0) {
          unreadCount += novas.length;
          onUnread(unreadCount, novas[novas.length - 1]);
        }
      }
      prevCount = msgs.length;
      onMessages(msgs);
    },
    (err) => {
      const code = err?.code || "";
      const isPerm = String(code).includes("permission-denied");
      onMessages([
        {
          sys: true,
          texto: isPerm
            ? "Chat indisponível: permissões do Firestore não permitem acesso."
            : "Chat indisponível: erro ao conectar."
        }
      ]);
    }
  );
 
   function resetUnread() {
     unreadCount = 0;
   }
 
   async function enviar(texto) {
     texto = String(texto || "").trim();
 
     if (!texto) return { ok: false, motivo: "vazio" };
     if (temPalavrão(texto)) return { ok: false, motivo: "palavrao" };
     if (texto.length > MAX_CHARS) return { ok: false, motivo: "longo", max: MAX_CHARS };
 
     try {
       await runTransaction(db, async (tx) => {
         const snap = await tx.get(ref);
         const lista = snap.exists() ? (snap.data().msgs || []).slice(-(MAX_MSGS - 1)) : [];
 
         lista.push({
           id: msgId(),
           texto,
           autor: exibicao,
           unidade: unidade || null,
           lado,
           ts: Date.now()
         });
 
         tx.set(ref, { msgs: lista }, { merge: true });
       });
       return { ok: true };
     } catch (e) {
      console.error("[Chat] Erro ao enviar:", e);
      if (String(e?.code || "").includes("permission-denied")) return { ok: false, motivo: "permissao" };
      return { ok: false, motivo: "erro_firebase" };
     }
   }
 
   return { enviar, unsub, resetUnread };
 }
 
 export function fmtHora(ts) {
   const d = new Date(typeof ts === "number" ? ts : ts?.seconds * 1000 || Date.now());
   return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
 }
