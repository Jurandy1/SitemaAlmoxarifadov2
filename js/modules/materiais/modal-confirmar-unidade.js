let _esc = (v) => String(v ?? "");

function showUnitConfirmDialog(unitName, deps) {
  if (deps?.esc) _esc = deps.esc;

  return new Promise((resolve) => {
    const modal = document.getElementById("fichaModal");
    const toolbar = modal.querySelector(".modal-toolbar");
    const legend = document.getElementById("fichaModalLegend");
    const actions = document.getElementById("fichaModalActions");
    const body = document.getElementById("fichaBody");
    const stats = document.getElementById("fichaStats");
    if (!modal || !body) {
      resolve(true);
      return;
    }

    if (toolbar) toolbar.querySelector(".title").textContent = "✅ Confirmar Unidade";
    if (stats) stats.innerHTML = "";
    if (actions) actions.style.display = "none";
    if (legend) legend.style.display = "none";

    body.innerHTML = `
      <div style="padding:28px 20px;text-align:center;max-width:480px;margin:0 auto">
        <div style="font-size:44px;margin-bottom:12px">🏢</div>
        <h2 style="font-size:17px;font-weight:800;margin:0 0 8px">Confirmar Unidade</h2>
        <p style="font-size:13px;color:#64748b;margin:0 0 18px">A requisição será registrada para a seguinte unidade:</p>
        <div style="background:#eff6ff;border:2px solid #2563eb;border-radius:12px;padding:14px 18px;margin-bottom:24px">
          <div style="font-size:18px;font-weight:800;color:#1e40af">${_esc(unitName)}</div>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0 0 22px">Esta unidade está <b>correta</b>?</p>
        <div style="display:flex;gap:10px;justify-content:center">
          <button class="btn btn-s" style="min-width:120px;border-color:#ef4444;color:#ef4444"
            onclick="window.__unitConfirmResolve(false)">
            ✗ Não / Corrigir
          </button>
          <button class="btn btn-p" style="min-width:140px"
            onclick="window.__unitConfirmResolve(true)">
            ✓ Sim, registrar
          </button>
        </div>
      </div>`;

    window.__unitConfirmResolve = (result) => {
      modal.classList.remove("open");
      window.__unitConfirmResolve = null;
      resolve(result);
    };

    modal.classList.add("open");
  });
}

export { showUnitConfirmDialog };
