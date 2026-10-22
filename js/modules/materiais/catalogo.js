/**
 * Catálogo de materiais (MAT-0001...) e categorias (CAT-01...) com código fixo.
 * - Cada item de pedido/histórico guarda materialId e categoriaId (o nome escrito não muda).
 * - Corrigir é mexer no catálogo: renomear, juntar um código em outro (mescladoEm) ou trocar a
 *   categoria do material. Como os pedidos guardam o código, a correção vale para todos de uma vez.
 */
import { getDocs, query, doc, getDoc, setDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { COLLECTIONS, db } from "../../services/firestore-service.js";
import {
  chaveMaterial,
  chaveCategoria,
  categoriaPadrao,
  codigoMaterial,
  codigoCategoria,
  numeroDoCodigo,
  codigoFinal,
} from "./catalogo-regras.js";

const _c = {
  carregado: false,
  carregadoEm: 0,
  mats: new Map(), // id → doc
  cats: new Map(),
  varMat: new Map(), // chave do nome → id
  carregando: null,
};

let _aoAlterar = () => {}; // avisado depois de cada correção (a Separação sincroniza as regras por nome)
export function configurarCatalogo({ aoAlterar } = {}) {
  if (aoAlterar) _aoAlterar = aoAlterar;
}

export function getCatalogo() {
  return _c;
}

export async function carregarCatalogo(force = false) {
  if (_c.carregado && !force && Date.now() - _c.carregadoEm < 2 * 60 * 1000) return _c;
  if (_c.carregando) return _c.carregando;
  _c.carregando = (async () => {
    try {
      const [sm, sc] = await Promise.all([getDocs(query(COLLECTIONS.catalogoMateriais)), getDocs(query(COLLECTIONS.catalogoCategorias))]);
      _c.mats = new Map(sm.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
      _c.cats = new Map(sc.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
      reindexar();
      _c.carregado = true;
      _c.carregadoEm = Date.now();
    } catch (e) {
      console.warn("[Catálogo] não carregado", e);
    } finally {
      _c.carregando = null;
    }
    return _c;
  })();
  return _c.carregando;
}

function reindexar() {
  _c.varMat = new Map();
  // Os juntados primeiro: as variantes do código que vale ficam por cima
  const ordem = [..._c.mats.values()].sort((a, b) => (b.mescladoEm ? 1 : 0) - (a.mescladoEm ? 1 : 0));
  for (const m of ordem) for (const v of m.variantes || []) _c.varMat.set(v, m.id);
}

// ─── Leitura ──────────────────────────────────────────────────────
export function materialPorId(id) {
  const fim = codigoFinal(id, _c.mats);
  return _c.mats.get(fim) || null;
}
export function categoriaPorId(id) {
  const fim = codigoFinal(id, _c.cats);
  return _c.cats.get(fim) || null;
}
export function materialPorNome(nome) {
  const id = _c.varMat.get(chaveMaterial(nome));
  return id ? materialPorId(id) : null;
}
// Nome e categoria do catálogo para um item de pedido (null se o catálogo não conhece o item)
export function infoCatalogoDoItem(it) {
  if (!_c.carregado || !it) return null;
  const m = (it.materialId && materialPorId(it.materialId)) || (it.material && materialPorNome(it.material));
  if (!m) return null;
  const cat = categoriaPorId(m.categoriaId);
  return { materialId: m.id, material: m.nome, categoriaId: cat?.id || m.categoriaId, categoria: cat?.nome || "Outros" };
}
export const listarMateriais = () => [..._c.mats.values()];
export const listarCategorias = () => [..._c.cats.values()];

// ─── Códigos novos ────────────────────────────────────────────────
function idCategoriaPorNome(nomePadrao) {
  const k = chaveCategoria(nomePadrao);
  const c = [..._c.cats.values()].find((x) => !x.mescladoEm && chaveCategoria(x.nome) === k);
  return c?.id || null;
}

async function proximoCodigo(colecao, mapa, fmt) {
  let n = Math.max(0, ...[...mapa.keys()].map(numeroDoCodigo)) + 1;
  // Outra pessoa pode ter criado o mesmo código há pouco: pula os que já existem no banco
  for (;;) {
    const id = fmt(n);
    const snap = await getDoc(doc(colecao, id));
    if (!snap.exists()) return id;
    mapa.set(id, { ...snap.data(), id });
    n++;
  }
}

async function criarMaterial(nome, categoriaId) {
  const id = await proximoCodigo(COLLECTIONS.catalogoMateriais, _c.mats, codigoMaterial);
  const k = chaveMaterial(nome);
  const d = { codigo: id, nome: String(nome).trim(), categoriaId, variantes: [k], ocorrencias: 0, criadoEm: serverTimestamp() };
  await setDoc(doc(COLLECTIONS.catalogoMateriais, id), d);
  _c.mats.set(id, { ...d, id });
  _c.varMat.set(k, id);
  return id;
}

/**
 * Coloca materialId/categoriaId nos itens que ainda não têm (ou cujo nome mudou na ficha).
 * Material desconhecido ganha um código novo. Nunca impede o salvamento: em erro, o item segue sem código.
 * @param {object|Array} itens itemsMap do pedido ou lista de itens
 * @param {(it)=>string} secaoDoItem título da seção do pedido (ajuda a achar a categoria de item novo)
 */
export async function garantirCodigos(itens, secaoDoItem = () => "") {
  try {
    await carregarCatalogo();
    if (!_c.carregado) return;
    const lista = Array.isArray(itens) ? itens : Object.values(itens || {});
    for (const it of lista) {
      if (!it || !String(it.material || "").trim()) continue;
      const k = chaveMaterial(it.material);
      let m = it.materialId ? materialPorId(it.materialId) : null;
      if (!m || !(m.variantes || []).includes(k)) {
        const id = _c.varMat.get(k);
        if (id) m = materialPorId(id);
        else {
          const escrito = categoriaPadrao(it.tipo || it.categoria || "") === "Outros" ? secaoDoItem(it) || it.tipo : it.tipo || it.categoria;
          const catId = idCategoriaPorNome(categoriaPadrao(escrito)) || idCategoriaPorNome("Outros");
          m = materialPorId(await criarMaterial(it.material, catId));
        }
      }
      if (!m) continue;
      it.materialId = m.id;
      it.categoriaId = categoriaPorId(m.categoriaId)?.id || m.categoriaId;
    }
  } catch (e) {
    console.warn("[Catálogo] itens salvos sem código", e);
  }
}

// ─── Correções (só administrador) ─────────────────────────────────
async function gravar(colecao, id, dados) {
  await setDoc(doc(colecao, id), { ...dados, atualizadoEm: serverTimestamp() }, { merge: true });
}

export async function renomearMaterial(id, nome) {
  const m = materialPorId(id);
  const novo = String(nome || "").trim();
  if (!m || !novo) throw new Error("Código ou nome inválido");
  const k = chaveMaterial(novo);
  const variantes = [...new Set([...(m.variantes || []), k])];
  await gravar(COLLECTIONS.catalogoMateriais, m.id, { nome: novo, variantes });
  Object.assign(m, { nome: novo, variantes });
  _c.varMat.set(k, m.id);
  _aoAlterar({ tipo: "material", ids: [m.id], nome: novo, variantes });
  return m;
}

export async function juntarMateriais(deId, paraId) {
  const de = materialPorId(deId);
  const para = materialPorId(paraId);
  if (!de || !para) throw new Error("Código não encontrado");
  if (de.id === para.id) throw new Error("Os dois códigos já são o mesmo material");
  const variantes = [...new Set([...(para.variantes || []), ...(de.variantes || [])])];
  const b = writeBatch(db);
  b.set(doc(COLLECTIONS.catalogoMateriais, para.id), { variantes, atualizadoEm: serverTimestamp() }, { merge: true });
  b.set(doc(COLLECTIONS.catalogoMateriais, de.id), { mescladoEm: para.id, atualizadoEm: serverTimestamp() }, { merge: true });
  await b.commit();
  para.variantes = variantes;
  de.mescladoEm = para.id;
  reindexar();
  _aoAlterar({ tipo: "material", ids: [de.id, para.id], nome: para.nome, variantes: de.variantes || [] });
  return para;
}

export async function mudarCategoriaMaterial(id, categoriaId) {
  const m = materialPorId(id);
  const c = categoriaPorId(categoriaId);
  if (!m || !c) throw new Error("Código não encontrado");
  await gravar(COLLECTIONS.catalogoMateriais, m.id, { categoriaId: c.id });
  m.categoriaId = c.id;
  _aoAlterar({ tipo: "categoriaDoMaterial", ids: [m.id], categoria: c.nome });
  return m;
}

export async function renomearCategoria(id, nome) {
  const c = categoriaPorId(id);
  const novo = String(nome || "").trim();
  if (!c || !novo) throw new Error("Código ou nome inválido");
  await gravar(COLLECTIONS.catalogoCategorias, c.id, { nome: novo });
  const antigo = c.nome;
  c.nome = novo;
  _aoAlterar({ tipo: "categoria", ids: [c.id], nome: novo, variantes: [...(c.variantes || []), chaveCategoria(antigo)] });
  return c;
}

export async function juntarCategorias(deId, paraId) {
  const de = categoriaPorId(deId);
  const para = categoriaPorId(paraId);
  if (!de || !para) throw new Error("Código não encontrado");
  if (de.id === para.id) throw new Error("As duas já são a mesma categoria");
  const variantes = [...new Set([...(para.variantes || []), ...(de.variantes || []), chaveCategoria(de.nome)])];
  const b = writeBatch(db);
  b.set(doc(COLLECTIONS.catalogoCategorias, para.id), { variantes, atualizadoEm: serverTimestamp() }, { merge: true });
  b.set(doc(COLLECTIONS.catalogoCategorias, de.id), { mescladoEm: para.id, atualizadoEm: serverTimestamp() }, { merge: true });
  await b.commit();
  para.variantes = variantes;
  de.mescladoEm = para.id;
  _aoAlterar({ tipo: "categoria", ids: [de.id, para.id], nome: para.nome, variantes: [...(de.variantes || []), chaveCategoria(de.nome)] });
  return para;
}

export async function criarCategoria(nome) {
  const novo = String(nome || "").trim();
  if (!novo) throw new Error("Nome inválido");
  if (idCategoriaPorNome(novo)) throw new Error("Já existe uma categoria com esse nome");
  const id = await proximoCodigo(COLLECTIONS.catalogoCategorias, _c.cats, codigoCategoria);
  const d = { codigo: id, nome: novo, variantes: [chaveCategoria(novo)], criadoEm: serverTimestamp() };
  await setDoc(doc(COLLECTIONS.catalogoCategorias, id), d);
  _c.cats.set(id, { ...d, id });
  _aoAlterar({ tipo: "categoria", ids: [id], nome: novo, variantes: [] });
  return _c.cats.get(id);
}
