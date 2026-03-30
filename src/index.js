'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

// ── DB ────────────────────────────────────────────────────────────────────────
const dbModule = require('./database/db');
const {
  getUser, createUser, updateUser,
  addTransaction, getTransactions, getTransactionCount,
  addDocument, getDocuments,
  getOrCreatePeriod, closePeriod, getPeriods, getCurrentPeriod,
  addAlert, getPendingAlerts
} = dbModule;

// ── AI / Claude ───────────────────────────────────────────────────────────────
const {
  askAccountant, extractTransactionsFromText,
  extractTransaction, generateSummary, analyzeTransaction
} = require('./agent/claude');

// ── Document processor ────────────────────────────────────────────────────────
const { processFile } = require('./documents/processor');

// ── Period manager ────────────────────────────────────────────────────────────
const {
  getCurrentPeriodString, isPeriodCloseApproaching,
  generatePeriodClose, getPeriodStats
} = require('./periods/manager');

// ── Gmail (legacy) ────────────────────────────────────────────────────────────
const { getAuthUrl, getTokens, fetchPaymentEmails } = require('./email/gmail');

// ── Excel ─────────────────────────────────────────────────────────────────────
const { generateExcel } = require('./excel/generator');

// ── Multer for file uploads ───────────────────────────────────────────────────
let multer;
try {
  multer = require('multer');
} catch (e) {
  multer = null;
  console.warn('⚠️  multer not installed — /upload endpoint disabled');
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPRESS APP
// ─────────────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Ensure data dirs exist
const dataDir = path.join(__dirname, '../data');
const uploadsDir = path.join(dataDir, 'uploads');
[dataDir, uploadsDir].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); });

// ── In-memory chat histories ──────────────────────────────────────────────────
const chatHistories = {};
const userTokens = {};

// ─────────────────────────────────────────────────────────────────────────────
// MULTER SETUP
// ─────────────────────────────────────────────────────────────────────────────
let upload = null;
if (multer) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}_${safe}`);
    }
  });
  upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
    fileFilter: (req, file, cb) => {
      const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'text/csv',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
      if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls|pdf|jpg|jpeg|png|gif|webp)$/i)) {
        cb(null, true);
      } else {
        cb(new Error(`Tipo de archivo no soportado: ${file.mimetype}`));
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: get or create user from request
// ─────────────────────────────────────────────────────────────────────────────
function getOrCreateUser(userId) {
  let user = getUser(userId);
  if (!user) {
    createUser({
      id: userId,
      currency: 'COP',
      period_type: 'monthly',
      period_close_day: 30,
      setup_complete: 1
    });
    user = getUser(userId);
  }
  return user;
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── Status ────────────────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ status: '🧾 Accounting Agent running', version: '3.0' });
});

// ── Chat ──────────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { userId = 'default', message } = req.body;
  if (!message) return res.status(400).json({ error: 'Se requiere un mensaje.' });

  const user = getOrCreateUser(userId);
  if (!chatHistories[userId]) chatHistories[userId] = [];

  // Check if it contains transaction-like content
  const transactionKeywords = /\$|\d+[\.,]\d+|\d+ (pesos|usd|eur|cop|mxn|ars)|(pagué|cobré|vendí|compré|recibí|transferí|gasté|factura|ingreso|gasto)/i;
  const looksLikeTransaction = transactionKeywords.test(message);

  try {
    let reply;

    if (looksLikeTransaction) {
      // Try to extract transactions first
      const transactions = await extractTransactionsFromText(message, user);

      if (transactions.length > 0) {
        // Return structured response with transactions for UI confirmation
        return res.json({
          type: 'transactions',
          transactions,
          reply: `He encontrado ${transactions.length} transacción(es). ¿Las confirmo y guardo en el período actual?`,
          userId
        });
      }
    }

    reply = await askAccountant(message, chatHistories[userId], user);

    chatHistories[userId].push({ role: 'user', content: message });
    chatHistories[userId].push({ role: 'assistant', content: reply });
    if (chatHistories[userId].length > 40) chatHistories[userId] = chatHistories[userId].slice(-40);

    res.json({ type: 'message', reply, userId });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Confirm transactions ──────────────────────────────────────────────────────
app.post('/transactions/confirm', (req, res) => {
  const { userId = 'default', transactions } = req.body;
  if (!transactions || !Array.isArray(transactions)) {
    return res.status(400).json({ error: 'Se requieren transacciones.' });
  }

  const user = getOrCreateUser(userId);
  const period = getCurrentPeriodString(user);
  getOrCreatePeriod(userId, period, user.period_type || 'monthly');

  const ids = [];
  for (const tx of transactions) {
    const id = addTransaction({ ...tx, user_id: userId, period });
    ids.push(id);
  }

  res.json({ saved: ids.length, period, ids });
});

// ── File upload ───────────────────────────────────────────────────────────────
if (upload) {
  app.post('/upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió archivo.' });

    const userId = req.body.userId || req.query.userId || 'default';
    const user = getOrCreateUser(userId);

    // Save document record
    const docId = addDocument({
      user_id: userId,
      filename: req.file.originalname,
      type: req.file.mimetype,
      processed: 0,
      period: getCurrentPeriodString(user)
    });

    try {
      const result = await processFile(req.file.path, req.file.mimetype, user);

      // Mark doc as processed
      dbModule.db.prepare('UPDATE documents SET processed = 1 WHERE id = ?').run(docId);

      res.json({
        type: 'transactions',
        transactions: result.transactions || [],
        filename: req.file.originalname,
        docId,
        error: result.error || null
      });
    } catch (e) {
      res.status(500).json({ error: e.message, transactions: [] });
    }
  });
} else {
  app.post('/upload', (req, res) => {
    res.status(503).json({ error: 'multer no instalado. Ejecuta: npm install multer' });
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────
app.get('/stats/:userId', (req, res) => {
  const user = getOrCreateUser(req.params.userId);
  const period = getCurrentPeriodString(user);
  const stats = getPeriodStats(req.params.userId, period, { getTransactions, getDocuments });
  res.json({ ...stats, period, currency: user.currency || 'COP' });
});

// ── Periods ───────────────────────────────────────────────────────────────────
app.get('/periods/:userId', (req, res) => {
  const periods = getPeriods(req.params.userId);
  res.json({ periods });
});

app.post('/periods/:userId/close', async (req, res) => {
  const { userId } = req.params;
  const user = getOrCreateUser(userId);
  const period = getCurrentPeriodString(user);

  try {
    const filename = await generatePeriodClose(userId, period, {
      db: dbModule.db,
      getTransactions,
      getDocuments,
      closePeriod,
      getUser
    });
    res.json({ filename, downloadUrl: `/download/${filename}`, period });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Download ──────────────────────────────────────────────────────────────────
app.get('/download/:filename', (req, res) => {
  const filename = req.params.filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filepath = path.join(dataDir, filename);
  if (!fs.existsSync(filepath)) return res.status(404).json({ error: 'Archivo no encontrado' });
  res.download(filepath);
});

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY GMAIL ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.get('/auth/gmail', (req, res) => res.redirect(getAuthUrl()));

app.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  const userId = state || 'default';
  try {
    const tokens = await getTokens(code);
    userTokens[userId] = tokens;
    res.redirect(`/?connected=true&userId=${userId}`);
  } catch (e) {
    res.status(500).json({ error: 'OAuth failed', details: e.message });
  }
});

app.get('/auth/url', (req, res) => res.json({ url: getAuthUrl() }));

app.post('/generate', async (req, res) => {
  const { userId } = req.body;
  const tokens = userTokens[userId];
  if (!tokens) return res.status(401).json({ error: 'Gmail not connected.' });

  res.json({ status: 'processing', message: '📧 Leyendo emails...' });
  processEmailsBackground(userId, tokens).then(r => { userTokens[`${userId}_result`] = r; }).catch(e => { userTokens[`${userId}_result`] = { error: e.message }; });
});

app.get('/result/:userId', (req, res) => {
  const result = userTokens[`${req.params.userId}_result`];
  if (!result) return res.json({ ready: false });
  delete userTokens[`${req.params.userId}_result`];
  res.json({ ready: true, ...result });
});

app.post('/chat/reset', (req, res) => {
  const { userId = 'default' } = req.body;
  chatHistories[userId] = [];
  res.json({ status: 'Historial limpiado', userId });
});

app.post('/analyze', async (req, res) => {
  const { description, amount, currency = 'COP', context = 'empresa' } = req.body;
  if (!description || !amount) return res.status(400).json({ error: 'Se requieren description y amount.' });
  try {
    const analysis = await analyzeTransaction(description, amount, currency, context);
    res.json({ analysis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND EMAIL PROCESSING
// ─────────────────────────────────────────────────────────────────────────────
async function processEmailsBackground(userId, tokens) {
  const emails = await fetchPaymentEmails(tokens, 100);
  const transactions = [];
  for (const email of emails) {
    const tx = await extractTransaction(email);
    if (tx && tx.confidence !== 'low') transactions.push(tx);
  }
  if (transactions.length === 0) return { error: 'No se encontraron transacciones.' };
  const summary = await generateSummary(transactions);
  const { filename } = generateExcel(transactions, summary, userId);
  return {
    transactions: transactions.length,
    summary,
    filename,
    downloadUrl: `/download/${filename}`,
    totals: {
      income: transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0),
      expenses: transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0)
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// INIT TELEGRAM BOT (optional)
// ─────────────────────────────────────────────────────────────────────────────
if (process.env.TELEGRAM_BOT_TOKEN) {
  try {
    const { createBot } = require('./telegram/bot');
    const dbFns = {
      getUser, createUser, updateUser,
      addTransaction, getTransactions, getDocuments,
      addDocument, getOrCreatePeriod, closePeriod, getPeriods
    };
    createBot(dbFns);
  } catch (e) {
    console.warn('⚠️  Could not start Telegram bot:', e.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`🧾 Accounting Agent running on http://localhost:${PORT}`);
});
