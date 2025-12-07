import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, getDoc, doc, updateDoc, arrayUnion, addDoc, serverTimestamp, Timestamp, setDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig, APP_ID } from "./firebase-config.js";

// --- Inicialização Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Referências de Coleções
const BASE_PATH = `artifacts/${APP_ID}/public/data`;
const COL_UNIDADES = collection(db, `${BASE_PATH}/unidades`);
const COL_AGUA_MOV = collection(db, `${BASE_PATH}/controleAgua`);
const COL_GAS_MOV = collection(db, `${BASE_PATH}/controleGas`);
const COL_MATERIAIS = collection(db, `${BASE_PATH}/controleMateriais`);
const COL_ESTOQUE_AGUA = collection(db, `${BASE_PATH}/estoqueAgua`);
const COL_ESTOQUE_GAS = collection(db, `${BASE_PATH}/estoqueGas`);
const COL_USER_ROLES = collection(db, `${BASE_PATH}/userRoles`);
const COL_CESTA_MOV = collection(db, `${BASE_PATH}/socialCestaMov`);
const COL_CESTA_ESTOQUE = collection(db, `${BASE_PATH}/socialCestaEstoque`);
const COL_ENXOVAL_MOV = collection(db, `${BASE_PATH}/socialEnxovalMov`);
const COL_ENXOVAL_ESTOQUE = collection(db, `${BASE_PATH}/socialEnxovalEstoque`);

// Estado Global
let unidadesCache = []; // Lista de unidades do Firestore
let dadosProcessados = []; // Dados extraídos do SQL

function serializeDocData(d) {
    const o = { ...d };
    const ts = [];
    Object.keys(o).forEach(k => {
        const v = o[k];
        if (v && typeof v.toMillis === 'function') { ts.push(k); o[k] = v.toMillis(); }
    });
    if (ts.length > 0) o.__tsKeys = ts;
    return o;
}

function deserializeDocData(o) {
    const d = { ...o };
    const ts = d.__tsKeys || [];
    ts.forEach(k => { if (typeof d[k] === 'number') d[k] = Timestamp.fromMillis(d[k]); });
    delete d.__tsKeys;
    return d;
}

function summarizeCollection(arr) {
    const count = Array.isArray(arr) ? arr.length : 0;
    let min = null, max = null;
    if (count > 0) {
        arr.forEach(it => {
            const candidates = [];
            if (typeof it.data === 'number') candidates.push(it.data);
            if (typeof it.registradoEm === 'number') candidates.push(it.registradoEm);
            const tsKeys = Array.isArray(it.__tsKeys) ? it.__tsKeys : [];
            tsKeys.forEach(k => { if (typeof it[k] === 'number') candidates.push(it[k]); });
            if (candidates.length > 0) {
                const locMin = Math.min.apply(null, candidates);
                const locMax = Math.max.apply(null, candidates);
                min = (min === null) ? locMin : Math.min(min, locMin);
                max = (max === null) ? locMax : Math.max(max, locMax);
            }
        });
    }
    const from = min !== null ? new Date(min).toISOString() : null;
    const to = max !== null ? new Date(max).toISOString() : null;
    return { count, from, to };
}

// --- Mapa de Meses ---
const MESES = {
    'janeiro': 0, 'fevereiro': 1, 'março': 2, 'marco': 2, 'abril': 3, 'maio': 4, 'junho': 5,
    'julho': 6, 'agosto': 7, 'setembro': 8, 'outubro': 9, 'novembro': 10, 'dezembro': 11
};

// --- Autenticação ---
const modalAuth = document.getElementById('auth-modal');
const appContent = document.getElementById('app-content');
const formLogin = document.getElementById('form-login');
const loginMsg = document.getElementById('login-msg');

onAuthStateChanged(auth, (user) => {
    if (user) {
        // Verificar se é admin (simulação simples baseada na existência do user, idealmente verificar claims/roles)
        // Para este importador, vamos apenas permitir o acesso autenticado.
        modalAuth.classList.add('hidden');
        appContent.classList.remove('hidden');
        document.getElementById('user-email').textContent = user.email;
        carregarUnidades();
    } else {
        modalAuth.classList.remove('hidden');
        appContent.classList.add('hidden');
    }
});

formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('input-email').value;
    const password = document.getElementById('input-password').value;
    loginMsg.classList.add('hidden');
    
    try {
        await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
        console.error(error);
        loginMsg.textContent = "Erro ao entrar: Verifique e-mail e senha.";
        loginMsg.classList.remove('hidden');
    }
});

// --- Lógica Principal ---

async function carregarUnidades() {
    try {
        const snap = await getDocs(COL_UNIDADES);
        unidadesCache = snap.docs.map(d => ({ 
            id: d.id, 
            ...d.data(),
            // Garante que aliases seja um array
            aliases: d.data().aliases || [] 
        }));
        console.log(`${unidadesCache.length} unidades carregadas.`);
    } catch (e) {
        alert("Erro ao carregar unidades do sistema: " + e.message);
    }
}

// Utilitário: Normalizar String para comparação (remove acentos, caixa baixa, trim)
function normalizar(str) {
    return str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

// Utilitário: Tentar encontrar unidade compatível
function encontrarUnidade(nomeSql) {
    const nomeBusca = normalizar(nomeSql);

    // 1. Busca Exata por Alias (Prioridade Máxima - Aprendizado)
    const matchAlias = unidadesCache.find(u => 
        u.aliases && u.aliases.some(alias => normalizar(alias) === nomeBusca)
    );
    if (matchAlias) return { unidade: matchAlias, metodo: 'alias' };

    // 2. Busca por Nome Exato ou Contido
    const matchNome = unidadesCache.find(u => normalizar(u.nome) === nomeBusca);
    if (matchNome) return { unidade: matchNome, metodo: 'nome_exato' };

    // 3. Busca Fuzzy Simples (Nome SQL contém Nome Unidade ou vice-versa)
    // Removemos parênteses e números do SQL para tentar achar o núcleo do nome
    const nomeLimpo = nomeBusca.replace(/\(.*\)/g, '').replace(/[0-9-]/g, '').trim();
    
    const matchFuzzy = unidadesCache.find(u => {
        const uNome = normalizar(u.nome);
        return nomeBusca.includes(uNome) || (nomeLimpo.length > 3 && uNome.includes(nomeLimpo));
    });
    
    if (matchFuzzy) return { unidade: matchFuzzy, metodo: 'fuzzy' };

    return null;
}

// --- Processamento do SQL ---

document.getElementById('btn-processar').addEventListener('click', () => {
    const sql = document.getElementById('sql-input').value;
    if (!sql.trim()) { alert("Cole o código SQL primeiro."); return; }

    const anoInput = parseInt(document.getElementById('input-ano').value);
    dadosProcessados = [];

    function stripParens(s) {
        s = s.trim();
        if (s.startsWith('(')) s = s.slice(1);
        if (s.endsWith(')')) s = s.slice(0, -1);
        return s;
    }
    function splitTuple(s) {
        const out = []; let cur = ''; let inQ = false;
        for (let i = 0; i < s.length; i++) {
            const ch = s[i];
            if (ch === "'") { inQ = !inQ; cur += ch; continue; }
            if (ch === ',' && !inQ) { out.push(cur.trim()); cur = ''; continue; }
            cur += ch;
        }
        out.push(cur.trim());
        return out.map(tok => {
            tok = tok.trim();
            if (tok.startsWith("'") && tok.endsWith("'")) tok = tok.slice(1, -1);
            return tok;
        });
    }

    const tuples = sql.match(/\([^;]*?\)/g) || [];
    tuples.forEach(raw => {
        const parts = splitTuple(stripParens(raw));
        const last = parts[parts.length - 1] || '';
        const isDateRef = /^\d{4}-\d{2}-\d{2}$/.test(last);

        if (isDateRef) {
            // Formato com data_referencia: ['categoria','unidade', s1,s2,s3,s4,s5, [total?], 'YYYY-MM-DD']
            const categoria = parts[0];
            const unidadeSql = parts[1];
            const wStart = 2;
            const w1 = parseInt(parts[wStart] || '0');
            const w2 = parseInt(parts[wStart + 1] || '0');
            const w3 = parseInt(parts[wStart + 2] || '0');
            const w4 = parseInt(parts[wStart + 3] || '0');
            const w5 = parseInt(parts[wStart + 4] || '0');
            const semanas = [w1, w2, w3, w4, w5];
            const qtdTotal = semanas.reduce((a, b) => a + b, 0);
            if (qtdTotal === 0) return;
            const dataRefStr = last;
            const resultadoBusca = encontrarUnidade(unidadeSql);
            const dataRef = new Date(dataRefStr);
            const ano = dataRef.getFullYear();
            const mesIdx = dataRef.getMonth();
            dadosProcessados.push({
                dataRefStr,
                ano,
                referenciaMesIdx: mesIdx,
                categoria,
                unidadeSql,
                semanas,
                qtdTotal,
                match: resultadoBusca ? resultadoBusca.unidade : null,
                matchType: resultadoBusca ? resultadoBusca.metodo : null,
                saveAlias: false
            });
        } else {
            // Formato antigo com 'mes' textual: ['Mes','Categoria','Unidade', s1..s5, total]
            if (parts.length < 9) return;
            const mesStr = parts[0];
            const categoria = parts[1];
            const unidadeSql = parts[2];
            const w1 = parseInt(parts[3] || '0');
            const w2 = parseInt(parts[4] || '0');
            const w3 = parseInt(parts[5] || '0');
            const w4 = parseInt(parts[6] || '0');
            const w5 = parseInt(parts[7] || '0');
            const semanas = [w1, w2, w3, w4, w5];
            const qtdTotal = semanas.reduce((a, b) => a + b, 0);
            if (qtdTotal === 0) return;
            const resultadoBusca = encontrarUnidade(unidadeSql);
            dadosProcessados.push({
                mesStr,
                ano: anoInput,
                categoria,
                unidadeSql,
                semanas,
                qtdTotal,
                match: resultadoBusca ? resultadoBusca.unidade : null,
                matchType: resultadoBusca ? resultadoBusca.metodo : null,
                saveAlias: false
            });
        }
    });

    renderPreview();
});

function renderPreview() {
    const tbody = document.getElementById('table-preview');
    tbody.innerHTML = '';
    
    let unknownCount = 0;
    let doubtCount = 0;
    const selectOptions = criarOpcoesUnidades();

    dadosProcessados.forEach((item, index) => {
        const tr = document.createElement('tr');
        const isIdentified = !!item.match;
        if (!isIdentified) unknownCount++;
        if (item.match && item.matchType === 'fuzzy' && !item.confirmed) doubtCount++;

        const iconStatus = isIdentified && !(item.matchType === 'fuzzy' && !item.confirmed)
            ? `<span class="text-green-600"><i data-lucide="check-circle"></i></span>`
            : `<span class="text-amber-600"><i data-lucide="alert-triangle"></i></span>`;

        const sugestaoHtml = item.match 
            ? `<div class="text-sm"><div class="font-medium">${item.match.nome}</div><div class="text-xs text-gray-500">${item.matchType || 'desconhecido'}</div></div>`
            : `<span class="text-xs text-gray-400">—</span>`;

        // Coluna Select Unidade
        const selectHtml = `
            <select class="w-full border rounded p-1 text-sm select-unidade-row ${!isIdentified ? 'border-red-400 bg-red-50' : 'border-gray-300'}" data-index="${index}">
                <option value="">-- Selecione --</option>
                ${selectOptions}
            </select>
        `;

        // Checkbox Memorizar
        // Só habilita se o usuário tiver que selecionar manualmente ou se a detecção for 'fuzzy' (incerta)
        const showMemorize = !isIdentified || item.matchType === 'fuzzy';
        const checkboxHtml = `
            <input type="checkbox" class="checkbox-memorize h-4 w-4 text-blue-600 rounded" 
            data-index="${index}" ${item.saveAlias ? 'checked' : ''} title="Salvar este nome do SQL como alias para a unidade selecionada">
        `;

        const confirmHtml = item.match && item.matchType === 'fuzzy'
            ? `<input type="checkbox" class="checkbox-confirm h-4 w-4 text-amber-600 rounded" data-index="${index}" ${item.confirmed ? 'checked' : ''} title="Confirmar sugestão de unidade">`
            : `<span class="text-xs text-gray-500">OK</span>`;

        tr.innerHTML = `
            <td class="p-3 text-center">${iconStatus}</td>
            <td class="p-3 font-mono text-xs text-gray-700">${item.unidadeSql}</td>
            <td class="p-3">${sugestaoHtml}</td>
            <td class="p-3">${selectHtml}</td>
            <td class="p-3 text-center font-bold text-blue-800">${item.qtdTotal}</td>
            <td class="p-3 text-center">${confirmHtml}</td>
            <td class="p-3 text-center">${checkboxHtml}</td>
        `;

        tbody.appendChild(tr);

        // Pre-selecionar valor no select
        if (item.match) {
            const select = tr.querySelector('select');
            select.value = item.match.id;
        }
    });

    document.getElementById('section-review').classList.remove('hidden');
    document.getElementById('count-total').textContent = dadosProcessados.length;
    
    const msgUnknown = document.getElementById('count-unknown-msg');
    const btnImportar = document.getElementById('btn-importar');
    
    if (unknownCount > 0 || doubtCount > 0) {
        msgUnknown.classList.remove('hidden');
        msgUnknown.textContent = `Atenção: ${unknownCount} não identificadas e ${doubtCount} com detecção incerta. Confirme ou selecione.`;
        btnImportar.disabled = true;
        btnImportar.classList.add('opacity-50', 'cursor-not-allowed');
    } else {
        msgUnknown.classList.add('hidden');
        btnImportar.disabled = false;
        btnImportar.classList.remove('opacity-50', 'cursor-not-allowed');
    }

    // Listeners para mudanças na tabela
    document.querySelectorAll('.select-unidade-row').forEach(sel => {
        sel.addEventListener('change', (e) => {
            const idx = e.target.dataset.index;
            const unidadeId = e.target.value;
            const unidadeObj = unidadesCache.find(u => u.id === unidadeId);
            
            dadosProcessados[idx].match = unidadeObj;
            if (unidadeId) {
                dadosProcessados[idx].saveAlias = true;
                dadosProcessados[idx].confirmed = true;
                // Atualiza visualmente o checkbox
                const row = e.target.closest('tr');
                row.querySelector('.checkbox-memorize').checked = true;
                // Remove o estilo de erro
                e.target.classList.remove('border-red-400', 'bg-red-50');
            } else {
                dadosProcessados[idx].saveAlias = false;
                dadosProcessados[idx].confirmed = false;
            }
            
            verificarStatusGeral();
        });
    });

    document.querySelectorAll('.checkbox-memorize').forEach(chk => {
        chk.addEventListener('change', (e) => {
            const idx = e.target.dataset.index;
            dadosProcessados[idx].saveAlias = e.target.checked;
        });
    });

    document.querySelectorAll('.checkbox-confirm').forEach(chk => {
        chk.addEventListener('change', (e) => {
            const idx = e.target.dataset.index;
            dadosProcessados[idx].confirmed = e.target.checked;
            if (e.target.checked) dadosProcessados[idx].saveAlias = true;
            verificarStatusGeral();
        });
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function criarOpcoesUnidades() {
    // Ordena unidades por nome
    const sorted = [...unidadesCache].sort((a, b) => a.nome.localeCompare(b.nome));
    return sorted.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
}

function verificarStatusGeral() {
    const todosIdentificados = dadosProcessados.every(d => d.match);
    const todasDuvidasResolvidas = dadosProcessados.every(d => !d.match || d.matchType !== 'fuzzy' || d.confirmed);
    const btnImportar = document.getElementById('btn-importar');
    const msgUnknown = document.getElementById('count-unknown-msg');

    if (todosIdentificados && todasDuvidasResolvidas) {
        btnImportar.disabled = false;
        btnImportar.classList.remove('opacity-50', 'cursor-not-allowed');
        msgUnknown.classList.add('hidden');
    } else {
        btnImportar.disabled = true;
        btnImportar.classList.add('opacity-50', 'cursor-not-allowed');
        msgUnknown.classList.remove('hidden');
    }
}

// --- Importação Final ---

document.getElementById('btn-importar').addEventListener('click', async () => {
    if (!confirm("Tem certeza que deseja importar estes dados? Isso criará registros de movimentação.")) return;

    const loading = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loading.classList.remove('hidden');

    const modeData = null;
    let importCount = 0;
    let aliasCount = 0;

    try {
        const batchAliases = []; // Guardar promessas de atualização de alias
        
        // 1. Processar Aliases (Aprendizado)
        // Agrupar por unidade para evitar múltiplas escritas no mesmo doc
        const aliasesMap = new Map(); // unidadeId -> Set(aliases)

        dadosProcessados.forEach(item => {
            if (item.saveAlias && item.match) {
                if (!aliasesMap.has(item.match.id)) {
                    aliasesMap.set(item.match.id, new Set());
                }
                aliasesMap.get(item.match.id).add(item.unidadeSql);
            }
        });

        for (const [id, aliasesSet] of aliasesMap) {
            loadingText.textContent = `Memorizando ${aliasesSet.size} novos nomes...`;
            const docRef = doc(COL_UNIDADES, id);
            const aliasesArray = Array.from(aliasesSet);
            // Usar arrayUnion para adicionar sem duplicar
            await updateDoc(docRef, {
                aliases: arrayUnion(...aliasesArray)
            });
            aliasCount += aliasesSet.size;
        }

        // 2. Importar Movimentações (com deduplicação)
        loadingText.textContent = `Importando ${dadosProcessados.length} registros...`;

        for (const item of dadosProcessados) {
            if (!item.match) continue;
            const mesIndex = (typeof item.referenciaMesIdx === 'number') ? item.referenciaMesIdx : MESES[normalizar(item.mesStr)];
            const ano = item.ano;
            const ultimoDiaMes = new Date(ano, mesIndex + 1, 0).getDate();
            for (let i = 0; i < 5; i++) {
                const qtdSemana = item.semanas[i] || 0;
                if (qtdSemana <= 0) continue;
                const semanaIndex = i + 1;
                const inicio = 1 + i * 7;
                const fim = Math.min(inicio + 6, ultimoDiaMes);
                const diaEscolhido = fim;
                const dataMov = new Date(ano, mesIndex, diaEscolhido);
                dataMov.setHours(12, 0, 0, 0);
                const docData = {
                    unidadeId: item.match.id,
                    unidadeNome: item.match.nome,
                    tipoUnidade: item.match.tipo || 'OUTROS',
                    tipo: 'entrega',
                    quantidade: qtdSemana,
                    data: Timestamp.fromDate(dataMov),
                    responsavel: 'Importação Automática',
                    responsavelAlmoxarifado: auth.currentUser.email,
                    observacao: `Importado de SQL: ${item.unidadeSql} (${item.mesStr} Semana ${semanaIndex})`,
                    registradoEm: serverTimestamp(),
                    origem: 'importador_sql',
                    referenciaMes: mesIndex,
                    referenciaAno: ano,
                    referenciaSemana: semanaIndex
                };
                const docId = `${item.match.id}__${ano}-${String(mesIndex).padStart(2, '0')}__w${semanaIndex}__sql`;
                try {
                    await setDoc(doc(COL_AGUA_MOV, docId), docData);
                    importCount++;
                } catch (e) {
                    console.warn('Falha ao gravar registro importado', e);
                }
            }
        }

        alert(`Sucesso!\n\n- ${importCount} registros de água importados.\n- ${aliasCount} novos nomes de unidades aprendidos.`);
        window.location.reload(); // Reseta para limpar

    } catch (error) {
        console.error(error);
        alert("Erro durante a importação: " + error.message);
    } finally {
        loading.classList.add('hidden');
    }
});

document.getElementById('btn-export-backup')?.addEventListener('click', async () => {
    const loading = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loading.classList.remove('hidden');
    try {
        loadingText.textContent = 'Gerando backup...';
        const [snapAgua, snapGas, snapUnidades, snapEstAgua, snapEstGas, snapMateriais, snapCestaMov, snapCestaEst, snapEnxMov, snapEnxEst, snapRoles] = await Promise.all([
            getDocs(COL_AGUA_MOV),
            getDocs(COL_GAS_MOV),
            getDocs(COL_UNIDADES),
            getDocs(COL_ESTOQUE_AGUA),
            getDocs(COL_ESTOQUE_GAS),
            getDocs(COL_MATERIAIS),
            getDocs(COL_CESTA_MOV),
            getDocs(COL_CESTA_ESTOQUE),
            getDocs(COL_ENXOVAL_MOV),
            getDocs(COL_ENXOVAL_ESTOQUE),
            getDocs(COL_USER_ROLES)
        ]);
        const agua = snapAgua.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const gas = snapGas.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const unidades = snapUnidades.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const estoqueAgua = snapEstAgua.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const estoqueGas = snapEstGas.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const materiais = snapMateriais.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const cestaMov = snapCestaMov.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const cestaEstoque = snapCestaEst.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const enxovalMov = snapEnxMov.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const enxovalEstoque = snapEnxEst.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const userRoles = snapRoles.docs.map(d => ({ id: d.id, ...serializeDocData(d.data()) }));
        const summary = {
            unidades: summarizeCollection(unidades),
            aguaMov: summarizeCollection(agua),
            gasMov: summarizeCollection(gas),
            estoqueAgua: summarizeCollection(estoqueAgua),
            estoqueGas: summarizeCollection(estoqueGas),
            materiais: summarizeCollection(materiais),
            social: {
                cestaMov: summarizeCollection(cestaMov),
                cestaEstoque: summarizeCollection(cestaEstoque),
                enxovalMov: summarizeCollection(enxovalMov),
                enxovalEstoque: summarizeCollection(enxovalEstoque)
            },
            userRoles: summarizeCollection(userRoles)
        };
        const totalCount = summary.unidades.count + summary.aguaMov.count + summary.gasMov.count + summary.estoqueAgua.count + summary.estoqueGas.count + summary.materiais.count + summary.social.cestaMov.count + summary.social.cestaEstoque.count + summary.social.enxovalMov.count + summary.social.enxovalEstoque.count + summary.userRoles.count;
        const payload = {
            version: 1,
            generatedAt: new Date().toISOString(),
            unidades,
            aguaMov: agua,
            gasMov: gas,
            estoqueAgua,
            estoqueGas,
            materiais,
            social: {
                cestaMov,
                cestaEstoque,
                enxovalMov,
                enxovalEstoque
            },
            userRoles,
            summary,
            totalCount
        };
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        const a = document.createElement('a');
        const dt = new Date();
        const fname = `backup_controle_${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}.json`;
        a.href = URL.createObjectURL(blob);
        a.download = fname;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        alert(`Backup gerado com ${payload.totalCount} registros.`);
    } catch (e) {
        alert('Erro ao gerar backup: ' + e.message);
    } finally {
        loading.classList.add('hidden');
    }
});

document.getElementById('btn-import-backup')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('input-backup-file');
    const force = !!document.getElementById('restore-force')?.checked;
    if (!fileInput?.files?.[0]) { alert('Selecione um arquivo de backup (.json).'); return; }
    if (!confirm('Confirmar restauração do backup?')) return;
    const loading = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');
    loading.classList.remove('hidden');
    try {
        const text = await fileInput.files[0].text();
        const payload = JSON.parse(text);
        const agua = Array.isArray(payload.aguaMov) ? payload.aguaMov : [];
        const gas = Array.isArray(payload.gasMov) ? payload.gasMov : [];
        const unidades = Array.isArray(payload.unidades) ? payload.unidades : [];
        const estoqueAgua = Array.isArray(payload.estoqueAgua) ? payload.estoqueAgua : [];
        const estoqueGas = Array.isArray(payload.estoqueGas) ? payload.estoqueGas : [];
        const materiais = Array.isArray(payload.materiais) ? payload.materiais : [];
        const cestaMov = Array.isArray(payload.social?.cestaMov) ? payload.social.cestaMov : [];
        const cestaEstoque = Array.isArray(payload.social?.cestaEstoque) ? payload.social.cestaEstoque : [];
        const enxovalMov = Array.isArray(payload.social?.enxovalMov) ? payload.social.enxovalMov : [];
        const enxovalEstoque = Array.isArray(payload.social?.enxovalEstoque) ? payload.social.enxovalEstoque : [];
        const userRoles = Array.isArray(payload.userRoles) ? payload.userRoles : [];
        let restored = 0;
        loadingText.textContent = `Restaurando ${agua.length + gas.length + unidades.length + estoqueAgua.length + estoqueGas.length + materiais.length + cestaMov.length + cestaEstoque.length + enxovalMov.length + enxovalEstoque.length + userRoles.length} registros...`;
        for (const item of unidades) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_UNIDADES, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_UNIDADES, id), data); restored++;
        }
        for (const item of agua) {
            const id = item.id;
            const data = deserializeDocData(item);
            delete data.id;
            if (!force) {
                const exists = await getDoc(doc(COL_AGUA_MOV, id));
                if (exists.exists()) continue;
            }
            await setDoc(doc(COL_AGUA_MOV, id), data);
            restored++;
        }
        for (const item of gas) {
            const id = item.id;
            const data = deserializeDocData(item);
            delete data.id;
            if (!force) {
                const exists = await getDoc(doc(COL_GAS_MOV, id));
                if (exists.exists()) continue;
            }
            await setDoc(doc(COL_GAS_MOV, id), data);
            restored++;
        }
        for (const item of estoqueAgua) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_ESTOQUE_AGUA, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_ESTOQUE_AGUA, id), data); restored++;
        }
        for (const item of estoqueGas) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_ESTOQUE_GAS, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_ESTOQUE_GAS, id), data); restored++;
        }
        for (const item of materiais) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_MATERIAIS, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_MATERIAIS, id), data); restored++;
        }
        for (const item of cestaMov) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_CESTA_MOV, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_CESTA_MOV, id), data); restored++;
        }
        for (const item of cestaEstoque) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_CESTA_ESTOQUE, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_CESTA_ESTOQUE, id), data); restored++;
        }
        for (const item of enxovalMov) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_ENXOVAL_MOV, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_ENXOVAL_MOV, id), data); restored++;
        }
        for (const item of enxovalEstoque) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_ENXOVAL_ESTOQUE, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_ENXOVAL_ESTOQUE, id), data); restored++;
        }
        for (const item of userRoles) {
            const id = item.id; const data = deserializeDocData(item); delete data.id;
            if (!force) { const exists = await getDoc(doc(COL_USER_ROLES, id)); if (exists.exists()) continue; }
            await setDoc(doc(COL_USER_ROLES, id), data); restored++;
        }
        alert(`Backup restaurado. Registros aplicados: ${restored}.`);
    } catch (e) {
        alert('Erro ao restaurar backup: ' + e.message);
    } finally {
        loading.classList.add('hidden');
    }
});
