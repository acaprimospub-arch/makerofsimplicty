const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const nodemailer = require('nodemailer');
const multer = require('multer');
const crypto = require('crypto');
const db = require('./db/database');

// ─── Multer (pièces jointes réservations) ──────────────────────────────────────
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'reservations');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const _multerStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname);
    const base = `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
    cb(null, base);
  }
});
const upload = multer({
  storage: _multerStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 Mo max
  fileFilter: (_req, file, cb) => {
    // Autorise : images, PDF, Word, Excel, texte
    const ok = /^(image\/|application\/pdf|application\/msword|application\/vnd\.|text\/)/.test(file.mimetype);
    cb(null, ok);
  }
});

// ─── Multer (tâches périodiques — photos) ─────────────────────────────────────
const TACHES_PHOTOS_DIR = path.join(__dirname, 'uploads', 'taches');
if (!fs.existsSync(TACHES_PHOTOS_DIR)) fs.mkdirSync(TACHES_PHOTOS_DIR, { recursive: true });

const _tachesStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, TACHES_PHOTOS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, `tache-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const uploadTachePhoto = multer({
  storage: _tachesStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

// ─── Pointages (photos biométriques kiosque) ──────────────────────────────────
const POINTAGES_DIR = path.join(__dirname, 'uploads', 'pointages');
if (!fs.existsSync(POINTAGES_DIR)) fs.mkdirSync(POINTAGES_DIR, { recursive: true });

// ─── Joy.io iCal Sync ──────────────────────────────────────────────────────────
function fetchUrl(url, depth = 0) {
  if (depth > 5) return Promise.reject(new Error('Too many redirects'));
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { headers: { 'User-Agent': 'MosPub-Sync/1.0' } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fetchUrl(res.headers.location, depth + 1).then(resolve).catch(reject);
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('Timeout')); });
  });
}

function unfoldIcal(text) {
  // Unfold lines (continuation lines start with space or tab)
  return text.replace(/\r\n[ \t]/g, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function getIcalProp(block, key) {
  const re = new RegExp(`^${key}(?:;[^:]*)?:(.+)`, 'm');
  const m = block.match(re);
  if (!m) return '';
  return m[1].trim()
    .replace(/\\n/g, ' ').replace(/\\N/g, ' ')
    .replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

function parseDateTime(dtStr) {
  // DTSTART;TZID=...:20260404T213000 or DTSTART:20260404T213000Z or DTSTART:20260404
  const isUTC = dtStr.endsWith('Z');
  const m = dtStr.replace(/Z$/, '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return { date: '', time: '' };

  // Si heure UTC (suffixe Z), convertir en heure de Paris
  if (isUTC && m[4]) {
    const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`);
    const fmt = new Intl.DateTimeFormat('fr-FR', {
      timeZone: 'Europe/Paris',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false
    });
    const parts = fmt.formatToParts(d);
    const get = t => parts.find(p => p.type === t)?.value || '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      time: `${get('hour')}:${get('minute')}`
    };
  }

  return {
    date: `${m[1]}-${m[2]}-${m[3]}`,
    time: m[4] ? `${m[4]}:${m[5]}` : ''
  };
}

function parseIcalEvents(raw) {
  const text = unfoldIcal(raw);
  const events = [];
  const blocks = text.split(/BEGIN:VEVENT/i);
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split(/END:VEVENT/i)[0];
    const uid         = getIcalProp(block, 'UID');
    const summary     = getIcalProp(block, 'SUMMARY');
    const description = getIcalProp(block, 'DESCRIPTION');
    const location    = getIcalProp(block, 'LOCATION');
    const dtStartRaw  = getIcalProp(block, 'DTSTART');
    const dtEndRaw    = getIcalProp(block, 'DTEND');
    const icalStatus  = getIcalProp(block, 'STATUS');

    if (!uid) continue;

    const { date, time: timeStart } = parseDateTime(dtStartRaw);
    const { time: timeEnd }         = parseDateTime(dtEndRaw);

    // Extract participants — plusieurs formats Joy.io possibles
    const combined = summary + ' ' + description;
    // Format A : mot AVANT le nombre → "Participants: 30", "Convives : 30", "Nb personnes: 30"
    const partBefore = combined.match(
      /(?:participant|personne|convive|couvert|pax|place|nb|nombre|guest|invit[eé]?|person)\w*\s*[:=.]\s*(\d+)/i
    );
    // Format B : nombre AVANT le mot → "30 personnes", "30 pax", "30 convives"
    const partAfter = combined.match(
      /(\d+)\s*(?:participant|personne|pers(?:\.|s\b|\b)|convive|couvert|pax|place|invit|person)/i
    );
    // Format C : nombre entre tirets dans le SUMMARY → "Dupont - 30 - Grande Salle"
    const partSummary = summary.match(/(?:^|\s-\s)(\d{1,3})\s*(?:-|$|\s)/);
    const participants = partBefore  ? parseInt(partBefore[1])
                       : partAfter   ? parseInt(partAfter[1])
                       : partSummary ? parseInt(partSummary[1])
                       : 0;
    // Extract customer name : "Nom Prénom - N" → prendre tout avant le dernier " - N"
    let customerName = summary;
    const nomMatch = description.match(/nom\s*[:]\s*([^\n\\,]+)/i);
    if (nomMatch) {
      customerName = nomMatch[1].trim();
    } else if (summary.includes(' - ')) {
      customerName = summary.replace(/\s+-\s+\d+\s*$/, '').trim();
    }

    // Extract space : Joy.io format réel = "Réservation confirmée [ESPACE] +33..."
    let spaceRaw = location || '';
    if (!spaceRaw) {
      const spaceFromConfirm = description.match(/r[eé]servation\s+confirm[eé]e\s+(.*?)\s*\+33/i);
      if (spaceFromConfirm) spaceRaw = spaceFromConfirm[1].trim();
    }
    if (!spaceRaw) {
      const labeled = description.match(/(?:espace|salle|space|lieu)\s*[:]\s*([^\n\\,]+)/i);
      if (labeled) spaceRaw = labeled[1].trim();
    }
    // Mapping des espaces Joy.io → noms internes du bar
    const spaceMap = {
      'coin canap': 'Petite mezzanine',
      'etage':      'Mezzanine',
      'étage':      'Mezzanine',
    };
    const spaceKey = spaceRaw.toLowerCase().trim();
    let space = spaceRaw;
    for (const [k, v] of Object.entries(spaceMap)) {
      if (spaceKey.includes(k)) { space = v; break; }
    }

    // Extract phone : Joy.io le place directement sans label ex: +33607124124
    const labeledPhone = description.match(
      /(?:t[eé]l(?:[eé]phone)?|phone|portable|mobile|mob|contact|num[eé]ro)\s*[:=.]?\s*((?:\+33[\s.\-]?|0)[1-9](?:[\s.\-]?\d){8})/i
    );
    const barePhone = description.match(/((?:\+33[\s.\-]?|0)[1-9](?:[\s.\-]?\d){8})/);
    const phone = labeledPhone ? labeledPhone[1].trim() : (barePhone ? barePhone[1].trim() : null);

    // Extract notes : supprime le boilerplate Joy.io, garde uniquement le contenu utile
    // (prix/devis, demandes spéciales, toute info non standard)
    let notes = null;
    const notesRaw = description
      .replace(/r[eé]servation\s+confirm[eé]e/gi, '')
      .replace(new RegExp((space || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '')
      .replace(/((?:\+33[\s.\-]?|0)[1-9](?:[\s.\-]?\d){8})/g, '')
      .replace(/pour\s+modifier\s+ou\s+supprimer\s*(cette\s+)?r[eé]s[ae][^\n]*/gi, '')
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (notesRaw.length >= 5) notes = notesRaw.substring(0, 300);

    const status = (icalStatus || '').toLowerCase() === 'cancelled' ? 'cancelled' : 'confirmed';

    events.push({ joy_uid: uid, customer_name: customerName, participants, date, time_start: timeStart, time_end: timeEnd, space, raw_summary: summary, raw_description: description, status, phone, notes });
  }
  return events;
}

async function syncJoyEvents() {
  const url = db.getSetting('joy_ical_url');
  if (!url) return { synced: 0, error: 'URL iCal non configurée' };
  try {
    const raw = await fetchUrl(url);
    const events = parseIcalEvents(raw);

    // Phase 1 : nettoyage préventif des doublons existants en base
    db.cleanupJoyReservationDuplicates();

    // Phase 2 : upsert de chaque événement + sa résa
    let synced = 0;
    const syncedJoyIds = [];
    for (const ev of events) {
      const joyId = db.upsertJoyEvent(ev);
      if (joyId) {
        db.upsertReservationFromJoy(joyId, ev);
        syncedJoyIds.push(joyId);
      }
      synced++;
    }

    // Phase 3 : supprime les résas Joy qui n'existent plus dans l'iCal actuel
    // (gère le cas où Joy.io change les UIDs entre deux exports)
    if (syncedJoyIds.length > 0) {
      db.cleanupStaleJoyReservations(syncedJoyIds);
    }

    db.setSetting('joy_last_sync', new Date().toISOString());
    console.log(`[Joy.io] ✅ ${synced} événements synchronisés`);
    // Notifie tous les clients connectés pour qu'ils rechargent les résas
    if (typeof io !== 'undefined') io.emit('joy:synced', { synced, total: events.length });
    return { synced, total: events.length };
  } catch (err) {
    console.error('[Joy.io] ❌ Erreur sync:', err.message);
    return { error: err.message };
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('trust proxy', 1); // fait confiance au proxy Nginx
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  SESSION_SECRET non défini — utilisation du secret de développement. Définir SESSION_SECRET en production.');
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'mos-pub-merciere-dev-only',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// ─── Helpers date (tout en UTC pour éviter les décalages de fuseau horaire) ────
function _addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().split('T')[0];
}
function _getMondayOf(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0=dimanche
  dt.setUTCDate(dt.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return dt.toISOString().split('T')[0];
}
function _dateRange(from, to) {
  const dates = [];
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));
  while (cur <= end) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

// ─── Middleware ────────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Non authentifié' });
}
function requireAdmin(req, res, next) {
  if (req.session.userId && req.session.role === 'admin') return next();
  res.status(403).json({ error: 'Accès refusé' });
}
function requireAdminOrManager(req, res, next) {
  if (req.session.userId && (req.session.role === 'admin' || req.session.role === 'manager' || req.session.role === 'direction')) return next();
  res.status(403).json({ error: 'Accès refusé' });
}
function requireDirection(req, res, next) {
  if (req.session.userId && (req.session.role === 'admin' || req.session.role === 'direction')) return next();
  res.status(403).json({ error: 'Accès refusé' });
}

// ─── Rate limiter PIN (mémoire — reset après 15min) ───────────────────────────
const _pinAttempts = new Map(); // key: string → { count, lockedUntil }
const PIN_MAX       = 5;
const PIN_LOCKOUT   = 15 * 60 * 1000;

function _checkPinLimit(key) {
  const now  = Date.now();
  const e    = _pinAttempts.get(key);
  if (!e) return { ok: true };
  if (e.lockedUntil && now < e.lockedUntil) {
    return { ok: false, mins: Math.ceil((e.lockedUntil - now) / 60000) };
  }
  return { ok: true };
}
function _recordPinFail(key) {
  const e = _pinAttempts.get(key) || { count: 0 };
  e.count++;
  if (e.count >= PIN_MAX) { e.lockedUntil = Date.now() + PIN_LOCKOUT; e.count = 0; }
  _pinAttempts.set(key, e);
}
function _clearPinLimit(key) { _pinAttempts.delete(key); }

// ─── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const ip  = req.ip || 'unknown';
  const lim = _checkPinLimit(`login:${ip}`);
  if (!lim.ok) return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${lim.mins} min.` });

  const { pin } = req.body;
  const user = db.getUserByPin(pin);
  if (!user || !user.active) {
    _recordPinFail(`login:${ip}`);
    return res.status(401).json({ error: 'Code PIN incorrect' });
  }
  _clearPinLimit(`login:${ip}`);
  req.session.userId = user.id;
  req.session.role = user.role;
  req.session.shift = user.shift;
  req.session.name = user.name;
  res.json({ id: user.id, name: user.name, role: user.role, shift: user.shift });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const user = db.getUserById(req.session.userId);
  if (!user) return res.status(401).json({ error: 'Session invalide' });
  res.json({ id: user.id, name: user.name, role: user.role, shift: user.shift });
});

// ─── Tasks ─────────────────────────────────────────────────────────────────────
app.get('/api/tasks', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.json(db.getTasksWithCompletions(today, req.session.userId, 'salle'));
});

app.post('/api/tasks/:id/complete', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.completeTask(req.params.id, req.session.userId, today);
  io.emit('task:updated', {
    taskId: parseInt(req.params.id),
    userId: req.session.userId,
    userName: req.session.name,
    completed: true,
    date: today
  });
  res.json({ ok: true });
});

app.delete('/api/tasks/:id/complete', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.uncompleteTask(req.params.id, req.session.userId, today);
  io.emit('task:updated', {
    taskId: parseInt(req.params.id),
    userId: req.session.userId,
    userName: req.session.name,
    completed: false,
    date: today
  });
  res.json({ ok: true });
});

// ── Tâches périodiques ─────────────────────────────────────────────────────────
app.use('/uploads/taches', requireAuth, express.static(TACHES_PHOTOS_DIR));
app.use('/uploads/pointages', requireAuth, express.static(POINTAGES_DIR));

app.get('/api/taches/periodiques', requireAuth, (_req, res) => {
  res.json(db.getTachesPeriodiques());
});

app.post('/api/taches/periodiques/:id/complete', requireAuth, uploadTachePhoto.single('photo'), (req, res) => {
  try {
    const tache_id = parseInt(req.params.id);
    const photo_url = req.file ? `/uploads/taches/${req.file.filename}` : null;
    const result = db.completeTachePeriodique({
      tache_id,
      user_id:    req.session.userId,
      user_name:  req.session.name,
      commentaire: req.body.commentaire || null,
      photo_url
    });
    io.emit('tache_periodique:done', { tache_id, completion_id: result.lastInsertRowid });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/taches/periodiques/:id/history', requireAuth, (req, res) => {
  res.json(db.getTachePeriodiquesHistory(parseInt(req.params.id)));
});

// ─── Pointeuse ────────────────────────────────────────────────────────────────
app.get('/api/pointage/today', requireAuth, (req, res) => {
  res.json(db.getPointageToday(req.session.userId) || null);
});

app.post('/api/pointage/clock-in', requireAuth, (req, res) => {
  const id = db.clockIn(req.session.userId);
  const entry = db.getPointageToday(req.session.userId);
  io.emit('pointage:updated', { userId: req.session.userId });
  res.json({ ok: true, entry });
});

app.post('/api/pointage/clock-out', requireAuth, (req, res) => {
  db.clockOut(req.session.userId);
  const entry = db.getPointageToday(req.session.userId);
  io.emit('pointage:updated', { userId: req.session.userId });
  res.json({ ok: true, entry });
});

app.get('/api/pointage/history', requireAuth, (req, res) => {
  const from = req.query.from || new Date(Date.now() - 30*86400000).toLocaleString('sv-SE', { timeZone:'Europe/Paris' }).slice(0,10);
  const to   = req.query.to   || new Date().toLocaleString('sv-SE', { timeZone:'Europe/Paris' }).slice(0,10);
  res.json(db.getPointagesForUser(req.session.userId, from, to));
});

app.get('/api/admin/pointages', requireAdminOrManager, (req, res) => {
  const date = req.query.date || new Date().toLocaleString('sv-SE', { timeZone:'Europe/Paris' }).slice(0,10);
  res.json(db.getAllPointagesForDate(date));
});

app.post('/api/admin/pointages/:userId/reset-day', requireAdmin, (req, res) => {
  const userId = parseInt(req.params.userId);
  const date   = req.body.date || new Date().toLocaleString('sv-SE', { timeZone:'Europe/Paris' }).slice(0,10);
  const record = db.resetPointageDay(userId, date);
  const _safeUnlink = (filename) => {
    if (!filename || /[/\\]|\.\./.test(filename)) return;
    try { fs.unlinkSync(path.join(POINTAGES_DIR, filename)); } catch(e) {}
  };
  _safeUnlink(record?.arrived_photo);
  _safeUnlink(record?.left_photo);
  io.emit('pointage:updated', { userId });
  res.json({ ok: true });
});

// ─── Kiosque multi-user (tablette pointeuse sans session) ─────────────────────
app.get('/api/kiosk/staff', (req, res) => {
  res.json(db.getKioskStaffList());
});

app.post('/api/kiosk/clock', (req, res) => {
  const { userId, pin } = req.body;
  if (!pin || !userId) return res.status(400).json({ ok: false, error: 'Données manquantes' });

  const uid = parseInt(userId);
  const lim = _checkPinLimit(`kiosk:${uid}`);
  if (!lim.ok) return res.status(429).json({ ok: false, error: `Trop de tentatives. Réessaie dans ${lim.mins} min.` });

  const user = db.verifyUserPin(uid, pin);
  if (!user) {
    _recordPinFail(`kiosk:${uid}`);
    return res.json({ ok: false, error: 'PIN incorrect' });
  }
  _clearPinLimit(`kiosk:${uid}`);
  const today = db.getPointageToday(user.id);
  let action;
  if (!today) { db.clockIn(user.id); action = 'in'; }
  else if (!today.left_at) { db.clockOut(user.id); action = 'out'; }
  else { return res.json({ ok: false, error: 'done' }); }
  const entry = db.getPointageToday(user.id);
  io.emit('pointage:updated', { userId: user.id });
  res.json({ ok: true, user: { id: user.id, name: user.name }, action, entry, pointageId: entry.id });
});

app.post('/api/kiosk/clock/photo', (req, res) => {
  const { userId, action, photo } = req.body;
  if (!userId || !action || !photo) return res.status(400).json({ ok: false });

  const uid = parseInt(userId);
  if (isNaN(uid) || uid <= 0) return res.status(400).json({ ok: false });
  if (!['in', 'out'].includes(action)) return res.status(400).json({ ok: false });

  // Vérifier qu'il existe bien un pointage actif aujourd'hui pour cet utilisateur
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 10);
  const pointage = db.getPointageToday(uid);
  if (!pointage) return res.status(403).json({ ok: false, error: 'Aucun pointage actif' });

  try {
    const mimeMatch = photo.match(/^data:(image\/\w+);base64,/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const ext  = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
    const base64 = photo.replace(/^data:image\/\w+;base64,/, '');
    if (base64.length > 4 * 1024 * 1024) return res.status(413).json({ ok: false, error: 'Photo trop grande' }); // max ~3 Mo
    const buf   = Buffer.from(base64, 'base64');
    const token = crypto.randomBytes(8).toString('hex');
    const fname = `${uid}_${today}_${action}_${token}.${ext}`;
    fs.writeFileSync(path.join(POINTAGES_DIR, fname), buf);
    db.savePointagePhoto(uid, today, action, fname);
    res.json({ ok: true });
  } catch(e) {
    console.error('photo pointage:', e);
    res.status(500).json({ ok: false });
  }
});

// Admin task management
app.get('/api/admin/tasks', requireAdmin, (req, res) => {
  res.json(db.getAllTasks());
});

app.post('/api/admin/tasks', requireAdmin, (req, res) => {
  const id = db.createTask(req.body);
  res.json(db.getTaskById(id));
});

app.put('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  db.updateTask(req.params.id, req.body);
  res.json(db.getTaskById(req.params.id));
});

app.delete('/api/admin/tasks/:id', requireAdmin, (req, res) => {
  db.deactivateTask(req.params.id);
  res.json({ ok: true });
});

// ─── Tables (floor plan) ───────────────────────────────────────────────────────
app.get('/api/tables', requireAuth, (req, res) => {
  res.json(db.getTables());
});

app.post('/api/tables', requireAdminOrManager, (req, res) => {
  const id = db.createTable(req.body);
  const table = db.getTableById(id);
  io.emit('table:created', table);
  res.json(table);
});

app.put('/api/tables/:id', requireAdminOrManager, (req, res) => {
  db.updateTable(req.params.id, req.body);
  const table = db.getTableById(req.params.id);
  io.emit('table:updated', table);
  res.json(table);
});

app.delete('/api/tables/:id', requireAdminOrManager, (req, res) => {
  db.deleteTable(req.params.id);
  io.emit('table:deleted', { id: parseInt(req.params.id) });
  res.json({ ok: true });
});

app.put('/api/tables/:id/note', requireAuth, (req, res) => {
  const { note } = req.body;
  db.updateTableNote(req.params.id, note);
  const table = db.getTableById(Number(req.params.id));
  io.emit('table:updated', table);
  res.json({ ok: true });
});

// ─── Reservations ──────────────────────────────────────────────────────────────
app.get('/api/reservations', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.getReservationsByDate(date));
});

app.post('/api/reservations', requireAuth, (req, res) => {
  const id = db.createReservation(req.body);
  const r = db.getReservationById(id);
  io.emit('reservation:updated', r);
  res.json(r);
});

app.put('/api/reservations/:id', requireAuth, (req, res) => {
  // admin_notes réservé aux admins et managers
  const body = { ...req.body };
  if (req.session.role !== 'admin' && req.session.role !== 'manager') delete body.admin_notes;
  db.updateReservation(req.params.id, body);
  const r = db.getReservationById(req.params.id);
  io.emit('reservation:updated', r);
  if (req.body.status === 'arrived') {
    io.emit('alert:cancel', { reservationId: parseInt(req.params.id) });
  }
  res.json(r);
});

app.delete('/api/reservations/:id', requireAuth, (req, res) => {
  const r = db.getReservationById(req.params.id);
  // Supprimer aussi les fichiers liés
  const atts = db.getReservationAttachments(req.params.id);
  atts.forEach(a => { try { fs.unlinkSync(path.join(UPLOADS_DIR, a.filename)); } catch(e) {} });
  db.deleteReservation(req.params.id);
  io.emit('reservation:deleted', { id: parseInt(req.params.id), table_id: r?.table_id });
  res.json({ ok: true });
});

// ─── Pièces jointes réservations ───────────────────────────────────────────────
app.get('/api/reservations/:id/attachments', requireAuth, (req, res) => {
  res.json(db.getReservationAttachments(req.params.id));
});

app.post('/api/reservations/:id/attachments', requireAdminOrManager, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fichier manquant ou type non autorisé (max 10 Mo)' });
  const id = db.addReservationAttachment({
    reservation_id: req.params.id,
    filename:       req.file.filename,
    original_name:  req.file.originalname,
    mimetype:       req.file.mimetype,
    size:           req.file.size,
    uploaded_by:    req.session.userId,
  });
  res.json(db.getAttachmentById(id));
});

app.get('/api/attachments/:id/file', requireAuth, (req, res) => {
  const att = db.getAttachmentById(req.params.id);
  if (!att) return res.status(404).json({ error: 'Fichier introuvable' });
  const filePath = path.join(UPLOADS_DIR, att.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Fichier introuvable sur le disque' });
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(att.original_name)}"`);
  res.sendFile(filePath);
});

app.delete('/api/attachments/:id', requireAdminOrManager, (req, res) => {
  const att = db.getAttachmentById(req.params.id);
  if (!att) return res.status(404).json({ error: 'Introuvable' });
  try { fs.unlinkSync(path.join(UPLOADS_DIR, att.filename)); } catch(e) {}
  db.deleteAttachment(req.params.id);
  res.json({ ok: true });
});

// ─── Shift Messages ─────────────────────────────────────────────────────────────
app.get('/api/shift-messages', requireAuth, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.getShiftMessages(date));
});

app.post('/api/shift-messages', requireAuth, (req, res) => {
  const { message } = req.body;
  // date for midi→soir : today; date for soir→matin : today (matin reads it as "yesterday")
  const date = new Date().toISOString().split('T')[0];
  const from_shift = (req.session.shift === 'soir') ? 'soir' : 'midi';
  const msg = db.upsertShiftMessage({ from_shift, date, message, author_id: req.session.userId, author_name: req.session.name });
  io.emit('shift-message:updated', { from_shift, date, msg });
  res.json(msg);
});

// ─── Admin: Staff ──────────────────────────────────────────────────────────────
app.get('/api/admin/staff', requireAdmin, (req, res) => {
  res.json(db.getAllUsers());
});

app.post('/api/admin/staff', requireAdmin, (req, res) => {
  const { pin } = req.body;
  if (!pin || !/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN invalide (4 à 6 chiffres)' });
  if (db.isPinTaken(pin)) return res.status(400).json({ error: 'Ce PIN est déjà utilisé' });
  const id = db.createUser(req.body);
  res.json(db.getUserById(id));
});

app.put('/api/admin/staff/:id', requireAdmin, (req, res) => {
  const { pin } = req.body;
  if (pin && pin !== '') {
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ error: 'PIN invalide (4 à 6 chiffres)' });
    if (db.isPinTaken(pin, req.params.id)) return res.status(400).json({ error: 'Ce PIN est déjà utilisé' });
  }
  db.updateUser(req.params.id, req.body);
  res.json(db.getUserById(req.params.id));
});

app.delete('/api/admin/staff/:id', requireAdmin, (req, res) => {
  if (parseInt(req.params.id) === req.session.userId) {
    return res.status(400).json({ error: 'Impossible de supprimer son propre compte' });
  }
  db.deleteUser(req.params.id);
  res.json({ ok: true });
});

// ─── Admin: Stats & Logs ───────────────────────────────────────────────────────
app.get('/api/admin/stats', requireAdminOrManager, (req, res) => {
  const { from, to } = req.query;
  res.json(db.getStats(from, to));
});

app.get('/api/admin/daily-log', requireAdminOrManager, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.getDailyLog(date));
});

app.get('/api/admin/dashboard', requireAdminOrManager, (req, res) => {
  const date = req.query.date || new Date().toISOString().split('T')[0];
  res.json(db.getDashboardData(date));
});

app.get('/api/admin/reservation-stats', requireAdminOrManager, (req, res) => {
  const { from, to } = req.query;
  res.json(db.getReservationStats(from, to));
});

app.get('/api/reservations/range', requireAdminOrManager, (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: 'from et to requis' });
  res.json(db.getReservationsByRange(from, to));
});

app.get('/api/marketing/stats', requireAdminOrManager, (req, res) => {
  res.json(db.getUpcomingReservationStats());
});


// ─── 15-minute alert system ────────────────────────────────────────────────────
const alertedReservations = new Set();

// ─── Joy.io Routes ─────────────────────────────────────────────────────────────
app.get('/api/joy/events', requireAuth, (req, res) => {
  const { date, upcoming } = req.query;
  const events = db.getJoyEvents({ date, upcoming: upcoming === '1', all: !date && !upcoming });
  res.json(events.map(ev => ({ ...ev, assigned_tables: JSON.parse(ev.assigned_tables || '[]') })));
});

app.post('/api/joy/assign-table', requireAdminOrManager, (req, res) => {
  const { table_id, joy_event_id } = req.body;
  if (!table_id && table_id !== 0) return res.status(400).json({ error: 'table_id manquant' });
  db.assignTableToJoyEvent(table_id, joy_event_id || null);
  io.emit('joy:updated');
  res.json({ ok: true });
});

app.post('/api/joy/sync', requireAdminOrManager, async (req, res) => {
  const result = await syncJoyEvents();
  res.json(result);
});

app.get('/api/joy/config', requireAdminOrManager, (req, res) => {
  res.json({
    url: db.getSetting('joy_ical_url') || '',
    lastSync: db.getSetting('joy_last_sync') || null
  });
});

app.put('/api/joy/config', requireAdmin, (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL manquante' });
  db.setSetting('joy_ical_url', url);
  res.json({ ok: true });
});

app.delete('/api/joy/events/:id', requireAdminOrManager, (req, res) => {
  db.deleteJoyEvent(req.params.id);
  res.json({ ok: true });
});

function createMailTransporter() {
  const user = db.getSetting('email_smtp_user');
  const pass = db.getSetting('email_smtp_pass');
  if (!user || !pass) return null;
  return nodemailer.createTransport({ host:'smtp.gmail.com', port:587, secure:false, auth:{ user, pass } });
}

// Routes admin email config
app.get('/api/admin/email-config', requireAdmin, (req, res) => {
  const user = db.getSetting('email_smtp_user') || '';
  const pass = db.getSetting('email_smtp_pass') || '';
  res.json({ user, configured: !!(user && pass), lastSent: db.getSetting('email_planning_last_sent') });
});
app.put('/api/admin/email-config', requireAdmin, (req, res) => {
  const { user, pass } = req.body;
  if (user) db.setSetting('email_smtp_user', user.trim());
  if (pass) db.setSetting('email_smtp_pass', pass.trim());
  res.json({ ok:true });
});
// ─── Direction — Vue d'ensemble ───────────────────────────────────────────────
app.get('/api/direction/overview', requireDirection, (req, res) => {
  const today = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 10);
  const pointages = db.getAllPointagesForDate(today);
  res.json({ today, pointages });
});

// ─── Webhook déploiement automatique ───────────────────────────────────────────
const DEPLOY_TOKEN = process.env.DEPLOY_TOKEN || 'mos-deploy-secret';
if (!process.env.DEPLOY_TOKEN || process.env.DEPLOY_TOKEN === 'mos-deploy-secret') {
  console.warn('⚠️  DEPLOY_TOKEN non sécurisé — définir DEPLOY_TOKEN dans .env en production (accès git pull + pm2 restart).');
}
app.post('/webhook/deploy', express.json(), (req, res) => {
  const token = req.headers['x-deploy-token'] || req.query.token;
  if (token !== DEPLOY_TOKEN) {
    return res.status(403).json({ error: 'Token invalide' });
  }
  res.json({ ok: true, message: 'Déploiement en cours…' });
  console.log('[Deploy] 🚀 Webhook reçu — git pull + pm2 restart');
  exec(
    'cd /var/www/mos && git pull origin main && pm2 reload mos-pub',
    (err, stdout, stderr) => {
      if (err) console.error('[Deploy] ❌', err.message);
      else console.log('[Deploy] ✅\n', stdout);
    }
  );
});

// Auto-sync Joy.io au démarrage puis toutes les 2 min
setTimeout(syncJoyEvents, 8000);
setInterval(syncJoyEvents, 2 * 60 * 1000);

setInterval(() => {
  const now = new Date();
  const today = now.toLocaleString('sv-SE', { timeZone: 'Europe/Paris' }).slice(0, 10);
  const reservations = db.getReservationsByDate(today);

  reservations.forEach(r => {
    if (r.status !== 'confirmed' || alertedReservations.has(r.id)) return;
    // Calcul via timestamp pour éviter le débordement de minutes (ex: 23h50 + 15min = 00h05)
    const resaTime  = new Date(`${today}T${r.time}:00`);
    const alertTime = new Date(resaTime.getTime() + 15 * 60 * 1000);
    if (now >= alertTime) {
      alertedReservations.add(r.id);
      io.emit('alert:no_show', {
        reservationId: r.id,
        tableId: r.table_id,
        tableName: r.table_name,
        customerName: r.customer_name,
        partySize: r.party_size,
        time: r.time,
        message: `⚠️ ${r.customer_name} (${r.party_size} pers.) — Table ${r.table_name || r.table_id} — Pas d'arrivée depuis ${r.time}`
      });
    }
  });
}, 30000); // Check every 30 seconds

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('\n🍺 Maker of Simplicity — Mos Pub Mercière');
  console.log(`📡 Serveur démarré sur http://localhost:${PORT}`);

  // Vérification sécurité PINs faibles (async pour ne pas bloquer le démarrage)
  setImmediate(() => {
    try {
      const weak = db.checkWeakAdminPins();
      if (weak.length) {
        console.warn('\n⚠️  SÉCURITÉ — Admin(s) avec PIN faible détecté(s) :');
        weak.forEach(w => console.warn(`   ✗ ${w.name} utilise le PIN "${w.pin}" — à changer immédiatement`));
        console.warn('   → Rendez-vous dans /admin/equipe.html pour modifier le PIN.\n');
      } else {
        console.log('✅ Sécurité PINs : aucun PIN faible détecté sur les comptes admin/direction.\n');
      }
    } catch(e) {
      console.warn('⚠️  Impossible de vérifier les PINs admin :', e.message);
    }
  });
});
