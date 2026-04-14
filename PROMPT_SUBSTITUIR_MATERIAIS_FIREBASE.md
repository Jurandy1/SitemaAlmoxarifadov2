# PROMPT: Substituir "Entrega de Materiais" pelo novo Sistema de Separação com Firebase

---

## MISSÃO

Você vai **substituir** a aba "Entrega de Materiais" (`content-materiais`) no sistema Firebase existente pelo novo sistema de separação de materiais que está no arquivo `_INDEX_ATUALIZADO.html`. O novo sistema é muito mais completo — tem ficha de separação item a item, parsers de planilha, relatórios, análise de buracos, etc.

**REGRA ABSOLUTA**: Os dados antigos que já existem no Firestore na coleção `controleMateriais` (histórico de entregas, materiais em "pronto para entrega") **NÃO PODEM SER PERDIDOS**. O sistema novo deve ser retrocompatível com eles.

---

## ARQUIVOS QUE VOCÊ VAI RECEBER

1. **`_INDEX_ATUALIZADO.html`** — O novo sistema completo (~4800 linhas, arquivo único HTML+CSS+JS). Este é o sistema que deve SUBSTITUIR a aba "Entrega de Materiais".

2. **`index.html`** — O sistema principal Firebase com todas as abas (Água, Gás, Materiais, Social, Gestão, etc.)

3. **`js/app.js`** — Orquestrador principal que inicializa módulos

4. **`js/firebase-config.js`** — Configuração Firebase com `APP_ID` e `firebaseConfig`

5. **`js/modules/materiais.js`** — Módulo atual de "Entrega de Materiais" que será **substituído**

6. **`js/modules/auth.js`** — Autenticação e listeners Firestore

7. **`js/modules/dashboard.js`** — Dashboard que lê de `controleMateriais`

8. **`js/utils/dom-helpers.js`** — Utilitários DOM, `findDOMElements()`, `renderPermissionsUI()`

9. **`firestore.rules`** — Regras de segurança atuais

10. **`storage.rules`** — Regras do Storage

---

## ENTENDENDO OS DOIS SISTEMAS

### Sistema Firebase atual (aba "Entrega de Materiais")

**Fluxo**: Requisição → Separação → Pronto p/ Entrega → Histórico

**Coleção Firestore**: `artifacts/{APP_ID}/public/data/controleMateriais`

**Documento típico**:
```javascript
{
  id: "autogerado",
  unidadeId: "abc123",
  unidadeNome: "CRAS Centro",
  tipoUnidade: "CRAS",
  tipoMaterial: "alimenticio",       // tipo ÚNICO (string)
  itens: "texto livre com observações", // SEM detalhamento por item
  status: "requisitado",             // → "separacao" → "retirada" → "entregue"
  dataRequisicao: Timestamp,
  dataSeparacao: null,
  dataInicioSeparacao: null,
  dataRetirada: null,
  dataEntrega: null,
  responsavelLancamento: "Maria",
  responsavelSeparador: null,
  responsavelEntrega: null,
  responsavelRecebimento: null,
  registradoEm: serverTimestamp(),
  fileURL: "https://...",            // anexo no Storage
  storagePath: "artifacts/.../pedido.pdf",
  downloadInfo: { count: 0, lastDownload: null, blockedUntil: null }
}
```

**Status possíveis**: `requisitado`, `separacao`, `retirada`, `entregue`

**Quem faz o quê**:
- **Admin**: Cria requisições, inicia separação, finaliza entrega, remove
- **Editor**: Inicia separação, marca pronto, finaliza entrega
- **Anon**: Só visualiza

### Sistema novo (`_INDEX_ATUALIZADO.html`)

**Fluxo**: Requisição (com upload de planilha) → Para Separar → Em Separação (ficha A4 editável item a item) → Pronto → Entrega (alimenta banco histórico)

**Persistência atual**: IndexedDB via `idb-keyval` com chaves `semcas_HIST_DB`, `semcas_HIST_ALIASES`, `semcas_REQS`

**Objeto REQS típico** (que vai virar documento Firestore):
```javascript
{
  id: 1,                           // auto-increment local (no Firebase será docId)
  unidade: "CRAS Centro",          // nome da unidade
  tipos: ["Alimentício", "Limpeza"], // MÚLTIPLOS tipos detectados da planilha
  formato: "padrao",               // formato da planilha detectado
  resp: "Maria",                   // responsável pelo lançamento
  obs: "Pedido semanal",           // observação geral
  dt: Date,                        // data da requisição
  fileName: "ALMOXARIFADO_14_A_20_OUT.xlsx",
  parsed: { /* objeto completo do parser */ },
  items: {                         // MAPA de itens detalhados (a grande diferença)
    "1": {
      id: 1, material: "ARROZ", unidade: "KG",
      qtdSolicitada: "14", qtdAtendida: "14",
      status: "atendido",  // nao_atendido | atendido | parcial | sem_estoque | excedido
      tipo: "Alimentício", obs: ""
    },
    "2": {
      id: 2, material: "FEIJÃO", unidade: "KG",
      qtdSolicitada: "6", qtdAtendida: "4",
      status: "parcial", tipo: "Alimentício", obs: "Faltou"
    }
    // ... dezenas de itens
  },
  status: "requisitado",           // → "separando" → "pronto" → "entregue"
  separador: null,
  retiradoPor: null,
  dtEntrega: null,
  dbAdded: false                   // se já alimentou o banco histórico
}
```

**HIST_DB típico** (banco de planilhas para relatório):
```javascript
{
  id: "timestamp_0",
  fileName: "ALMOXARIFADO_14_A_20_OUT.xlsx",
  weekStart: "2023-10-14",    // string ISO date
  weekEnd: "2023-10-20",
  weekLabel: "14/10 a 20/10/2023",
  year: 2023,
  month: 10,
  yearAssumed: false,
  discrepancy: null,
  units: [{
    unitName: "Residência Inclusiva",
    rawUnit: "RI",
    categories: [{
      catName: "1 - ENLATADOS",
      items: [
        { material: "ÓLEO DE SOJA", qty: 3 },
        { material: "ARROZ", qty: 14 }
      ]
    }]
  }]
}
```

**Status no sistema novo**: `requisitado`, `separando`, `pronto`, `entregue`

**9 abas internas**: Requisição, Para Separar, Em Separação, Pronto, Histórico, Painel, Buracos, Unificar, Relatório

---

## O QUE VOCÊ DEVE FAZER — PASSO A PASSO

### PASSO 1: Criar o módulo `js/modules/separacao.js`

Extrair TODO o JavaScript do `_INDEX_ATUALIZADO.html` (entre as tags `<script>`) e transformar em um módulo ES que:

1. **Importa** do Firebase:
```javascript
import { addDoc, updateDoc, deleteDoc, doc, setDoc, onSnapshot, query, orderBy, serverTimestamp, Timestamp } from "firebase/firestore";
import { COLLECTIONS } from "../services/firestore-service.js";
import { auth } from "../services/firestore-service.js";
import { getUserRole } from "../utils/cache.js";
import { showAlert } from "../utils/dom-helpers.js";
```

2. **Substitui** o DataStore (IndexedDB) por Firestore:
```javascript
// ANTES (IndexedDB):
await DataStore.set('HIST_DB', HIST_DB);
const data = await DataStore.get('HIST_DB');

// DEPOIS (Firestore):
// Para HIST_DB — cada entrada é um documento na coleção semcasHistDB
await setDoc(doc(COLLECTIONS.semcasHistDB, entryId), entryData);
// Leitura via onSnapshot (listener em tempo real)

// Para HIST_ALIASES — documento único
await setDoc(doc(COLLECTIONS.semcasAliases, 'config'), { aliases: HIST_ALIASES, updatedAt: serverTimestamp() });

// Para REQS — usar a coleção controleMateriais EXISTENTE (não criar nova)
```

3. **Mapeia os status** entre os dois sistemas:
```javascript
// Ao GRAVAR no Firestore:
const STATUS_TO_FIREBASE = {
  'requisitado': 'requisitado',  // igual
  'separando': 'separacao',      // DIFERENTE
  'pronto': 'retirada',          // DIFERENTE
  'entregue': 'entregue'         // igual
};

// Ao LER do Firestore:
const STATUS_FROM_FIREBASE = {
  'requisitado': 'requisitado',
  'separacao': 'separando',
  'retirada': 'pronto',
  'entregue': 'entregue'
};
```

4. **Exporta** as funções necessárias:
```javascript
export function initSeparacaoListeners() { /* ... */ }
export function renderSeparacao() { /* ... */ }
export function onSeparacaoTabChange() { /* ... */ }
```

### PASSO 2: Adaptar a coleção `controleMateriais`

**NÃO criar nova coleção para requisições**. Usar a mesma `controleMateriais` com campos adicionais:

```javascript
// Documento NOVO (criado pelo sistema novo):
{
  // Campos que já existiam (manter para retrocompatibilidade):
  unidadeId: "abc123",
  unidadeNome: "CRAS Centro",
  tipoUnidade: "CRAS",
  status: "requisitado",  // Usar os nomes do Firebase: requisitado/separacao/retirada/entregue
  registradoEm: serverTimestamp(),
  
  // Campos NOVOS (só em documentos criados pelo sistema novo):
  _version: 2,                    // Flag para saber que é do sistema novo
  tiposMaterial: ["Alimentício", "Limpeza"],  // ARRAY (em vez de string única)
  tipoMaterial: "alimenticio",    // Manter para compatibilidade com Dashboard
  fileName: "ALMOXARIFADO_14_A_20_OUT.xlsx",
  parsedData: { /* categorias e estrutura da planilha */ },
  itemsMap: {                     // Mapa detalhado de itens
    "1": { material: "ARROZ", unidade: "KG", qtdSolicitada: "14", qtdAtendida: "", status: "nao_atendido", tipo: "Alimentício", obs: "" },
    // ...
  },
  formato: "padrao",
  responsavelLancamento: "Maria",
  responsavelSeparador: null,
  responsavelRecebimento: null,
  dataRequisicao: Timestamp,
  dataInicioSeparacao: null,
  dataRetirada: null,
  dataEntrega: null,
  fileURL: null,
  storagePath: null,
  
  // Campos que o sistema antigo usava mas o novo não precisa:
  itens: "ARROZ 14kg, FEIJÃO 6kg...",  // Gerar resumo texto para o Dashboard
  downloadInfo: { count: 0 }
}
```

**Documentos antigos** (_version não existe ou _version: 1): renderizar no formato simples (texto livre).

**Documentos novos** (_version: 2): renderizar com ficha detalhada item a item.

### PASSO 3: Criar novas coleções Firestore

Adicionar ao `firestore-service.js`:

```javascript
// No objeto COLLECTIONS, adicionar:
semcasHistDB: collection(db, `${BASE_PATH}/semcasHistDB`),
semcasAliases: collection(db, `${BASE_PATH}/semcasAliases`),
```

Adicionar ao `firestore.rules`:

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

### PASSO 4: Adicionar listeners no `auth.js`

Dentro de `initFirestoreListeners()`, adicionar:

```javascript
// Banco histórico de planilhas
addListener(query(COLLECTIONS.semcasHistDB, orderBy("year", "desc")), snap => {
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  setSemcasHistDB(data);  // Nova função no cache.js
  // Renderizar aba separação se estiver ativa
});

// Aliases de unificação
addListener(query(COLLECTIONS.semcasAliases), snap => {
  const data = snap.docs.map(d => d.data());
  const aliases = data[0]?.aliases || {};
  setSemcasAliases(aliases);  // Nova função no cache.js
});
```

### PASSO 5: Adaptar o HTML em `index.html`

1. **Substituir** todo o `<div id="content-materiais">` pelo HTML do `_INDEX_ATUALIZADO.html` (apenas o conteúdo entre `<body>` e `</body>`, sem o `<head>`, sem o DataStore, sem o `<script>` que vai para o módulo JS).

2. **Renomear** o id para manter consistência: `<div id="content-materiais" class="fade-in hidden">`

3. **Adicionar** o CSS do `_INDEX_ATUALIZADO.html` ao `style.css`, com namespace `.separacao-module` para não conflitar com o CSS existente.

4. **Adicionar** SheetJS ao head do `index.html`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
```

5. **Manter** o botão no sidebar exatamente como está:
```html
<button class="nav-btn nav-item" data-tab="materiais">
    <i data-lucide="truck"></i>
    <span>Entrega Materiais</span>
</button>
```

### PASSO 6: Adaptar o Dashboard

O `dashboard.js` lê de `controleMateriais` para mostrar contadores e cards. Como estamos usando a MESMA coleção, o Dashboard **continua funcionando** sem mudanças na lógica de contagem.

A única adaptação é na renderização dos cards: se o documento tem `_version: 2`, mostrar os tipos como pills coloridos (como o sistema novo faz). Se não tem, mostrar como antes.

```javascript
// No renderDashboardMateriaisProntos:
const tipoDisplay = m._version === 2 
  ? (m.tiposMaterial || []).join(', ')
  : (m.tipoMaterial || 'N/D');
```

### PASSO 7: Retrocompatibilidade com dados antigos

Criar uma função que detecta o formato do documento:

```javascript
function isNewFormat(doc) {
  return doc._version === 2 || doc.itemsMap != null;
}

function renderMaterialRow(doc) {
  if (isNewFormat(doc)) {
    return renderNewFormatRow(doc);  // Ficha detalhada com itens
  } else {
    return renderLegacyRow(doc);     // Formato antigo (texto livre)
  }
}
```

Para o histórico: documentos antigos com `status: 'entregue'` que NÃO têm `itemsMap` são renderizados com as colunas simples (Unidade, Tipo, Data, Responsáveis). Documentos novos mostram o resumo detalhado.

### PASSO 8: Fluxo de entrega → banco histórico

Quando uma requisição do sistema novo é entregue (status muda para `entregue`), **alimentar automaticamente o `semcasHistDB`**:

```javascript
async function entregarRequisicao(docId, responsaveis) {
  const req = /* buscar documento */;
  
  // 1. Atualizar status no controleMateriais
  await updateDoc(doc(COLLECTIONS.materiais, docId), {
    status: 'entregue',
    dataEntrega: serverTimestamp(),
    responsavelEntrega: responsaveis.almox,
    responsavelRecebimento: responsaveis.unidade
  });
  
  // 2. Alimentar banco histórico (REGRA DE OURO: usa qtdAtendida, não solicitada)
  if (req._version === 2 && req.itemsMap) {
    const histEntry = buildHistEntryFromRequisicao(req);
    if (histEntry && histEntry.units.length > 0) {
      await addDoc(COLLECTIONS.semcasHistDB, {
        ...histEntry,
        source: 'entrega',
        uploadedBy: auth.currentUser?.email || 'Sistema',
        uploadedAt: serverTimestamp()
      });
    }
  }
}
```

**REGRA DE OURO**: O banco histórico usa a quantidade ATENDIDA (não a solicitada). Itens com status `sem_estoque` ou `nao_atendido` vão com qty=0. Isso já está implementado na função `buildHistEntryFromParsed` do `_INDEX_ATUALIZADO.html`.

---

## PONTOS CRÍTICOS — NÃO ALTERAR

### 1. Parsers de planilha (4 formatos)
O sistema tem 4 parsers para 4 formatos reais de planilha usados no SEMCAS. **NÃO simplificar, NÃO unificar, NÃO remover nenhum**:
- `parsePadrao` — Material | Unidade | Qtd Solicitada | Qtd Atendida
- `parseMultiColWb` — Material na col 0, cada unidade em colunas separadas
- `parseMultiSheetWb` — Cada aba da planilha = uma unidade (RI, CAT, POP_RUA)
- `parseStackedBlocks` — "NOME DA UNIDADE:" repetido na mesma aba

### 2. Detecção de datas (11 padrões + sanity checks)
A função `parsePeriodText()` tem 11 padrões regex cuidadosamente testados. A lógica de cruzamento de mês (d1 > d2 = mês anterior) está em TODOS os padrões + `finalizePeriod()` + sanity check universal. **NÃO alterar**.

### 3. Função `looksLikeCategory()`
Previne que itens como ABSORVENTE, SABONETE sejam classificados como categorias. Tem `CAT_KEYWORDS` + `ITEM_BLACKLIST`. **NÃO remover**.

### 4. Sanitização automática
`sanitizeHistDB()` roda no load e corrige datas impossíveis (ws > we). **Manter**.

### 5. Detecção de duplicatas
`buildEntryFingerprint()` compara conteúdo (não nome de arquivo). **Manter**.

### 6. `bestPeriod(rows, fileName)`
Sempre confia no conteúdo da planilha. Se o nome do arquivo sugere data diferente, sinaliza discrepância mas NÃO substitui. **NÃO inverter esta lógica**.

---

## PERMISSÕES (seguir o padrão existente)

| Ação | Admin | Editor | Anon |
|------|-------|--------|------|
| Registrar requisição (upload planilha) | ✅ | ❌ | ❌ |
| Iniciar separação (informar separador) | ✅ | ✅ | ❌ |
| Editar ficha (qtd atendida por item) | ✅ | ✅ | ❌ |
| Marcar como pronto | ✅ | ✅ | ❌ |
| Finalizar entrega | ✅ | ✅ | ❌ |
| Remover requisição | ✅ | ❌ | ❌ |
| Upload planilha banco histórico | ✅ | ✅ | ❌ |
| Editar planilha no banco | ✅ | ✅ | ❌ |
| Remover planilha do banco | ✅ | ❌ | ❌ |
| Editar aliases (unificar) | ✅ | ✅ | ❌ |
| Visualizar relatórios/buracos/painel | ✅ | ✅ | ✅ |

---

## CHECKLIST FINAL

Após implementar, verificar:

- [ ] Documentos antigos com `status: 'entregue'` aparecem no Histórico
- [ ] Documentos antigos com `status: 'retirada'` aparecem em "Pronto"
- [ ] Dashboard continua mostrando contadores corretos (Em Preparação, Disponível p/ Retirada)
- [ ] Modo TV continua funcionando (lê de controleMateriais)
- [ ] Nova requisição (upload planilha) cria documento com `_version: 2` e `itemsMap`
- [ ] Ficha de separação A4 funciona com edição item a item
- [ ] Entrega alimenta automaticamente o semcasHistDB
- [ ] Relatório de consumo funciona com dados do semcasHistDB
- [ ] Análise de buracos funciona com período completo do ano
- [ ] Unificação de unidades persiste em semcasAliases
- [ ] Permissões respeitadas (admin/editor/anon)
- [ ] Backup/Restaurar inclui semcasHistDB e semcasAliases
- [ ] SheetJS carrega sem erro (importação de .xlsx/.xls/.ods)
- [ ] Impressão A4 (ficha e buracos) funciona

---

## ESTRUTURA DE ARQUIVOS FINAL

```
index.html              ← Substituir <div id="content-materiais">
style.css               ← Adicionar CSS do sistema novo (namespaced)
js/
  app.js                ← Importar e inicializar separacao.js
  firebase-config.js    ← Sem mudança
  modules/
    auth.js             ← Adicionar listeners para semcasHistDB e semcasAliases
    dashboard.js        ← Adaptar para _version:2 (opcional)
    materiais.js        ← SUBSTITUIR por separacao.js (ou renomear)
    separacao.js         ← NOVO: Todo o JS do _INDEX_ATUALIZADO.html como módulo
    agua-control.js     ← Sem mudança
    gas-control.js      ← Sem mudança
    social-control.js   ← Sem mudança
    ...
  services/
    firestore-service.js ← Adicionar COLLECTIONS.semcasHistDB e semcasAliases
    storage-service.js   ← Sem mudança
  utils/
    cache.js            ← Adicionar get/set para semcasHistDB e semcasAliases
    dom-helpers.js      ← Adicionar novos DOM_ELEMENTS do sistema novo
    ...
firestore.rules         ← Adicionar regras para semcasHistDB e semcasAliases
```

---

## EXEMPLO DE COMO O DOCUMENTO FICA NO FIRESTORE

### Requisição nova (sistema novo, _version: 2):
```json
{
  "_version": 2,
  "unidadeId": "cras_centro_id",
  "unidadeNome": "CRAS Centro",
  "tipoUnidade": "CRAS",
  "tipoMaterial": "alimenticio",
  "tiposMaterial": ["Alimentício", "Limpeza", "Higiene"],
  "formato": "padrao",
  "fileName": "ALMOXARIFADO_14_A_20_OUT.xlsx",
  "status": "requisitado",
  "itemsMap": {
    "1": {"id":1, "material":"ARROZ", "unidade":"KG", "qtdSolicitada":"14", "qtdAtendida":"", "status":"nao_atendido", "tipo":"Alimentício", "obs":""},
    "2": {"id":2, "material":"FEIJÃO CARIOCA", "unidade":"KG", "qtdSolicitada":"3", "qtdAtendida":"", "status":"nao_atendido", "tipo":"Alimentício", "obs":""}
  },
  "itens": "ARROZ 14kg, FEIJÃO CARIOCA 3kg, SABÃO EM PÓ 2un...",
  "responsavelLancamento": "Maria Silva",
  "responsavelSeparador": null,
  "responsavelEntrega": null,
  "responsavelRecebimento": null,
  "dataRequisicao": "Timestamp",
  "dataInicioSeparacao": null,
  "dataRetirada": null,
  "dataEntrega": null,
  "registradoEm": "serverTimestamp()",
  "fileURL": null,
  "storagePath": null
}
```

### Requisição antiga (sistema anterior, sem _version):
```json
{
  "unidadeId": "cras_centro_id",
  "unidadeNome": "CRAS Centro",
  "tipoUnidade": "CRAS",
  "tipoMaterial": "alimenticio",
  "itens": "Pedido semanal de alimentos",
  "status": "entregue",
  "responsavelLancamento": "João",
  "responsavelSeparador": "Pedro",
  "responsavelEntrega": "Pedro",
  "responsavelRecebimento": "Ana",
  "dataEntrega": "Timestamp",
  "registradoEm": "Timestamp"
}
```

Ambos convivem na MESMA coleção. O campo `_version` (ou a presença de `itemsMap`) determina qual renderizador usar.
