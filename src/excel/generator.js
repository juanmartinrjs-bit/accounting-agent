const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

function generateExcel(transactions, summary, userId) {
  const wb = XLSX.utils.book_new();

  // ── Sheet 1: All Transactions ──────────────────────────────────
  const txData = [
    ['Date', 'Description', 'Category', 'Type', 'Amount', 'Currency', 'Source', 'Confidence']
  ];

  transactions.forEach(t => {
    txData.push([
      t.date,
      t.description,
      t.category,
      t.type,
      t.amount,
      t.currency || 'USD',
      t.source,
      t.confidence
    ]);
  });

  const txSheet = XLSX.utils.aoa_to_sheet(txData);

  // Style header row
  txSheet['!cols'] = [
    { wch: 12 }, { wch: 35 }, { wch: 15 }, { wch: 10 },
    { wch: 12 }, { wch: 10 }, { wch: 20 }, { wch: 12 }
  ];

  XLSX.utils.book_append_sheet(wb, txSheet, 'Transactions');

  // ── Sheet 2: P&L Summary ───────────────────────────────────────
  const income = transactions.filter(t => t.type === 'income');
  const expenses = transactions.filter(t => t.type === 'expense');
  const totalIncome = income.reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpenses = expenses.reduce((s, t) => s + Math.abs(t.amount), 0);

  // Group by category
  const byCategory = {};
  transactions.forEach(t => {
    if (!byCategory[t.category]) byCategory[t.category] = { income: 0, expense: 0 };
    if (t.type === 'income') byCategory[t.category].income += Math.abs(t.amount);
    else byCategory[t.category].expense += Math.abs(t.amount);
  });

  // Group by month
  const byMonth = {};
  transactions.forEach(t => {
    const month = t.date?.substring(0, 7) || 'Unknown';
    if (!byMonth[month]) byMonth[month] = { income: 0, expense: 0 };
    if (t.type === 'income') byMonth[month].income += Math.abs(t.amount);
    else byMonth[month].expense += Math.abs(t.amount);
  });

  const plData = [
    ['P&L SUMMARY', '', ''],
    ['', '', ''],
    ['INCOME', '', ''],
    ['Total Income', '', `$${totalIncome.toFixed(2)}`],
    ['', '', ''],
    ['EXPENSES', '', ''],
    ['Total Expenses', '', `$${totalExpenses.toFixed(2)}`],
    ['', '', ''],
    ['NET PROFIT/LOSS', '', `$${(totalIncome - totalExpenses).toFixed(2)}`],
    ['', '', ''],
    ['BY CATEGORY', '', ''],
    ['Category', 'Income', 'Expense'],
    ...Object.entries(byCategory).map(([cat, vals]) => [
      cat, `$${vals.income.toFixed(2)}`, `$${vals.expense.toFixed(2)}`
    ]),
    ['', '', ''],
    ['BY MONTH', '', ''],
    ['Month', 'Income', 'Expense'],
    ...Object.entries(byMonth).sort().map(([month, vals]) => [
      month, `$${vals.income.toFixed(2)}`, `$${vals.expense.toFixed(2)}`
    ]),
    ['', '', ''],
    ['AI ANALYSIS', '', ''],
    [summary, '', '']
  ];

  const plSheet = XLSX.utils.aoa_to_sheet(plData);
  plSheet['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 15 }];
  XLSX.utils.book_append_sheet(wb, plSheet, 'P&L Summary');

  // Save file
  const outputDir = path.join(__dirname, '../../data');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  const filename = `PL_Report_${userId}_${new Date().toISOString().split('T')[0]}.xlsx`;
  const filepath = path.join(outputDir, filename);
  XLSX.writeFile(wb, filepath);

  return { filepath, filename };
}

module.exports = { generateExcel };
