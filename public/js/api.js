// ─── API helper ───────────────────────────────────────────────────────────────
const api = {
  async get(url) {
    try {
      const r = await fetch(url);
      if (r.status === 401) { window.location.href = '/'; return null; }
      if (r.status === 403) { showToast('Accès non autorisé.', 'error'); return null; }
      return r.json().catch(() => null);
    } catch (e) { return null; }
  },
  async post(url, body) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.status === 401) { window.location.href = '/'; return null; }
      if (r.status === 403) { showToast('Accès non autorisé.', 'error'); return null; }
      return r.json().catch(() => ({ ok: false, error: `Erreur serveur (${r.status})` }));
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async put(url, body) {
    try {
      const r = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (r.status === 401) { window.location.href = '/'; return null; }
      if (r.status === 403) { showToast('Accès non autorisé.', 'error'); return null; }
      return r.json().catch(() => ({ ok: false, error: `Erreur serveur (${r.status})` }));
    } catch (e) { return { ok: false, error: e.message }; }
  },
  async delete(url) {
    try {
      const r = await fetch(url, { method: 'DELETE' });
      if (r.status === 401) { window.location.href = '/'; return null; }
      if (r.status === 403) { showToast('Accès non autorisé.', 'error'); return null; }
      return r.json().catch(() => ({ ok: r.ok }));
    } catch (e) { return { ok: false, error: e.message }; }
  }
};

// ─── Toast notifications ──────────────────────────────────────────────────────
const TOAST_ICONS = {
  success: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm3.354 4.646L7 10l-2.354-2.354-.707.708L7 11.414l5.06-5.06-.707-.708z"/></svg>`,
  error:   `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 4v4.5h1.5V5h-1.5zm0 5.5V12h1.5v-1.5h-1.5z"/></svg>`,
  warning: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 14h14L8 1zm-.75 5h1.5v4H7.25V6zm0 5h1.5v1.5h-1.5V11z"/></svg>`,
  info:    `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 110 14A7 7 0 018 1zm-.75 6.5V12h1.5V7.5h-1.5zM8 4.75a.875.875 0 100 1.75A.875.875 0 008 4.75z"/></svg>`,
};

function showToast(msg, type = 'info') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-atomic', 'true');
    document.body.appendChild(container);
  }
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
    <span class="toast-body">${escapeHtml(msg)}</span>
    <button class="toast-dismiss" aria-label="Fermer la notification" type="button">✕</button>
  `;
  t.querySelector('.toast-dismiss').addEventListener('click', () => t.remove());
  container.appendChild(t);
  const timer = setTimeout(() => t.remove(), 4000);
  t.querySelector('.toast-dismiss').addEventListener('click', () => clearTimeout(timer));
}

// ─── ARIA announcer (pour lecteurs d'écran) ───────────────────────────────────
let _announcer = null;
function announce(message, priority = 'polite') {
  if (!_announcer) {
    _announcer = document.createElement('div');
    _announcer.setAttribute('aria-live', priority);
    _announcer.setAttribute('aria-atomic', 'true');
    _announcer.className = 'sr-only';
    _announcer.id = 'aria-announcer';
    document.body.appendChild(_announcer);
  }
  _announcer.setAttribute('aria-live', priority);
  _announcer.textContent = '';
  requestAnimationFrame(() => { _announcer.textContent = message; });
}

// ─── Focus trap ───────────────────────────────────────────────────────────────
let _trapActive = null;
let _trapTrigger = null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function trapFocus(el, triggerEl = null) {
  _trapActive = el;
  _trapTrigger = triggerEl;
  const focusables = () => [...el.querySelectorAll(FOCUSABLE)].filter(n => !n.closest('[hidden]') && getComputedStyle(n).display !== 'none');
  const first = focusables()[0];
  if (first) first.focus();
  el._trapHandler = (e) => {
    if (e.key !== 'Tab') return;
    const all = focusables();
    const firstEl = all[0];
    const lastEl = all[all.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === firstEl) { e.preventDefault(); lastEl?.focus(); }
    } else {
      if (document.activeElement === lastEl) { e.preventDefault(); firstEl?.focus(); }
    }
  };
  el.addEventListener('keydown', el._trapHandler);
}

function releaseFocus() {
  if (_trapActive && _trapActive._trapHandler) {
    _trapActive.removeEventListener('keydown', _trapActive._trapHandler);
    _trapActive._trapHandler = null;
  }
  if (_trapTrigger) { _trapTrigger.focus(); }
  _trapActive = null;
  _trapTrigger = null;
}

// ─── Modal helpers ────────────────────────────────────────────────────────────
function showModal(id, triggerEl = null) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
  document.body.classList.add('modal-open');
  trapFocus(el, triggerEl);
}
function hideModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
  document.body.classList.remove('modal-open');
  releaseFocus();
}
function closeOnOverlay(event, id) {
  if (event.target.id === id) hideModal(id);
}

// ─── Escape key — ferme le modal ouvert ──────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _trapActive) {
    const overlay = _trapActive.closest('.modal-overlay');
    if (overlay && overlay.id) hideModal(overlay.id);
  }
});

// ─── Icônes SVG pour la navigation ───────────────────────────────────────────
const NAV_ICONS = {
  dashboard:             `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 8a1 1 0 011-1h5a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zm8-8a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zm1 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1h-4z"/></svg>`,
  manager:               `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>`,
  reservations:          `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>`,
  tables:                `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 3a1 1 0 011-1h12a1 1 0 011 1v3a1 1 0 01-.293.707L12 11.414V15a1 1 0 01-.553.894l-4 2A1 1 0 016 17v-5.586L3.293 6.707A1 1 0 013 6V3z"/></svg>`,
  taches:                `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`,
  cuisine:               `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z"/></svg>`,
  email:                 `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>`,
  planning:              `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>`,
  instagram:             `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 2c-2.236 0-2.516.01-3.394.049-.876.04-1.474.178-1.997.38a4.03 4.03 0 00-1.457.948 4.03 4.03 0 00-.948 1.457c-.202.523-.34 1.121-.38 1.997C2.01 7.484 2 7.764 2 10s.01 2.516.049 3.394c.04.876.178 1.474.38 1.997a4.03 4.03 0 00.948 1.457c.455.455.944.738 1.457.948.523.202 1.121.34 1.997.38C7.484 17.99 7.764 18 10 18s2.516-.01 3.394-.049c.876-.04 1.474-.178 1.997-.38a4.03 4.03 0 001.457-.948 4.03 4.03 0 00.948-1.457c.202-.523.34-1.121.38-1.997C17.99 12.516 18 12.236 18 10s-.01-2.516-.049-3.394c-.04-.876-.178-1.474-.38-1.997a4.03 4.03 0 00-.948-1.457 4.03 4.03 0 00-1.457-.948c-.523-.202-1.121-.34-1.997-.38C12.516 2.01 12.236 2 10 2zm0 1.5c2.2 0 2.46.008 3.328.048.804.036 1.24.168 1.53.28.384.15.658.328.946.616.288.288.466.562.615.946.112.29.244.726.28 1.53.04.868.048 1.128.048 3.328s-.008 2.46-.048 3.328c-.036.804-.168 1.24-.28 1.53a2.553 2.553 0 01-.615.946 2.553 2.553 0 01-.946.615c-.29.112-.726.244-1.53.28-.868.04-1.128.048-3.328.048s-2.46-.008-3.328-.048c-.804-.036-1.24-.168-1.53-.28a2.553 2.553 0 01-.946-.615 2.553 2.553 0 01-.615-.946c-.112-.29-.244-.726-.28-1.53C3.508 12.46 3.5 12.2 3.5 10s.008-2.46.048-3.328c.036-.804.168-1.24.28-1.53.15-.384.327-.658.615-.946.288-.288.562-.466.946-.615.29-.112.726-.244 1.53-.28C7.54 3.508 7.8 3.5 10 3.5zm0 2.5a4 4 0 100 8 4 4 0 000-8zm0 1.5a2.5 2.5 0 110 5 2.5 2.5 0 010-5zm4.5-1.5a.75.75 0 100 1.5.75.75 0 000-1.5z" clip-rule="evenodd"/></svg>`,
  pointages:             `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clip-rule="evenodd"/></svg>`,
  joy:                   `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM6.293 5.293a1 1 0 011.414 0L9 6.586V5a1 1 0 112 0v1.586l1.293-1.293a1 1 0 011.414 1.414L12.414 8H14a1 1 0 110 2h-1.586l1.293 1.293a1 1 0 01-1.414 1.414L11 11.414V13a1 1 0 11-2 0v-1.586l-1.293 1.293a1 1 0 01-1.414-1.414L7.586 10H6a1 1 0 110-2h1.586L6.293 6.707a1 1 0 010-1.414z"/></svg>`,
  'marketing-dashboard': `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>`,
  'cuisine-taches':      `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>`,
  'cuisine-planning':    `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd"/></svg>`,
  'resa-dashboard':      `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h5a1 1 0 011 1v5a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 8a1 1 0 011-1h5a1 1 0 011 1v4a1 1 0 01-1 1H4a1 1 0 01-1-1v-4zm8-8a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V4zm1 7a1 1 0 00-1 1v4a1 1 0 001 1h4a1 1 0 001-1v-4a1 1 0 00-1-1h-4z"/></svg>`,
  'resa-gestion':        `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z"/><path fill-rule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h.01a1 1 0 100-2H7zm3 0a1 1 0 000 2h3a1 1 0 100-2h-3zm-3 4a1 1 0 100 2h.01a1 1 0 100-2H7zm3 0a1 1 0 100 2h3a1 1 0 100-2h-3z" clip-rule="evenodd"/></svg>`,
  'resa-suivi':          `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zm6-4a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zm6-3a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z"/></svg>`,
  'resa-devis':          `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clip-rule="evenodd"/></svg>`,
  'marketing-reservations': `<svg viewBox="0 0 20 20" fill="currentColor"><path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 8a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zm6-6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zm0 8a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"/></svg>`,
};
function navIcon(key) {
  return NAV_ICONS[key] || `<svg viewBox="0 0 20 20" fill="currentColor"><circle cx="10" cy="10" r="4"/></svg>`;
}

// ─── Nav builder ──────────────────────────────────────────────────────────────
async function buildNav(activePage) {
  const user = await api.get('/api/auth/me');
  if (!user) return;
  window.__mosUser = user;

  // ── Skip link ──
  if (!document.querySelector('.skip-link')) {
    const skip = document.createElement('a');
    skip.href = '#main-content';
    skip.className = 'skip-link';
    skip.textContent = 'Aller au contenu principal';
    document.body.insertBefore(skip, document.body.firstChild);
  }

  const nav = document.getElementById('nav');
  if (!nav) return;

  const adminLinks = [
    { href: '/admin/dashboard.html',    label: 'Dashboard',    key: 'dashboard' },
    { href: '/admin/manager.html',      label: 'Manager',      key: 'manager' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Salle',        key: 'tables' },
    { href: '/cuisine/index.html',      label: 'Cuisine',      key: 'cuisine' },
    { href: '/admin/email.html',        label: 'Email',        key: 'email' },
    { href: '/resa/devis.html',         label: 'Devis',        key: 'resa-devis' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
    { href: '/instagram/index.html',    label: 'Instagram',    key: 'instagram' },
    { href: '/admin/pointages.html',    label: 'Pointeuse',    key: 'pointages' },
  ];
  const managerMidiLinks = [
    { href: '/admin/dashboard.html',    label: 'Dashboard',    key: 'dashboard' },
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/admin/pointages.html',    label: 'Pointeuse',    key: 'pointages' },
  ];
  const managerSoirLinks = [
    { href: '/admin/dashboard.html',    label: 'Dashboard',    key: 'dashboard' },
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
    { href: '/admin/pointages.html',    label: 'Pointeuse',    key: 'pointages' },
  ];
  const staffMidiLinks = [
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
  ];
  const staffSoirLinks = [
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
  ];
  const cuisineLinks = [
    { href: '/cuisine/taches.html',   label: 'Tâches',    key: 'cuisine-taches' },
    { href: '/cuisine/planning.html', label: 'Planning',  key: 'cuisine-planning' },
    { href: '/staff/planning.html',   label: 'Congés',    key: 'planning' },
  ];
  const marketingLinks = [
    { href: '/marketing/dashboard.html',    label: 'Dashboard',    key: 'marketing-dashboard' },
    { href: '/instagram/index.html',        label: 'Instagram',    key: 'instagram' },
    { href: '/marketing/reservations.html', label: 'Réservations', key: 'marketing-reservations' },
    { href: '/admin/joy.html',              label: 'Joy.io',       key: 'joy' },
    { href: '/admin/manager.html',          label: 'Manager',      key: 'manager' },
    { href: '/resa/devis.html',             label: 'Devis',        key: 'resa-devis' },
    { href: '/staff/planning.html',         label: 'Planning',     key: 'planning' },
  ];
  const resaLinks = [
    { href: '/resa/dashboard.html',  label: 'Dashboard', key: 'resa-dashboard' },
    { href: '/resa/gestion.html',    label: 'Gestion',   key: 'resa-gestion' },
    { href: '/resa/suivi.html',      label: 'Suivi',     key: 'resa-suivi' },
    { href: '/resa/devis.html',      label: 'Devis',     key: 'resa-devis' },
    { href: '/staff/planning.html',  label: 'Planning',  key: 'planning' },
  ];

  const links = user.role === 'admin'                              ? adminLinks
    : user.shift === 'resa'                                        ? resaLinks
    : user.shift === 'marketing'                                   ? marketingLinks
    : user.shift === 'cuisine'                                     ? cuisineLinks
    : user.role === 'manager' && user.shift === 'midi'             ? managerMidiLinks
    : user.role === 'manager' && user.shift === 'soir'             ? managerSoirLinks
    : user.shift === 'midi'                                        ? staffMidiLinks
    :                                                                staffSoirLinks;

  const isAdmin = user.role === 'admin';
  const linkHTML = (l) =>
    `<a href="${l.href}" class="nav-link${l.key === activePage ? ' active' : ''}" ${l.key === activePage ? 'aria-current="page"' : ''}>
      <span aria-hidden="true">${navIcon(l.key)}</span>
      ${escapeHtml(l.label)}
    </a>`;

  const navLinksHTML = isAdmin
    ? [
        ...links.slice(0, 5).map(linkHTML),
        `<span class="nav-group-sep" aria-hidden="true"></span>`,
        ...links.slice(5).map(linkHTML),
      ].join('')
    : links.map(linkHTML).join('');

  nav.setAttribute('aria-label', 'Navigation principale');
  nav.setAttribute('role', 'navigation');
  nav.innerHTML = `
    <a href="/menu.html" class="nav-logo" aria-label="MOS Pub Mercière — Retour au menu">
      <img src="/images/logo.png" alt="MOS" class="nav-logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
      <span class="nav-logo-text" style="display:none;" aria-hidden="true">MOS</span>
    </a>
    <div class="nav-links" role="list">
      ${navLinksHTML.replace(/<a /g, '<a role="listitem" ').replace(/role="listitem" /g, '')}
    </div>
    <div class="nav-right">
      <span class="nav-user" aria-label="Connecté en tant que ${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
      <button class="btn-logout" id="btn-logout" type="button" aria-label="Se déconnecter">Déco.</button>
    </div>
  `;
  document.getElementById('btn-logout')?.addEventListener('click', logout);

  // ── Bottom nav (mobile) ──
  if (activePage !== 'menu') {
    const bottomNav = document.createElement('nav');
    bottomNav.className = 'bottom-nav';
    bottomNav.setAttribute('aria-label', 'Navigation rapide mobile');
    bottomNav.innerHTML = `
      <div class="bottom-nav-back">
        <a href="/menu.html" class="btn-back-menu">
          <span class="btn-back-arrow" aria-hidden="true">←</span>
          <span>Menu</span>
        </a>
      </div>
    `;
    document.body.appendChild(bottomNav);
  }
}

async function logout() {
  await api.post('/api/auth/logout', {});
  window.location.href = '/';
}

// ─── Utilitaire escapeHtml ────────────────────────────────────────────────────
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ─── Date helpers ─────────────────────────────────────────────────────────────
function today() { return new Date().toISOString().split('T')[0]; }
function formatDate(d) {
  return new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}
function formatTime(t) { return t; }
function formatDateTime(dt) {
  if (!dt) return '';
  return new Date(dt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Alert sound ──────────────────────────────────────────────────────────────
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 180, 360].forEach(delay => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, ctx.currentTime + delay / 1000);
      gain.gain.linearRampToValueAtTime(0.45, ctx.currentTime + delay / 1000 + 0.05);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay / 1000 + 0.3);
      osc.start(ctx.currentTime + delay / 1000);
      osc.stop(ctx.currentTime + delay / 1000 + 0.35);
    });
  } catch (e) { /* AudioContext non supporté */ }
}

// ─── Status badges SVG ────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  confirmed: { label: 'Confirmé',  cls: 'status-confirmed', icon: `<svg viewBox="0 0 12 12" fill="currentColor"><circle cx="6" cy="6" r="3"/></svg>` },
  arrived:   { label: 'Arrivé',   cls: 'status-arrived',   icon: `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M10 3L4.75 8.25 2 5.5"/><path fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" d="M10 3L4.75 8.25 2 5.5"/></svg>` },
  no_show:   { label: 'No-show',  cls: 'status-no_show',   icon: `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M9.5 2.5l-7 7M2.5 2.5l7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>` },
  cancelled: { label: 'Annulé',   cls: 'status-cancelled', icon: `<svg viewBox="0 0 12 12" fill="currentColor"><path d="M9.5 2.5l-7 7M2.5 2.5l7 7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/></svg>` },
  pending:   { label: 'En attente', cls: 'status-pending', icon: `<svg viewBox="0 0 12 12" fill="currentColor"><path fill-rule="evenodd" d="M6 1a5 5 0 100 10A5 5 0 006 1zm.5 3a.5.5 0 00-1 0v2.5l1.5 1.5a.5.5 0 00.707-.707L6.5 5.793V4z" clip-rule="evenodd"/></svg>` },
};
function statusBadge(status) {
  const c = STATUS_CONFIG[status] || { label: status, cls: 'badge-muted', icon: '' };
  return `<span class="status-badge ${c.cls}" aria-label="Statut : ${c.label}"><span aria-hidden="true">${c.icon}</span>${c.label}</span>`;
}
