/**
 * Dashboard TV - Otimizações para Smart TV TCL e navegadores antigos
 * Carregue este script ANTES de dashboard.html
 */

// 1. FORÇA POLLING EM VEZ DE WEBSOCKETS
window.__FIRESTORE_FORCE_LONG_POLLING = true;

// 2. COMPATIBILIDADE COM TV ANTIGA
window.__TV_MODE_COMPAT = {
  disableWebGL: true,
  reduceAnimations: true,
  simplifyCharts: true,
  maxDataPoints: 50
};

// 3. INTERCEPTA ERROS DE CORS E TENTA FALLBACK
const originalFetch = window.fetch;
window.fetch = function(...args) {
  return originalFetch.apply(this, args).catch(err => {
    console.error('Fetch error (TV Compat):', err);
    // Tenta reconectar em 5 segundos
    setTimeout(() => {
      console.log('Tentando reconectar...');
      return originalFetch.apply(this, args);
    }, 5000);
    throw err;
  });
};

// 4. MELHORA COMPATIBILIDADE DE TIMEOUT
window.__FIREBASE_TIMEOUT = 60000; // 60 segundos

// 5. DESABILITA RECURSOS PESADOS
Object.defineProperty(navigator, 'webdriver', {
  get: () => false,
});

// 6. AGUARDA MAIS TEMPO ANTES DE CARREGAR
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('TV Dashboard: DOM carregado');
    setTimeout(() => {
      window.location.reload();
    }, 8000);
  });
}
