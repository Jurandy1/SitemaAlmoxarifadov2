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
