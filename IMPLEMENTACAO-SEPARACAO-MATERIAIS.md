# GUIA DE IMPLEMENTAÇÃO — Sistema de Separação e Entrega de Materiais SEMCAS

## CONTEXTO DO PROJETO

Sistema web de Controle de Almoxarifado da SEMCAS (Secretaria Municipal da Criança e Assistência Social — Prefeitura de São Luís/MA). Aplicação web com Firebase/Firestore, controle de água, gás, materiais, assistência social, com roles (admin/editor/anon).

### Arquitetura existente
- **Frontend**: HTML + CSS + JS vanilla (módulos ES6)
- **Backend**: Firebase Firestore + Firebase Storage + Firebase Auth
- **Dashboard**: Chart.js na TV ao vivo via onSnapshot
- **Relatórios**: jsPDF para PDFs

### Arquivos do sistema existente envolvidos
```
index.html                          — HTML principal com sidebar, modais, todas as abas
style.css                           — CSS do design system
js/app.js                           — Orquestrador principal
js/firebase-config.js               — Config Firebase
js/services/firestore-service.js    — Inicialização Firestore, COLLECTIONS
js/services/storage-service.js      — Upload/delete de arquivos
js/utils/cache.js                   — Estado global (getters/setters)
js/utils/dom-helpers.js             — Manipulação DOM, alertas, tabs
js/utils/formatters.js              — Formatação de datas, strings
js/modules/materiais.js             — Módulo de materiais (requisição, separação, entrega)
js/modules/dashboard.js             — Dashboard com gráficos Chart.js
js/modules/relatorios.js            — Geração de PDF com jsPDF
```

### Fluxo atual do materiais.js (que será SUBSTITUÍDO)
O módulo atual tem funções como `handleMateriaisSubmit()`, `openSeparadorModal()`, `handleSalvarSeparador()`, `handleMarcarRetirada()`. O upload vai pro Firebase Storage e a referência no Firestore. O novo sistema substitui esse fluxo por um mais completo com parser de planilha e ficha A4 interativa.

---

## O QUE IMPLEMENTAR

### 1. Fluxo de Separação de Materiais (substituir o fluxo atual)

O fluxo tem 4 etapas com status no Firestore:

```
REQUISITADO → SEPARANDO → PRONTO → ENTREGUE
```

**Requisição**: Admin seleciona unidade, anexa planilha Excel (.xlsx/.ods). O parser detecta automaticamente os tipos de material (Expediente, Limpeza, Higiene, Alimentício, Descartável) a partir das categorias da planilha. Também auto-detecta o nome da unidade.

**Para Separar**: Fila FIFO. Separador pega o PRIMEIRO da fila, informa o nome, imprime a ficha A4. A requisição vai automaticamente para "Em Separação".

**Em Separação**: Lista de requisições sendo separadas. Separador pode editar a ficha (quantidades, status por item). Quando terminar, clica "Pronto p/ Entrega".

**Pronto p/ Entrega**: Lista de materiais aguardando retirada. Quando alguém vem buscar, informa o nome de quem retirou → move para Histórico.

### 2. Ficha A4 Interativa
- Cabeçalho institucional: "PREFEITURA DE SÃO LUÍS" / "SECRETARIA MUNICIPAL DA CRIANÇA E ASSISTÊNCIA SOCIAL – SEMCAS" / "COORDENAÇÃO DE ADMINISTRAÇÃO E PATRIMÔNIO"
- Parser de planilha Excel/ODS robusto (testado com 8 planilhas reais)
- Status por item: Não Atendido (vazio), Atendido, Parcial, Sem Estoque (00.)
- Auto-detecta "Parcial" quando qtd atendida < solicitada
- Impressão via nova janela (window.print bloqueado no iframe)
- Assinaturas: Separado por / Entregue por / Recebido por (assinatura física)

### 3. Integração com Google Sheets (relatórios)
- Ao finalizar entrega, envia dados para Google Sheets via Apps Script
- 1 linha por item atendido (facilita tabela dinâmica e filtros)
- 1 aba por ano (Entregas_2026, Entregas_2027...)

### 4. Painel Gerencial de Relatórios
- Integrado como sub-aba em Materiais
- Puxa dados do Google Sheets
- Alertas estratégicos, KPIs, rankings, gráficos Chart.js

### 5. Card no Dashboard TV
- Card "Separação de Materiais" com contadores ao vivo

### 6. Otimizações Firestore (manter 100% grátis)
- Listeners por aba visível (unsubscribe ao trocar)
- limit() em todas as queries
- Doc agregado stats/dashboard
- Histórico com paginação (getDocs em vez de onSnapshot)

---

## SCHEMA FIRESTORE

### Coleção: `entregas` (NOVA)
```javascript
// entregas/{id}
{
  unidade: "CRAS Bacanga",           // string
  tipos: ["Expediente", "Limpeza"],  // array de strings (detectados automaticamente)
  separador: "João",                 // string
  retiradoPor: "Maria (motorista)",  // string
  lancadoPor: "Admin",              // string
  fileName: "CRASBACANGA.xlsx",     // string
  dataRequisicao: Timestamp,        // quando foi lançada
  dataEntrega: Timestamp,           // quando foi finalizada (serverTimestamp)
  status: "entregue",               // 'requisitado' | 'separando' | 'pronto' | 'entregue'
  obs: "",                          // string opcional
  itens: [                          // array de objetos
    {
      material: "Papel A4",
      unidade: "Resma",
      qtdSolicitada: "3",
      qtdAtendida: "1",
      status: "parcial",            // 'atendido' | 'parcial' | 'sem_estoque' | 'nao_atendido'
      tipo: "Expediente",           // detectado da categoria
      obs: ""
    },
    // ... mais itens
  ]
}
```

### Coleção: `stats` (doc agregado para dashboard)
```javascript
// stats/dashboard
{
  materiaisParaSeparar: 5,
  materiaisEmSeparacao: 3,
  materiaisProntos: 2,
  entregasHoje: 8,
  ultimaAtualizacao: Timestamp
}
```

### Regras Firestore (adicionar)
```
match /entregas/{entregaId} {
  allow read: if request.auth != null;
  allow create: if request.auth != null && request.auth.token.role in ['admin', 'editor'];
  allow update: if request.auth != null && request.auth.token.role in ['admin', 'editor'];
  allow delete: if false;
}
match /stats/{docId} {
  allow read: if true;
  allow write: if request.auth != null && request.auth.token.role in ['admin', 'editor'];
}
```

---

## GOOGLE SHEETS — Apps Script

### Código do Apps Script (colar em Extensões > Apps Script na planilha)

```javascript
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ano = new Date().getFullYear();
  var nomeAba = 'Entregas_' + ano;

  var sheet = ss.getSheetByName(nomeAba);
  if (!sheet) {
    sheet = ss.insertSheet(nomeAba);
    sheet.appendRow([
      'Data', 'Unidade', 'Tipo', 'Categoria', 'Material',
      'Unid', 'Solicitada', 'Atendida', 'Status',
      'Separador', 'Retirado por', 'Obs'
    ]);
    sheet.setFrozenRows(1);
    // Formatar cabeçalho
    var header = sheet.getRange(1, 1, 1, 12);
    header.setFontWeight('bold');
    header.setBackground('#0f172a');
    header.setFontColor('#ffffff');
  }

  data.itens.forEach(function(item) {
    sheet.appendRow([
      data.data,
      data.unidade,
      item.tipo || '',
      item.categoria || '',
      item.material,
      item.unidade_med || '',
      item.qtdSolicitada,
      item.qtdAtendida,
      item.status,
      data.separador,
      data.retiradoPor,
      item.obs || ''
    ]);
  });

  return ContentService.createTextOutput(JSON.stringify({status: 'ok'}))
    .setMimeType(ContentService.MimeType.JSON);
}

// Endpoint para ler dados (usado pelo painel de relatórios)
function doGet(e) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ano = e.parameter.ano || new Date().getFullYear();
  var sheet = ss.getSheetByName('Entregas_' + ano);

  if (!sheet) {
    return ContentService.createTextOutput(JSON.stringify({data: [], error: 'Aba não encontrada'}))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var rows = data.slice(1).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });

  // Filtros opcionais
  if (e.parameter.unidade) rows = rows.filter(function(r) { return r.Unidade === e.parameter.unidade; });
  if (e.parameter.mes) rows = rows.filter(function(r) { return r.Data && r.Data.indexOf(e.parameter.mes) > -1; });

  return ContentService.createTextOutput(JSON.stringify({data: rows}))
    .setMimeType(ContentService.MimeType.JSON);
}
```

**Publicar como Web App:**
1. Extensões > Apps Script > colar o código
2. Implantar > Nova implantação > Tipo: App da Web
3. Executar como: Eu / Quem tem acesso: Qualquer pessoa
4. Copiar a URL gerada (ex: `https://script.google.com/macros/s/AKfyc.../exec`)

---

## ALTERAÇÕES POR ARQUIVO

### 1. `js/services/firestore-service.js`

**ADICIONAR** a coleção `entregas` e `stats` ao objeto COLLECTIONS:

```javascript
import { collection } from 'firebase/firestore';

export const COLLECTIONS = {
  // ... coleções existentes
  entregas: collection(db, 'entregas'),
  stats: collection(db, 'stats'),
};
```

### 2. `js/utils/cache.js`

**ADICIONAR** getter/setter para entregas:

```javascript
let _entregas = [];
export function getEntregas() { return _entregas; }
export function setEntregas(data) { _entregas = data; }
```

### 3. `index.html`

**ADICIONAR** SheetJS CDN no `<head>`:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
```

**ADICIONAR** sub-abas no `#content-materiais` para o fluxo de separação (Requisição, Para Separar, Em Separação, Pronto p/ Entrega, Histórico, Relatórios).

**ADICIONAR** modal da ficha A4 antes de `</body>`.

### 4. `js/modules/materiais.js`

Este é o arquivo principal. SUBSTITUIR o fluxo de separação existente pelo novo. As funções que precisam existir:

```javascript
// PARSER DE PLANILHA (copiar do protótipo standalone)
// Todas essas funções já estão prontas e testadas com 8 planilhas reais:
// - parseXLS(rows) — parser principal
// - detectTipo(catName) — detecta tipo de material pela categoria
// - extractNum(s) — extrai número de strings como "1 PCT", "3 UND"
// - isNoStock(qa) — detecta sem estoque ("00.", "0", "nt")
// - isHeader(r), isFooter(r), isCategory(r), isSkipLine(f)

// REGISTRO
// - registrar() — cria requisição no Firestore com status 'requisitado'

// SEPARAÇÃO
// - pegarParaSeparar() — pega primeiro da fila, pede nome, imprime, status → 'separando'
// - abrirFicha(id) — abre ficha A4 para edição
// - renderFicha() — gera HTML da ficha A4 interativa
// - cycleStatus(id, el) — cicla status: nao_atendido → atendido → parcial → sem_estoque
// - editQty(id, val) — edita quantidade com auto-detecção de parcial
// - autoDetect(id) — auto-detecta status baseado na quantidade

// ENTREGA
// - marcarPronto() / marcarProntoLista(id) — status → 'pronto', converte nao_atendido → atendido
// - entregarReq(id) — pede nome de quem retirou, status → 'entregue'
// - salvarEntregaFirestore(reqData) — salva no Firestore
// - enviarGoogleSheets(reqData) — envia para Google Sheets (fire-and-forget)

// IMPRESSÃO
// - imprimirReq(id) — abre nova janela com conteúdo A4
// - a4Header(titulo, unidade, fileName) — cabeçalho institucional
// - signaturas(sep, ent, rec) — bloco de assinaturas

// LISTENERS
// - initEntregasListener() — onSnapshot na coleção entregas
```

### 5. `js/modules/dashboard.js`

**ADICIONAR** card de separação de materiais:

```javascript
function renderCardSeparacao() {
  // Ler do doc stats/dashboard (1 onSnapshot apenas)
  // Mostrar: Aguardando | Separando | Prontos | Entregas Hoje
}
```

### 6. `js/modules/relatorios.js`

**ADICIONAR** relatório de entregas com dados do Google Sheets:

```javascript
async function carregarDadosSheets(ano, filtros) {
  const url = SHEETS_URL + '?ano=' + ano;
  const resp = await fetch(url);
  const data = await resp.json();
  return data.data;
}
```

---

## FUNÇÃO salvarEntregaFirestore — CÓDIGO COMPLETO

```javascript
import { addDoc, doc, updateDoc, serverTimestamp, increment } from 'firebase/firestore';
import { COLLECTIONS } from '../services/firestore-service.js';

const SHEETS_URL = 'https://script.google.com/macros/s/SEU_ID_AQUI/exec';

async function salvarEntregaFirestore(reqData) {
  const entregaDoc = {
    unidade: reqData.unidade,
    tipos: reqData.tipos,
    separador: reqData.separador,
    retiradoPor: reqData.retiradoPor,
    lancadoPor: reqData.resp,
    fileName: reqData.fileName,
    dataRequisicao: reqData.dt,
    dataEntrega: serverTimestamp(),
    status: 'entregue',
    obs: reqData.obs || '',
    itens: Object.values(reqData.items).map(item => ({
      material: item.material,
      unidade: item.unidade,
      qtdSolicitada: item.qtdSolicitada,
      qtdAtendida: item.qtdAtendida,
      status: item.status,
      tipo: item.tipo || 'Outros',
      obs: item.obs || ''
    }))
  };

  // 1. Salvar no Firestore
  await addDoc(COLLECTIONS.entregas, entregaDoc);

  // 2. Atualizar doc agregado do dashboard
  const statsRef = doc(COLLECTIONS.stats, 'dashboard');
  await updateDoc(statsRef, {
    materiaisProntos: increment(-1),
    entregasHoje: increment(1),
    ultimaAtualizacao: serverTimestamp()
  });

  // 3. Enviar para Google Sheets (fire-and-forget, não trava)
  enviarGoogleSheets(reqData);
}

function enviarGoogleSheets(reqData) {
  const payload = {
    data: new Date().toLocaleDateString('pt-BR'),
    unidade: reqData.unidade,
    separador: reqData.separador,
    retiradoPor: reqData.retiradoPor,
    itens: Object.values(reqData.items).map(item => ({
      tipo: item.tipo || 'Outros',
      categoria: '', // nome da categoria se disponível
      material: item.material,
      unidade_med: item.unidade,
      qtdSolicitada: item.qtdSolicitada,
      qtdAtendida: item.qtdAtendida,
      status: item.status,
      obs: item.obs || ''
    }))
  };

  fetch(SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(() => {}); // silencioso
}
```

---

## PARSER DE PLANILHA — CÓDIGO COMPLETO E TESTADO

Testado com 8 planilhas reais de diferentes unidades (CT Bacanga, CRAS Maracanã, CRAS Turu, CREAS Cidade Operária, CREAS Coroadinho, PROCAD, CRAS Bacanga, CT Cidade Operária).

### Formatos que o parser reconhece:
- Qtd atendida com texto: "1 PCT", "3 UND", "1 RESMA", "1L", "10 und"
- Sem estoque: "00.", "0", "nt"
- Categorias numeradas: "1 - ALIMENTOS PROCESSADOS"
- Categorias sem número: "MATERIAL DE EXPEDIENTE", "ALIMENTOS PROCESSADOS"
- Categorias mistas: "MATERIAL PCF /SERV. CONVIVENCIA"
- Data colada no nome: "PROCAD: 27/03/2026" → extrai só "PROCAD"
- Cabeçalhos repetidos no meio (headers órfãos)
- Linhas descritivas que não são categorias: "MATERIAL PARA CONSUMO:", "SOLICITAÇÃO DE MATERIAIS:"

### Detecção automática de tipo de material:
```javascript
function detectTipo(catName) {
  const lo = catName.toLowerCase();
  if (/expediente|escrit[oó]rio|papelaria/i.test(lo)) return 'Expediente';
  if (/limpeza|lavar/i.test(lo)) return 'Limpeza';
  if (/higiene|higi[eê]n/i.test(lo)) return 'Higiene';
  if (/alimento|alimentício|alimenticio|processado|lanche|scfv|comida|cozinha/i.test(lo)) return 'Alimentício';
  if (/descart[aá]vel|descartavel/i.test(lo)) return 'Descartável';
  if (/pcf|conviv[eê]ncia|convivencia|servi[çc]o/i.test(lo)) return 'Atividades';
  return 'Outros';
}
```

### Status dos itens:
- **nao_atendido**: campo de quantidade atendida vazio (sem informação)
- **atendido**: quantidade atendida >= solicitada
- **parcial**: quantidade atendida > 0 mas < solicitada
- **sem_estoque**: planilha marcou "00." ou "0" ou "nt" (item não existe no estoque)

### Parser completo:
```javascript
function n(v) { return (v == null ? '' : String(v)).trim(); }

function extractNum(s) {
  if (!s) return 0;
  s = n(s);
  if (s === '00.' || s === '0' || s.toLowerCase() === 'nt') return 0;
  const m = s.match(/^(\d+[\.,]?\d*)/);
  return m ? parseFloat(m[1].replace(',', '.')) : 0;
}

function isNoStock(qa) {
  if (!qa) return false;
  const s = n(qa);
  return s === '00.' || s === '0' || s.toLowerCase() === 'nt';
}

function isHeader(r) {
  const f = n(r[0]).toLowerCase();
  return f === 'material' || f === 'materiais' || f === 'item';
}

function isFooter(r) {
  const lo = n(r[0]).toLowerCase();
  return lo.includes('separado por') || lo.includes('entregue por') ||
         lo.includes('recebido por') || lo.includes('atenciosamente');
}

function isSkipLine(f) {
  const lo = f.toLowerCase();
  return lo.includes('nome da unidade') ||
    /^material\s+para\s+consumo/i.test(lo) ||
    /^solicitação\s+de\s+materia/i.test(lo) ||
    /^solicitacao\s+de\s+materia/i.test(lo) ||
    /^\s*data\s*:/i.test(lo) ||
    /^\d{1,2}[\/\.]\d{1,2}[\/\.]\d{2,4}\s*$/.test(f) ||
    lo === 'material para consumo:' ||
    lo === 'material para consumo';
}

function isCategory(r) {
  const f = n(r[0]), lo = f.toLowerCase();
  if (!f) return false;
  if (/^\d+\s*[-–—.]\s*.+/.test(f)) return true;
  if (/^materia(l|is)\s+(de\s+|para\s+|pcf|descart)/i.test(f)) return true;
  if (/^alimentos?\s/i.test(f)) return true;
  const filled = r.filter(c => n(c)).length;
  if (filled === 1 && f.length > 5 && !/^\d/.test(f) && f === f.toUpperCase() &&
      !isSkipLine(f) && !isFooter(r)) return true;
  if (filled === 1 && f.length > 8 && !/^\d/.test(f) &&
      !isSkipLine(f) && !isFooter(r) && !isHeader(r)) return true;
  return false;
}

function parseXLS(rows) {
  // Extrair nome da unidade
  const un = (() => {
    for (const r of rows) {
      const f = n(r[0]);
      if (f.toLowerCase().includes('nome da unidade')) {
        const m = f.match(/nome\s+da\s+unidade\s*:\s*(.+)/i);
        if (m) {
          let name = m[1].trim();
          name = name.replace(/\s*\d{1,2}[\/\.]\s*\d{1,2}[\/\.]\s*\d{2,4}\s*$/, '').trim();
          name = name.replace(/[\s:]+$/, '').trim();
          return name;
        }
      }
      if (f && /^(CT|CRAS|CREAS|ABRIGO|SEDE|PROCAD)\s*.+/i.test(f) &&
          !f.toLowerCase().includes('nome da unidade')) return f;
    }
    return 'Unidade';
  })();

  const cats = [];
  let cat = null, id = 0;

  for (let ri = 0; ri < rows.length; ri++) {
    const row = rows[ri], r = row.map(c => c == null ? '' : c);
    if (r.every(c => !n(c))) continue;
    const f = n(r[0]);
    if (isFooter(r) || isSkipLine(f)) continue;
    if (isHeader(r)) {
      if (cat && cat.items.length > 0) {
        cat = { name: 'Outros Itens', items: [] };
        cats.push(cat);
      }
      continue;
    }
    if (isCategory(r)) {
      cat = { name: f, items: [] };
      cats.push(cat);
      continue;
    }
    const mat = f;
    if (!mat) continue;
    const unid = n(r[1]), qs = n(r[2]), qa = n(r[3]);
    if (!unid && !qs && !qa) continue;
    if (!cat) { cat = { name: 'Itens', items: [] }; cats.push(cat); }
    id++;
    const noStock = isNoStock(qa);
    const numS = extractNum(qs), numA = noStock ? 0 : extractNum(qa);
    let st = 'nao_atendido';
    if (noStock) st = 'sem_estoque';
    else if (numA > 0 && numS > 0 && numA < numS) st = 'parcial';
    else if (numA > 0) st = 'atendido';
    cat.items.push({
      id, material: mat, unidade: unid,
      qtdSolicitada: qs || '0', qtdAtendida: noStock ? '' : n(qa),
      status: st, obs: '', tipo: cat ? detectTipo(cat.name) : 'Outros'
    });
  }

  const filtered = cats.filter(c => c.items.length > 0);
  filtered.forEach(c => { c.tipo = detectTipo(c.name); });
  const tipos = [...new Set(filtered.map(c => c.tipo))];
  return {
    unitName: un,
    categories: filtered.length ? filtered : [{ name: 'Itens', items: [], tipo: 'Outros' }],
    tipos: tipos.length ? tipos : ['Outros']
  };
}
```

---

## CABEÇALHO A4 INSTITUCIONAL

```html
<div style="text-align:center;margin-bottom:6px;line-height:1.3">
  <div style="font-size:13px;font-weight:800;text-transform:uppercase">
    Prefeitura de São Luís
  </div>
  <div style="font-size:11px;font-weight:700;text-transform:uppercase">
    Secretaria Municipal da Criança e Assistência Social – SEMCAS
  </div>
  <div style="font-size:10px;font-weight:600;color:#475569;text-transform:uppercase">
    Coordenação de Administração e Patrimônio
  </div>
</div>
```

---

## OTIMIZAÇÕES FIRESTORE (para manter grátis)

### Uso atual (7 dias): 167K leituras, 406 escritas, 44 listeners pico

### Técnica 1: Listeners por aba visível
```javascript
let currentUnsub = null;
function onTabChange(tab) {
  if (currentUnsub) currentUnsub();
  if (tab === 'materiais') {
    currentUnsub = onSnapshot(query(COLLECTIONS.materiais, orderBy('data','desc'), limit(50)), callback);
  }
}
```

### Técnica 2: limit() em todas as queries
```javascript
// ANTES: onSnapshot(COLLECTIONS.materiais, callback)
// DEPOIS:
const q = query(COLLECTIONS.materiais, orderBy('data','desc'), limit(50));
onSnapshot(q, callback);
```

### Técnica 3: Doc agregado para dashboard
O dashboard TV ouve APENAS `stats/dashboard` (1 listener em vez de 6):
```javascript
onSnapshot(doc(db, 'stats', 'dashboard'), (snap) => {
  const d = snap.data();
  updateDashboardUI(d);
});
```

### Técnica 4: Histórico com paginação
Usar getDocs + startAfter + limit(20) em vez de onSnapshot:
```javascript
const q = query(COLLECTIONS.entregas, orderBy('dataEntrega','desc'), limit(20));
const snap = await getDocs(q);
// Para próxima página:
const lastDoc = snap.docs[snap.docs.length - 1];
const nextQ = query(COLLECTIONS.entregas, orderBy('dataEntrega','desc'), startAfter(lastDoc), limit(20));
```

---

## PAINEL DE RELATÓRIOS

O painel gerencial fica como sub-aba em Materiais e puxa dados do Google Sheets. Inclui:

### Alertas estratégicos
- Unidades consumindo acima da média
- Itens críticos (alta taxa sem estoque)
- Entregas lentas

### KPIs
- Total de requisições no período
- Itens entregues / solicitados
- Taxa de atendimento (%)
- Total "sem estoque"
- Tempo médio de entrega
- Previsão para próximo mês

### Gráficos (Chart.js)
- Consumo por unidade (barras + linha de média)
- Distribuição por tipo (donut)
- Tendência mensal (barras solicitado vs entregue)
- Velocidade de entrega (donut: rápido/normal/lento)
- Produtividade dos separadores (barras horizontais)
- Taxa de atendimento por unidade (barras horizontais coloridas)

### Tabelas
- Top 10 itens que mais faltam (prioridade de compra)
- Top 10 itens entregues parcialmente
- Ranking completo de unidades (consumo vs média)
- Top 15 materiais mais consumidos
- Unidades que mais demoram para retirar

### Filtros
- Período (mês ou trimestre)
- Unidade
- Tipo de material

---

## PROTÓTIPO STANDALONE FUNCIONANDO

O arquivo `fluxo-separacao-completo.html` é um protótipo 100% funcional do fluxo de separação com dados em memória. Todo o código JS (parser, ficha A4, impressão, modais, status) está pronto para ser extraído e integrado ao sistema Firebase.

O arquivo `relatorios-materiais.html` é o protótipo do painel gerencial com dados de demonstração simulando 3 meses com 12 unidades.

Ambos os arquivos estão anexados a este documento e devem ser usados como referência para a implementação.

---

## LISTA DE UNIDADES CONHECIDAS

CT Bacanga, CT Cidade Operária, CRAS Bacanga, CRAS Maracanã, CRAS Turu, CRAS Cohab, CRAS Vinhais, CRAS Anjo da Guarda, CREAS Cidade Operária, CREAS Coroadinho, CREAS Centro, PROCAD

(A lista completa de unidades deve ser puxada da coleção de unidades existente no Firestore via módulo de gestão)
