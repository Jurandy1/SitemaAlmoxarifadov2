let tooltipEl = null;
let activeTarget = null;
let rafId = 0;

function ensureTooltip() {
    if (tooltipEl) return tooltipEl;
    const el = document.createElement('div');
    el.className = 'tooltip-bubble';
    el.setAttribute('role', 'tooltip');
    document.body.appendChild(el);
    tooltipEl = el;
    return el;
}

function getText(target) {
    const data = target.getAttribute('data-tooltip');
    if (data && data.trim()) return data.trim();
    const title = target.getAttribute('title');
    if (title && title.trim()) return title.trim();
    return '';
}

function normalizeTarget(target) {
    if (!target) return null;
    const el = target.closest?.('[data-tooltip], [title]');
    if (!el) return null;
    if (el.hasAttribute('data-tooltip-ignore')) return null;
    const text = getText(el);
    if (!text) return null;

    if (el.hasAttribute('title')) {
        if (!el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) {
            el.setAttribute('aria-label', text);
        }
        el.setAttribute('data-tooltip', text);
        el.removeAttribute('title');
    }

    return el;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function placeTooltip() {
    rafId = 0;
    if (!activeTarget || !tooltipEl) return;
    const text = activeTarget.getAttribute('data-tooltip') || '';
    if (!text) return;

    tooltipEl.textContent = text;
    tooltipEl.classList.add('is-visible');

    const rect = activeTarget.getBoundingClientRect();
    const tipRect = tooltipEl.getBoundingClientRect();
    const margin = 10;

    let left = rect.left + rect.width / 2 - tipRect.width / 2;
    let top = rect.top - tipRect.height - 10;

    if (top < margin) top = rect.bottom + 10;

    left = clamp(left, margin, window.innerWidth - tipRect.width - margin);
    top = clamp(top, margin, window.innerHeight - tipRect.height - margin);

    tooltipEl.style.left = `${Math.round(left)}px`;
    tooltipEl.style.top = `${Math.round(top)}px`;
}

function schedulePlace() {
    if (rafId) return;
    rafId = requestAnimationFrame(placeTooltip);
}

function show(target) {
    const el = normalizeTarget(target);
    if (!el) return;
    ensureTooltip();
    activeTarget = el;
    schedulePlace();
}

function hide(target) {
    const el = normalizeTarget(target);
    if (!el) {
        if (tooltipEl) tooltipEl.classList.remove('is-visible');
        activeTarget = null;
        return;
    }
    if (activeTarget === el) {
        if (tooltipEl) tooltipEl.classList.remove('is-visible');
        activeTarget = null;
    }
}

export function initTooltips() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    ensureTooltip();

    document.addEventListener('mouseover', (e) => show(e.target), { passive: true });
    document.addEventListener('focusin', (e) => show(e.target), { passive: true });
    document.addEventListener('mouseout', (e) => hide(e.target), { passive: true });
    document.addEventListener('focusout', (e) => hide(e.target), { passive: true });

    window.addEventListener('scroll', schedulePlace, { passive: true });
    window.addEventListener('resize', schedulePlace, { passive: true });
}

