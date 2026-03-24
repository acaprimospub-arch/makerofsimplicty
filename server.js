const express = require('express');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const db = require('./db/database');

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
  const m = dtStr.replace(/Z$/, '').match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/);
  if (!m) return { date: '', time: '' };
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
    return { synced, total: events.length };
  } catch (err) {
    console.error('[Joy.io] ❌ Erreur sync:', err.message);
    return { error: err.message };
  }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'mos-pub-merciere-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

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
  if (req.session.userId && (req.session.role === 'admin' || req.session.role === 'manager')) return next();
  res.status(403).json({ error: 'Accès refusé' });
}

// ─── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', (req, res) => {
  const { pin } = req.body;
  const user = db.getUserByPin(pin);
  if (!user || !user.active) return res.status(401).json({ error: 'Code PIN incorrect' });
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
  const domain = req.session.shift === 'cuisine' ? 'cuisine' : 'salle';
  res.json(db.getTasksWithCompletions(today, req.session.userId, domain));
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
  db.updateReservation(req.params.id, req.body);
  const r = db.getReservationById(req.params.id);
  io.emit('reservation:updated', r);
  if (req.body.status === 'arrived') {
    io.emit('alert:cancel', { reservationId: parseInt(req.params.id) });
  }
  res.json(r);
});

app.delete('/api/reservations/:id', requireAuth, (req, res) => {
  const r = db.getReservationById(req.params.id);
  db.deleteReservation(req.params.id);
  io.emit('reservation:deleted', { id: parseInt(req.params.id), table_id: r?.table_id });
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
  if (db.getUserByPin(pin)) return res.status(400).json({ error: 'Ce PIN est déjà utilisé' });
  const id = db.createUser(req.body);
  res.json(db.getUserById(id));
});

app.put('/api/admin/staff/:id', requireAdmin, (req, res) => {
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

// Auto-sync Joy.io au démarrage puis toutes les 30 min
setTimeout(syncJoyEvents, 8000);
setInterval(syncJoyEvents, 30 * 60 * 1000);

setInterval(() => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const reservations = db.getReservationsByDate(today);

  reservations.forEach(r => {
    if (r.status !== 'confirmed' || alertedReservations.has(r.id)) return;
    const [rHour, rMin] = r.time.split(':').map(Number);
    const alertTime = new Date(now);
    alertTime.setHours(rHour, rMin + 15, 0, 0);
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
  console.log('🔑 PIN Admin par défaut : 0000\n');
});
