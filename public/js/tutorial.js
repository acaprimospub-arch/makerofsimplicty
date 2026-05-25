/* ── Tutorial interactif MOS ─────────────────────────────────────────────── */
(function () {
  'use strict';

  // ── Définition des étapes ────────────────────────────────────────────────

  const STEPS_STAFF = [
    // ── Navigation ──
    {
      target: '[data-tutorial="navbar"]',
      pos: 'bottom',
      title: 'Navigation principale',
      text: 'Ces onglets en bas de l\'écran sont tes outils du service. Tu peux naviguer librement entre eux à tout moment.'
    },

    // ── Mes Tâches ──
    {
      target: '[data-tutorial="nav-taches"]',
      pos: 'bottom',
      title: 'Mes Tâches',
      text: 'Ici tu retrouves toutes tes tâches du service en cours. Coche-les au fur et à mesure que tu les effectues.'
    },
    {
      target: '[data-tutorial="task-tabs"]',
      pos: 'bottom',
      title: 'MATIN & PASSATION',
      text: 'Les tâches sont séparées en deux groupes : MATIN (ouverture) et PASSATION (fin de service). Clique sur un onglet pour basculer entre les deux.'
    },
    {
      target: '[data-tutorial="task-progress"]',
      pos: 'bottom',
      title: 'Barre de progression',
      text: 'La barre dorée te montre combien de tâches sont cochées sur le total. Elle se met à jour en temps réel dès que toi ou un collègue coche une tâche.'
    },
    {
      target: '[data-tutorial="team-stats"]',
      pos: 'bottom',
      title: 'Statistiques équipe',
      text: 'Tu vois en un coup d\'œil combien de tâches tu as cochées (doré), combien tes collègues ont faites (bleu), et combien il en reste (gris).'
    },
    {
      target: '[data-tutorial="periodic-link"]',
      pos: 'bottom',
      title: 'Tâches périodiques',
      text: 'Les tâches mensuelles et bi-mensuelles (nettoyages approfondis, vérifications…) sont regroupées ici avec leur historique et la possibilité d\'ajouter des photos.'
    },

    // ── Réservations ──
    {
      target: '[data-tutorial="nav-reservations"]',
      pos: 'bottom',
      title: 'Réservations',
      text: 'Consulte et gère toutes les réservations du jour. Les cartes s\'affichent dans l\'ordre chronologique avec le statut de chaque table.'
    },
    {
      target: '[data-tutorial="res-date-nav"]',
      pos: 'bottom',
      title: 'Naviguer par date',
      text: 'Utilise les flèches pour passer au jour précédent ou suivant. Tu peux aussi cliquer sur la date pour choisir un jour précis dans le calendrier.'
    },
    {
      target: '[data-tutorial="res-add-btn"]',
      pos: 'bottom',
      title: 'Nouvelle réservation',
      text: 'Ce bouton ouvre le formulaire de création. Tu y renseignes le nom, l\'heure, le nombre de personnes, la table et toute note utile.'
    },

    // ── Plan de salle ──
    {
      target: '[data-tutorial="nav-tables"]',
      pos: 'bottom',
      title: 'Plan de Salle',
      text: 'Vue en temps réel de toutes les tables. Clique sur une table pour voir son statut, l\'associer à une réservation ou changer son état.'
    },
    {
      target: '[data-tutorial="zone-tabs"]',
      pos: 'bottom',
      title: 'Zones de la salle',
      text: 'La salle est divisée en zones (terrasse, bar, salle…). Clique sur un onglet pour filtrer l\'affichage et trouver rapidement une table.'
    },
    {
      target: '[data-tutorial="table-legend"]',
      pos: 'top',
      title: 'Légende des couleurs',
      text: 'Gris = libre · Bleu = réservée · Vert = arrivée confirmée · Rouge = en retard. Un rapide coup d\'œil suffit pour connaître l\'état de chaque table.'
    },

    // ── Planning ──
    {
      target: '[data-tutorial="nav-planning"]',
      pos: 'bottom',
      title: 'Planning & Congés',
      text: 'Consulte ton planning de la semaine et celui de tes collègues. Depuis l\'onglet Congés, tu peux poser une demande directement depuis l\'app.'
    },

    // ── Pointeuse ──
    {
      target: '[data-tutorial="nav-pointeuse"]',
      pos: 'bottom',
      title: 'Pointeuse',
      text: 'Enregistre ton heure d\'arrivée et de départ. Tes heures sont sauvegardées automatiquement et visibles par les managers.'
    },
    {
      target: '[data-tutorial="pointeuse-btn"]',
      pos: 'top',
      title: 'Pointer ton arrivée',
      text: 'Un simple appui sur ce bouton suffit pour pointer l\'arrivée. En fin de service, le bouton se transforme en "Pointer le départ".'
    },
  ];

  const STEPS_MANAGER_EXTRA = [
    {
      target: '[data-tutorial="nav-planning"]',
      pos: 'bottom',
      title: 'Gérer le Planning',
      text: 'En tant que manager, tu peux éditer le planning de ton équipe. Clique sur une case vide pour ajouter un créneau, sur une case existante pour la modifier ou la supprimer.'
    },
    {
      target: '[data-tutorial="nav-conges"]',
      pos: 'bottom',
      title: 'Valider les Congés',
      text: 'Les demandes de congés de ton équipe arrivent ici. Tu peux les accepter ou les refuser — le staff est notifié automatiquement.'
    },
    {
      target: null,
      pos: 'center',
      title: 'Accès Manager',
      text: 'Tu as accès à tous les outils du staff, plus la gestion du planning et des congés. L\'admin Arthur gère les réglages avancés (comptes, tâches, statistiques globales).'
    },
  ];

  const STEPS_ADMIN_EXTRA = [
    {
      target: null,
      pos: 'center',
      title: 'Panneau Administrateur',
      text: 'En tant qu\'admin, tu accèdes au panneau complet : création et gestion des comptes staff, configuration des tâches, statistiques par personne et suivi des pointages.'
    },
    {
      target: '[data-tutorial="help-btn"]',
      pos: 'top',
      title: 'Guide toujours disponible',
      text: 'Ce bouton "?" reste affiché en permanence sur toutes les pages. Clique dessus à tout moment pour revoir ce guide depuis le début.'
    },
  ];

  // ── Classe Tutorial ───────────────────────────────────────────────────────

  class Tutorial {
    constructor() {
      this.steps    = [];
      this.idx      = 0;
      this.userId   = null;
      this._onKey   = this._handleKey.bind(this);
      // DOM refs
      this._overlay  = null;
      this._spot     = null;
      this._tooltip  = null;
      this._helpBtn  = null;
    }

    async init() {
      const user = window.__mosUser || await fetch('/api/auth/me').then(r => r.ok ? r.json() : null).catch(() => null);
      if (!user) return;

      this.userId = user.id;

      if (user.role === 'admin') {
        this.steps = [...STEPS_STAFF, ...STEPS_MANAGER_EXTRA, ...STEPS_ADMIN_EXTRA];
      } else if (user.role === 'manager') {
        this.steps = [...STEPS_STAFF, ...STEPS_MANAGER_EXTRA];
      } else {
        this.steps = [...STEPS_STAFF];
      }

      this._build();

      const key = `mos_tutorial_${this.userId}`;
      if (!localStorage.getItem(key)) {
        setTimeout(() => this.start(), 600);
      }
    }

    // ── Construction du DOM ──────────────────────────────────────────────────

    _build() {
      this._overlay = el('div', {
        id: 'tut-overlay',
        style: `
          position:fixed;inset:0;z-index:9000;
          pointer-events:none;opacity:0;
          transition:opacity .3s;
        `
      });
      this._spot = el('div', {
        id: 'tut-spot',
        style: `
          position:absolute;border-radius:10px;
          transition:top .28s,left .28s,width .28s,height .28s;
          box-shadow:0 0 0 9999px rgba(0,0,0,.65);
          pointer-events:none;
        `
      });
      this._overlay.appendChild(this._spot);
      document.body.appendChild(this._overlay);

      this._tooltip = el('div', {
        id: 'tut-tooltip',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Guide interactif',
        style: `
          position:fixed;z-index:9001;
          width:310px;max-width:calc(100vw - 32px);
          background:#0e1a24;
          border:1px solid rgba(201,168,76,.4);
          border-radius:14px;
          padding:20px 20px 16px;
          box-shadow:0 12px 48px rgba(0,0,0,.75);
          opacity:0;transform:translateY(10px);
          transition:opacity .22s,transform .22s;
          pointer-events:auto;
        `
      });
      document.body.appendChild(this._tooltip);

      // Bouton "?" permanent
      this._helpBtn = el('button', {
        id: 'tut-help-btn',
        'data-tutorial': 'help-btn',
        'aria-label': 'Ouvrir le guide',
        style: `
          position:fixed;
          bottom:calc(var(--bottom-nav-height, 64px) + 16px + env(safe-area-inset-bottom));
          right:18px;
          width:44px;height:44px;border-radius:50%;
          background:#C9A84C;color:#000;border:none;
          font-size:1.25rem;font-weight:800;
          cursor:pointer;z-index:8999;
          box-shadow:0 4px 20px rgba(201,168,76,.45);
          display:flex;align-items:center;justify-content:center;
          transition:transform .15s,box-shadow .15s;
          font-family:serif;
        `
      });
      this._helpBtn.textContent = '?';
      this._helpBtn.addEventListener('click', () => this.start());
      on(this._helpBtn, 'mouseenter', () => { this._helpBtn.style.transform = 'scale(1.12)'; });
      on(this._helpBtn, 'mouseleave', () => { this._helpBtn.style.transform = 'scale(1)'; });
      document.body.appendChild(this._helpBtn);
    }

    // ── Démarrage / navigation ───────────────────────────────────────────────

    start() {
      this.idx = 0;
      this._overlay.style.opacity        = '1';
      this._overlay.style.pointerEvents  = 'auto';
      document.addEventListener('keydown', this._onKey);
      this._showStep(0);
    }

    _next() {
      this._tooltip.style.opacity   = '0';
      this._tooltip.style.transform = 'translateY(10px)';
      setTimeout(() => {
        this.idx++;
        if (this.idx >= this.steps.length) this._finish();
        else this._showStep(this.idx);
      }, 180);
    }

    close() {
      if (this.userId) localStorage.setItem(`mos_tutorial_${this.userId}`, '1');
      this._overlay.style.opacity       = '0';
      this._overlay.style.pointerEvents = 'none';
      this._tooltip.style.opacity       = '0';
      this._tooltip.style.transform     = 'translateY(10px)';
      document.removeEventListener('keydown', this._onKey);
    }

    _finish() {
      this.close();
    }

    _handleKey(e) {
      if (e.key === 'Escape')                             this.close();
      if (e.key === 'ArrowRight' || e.key === 'Enter')   this._next();
    }

    // ── Affichage d'une étape ────────────────────────────────────────────────

    _showStep(i) {
      const step  = this.steps[i];
      const total = this.steps.length;
      const pct   = Math.round(((i + 1) / total) * 100);
      const last  = i === total - 1;

      let targetEl = step.target ? document.querySelector(step.target) : null;

      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }

      this._moveSpot(targetEl);

      this._tooltip.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
          <span style="font-size:.68rem;font-weight:700;color:#C9A84C;letter-spacing:.06em;text-transform:uppercase">
            Étape ${i + 1} / ${total}
          </span>
          <button data-tut="close" aria-label="Fermer le guide" style="
            width:26px;height:26px;border-radius:50%;
            background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);
            color:#888;font-size:.85rem;cursor:pointer;
            display:flex;align-items:center;justify-content:center;flex-shrink:0;
          ">✕</button>
        </div>
        <div style="font-size:.95rem;font-weight:700;color:#fff;margin-bottom:7px;">${step.title}</div>
        <div style="font-size:.84rem;color:rgba(255,255,255,.72);line-height:1.55;margin-bottom:14px;">${step.text}</div>
        <div style="height:3px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-bottom:16px;">
          <div style="height:100%;width:${pct}%;background:#C9A84C;border-radius:999px;transition:width .3s;"></div>
        </div>
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button data-tut="skip" style="
            padding:7px 14px;border-radius:8px;
            background:transparent;border:1px solid rgba(255,255,255,.13);
            color:rgba(255,255,255,.45);font-size:.78rem;cursor:pointer;font-family:inherit;
          ">Passer</button>
          <button data-tut="next" style="
            padding:7px 20px;border-radius:8px;
            background:#C9A84C;border:none;
            color:#000;font-size:.78rem;font-weight:700;cursor:pointer;font-family:inherit;
          ">${last ? 'Terminer ✓' : 'Suivant →'}</button>
        </div>
      `;

      this._tooltip.querySelector('[data-tut="close"]').addEventListener('click', () => this.close());
      this._tooltip.querySelector('[data-tut="skip"]').addEventListener('click',  () => this.close());
      this._tooltip.querySelector('[data-tut="next"]').addEventListener('click',  () => this._next());

      requestAnimationFrame(() => {
        this._posTooltip(targetEl, step.pos);
        requestAnimationFrame(() => {
          this._tooltip.style.opacity   = '1';
          this._tooltip.style.transform = 'translateY(0)';
        });
      });
    }

    // ── Spotlight ────────────────────────────────────────────────────────────

    _moveSpot(targetEl) {
      if (!targetEl) {
        Object.assign(this._spot.style, { width: '0', height: '0', top: '50%', left: '50%', boxShadow: 'none' });
        return;
      }
      const r   = targetEl.getBoundingClientRect();
      const pad = 8;
      Object.assign(this._spot.style, {
        top:       (r.top  - pad) + 'px',
        left:      (r.left - pad) + 'px',
        width:     (r.width  + pad * 2) + 'px',
        height:    (r.height + pad * 2) + 'px',
        boxShadow: '0 0 0 9999px rgba(0,0,0,.65)',
      });
    }

    // ── Positionnement du tooltip ─────────────────────────────────────────────

    _posTooltip(targetEl, pos) {
      const TW  = 310;
      const TH  = this._tooltip.offsetHeight || 220;
      const GAP = 14;
      const M   = 14;
      const vw  = window.innerWidth;
      const vh  = window.innerHeight;

      if (!targetEl || pos === 'center') {
        Object.assign(this._tooltip.style, {
          top:    '50%',
          left:   '50%',
          right:  'auto',
          bottom: 'auto',
          transform: 'translate(-50%, -50%)',
        });
        return;
      }

      this._tooltip.style.transform = 'translateY(0)';
      const r = targetEl.getBoundingClientRect();
      let top, left;

      switch (pos) {
        case 'bottom':
          top  = r.bottom + GAP;
          left = clamp(r.left + r.width / 2 - TW / 2, M, vw - TW - M);
          break;
        case 'top':
          top  = r.top - GAP - TH;
          left = clamp(r.left + r.width / 2 - TW / 2, M, vw - TW - M);
          break;
        case 'right':
          top  = clamp(r.top + r.height / 2 - TH / 2, M, vh - TH - M);
          left = r.right + GAP;
          if (left + TW > vw - M) left = r.left - TW - GAP;
          break;
        case 'left':
          top  = clamp(r.top + r.height / 2 - TH / 2, M, vh - TH - M);
          left = r.left - TW - GAP;
          if (left < M) left = r.right + GAP;
          break;
        default:
          top  = r.bottom + GAP;
          left = clamp(r.left, M, vw - TW - M);
      }

      top  = clamp(top,  M, vh - TH - M);
      left = clamp(left, M, vw - TW - M);

      Object.assign(this._tooltip.style, {
        top:    top  + 'px',
        left:   left + 'px',
        right:  'auto',
        bottom: 'auto',
      });
    }
  }

  // ── Utilitaires ───────────────────────────────────────────────────────────

  function el(tag, attrs = {}) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }
  function on(el, ev, fn) { el.addEventListener(ev, fn); }
  function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }

  // ── Lancement ─────────────────────────────────────────────────────────────

  const tut = new Tutorial();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => tut.init());
  } else {
    tut.init();
  }

  window._mosTutorial = tut;
})();
