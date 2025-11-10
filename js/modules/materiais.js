// js/modules/materiais.js
import { Timestamp, addDoc, updateDoc, doc, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { getMateriais, getUserRole } from "../utils/cache.js"; // Adicionado getUserRole
// CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
import { DOM_ELEMENTS, showAlert, filterTable, switchSubTabView } from "../utils/dom-helpers.js";
import { getTodayDateString, dateToTimestamp, capitalizeString, formatTimestamp, formatTimestampComTempo } from "../utils/formatters.js";
import { isReady } from "./auth.js";
import { COLLECTIONS } from "../services/firestore-service.js";
import { uploadFile, deleteFile } from "../services/storage-service.js";

// =========================================================================
// LÓGICA DE LANÇAMENTO E SUBMISSÃO
// =========================================================================

/**
 * Submete o formulário de requisição de materiais.
 */
export async function handleMateriaisSubmit(e) {
    e.preventDefault();
    if (!isReady()) { showAlert('alert-materiais', 'Erro: Não autenticado.', 'error'); return; }
    
    const role = getUserRole();
    // PERMISSÃO: Admin-Only (Editor não pode fazer requisição)
    if (role !== 'admin') {
         showAlert('alert-materiais', "Permissão negada. Apenas Administradores podem registrar novas requisições.", 'error'); return;
    }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const selectValue = DOM_ELEMENTS.selectUnidadeMateriais.value; 
    if (!selectValue) { showAlert('alert-materiais', 'Selecione uma unidade.', 'warning'); return; }
    const [unidadeId, unidadeNome, tipoUnidadeRaw] = selectValue.split('|');
    const tipoUnidade = (tipoUnidadeRaw || '').toUpperCase() === 'SEMCAS' ? 'SEDE' : (tipoUnidadeRaw || '').toUpperCase();

    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS
    const tipoMaterial = DOM_ELEMENTS.selectTipoMateriais.value;
    // Data da Requisição agora é opcional, usar serverTimestamp se vazio
    const dataRequisicao = DOM_ELEMENTS.inputDataSeparacao.value ? dateToTimestamp(DOM_ELEMENTS.inputDataSeparacao.value) : serverTimestamp();
    const itens = DOM_ELEMENTS.textareaItensMateriais.value.trim();
    const responsavelLancamento = capitalizeString(DOM_ELEMENTS.inputResponsavelMateriais.value.trim()); 
    const arquivo = DOM_ELEMENTS.inputArquivoMateriais.files[0];
     
    if (!unidadeId || !tipoMaterial || !responsavelLancamento) {
        showAlert('alert-materiais', 'Dados inválidos. Verifique unidade, tipo e Responsável pelo Lançamento.', 'warning'); return;
    }
    
    DOM_ELEMENTS.btnSubmitMateriais.disabled = true; 
    
    let fileURL = null;
    let storagePath = null;

    if (arquivo) {
        if (arquivo.size > 10 * 1024 * 1024) { 
            showAlert('alert-materiais', 'Erro: Arquivo muito grande (máx 10MB).', 'error');
            DOM_ELEMENTS.btnSubmitMateriais.disabled = false;
            return;
        }
        
        DOM_ELEMENTS.btnSubmitMateriais.innerHTML = '<div class="loading-spinner-small mx-auto"></div><span class="ml-2">Enviando arquivo...</span>';
        showAlert('alert-materiais', 'Enviando arquivo anexo...', 'info', 10000);

        try {
            const uploadResult = await uploadFile(arquivo);
            fileURL = uploadResult.fileURL;
            storagePath = uploadResult.storagePath;
            showAlert('alert-materiais', 'Arquivo enviado! Salvando registro...', 'info', 10000);

        } catch (error) {
            console.error("Erro no upload do arquivo:", error);
            showAlert('alert-materiais', `Erro ao enviar arquivo: ${error.message}`, 'error');
            DOM_ELEMENTS.btnSubmitMateriais.disabled = false; 
            // Texto original do botão
            DOM_ELEMENTS.btnSubmitMateriais.innerHTML = '<i data-lucide="save"></i> <span>Registrar Requisição</span>';
            if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
            return;
        }
    } else {
         DOM_ELEMENTS.btnSubmitMateriais.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    }
    
    try {
        await addDoc(COLLECTIONS.materiais, {
            unidadeId, unidadeNome, tipoUnidade, tipoMaterial,
            // Campo renomeado para dataRequisicao
            dataRequisicao: dataRequisicao, 
            // Mantendo dataSeparacao como null inicialmente ou usar dataRequisicao como placeholder? Usarei null.
            dataSeparacao: null, 
            itens,
            status: 'requisitado', // Status inicial
            dataInicioSeparacao: null, 
            dataRetirada: null,
            dataEntrega: null,
            responsavelLancamento: responsavelLancamento,
            responsavelSeparador: null,
            responsavelEntrega: null,
            responsavelRecebimento: null,
            registradoEm: serverTimestamp(),
            fileURL: fileURL,
            storagePath: storagePath,
            downloadInfo: { count: 0, lastDownload: null, blockedUntil: null }
        });
        showAlert('alert-materiais', 'Requisição registrada! O status inicial é "Para Separar".', 'success');
        DOM_ELEMENTS.formMateriais.reset(); 
        // Resetar data para hoje
        DOM_ELEMENTS.inputDataSeparacao.value = getTodayDateString(); 
        
        // CORREÇÃO 2.2: Chamar renderização local após sucesso para atualizar imediatamente a UI
        renderMateriaisStatus();

    } catch (error) { 
        console.error("Erro salvar requisição:", error);
        showAlert('alert-materiais', `Erro: ${error.message}`, 'error');
    } finally { 
        DOM_ELEMENTS.btnSubmitMateriais.disabled = false; 
        // Texto original do botão
        DOM_ELEMENTS.btnSubmitMateriais.innerHTML = '<i data-lucide="save"></i> <span>Registrar Requisição</span>';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}


// =========================================================================
// LÓGICA DO FLUXO (WORKFLOW)
// =========================================================================

/**
 * Renderiza as sub-tabelas de materiais e os summaries.
 */
export function renderMateriaisStatus() {
    
    const materiais = getMateriais().filter(m => !m.deleted);
    
    const requisitado = materiais.filter(m => m.status === 'requisitado');
    let separacao = materiais.filter(m => m.status === 'separacao');
    let retirada = materiais.filter(m => m.status === 'retirada');
    let entregue = materiais.filter(m => m.status === 'entregue');

    // ---- Filtros de Histórico (Unidade e Período) ----
    const unidadeSelect = document.getElementById('select-historico-unidade');
    const inicioInput = document.getElementById('historico-inicio');
    const fimInput = document.getElementById('historico-fim');

    // Popular select de unidades com base no histórico (entregues)
    if (unidadeSelect) {
        const atual = unidadeSelect.value || 'todas';
        const unidadesSet = new Set(entregue.map(m => (m.unidadeNome || '').trim()).filter(Boolean));
        const unidades = Array.from(unidadesSet).sort((a,b) => a.localeCompare(b));
        // Reconstrói opções preservando seleção atual
        unidadeSelect.innerHTML = '<option value="todas">Todas as unidades</option>' +
            unidades.map(u => `<option value="${u}">${u}</option>`).join('');
        // Restaura seleção se ainda existir
        if (unidadeSelect.querySelector(`option[value="${atual}"]`)) {
            unidadeSelect.value = atual;
        }
    }

    // Aplica filtro por unidade
    const unidadeFiltro = (unidadeSelect && unidadeSelect.value && unidadeSelect.value !== 'todas') ? unidadeSelect.value : null;
    if (unidadeFiltro) {
        entregue = entregue.filter(m => (m.unidadeNome || '').trim() === unidadeFiltro);
    }

    // Aplica filtro por período (dataEntrega)
    const inicioVal = inicioInput?.value || '';
    const fimVal = fimInput?.value || '';
    const inicioMs = inicioVal ? dateToTimestamp(inicioVal)?.toMillis() : null;
    // Para fim, considera fim do dia
    let fimMs = null;
    if (fimVal) {
        const d = new Date(fimVal);
        d.setHours(23,59,59,999);
        fimMs = d.getTime();
    }
    if (inicioMs) {
        entregue = entregue.filter(m => (m.dataEntrega?.toMillis() || 0) >= inicioMs);
    }
    if (fimMs) {
        entregue = entregue.filter(m => (m.dataEntrega?.toMillis() || 0) <= fimMs);
    }
    
    // CORREÇÃO: DOM_ELEMENTOS -> DOM_ELEMENTS (Atualiza os resumos)
    if (DOM_ELEMENTS.summaryMateriaisRequisitado) DOM_ELEMENTS.summaryMateriaisRequisitado.textContent = requisitado.length;
    if (DOM_ELEMENTS.summaryMateriaisSeparacao) DOM_ELEMENTS.summaryMateriaisSeparacao.textContent = separacao.length;
    if (DOM_ELEMENTS.summaryMateriaisRetirada) DOM_ELEMENTS.summaryMateriaisRetirada.textContent = retirada.length;
    
    // Ordenação por criticidade (SLA)
    const nowMs = Timestamp.now().toMillis();
    separacao = separacao.sort((a,b) => {
        const aStart = a.dataInicioSeparacao?.toMillis() || 0;
        const bStart = b.dataInicioSeparacao?.toMillis() || 0;
        return (nowMs - bStart) - (nowMs - aStart);
    });
    retirada = retirada.sort((a,b) => {
        const aReady = a.dataRetirada?.toMillis() || 0;
        const bReady = b.dataRetirada?.toMillis() || 0;
        return (nowMs - bReady) - (nowMs - aReady);
    });

    // Popular select de unidade para lote (Pronto p/ Entrega)
    const batchSelect = document.getElementById('batch-unidade-select');
    if (batchSelect) {
        const atual = batchSelect.value || '';
        const unidadesSet = new Set(retirada.map(m => (m.unidadeNome || '').trim()).filter(Boolean));
        const unidades = Array.from(unidadesSet).sort((a,b) => a.localeCompare(b));
        batchSelect.innerHTML = '<option value="">Selecione...</option>' +
            unidades.map(u => `<option value="${u}">${u}</option>`).join('');
        if (batchSelect.querySelector(`option[value="${atual}"]`)) {
            batchSelect.value = atual;
        }
    }

    // Renderiza tabelas individuais
    renderMaterialSubTable(DOM_ELEMENTS.tableParaSeparar, requisitado, 'requisitado');
    renderMaterialSubTable(DOM_ELEMENTS.tableEmSeparacao, separacao, 'separacao');
    renderMaterialSubTable(DOM_ELEMENTS.tableProntoEntrega, retirada, 'retirada');
    renderMaterialSubTable(DOM_ELEMENTS.tableHistoricoEntregues, entregue.sort((a,b) => (b.dataEntrega?.toMillis() || 0) - (a.dataEntrega?.toMillis() || 0)), 'entregue');
}

/**
 * Função utilitária para renderizar uma tabela de materiais com base no status.
 */
function renderMaterialSubTable(tableBody, data, status) {
    if (!tableBody) return;
    
    // Define a mensagem padrão caso não haja dados
    let msgVazio = 'Nenhum item encontrado para este status.';
    if (status === 'requisitado') msgVazio = 'Nenhuma requisição pendente de separação.';
    else if (status === 'separacao') msgVazio = 'Nenhuma requisição em separação.';
    else if (status === 'retirada') msgVazio = 'Nenhum material pronto para entrega.';
    else if (status === 'entregue') msgVazio = 'Nenhuma entrega finalizada.';

    if (data.length === 0) {
        // CORRIGIDO: Alterado colspan para 7 para Histórico (max 7 colunas) e 5 para Para Separar (max 5 colunas)
        const colspan = status === 'entregue' ? 7 : 5; 
        tableBody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-4 text-slate-500">${msgVazio}</td></tr>`;
        return;
    }

    let html = '';
    const role = getUserRole();
    const isAdmin = role === 'admin';
    const isEditor = role === 'editor';
    const nowMs = Timestamp.now().toMillis();
    
    data.forEach(m => {
        let acoesHtml = '';
        let rowContent = '';

        // ** CORREÇÃO SOLICITADA: Ajuste da exibição da Unidade e Tipo **
        let unidadeDisplay = m.unidadeNome || 'N/A';
        const tipoUnidade = (m.tipoUnidade || '').toUpperCase();
        
        // Se o tipo for CT, ABRIGO, SEDE, CREAS, CRAS, prefixa o nome para garantir o formato TIPO NOME
        if (['CT', 'ABRIGO', 'SEDE', 'CREAS', 'CRAS'].includes(tipoUnidade)) {
             // Garante que o nome da unidade só seja prefixado se for diferente do tipo (evita "CT CT CENTRO")
             if (!unidadeDisplay.toUpperCase().startsWith(tipoUnidade)) {
                 unidadeDisplay = `${tipoUnidade} ${unidadeDisplay}`;
             } else {
                 unidadeDisplay = unidadeDisplay; // Usa só o nome da unidade se já começar com o tipo
             }
        }
        // FIM CORREÇÃO SOLICITADA
        
        // CORREÇÃO SOLICITADA 2: Usar formatTimestampComTempo para a data de registro/requisição
        const dataRequisicaoFormatada = formatTimestampComTempo(m.registradoEm || m.dataRequisicao); 
        const responsavelLancamento = m.responsavelLancamento || 'N/A';
        const separador = m.responsavelSeparador || 'N/A';
        const dataInicioSeparacaoFormatada = formatTimestampComTempo(m.dataInicioSeparacao);
        const dataRetiradaFormatada = formatTimestamp(m.dataRetirada); // Data que ficou pronto
        const hasFile = m.fileURL;
        const downloadBtn = hasFile 
            ? `<button class="btn-icon btn-download-pedido text-blue-600 hover:text-blue-800" data-id="${m.id}" data-url="${m.fileURL}" title="Baixar Pedido" aria-label="Baixar Pedido">📥</button>`
            : '<span class="btn-icon text-gray-400" title="Sem anexo" aria-hidden="true">🚫</span>';
        
        // Botão de remoção é Admin-Only
        // Botão de remoção é Admin-Only; para não-admin, não renderizamos nada para evitar poluir a UI
        const removeBtn = isAdmin
            ? `<button class="btn-icon btn-remove text-red-600 hover:text-red-800" data-id="${m.id}" data-type="materiais" data-details="${m.unidadeNome} - ${status}" title="Remover Requisição" aria-label="Remover">🗑️</button>`
            : '';
        
        // Determina se os botões de ação do fluxo devem ser visíveis/ativos
        const canEditFlow = isAdmin || isEditor;
        
        if (status === 'requisitado') {
            const startSeparacaoBtn = canEditFlow
                ? `<button class="btn-icon btn-start-separacao text-green-600 hover:text-green-800" data-id="${m.id}" title="Informar Separador e Iniciar" aria-label="Iniciar separação">▶️</button>`
                : `<span class="btn-icon text-gray-400" title="Apenas Admin/Editor pode iniciar" aria-hidden="true">⛔</span>`;

            // Badge de Downloads e Bloqueio
            const dlInfo = m.downloadInfo || { count: 0, blockedUntil: null };
            const isDlBlocked = dlInfo.blockedUntil && (dlInfo.blockedUntil.toMillis() > nowMs);
            const dlBadge = `<span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] ${isDlBlocked ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}" title="Downloads">DL ${dlInfo.count}${isDlBlocked ? ' • Bloqueado' : ''}</span>`;

            acoesHtml = downloadBtn + dlBadge + startSeparacaoBtn + removeBtn;
            
            // Colunas para 'Para Separar'
            rowContent = `<td>${unidadeDisplay}</td>` +
                `<td class="capitalize">${m.tipoMaterial}</td>` +
                `<td class="whitespace-nowrap">${dataRequisicaoFormatada}</td>` +
                `<td>${responsavelLancamento}</td>` +
                `<td class="text-center"><div class="actions-cell">${acoesHtml}</div></td>`;
            
        } else if (status === 'separacao') {
             // Editor PODE marcar como pronto para entrega
            const prontaRetiradaBtn = canEditFlow
                ? `<button class="btn-icon btn-retirada text-teal-600 hover:text-teal-800" data-id="${m.id}" title="Marcar como pronto para entrega" aria-label="Pronto para entrega">📦</button>`
                : `<span class="btn-icon text-gray-400" title="Apenas Admin/Editor pode marcar como pronto" aria-hidden="true">⛔</span>`;

            acoesHtml = prontaRetiradaBtn + removeBtn;
                
            // SLA Badge (tempo em separação)
            const sepStart = m.dataInicioSeparacao?.toMillis() || 0;
            const hoursSep = sepStart ? Math.floor((nowMs - sepStart) / (60*60*1000)) : 0;
            let slaBadge = '';
            if (sepStart) {
                if (hoursSep >= SLA_SEPARACAO_CRIT_HOURS) {
                    slaBadge = `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px]" title="Atraso em separação">Atrasado ${hoursSep}h</span>`;
                } else if (hoursSep >= SLA_SEPARACAO_WARN_HOURS) {
                    slaBadge = `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-[10px]" title="Em alerta">Alerta ${hoursSep}h</span>`;
                }
            }

            // Colunas para 'Em Separação'
            rowContent = `<td>${unidadeDisplay} ${slaBadge}</td>` +
                `<td class="capitalize">${m.tipoMaterial}</td>` +
                `<td>${separador}</td>` +
                `<td class="text-xs whitespace-nowrap">${dataInicioSeparacaoFormatada}</td>` +
                `<td class="text-center"><div class="actions-cell">${acoesHtml}</div></td>`;
            
        } else if (status === 'retirada') {
             // FINALIZAÇÃO DE ENTREGA: Agora Admin/Editor
            const canFinalize = isAdmin || isEditor;
            const finalizarEntregaBtn = canFinalize
                ? `<button class="btn-icon btn-entregue text-blue-600 hover:text-blue-800" data-id="${m.id}" title="Finalizar entrega e registrar responsáveis" aria-label="Finalizar entrega">✅</button>`
                : `<span class="btn-icon text-gray-400" title="Apenas Admin/Editor pode finalizar a entrega" aria-hidden="true">⛔</span>`;
            
            acoesHtml = finalizarEntregaBtn + removeBtn;
            
            // SLA Badge (tempo aguardando retirada/entrega)
            const readyMs = m.dataRetirada?.toMillis() || 0;
            const hoursRet = readyMs ? Math.floor((nowMs - readyMs) / (60*60*1000)) : 0;
            let slaBadge = '';
            if (readyMs) {
                if (hoursRet >= SLA_RETIRADA_CRIT_HOURS) {
                    slaBadge = `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-red-100 text-red-700 text-[10px]" title="Atraso na entrega">Atrasado ${hoursRet}h</span>`;
                } else if (hoursRet >= SLA_RETIRADA_WARN_HOURS) {
                    slaBadge = `<span class="ml-2 inline-flex items-center px-2 py-0.5 rounded bg-yellow-100 text-yellow-800 text-[10px]" title="Em alerta">Alerta ${hoursRet}h</span>`;
                }
            }

            // Colunas para 'Pronto p/ Entrega'
            rowContent = `<td>${unidadeDisplay} ${slaBadge}</td>` +
                `<td class="capitalize">${m.tipoMaterial}</td>` +
                `<td>${separador}</td>` +
                `<td class="whitespace-nowrap">${dataRetiradaFormatada}</td>` +
                `<td class="text-center"><div class="actions-cell">${acoesHtml}</div></td>`;
            
        } else if (status === 'entregue') {
            const dataEntregaFormatada = formatTimestamp(m.dataEntrega);
            const respUnidade = m.responsavelRecebimento || m.responsavelLancamento || 'N/A';
            const respAlmox = m.responsavelEntrega || m.responsavelSeparador || 'N/A';
            // Usa a data da requisição como "Lançado em"; cai para registradoEm se necessário
            const dataLancamentoFormatada = formatTimestampComTempo(m.dataRequisicao || m.registradoEm);

            // Colunas para 'Histórico'
            rowContent = `<td>${unidadeDisplay}</td>` +
                `<td class="capitalize">${m.tipoMaterial}</td>` +
                `<td class="whitespace-nowrap">${dataEntregaFormatada}</td>` +
                `<td>${respUnidade}</td>` +
                `<td>${respAlmox}</td>` +
                `<td class="text-center text-xs whitespace-nowrap">${dataLancamentoFormatada}</td>` +
                `<td class="text-center">${removeBtn}</td>`; // Exclusão de histórico é Admin-Only
        }
        
        // Linha principal
        html += `<tr class="${!canEditFlow && (status === 'requisitado' || status === 'separacao') ? 'disabled-by-role' : ''}">${rowContent}</tr>`;
        
        // Incluir linha de observação se houver itens/obs
        if (m.itens) {
            html += `<tr class="obs-row ${status === 'entregue' ? 'opacity-60' : ''} border-b border-slate-200">` +
                // Ajusta o colspan dinamicamente baseado nas colunas da tabela
                `<td colspan="${status === 'entregue' ? '7' : '5'}" class="pt-0 pb-1 px-6 text-xs text-slate-500 whitespace-pre-wrap italic">Obs: ${m.itens}</td>` +
                `</tr>`;
        }
    });

    tableBody.innerHTML = html;
    
    if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
}


/**
 * Marca o material como pronto para retirada.
 */
async function handleMarcarRetirada(e) {
    const button = e.target.closest('button.btn-retirada[data-id]');
    if (!button) return; 
    
    const role = getUserRole();
    // PERMISSÃO: Editor/Admin
    if (role === 'anon' || role === 'unauthenticated') {
         showAlert('alert-em-separacao', "Permissão negada. Usuário Anônimo não pode alterar o status do material.", 'error');
         return;
    }
    
    const materialId = button.dataset.id;
    if (!isReady() || !materialId) return;
    
    // Muda o ícone para spinner
    button.disabled = true; 
    button.innerHTML = '<div class="loading-spinner-small mx-auto" style="width: 1rem; height: 1rem; border-width: 2px;"></div>'; 
    
    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, { 
            status: 'retirada', 
            dataRetirada: serverTimestamp() 
        });
        showAlert('alert-em-separacao', 'Material marcado como Pronto para Entrega!', 'success', 3000);
        
        // CORREÇÃO 2.2: Chamar renderização local após sucesso
        renderMateriaisStatus();
        
    } catch (error) { 
        console.error("Erro marcar p/ retirada:", error); 
        showAlert('alert-em-separacao', `Erro: ${error.message}`, 'error'); 
        // Restaura o ícone original em caso de erro
        button.disabled = false; 
        button.innerHTML = '<i data-lucide="package-check"></i>'; 
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Abre o modal para finalização de entrega.
 */
async function handleMarcarEntregue(e) {
    const button = e.target.closest('button.btn-entregue[data-id]');
    if (!button) return; 
    
    const role = getUserRole();
    // PERMISSÃO: Admin/Editor (Editor PODE finalizar a entrega/recebimento)
    if (role === 'anon' || role === 'unauthenticated') { 
         showAlert('alert-pronto-entrega', "Permissão negada. Apenas Administradores ou Editores podem finalizar a entrega de material.", 'error');
         return;
    }
    
    const materialId = button.dataset.id;
    if (!isReady() || !materialId) return;
    
    const material = getMateriais().find(m => m.id === materialId);
    if (!material) return;
    
    // Preenche e abre o modal de finalização
    // CORREÇÃO: DOM_ELEMENTS -> DOM_ELEMENTS
    DOM_ELEMENTS.finalizarEntregaMaterialIdEl.value = materialId;
    DOM_ELEMENTS.inputEntregaResponsavelAlmox.value = material.responsavelSeparador || '';
    // Tenta pegar o responsável pelo lançamento como default para quem recebeu
    DOM_ELEMENTS.inputEntregaResponsavelUnidade.value = material.responsavelRecebimento || material.responsavelLancamento || ''; // Pega o último responsável de recebimento se existir
    DOM_ELEMENTS.alertFinalizarEntrega.style.display = 'none';

    DOM_ELEMENTS.finalizarEntregaModal.style.display = 'flex';
    DOM_ELEMENTS.inputEntregaResponsavelAlmox.focus();
}

/**
 * Finaliza a entrega do material (chamado pelo modal).
 */
export async function handleFinalizarEntregaSubmit() {
    if (!isReady()) return;
    
    const role = getUserRole();
    // PERMISSÃO: Admin/Editor (Editor PODE confirmar a finalização da entrega/recebimento)
    if (role === 'anon' || role === 'unauthenticated') {
         showAlert('alert-finalizar-entrega', "Permissão negada. Apenas Administradores ou Editores podem confirmar a finalização da entrega.", 'error');
         return;
    }
    
    // CORREÇÃO: DOM_ELEMENTS -> DOM_ELEMENTS
    const materialId = DOM_ELEMENTS.finalizarEntregaMaterialIdEl.value;
    const respAlmox = capitalizeString(DOM_ELEMENTS.inputEntregaResponsavelAlmox.value.trim());
    const respUnidade = capitalizeString(DOM_ELEMENTS.inputEntregaResponsavelUnidade.value.trim());
    
    if (!respAlmox || !respUnidade) {
        showAlert('alert-finalizar-entrega', 'Informe o responsável pela entrega (Almoxarifado) e quem recebeu (Unidade).', 'warning');
        return;
    }
    
    DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.disabled = true;
    DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';
    
    const material = getMateriais().find(m => m.id === materialId);
    const storagePath = material?.storagePath;
    
    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, { 
            status: 'entregue', 
            dataEntrega: serverTimestamp(),
            responsavelEntrega: respAlmox,
            responsavelRecebimento: respUnidade
        });
        // Alerta na subview correta
        showAlert('alert-pronto-entrega', `Material entregue para ${respUnidade}! Processo finalizado.`, 'success', 3000); 
        
        // Excluir arquivo do Storage APÓS a atualização do status
        if (storagePath) {
             await deleteFile(storagePath);
             // Atualiza o doc para remover referências ao arquivo deletado
             await updateDoc(docRef, {
                 fileURL: null,
                 storagePath: null
             });
             console.log(`Referências do arquivo removidas do Firestore para ${materialId}`);
        }
        
        // CORREÇÃO 2.2: Chamar renderização local após sucesso
        renderMateriaisStatus();

    } catch (error) { 
        console.error("Erro finalizar entrega:", error); 
        showAlert('alert-finalizar-entrega', `Erro: ${error.message}`, 'error'); 
        showAlert('alert-pronto-entrega', `Erro ao finalizar: ${error.message}`, 'error'); 
    } finally {
        DOM_ELEMENTS.finalizarEntregaModal.style.display = 'none';
        DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.disabled = false;
        DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.innerHTML = '<i data-lucide="check-circle"></i> Confirmar Finalização';
        if (typeof lucide !== 'undefined' && typeof lucide.createIcons === 'function') { lucide.createIcons(); }
    }
}

/**
 * Finaliza em lote os materiais 'retirada' da unidade selecionada com dataRetirada de hoje.
 */
async function handleBatchFinalizarHoje() {
    if (!isReady()) return;
    const role = getUserRole();
    if (role === 'anon' || role === 'unauthenticated') {
        showAlert('alert-pronto-entrega', "Permissão negada. Apenas Administradores ou Editores podem finalizar em lote.", 'error');
        return;
    }

    const unidadeNome = document.getElementById('batch-unidade-select')?.value || '';
    const respAlmox = capitalizeString(document.getElementById('batch-resp-almox')?.value.trim() || '');
    const respUnidade = capitalizeString(document.getElementById('batch-resp-unidade')?.value.trim() || '');

    if (!unidadeNome) {
        showAlert('alert-pronto-entrega', 'Selecione a unidade para finalizar em lote.', 'warning');
        return;
    }
    if (!respAlmox || !respUnidade) {
        showAlert('alert-pronto-entrega', 'Informe responsável do Almoxarifado e da Unidade para o lote.', 'warning');
        return;
    }

    const hojeStr = getTodayDateString();
    const materiais = getMateriais().filter(m => !m.deleted && m.status === 'retirada' && (m.unidadeNome || '').trim() === unidadeNome);
    // Filtra por dataRetirada de hoje
    const hojeInicio = new Date(hojeStr + 'T00:00:00');
    const hojeFim = new Date(hojeStr + 'T23:59:59');
    const toFinalize = materiais.filter(m => {
        const ms = m.dataRetirada?.toMillis() || 0;
        return ms >= hojeInicio.getTime() && ms <= hojeFim.getTime();
    });

    if (toFinalize.length === 0) {
        showAlert('alert-pronto-entrega', 'Nenhum material pronto hoje para esta unidade.', 'info');
        return;
    }

    // Desabilita botão enquanto processa
    const btn = document.getElementById('btn-batch-finalizar-hoje');
    if (btn) { btn.disabled = true; btn.textContent = 'Finalizando...'; }

    try {
        for (const m of toFinalize) {
            const docRef = doc(COLLECTIONS.materiais, m.id);
            await updateDoc(docRef, {
                status: 'entregue',
                dataEntrega: serverTimestamp(),
                responsavelEntrega: respAlmox,
                responsavelRecebimento: respUnidade
            });
            // Remove anexo se existir
            if (m.storagePath) {
                try {
                    await deleteFile(m.storagePath);
                    await updateDoc(docRef, { fileURL: null, storagePath: null });
                } catch (err) { console.warn('Erro ao remover anexo em lote', m.id, err); }
            }
        }
        showAlert('alert-pronto-entrega', `Entrega finalizada em lote para ${unidadeNome}: ${toFinalize.length} item(ns).`, 'success', 5000);
        renderMateriaisStatus();
    } catch (error) {
        console.error('Erro na finalização em lote:', error);
        showAlert('alert-pronto-entrega', `Erro na finalização em lote: ${error.message}`, 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Finalizar em lote (Hoje)'; }
    }
}

/**
 * Abre o modal para informar o nome do separador.
 */
function openSeparadorModal(materialId) {
    const role = getUserRole();
    // PERMISSÃO: Editor/Admin (Anon bloqueado)
    if (role === 'anon') {
         showAlert('alert-para-separar', "Permissão negada. Usuário Anônimo não pode iniciar a separação.", 'error');
         return;
    }
    
    // CORREÇÃO: DOM_ELEMENTS -> DOM_ELEMENTS
    if (!DOM_ELEMENTS.separadorModal) return;
    console.log("Abrindo modal para material ID:", materialId);
    DOM_ELEMENTS.separadorMaterialIdEl.value = materialId;
    DOM_ELEMENTS.inputSeparadorNome.value = '';
    DOM_ELEMENTS.inputSeparadorNome.disabled = false;
    DOM_ELEMENTS.btnSalvarSeparador.disabled = false;
    DOM_ELEMENTS.btnSalvarSeparador.innerHTML = 'Salvar Nome e Liberar';
    DOM_ELEMENTS.alertSeparador.style.display = 'none';
    DOM_ELEMENTS.separadorModal.style.display = 'flex';
    DOM_ELEMENTS.inputSeparadorNome.focus();
}

/**
 * Salva o nome do separador e move o status para 'separacao'.
 */
export async function handleSalvarSeparador() {
    // CORREÇÃO: DOM_ELEMENTS -> DOM_ELEMENTS
    if (!isReady() || !DOM_ELEMENTS.inputSeparadorNome) return;
    
    const role = getUserRole();
    // PERMISSÃO: Editor/Admin (Anon bloqueado)
    if (role === 'anon') {
         showAlert('alert-separador', "Permissão negada. Usuário Anônimo não pode iniciar a separação.", 'error');
         return;
    }

    const nomeSeparador = capitalizeString(DOM_ELEMENTS.inputSeparadorNome.value.trim());
    const materialId = DOM_ELEMENTS.separadorMaterialIdEl.value;

    if (!nomeSeparador) {
        showAlert('alert-separador', 'Por favor, informe o nome do separador.', 'warning');
        return;
    }

    DOM_ELEMENTS.btnSalvarSeparador.disabled = true;
    DOM_ELEMENTS.inputSeparadorNome.disabled = true;
    DOM_ELEMENTS.btnSalvarSeparador.innerHTML = '<div class="loading-spinner-small mx-auto"></div>';

    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, {
            status: 'separacao',
            responsavelSeparador: nomeSeparador,
            dataInicioSeparacao: serverTimestamp()
        });

        // Mostra o alerta na view "Para Separar"
        showAlert('alert-para-separar', 'Nome salvo! O status foi atualizado para "Em Separação".', 'success', 3000); 
        DOM_ELEMENTS.separadorModal.style.display = 'none'; // Fecha o modal imediatamente
        
        // CORREÇÃO 2.2: Chamar renderização local após sucesso
        renderMateriaisStatus();

        // Tenta baixar o arquivo automaticamente, se existir
        const material = getMateriais().find(m => m.id === materialId);
        if (material?.fileURL) {
             // Pequeno delay para garantir que a UI atualize antes do download
             setTimeout(() => { 
                 handleDownloadPedido(materialId, material.fileURL); 
             }, 300);
        }

    } catch (error) {
        console.error("Erro ao salvar nome do separador:", error);
        showAlert('alert-separador', `Erro ao salvar: ${error.message}`, 'error'); // Alerta dentro do modal
        DOM_ELEMENTS.btnSalvarSeparador.disabled = false;
        DOM_ELEMENTS.inputSeparadorNome.disabled = false;
        DOM_ELEMENTS.btnSalvarSeparador.innerHTML = 'Salvar Nome e Liberar';
    }
}

/**
 * Realiza o download do pedido e atualiza o contador.
 */
async function handleDownloadPedido(materialId, fileURL) {
    if (!isReady() || !materialId || !fileURL) return;

    const material = getMateriais().find(m => m.id === materialId);
    if (!material) {
        // Usa o alerta da view "Para Separar" como fallback se não encontrar outro
        showAlert('alert-para-separar', 'Erro: Registro não encontrado.', 'error'); 
        return;
    }

    const alertId = 'alert-para-separar'; // Assume que o download é mais comum nesta fase

    const now = Timestamp.now();
    const downloadInfo = material.downloadInfo || { count: 0, lastDownload: null, blockedUntil: null };

    // Verifica se está bloqueado
    if (downloadInfo.blockedUntil && downloadInfo.blockedUntil.toMillis() > now.toMillis()) {
        const blockTimeRemaining = Math.ceil((downloadInfo.blockedUntil.toMillis() - now.toMillis()) / (60 * 1000));
        showAlert(alertId, `Download temporariamente bloqueado. Tente novamente em ${blockTimeRemaining} minuto(s).`, 'warning');
        return;
    }

    // Verifica limite de downloads (Exemplo: Limite de 2 downloads)
    const DOWNLOAD_LIMIT = 2; 
    // Duração do bloqueio em minutos após atingir o limite
    const BLOCK_DURATION_MINUTES = 3; 

    if (downloadInfo.count >= DOWNLOAD_LIMIT) {
        showAlert(alertId, `Limite de ${DOWNLOAD_LIMIT} downloads atingido para este pedido.`, 'warning');
        // Bloqueia por X minutos se ainda não estiver bloqueado ou se o bloqueio expirou
        if (!downloadInfo.blockedUntil || downloadInfo.blockedUntil.toMillis() <= now.toMillis()){
            const blockedUntil = Timestamp.fromMillis(now.toMillis() + BLOCK_DURATION_MINUTES * 60 * 1000);
            try {
                const docRef = doc(COLLECTIONS.materiais, materialId);
                await updateDoc(docRef, { 'downloadInfo.blockedUntil': blockedUntil });
            } catch (error) { console.error("Erro ao bloquear download:", error); }
        }
        return;
    }

    // Incrementa contador e registra download
    const newCount = downloadInfo.count + 1;
    let newBlockedUntil = downloadInfo.blockedUntil; // Mantém bloqueio existente se houver

    // Se atingiu o limite AGORA, define o bloqueio
    if (newCount === DOWNLOAD_LIMIT) {
        newBlockedUntil = Timestamp.fromMillis(now.toMillis() + BLOCK_DURATION_MINUTES * 60 * 1000);
    }

    try {
        const docRef = doc(COLLECTIONS.materiais, materialId);
        await updateDoc(docRef, {
            'downloadInfo.count': newCount,
            'downloadInfo.lastDownload': now,
            'downloadInfo.blockedUntil': newBlockedUntil // Atualiza mesmo se for null
        });

        window.open(fileURL, '_blank'); // Abre o link de download

        if (newBlockedUntil && newCount === DOWNLOAD_LIMIT) {
            showAlert(alertId, `Download ${newCount}/${DOWNLOAD_LIMIT} realizado. Próximo download bloqueado por ${BLOCK_DURATION_MINUTES} min.`, 'info', 6000);
        } else {
            showAlert(alertId, `Download ${newCount}/${DOWNLOAD_LIMIT} realizado.`, 'info', 4000);
        }

    } catch (error) {
        console.error("Erro ao registrar download:", error);
        showAlert(alertId, `Erro ao registrar download: ${error.message}`, 'error');
    }
}


// =========================================================================
// INICIALIZAÇÃO DE LISTENERS DO DOM
// =========================================================================

export function initMateriaisListeners() {
    // CORREÇÃO: DOM_ELEMENTS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.formMateriais) {
        DOM_ELEMENTS.formMateriais.addEventListener('submit', handleMateriaisSubmit);
    }

    // Listener de clique centralizado para as tabelas de workflow e botões
    const contentMateriais = document.querySelector('#content-materiais');
    if (contentMateriais) {
        contentMateriais.addEventListener('click', (e) => {
            const retiradaBtn = e.target.closest('button.btn-retirada[data-id]');
            const entregueBtn = e.target.closest('button.btn-entregue[data-id]');
            const startSeparacaoBtn = e.target.closest('button.btn-start-separacao[data-id]');
            const downloadPedidoBtn = e.target.closest('button.btn-download-pedido[data-id]');

            if (retiradaBtn) {
                 handleMarcarRetirada(e);
            } else if (entregueBtn) {
                 handleMarcarEntregue(e);
            } else if (startSeparacaoBtn) {
                 openSeparadorModal(startSeparacaoBtn.dataset.id);
            } else if (downloadPedidoBtn) {
                 handleDownloadPedido(downloadPedidoBtn.dataset.id, downloadPedidoBtn.dataset.url);
            }
        });
    }

    // Listener para o modal do separador
    if (DOM_ELEMENTS.btnSalvarSeparador) {
        DOM_ELEMENTS.btnSalvarSeparador.addEventListener('click', handleSalvarSeparador);
    }
    // Listener para o modal de finalização de entrega
    if (DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega) {
        DOM_ELEMENTS.btnConfirmarFinalizacaoEntrega.addEventListener('click', handleFinalizarEntregaSubmit);
    }
    // Listeners para filtros de busca (Histórico)
    if (document.getElementById('filtro-historico-entregues')) {
        document.getElementById('filtro-historico-entregues').addEventListener('input', () => filterTable(document.getElementById('filtro-historico-entregues'), 'table-historico-entregues'));
    }

    // Novos filtros de Histórico: Unidade e Período
    const unidadeHistorico = document.getElementById('select-historico-unidade');
    const inicioHistorico = document.getElementById('historico-inicio');
    const fimHistorico = document.getElementById('historico-fim');
    if (unidadeHistorico) unidadeHistorico.addEventListener('change', renderMateriaisStatus);
    if (inicioHistorico) inicioHistorico.addEventListener('change', renderMateriaisStatus);
    if (fimHistorico) fimHistorico.addEventListener('change', renderMateriaisStatus);

    const btnLimparFiltros = document.getElementById('btn-limpar-filtros-historico');
    if (btnLimparFiltros) btnLimparFiltros.addEventListener('click', () => {
        const filtroTexto = document.getElementById('filtro-historico-entregues');
        if (filtroTexto) filtroTexto.value = '';
        if (unidadeHistorico) unidadeHistorico.value = 'todas';
        if (inicioHistorico) inicioHistorico.value = '';
        if (fimHistorico) fimHistorico.value = '';
        renderMateriaisStatus();
    });

    // Batch finalize (Hoje)
    const btnBatchHoje = document.getElementById('btn-batch-finalizar-hoje');
    if (btnBatchHoje) {
        const role = getUserRole();
        btnBatchHoje.classList.toggle('hidden', role !== 'admin');
        btnBatchHoje.addEventListener('click', handleBatchFinalizarHoje);
    }

    // **** ADICIONADO: Listener para a sub-navegação ****
    const subNavMateriais = document.getElementById('sub-nav-materiais');
    if (subNavMateriais) {
        subNavMateriais.addEventListener('click', (e) => {
            const btn = e.target.closest('.sub-nav-btn');
            if (btn && btn.dataset.subview) {
                switchSubTabView('materiais', btn.dataset.subview);
            }
        });
    }
    // **** FIM DA ADIÇÃO ****
}

/**
 * Função de orquestração para a tab de Materiais.
 */
export function onMateriaisTabChange() {
    // Define a subview inicial ao carregar a aba
    // MELHORIA: Ao entrar na aba, se não houver subview ativa, define o default
    const activeSubView = document.querySelector('#sub-nav-materiais .sub-nav-btn.active')?.dataset.subview;
    if (!activeSubView) {
        switchSubTabView('materiais', 'lancar-materiais'); 
    }
    
    renderMateriaisStatus(); 
    // CORREÇÃO: DOM_ELEMENTS -> DOM_ELEMENTS
    if (DOM_ELEMENTS.inputDataSeparacao) DOM_ELEMENTS.inputDataSeparacao.value = getTodayDateString();
}
// ============================
// Configurações de SLA
// ============================
const SLA_SEPARACAO_WARN_HOURS = 12;   // aviso
const SLA_SEPARACAO_CRIT_HOURS = 24;   // crítico
const SLA_RETIRADA_WARN_HOURS  = 12;   // aviso
const SLA_RETIRADA_CRIT_HOURS  = 24;   // crítico
