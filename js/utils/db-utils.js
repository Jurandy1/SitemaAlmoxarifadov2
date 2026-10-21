// js/utils/db-utils.js
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  query,
  where,
  getDocs,
  limit,
  orderBy,
  startAfter,
  writeBatch,
  updateDoc,
  serverTimestamp,
  increment,
  deleteField,
} from "firebase/firestore";
import { deleteFile } from "../services/storage-service.js";
import { db, COLLECTIONS, auth } from "../services/firestore-service.js";
import { getDeleteInfo, setDeleteInfo } from "../utils/cache.js";
import { showAlert, DOM_ELEMENTS } from "../utils/dom-helpers.js";
// Importa as funções de re-renderização dos módulos
import { onAguaTabChange } from "../modules/agua/agua-control.js";
import { onGasTabChange, GAS_CUTOFF_MS } from "../modules/gas/gas-control.js";

/** Cache em memória para relatórios (não substitui o listener operacional). */
let __reportMateriaisCache = { at: 0, docs: null };
let __reportHistCache = { at: 0, docs: null };
const REPORT_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Carrega TODOS os documentos de controleMateriais (paginado), sob demanda.
 * Usado apenas pelo Painel/Relatórios — não altera o listener limit(200).
 * @param {{ force?: boolean }} opts
 * @returns {Promise<object[]>}
 */
export async function fetchAllMateriaisForReport(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (!force && __reportMateriaisCache.docs && now - __reportMateriaisCache.at < REPORT_CACHE_TTL_MS) {
    return __reportMateriaisCache.docs;
  }
  const all = [];
  let last = null;
  while (true) {
    const q = last
      ? query(COLLECTIONS.materiais, orderBy("registradoEm", "desc"), startAfter(last), limit(450))
      : query(COLLECTIONS.materiais, orderBy("registradoEm", "desc"), limit(450));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => {
      const data = d.data() || {};
      if (data.deleted) return;
      all.push({ id: d.id, ...data });
    });
    if (snap.docs.length < 450) break;
    last = snap.docs[snap.docs.length - 1];
  }
  __reportMateriaisCache = { at: now, docs: all };
  return all;
}

/**
 * Carrega TODO o histórico semcasHistDB (paginado), sob demanda.
 * @param {{ force?: boolean }} opts
 * @returns {Promise<object[]>}
 */
export async function fetchAllHistForReport(opts = {}) {
  const force = !!opts.force;
  const now = Date.now();
  if (!force && __reportHistCache.docs && now - __reportHistCache.at < REPORT_CACHE_TTL_MS) {
    return __reportHistCache.docs;
  }
  const all = [];
  let last = null;
  while (true) {
    const q = last
      ? query(COLLECTIONS.semcasHistDB, orderBy("weekStart", "desc"), startAfter(last), limit(450))
      : query(COLLECTIONS.semcasHistDB, orderBy("weekStart", "desc"), limit(450));
    const snap = await getDocs(q);
    snap.docs.forEach((d) => all.push({ id: d.id, ...d.data() }));
    if (snap.docs.length < 450) break;
    last = snap.docs[snap.docs.length - 1];
  }
  __reportHistCache = { at: now, docs: all };
  return all;
}

/** Invalida caches de relatório (após entrega/importação). */
export function invalidateReportCaches() {
  __reportMateriaisCache = { at: 0, docs: null };
  __reportHistCache = { at: 0, docs: null };
}

const MOV_TIPOS_CONTABEIS = ["entrega", "retorno", "retirada"];

/**
 * Ajusta os docs de resumo (totais + saldos por unidade) após a exclusão de
 * uma movimentação de água ou gás, revertendo os increments feitos na criação.
 */
async function ajustarResumoAposExclusao(itemType, movData) {
  const qty = parseInt(movData?.quantidade, 10) || 0;
  const tipo = String(movData?.tipo || "").toLowerCase();
  if (qty <= 0 || !MOV_TIPOS_CONTABEIS.includes(tipo)) return;

  const isEntrega = tipo === "entrega";
  const unidadeId = movData?.unidadeId || null;

  if (itemType === "agua") {
    const resumoRef = doc(COLLECTIONS.estoqueAgua, "resumo-agua");
    const update = { tipo: "__resumo__", atualizadoEm: serverTimestamp() };
    if (isEntrega) update.totalSaidas = increment(-qty);
    else update.totalRetornos = increment(-qty);
    await setDoc(resumoRef, update, { merge: true });

    if (unidadeId) {
      const saldosRef = doc(COLLECTIONS.estoqueAgua, "resumo-unidades-agua");
      await setDoc(saldosRef, {
        tipo: "__resumo_unidades__",
        atualizadoEm: serverTimestamp(),
        saldos: { [unidadeId]: isEntrega ? { entregues: increment(-qty) } : { recebidos: increment(-qty) } }
      }, { merge: true });
    }
    return;
  }

  if (itemType === "gas") {
    // Movimentações anteriores ao corte nunca entraram no resumo
    const dataMs = movData?.data?.toMillis?.() ?? 0;
    if (dataMs < GAS_CUTOFF_MS) return;
    const resumoRef = doc(COLLECTIONS.estoqueGas, "resumo-gas");
    const update = { tipo: "__resumo__", atualizadoEm: serverTimestamp() };
    if (isEntrega) update.totalSaidas = increment(-qty);
    else update.totalRetornos = increment(-qty);
    if (unidadeId) {
      update.saldos = { [unidadeId]: isEntrega ? { entregues: increment(-qty) } : { recebidos: increment(-qty) } };
    }
    await setDoc(resumoRef, update, { merge: true });
  }
}

/**
 * Retorna a referência de coleção com base no tipo.
 * @param {string} type Tipo do item a ser excluído ('agua', 'gas', 'materiais', 'unidade', 'entrada-agua', 'entrada-gas').
 * @returns {import("firebase/firestore").CollectionReference | null} Referência da coleção.
 */
function getCollectionRef(type) {
  switch (type) {
    case "agua":
      return COLLECTIONS.aguaMov;
    case "gas":
      return COLLECTIONS.gasMov;
    case "materiais":
      return COLLECTIONS.materiais;
    case "unidade":
      return COLLECTIONS.unidades;
    case "entrada-agua":
      return COLLECTIONS.estoqueAgua;
    case "entrada-gas":
      return COLLECTIONS.estoqueGas;
    default:
      return null;
  }
}

/**
 * Executa a exclusão de um documento do Firestore.
 */
async function executeDelete() {
  const info = getDeleteInfo();
  if (!auth.currentUser || !info.id || !info.type) {
    showAlert(info.alertElementId || "alert-gestao", "Erro: usuário não autenticado.", "error");
    return;
  }

  const ref = getCollectionRef(info.type);
  if (!ref) {
    showAlert(info.alertElementId || "alert-gestao", "Tipo inválido de coleção.", "error");
    return;
  }

  DOM_ELEMENTS.btnConfirmDelete.disabled = true;
  DOM_ELEMENTS.btnConfirmDelete.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
  
  const alertId = info.alertElementId || "alert-gestao";

  try {
    // Lógica para exclusão de anexo de materiais (libera espaço) antes do soft delete
    if (info.type === "materiais") {
      const matDoc = await getDoc(doc(ref, info.id));
      if (matDoc.exists() && matDoc.data().storagePath) {
        await deleteFile(matDoc.data().storagePath);
      }
      // Soft delete: preserva histórico no Firestore
      await updateDoc(doc(ref, info.id), {
        deleted: true,
        deletedAt: serverTimestamp(),
        deletedBy: auth?.currentUser?.email || "system",
      });
    } else {
      const precisaAjusteResumo = info.type === "agua" || info.type === "gas";
      const movSnap = precisaAjusteResumo ? await getDoc(doc(ref, info.id)) : null;
      const movData = movSnap?.exists?.() ? movSnap.data() : null;

      // Demais coleções continuam com exclusão real
      await deleteDoc(doc(ref, info.id));

      if (precisaAjusteResumo && movData) {
        try {
          await ajustarResumoAposExclusao(info.type, movData);
        } catch (e) {
          console.warn(`Falha ao ajustar resumo de ${info.type} após exclusão:`, e?.message || e);
        }
      }
    }

    if (info.type === "unidade") {
      // Se for unidade, exclui também todo o histórico relacionado
      await deleteUnitHistory(info.id);
      showAlert(alertId, "Unidade e histórico removidos.", "success");
    } else {
      showAlert(alertId, "Item removido com sucesso.", "success");
      
      // Re-renderização específica para Estoque e Movimentações
      if (info.type === 'entrada-agua' || info.type === 'agua') {
          // Chama a orquestração completa da aba Água para re-renderizar o histórico e o resumo de estoque
          onAguaTabChange(); 
      } else if (info.type === 'entrada-gas' || info.type === 'gas') {
          // Chama a orquestração completa da aba Gás para re-renderizar o histórico e o resumo de estoque
          onGasTabChange(); 
      }
    }
  } catch (err) {
    console.error(`Erro ao remover ${info.type}:`, err);
    showAlert(alertId, `Erro ao remover: ${err.message}`, "error");
  } finally {
    DOM_ELEMENTS.btnConfirmDelete.disabled = false;
    DOM_ELEMENTS.btnConfirmDelete.innerHTML = '<i data-lucide="trash-2"></i><span>Confirmar Exclusão</span>';
    DOM_ELEMENTS.confirmDeleteModal.style.display = "none";
    setDeleteInfo({});
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
  }
}

/**
 * Exclui todo o histórico de movimentações (Água, Gás, Materiais) para uma unidade.
 * @param {string} uid ID da unidade a ser excluída.
 */
async function deleteUnitHistory(uid) {
  const collections = [
    COLLECTIONS.aguaMov,
    COLLECTIONS.gasMov,
    // Materiais preservados: não remover
    COLLECTIONS.estoqueAgua,
    COLLECTIONS.estoqueGas,
  ];

  // Acumula o que foi apagado para reverter nos docs de resumo
  // (mesma semântica da exclusão individual: excluir = corrigir lançamento)
  const totais = {
    agua: { saidas: 0, retornos: 0 },
    gas:  { saidas: 0, retornos: 0 },
  };

  const contabilizar = (col, docData) => {
    const alvo = col === COLLECTIONS.aguaMov ? totais.agua
      : col === COLLECTIONS.gasMov ? totais.gas
      : null;
    if (!alvo) return;
    const qty = parseInt(docData?.quantidade, 10) || 0;
    const tipo = String(docData?.tipo || "").toLowerCase();
    if (qty <= 0 || !MOV_TIPOS_CONTABEIS.includes(tipo)) return;
    // Gás: só movimentações pós-corte entraram no resumo
    if (col === COLLECTIONS.gasMov && (docData?.data?.toMillis?.() ?? 0) < GAS_CUTOFF_MS) return;
    if (tipo === "entrega") alvo.saidas += qty;
    else alvo.retornos += qty;
  };

  const deleteWhereEqualsInChunks = async (col, field, value) => {
    while (true) {
      const q = query(col, where(field, "==", value), limit(500));
      const snap = await getDocs(q);
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => {
        contabilizar(col, d.data());
        batch.delete(d.ref);
      });
      await batch.commit();
    }
  };

  for (const col of collections) {
    await deleteWhereEqualsInChunks(col, "unidadeId", uid);
  }

  // Reverte os totais nos resumos e remove a unidade dos mapas de saldo
  try {
    if (totais.agua.saidas > 0 || totais.agua.retornos > 0) {
      const upd = { tipo: "__resumo__", atualizadoEm: serverTimestamp() };
      if (totais.agua.saidas > 0)   upd.totalSaidas   = increment(-totais.agua.saidas);
      if (totais.agua.retornos > 0) upd.totalRetornos = increment(-totais.agua.retornos);
      await setDoc(doc(COLLECTIONS.estoqueAgua, "resumo-agua"), upd, { merge: true });
    }
    await updateDoc(doc(COLLECTIONS.estoqueAgua, "resumo-unidades-agua"), {
      [`saldos.${uid}`]: deleteField(),
      atualizadoEm: serverTimestamp(),
    }).catch(() => {}); // doc pode ainda não existir

    const updGas = { atualizadoEm: serverTimestamp(), [`saldos.${uid}`]: deleteField() };
    if (totais.gas.saidas > 0)   updGas.totalSaidas   = increment(-totais.gas.saidas);
    if (totais.gas.retornos > 0) updGas.totalRetornos = increment(-totais.gas.retornos);
    await updateDoc(doc(COLLECTIONS.estoqueGas, "resumo-gas"), updGas).catch(() => {});
  } catch (e) {
    console.warn("Falha ao ajustar resumos após exclusão da unidade:", e?.message || e);
  }

  // Opcional: desvincula materiais da unidade (preservando o histórico)
  try {
    while (true) {
      const qMat = query(COLLECTIONS.materiais, where("unidadeId", "==", uid), limit(500));
      const snapMat = await getDocs(qMat);
      if (snapMat.empty) break;
      const batch = writeBatch(db);
      snapMat.docs.forEach((d) => {
        batch.update(d.ref, {
          unidadeId: null,
          unidadeRemovidaEm: serverTimestamp(),
        });
      });
      await batch.commit();
    }
  } catch (e) {
    console.warn("Falha ao desvincular materiais da unidade (preservado)", e);
  }

  console.log(`Histórico da unidade ${uid} excluído (materiais preservados).`);
}

export { executeDelete, getCollectionRef };
