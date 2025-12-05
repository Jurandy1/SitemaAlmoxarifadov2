import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, updateDoc, arrayUnion, addDoc, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { firebaseConfig, APP_ID } from "./firebase-config.js";

// --- Inicialização Firebase ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Referências de Coleções
const BASE_PATH = `artifacts/${APP_ID}/public/data`;
const COL_UNIDADES = collection(db, `${BASE_PATH}/unidades`);
const COL_AGUA_MOV = collection(db, `${BASE_PATH}/controleAgua`);

// Estado Global
let unidadesCache = []; // Lista de unidades do Firestore
let dadosProcessados = []; // Dados extraídos do SQL

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

    const ano = parseInt(document.getElementById('input-ano').value);
    
    // Regex para capturar os valores dentro de ('...', '...', ...)
    // Formato esperado: ('Fevereiro', 'Categoria', 'Unidade', 0, 0, 0, 0, 0, Total)
    const regex = /\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/g;
    
    let match;
    dadosProcessados = [];
    
    while ((match = regex.exec(sql)) !== null) {
        const [_, mesStr, categoria, unidadeSql, s1, s2, s3, s4, s5, total] = match;
        
        // Se o total for 0, ignoramos? O usuário pediu para importar histórico, talvez queira registrar zeros.
        // Mas para "Controle de Água" (movimentação), geralmente registramos apenas entregas.
        // Se total for 0, não houve entrega. Vamos ignorar para não poluir o banco.
        const qtdTotal = parseInt(total);
        if (qtdTotal === 0) continue;

        const resultadoBusca = encontrarUnidade(unidadeSql);
        
        dadosProcessados.push({
            mesStr,
            ano,
            categoria,
            unidadeSql,
            qtdTotal,
            match: resultadoBusca ? resultadoBusca.unidade : null,
            matchType: resultadoBusca ? resultadoBusca.metodo : null,
            // Flag para indicar se precisa salvar alias (apenas se o usuário confirmar ou mudar)
            saveAlias: false
        });
    }

    renderPreview();
});

function renderPreview() {
    const tbody = document.getElementById('table-preview');
    tbody.innerHTML = '';
    
    let unknownCount = 0;
    const selectOptions = criarOpcoesUnidades();

    dadosProcessados.forEach((item, index) => {
        const tr = document.createElement('tr');
        const isIdentified = !!item.match;
        if (!isIdentified) unknownCount++;

        // Status Icon
        const iconStatus = isIdentified 
            ? `<span class="text-green-600"><i data-lucide="check-circle"></i></span>` 
            : `<span class="text-red-500"><i data-lucide="alert-circle"></i></span>`;

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

        tr.innerHTML = `
            <td class="p-3 text-center">${iconStatus}</td>
            <td class="p-3 font-mono text-xs text-gray-700">${item.unidadeSql}</td>
            <td class="p-3">${selectHtml}</td>
            <td class="p-3 text-center font-bold text-blue-800">${item.qtdTotal}</td>
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
    
    if (unknownCount > 0) {
        msgUnknown.classList.remove('hidden');
        msgUnknown.textContent = `Atenção: ${unknownCount} unidades não foram identificadas. Selecione manualmente.`;
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
            // Se o usuário alterou manualmente, marcamos para salvar alias por padrão
            if (unidadeId) {
                dadosProcessados[idx].saveAlias = true;
                // Atualiza visualmente o checkbox
                const row = e.target.closest('tr');
                row.querySelector('.checkbox-memorize').checked = true;
                // Remove o estilo de erro
                e.target.classList.remove('border-red-400', 'bg-red-50');
            } else {
                dadosProcessados[idx].saveAlias = false;
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

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function criarOpcoesUnidades() {
    // Ordena unidades por nome
    const sorted = [...unidadesCache].sort((a, b) => a.nome.localeCompare(b.nome));
    return sorted.map(u => `<option value="${u.id}">${u.nome}</option>`).join('');
}

function verificarStatusGeral() {
    const todosIdentificados = dadosProcessados.every(d => d.match);
    const btnImportar = document.getElementById('btn-importar');
    const msgUnknown = document.getElementById('count-unknown-msg');

    if (todosIdentificados) {
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

    const modeData = document.getElementById('select-data-mode').value;
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

        // 2. Importar Movimentações
        loadingText.textContent = `Importando ${dadosProcessados.length} registros...`;
        
        // Processar em chunks se for muitos dados? Firestore aguenta bem sequencial ou Promise.all
        // Vamos usar loop sequencial para garantir e contar erros
        for (const item of dadosProcessados) {
            if (!item.match) continue;

            const mesIndex = MESES[normalizar(item.mesStr)];
            const ano = item.ano;
            
            let dataMov;
            if (modeData === 'last_day') {
                // Último dia do mês: Mês seguinte dia 0
                dataMov = new Date(ano, mesIndex + 1, 0); 
            } else {
                // Primeiro dia
                dataMov = new Date(ano, mesIndex, 1);
            }
            
            // Define hora para meio-dia para evitar problemas de fuso horário
            dataMov.setHours(12, 0, 0, 0);

            const docData = {
                unidadeId: item.match.id,
                unidadeNome: item.match.nome,
                tipoUnidade: item.match.tipo || 'OUTROS',
                tipo: 'entrega', // SQL é consumo -> assumimos entrega de cheios
                quantidade: item.qtdTotal,
                data: Timestamp.fromDate(dataMov),
                responsavel: 'Importação Automática',
                responsavelAlmoxarifado: auth.currentUser.email,
                observacao: `Importado de SQL: ${item.unidadeSql} (${item.mesStr})`,
                registradoEm: serverTimestamp()
            };

            await addDoc(COL_AGUA_MOV, docData);
            importCount++;
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
