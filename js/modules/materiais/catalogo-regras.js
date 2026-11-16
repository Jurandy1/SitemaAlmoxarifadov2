/**
 * Regras puras do catálogo de materiais/categorias (sem navegador, sem banco).
 * Usadas pelo site (catalogo.js) e pelo script de migração (scripts/supabase/criar-ids-catalogo.mjs),
 * para os dois gerarem exatamente as mesmas chaves e categorias.
 */

const semAcento = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");

// Chave de comparação de um nome de material: "Café  250g" → "CAFE 250G"
// (igual ao normMat original da Separação, sem os sinônimos/aliases)
export function chaveMaterial(nome) {
  return semAcento(nome).trim().replace(/\s+/g, " ").toUpperCase().replace(/[^A-Z0-9\s\/().-]/g, "").trim();
}

const PALAVRAS_NEUTRAS = new Set(["A", "AS", "COM", "DA", "DAS", "DE", "DO", "DOS", "E", "EM", "PARA", "POR"]);

function tokensMaterial(nome) {
  const singular = (t) => {
    if (/^[A-Z]{5,}EIS$/.test(t)) return t.slice(0, -3) + "EL";
    if (/^[A-Z]{5,}OES$/.test(t)) return t.slice(0, -3) + "AO";
    if (/^[A-Z]{5,}AES$/.test(t)) return t.slice(0, -3) + "AO";
    if (/^[A-Z]{5,}NS$/.test(t)) return t.slice(0, -2) + "M";
    if (/^[A-Z]{4,}S$/.test(t)) return t.slice(0, -1);
    return t;
  };
  return chaveMaterial(nome)
    .replace(/[\/().-]+/g, " ")
    .split(/\s+/)
    .filter((t) => t && !PALAVRAS_NEUTRAS.has(t))
    .map(singular);
}

function diceConjuntos(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let iguais = 0;
  for (const x of sa) if (sb.has(x)) iguais++;
  return (2 * iguais) / (sa.size + sb.size);
}

function bigramas(s) {
  const x = chaveMaterial(s).replace(/\s+/g, " ");
  if (x.length < 2) return x ? [x] : [];
  const out = [];
  for (let i = 0; i < x.length - 1; i++) out.push(x.slice(i, i + 2));
  return out;
}

// Partes como A4, 250G, 20L e 12X30 diferenciam materiais parecidos e não podem
// ser ignoradas pela sugestão ("Papel A4" não deve virar "Papel A3").
function especificacoes(tokens) {
  return new Set(tokens.filter((t) => /\d/.test(t)));
}

/**
 * Nota de 0 a 1 para sugerir que duas grafias representam o mesmo material.
 * É deliberadamente conservadora: serve para revisão humana, nunca para juntar automaticamente.
 */
export function pontuarSimilaridadeMaterial(a, b) {
  const ka = chaveMaterial(a), kb = chaveMaterial(b);
  if (!ka || !kb) return 0;
  if (ka === kb) return 1;
  const ta = tokensMaterial(ka), tb = tokensMaterial(kb);
  const ea = especificacoes(ta), eb = especificacoes(tb);
  if (ea.size && eb.size && ![...ea].some((x) => eb.has(x))) return 0.25;
  const palavras = diceConjuntos(ta, tb);
  const escrita = diceConjuntos(bigramas(ka), bigramas(kb));
  let nota = palavras * 0.68 + escrita * 0.32;
  if (ea.size || eb.size) nota += diceConjuntos(ea, eb) * 0.06;
  return Math.max(0, Math.min(1, nota));
}

// Chave de comparação de um nome de categoria: "1 - Material de Expediente" → "MATERIAL DE EXPEDIENTE"
export function chaveCategoria(nome) {
  return semAcento(nome)
    .replace(/^\s*\d+\s*[-–—.]\s*/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

// Categorias padrão do almoxarifado. A ordem define o código inicial (CAT-01, CAT-02...).
export const CATEGORIAS_PADRAO = ["Expediente", "Limpeza", "Alimentício", "Descartável", "Higiene", "Atividades/Convivência", "Outros"];

// Nome escrito no pedido → categoria padrão. O que não se encaixar vira "Outros"
// (e pode ser corrigido depois pela tela de correção, pelo código).
const REGRAS_CATEGORIA = [
  [/ESCRIT|EXPEDIENTE|TONN?ER/, "Expediente"],
  [/HIGIENE E LIMPEZA|LIMPEZA/, "Limpeza"],
  [/ALIMENT|LANCHE|PERECIV|ENLATAD|CEREA|GRAO|AMIDO|PROCESSAD|INDUSTRIALIZ/, "Alimentício"],
  [/DESCARTAV/, "Descartável"],
  [/HIGIEN/, "Higiene"],
  [/ATIVIDADE|CONVIV|SCFV|PAIF|CRIANCA FELIZ|PISUAS|\bPCF\b/, "Atividades/Convivência"],
];

export function categoriaPadrao(nomeEscrito) {
  const k = chaveCategoria(nomeEscrito);
  if (!k) return "Outros";
  for (const [re, nome] of REGRAS_CATEGORIA) if (re.test(k)) return nome;
  return "Outros";
}

export const codigoMaterial = (n) => "MAT-" + String(n).padStart(4, "0");
export const codigoCategoria = (n) => "CAT-" + String(n).padStart(2, "0");
export const numeroDoCodigo = (id) => Number(String(id || "").replace(/^\D+/, "")) || 0;

// Segue as junções (mescladoEm) até o código que vale: MAT-0153 → MAT-0001
export function codigoFinal(id, porId) {
  let atual = id;
  const visto = new Set();
  while (atual && porId.get(atual)?.mescladoEm && !visto.has(atual)) {
    visto.add(atual);
    atual = porId.get(atual).mescladoEm;
  }
  return atual;
}
