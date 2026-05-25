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

// ─── Emojis pour la navigation ───────────────────────────────────────────────
const NAV_ICONS = {
  dashboard:               '📊',
  equipe:                  '👥',
  reservations:            '🗓️',
  tables:                  '🪑',
  taches:                  '✅',
  cuisine:                 '🍳',
  'admin-tools':           '⚙️',
  planning:                '📆',
  conges:                  '🌴',
  pointeuse:               '⏱️',
  direction:               '🏢',
  email:                   '✉️',
  joy:                     '🎉',
  'marketing-dashboard':   '📈',
  recettes:                '📖',
  'cuisine-taches':        '✅',
  'cuisine-planning':      '📆',
  'cuisine-etiquettes':    '🏷️',
  'resa-dashboard':        '📊',
  'resa-gestion':          '📋',
  'resa-suivi':            '📈',
  'resa-devis':            '📝',
  'marketing-reservations':'🗓️',
  'taches-periodiques':    '🔄',
};
function navIcon(key) {
  return `<span style="font-size:1rem;line-height:1">${NAV_ICONS[key] || '•'}</span>`;
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
    { href: '/admin/dashboard.html',    label: 'Dashboard',       key: 'dashboard' },
    { href: '/admin/equipe.html',       label: 'Gestion Staff',   key: 'equipe' },
    { href: '/staff/reservations.html', label: 'Réservations',    key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Salle',           key: 'tables' },
    { href: '/cuisine/index.html',      label: 'Cuisine',         key: 'cuisine' },
    { href: '/admin/admin.html',         label: 'Admin',           key: 'admin-tools' },
    { href: '/staff/planning.html',     label: 'Planning',        key: 'planning' },
    { href: '/staff/conges.html',       label: 'Congés',          key: 'conges' },
  ];
  const managerMidiLinks = [
    { href: '/admin/dashboard.html',    label: 'Dashboard',    key: 'dashboard' },
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/conges.html',       label: 'Congés',       key: 'conges' },
  ];
  const managerSoirLinks = [
    { href: '/admin/dashboard.html',    label: 'Dashboard',    key: 'dashboard' },
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
    { href: '/staff/conges.html',       label: 'Congés',       key: 'conges' },
  ];
  const staffMidiLinks = [
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
    { href: '/staff/conges.html',       label: 'Congés',       key: 'conges' },
  ];
  const staffSoirLinks = [
    { href: '/staff/taches.html',       label: 'Mes Tâches',   key: 'taches' },
    { href: '/staff/reservations.html', label: 'Réservations', key: 'reservations' },
    { href: '/staff/tables.html',       label: 'Plan de Salle',key: 'tables' },
    { href: '/staff/planning.html',     label: 'Planning',     key: 'planning' },
    { href: '/staff/conges.html',       label: 'Congés',       key: 'conges' },
  ];
  const cuisineLinks = [
    { href: '/cuisine/taches.html',        label: 'Tâches',        key: 'cuisine-taches' },
    { href: '/cuisine/recettes.html',      label: 'Recettes',      key: 'recettes' },
    { href: '/staff/planning.html',        label: 'Planning',      key: 'planning' },
    { href: '/staff/conges.html',          label: 'Congés',        key: 'conges' },
  ];
  const marketingLinks = [
    { href: '/marketing/dashboard.html',    label: 'Dashboard',    key: 'marketing-dashboard' },
    { href: '/marketing/reservations.html', label: 'Réservations', key: 'marketing-reservations' },
    { href: '/admin/joy.html',              label: 'Joy.io',       key: 'joy' },
    { href: '/admin/equipe.html',            label: 'Gestion Staff', key: 'equipe' },
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
  const pointeuseLinks = [
    { href: '/staff/pointeuse.html', label: 'Pointeuse', key: 'pointeuse' },
  ];
  const directionLinks = [
    { href: '/admin/direction.html',    label: 'Direction',   key: 'direction' },
    { href: '/staff/planning.html',     label: 'Planning',    key: 'planning' },
    { href: '/staff/conges.html',       label: 'Congés',      key: 'conges' },
    { href: '/admin/pointages.html',    label: 'Pointages',   key: 'pointages' },
  ];

  const links = user.role === 'admin'                              ? adminLinks
    : user.role === 'direction'                                    ? directionLinks
    : user.shift === 'pointeuse'                                   ? pointeuseLinks
    : user.shift === 'resa'                                        ? resaLinks
    : user.shift === 'marketing'                                   ? marketingLinks
    : user.shift === 'cuisine'                                     ? cuisineLinks
    : user.role === 'manager' && user.shift === 'midi'             ? managerMidiLinks
    : user.role === 'manager' && user.shift === 'soir'             ? managerSoirLinks
    : user.shift === 'midi'                                        ? staffMidiLinks
    :                                                                staffSoirLinks;

  const isAdmin = user.role === 'admin';
  const linkHTML = (l) =>
    `<a href="${l.href}" class="nav-link${l.key === activePage ? ' active' : ''}" ${l.key === activePage ? 'aria-current="page"' : ''} data-tutorial="nav-${l.key}">
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

  const currentLink = links.find(l => l.key === activePage);
  const currentLabel = currentLink?.label || '';
  const backArrow = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M17 10a.75.75 0 01-.75.75H5.612l4.158 3.96a.75.75 0 11-1.04 1.08l-5.5-5.25a.75.75 0 010-1.08l5.5-5.25a.75.75 0 111.04 1.08L5.612 9.25H16.25A.75.75 0 0117 10z" clip-rule="evenodd"/></svg>`;

  nav.setAttribute('aria-label', 'Navigation principale');
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('data-tutorial', 'navbar');
  nav.innerHTML = `
    <a href="/menu.html" class="nav-logo" aria-label="MOS Pub Mercière — Retour au menu">
      <span class="nav-logo-desktop">
        <img src="/images/logo.png" alt="MOS" class="nav-logo-img" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">
        <span class="nav-logo-text" style="display:none;" aria-hidden="true">MOS</span>
      </span>
      <span class="nav-logo-mobile" aria-hidden="true">${backArrow} Menu</span>
    </a>
    ${currentLabel ? `<div class="nav-page-title" aria-hidden="true">${escapeHtml(currentLabel)}</div>` : ''}
    <div class="nav-links" role="list">
      ${navLinksHTML.replace(/<a /g, '<a role="listitem" ').replace(/role="listitem" /g, '')}
    </div>
    <div class="nav-right">
      <span class="nav-user" aria-label="Connecté en tant que ${escapeHtml(user.name)}">${escapeHtml(user.name)}</span>
      <button class="btn-logout" id="btn-logout" type="button" aria-label="Se déconnecter">Déco.</button>
    </div>
  `;
  document.getElementById('btn-logout')?.addEventListener('click', logout);

  // ── Bottom nav (mobile) — tab bar ──
  if (activePage !== 'menu') {
    const menuIcon = `<svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9.293 2.293a1 1 0 011.414 0l7 7A1 1 0 0117 11h-1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-3a1 1 0 00-1-1H9a1 1 0 00-1 1v3a1 1 0 01-1 1H5a1 1 0 01-1-1v-6H3a1 1 0 01-.707-1.707l7-7z" clip-rule="evenodd"/></svg>`;

    // Limiter à 4 liens max pour laisser de la place au bouton Menu
    const tabLinks = links.slice(0, 4);
    const tabsHTML = tabLinks.map(l => {
      const isActive = l.key === activePage;
      return `<a href="${l.href}" class="bottom-tab${isActive ? ' active' : ''}" ${isActive ? 'aria-current="page"' : ''} aria-label="${escapeHtml(l.label)}" data-tutorial="nav-${l.key}">
        ${navIcon(l.key)}
        <span>${escapeHtml(l.label)}</span>
      </a>`;
    }).join('');

    const bottomNav = document.createElement('nav');
    bottomNav.className = 'bottom-nav';
    bottomNav.setAttribute('aria-label', 'Navigation rapide mobile');
    bottomNav.setAttribute('data-tutorial', 'navbar');
    bottomNav.innerHTML = `
      <div class="bottom-tabs">
        <a href="/menu.html" class="bottom-tab tab-menu" aria-label="Retour au menu">
          ${menuIcon}
          <span>Menu</span>
        </a>
        ${tabsHTML}
      </div>
    `;
    document.body.appendChild(bottomNav);
  }
}

async function logout() {
  await api.post('/api/auth/logout', {});
  window.location.href = '/';
}

// Vérifie l'auth et le rôle, redirige si non autorisé.
// roles : tableau de rôles acceptés, ex. ['admin', 'direction']
async function requireAuth(roles) {
  const user = await api.get('/api/auth/me');
  if (!user) return null; // api.get redirige déjà vers '/' sur 401
  if (roles && !roles.includes(user.role)) {
    window.location.href = '/menu.html';
    return null;
  }
  return user;
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
