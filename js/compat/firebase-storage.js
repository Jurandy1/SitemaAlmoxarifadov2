// js/compat/firebase-storage.js — substitui "firebase/storage" usando o bucket privado do Supabase.
import { supabase } from "./supabase-client.js";

const BUCKET = "pedidos-materiais";
const LINK_VALIDADE_S = 60 * 60 * 24 * 365 * 5; // links assinados de longa duração (bucket é privado)

function storageError(error) {
  const e = new Error(error?.message || String(error));
  e.code = /not.?found/i.test(e.message) ? "storage/object-not-found" : "storage/unknown";
  return e;
}

export function getStorage() {
  return { bucket: BUCKET };
}

export function ref(_storage, path = "") {
  const fullPath = String(path).replace(/^\/+/, "");
  return { fullPath, name: fullPath.split("/").pop(), bucket: BUCKET };
}

export async function uploadBytes(fileRef, file, metadata) {
  const { error } = await supabase.storage.from(BUCKET).upload(fileRef.fullPath, file, {
    upsert: true,
    contentType: metadata?.contentType || file?.type || undefined,
  });
  if (error) throw storageError(error);
  return { ref: fileRef, metadata: { fullPath: fileRef.fullPath, name: fileRef.name } };
}

export async function getDownloadURL(fileRef) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(fileRef.fullPath, LINK_VALIDADE_S);
  if (error) throw storageError(error);
  return data.signedUrl;
}

export async function deleteObject(fileRef) {
  const { error } = await supabase.storage.from(BUCKET).remove([fileRef.fullPath]);
  if (error) throw storageError(error);
}
