require('dotenv').config();
const express = require('express');
const path = require('path');
const { getAuthUrl, getTokens, fetchPaymentEmails } = require('./email/gmail');
const { extractTransaction, generateSummary } = require('./agent/claude');
const { generateExcel } = require('./excel/generator');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Store tokens in memory (use DB in production)
const userTokens = {};

// ── Step 1: Start Gmail OAuth ─────────────────────────────────────
app.get('/auth/gmail', (req, res) => {
  const url = getAuthUrl();
  res.redirect(url);
});

// ── Step 2: OAuth callback ────────────────────────────────────────
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

// ── Step 3: Get auth URL for frontend ────────────────────────────
app.get('/auth/url', (req, res) => {
  const url = getAuthUrl();
  res.json({ url });
});

// ── Step 4: Generate P&L report ──────────────────────────────────
app.post('/generate', async (req, res) => {
  const { userId } = req.body;
  const tokens = userTokens[userId];

  if (!tokens) {
    return res.status(401).json({ error: 'Gmail not connected. Authenticate first.' });
  }

  res.json({ status: 'processing', message: '📧 Leyendo emails... esto puede tomar 1-2 minutos.' });

  // Process in background
  processEmails(userId, tokens).then(result => {
    userTokens[`${userId}_result`] = result;
  }).catch(e => {
    userTokens[`${userId}_result`] = { error: e.message };
  });
});

// ── Step 5: Poll for results ──────────────────────────────────────
app.get('/result/:userId', (req, res) => {
  const result = userTokens[`${req.params.userId}_result`];
  if (!result) return res.json({ ready: false });

  delete userTokens[`${req.params.userId}_result`];
  res.json({ ready: true, ...result });
});

// ── Download Excel ────────────────────────────────────────────────
app.get('/download/:filename', (req, res) => {
  const filepath = path.join(__dirname, '../data', req.params.filename);
  res.download(filepath);
});

// ── Status ────────────────────────────────────────────────────────
app.get('/status', (req, res) => {
  res.json({ status: '🧾 Accounting Agent running', version: '1.0' });
});

// Background email processing
async function processEmails(userId, tokens) {
  console.log(`📧 Fetching emails for ${userId}...`);
  const emails = await fetchPaymentEmails(tokens, 100);
  console.log(`📧 Found ${emails.length} potential payment emails`);

  // Extract transactions from each email
  const transactions = [];
  for (const email of emails) {
    const tx = await extractTransaction(email);
    if (tx && tx.confidence !== 'low') {
      transactions.push(tx);
    }
  }

  console.log(`💰 Extracted ${transactions.length} transactions`);

  if (transactions.length === 0) {
    return { error: 'No se encontraron transacciones en el correo.' };
  }

  // Generate AI summary
  const summary = await generateSummary(transactions);

  // Generate Excel file
  const { filepath, filename } = generateExcel(transactions, summary, userId);

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

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`🧾 Accounting Agent running on port ${PORT}`);
});
