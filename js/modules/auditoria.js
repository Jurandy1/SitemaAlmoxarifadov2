// js/modules/auditoria.js — tela "Auditoria" (só admin).
// Os registros são gravados pelo banco (scripts/supabase/006_auditoria.sql) a cada exclusão em fs_docs.
import {
  supabase,
  getDispositivoAtual,
  DISPOSITIVO_NOME_KEY,
} from "../compat/supabase-client.js";
import { showAlert } from "../utils/dom-helpers.js";
import { getUserRole } from "../utils/cache.js";

const PAGINA = 100;
let _linhas = [];
let _fim = false;
let _carregando = false;

const NOMES_COLECAO = {
  controleMateriais: "Requisição de materiais",
  semcasHistDB: "Planilha do histórico",
  controleAgua: "Movimentação de água",
  controleGas: "Movimentação de gás",
};

const $ = (id) => document.getElementById(id);

function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function dataHoraBrasilia(iso) {
  try {
    return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch (_) {
    return iso || "";
  }
}

function decodificar(v) {
  try {
    return decodeURIComponent(v || "");
  } catch (_) {
    return v || "";
  }
}

function navegadorCurto(ua) {
  const s = String(ua || "");
  const nav = /Edg\//.test(s) ? "Edge" : /OPR\//.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "";
  const so = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad/.test(s) ? "iOS" : /Mac OS/.test(s) ? "Mac" : /Linux/.test(s) ? "Linux" : "";
  return [nav, so].filter(Boolean).join(" / ") || (s ? s.slice(0, 40) : "");
}

function inicioDoDia(isoDate) {
  return isoDate ? new Date(`${isoDate}T00:00:00-03:00`).toISOString() : null;
}
function fimDoDia(isoDate) {
  return isoDate ? new Date(`${isoDate}T23:59:59.999-03:00`).toISOString() : null;
}

async function buscar(reiniciar) {
  if (_carregando) return;
  if (getUserRole() !== "admin") {
    showAlert("alert-auditoria", "Apenas administradores podem ver a auditoria.", "error");
    return;
  }
  _carregando = true;
  if (reiniciar) {
    _linhas = [];
    _fim = false;
    $("table-auditoria").innerHTML = `<tr><td colspan="6" class="text-center py-10"><div class="loading-spinner-small mx-auto"></div></td></tr>`;
  }
  try {
    let q = supabase
      .from("auditoria")
      .select("id,quando,acao,colecao,doc_id,resumo,usuario_email,usuario_papel,ip,ip_cadeia,navegador,dispositivo_id,dispositivo_nome")
      .order("quando", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGINA);

    const colecao = $("aud-colecao")?.value || "";
    if (colecao) q = q.eq("colecao", colecao);
    const de = inicioDoDia($("aud-de")?.value);
    const ate = fimDoDia($("aud-ate")?.value);
    if (de) q = q.gte("quando", de);
    if (ate) q = q.lte("quando", ate);
    const busca = ($("aud-busca")?.value || "").trim().replace(/[,()*%]/g, " ").trim();
    if (busca) {
      const t = `*${busca}*`;
      q = q.or(`usuario_email.ilike.${t},ip.ilike.${t},dispositivo_id.ilike.${t},dispositivo_nome.ilike.${t},resumo.ilike.${t}`);
    }
    const ultimo = _linhas[_linhas.length - 1];
    if (ultimo) q = q.lt("id", ultimo.id);

    const { data, error } = await q;
    if (error) throw error;
    _linhas = _linhas.concat(data || []);
    _fim = (data || []).length < PAGINA;
    render();
  } catch (e) {
    console.error("Erro ao carregar auditoria:", e);
    const msg = String(e?.message || e);
    const semTabela = /auditoria/.test(msg) && /(does not exist|not find|schema cache)/i.test(msg);
    showAlert(
      "alert-auditoria",
      semTabela
        ? "A auditoria ainda não foi instalada no banco. Rode o arquivo scripts/supabase/006_auditoria.sql no SQL Editor do Supabase."
        : "Erro ao carregar auditoria: " + msg,
      "error",
      0
    );
    if (reiniciar) $("table-auditoria").innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-400">Sem dados.</td></tr>`;
  } finally {
    _carregando = false;
  }
}

function render() {
  const tb = $("table-auditoria");
  if (!tb) return;
  if (!_linhas.length) {
    tb.innerHTML = `<tr><td colspan="6" class="text-center py-10 text-gray-400">Nenhuma exclusão encontrada.</td></tr>`;
  } else {
    tb.innerHTML = _linhas
      .map((r) => {
        const tipo = NOMES_COLECAO[r.colecao] || r.colecao;
        const suave = r.acao === "exclusao_suave" ? ' <span class="text-xs text-amber-600">(marcado como excluído)</span>' : "";
        const nomePc = decodificar(r.dispositivo_nome);
        const pc = nomePc ? `<b>${esc(nomePc)}</b><br><span class="text-xs text-gray-400">${esc(r.dispositivo_id || "")}</span>` : esc(r.dispositivo_id || "—");
        const ipTitulo = r.ip_cadeia && r.ip_cadeia !== r.ip ? ` title="${esc(r.ip_cadeia)}"` : "";
        return `<tr>
          <td class="whitespace-nowrap">${esc(dataHoraBrasilia(r.quando))}</td>
          <td>${esc(r.usuario_email || "(sem login)")}<br><span class="text-xs text-gray-400">${esc(r.usuario_papel || "")}</span></td>
          <td><b>${esc(tipo)}</b>${suave}<br><span class="text-xs text-gray-600">${esc(r.resumo || "id " + r.doc_id)}</span></td>
          <td class="whitespace-nowrap"${ipTitulo}>${esc(r.ip || "—")}</td>
          <td>${pc}<br><span class="text-xs text-gray-400">${esc(navegadorCurto(r.navegador))}</span></td>
          <td class="whitespace-nowrap"><button type="button" class="btn-secondary text-xs" data-aud-ver="${esc(r.id)}">Ver / restaurar</button></td>
        </tr>`;
      })
      .join("");
  }
  $("aud-contagem").textContent = `${_linhas.length} registro(s)${_fim ? "" : " — há mais"}`;
  $("btn-aud-mais")?.classList.toggle("hidden", _fim);
}

async function verDetalhe(id) {
  const linhaBtn = document.querySelector(`[data-aud-ver="${CSS.escape(String(id))}"]`);
  const tr = linhaBtn?.closest("tr");
  if (!tr) return;
  const aberto = tr.nextElementSibling?.dataset?.audDetalhe === String(id);
  if (aberto) {
    tr.nextElementSibling.remove();
    return;
  }
  const { data, error } = await supabase.from("auditoria").select("colecao_caminho,doc_id,dados,acao").eq("id", id).maybeSingle();
  if (error || !data) {
    showAlert("alert-auditoria", "Não foi possível abrir o registro: " + (error?.message || "não encontrado"), "error");
    return;
  }
  const det = document.createElement("tr");
  det.dataset.audDetalhe = String(id);
  det.innerHTML = `<td colspan="6" class="bg-gray-50">
    <div class="flex justify-between items-center mb-2">
      <span class="text-xs text-gray-500">Cópia do que foi excluído (${esc(data.colecao_caminho)} / ${esc(data.doc_id)})</span>
      ${data.acao === "exclusao" ? `<button type="button" class="btn-primary text-xs" data-aud-restaurar="${esc(id)}">Restaurar</button>` : ""}
    </div>
    <pre class="text-xs whitespace-pre-wrap max-h-80 overflow-auto bg-white border border-gray-200 rounded p-2">${esc(JSON.stringify(data.dados, null, 2))}</pre>
  </td>`;
  tr.after(det);
  det._dadosAuditoria = data;
}

async function restaurar(id) {
  const det = document.querySelector(`tr[data-aud-detalhe="${CSS.escape(String(id))}"]`);
  const reg = det?._dadosAuditoria;
  if (!reg) return;
  const { data: existente } = await supabase.from("fs_docs").select("id").eq("col", reg.colecao_caminho).eq("id", reg.doc_id).maybeSingle();
  if (existente) {
    showAlert("alert-auditoria", "Já existe um documento com esse número no sistema. Nada foi alterado.", "warning");
    return;
  }
  if (!confirm("Restaurar este item? Ele volta para o sistema exatamente como estava antes de ser excluído.")) return;
  const { error } = await supabase.rpc("fs_write", { p_col: reg.colecao_caminho, p_id: reg.doc_id, p_data: reg.dados, p_mode: "set" });
  if (error) {
    showAlert("alert-auditoria", "Erro ao restaurar: " + error.message, "error");
    return;
  }
  showAlert("alert-auditoria", "Item restaurado. Atualize a tela de Materiais para vê-lo.", "success");
}

function salvarNomeDispositivo() {
  const nome = ($("aud-disp-nome")?.value || "").trim().slice(0, 60);
  try {
    if (nome) localStorage.setItem(DISPOSITIVO_NOME_KEY, nome);
    else localStorage.removeItem(DISPOSITIVO_NOME_KEY);
  } catch (_) {
    showAlert("alert-auditoria", "Este navegador não permite salvar o nome.", "error");
    return;
  }
  showAlert("alert-auditoria", "Nome salvo. A página vai recarregar para aplicar.", "success");
  setTimeout(() => location.reload(), 1200);
}

export function initAuditoriaListeners() {
  const disp = getDispositivoAtual();
  if ($("aud-disp-id")) $("aud-disp-id").textContent = disp.id || "(indisponível)";
  if ($("aud-disp-nome")) $("aud-disp-nome").value = disp.nome || "";

  $("btn-aud-buscar")?.addEventListener("click", () => buscar(true));
  $("btn-aud-mais")?.addEventListener("click", () => buscar(false));
  $("aud-busca")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") buscar(true);
  });
  $("btn-aud-disp-salvar")?.addEventListener("click", salvarNomeDispositivo);
  $("table-auditoria")?.addEventListener("click", (e) => {
    const ver = e.target.closest("[data-aud-ver]");
    if (ver) return verDetalhe(ver.dataset.audVer);
    const rest = e.target.closest("[data-aud-restaurar]");
    if (rest) return restaurar(rest.dataset.audRestaurar);
  });

  // Carrega automaticamente ao abrir o menu
  document.querySelector('.nav-btn[data-tab="auditoria"]')?.addEventListener("click", () => {
    if (!_linhas.length) setTimeout(() => buscar(true), 0);
  });
}
