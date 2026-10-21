// js/compat/firebase-firestore.js — substitui "firebase/firestore" usando a tabela public.fs_docs do Supabase.
// Cada documento é uma linha (col = caminho da coleção, id, data jsonb). As funções SQL fs_write, fs_batch
// e fs_query (scripts/supabase/004_fs_docs.sql) reproduzem a semântica do Firestore no servidor.
import { supabase } from "./supabase-client.js";

const PAGE = 1000; // limite de linhas por resposta da API do Supabase

// ─── Tipos ────────────────────────────────────────────────────────
export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static now() {
    return Timestamp.fromMillis(Date.now());
  }
  static fromDate(date) {
    return Timestamp.fromMillis(date.getTime());
  }
  static fromMillis(ms) {
    const seconds = Math.floor(ms / 1000);
    return new Timestamp(seconds, Math.round((ms - seconds * 1000) * 1e6));
  }
  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate() {
    return new Date(this.toMillis());
  }
  isEqual(other) {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
  valueOf() {
    // mesmo formato do SDK: permite comparar timestamps com < e >
    return `${String(this.seconds + 1e12).padStart(13, "0")}.${String(this.nanoseconds).padStart(9, "0")}`;
  }
  toJSON() {
    return { seconds: this.seconds, nanoseconds: this.nanoseconds };
  }
  toString() {
    return `Timestamp(seconds=${this.seconds}, nanoseconds=${this.nanoseconds})`;
  }
}

class FieldValue {
  constructor(op, value) {
    this._op = op;
    this._value = value;
  }
}

export const serverTimestamp = () => new FieldValue("now");
export const increment = (n) => new FieldValue("inc", Number(n) || 0);
export const deleteField = () => new FieldValue("del");
export const arrayUnion = (...items) => new FieldValue("union", items);
export const arrayRemove = (...items) => new FieldValue("remove", items);

const DOC_ID = { _fieldPath: "__name__" };
export const documentId = () => DOC_ID;

export class FieldPath {
  constructor(...parts) {
    this._fieldPath = parts.join(".");
  }
  static documentId() {
    return DOC_ID;
  }
}

function fieldName(f) {
  return typeof f === "string" ? f : f?._fieldPath || String(f);
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && Object.getPrototypeOf(v) === Object.prototype;
}

function encode(v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (v instanceof Timestamp) return { __ts: v.toDate().toISOString() };
  if (v instanceof Date) return { __ts: v.toISOString() };
  if (v instanceof FieldValue) {
    const out = { __op: v._op };
    if (v._value !== undefined) out.v = encode(v._value);
    return out;
  }
  if (v instanceof DocumentReference) return { __ref: v.path };
  if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : encode(x)));
  if (typeof v === "object") {
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      const e = encode(x);
      if (e !== undefined) out[k] = e; // Firestore com ignoreUndefinedProperties
    }
    return out;
  }
  if (typeof v === "function") return undefined;
  return v;
}

function decode(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(decode);
  if (typeof v.__ts === "string" && Object.keys(v).length === 1) return Timestamp.fromMillis(Date.parse(v.__ts));
  if (typeof v.__ref === "string" && Object.keys(v).length === 1) return doc(db, v.__ref);
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = decode(x);
  return out;
}

function fsError(error, fallback = "unknown") {
  const msg = String(error?.message || error || "");
  const e = new Error(msg);
  e.code = /not-found/i.test(msg) ? "not-found"
    : /row-level security|permission|42501/i.test(msg + (error?.code || "")) ? "permission-denied"
    : /fetch|network/i.test(msg) ? "unavailable"
    : fallback;
  return e;
}

// ─── Banco / referências ──────────────────────────────────────────
const db = { type: "firestore", app: { name: "[DEFAULT]" } };

export function getFirestore() {
  return db;
}
export function initializeFirestore() {
  return db;
}
export function setLogLevel() {}
export function persistentLocalCache() {
  return {};
}
export function persistentMultipleTabManager() {
  return {};
}
export function persistentSingleTabManager() {
  return {};
}
export function memoryLocalCache() {
  return {};
}
export async function enableIndexedDbPersistence() {}
export async function enableMultiTabIndexedDbPersistence() {}

function joinPath(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== "")
    .map(String)
    .join("/")
    .split("/")
    .filter(Boolean)
    .join("/");
}

function autoId() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export class CollectionReference {
  constructor(path) {
    this.type = "collection";
    this.path = path;
    this.id = path.split("/").pop();
    this.firestore = db;
    this._constraints = [];
  }
  get parent() {
    const parts = this.path.split("/");
    return parts.length > 1 ? new DocumentReference(parts.slice(0, -1).join("/")) : null;
  }
  withConverter() {
    return this;
  }
}

export class DocumentReference {
  constructor(path) {
    this.type = "document";
    this.path = path;
    const parts = path.split("/");
    this.id = parts.pop();
    this._col = parts.join("/");
    this.firestore = db;
  }
  get parent() {
    return new CollectionReference(this._col);
  }
  withConverter() {
    return this;
  }
}

export function collection(base, ...segments) {
  const prefix = base?.type === "document" ? base.path : "";
  const path = joinPath(prefix, ...segments);
  if (path.split("/").length % 2 === 0) throw new Error(`Caminho de coleção inválido: ${path}`);
  return new CollectionReference(path);
}

export function doc(base, ...segments) {
  let path;
  if (base?.type === "collection") {
    path = joinPath(base.path, ...(segments.length ? segments : [autoId()]));
  } else if (base?.type === "document") {
    path = joinPath(base.path, ...segments);
  } else {
    path = joinPath(...segments);
  }
  if (path.split("/").length % 2 !== 0) throw new Error(`Caminho de documento inválido: ${path}`);
  return new DocumentReference(path);
}

// ─── Snapshots ────────────────────────────────────────────────────
function getPath(obj, field) {
  return field.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export class DocumentSnapshot {
  constructor(ref, rawData) {
    this.ref = ref;
    this.id = ref.id;
    this._raw = rawData ?? null;
    this._data = rawData == null ? undefined : decode(rawData);
    this.metadata = { hasPendingWrites: false, fromCache: false };
  }
  exists() {
    return this._raw !== null;
  }
  data() {
    return this._data === undefined ? undefined : structuredCloneSafe(this._data);
  }
  get(field) {
    return getPath(this._data, fieldName(field));
  }
}

export class QueryDocumentSnapshot extends DocumentSnapshot {}

// Cópia para o app poder alterar o objeto sem afetar o snapshot
function structuredCloneSafe(v) {
  if (v === null || typeof v !== "object") return v;
  if (v instanceof Timestamp) return new Timestamp(v.seconds, v.nanoseconds);
  if (v instanceof DocumentReference) return v;
  if (Array.isArray(v)) return v.map(structuredCloneSafe);
  const out = {};
  for (const [k, x] of Object.entries(v)) out[k] = structuredCloneSafe(x);
  return out;
}

export class QuerySnapshot {
  constructor(query, docs, previous) {
    this.query = query;
    this.docs = docs;
    this.size = docs.length;
    this.empty = docs.length === 0;
    this.metadata = { hasPendingWrites: false, fromCache: false };
    this._previous = previous;
  }
  forEach(cb, thisArg) {
    this.docs.forEach(cb, thisArg);
  }
  docChanges() {
    const antes = new Map((this._previous?.docs || []).map((d, i) => [d.id, { d, i }]));
    const changes = [];
    this.docs.forEach((d, newIndex) => {
      const old = antes.get(d.id);
      if (!old) changes.push({ type: "added", doc: d, oldIndex: -1, newIndex });
      else if (JSON.stringify(old.d._raw) !== JSON.stringify(d._raw)) changes.push({ type: "modified", doc: d, oldIndex: old.i, newIndex });
      antes.delete(d.id);
    });
    antes.forEach(({ d, i }) => changes.push({ type: "removed", doc: d, oldIndex: i, newIndex: -1 }));
    return changes;
  }
}

// ─── Consultas ────────────────────────────────────────────────────
export function where(field, op, value) {
  return { kind: "where", field: fieldName(field), op, value };
}
export function orderBy(field, direction = "asc") {
  return { kind: "orderBy", field: fieldName(field), desc: direction === "desc" };
}
export function limit(n) {
  return { kind: "limit", n };
}
export function limitToLast(n) {
  return { kind: "limitToLast", n };
}
export function startAfter(...values) {
  return { kind: "startAfter", values };
}
export function startAt(...values) {
  return { kind: "startAt", values };
}

export class Query {
  constructor(col, constraints) {
    this.type = "query";
    this._col = col;
    this._constraints = constraints;
    this.firestore = db;
  }
  withConverter() {
    return this;
  }
}

export function query(base, ...constraints) {
  const col = base.type === "query" ? base._col : base.path;
  const prev = base.type === "query" ? base._constraints : [];
  return new Query(col, [...prev, ...constraints.flat().filter(Boolean)]);
}

function buildParams(q) {
  const cs = q.type === "query" ? q._constraints : [];
  const filters = [];
  let order = null;
  let desc = false;
  let lim = null;
  let after = null;
  let inclusive = false;
  let cursor;
  for (const c of cs) {
    if (c.kind === "where") {
      let v = encode(c.value);
      if (c.field === "__name__") v = c.value?.id ?? c.value;
      filters.push([c.field, c.op, v]);
    } else if (c.kind === "orderBy") {
      if (order === null) {
        order = c.field;
        desc = c.desc;
      } else if (order !== c.field) {
        console.warn("[Supabase compat] apenas o primeiro orderBy é aplicado:", order, "(ignorado:", c.field + ")");
      }
    } else if (c.kind === "limit") {
      lim = c.n;
    } else if (c.kind === "limitToLast") {
      lim = c.n;
      console.warn("[Supabase compat] limitToLast tratado como limit");
    } else if (c.kind === "startAfter" || c.kind === "startAt") {
      inclusive = c.kind === "startAt";
      cursor = c.values[0];
    }
  }
  if (cursor instanceof DocumentSnapshot) {
    if (inclusive) console.warn("[Supabase compat] startAt(doc) tratado como startAfter(doc)");
    after = [order && order !== "__name__" ? (getPath(cursor._raw, order) ?? null) : null, cursor.id];
  } else if (cursor !== undefined) {
    // cursor por valor: o id sentinela decide se valores iguais entram (startAt) ou não (startAfter)
    after = [encode(cursor), desc ? (inclusive ? "￿" : "") : (inclusive ? "" : "￿")];
  }
  return { col: q.type === "query" ? q._col : q.path, filters, order, desc, lim, after };
}

async function runQuery(q) {
  const p = buildParams(q);
  const rows = [];
  let after = p.after;
  for (;;) {
    const want = p.lim == null ? PAGE : Math.min(PAGE, p.lim - rows.length);
    if (want <= 0) break;
    const { data, error } = await supabase.rpc("fs_query", {
      p_col: p.col,
      p_filters: p.filters,
      p_order: p.order,
      p_desc: p.desc,
      p_limit: want,
      p_after: after,
    });
    if (error) throw fsError(error);
    rows.push(...data);
    if (data.length < want) break;
    const last = data[data.length - 1];
    after = [p.order && p.order !== "__name__" ? (getPath(last.data, p.order) ?? null) : null, last.id];
  }
  return rows.map((r) => new QueryDocumentSnapshot(new DocumentReference(`${r.col}/${r.id}`), r.data));
}

export async function getDocs(q) {
  const docs = await runQuery(q);
  return new QuerySnapshot(q, docs);
}
export const getDocsFromServer = getDocs;
export const getDocsFromCache = getDocs;

export async function getDoc(ref) {
  const { data, error } = await supabase.from("fs_docs").select("data").eq("col", ref._col).eq("id", ref.id).maybeSingle();
  if (error) throw fsError(error);
  return new DocumentSnapshot(ref, data ? data.data : null);
}
export const getDocFromServer = getDoc;
export const getDocFromCache = getDoc;

export async function getCountFromServer(q) {
  const p = buildParams(q);
  if (!p.filters.length) {
    const { count, error } = await supabase.from("fs_docs").select("id", { count: "exact", head: true }).eq("col", p.col);
    if (error) throw fsError(error);
    return { data: () => ({ count }) };
  }
  const snap = await getDocs(q);
  return { data: () => ({ count: snap.size }) };
}

// ─── Escritas ─────────────────────────────────────────────────────
// updateDoc: "a.b" altera só o subcampo; um objeto em "a" substitui o mapa inteiro (como no Firestore)
function updatePatch(dataOrField, rest) {
  let entries;
  if (typeof dataOrField === "string" || dataOrField?._fieldPath) {
    entries = [];
    const args = [dataOrField, ...rest];
    for (let i = 0; i < args.length; i += 2) entries.push([fieldName(args[i]), args[i + 1]]);
  } else {
    entries = Object.entries(dataOrField || {});
  }
  const patch = {};
  for (const [key, value] of entries) {
    if (value === undefined) continue;
    const enc = isPlainObject(value) ? { __op: "put", v: encode(value) } : encode(value);
    const parts = key.split(".");
    let node = patch;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!isPlainObject(node[parts[i]]) || node[parts[i]].__op) node[parts[i]] = {};
      node = node[parts[i]];
    }
    node[parts[parts.length - 1]] = enc;
  }
  return patch;
}

function setMode(options) {
  return options && (options.merge || options.mergeFields) ? "merge" : "set";
}

async function write(ref, data, mode) {
  const { error } = await supabase.rpc("fs_write", { p_col: ref._col, p_id: ref.id, p_data: data, p_mode: mode });
  if (error) throw fsError(error);
}

export async function setDoc(ref, data, options) {
  await write(ref, encode(data) || {}, setMode(options));
}

export async function updateDoc(ref, dataOrField, ...rest) {
  await write(ref, updatePatch(dataOrField, rest), "update");
}

export async function addDoc(colRef, data) {
  const ref = doc(colRef);
  await write(ref, encode(data) || {}, "set");
  return ref;
}

export async function deleteDoc(ref) {
  const { error } = await supabase.from("fs_docs").delete().eq("col", ref._col).eq("id", ref.id);
  if (error) throw fsError(error);
}

class WriteBatch {
  constructor() {
    this._ops = [];
  }
  set(ref, data, options) {
    this._ops.push({ op: setMode(options), col: ref._col, id: ref.id, data: encode(data) || {} });
    return this;
  }
  update(ref, dataOrField, ...rest) {
    this._ops.push({ op: "update", col: ref._col, id: ref.id, data: updatePatch(dataOrField, rest) });
    return this;
  }
  delete(ref) {
    this._ops.push({ op: "delete", col: ref._col, id: ref.id });
    return this;
  }
  async commit() {
    if (!this._ops.length) return;
    const { error } = await supabase.rpc("fs_batch", { p_ops: this._ops });
    if (error) throw fsError(error);
  }
}

export function writeBatch() {
  return new WriteBatch();
}

// Transação simplificada: lê na hora e grava tudo junto no final (atômico no servidor)
export async function runTransaction(_db, fn) {
  const batch = new WriteBatch();
  const tx = {
    get: (ref) => getDoc(ref),
    set: (ref, data, options) => (batch.set(ref, data, options), tx),
    update: (ref, d, ...r) => (batch.update(ref, d, ...r), tx),
    delete: (ref) => (batch.delete(ref), tx),
  };
  const result = await fn(tx);
  await batch.commit();
  return result;
}

// ─── Tempo real (onSnapshot) ──────────────────────────────────────
let channelSeq = 0;

export function onSnapshot(target, ...args) {
  const fns = args.filter((a) => typeof a === "function" || (a && typeof a.next === "function"));
  const observer = typeof fns[0] === "function" ? { next: fns[0], error: fns[1] } : fns[0] || {};
  const isDoc = target?.type === "document";
  const col = isDoc ? target._col : target.type === "query" ? target._col : target.path;

  let active = true;
  let previous = null;
  let timer = null;
  let running = false;
  let again = false;

  const refresh = async () => {
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      if (isDoc) {
        const snap = await getDoc(target);
        if (active) observer.next?.(snap);
      } else {
        const docs = await runQuery(target);
        const snap = new QuerySnapshot(target, docs, previous);
        previous = snap;
        if (active) observer.next?.(snap);
      }
    } catch (err) {
      if (active) {
        if (observer.error) observer.error(err);
        else console.error("[Supabase compat] onSnapshot:", err);
      }
    } finally {
      running = false;
      if (again && active) {
        again = false;
        schedule();
      }
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, 250);
  };

  const channel = supabase
    .channel(`fs-${++channelSeq}-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "fs_docs", filter: `col=eq.${col}` }, (payload) => {
      if (isDoc) {
        const id = payload.new?.id ?? payload.old?.id;
        if (id && id !== target.id) return;
      }
      schedule();
    })
    .subscribe();

  refresh();

  return () => {
    active = false;
    clearTimeout(timer);
    supabase.removeChannel(channel);
  };
}

export function snapshotEqual(a, b) {
  return JSON.stringify(a?.docs?.map((d) => [d.id, d._raw])) === JSON.stringify(b?.docs?.map((d) => [d.id, d._raw]));
}

export async function waitForPendingWrites() {}
export async function terminate() {}
export async function clearIndexedDbPersistence() {}
