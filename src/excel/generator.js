'use strict';

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: simple report (email flow)
// ─────────────────────────────────────────────────────────────────────────────
function generateExcel(transactions, summary, userId) {
  const reportData = { summary, taxObligations: [], recommendations: [] };
  const user = { currency: 'COP', country_name: 'Colombia' };
  const period = new Date().toISOString().substring(0, 7);
  return generatePeriodReport(transactions, reportData, user, period, userId);
}

// ─────────────────────────────────────────────────────────────────────────────
// FULL PERIOD REPORT
// ─────────────────────────────────────────────────────────────────────────────
function generatePeriodReport(transactions, reportData, user, period, overrideUserId) {
  const wb = XLSX.utils.book_new();
  const currency = (user && user.currency) || 'COP';
  const userId = overrideUserId || (user && user.id) || 'user';

  // ── Sheet 1: Transacciones ──────────────────────────────────────────────
  const txHeaders = ['Fecha', 'Descripción', 'Categoría', 'Código', 'Tipo', `Monto (${currency})`,
    'Moneda Orig.', 'Monto Orig.', 'Fuente', 'Deducible', 'Notas Fiscales', 'Alerta'];

  const txRows = transactions.map(t => [
    t.date || '',
    t.description || '',
    t.category || '',
    t.puc_code || '',
    t.type === 'income' ? 'Ingreso' : 'Gasto',
    Math.abs(t.amount) || 0,
    t.original_currency || '',
    t.original_amount || '',
    t.source || '',
    (t.deductible === false || t.deductible === 0) ? 'NO' : 'SÍ',
    t.tax_notes || '',
    t.alert || ''
  ]);

  const txSheet = XLSX.utils.aoa_to_sheet([txHeaders, ...txRows]);
  txSheet['!cols'] = [
    { wch: 12 }, { wch: 35 }, { wch: 22 }, { wch: 10 }, { wch: 8 },
    { wch: 15 }, { wch: 11 }, { wch: 12 }, { wch: 20 }, { wch: 10 },
    { wch: 28 }, { wch: 32 }
  ];
  XLSX.utils.book_append_sheet(wb, txSheet, 'Transacciones');

  // ── Sheet 2: P&L ────────────────────────────────────────────────────────
  const income = transactions.filter(t => t.type === 'income');
  const expenses = transactions.filter(t => t.type === 'expense');
  const totalIncome = income.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);
  const netProfit = totalIncome - totalExpenses;

  const byCategory = {};
  transactions.forEach(t => {
    const cat = t.category || 'Sin categoría';
    if (!byCategory[cat]) byCategory[cat] = { income: 0, expense: 0 };
    if (t.type === 'income') byCategory[cat].income += Math.abs(t.amount);
    else byCategory[cat].expense += Math.abs(t.amount);
  });

  const byMonth = {};
  transactions.forEach(t => {
    const month = (t.date || '').substring(0, 7) || 'N/A';
    if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
    if (t.type === 'income') byMonth[month].income += Math.abs(t.amount);
    else byMonth[month].expense += Math.abs(t.amount);
  });

  const plData = [
    [`ESTADO DE RESULTADOS — ${period}`, '', ''],
    ['', '', ''],
    ['INGRESOS', '', ''],
    [`Total Ingresos`, '', fmt(totalIncome, currency)],
    ['', '', ''],
    ['GASTOS', '', ''],
    ['Total Gastos', '', fmt(totalExpenses, currency)],
    ['', '', ''],
    ['UTILIDAD / PÉRDIDA NETA', '', fmt(netProfit, currency)],
    ['', '', ''],
    ['POR CATEGORÍA', 'Ingresos', 'Gastos'],
    ...Object.entries(byCategory).map(([cat, v]) => [cat, fmt(v.income, currency), fmt(v.expense, currency)]),
    ['', '', ''],
    ['DESGLOSE MENSUAL', 'Ingresos', 'Gastos'],
    ...Object.entries(byMonth).sort().map(([m, v]) => [m, fmt(v.income, currency), fmt(v.expense, currency)])
  ];

  const plSheet = XLSX.utils.aoa_to_sheet(plData);
  plSheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, plSheet, 'P&L');

  // ── Sheet 3: Balance ────────────────────────────────────────────────────
  const bs = (reportData && reportData.balanceSheet) || {};
  const assets = bs.assets || {};
  const liabilities = bs.liabilities || {};

  const balanceData = [
    ['BALANCE GENERAL', '', ''],
    ['', '', ''],
    ['ACTIVOS', '', ''],
    ['Caja y Bancos (Efectivo)', '', fmt(assets.cash || Math.max(netProfit, 0), currency)],
    ['Cuentas por Cobrar', '', fmt(assets.receivables || 0, currency)],
    ['TOTAL ACTIVOS', '', fmt(assets.total || Math.max(netProfit, 0), currency)],
    ['', '', ''],
    ['PASIVOS', '', ''],
    ['Cuentas por Pagar', '', fmt(liabilities.payables || 0, currency)],
    ['Impuestos por Pagar', '', fmt(liabilities.taxesOwed || 0, currency)],
    ['TOTAL PASIVOS', '', fmt(liabilities.total || 0, currency)],
    ['', '', ''],
    ['PATRIMONIO / CAPITAL', '', fmt(bs.equity || netProfit, currency)]
  ];

  const balSheet = XLSX.utils.aoa_to_sheet(balanceData);
  balSheet['!cols'] = [{ wch: 28 }, { wch: 5 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, balSheet, 'Balance');

  // ── Sheet 4: Flujo de Caja ──────────────────────────────────────────────
  const cf = (reportData && reportData.cashFlow) || {};

  const cashData = [
    ['FLUJO DE CAJA', '', ''],
    ['', '', ''],
    ['Entradas Operacionales', '', fmt(cf.operatingInflows || totalIncome, currency)],
    ['Salidas Operacionales', '', fmt(cf.operatingOutflows || totalExpenses, currency)],
    ['Flujo Neto', '', fmt(cf.netCashFlow || netProfit, currency)],
    ['', '', ''],
    ['DETALLE MENSUAL', 'Entradas', 'Salidas'],
    ...Object.entries(byMonth).sort().map(([m, v]) => [
      m, fmt(v.income, currency), fmt(v.expense, currency)
    ])
  ];

  const cfSheet = XLSX.utils.aoa_to_sheet(cashData);
  cfSheet['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, cfSheet, 'Flujo de Caja');

  // ── Sheet 5: Obligaciones Fiscales ──────────────────────────────────────
  const obligations = (reportData && reportData.taxObligations) || [];
  const taxHeaders = ['Obligación', 'Monto Estimado', 'Fecha Límite', 'Descripción'];
  const taxRows = obligations.map(o => [
    o.name || '',
    o.amount ? fmt(o.amount, currency) : 'A calcular',
    o.dueDate || '',
    o.description || ''
  ]);

  const taxSheet = XLSX.utils.aoa_to_sheet([taxHeaders, ...taxRows]);
  taxSheet['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, taxSheet, 'Obligaciones Fiscales');

  // ── Sheet 6: Análisis IA ────────────────────────────────────────────────
  const summary = (reportData && reportData.summary) || 'Reporte generado automáticamente.';
  const recs = (reportData && reportData.recommendations) || [];

  const aiData = [
    ['ANÁLISIS Y RECOMENDACIONES — IA CONTABLE', ''],
    ['', ''],
    ['Resumen del Período', ''],
    [summary, ''],
    ['', ''],
    ['Recomendaciones', ''],
    ...recs.map(r => [r, ''])
  ];

  const aiSheet = XLSX.utils.aoa_to_sheet(aiData);
  aiSheet['!cols'] = [{ wch: 80 }, { wch: 10 }];
  aiSheet['!merges'] = [{ s: { r: 3, c: 0 }, e: { r: 3, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, aiSheet, 'Análisis IA');

  // ── Save ─────────────────────────────────────────────────────────────────
  const outputDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const safeUserId = String(userId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const filename = `Reporte_${safeUserId}_${period}_${Date.now()}.xlsx`;
  const filepath = path.join(outputDir, filename);
  XLSX.writeFile(wb, filepath);

  return { filepath, filename };
}

// ─────────────────────────────────────────────────────────────────────────────
// FORMAT HELPER
// ─────────────────────────────────────────────────────────────────────────────
function fmt(amount, currency) {
  const n = Number(amount) || 0;
  try {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: currency || 'COP',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    }).format(n);
  } catch (e) {
    return `${currency} ${n.toFixed(2)}`;
  }
}

module.exports = { generateExcel, generatePeriodReport };
