'use strict';

const { generatePeriodReport } = require('../agent/claude');
const { generatePeriodReport: generateExcelReport } = require('../excel/generator');

// ─────────────────────────────────────────────────────────────────────────────
// CURRENT PERIOD STRING
// ─────────────────────────────────────────────────────────────────────────────
function getCurrentPeriodString(user) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  if (user && user.period_type === 'quarterly') {
    const quarter = Math.ceil(month / 3);
    return `${year}-Q${quarter}`;
  }

  return `${year}-${String(month).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK IF PERIOD CLOSE IS APPROACHING (within 5 days)
// ─────────────────────────────────────────────────────────────────────────────
function isPeriodCloseApproaching(user) {
  const closeDay = (user && user.period_close_day) || 30;
  const today = new Date();
  const currentDay = today.getDate();

  // Get days in current month
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const effectiveCloseDay = Math.min(closeDay, daysInMonth);

  const daysUntilClose = effectiveCloseDay - currentDay;
  return daysUntilClose >= 0 && daysUntilClose <= 5;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE PERIOD CLOSE
// ─────────────────────────────────────────────────────────────────────────────
async function generatePeriodClose(userId, period, deps) {
  const { db, getTransactions, getDocuments, closePeriod, getUser } = deps;

  const user = getUser(userId);
  if (!user) throw new Error('Usuario no encontrado');

  const transactions = getTransactions(userId, period);
  if (transactions.length === 0) {
    throw new Error('No hay transacciones en este período');
  }

  // Generate AI report
  const reportData = await generatePeriodReport(transactions, user, period);

  // Generate Excel
  const { filepath, filename } = generateExcelReport(transactions, reportData, user, period);

  // Mark period as closed in DB
  closePeriod(userId, period, filename);

  return filename;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET PERIOD STATS
// ─────────────────────────────────────────────────────────────────────────────
function getPeriodStats(userId, period, dbFns) {
  const { getTransactions, getDocuments } = dbFns;
  const transactions = getTransactions(userId, period);
  const documents = getDocuments(userId, period);

  const totalIncome = transactions
    .filter(t => t.type === 'income')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  const totalExpenses = transactions
    .filter(t => t.type === 'expense')
    .reduce((s, t) => s + Math.abs(t.amount), 0);

  return {
    totalIncome,
    totalExpenses,
    netProfit: totalIncome - totalExpenses,
    txCount: transactions.length,
    docCount: documents.length
  };
}

module.exports = {
  getCurrentPeriodString,
  isPeriodCloseApproaching,
  generatePeriodClose,
  getPeriodStats
};
