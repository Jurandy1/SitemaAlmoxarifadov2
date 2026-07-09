(function () {
  if (typeof window === "undefined") return;

  // Mapa de ícones (SVG paths)
  const iconDefs = {
    "trash-2": `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>`,
    slash: `<path d="M16 2L8 22"></path>`,
    pencil: `<path d="M17 3a2.85 2.85 0 0 1 4 4L7 21l-4 1 1-4 14-14z"></path><path d="M15 5l4 4"></path>`,
    handshake: `<path d="M7 12l-2 2a2 2 0 0 0 0 3l1 1a2 2 0 0 0 3 0l2-2"></path><path d="M17 12l2-2a2 2 0 0 0 0-3l-1-1a2 2 0 0 0-3 0l-2 2"></path><path d="M8 11l4-4a2 2 0 0 1 3 0l1 1"></path><path d="M6 14l1 1a2 2 0 0 0 3 0l3-3"></path>`,
    home: `<path d="M3 10l9-7 9 7"></path><path d="M9 22V12h6v10"></path><path d="M21 22H3"></path>`,
    droplet: `<path d="M12 2s7 7 7 13a7 7 0 0 1-14 0c0-6 7-13 7-13z"></path>`,
    flame: `<path d="M8.5 14.5c0-2 1.5-3.5 3.5-4.5 0 0 0 2 1 3 1 1 3 1.5 3 4a4 4 0 0 1-8 0c0-.6.1-1.2.5-2.5z"></path><path d="M12 2c1.5 3 .5 5-1 7"></path>`,
    truck: `<rect x="1" y="3" width="15" height="13" rx="2"></rect><path d="M16 8h4l3 3v5h-7"></path><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle>`,
    settings: `<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.7 2.94-.08-.03a1.65 1.65 0 0 0-1.8.33l-.06.06a1.65 1.65 0 0 0-1.82.33l-.06.06-2.94-1.7.03-.08a1.65 1.65 0 0 0-.33-1.8l-.06-.06a1.65 1.65 0 0 0-.33-1.82l-.06-.06 1.7-2.94.08.03a1.65 1.65 0 0 0 1.8-.33l.06-.06a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.94 1.7-.03.08a1.65 1.65 0 0 0 .33 1.8l.06.06z"></path>`,
    "settings-2": `<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-1.7 2.94-.08-.03a1.65 1.65 0 0 0-1.8.33l-.06.06a1.65 1.65 0 0 0-1.82.33l-.06.06-2.94-1.7.03-.08a1.65 1.65 0 0 0-.33-1.8l-.06-.06a1.65 1.65 0 0 0-.33-1.82l-.06-.06 1.7-2.94.08.03a1.65 1.65 0 0 0 1.8-.33l.06-.06a1.65 1.65 0 0 0 1.82-.33l.06-.06 2.94 1.7-.03.08a1.65 1.65 0 0 0 .33 1.8l.06.06z"></path>`,
    users: `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>`,
    "calendar-days": `<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line><path d="M8 14h.01"></path><path d="M12 14h.01"></path><path d="M16 14h.01"></path><path d="M8 18h.01"></path><path d="M12 18h.01"></path><path d="M16 18h.01"></path>`,
    calendar: `<rect x="3" y="4" width="18" height="18" rx="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>`,
    "file-text": `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><line x1="10" y1="9" x2="8" y2="9"></line>`,
    monitor: `<rect x="2" y="3" width="20" height="14" rx="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line>`,
    menu: `<line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line>`,
    "log-out": `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>`,
    "alert-triangle": `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>`,
    upload: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>`,
    "plus-circle": `<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line>`,
    save: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline>`,
    "x-circle": `<circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line>`,
    "loader-2": `<path d="M21 12a9 9 0 1 1-9-9"></path>`,
    x: `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`,
    info: `<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>`,
    "arrow-up-right-square": `<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M10 14l7-7"></path><path d="M10 7h7v7"></path>`,
    "arrow-down-left-square": `<rect x="3" y="3" width="18" height="18" rx="2"></rect><path d="M14 10l-7 7"></path><path d="M7 10v7h7"></path>`,
    database: `<ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M3 5v6c0 1.66 4.03 3 9 3s9-1.34 9-3V5"></path><path d="M3 11v6c0 1.66 4.03 3 9 3s9-1.34 9-3v-6"></path>`,
    eraser: `<path d="M20 20H8l-4-4a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l4 4a2 2 0 0 1 0 3l-6 6"></path><path d="M6 16h8"></path>`,
    "check-check": `<path d="M18 6L7 17"></path><path d="M7 17l-4-4"></path><path d="M22 6l-7 7"></path><path d="M15 13l-2-2"></path>`,
    "user-x": `<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><line x1="18" y1="8" x2="23" y2="13"></line><line x1="23" y1="8" x2="18" y2="13"></line>`,
    "shopping-basket": `<path d="M7 10l5-6 5 6"></path><path d="M4 10l2 11h12l2-11"></path><path d="M6 10h12"></path><path d="M9 14v5"></path><path d="M12 14v5"></path><path d="M15 14v5"></path>`,
    baby: `<path d="M9 12a3 3 0 0 1 6 0"></path><circle cx="12" cy="7" r="4"></circle><path d="M7 14a5 5 0 0 0 10 0"></path><path d="M10 9h.01"></path><path d="M14 9h.01"></path>`,
    "clipboard-paste": `<rect x="9" y="2" width="6" height="4" rx="1"></rect><path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"></path><path d="M12 12v6"></path><path d="M9 15h6"></path>`,
    "edit-3": `<path d="M12 20h9"></path><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"></path>`,
    box: `<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="M3.3 7l8.7 5 8.7-5"></path><path d="M12 22V12"></path>`,
    package: `<path d="M16.5 9.4L7.5 4.2"></path><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><path d="M3.3 7l8.7 5 8.7-5"></path><path d="M12 22V12"></path>`,
    history: `<path d="M3 12a9 9 0 1 0 3-6.7"></path><polyline points="3 3 3 9 9 9"></polyline><path d="M12 7v5l3 3"></path>`,
    filter: `<polygon points="22 3 2 3 10 12 10 19 14 21 14 12 22 3"></polygon>`,
    send: `<line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>`,
    "clipboard-list": `<rect x="9" y="2" width="6" height="4" rx="1"></rect><path d="M9 4H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2"></path><line x1="9" y1="12" x2="15" y2="12"></line><line x1="9" y1="16" x2="15" y2="16"></line>`,
    "arrow-down-circle": `<circle cx="12" cy="12" r="10"></circle><polyline points="8 12 12 16 16 12"></polyline><line x1="12" y1="8" x2="12" y2="16"></line>`,
    check: `<polyline points="20 6 9 17 4 12"></polyline>`,
    "refresh-cw": `<path d="M21 12a9 9 0 0 0-9-9 9 9 0 0 0-6.36 2.64"></path><polyline points="3 3 3 9 9 9"></polyline><path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 6.36-2.64"></path><polyline points="21 21 21 15 15 15"></polyline>`,
    "shield-check": `<path d="M12 2l8 4v6c0 5-3.5 9.5-8 10-4.5-.5-8-5-8-10V6l8-4z"></path><polyline points="9 12 11 14 15 10"></polyline>`,
    sparkles: `<path d="M12 2l1.2 4.2L17.4 7.4l-4.2 1.2L12 12l-1.2-3.4L6.6 7.4l4.2-1.2L12 2z"></path><path d="M4 14l.8 2.8L7.6 18l-2.8.8L4 22l-.8-3.2L.4 18l2.8-1.2L4 14z"></path><path d="M20 14l.8 2.8L23.6 18l-2.8.8L20 22l-.8-3.2L16.4 18l2.8-1.2L20 14z"></path>`,
    eye: `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"></path><circle cx="12" cy="12" r="3"></circle>`,
    "mouse-pointer-click": `<path d="M9 9l6 6"></path><path d="M9 15l6-6"></path><path d="M12 3v3"></path><path d="M3 12h3"></path><path d="M18 12h3"></path><path d="M12 18v3"></path>`,
    "log-in": `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path><polyline points="10 17 15 12 10 7"></polyline><line x1="15" y1="12" x2="3" y2="12"></line>`,
    download: `<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>`,
    paperclip: `<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>`,
    "play-circle": `<circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon>`,
    lock: `<rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path>`,
    "package-check": `<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line><path d="m9 12 2 2 4-4"></path>`,
    "check-circle": `<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline>`
  };

  const makeSvg = (name) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    
    // Adicionando width/height explicitamente para evitar problemas de renderização
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    
    svg.setAttribute("class", `lucide lucide-${name}`);
    
    const inner = iconDefs[name] || `<rect x="4" y="4" width="16" height="16" rx="2"></rect>`;
    svg.innerHTML = inner;
    return svg;
  };

  const replaceOne = (el) => {
    const name = el.getAttribute("data-lucide");
    if (!name) return;
    if (String(el.tagName || "").toLowerCase() === "svg") return;
    
    const svg = makeSvg(name);

    const className = el.getAttribute("class");
    if (className) svg.setAttribute("class", `${svg.getAttribute("class")} ${className}`.trim());

    const style = el.getAttribute("style");
    if (style) svg.setAttribute("style", style);

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) svg.setAttribute("aria-label", ariaLabel);
    svg.setAttribute("role", "img");

    el.replaceWith(svg);
  };

  const fallbackCreateIcons = (options) => {
    const root = options && options.root ? options.root : document;
    // Seleciona todos os elementos com data-lucide
    root.querySelectorAll("[data-lucide]").forEach(replaceOne);
  };

  let __scheduled = false;
  const scheduleEnsure = () => {
    if (__scheduled) return;
    __scheduled = true;
    setTimeout(() => {
      __scheduled = false;
      try { window.ensureLucideIcons(); } catch (_) {}
    }, 50);
  };

  // Expõe a função de fallback globalmente para ser usada diretamente
  window.ensureLucideIcons = () => {
     fallbackCreateIcons();
     // Tenta chamar o original também, se existir
     if (window.lucide && typeof window.lucide.createIcons === 'function' && window.lucide.createIcons !== window.ensureLucideIcons) {
         try { window.lucide.createIcons(); } catch(e) {}
     }
  };

  // Shim do Lucide
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    const original = window.lucide.createIcons.bind(window.lucide);
    window.lucide.createIcons = (options) => {
      try { original(options); } catch (_) {}
      try { fallbackCreateIcons(options); } catch (_) {}
    };
  } else {
    window.lucide = { createIcons: fallbackCreateIcons };
  }

  // Auto-executa ao carregar o DOM para garantir ícones iniciais
  if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', window.ensureLucideIcons);
  } else {
      window.ensureLucideIcons();
  }

  const startObserver = () => {
    try {
      const target = document.body || document.documentElement;
      if (!target) return;
      const observer = new MutationObserver((mutations) => {
        for (const m of mutations) {
          if (!m.addedNodes || m.addedNodes.length === 0) continue;
          for (const node of m.addedNodes) {
            if (!node || node.nodeType !== 1) continue;
            const el = node;
            if (el.hasAttribute && el.hasAttribute("data-lucide")) {
              scheduleEnsure();
              return;
            }
            if (el.querySelector && el.querySelector("[data-lucide]")) {
              scheduleEnsure();
              return;
            }
          }
        }
      });
      observer.observe(target, { childList: true, subtree: true });
    } catch (_) {}
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserver);
  } else {
    startObserver();
  }

})();
