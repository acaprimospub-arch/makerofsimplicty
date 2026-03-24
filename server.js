const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const path = require('path');
const db = require('./db/database');

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
  res.json(db.getTasksWithCompletions(today, req.session.userId));
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
