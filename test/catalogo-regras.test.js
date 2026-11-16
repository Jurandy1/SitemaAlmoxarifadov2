import test from "node:test";
import assert from "node:assert/strict";
import { chaveMaterial, pontuarSimilaridadeMaterial } from "../js/modules/materiais/catalogo-regras.js";

test("normaliza acentos, espaços e caixa sem apagar especificações", () => {
  assert.equal(chaveMaterial("  Café   250g "), "CAFE 250G");
});

test("sugere nomes com as mesmas palavras em outra ordem", () => {
  assert.ok(pontuarSimilaridadeMaterial("Resma de papel A4", "Papel A4 - resma") >= 0.72);
});

test("sugere pequenas variações de escrita", () => {
  assert.ok(pontuarSimilaridadeMaterial("Detergente líquido", "Detergente liquido") >= 0.9);
  assert.ok(pontuarSimilaridadeMaterial("Copo descartável", "Copos descartáveis") >= 0.72);
});

test("não sugere especificações numéricas incompatíveis", () => {
  assert.ok(pontuarSimilaridadeMaterial("Papel A4", "Papel A3") < 0.72);
  assert.ok(pontuarSimilaridadeMaterial("Café 250g", "Café 500g") < 0.72);
});
