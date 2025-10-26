// js/modules/previsao.js
// Este novo arquivo contém toda a lógica para a funcionalidade de Previsão Inteligente.
import { Timestamp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";
import { 
// ... código existente ...
} from "../utils/cache.js";
import { showAlert } from "../utils/dom-helpers.js";

/**
 * Seleciona o modo de previsão (unidade, tipo, completo) e atualiza a UI.
// ... código existente ...
 */
function selecionarModoPrevisao(itemType, modo) {
    // ... código existente ...
    console.log(`[Previsão ${itemType}] Modo selecionado: ${modo}`); // Log Adicionado
    // ... código existente ...
}

/**
 * Renderiza a lista de unidades excluídas na UI.
// ... código existente ...
 */
function renderListaExclusoes(itemType) {
    // ... código existente ...
    console.log(`[Previsão ${itemType}] Renderizando lista de exclusões:`, listaExclusoes[itemType]); // Log Adicionado
    // ... código existente ...
}

/**
 * Adiciona uma unidade à lista de exclusão.
// ... código existente ...
 */
function adicionarExclusao(itemType) {
    // ... código existente ...
    console.log(`[Previsão ${itemType}] Tentando adicionar exclusão: ${unidadeId}`); // Log Adicionado
    // ... código existente ...
}

/**
 * Remove uma unidade da lista de exclusão.
// ... código existente ...
 */
function removerExclusao(itemType, unidadeId) {
    // ... código existente ...
    console.log(`[Previsão ${itemType}] Removendo exclusão: ${unidadeId}`); // Log Adicionado
    // ... código existente ...
}

/**
 * Renderiza o gráfico de previsão.
// ... código existente ...
 */
function renderGraficoPrevisao(itemType, data) {
    // ... código existente ...
    console.log(`[Previsão ${itemType}] Renderizando gráfico.`); // Log Adicionado
    // ... código existente ...
}

/**
 * Função principal que calcula a previsão inteligente.
 * @param {string} itemType 'agua' ou 'gas'.
 */
function calcularPrevisaoInteligente(itemType) {
    console.log(`[Previsão ${itemType}] Iniciando cálculo...`); // Log Adicionado
    
    const alertId = `alertas-previsao-${itemType}`;
// ... código existente ...
    console.log(`[Previsão ${itemType}] Inputs coletados: Dias=${diasPrevisao}, Margem=${margemSeguranca}, Modo=${modo}`); // Log Adicionado

    // Desabilitar botão
    btn.disabled = true;
// ... código existente ...
        try {
            console.log(`[Previsão ${itemType}] Coletando e filtrando dados...`); // Log Adicionado
            // 2. Coletar Dados
            const movimentacoes = (itemType === 'agua') ? getAguaMovimentacoes() : getGasMovimentacoes();
            const unidades = getUnidades();
// ... código existente ...
            console.log(`[Previsão ${itemType}] Modo: ${modo}. Movimentações filtradas: ${movsFiltradas.length}`); // Log Adicionado

            // Validação de dados suficientes APÓS o filtro
            if (movsFiltradas.length < 2) {
// ... código existente ...
            }

            console.log(`[Previsão ${itemType}] Calculando média diária...`); // Log Adicionado
            // 4. Calcular Média Diária
            const primeiraMov = movsFiltradas[0].data.toMillis();
            const ultimaMov = movsFiltradas[movsFiltradas.length - 1].data.toMillis();
// ... código existente ...
            const mediaDiaria = totalConsumido / totalDiasHistorico;
            console.log(`[Previsão ${itemType}] Média diária calculada: ${mediaDiaria}`); // Log Adicionado


            if (totalDiasHistorico < 30) {
                 // Usa append para não sobrescrever outros alertas
// ... código existente ...
            }

            console.log(`[Previsão ${itemType}] Calculando previsão final...`); // Log Adicionado
            // 5. Calcular Previsão
            const previsaoBase = mediaDiaria * diasPrevisao;
            const valorMargem = previsaoBase * (margemSeguranca / 100);
// ... código existente ...
            console.log(`[Previsão ${itemType}] Previsão final: ${previsaoFinal}`); // Log Adicionado

            // 6. Renderizar Resultados
            const unidadesExcluidasNomes = exclusoes.map(id => unidades.find(u => u.id === id)?.nome || `ID:${id.substring(0,4)}`).sort();
            
// ... código existente ...

            console.log(`[Previsão ${itemType}] Preparando dados do gráfico...`); // Log Adicionado
            // 7. Renderizar Gráfico
            const chartData = {
                // Usa Math.ceil no valor previsto para o gráfico ficar mais claro
// ... código existente ...
            };
            renderGraficoPrevisao(itemType, chartData);
            console.log(`[Previsão ${itemType}] Cálculo concluído com sucesso.`); // Log Adicionado


        } catch (error) {
            console.error(`[Previsão ${itemType}] Erro durante o cálculo:`, error); // Log Adicionado
            // Mostrar alerta apenas se não for um erro esperado (já tratado com showAlert antes)
// ... código existente ...
        } finally {
            // Reabilitar botão
            btn.disabled = false;
// ... código existente ...
            console.log(`[Previsão ${itemType}] Botão reabilitado.`); // Log Adicionado
        }
    }, 50); // Pequeno delay para UI
}

/**
 * Adiciona os event listeners corretos para a UI de previsão.
// ... código existente ...
 */
export function initPrevisaoListeners() {
    
    // --- Listeners para ÁGUA ---
// ... código existente ...

    console.log("[Previsão] Listeners inicializados."); // Log Adicionado
}
