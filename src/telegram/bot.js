'use strict';

// Telegram bot — secondary interface (web UI is primary)
// Requires TELEGRAM_BOT_TOKEN in .env

let TelegramBot;
try {
  TelegramBot = require('node-telegram-bot-api');
} catch (e) {
  TelegramBot = null;
}

const path = require('path');
const fs = require('fs');
const { extractTransactionsFromText, extractTransactionsFromImage, askAccountant } = require('../agent/claude');
const { normalizeCountryCode, getCountryKnowledge } = require('../agent/country-knowledge');
const { processFile } = require('../documents/processor');
const { getCurrentPeriodString, isPeriodCloseApproaching, generatePeriodClose, getPeriodStats } = require('../periods/manager');

// In-memory state
const onboardingState = new Map(); // userId → { step, country, countryCode, regime, periodType }
const pendingTx = new Map();       // userId → [transactions]
const chatHistories = new Map();   // userId → [{role, content}]

function createBot(db) {
  if (!TelegramBot) {
    console.warn('⚠️  node-telegram-bot-api not installed. Telegram bot disabled.');
    return null;
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn('⚠️  TELEGRAM_BOT_TOKEN not set. Telegram bot disabled.');
    return null;
  }

  const bot = new TelegramBot(token, { polling: true });
  const uploadDir = path.join(__dirname, '../../data/uploads');
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  // ── /start ──────────────────────────────────────────────────────────────
  bot.onText(/\/start/, async (msg) => {
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;

    // Check if user exists in DB
    const existing = db.getUser(userId);

    if (existing && existing.setup_complete) {
      // Check period close approaching
      if (isPeriodCloseApproaching(existing)) {
        const period = getCurrentPeriodString(existing);
        await bot.sendMessage(chatId,
          `⚠️ *Alerta de cierre de período*\nEl período ${period} está próximo a cerrarse.\nUsa /cerrar para generar tu reporte.`,
          { parse_mode: 'Markdown' }
        );
      }

      const period = getCurrentPeriodString(existing);
      const stats = getPeriodStats(userId, period, db);
      await bot.sendMessage(chatId,
        `👋 Bienvenido de vuelta!\n\n📊 *${period}*\n💰 Ingresos: ${existing.currency} ${stats.totalIncome.toFixed(0)}\n💸 Gastos: ${existing.currency} ${stats.totalExpenses.toFixed(0)}\n📈 Neto: ${existing.currency} ${stats.netProfit.toFixed(0)}\n\nEnvíame facturas 📷, documentos 📄 o escribe tus transacciones.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Start onboarding
    onboardingState.set(userId, { step: 1 });
    if (!existing) db.createUser({ id: userId, setup_complete: 0 });

    await bot.sendMessage(chatId,
      '¡Hola! Soy tu contador virtual 🧾\n\n¿En qué país generas tus ingresos o declaras impuestos?\n(ej: Colombia, USA, México, Argentina, España...)'
    );
  });

  // ── /resumen ─────────────────────────────────────────────────────────────
  bot.onText(/\/resumen/, async (msg) => {
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    const user = db.getUser(userId);
    if (!user) { await bot.sendMessage(chatId, 'Usa /start primero.'); return; }

    const period = getCurrentPeriodString(user);
    const stats = getPeriodStats(userId, period, db);

    await bot.sendMessage(chatId,
      `📊 *Resumen ${period}*\n\n💰 Ingresos: ${user.currency} ${stats.totalIncome.toFixed(0)}\n💸 Gastos: ${user.currency} ${stats.totalExpenses.toFixed(0)}\n📈 Neto: ${user.currency} ${stats.netProfit.toFixed(0)}\n📄 Transacciones: ${stats.txCount}\n📎 Documentos: ${stats.docCount}`,
      { parse_mode: 'Markdown' }
    );
  });

  // ── /cerrar ───────────────────────────────────────────────────────────────
  bot.onText(/\/cerrar/, async (msg) => {
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    const user = db.getUser(userId);
    if (!user) { await bot.sendMessage(chatId, 'Usa /start primero.'); return; }

    const period = getCurrentPeriodString(user);
    await bot.sendMessage(chatId, `⏳ Generando reporte de cierre para ${period}...`);

    try {
      const filename = await generatePeriodClose(userId, period, db);
      const filepath = path.join(__dirname, '../../data', filename);
      await bot.sendDocument(chatId, filepath, {
        caption: `📊 Reporte ${period} generado exitosamente!`
      });
    } catch (e) {
      await bot.sendMessage(chatId, `❌ Error: ${e.message}`);
    }
  });

  // ── /historial ────────────────────────────────────────────────────────────
  bot.onText(/\/historial/, async (msg) => {
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    const user = db.getUser(userId);
    if (!user) { await bot.sendMessage(chatId, 'Usa /start primero.'); return; }

    const periods = db.getPeriods(userId);
    if (periods.length === 0) {
      await bot.sendMessage(chatId, 'No tienes períodos registrados aún.');
      return;
    }

    const list = periods.map(p =>
      `${p.period} — ${p.status === 'closed' ? '✅ Cerrado' : '🔓 Abierto'}`
    ).join('\n');

    await bot.sendMessage(chatId, `📅 *Historial de Períodos*\n\n${list}`, { parse_mode: 'Markdown' });
  });

  // ── Photos (receipts) ────────────────────────────────────────────────────
  bot.on('photo', async (msg) => {
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    const user = db.getUser(userId);
    if (!user || !user.setup_complete) { await bot.sendMessage(chatId, 'Usa /start primero.'); return; }

    await bot.sendMessage(chatId, '📷 Procesando imagen...');

    try {
      const photo = msg.photo[msg.photo.length - 1]; // highest res
      const fileInfo = await bot.getFile(photo.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;

      const https = require('https');
      const filepath = path.join(uploadDir, `${userId}_${Date.now()}.jpg`);

      await downloadFile(fileUrl, filepath);

      const result = await processFile(filepath, 'image/jpeg', user);
      await handleExtractedTransactions(bot, chatId, userId, result.transactions, user);
    } catch (e) {
      await bot.sendMessage(chatId, `❌ Error al procesar imagen: ${e.message}`);
    }
  });

  // ── Documents ─────────────────────────────────────────────────────────────
  bot.on('document', async (msg) => {
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    const user = db.getUser(userId);
    if (!user || !user.setup_complete) { await bot.sendMessage(chatId, 'Usa /start primero.'); return; }

    await bot.sendMessage(chatId, '📄 Procesando documento...');

    try {
      const doc = msg.document;
      const fileInfo = await bot.getFile(doc.file_id);
      const fileUrl = `https://api.telegram.org/file/bot${token}/${fileInfo.file_path}`;
      const ext = path.extname(doc.file_name || '');
      const filepath = path.join(uploadDir, `${userId}_${Date.now()}${ext}`);

      await downloadFile(fileUrl, filepath);

      const result = await processFile(filepath, doc.mime_type, user);
      await handleExtractedTransactions(bot, chatId, userId, result.transactions, user);
    } catch (e) {
      await bot.sendMessage(chatId, `❌ Error al procesar documento: ${e.message}`);
    }
  });

  // ── Callback queries (✅ / ❌) ─────────────────────────────────────────────
  bot.on('callback_query', async (query) => {
    const userId = String(query.from.id);
    const chatId = query.message.chat.id;
    const data = query.data;

    // Onboarding callbacks
    if (data.startsWith('regime_') || data.startsWith('period_')) {
      await handleOnboardingCallback(bot, chatId, userId, data, db);
      await bot.answerCallbackQuery(query.id);
      return;
    }

    if (data === 'confirm_tx') {
      const pending = pendingTx.get(userId) || [];
      if (pending.length === 0) {
        await bot.answerCallbackQuery(query.id, { text: 'No hay transacciones pendientes' });
        return;
      }

      const user = db.getUser(userId);
      const period = getCurrentPeriodString(user);
      db.getOrCreatePeriod(userId, period, user.period_type || 'monthly');

      let saved = 0;
      for (const tx of pending) {
        db.addTransaction({ ...tx, user_id: userId, period });
        saved++;
      }

      pendingTx.delete(userId);
      await bot.editMessageText(
        `✅ ${saved} transacción(es) guardada(s) en el período ${period}`,
        { chat_id: chatId, message_id: query.message.message_id }
      );
    } else if (data === 'reject_tx') {
      pendingTx.delete(userId);
      await bot.editMessageText(
        '❌ Transacciones descartadas.',
        { chat_id: chatId, message_id: query.message.message_id }
      );
    }

    await bot.answerCallbackQuery(query.id);
  });

  // ── Text messages ─────────────────────────────────────────────────────────
  bot.on('message', async (msg) => {
    if (msg.photo || msg.document || msg.text?.startsWith('/')) return;

    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    const text = msg.text || '';

    // Handle onboarding
    const state = onboardingState.get(userId);
    if (state) {
      await handleOnboardingStep(bot, chatId, userId, text, state, db);
      return;
    }

    const user = db.getUser(userId);
    if (!user || !user.setup_complete) {
      await bot.sendMessage(chatId, 'Usa /start para comenzar.');
      return;
    }

    // Check if it looks like a transaction
    const transactionKeywords = /\$|\d+[\.,]\d+|\d+ (pesos|usd|eur|cop|mxn)|(pague|cobré|vendí|compré|recibí|transferí|gasté|ingresé)/i;
    if (transactionKeywords.test(text)) {
      await bot.sendMessage(chatId, '🔍 Analizando transacción...');
      const transactions = await extractTransactionsFromText(text, user);
      await handleExtractedTransactions(bot, chatId, userId, transactions, user);
      return;
    }

    // General accountant question
    const history = chatHistories.get(userId) || [];
    const reply = await askAccountant(text, history, user);

    history.push({ role: 'user', content: text });
    history.push({ role: 'assistant', content: reply });
    if (history.length > 20) history.splice(0, 2);
    chatHistories.set(userId, history);

    await bot.sendMessage(chatId, reply);
  });

  console.log('🤖 Telegram bot started (polling)');
  return bot;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function handleExtractedTransactions(bot, chatId, userId, transactions, user) {
  if (!transactions || transactions.length === 0) {
    await bot.sendMessage(chatId, 'No encontré transacciones financieras en este contenido. ¿Puedes describirlas manualmente?');
    return;
  }

  pendingTx.set(userId, transactions);

  const currency = (user && user.currency) || 'COP';
  const lines = transactions.map((t, i) =>
    `${i + 1}. ${t.type === 'income' ? '💰' : '💸'} *${t.description}*\n   ${currency} ${Math.abs(t.amount).toFixed(0)} — ${t.category || 'Sin categoría'}${t.alert ? `\n   ⚠️ ${t.alert}` : ''}`
  ).join('\n\n');

  await bot.sendMessage(chatId,
    `📋 *Transacciones encontradas:*\n\n${lines}\n\n¿Confirmar y guardar?`,
    {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          { text: '✅ Sí, guardar', callback_data: 'confirm_tx' },
          { text: '❌ No, descartar', callback_data: 'reject_tx' }
        ]]
      }
    }
  );
}

async function handleOnboardingStep(bot, chatId, userId, text, state, db) {
  if (state.step === 1) {
    // Country
    const countryCode = normalizeCountryCode(text);
    let countryName = text;
    let currency = 'COP';

    if (countryCode) {
      try {
        const knowledge = await getCountryKnowledge(countryCode);
        countryName = knowledge.countryName;
        currency = knowledge.currency;
      } catch (e) { /* ignore */ }
    }

    onboardingState.set(userId, { ...state, step: 2, country: countryCode || text, countryName, currency });
    db.updateUser(userId, { country: countryCode || text, country_name: countryName, currency });

    await bot.sendMessage(chatId, `🌎 ${countryName} — ¿Cómo usarás este sistema?`, {
      reply_markup: {
        inline_keyboard: [[
          { text: '🏢 Empresa', callback_data: 'regime_empresa' },
          { text: '👤 Personal/Independiente', callback_data: 'regime_personal' }
        ]]
      }
    });
  } else if (state.step === 4) {
    // Close day
    const day = parseInt(text.trim(), 10);
    if (isNaN(day) || day < 1 || day > 31) {
      await bot.sendMessage(chatId, 'Por favor ingresa un número entre 1 y 31.');
      return;
    }

    db.updateUser(userId, { period_close_day: day, setup_complete: 1 });
    onboardingState.delete(userId);

    await bot.sendMessage(chatId,
      `🎉 *¡Configuración lista!*\n\nTodo listo. Ahora puedes:\n📷 Enviar fotos de facturas\n📄 Enviar documentos PDF/Excel\n✍️ Escribir tus transacciones\n\nAl cierre del período te genero todos tus estados financieros 📊`,
      { parse_mode: 'Markdown' }
    );
  }
}

async function handleOnboardingCallback(bot, chatId, userId, data, db) {
  const state = onboardingState.get(userId) || {};

  if (data.startsWith('regime_')) {
    const regime = data.replace('regime_', '');
    onboardingState.set(userId, { ...state, step: 3, regime });
    db.updateUser(userId, { tax_regime: regime });

    await bot.sendMessage(chatId, '📅 ¿Con qué frecuencia necesitas tus reportes?', {
      reply_markup: {
        inline_keyboard: [[
          { text: '📅 Mensual', callback_data: 'period_monthly' },
          { text: '📊 Trimestral', callback_data: 'period_quarterly' }
        ]]
      }
    });
  } else if (data.startsWith('period_')) {
    const periodType = data.replace('period_', '');
    onboardingState.set(userId, { ...state, step: 4, periodType });
    db.updateUser(userId, { period_type: periodType });

    await bot.sendMessage(chatId, '📆 ¿Qué día del mes necesitas tu reporte? (ej: 30)');
  }
}

async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const protocol = url.startsWith('https') ? require('https') : require('http');
    const file = fs.createWriteStream(dest);
    protocol.get(url, response => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', reject);
  });
}

module.exports = { createBot };
