# RESPOSTAS ÀS DÚVIDAS — Pode implementar

---

## Dúvida 1: Qual coleção é a "verdade"?

**Resposta: `controleMateriais` é a ÚNICA coleção de materiais. NÃO existe coleção `entregas`.**

Olhe o `firestore-service.js` que você já recebeu — a função `buildCollections()` lista todas as coleções:

```javascript
unidades, controleAgua, controleGas, controleMateriais,
estoqueAgua, estoqueGas, userRoles, feriados,
socialCestaMov, socialCestaEstoque, socialEnxovalMov, socialEnxovalEstoque
```

Nenhuma "entregas". O fluxo inteiro (requisição → separação → retirada → entregue) acontece DENTRO de `controleMateriais` mudando o campo `status`. O `auth.js` tem listener apenas em `controleMateriais` (via `COLLECTIONS.materiais`).

**Resumo:**
- `controleMateriais` = REQS do sistema novo (mesma coleção, documentos novos com `_version: 2`)
- `semcasHistDB` = coleção NOVA para banco de planilhas (relatório de consumo)
- `semcasAliases` = coleção NOVA para aliases de unificação

---

## Dúvida 2: onclick + window ou refatorar addEventListener?

**Resposta: Manter onclick e expor via `window`. Entregar rápido e seguro.**

O sistema novo tem 177 funções e ~55 onclick/onchange/onkeyup inline. Refatorar seria semanas. A abordagem `window[k] = v` no final do módulo ESM é padrão e funciona no Vite sem problema.

```javascript
// Final do separacao.js:
const EXPORTS = { goTab, registrar, handleFile, ck, pegarParaSeparar, ... };
Object.entries(EXPORTS).forEach(([k, v]) => { window[k] = v; });
```

Para o `PAGE_STATE` (usado em `onkeyup="PAGE_STATE.ps=1;..."`), expor como:
```javascript
window.PAGE_STATE = PAGE_STATE;
```

---

## Dúvida 3: 1 planilha = 1 documento ou dividir?

**Resposta: 1 planilha = 1 documento em `semcasHistDB`. Sem dividir.**

Motivo: Uma planilha típica do SEMCAS tem ~30-50 itens × 5-15 unidades = no máximo 750 itens. Cada item ocupa ~100 bytes (material + qty). Isso dá ~75KB por documento — muito abaixo do limite de 1MB do Firestore.

Mesmo planilhas grandes (200 itens × 20 unidades) ficariam em ~400KB. Só atingiria 1MB com ~10.000 itens por planilha, o que não acontece no SEMCAS.

**Estrutura do documento `semcasHistDB`:**
```javascript
{
  id: "autogerado",           // docId do Firestore
  fileName: "ALMOXARIFADO_14_A_20_OUT.xlsx",
  weekStart: "2023-10-14",    // ISO string
  weekEnd: "2023-10-20",      // ISO string
  weekLabel: "14/10 a 20/10/2023",
  year: 2023,
  month: 10,
  yearAssumed: false,
  discrepancy: null,           // ou "Arquivo sugere novembro"
  source: "upload",            // ou "entrega" (quando veio da entrega automática)
  uploadedBy: "maria@semcas.gov.br",
  uploadedAt: serverTimestamp(),
  units: [                     // Array de unidades
    {
      unitName: "Residência Inclusiva",
      rawUnit: "RI",
      categories: [
        {
          catName: "1 - ENLATADOS",
          items: [
            { material: "ÓLEO DE SOJA", qty: 3 },
            { material: "ARROZ", qty: 14 }
          ]
        }
      ]
    }
  ]
}
```

---

## Informação extra que pode precisar

### O `materiais.js` atual (que será substituído)

Você já recebeu ele. Pontos-chave para retrocompatibilidade:

1. **Status usados**: `requisitado`, `separacao`, `retirada`, `entregue` — o sistema novo usa `separando` e `pronto` internamente, mas ao gravar no Firestore deve converter para `separacao` e `retirada`.

2. **Funções exportadas do materiais.js que outros módulos usam**:
   - `handleMateriaisSubmit` — chamada pelo form listener
   - `renderMateriaisStatus` — chamada pelo auth.js (via scheduleRenders → renderModules)
   - `handleFinalizarEntregaSubmit` — chamada pelo modal
   - `handleSalvarSeparador` — chamada pelo modal
   - `initMateriaisListeners` — chamada no setup
   - `onMateriaisTabChange` — chamada ao trocar de aba

   O novo `separacao.js` deve exportar equivalentes com os MESMOS NOMES ou adaptar os imports no `app.js` e `control-helpers.js`.

3. **O Dashboard lê de `getMateriais()` (cache.js)** — filtra por `status` e conta. Como o sistema novo usa a MESMA coleção `controleMateriais`, o Dashboard continua funcionando sem mudanças. A única adaptação opcional é mostrar `tiposMaterial` (array) em vez de `tipoMaterial` (string) para documentos `_version: 2`.

### Coleções no `buildCollections()` após a mudança

```javascript
function buildCollections(basePath) {
    return {
        // ... todas as existentes (não mexer) ...
        unidades: collection(db, `${basePath}/unidades`),
        aguaMov: collection(db, `${basePath}/controleAgua`),
        gasMov: collection(db, `${basePath}/controleGas`),
        materiais: collection(db, `${basePath}/controleMateriais`),
        estoqueAgua: collection(db, `${basePath}/estoqueAgua`),
        estoqueGas: collection(db, `${basePath}/estoqueGas`),
        userRoles: collection(db, `${basePath}/userRoles`),
        feriados: collection(db, `${basePath}/feriados`),
        cestaMov: collection(db, `${basePath}/socialCestaMov`),
        cestaEstoque: collection(db, `${basePath}/socialCestaEstoque`),
        enxovalMov: collection(db, `${basePath}/socialEnxovalMov`),
        enxovalEstoque: collection(db, `${basePath}/socialEnxovalEstoque`),
        
        // NOVAS (adicionar):
        semcasHistDB: collection(db, `${basePath}/semcasHistDB`),
        semcasAliases: collection(db, `${basePath}/semcasAliases`),
    };
}
```

### firestore.rules — adicionar DENTRO do match existente

```
match /semcasHistDB/{docId} {
  allow read: if request.auth != null;
  allow create, update: if isEditorOrAdmin();
  allow delete: if isAdmin();
}
match /semcasAliases/{docId} {
  allow read: if request.auth != null;
  allow write: if isEditorOrAdmin();
}
```

---

## PODE IMPLEMENTAR. Todas as dúvidas estão respondidas.

Resumo das decisões:
1. ✅ `controleMateriais` é a verdade (não existe `entregas`)
2. ✅ `window[k] = v` para onclick (não refatorar)
3. ✅ 1 planilha = 1 documento (sem dividir)
