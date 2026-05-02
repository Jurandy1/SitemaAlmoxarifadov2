# RESPOSTA: Sim, pode começar. Aqui está o mapeamento exato.

## DECISÃO: Opção B — `window.` para funções globais

Como o _INDEX_ATUALIZADO.html tem 177 funções e ~55 onclick/onchange/onkeyup inline, refatorar tudo para addEventListener seria semanas de trabalho. A abordagem correta é:

```javascript
// No final do separacao.js, expor TUDO que o HTML chama:
const GLOBAL_FUNCS = {
  goTab, registrar, pegarParaSeparar, entregarReq, abrirFicha, fecharFicha,
  marcarPronto, marcarProntoLista, printReq, printFicha, cancelarReq,
  renderBuracos, renderUnificar, buildPainel, gerarRelatorio, exportarCSV,
  handleFile, handleHistFiles, ck, okModal, closeModal, showModal,
  editEntryYear, editEntryPeriod, removeHistEntry, openEditor, closeEditor,
  saveEditor, edRemoveItem, edAddItem, edAddCat, clearHistDB, removeDuplicatesAuto,
  recalcAllDates, exportBackup, importBackup, goToFile, goPage, onModeChange,
  clearFilters, clearPanFilters, clearYears, selAllYears, clearAllAliases,
  doUnifMerge, toggleUnifSel, removeAlias, openPrintBuracos, doPrintBuracos,
  showOrigemUnidade, showOrigemCategoria, renderRelatorio,
  PAGE_STATE, // necessário para onkeyup="PAGE_STATE.ps=1;..."
  debouncedRenderPS, debouncedRenderES, debouncedRenderPE, debouncedRenderHI
};
Object.entries(GLOBAL_FUNCS).forEach(([k, v]) => { window[k] = v; });
```

Isso é a forma padrão de migrar apps com onclick inline para ESM. Funciona no Vite sem problema.

---

## MAPEAMENTO EXATO: O que entra onde

### HTML: O que REMOVER do `index.html`

Remover **TUDO** entre (e incluindo):
```html
<div id="content-materiais" class="fade-in hidden">
  ...tudo aqui dentro (aba Entrega de Materiais)...
</div> <!-- Fim de content-materiais -->
```

Isso inclui: sub-nav-materiais, subview-lancar-materiais, subview-para-separar, subview-em-separacao, subview-pronto-entrega, subview-historico-entregues.

**NÃO remover** os modais globais (separador-modal, finalizar-entrega-modal, almoxarifado-responsavel-modal) — eles não serão mais usados pelo sistema novo (o sistema novo tem seus próprios modais), mas mantê-los não causa conflito.

### HTML: O que INSERIR no `index.html`

Inserir no lugar do content-materiais removido:

```html
<div id="content-materiais" class="fade-in hidden">
  <div class="separacao-module">
    <!-- INSERIR AQUI: Linhas 412-690 do _INDEX_ATUALIZADO.html -->
    <!-- Começa em <div class="tabs"> e vai até o último </div> antes do <script> -->
    <!-- EXCLUIR: a topbar (linha 411) — o sistema principal já tem topbar -->
    <!-- EXCLUIR: backup/restaurar buttons da topbar — mover para dentro de uma aba -->
    <!-- INCLUIR: os modais fichaModal (linha 666-689) e modal (linha 690) -->
    <!-- INCLUIR: editorModal (linha 4770-4781) -->
  </div>
</div>
```

**Mapa linha a linha do _INDEX_ATUALIZADO.html**:

| Linhas | Conteúdo | Ação |
|--------|----------|------|
| 1-9 | `<head>`, meta, idb-keyval CDN | **IGNORAR** (head já existe) |
| 10-409 | `<style>` CSS completo | **MOVER** para `style.css` com `.separacao-module` prefix |
| 410 | `<body>` | **IGNORAR** |
| 411 | Topbar (SEMCAS Almoxarifado, Backup, Restaurar) | **ADAPTAR** — não usar topbar, colocar Backup/Restaurar como botões dentro da aba Relatório |
| 412-423 | `<div class="tabs">` com 9 abas | **INSERIR** dentro do content-materiais |
| 424-665 | 9 `<div class="view">` (req, ps, es, pe, hi, bur, unif, pan, rel) | **INSERIR** |
| 666-689 | Modal fichaModal (ficha de separação A4) | **INSERIR** |
| 690 | Modal genérico (input) | **INSERIR** |
| 691-4769 | `<script>` com todo o JS | **EXTRAIR** para `separacao.js` |
| 4770-4781 | Modal editorModal (editor de planilha) | **INSERIR** |
| 4782 | `</body></html>` | **IGNORAR** |

### HTML: Conflitos de ID para resolver

O sistema novo usa IDs simples que podem conflitar com o sistema existente. Adicionar prefixo `sep-` a TODOS os IDs do HTML novo:

| ID original | ID renomeado | Motivo |
|-------------|-------------|--------|
| `td` | `sep-td` | Conflita com possível ID global |
| `modal` | `sep-modal` | Genérico demais |
| `fi` | `sep-fi` | Input file requisição |
| `fname` | `sep-fname` | Nome do arquivo |
| Etc. | `sep-*` | Previne conflitos |

**OU** (mais fácil): como todo o HTML novo fica dentro de `<div class="separacao-module">`, usar `document.querySelector('.separacao-module #td')` em vez de `document.getElementById('td')`. Mas o mais seguro é prefixar.

**IMPORTANTE**: Os IDs das sub-abas (`tab-req`, `tab-ps`, etc.) vão conflitar com o padrão `content-{tab}` do sistema principal. O sistema novo usa `goTab('req')` que faz `getElementById('tab-req')` — isso funciona porque está isolado dentro do separacao-module e o goTab do sistema novo é diferente do switchTab do sistema principal.

### CSS: Namespacing

Copiar TODO o CSS do _INDEX_ATUALIZADO.html (linhas 10-409) para `style.css` e envolver com:

```css
/* ═══ MÓDULO SEPARAÇÃO DE MATERIAIS ═══ */
.separacao-module {
  /* CSS variables (já existem no :root do arquivo novo) */
  --navy: #0f172a;
  --accent: #2563eb;
  --accent2: #1d4ed8;
  --surface: #ffffff;
  --bg: #f8fafc;
  --border: #e2e8f0;
  --text: #1e293b;
  --muted: #64748b;
  --green: #059669;
  --red: #ef4444;
}

.separacao-module .topbar { ... }
.separacao-module .tabs { ... }
.separacao-module .tab { ... }
.separacao-module .view { ... }
/* etc — prefixar TODOS os seletores com .separacao-module */
```

**Exceções** que NÃO devem ser namespaced (são globais por natureza):
- `.modal-ficha` (modal fullscreen que fica fora do container)
- `.editor-modal` (modal fullscreen)
- `.mo` (modal genérico)
- `@media print` (impressão)
- `@keyframes` (animações)

---

## JS: Estrutura do `separacao.js`

```javascript
// js/modules/separacao.js

// ─── IMPORTS FIREBASE ─────────────────────────────────────────
import { 
  addDoc, updateDoc, deleteDoc, doc, setDoc, 
  getDocs, onSnapshot, query, orderBy, serverTimestamp, Timestamp 
} from "firebase/firestore";
import { COLLECTIONS } from "../services/firestore-service.js";
import { auth } from "../services/firestore-service.js";
import { getUserRole } from "../utils/cache.js";
import { showAlert as showGlobalAlert } from "../utils/dom-helpers.js";

// ─── IMPORT XLSX (global, carregado via CDN no head) ──────────
// const XLSX = window.XLSX; // Já disponível globalmente

// ─── ESTADO ───────────────────────────────────────────────────
let REQS = [];
let HIST_DB = [];
let HIST_ALIASES = {};
let nextId = 1;
let curId = null;
let tmpParsed = null;
// ... todas as variáveis de estado do _INDEX_ATUALIZADO.html

// ─── STATUS MAPPING ──────────────────────────────────────────
const STATUS_TO_FIREBASE = {
  'requisitado': 'requisitado',
  'separando': 'separacao',
  'pronto': 'retirada',
  'entregue': 'entregue'
};
const STATUS_FROM_FIREBASE = {
  'requisitado': 'requisitado',
  'separacao': 'separando',
  'retirada': 'pronto',
  'entregue': 'entregue'
};

// ─── DATASTORE REPLACEMENT ───────────────────────────────────
// Substituir DataStore.get/set/del por Firestore

async function loadReqsFromFirestore() {
  // Ler de controleMateriais e converter para formato REQS
  // Documentos com _version:2 → converter para objeto REQS com items detalhados
  // Documentos sem _version → converter para formato legado (items como texto)
}

async function saveReqToFirestore(req) {
  const firebaseStatus = STATUS_TO_FIREBASE[req.status] || req.status;
  const docData = {
    _version: 2,
    unidadeNome: req.unidade,
    // Buscar unidadeId da lista de unidades:
    unidadeId: findUnidadeId(req.unidade),
    tipoUnidade: classifyUnit(req.unidade)?.id?.toUpperCase() || 'OUTROS',
    tipoMaterial: (req.tipos || [])[0]?.toLowerCase() || 'outros',
    tiposMaterial: req.tipos || [],
    formato: req.formato,
    fileName: req.fileName,
    status: firebaseStatus,
    itemsMap: req.items || {},
    // Gerar resumo texto para compatibilidade com Dashboard:
    itens: generateItemsSummary(req.items),
    responsavelLancamento: req.resp,
    responsavelSeparador: req.separador,
    responsavelRecebimento: req.retiradoPor,
    dataRequisicao: req.dt ? Timestamp.fromDate(new Date(req.dt)) : serverTimestamp(),
    dataInicioSeparacao: req.status !== 'requisitado' ? serverTimestamp() : null,
    dataRetirada: (req.status === 'pronto' || req.status === 'entregue') ? serverTimestamp() : null,
    dataEntrega: req.status === 'entregue' ? serverTimestamp() : null,
    registradoEm: serverTimestamp()
  };
  
  if (req._firestoreId) {
    // Atualizar documento existente
    await updateDoc(doc(COLLECTIONS.materiais, req._firestoreId), docData);
  } else {
    // Criar novo documento
    const docRef = await addDoc(COLLECTIONS.materiais, docData);
    req._firestoreId = docRef.id;
  }
}

function generateItemsSummary(items) {
  if (!items) return '';
  return Object.values(items)
    .filter(i => i.material)
    .slice(0, 10)
    .map(i => i.material + (i.qtdSolicitada ? ' ' + i.qtdSolicitada : ''))
    .join(', ')
    + (Object.keys(items).length > 10 ? '...' : '');
}

async function loadHistDBFromFirestore() {
  // onSnapshot em COLLECTIONS.semcasHistDB
  // Cada documento → entrada no array HIST_DB
}

async function saveHistEntryToFirestore(entry) {
  const docData = {
    ...entry,
    uploadedBy: auth.currentUser?.email || 'Sistema',
    uploadedAt: serverTimestamp(),
    source: entry.source || 'upload'
  };
  
  if (entry._firestoreId) {
    await setDoc(doc(COLLECTIONS.semcasHistDB, entry._firestoreId), docData);
  } else {
    const ref = await addDoc(COLLECTIONS.semcasHistDB, docData);
    entry._firestoreId = ref.id;
    entry.id = ref.id;
  }
}

async function saveAliasesToFirestore() {
  await setDoc(doc(COLLECTIONS.semcasAliases, 'config'), {
    aliases: HIST_ALIASES,
    updatedAt: serverTimestamp(),
    updatedBy: auth.currentUser?.email || 'Sistema'
  });
}

// ─── PERMISSÕES ──────────────────────────────────────────────
function checkPermission(action) {
  const role = getUserRole();
  const perms = {
    'registrar': ['admin'],
    'separar': ['admin', 'editor'],
    'editar_ficha': ['admin', 'editor'],
    'marcar_pronto': ['admin', 'editor'],
    'entregar': ['admin', 'editor'],
    'remover': ['admin'],
    'upload_hist': ['admin', 'editor'],
    'editar_hist': ['admin', 'editor'],
    'remover_hist': ['admin'],
    'editar_alias': ['admin', 'editor'],
    'visualizar': ['admin', 'editor', 'anon']
  };
  return (perms[action] || []).includes(role);
}

// ─── TODO O CÓDIGO DO _INDEX_ATUALIZADO.html ─────────────────
// Colar aqui TODAS as ~177 funções, adaptando:
// 1. Trocar DataStore.get('HIST_DB') → usar variável HIST_DB em memória (alimentada pelo listener)
// 2. Trocar DataStore.set('HIST_DB', ...) → chamar saveHistEntryToFirestore() ou batch save
// 3. Trocar DataStore.get('HIST_ALIASES') → usar variável HIST_ALIASES em memória
// 4. Trocar DataStore.set('HIST_ALIASES', ...) → chamar saveAliasesToFirestore()
// 5. Trocar saveReqs() → chamar saveReqToFirestore() para cada req alterada
// 6. Trocar loadHistDB()/loadReqs() → listeners Firestore (onSnapshot)
// 7. Adicionar checkPermission() antes de ações que exigem permissão

// [COLAR TODAS AS FUNÇÕES AQUI]

// ─── INICIALIZAÇÃO ───────────────────────────────────────────
let _unsubHistDB = null;
let _unsubAliases = null;

export function initSeparacaoListeners() {
  // Listener para HIST_DB
  _unsubHistDB = onSnapshot(
    query(COLLECTIONS.semcasHistDB),
    snap => {
      HIST_DB = snap.docs.map(d => ({ ...d.data(), id: d.id, _firestoreId: d.id }));
      sanitizeHistDB();
      // Re-render se aba ativa
    }
  );
  
  // Listener para Aliases
  _unsubAliases = onSnapshot(
    query(COLLECTIONS.semcasAliases),
    snap => {
      const data = snap.docs.find(d => d.id === 'config')?.data();
      HIST_ALIASES = data?.aliases || {};
    }
  );
  
  // Listener para Requisições (controleMateriais)
  // JÁ EXISTE no auth.js — reutilizar o cache do materiais
  // Converter documentos do cache para formato REQS quando a aba é acessada
}

export function onSeparacaoTabChange() {
  // Chamado quando o usuário clica na aba "Entrega Materiais"
  // Converte getMateriais() → REQS (com mapeamento de status)
  syncReqsFromCache();
  renderAll();
}

function syncReqsFromCache() {
  const materiaisCache = getMateriais(); // Do cache existente
  REQS = materiaisCache
    .filter(m => !m.deleted)
    .map(m => {
      if (m._version === 2) {
        // Documento do sistema novo
        return {
          id: m.id,
          _firestoreId: m.id,
          unidade: m.unidadeNome,
          tipos: m.tiposMaterial || [m.tipoMaterial],
          formato: m.formato || 'padrao',
          resp: m.responsavelLancamento,
          obs: m.itens,
          dt: m.dataRequisicao?.toDate?.() || new Date(),
          fileName: m.fileName,
          items: m.itemsMap || {},
          status: STATUS_FROM_FIREBASE[m.status] || m.status,
          separador: m.responsavelSeparador,
          retiradoPor: m.responsavelRecebimento,
          dtEntrega: m.dataEntrega?.toDate?.() || null,
          _isLegacy: false
        };
      } else {
        // Documento legado (sistema antigo)
        return {
          id: m.id,
          _firestoreId: m.id,
          unidade: m.unidadeNome,
          tipos: [m.tipoMaterial || 'Outros'],
          formato: 'legacy',
          resp: m.responsavelLancamento,
          obs: m.itens,
          dt: m.registradoEm?.toDate?.() || new Date(),
          fileName: null,
          items: {},  // Sem itens detalhados
          status: STATUS_FROM_FIREBASE[m.status] || m.status,
          separador: m.responsavelSeparador,
          retiradoPor: m.responsavelRecebimento,
          dtEntrega: m.dataEntrega?.toDate?.() || null,
          _isLegacy: true
        };
      }
    });
  
  nextId = REQS.length ? Math.max(...REQS.map(r => typeof r.id === 'number' ? r.id : 0)) + 1 : 1;
}

export function renderSeparacao() {
  syncReqsFromCache();
  renderAll(); // Função existente do _INDEX_ATUALIZADO.html
}

// ─── EXPOR FUNÇÕES GLOBAIS PARA ONCLICK ──────────────────────
const GLOBAL_FUNCS = {
  // Abas
  goTab,
  // Requisição
  registrar, handleFile, ck,
  // Fila / Separação
  pegarParaSeparar, abrirFicha, fecharFicha, marcarPronto, marcarProntoLista,
  printReq, printFicha, entregarReq, cancelarReq,
  // Modal
  okModal, closeModal, showModal,
  // Buracos
  renderBuracos, openPrintBuracos, doPrintBuracos,
  // Relatório
  gerarRelatorio, renderRelatorio, exportarCSV, onModeChange,
  clearFilters, clearYears, selAllYears,
  // Banco de Dados
  handleHistFiles, editEntryYear, editEntryPeriod, removeHistEntry,
  openEditor, closeEditor, saveEditor, edRemoveItem, edAddItem, edAddCat,
  clearHistDB, removeDuplicatesAuto, recalcAllDates,
  // Unificar
  renderUnificar, toggleUnifSel, doUnifMerge, clearAllAliases, removeAlias,
  // Painel
  buildPainel, clearPanFilters,
  // Navegação
  goToFile, goPage,
  // Backup
  exportBackup, importBackup,
  // Origem
  showOrigemUnidade, showOrigemCategoria,
  // Estado (necessário para onkeyup="PAGE_STATE.ps=1;...")
  get PAGE_STATE() { return PAGE_STATE; },
  debouncedRenderPS, debouncedRenderES, debouncedRenderPE, debouncedRenderHI
};
Object.entries(GLOBAL_FUNCS).forEach(([k, v]) => { window[k] = v; });
```

---

## INTEGRAÇÃO NO `app.js`

```javascript
// Adicionar imports:
import { initSeparacaoListeners, onSeparacaoTabChange, renderSeparacao } from "./modules/separacao.js";

// No setupApp(), adicionar:
initSeparacaoListeners();

// No switchTab handler (já existente), adicionar case:
// Quando tab === 'materiais':
//   onSeparacaoTabChange();
```

---

## INTEGRAÇÃO NO `auth.js`

Dentro de `initFirestoreListeners()`:

```javascript
// Adicionar após os listeners existentes:
addListener(query(COLLECTIONS.semcasHistDB), snap => {
  // O separacao.js lida com isso internamente via seu próprio onSnapshot
  // MAS se quiser centralizar no auth.js, pode fazer:
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  setSemcasHistDB(data); // Novo setter no cache.js
});

addListener(query(COLLECTIONS.semcasAliases), snap => {
  const config = snap.docs.find(d => d.id === 'config')?.data();
  setSemcasAliases(config?.aliases || {}); // Novo setter no cache.js
});
```

---

## INTEGRAÇÃO NO `firestore-service.js`

```javascript
// No COLLECTIONS object, adicionar:
semcasHistDB: collection(db, `${BASE_PATH}/semcasHistDB`),
semcasAliases: collection(db, `${BASE_PATH}/semcasAliases`),
```

---

## INTEGRAÇÃO NO `cache.js`

```javascript
// Adicionar:
let _semcasHistDB = [];
let _semcasAliases = {};

export function getSemcasHistDB() { return _semcasHistDB; }
export function setSemcasHistDB(data) { _semcasHistDB = data; }
export function getSemcasAliases() { return _semcasAliases; }
export function setSemcasAliases(data) { _semcasAliases = data; }
```

---

## INTEGRAÇÃO NO `dom-helpers.js`

Adicionar novos elementos ao `findDOMElements()`:

```javascript
// Separação module elements (dentro do .separacao-module)
// NÃO precisa mapear cada ID se usar querySelector('.separacao-module #id')
// Mas se quiser, adicionar os principais:
['#sep-fi', 'sepFileInput'],
['#sep-fname', 'sepFileName'],
// etc.
```

**OU** (mais prático): o separacao.js faz seus próprios `document.getElementById()` internamente, sem depender do DOM_ELEMENTS do sistema principal. Isso é mais limpo e evita conflitos.

---

## INTEGRAÇÃO NO `firestore.rules`

```
// Adicionar DENTRO do match /artifacts/{appId}/public/data:

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

## INTEGRAÇÃO NO `importador.js` (backup/restore)

Adicionar às coleções de backup:

```javascript
const COL_HIST_DB = collection(db, `${BASE_PATH}/semcasHistDB`);
const COL_ALIASES = collection(db, `${BASE_PATH}/semcasAliases`);

// No export backup:
const snapHistDB = await getDocs(COL_HIST_DB);
const snapAliases = await getDocs(COL_ALIASES);
// Incluir no payload

// No import backup:
// Restaurar semcasHistDB e semcasAliases
```

---

## SEQUÊNCIA DE IMPLEMENTAÇÃO (ordem importa)

1. **firestore-service.js** — adicionar 2 coleções (2 minutos)
2. **firestore.rules** — adicionar 2 matches (2 minutos)
3. **cache.js** — adicionar getters/setters (2 minutos)
4. **style.css** — copiar CSS com namespace (30 minutos)
5. **index.html** — substituir content-materiais + adicionar SheetJS CDN (20 minutos)
6. **separacao.js** — extrair JS + adaptar DataStore → Firestore (2-3 horas — parte maior)
7. **auth.js** — adicionar 2 listeners (5 minutos)
8. **app.js** — importar e inicializar (5 minutos)
9. **Testar** retrocompatibilidade com dados antigos (30 minutos)
10. **Deploy** e testar no Firebase Hosting (10 minutos)

---

## PODE COMEÇAR A IMPLEMENTAÇÃO.
