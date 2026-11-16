import fs from "fs";

const origem = "C:/Users/PC/Desktop/BATIMENTO DE COMPRAS/lotacoes_de_para.json";
const nomes = new Set(["Unidade"]);

function falar(nome) {
  return String(nome || "Unidade")
    .replace(/[\/|–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

if (fs.existsSync(origem)) {
  const json = JSON.parse(fs.readFileSync(origem, "utf8"));
  for (const item of json.mapeamento || []) {
    if (item.nome_novo) nomes.add(falar(item.nome_novo));
    if (item.nome_antigo) nomes.add(falar(item.nome_antigo));
  }
}

const frases = ["Voz da televisão ligada."];
for (const nome of nomes) {
  frases.push(`${nome}, em separação`);
  frases.push(`${nome}, pronto para retirada`);
}

function slug(texto) {
  return String(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const lista = frases.map((texto) => ({ texto, slug: slug(texto) }));
fs.mkdirSync("public/tv-voz", { recursive: true });
fs.writeFileSync("public/tv-voz/frases.json", JSON.stringify(lista, null, 2));
console.log("frases", lista.length);
