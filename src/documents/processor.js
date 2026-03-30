'use strict';

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { extractTransactionsFromText, extractTransactionsFromImage } = require('../agent/claude');

// pdf-parse is optional — gracefully degrade if not installed
let pdfParse;
try {
  pdfParse = require('pdf-parse');
} catch (e) {
  pdfParse = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ROUTER
// ─────────────────────────────────────────────────────────────────────────────
async function processFile(filepath, mimetype, user) {
  const ext = path.extname(filepath).toLowerCase();

  if (mimetype && (mimetype.startsWith('image/'))) {
    return processImage(filepath, mimetype, user);
  }

  if (mimetype === 'application/pdf' || ext === '.pdf') {
    return processPDF(filepath, user);
  }

  if (
    mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mimetype === 'application/vnd.ms-excel' ||
    ext === '.xlsx' || ext === '.xls'
  ) {
    return processExcel(filepath, user);
  }

  if (mimetype === 'text/csv' || ext === '.csv') {
    return processCSV(filepath, user);
  }

  // Generic text file
  try {
    const text = fs.readFileSync(filepath, 'utf8');
    const transactions = await extractTransactionsFromText(text, user);
    return { transactions };
  } catch (e) {
    return { transactions: [], error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────
async function processPDF(filepath, user) {
  if (!pdfParse) {
    return { transactions: [], error: 'pdf-parse no está instalado. Instala con: npm install pdf-parse' };
  }

  try {
    const buffer = fs.readFileSync(filepath);
    const data = await pdfParse(buffer);
    const text = data.text;

    if (!text || text.trim().length === 0) {
      // Try as image via vision
      const base64 = buffer.toString('base64');
      const transactions = await extractTransactionsFromImage(base64, 'application/pdf', user);
      return { transactions };
    }

    const transactions = await extractTransactionsFromText(text, user);
    return { transactions, extractedText: text.substring(0, 500) };
  } catch (e) {
    return { transactions: [], error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// IMAGE PROCESSOR (Claude Vision)
// ─────────────────────────────────────────────────────────────────────────────
async function processImage(filepath, mimetype, user) {
  try {
    const buffer = fs.readFileSync(filepath);
    const base64 = buffer.toString('base64');

    // Normalize mime type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const safeMime = validTypes.includes(mimetype) ? mimetype : 'image/jpeg';

    const transactions = await extractTransactionsFromImage(base64, safeMime, user);
    return { transactions };
  } catch (e) {
    return { transactions: [], error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXCEL PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────
async function processExcel(filepath, user) {
  try {
    const workbook = XLSX.readFile(filepath);
    const allText = [];

    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      allText.push(`Sheet: ${sheetName}\n${csv}`);
    });

    const fullText = allText.join('\n\n');
    const transactions = await extractTransactionsFromText(fullText, user);
    return { transactions };
  } catch (e) {
    return { transactions: [], error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV PROCESSOR
// ─────────────────────────────────────────────────────────────────────────────
async function processCSV(filepath, user) {
  try {
    const text = fs.readFileSync(filepath, 'utf8');
    const transactions = await extractTransactionsFromText(text, user);
    return { transactions };
  } catch (e) {
    return { transactions: [], error: e.message };
  }
}

module.exports = {
  processFile,
  processPDF,
  processImage,
  processExcel,
  processCSV
};
