# PATCHES para `js/modules/separacao.js`

> Aplique cada patch abrindo o arquivo, achando o trecho `🔍 ENCONTRAR` e substituindo por `✏️ SUBSTITUIR POR`. Faça **backup** antes.

---

## 🩹 PATCH 1 — Helpers para detectar diferenças triviais

**Onde:** logo depois da função `normMat`, antes da constante `const MATERIAL_CATALOG = {...`. Procure pela linha:

```js
function normMat(s){return rmAcc(s).trim().replace(/\s+/g,' ').toUpperCase().replace(/[^A-Z0-9\s\/().-]/g,'');}
```

**✏️ ADICIONAR LOGO ABAIXO** (não substitui nada — só insere):

```js
// ═══════════════════════════════════════════════════════════════════
// HELPERS — Detecção de diferenças triviais (acento/case/plural/conectivos)
// Usado para aplicar correções silenciosas sem incomodar o usuário no modal.
// ═══════════════════════════════════════════════════════════════════
const _CONECTIVOS = new Set(['DE','DA','DO','DAS','DOS','EM','PARA','POR','COM','E','OU','NO','NA']);
const _PLURAL_INVAR = new Set([
  'CLIPS','LAPIS','ATLAS','PIRES','ONIBUS','VIRUS','MAIS','MENOS','TRES','GRATIS',
  'GAS','LATEX','TAPIOCA','MUCILON','GUARDANAPOS','MULTIUSO'
]);

function _normalizarAgressivo(s) {
  let r = rmAcc(String(s||'')).toUpperCase();
  r = r.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  r = r.split(/\s+/)
    .filter(w => w && !_CONECTIVOS.has(w))
    .map(w => {
      if (w.length >= 4 && w.endsWith('S') && !_PLURAL_INVAR.has(w)) return w.slice(0, -1);
      return w;
    })
    .join(' ');
  return r;
}

function _diferencaTrivial(a, b) {
  if (a === b) return true;
  const ra = rmAcc(String(a||'')).toUpperCase().replace(/\s+/g,' ').trim();
  const rb = rmAcc(String(b||'')).toUpperCase().replace(/\s+/g,' ').trim();
  if (ra === rb) return true;                                  // só acento/case
  if (_normalizarAgressivo(a) === _normalizarAgressivo(b)) return true; // + plural/conectivos
  return false;
}
```

---

## 🩹 PATCH 2 — Aplicar correções triviais em silêncio dentro de `detectItemIssues`

**Onde:** no FINAL da função `detectItemIssues`, dentro do `forEach` de itens. Procure por este bloco (está perto do final da função, depois das fases 0/1/2 de splits):

### 🔍 ENCONTRAR exatamente:

```js
      // ═══ FASE 3: NORMALIZAÇÃO COMPLETA ═══
      // Limpa junk + corrige ortografia + singulariza + busca catálogo
      const step1 = cleanMaterialJunk(mat);        // Remove (URGENTE), aspas, traços
      const step2 = fixSpelling(step1);             // Corrige ortografia
      const step3 = singularizeMaterial(step2);     // Plural → singular
      const nk = normMat(step3);                    // Normaliza para chave
      const catalogName = MATERIAL_CATALOG[nk];     // Busca no catálogo
      const finalName = catalogName || step3;       // Catálogo ou nome corrigido
      
      // Se houve QUALQUER mudança, sugere correção
      if (finalName !== mat && rmAcc(finalName).toUpperCase() !== rmAcc(mat).toUpperCase().trim()) {
        const reasons = [];
        if (step1 !== mat) reasons.push('limpeza');
        if (step2 !== step1) reasons.push('ortografia');
        if (step3 !== step2) reasons.push('singular');
        if (catalogName) reasons.push('catálogo');
        
        issues.push({
          type: 'rename', catIdx, itemIdx, original: rawMat, item,
          suggested: finalName,
          reason: reasons.length ? '📝 ' + reasons.join(' + ') : 'Padronização do nome'
        });
      } else if (step1 !== mat) {
        // Apenas junk removal (caso acento/case seja igual mas tinha lixo)
        issues.push({
          type: 'rename', catIdx, itemIdx, original: rawMat, item,
          suggested: autoDisplayName(nk, step1),
          reason: 'Anotação desnecessária removida'
        });
      }
    });
  });
  return issues;
}
```

### ✏️ SUBSTITUIR POR:

```js
      // ═══ FASE 3: NORMALIZAÇÃO COMPLETA ═══
      // Limpa junk + corrige ortografia + singulariza + busca catálogo
      const step1 = cleanMaterialJunk(mat);        // Remove (URGENTE), aspas, traços
      const step2 = fixSpelling(step1);             // Corrige ortografia
      const step3 = singularizeMaterial(step2);     // Plural → singular
      const nk = normMat(step3);                    // Normaliza para chave
      const catalogName = MATERIAL_CATALOG[nk];     // Busca no catálogo
      const finalName = catalogName || step3;       // Catálogo ou nome corrigido

      if (finalName === mat) return; // nada mudou

      // ── DIFERENÇA TRIVIAL → aplicar SILENCIOSAMENTE no item, sem modal ──
      if (_diferencaTrivial(finalName, mat)) {
        item.material = finalName;
        issues._silentlyFixed = (issues._silentlyFixed || 0) + 1;
        return;
      }

      // ── Mudança SUBSTANTIVA → vai pro modal ─────────────────────────
      const reasons = [];
      if (step1 !== mat)   reasons.push('limpeza');
      if (step2 !== step1) reasons.push('ortografia');
      if (step3 !== step2) reasons.push('singular');
      if (catalogName)     reasons.push('catálogo');

      issues.push({
        type: 'rename', catIdx, itemIdx, original: rawMat, item,
        suggested: finalName,
        reason: reasons.length ? '📝 ' + reasons.join(' + ') : 'Padronização do nome'
      });
    });
  });
  return issues;
}
```

> **O que mudou:** quando `finalName` difere de `mat` apenas por acento, maiúscula/minúscula, plural/singular ou conectivos (DE/DA/DO etc.), a correção é aplicada direto em `item.material` e contada em `issues._silentlyFixed` — sem aparecer no modal. Só sobe pro modal o que tem mudança real (ortografia diferente, item totalmente diferente do catálogo, etc).

---

## 🩹 PATCH 3 — Banner no modal mostrando quantas correções foram silenciosas

**Onde:** abra `js/modules/materiais/modal-revisao-itens.js`, dentro da função `showPreRegDialog`, logo no começo onde monta o HTML do header. Procure por algo parecido com:

### 🔍 ENCONTRAR (o trecho exato pode variar — procure pelo header com 🔍):

```js
  let h = '<div style="max-width:680px;margin:0 auto">';
  h += `
    <div style="text-align:center;margin-bottom:14px">
      <div style="font-size:32px;margin-bottom:4px">🔍</div>
      <h2 style="font-size:16px;font-weight:800;margin:0">Revisão antes de Registrar</h2>`;
```

### ✏️ ADICIONAR logo ANTES dessa linha do `let h = ...`:

```js
  // Banner de "auto-corrigidos" — preenchido por detectItemIssues
  const silentlyFixed = issues?._silentlyFixed || 0;

  // Se nada visível e nada silencioso, finaliza direto sem abrir modal
  const visibleCount = (issues || []).length;
  if (visibleCount === 0) {
    if (silentlyFixed > 0) {
      _toast?.(`✨ ${silentlyFixed} correção(ões) automática(s) aplicada(s).`, 'green');
    }
    onConfirm?.(true, []);
    return;
  }
```

E DEPOIS do `<h2>Revisão antes de Registrar</h2>` (procure essa linha), **adicione** o banner verde:

```js
  if (silentlyFixed > 0) {
    h += `
      <div style="display:inline-flex;align-items:center;gap:6px;background:#ecfdf5;
                  border:1px solid #a7f3d0;color:#065f46;border-radius:999px;
                  padding:4px 12px;margin-top:8px;font-size:11px;font-weight:700">
        ✨ ${silentlyFixed} correção(ões) automática(s) aplicada(s)
        <span style="font-weight:400;color:#047857">
          (acentos, maiúsc/minúsc, plural)
        </span>
      </div>`;
  }
```

> Ajuste o nome da variável `_toast` conforme estiver no seu modal (no original você usa `_toast` setado via `deps`).

---

## 🩹 PATCH 4 — Data do pedido automática

### 4.1 — Adicionar função utilitária

**Onde:** no `separacao.js`, em qualquer lugar próximo das outras funções utilitárias (ex: depois de `function today(){...}`):

```js
function setupDataPedidoAuto() {
  const input = document.getElementById('rDate');
  if (!input) return;
  // Sempre força hoje (Teresina UTC−3, sem horário de verão — getDate() local funciona)
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = String(hoje.getMonth() + 1).padStart(2, '0');
  const dia = String(hoje.getDate()).padStart(2, '0');
  input.value = `${ano}-${mes}-${dia}`;
  // Bloqueia edição
  input.readOnly = true;
  input.style.background = '#f1f5f9';
  input.style.cursor = 'not-allowed';
  input.title = 'Data automática (dia atual)';
  // Remove aviso se houver
  const w = document.getElementById('rDateWarn');
  if (w) w.style.display = 'none';
}
```

### 4.2 — Chamar a função quando a aba "req" abrir

**Onde:** dentro da função `goTab(t)`. Procure pelas linhas de despacho:

### 🔍 ENCONTRAR:

```js
  if(t==='ps') renderPS();
  else if(t==='es') renderES();
```

### ✏️ SUBSTITUIR POR:

```js
  if(t==='req') setupDataPedidoAuto();
  else if(t==='ps') renderPS();
  else if(t==='es') renderES();
```

### 4.3 — Chamar também no boot (caso o usuário entre direto na aba req)

**Onde:** dentro da função `initSeparacao()`. Procure por:

### 🔍 ENCONTRAR:

```js
  try { populateUnidadesSelect(); } catch (e) { console.error(e); }
  try { applySeparacaoRoleUI(); } catch (e) { console.error(e); }
```

### ✏️ ADICIONAR depois delas (mantendo o padrão try/catch):

```js
  try { setupDataPedidoAuto(); } catch (e) { console.error(e); }
```

### 4.4 — Atualizar a data automaticamente após registrar (para a próxima requisição)

**Onde:** dentro da função `doRegistrar`, no final, junto com a limpeza dos campos. Procure por:

### 🔍 ENCONTRAR:

```js
  document.getElementById('rU').selectedIndex=0;document.getElementById('rO').value='';
  document.getElementById('detectInfo').innerHTML='<span style="color:var(--muted);font-size:12px">Anexe a planilha...</span>';
  document.getElementById('bR').disabled=true;
```

### ✏️ ADICIONAR depois dessas linhas:

```js
  setupDataPedidoAuto();
```

### 4.5 — (Opcional) Usar `#rDate` como fonte da data, em vez do nome do arquivo

Hoje seu `doRegistrar()` ignora o `#rDate` e calcula `dtReq` do nome/conteúdo do arquivo. Se quiser que a data preenchida automaticamente seja a oficial:

### 🔍 ENCONTRAR em `doRegistrar`:

```js
  const fy = new Date().getFullYear();
  const per = (tmpParsed && tmpParsed._rows) ? bestPeriod(tmpParsed._rows, tmpParsed.fileName) : parsePeriodFromFileName(tmpParsed.fileName);
  const fin = finalizePeriod(per, fy);
  const dtReq = fin?.ws ? new Date(fin.ws + 'T12:00:00') : new Date();
```

### ✏️ SUBSTITUIR POR:

```js
  const fy = new Date().getFullYear();
  const per = (tmpParsed && tmpParsed._rows) ? bestPeriod(tmpParsed._rows, tmpParsed.fileName) : parsePeriodFromFileName(tmpParsed.fileName);
  const fin = finalizePeriod(per, fy);
  // Prioriza a data preenchida no formulário (sempre hoje, automática);
  // se ela faltar por algum motivo, cai no período do arquivo, e por fim em new Date().
  const rDateVal = document.getElementById('rDate')?.value;
  const dtReq = rDateVal
    ? new Date(rDateVal + 'T12:00:00')
    : (fin?.ws ? new Date(fin.ws + 'T12:00:00') : new Date());
```

> **Recomendação:** aplique 4.5 só se a data do pedido (recebimento da requisição) é diferente do período coberto pela planilha. Se forem a mesma coisa, mantenha como está.

---

## 🩹 PATCH 5 — Padronização: melhorias pequenas (já está integrada com o catálogo)

Sua aba Padronização (`renderCorrecaoItens`) já está bem feita — usa `MATERIAL_CATALOG`, `MAT_ALIASES`, `CAT_ALIASES`, `STD_CATEGORIES` e `classifyCategory`. Sugestões pequenas:

### 5.1 — Atalho "Auto-classificar todas as categorias não mapeadas"

Na aba Categorias do `renderFixCategorias`, adicione um botão geral no topo:

```js
h += '<div style="display:flex;justify-content:flex-end;margin-bottom:12px">'
  + '<button class="btn btn-p btn-sm" onclick="autoClassifyAllCategories()" '
  + 'title="Para cada categoria detectada que ainda não tem regra, aplica a classificação automática">'
  + '🤖 Auto-classificar todas (' + filtered.filter(([k]) => !CAT_ALIASES[k]).length + ')'
  + '</button></div>';
```

E a função correspondente (em qualquer lugar do arquivo):

```js
async function autoClassifyAllCategories() {
  if (getUserRole() !== 'admin') { toast('Apenas admin.', 'red'); return; }
  const allCats = scanAllCategories();
  let n = 0;
  allCats.forEach((data, key) => {
    if (CAT_ALIASES[key]) return;
    const namesArr = [...data.names.entries()].sort((a, b) => b[1] - a[1]);
    const matched = classifyCategory(namesArr[0][0]);
    if (matched) { CAT_ALIASES[key] = matched.name; n++; }
  });
  if (!n) { toast('Nada para classificar.', 'green'); return; }
  if (!confirm(`Auto-classificar ${n} categoria(s)? Você pode revisar depois.`)) return;
  const ok = await saveMatAliases();
  if (ok) { invalidateAggCache(); toast(`${n} categoria(s) classificada(s).`, 'green'); renderCorrecaoItens(); }
}
```

E exporte: dentro do `EXPORTS = { ... }` em `initSeparacao()`, adicione `autoClassifyAllCategories`.

---

## 📋 Sugestões adicionais (sem patch — só recomendações)

Em ordem de impacto:

1. **Validação de quantidade negativa/zero/absurda** no `editQty` da ficha. Hoje aceita qualquer string.
2. **Detecção de duplicata na mesma requisição** antes de registrar (mesmo `normMat` aparecendo 2× nas categorias).
3. **`localStorage` de "itens recentes" da unidade** — ajuda autocomplete na próxima planilha.
4. **Confirmação ao sair com dados não salvos** (`window.beforeunload` checando `r.__dirty`).
5. **Indicador de loading ao abrir aba `db`** — em bancos grandes (>500 arquivos) trava por 2-3s sem feedback.
6. **Atalhos de teclado globais**: `Ctrl+N` nova requisição, `/` foca busca, `Esc` fecha modal (Esc já existe pra ficha).
7. **Memo do filtro de Padronização** — hoje o `_fixSearchTerm` se perde se o usuário muda de aba e volta.
8. **Botão "Aplicar todas as renames" no modal** quando há muitas — já consta no `modal-revisao-itens.js` que entreguei antes.
9. **Histórico de quem alterou o catálogo** — quando admin cria uma regra `MAT_ALIASES`, gravar `updatedBy` por entrada (hoje grava só global).
10. **Backup automático semanal** — `DataStore.exportAll()` rodando agendado, salvando JSON num campo do Firestore (`backups/YYYY-WW`).

---

## ✅ Resumo do que cada patch resolve

| Patch | Pedido do usuário | Status |
|---|---|---|
| 1 + 2 | Modal só mostra correções relevantes (não plural/case/acento) | ✅ |
| 3 | Banner verde no modal contando o que foi auto-corrigido | ✅ |
| 4 | Data do pedido preenchida automaticamente | ✅ |
| 5 | Padronização integrada com catálogo | ⚠️ Já está integrada — sugestões opcionais |
| Lista final | Mais melhorias úteis | 📝 10 sugestões |
