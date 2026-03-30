'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'accounting.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// ─────────────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT,
  country TEXT,
  country_name TEXT,
  tax_regime TEXT,
  period_type TEXT DEFAULT 'monthly',
  period_close_day INTEGER DEFAULT 30,
  currency TEXT DEFAULT 'COP',
  setup_complete INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  settings TEXT DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT,
  amount REAL,
  currency TEXT DEFAULT 'COP',
  original_currency TEXT,
  original_amount REAL,
  description TEXT,
  category TEXT,
  puc_code TEXT,
  type TEXT,
  source TEXT,
  deductible INTEGER DEFAULT 1,
  tax_notes TEXT,
  alert TEXT,
  confidence TEXT,
  period TEXT,
  document_id INTEGER,
  raw_input TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  filename TEXT,
  type TEXT,
  content TEXT,
  processed INTEGER DEFAULT 0,
  period TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS periods (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  period TEXT NOT NULL,
  type TEXT,
  status TEXT DEFAULT 'open',
  report_filename TEXT,
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, period)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  message TEXT,
  type TEXT,
  due_date TEXT,
  sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ─────────────────────────────────────────────────────────────────────────────
// USER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function createUser(data) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, country, country_name, tax_regime, period_type, period_close_day, currency, setup_complete, settings)
    VALUES (@id, @name, @country, @country_name, @tax_regime, @period_type, @period_close_day, @currency, @setup_complete, @settings)
  `);
  stmt.run({
    id: data.id,
    name: data.name || null,
    country: data.country || null,
    country_name: data.country_name || null,
    tax_regime: data.tax_regime || null,
    period_type: data.period_type || 'monthly',
    period_close_day: data.period_close_day || 30,
    currency: data.currency || 'COP',
    setup_complete: data.setup_complete || 0,
    settings: data.settings || '{}'
  });
  return getUser(data.id);
}

function updateUser(id, updates) {
  const fields = Object.keys(updates).map(k => `${k} = @${k}`).join(', ');
  const stmt = db.prepare(`UPDATE users SET ${fields} WHERE id = @id`);
  stmt.run({ ...updates, id });
  return getUser(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// TRANSACTION FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function addTransaction(data) {
  const stmt = db.prepare(`
    INSERT INTO transactions
      (user_id, date, amount, currency, original_currency, original_amount,
       description, category, puc_code, type, source, deductible, tax_notes,
       alert, confidence, period, document_id, raw_input)
    VALUES
      (@user_id, @date, @amount, @currency, @original_currency, @original_amount,
       @description, @category, @puc_code, @type, @source, @deductible, @tax_notes,
       @alert, @confidence, @period, @document_id, @raw_input)
  `);
  const result = stmt.run({
    user_id: data.user_id,
    date: data.date || new Date().toISOString().split('T')[0],
    amount: data.amount,
    currency: data.currency || 'COP',
    original_currency: data.original_currency || null,
    original_amount: data.original_amount || null,
    description: data.description,
    category: data.category || null,
    puc_code: data.puc_code || null,
    type: data.type,
    source: data.source || null,
    deductible: data.deductible === false ? 0 : 1,
    tax_notes: data.tax_notes || null,
    alert: data.alert || null,
    confidence: data.confidence || 'medium',
    period: data.period || null,
    document_id: data.document_id || null,
    raw_input: data.raw_input || null
  });
  return result.lastInsertRowid;
}

function getTransactions(userId, period = null) {
  if (period) {
    return db.prepare('SELECT * FROM transactions WHERE user_id = ? AND period = ? ORDER BY date').all(userId, period);
  }
  return db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date').all(userId);
}

function getTransactionCount(userId, period = null) {
  if (period) {
    return db.prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ? AND period = ?').get(userId, period).count;
  }
  return db.prepare('SELECT COUNT(*) as count FROM transactions WHERE user_id = ?').get(userId).count;
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCUMENT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function addDocument(data) {
  const stmt = db.prepare(`
    INSERT INTO documents (user_id, filename, type, content, processed, period)
    VALUES (@user_id, @filename, @type, @content, @processed, @period)
  `);
  const result = stmt.run({
    user_id: data.user_id,
    filename: data.filename || null,
    type: data.type || null,
    content: data.content || null,
    processed: data.processed || 0,
    period: data.period || null
  });
  return result.lastInsertRowid;
}

function getDocuments(userId, period = null) {
  if (period) {
    return db.prepare('SELECT * FROM documents WHERE user_id = ? AND period = ?').all(userId, period);
  }
  return db.prepare('SELECT * FROM documents WHERE user_id = ?').all(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIOD FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function getCurrentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function getOrCreatePeriod(userId, period, type = 'monthly') {
  const existing = db.prepare('SELECT * FROM periods WHERE user_id = ? AND period = ?').get(userId, period);
  if (existing) return existing;

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO periods (user_id, period, type, status)
    VALUES (?, ?, ?, 'open')
  `);
  stmt.run(userId, period, type);
  return db.prepare('SELECT * FROM periods WHERE user_id = ? AND period = ?').get(userId, period);
}

function closePeriod(userId, period, reportFilename) {
  const stmt = db.prepare(`
    UPDATE periods SET status = 'closed', report_filename = ?, closed_at = datetime('now')
    WHERE user_id = ? AND period = ?
  `);
  stmt.run(reportFilename, userId, period);
}

function getPeriods(userId) {
  return db.prepare('SELECT * FROM periods WHERE user_id = ? ORDER BY period DESC').all(userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERT FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function addAlert(data) {
  const stmt = db.prepare(`
    INSERT INTO alerts (user_id, message, type, due_date, sent)
    VALUES (@user_id, @message, @type, @due_date, @sent)
  `);
  const result = stmt.run({
    user_id: data.user_id,
    message: data.message,
    type: data.type || 'info',
    due_date: data.due_date || null,
    sent: data.sent || 0
  });
  return result.lastInsertRowid;
}

function getPendingAlerts(userId) {
  return db.prepare('SELECT * FROM alerts WHERE user_id = ? AND sent = 0 ORDER BY created_at').all(userId);
}

module.exports = {
  db,
  getUser,
  createUser,
  updateUser,
  addTransaction,
  getTransactions,
  getTransactionCount,
  addDocument,
  getDocuments,
  getOrCreatePeriod,
  closePeriod,
  getPeriods,
  getCurrentPeriod,
  addAlert,
  getPendingAlerts
};
