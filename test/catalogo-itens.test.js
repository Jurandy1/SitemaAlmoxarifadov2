import test from "node:test";
import assert from "node:assert/strict";
import { analisarItem, checkSplit } from "../js/modules/materiais/catalogo-itens.js";

test("separa canetas azul e preta que vieram na mesma linha", () => {
  assert.deepEqual(checkSplit("CANETA AZUL / CANETA PRETA"), ["CANETA AZUL", "CANETA PRETA"]);
  const resultado = analisarItem("CANETA AZUL E PRETA");
  assert.equal(resultado.type, "split");
  assert.deepEqual(resultado.splits, ["CANETA AZUL", "CANETA PRETA"]);
});

test("mantém cada cor de caneta como item individual", () => {
  assert.equal(analisarItem("CANETA AZUL").type, "ok");
  assert.equal(analisarItem("CANETA PRETA").type, "ok");
});
