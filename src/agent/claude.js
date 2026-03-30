'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { getCountryKnowledge } = require('./country-knowledge');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─────────────────────────────────────────────────────────────────────────────
// BASE SYSTEM PROMPT — Colombian accountant (kept for backwards compat)
// ─────────────────────────────────────────────────────────────────────────────
const ACCOUNTANT_SYSTEM_PROMPT = `Eres un contador público titulado con más de 15 años de experiencia internacional.
Tienes conocimiento profundo de marcos contables y fiscales de múltiples países.
Siempre respondes en español, con tono profesional pero claro.
Clasificas transacciones correctamente según el sistema contable del país del usuario.
Detectas alertas fiscales, gastos no deducibles y obligaciones tributarias.`;

// ─────────────────────────────────────────────────────────────────────────────
// BUILD SYSTEM PROMPT FOR A SPECIFIC USER
// ─────────────────────────────────────────────────────────────────────────────
async function buildSystemPrompt(user) {
  let countryKnowledge = null;

  if (user && user.country) {
    try {
      countryKnowledge = await getCountryKnowledge(user.country);
    } catch (e) {
      // fallback to base prompt
    }
  }

  const base = `Eres un contador público titulado con más de 15 años de experiencia internacional.
Clasificas transacciones correctamente según el sistema contable del país del usuario.
Detectas alertas fiscales, gastos no deducibles y obligaciones tributarias.
Siempre respondes en español con tono profesional pero claro.
Moneda principal del usuario: ${(user && user.currency) || 'USD'}.
País del usuario: ${(user && user.country_name) || 'desconocido'}.
Régimen fiscal: ${(user && user.tax_regime) || 'no especificado'}.`;

  if (countryKnowledge && countryKnowledge.systemPromptAddition) {
    return base + '\n\n' + countryKnowledge.systemPromptAddition;
  }

  return base;
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT TRANSACTIONS FROM TEXT
// ─────────────────────────────────────────────────────────────────────────────
async function extractTransactionsFromText(text, user) {
  const systemPrompt = await buildSystemPrompt(user);
  const currency = (user && user.currency) || 'COP';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Analiza este texto y extrae TODAS las transacciones financieras que encuentres.
Si NO hay transacciones financieras reales, devuelve un array vacío [].

Texto:
${text}

Devuelve SOLO un JSON array válido con este formato, sin texto adicional:
[
  {
    "date": "YYYY-MM-DD",
    "amount": número positivo en ${currency},
    "currency": "${currency}",
    "original_currency": "moneda original si aplica o null",
    "original_amount": número si aplica o null,
    "description": "descripción clara",
    "category": "categoría contable",
    "puc_code": "código de cuenta contable",
    "type": "income o expense",
    "source": "origen o pagador",
    "deductible": true o false,
    "tax_notes": "notas fiscales relevantes o null",
    "alert": "alerta contable si aplica o null",
    "confidence": "high, medium o low"
  }
]`
    }]
  });

  try {
    const text2 = response.content[0].text.trim();
    const jsonMatch = text2.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.filter(t => t.confidence !== 'low');
  } catch (e) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXTRACT TRANSACTIONS FROM IMAGE (Claude Vision)
// ─────────────────────────────────────────────────────────────────────────────
async function extractTransactionsFromImage(base64Image, mimeType, user) {
  const systemPrompt = await buildSystemPrompt(user);
  const currency = (user && user.currency) || 'COP';

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: base64Image
          }
        },
        {
          type: 'text',
          text: `Analiza esta imagen (puede ser una factura, recibo, extracto bancario, comprobante de pago).
Extrae TODAS las transacciones financieras que puedas identificar.
Si NO hay transacciones financieras, devuelve [].

Devuelve SOLO un JSON array válido con este formato, sin texto adicional:
[
  {
    "date": "YYYY-MM-DD",
    "amount": número positivo en ${currency},
    "currency": "${currency}",
    "original_currency": "moneda original si aplica o null",
    "original_amount": número si aplica o null,
    "description": "descripción de la transacción",
    "category": "categoría contable",
    "puc_code": "código de cuenta contable",
    "type": "income o expense",
    "source": "proveedor/pagador extraído del documento",
    "deductible": true o false,
    "tax_notes": "notas de IVA, retención u otros impuestos",
    "alert": "alerta contable si aplica o null",
    "confidence": "high, medium o low"
  }
]`
        }
      ]
    }]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.filter(t => t.confidence !== 'low');
  } catch (e) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATE PERIOD REPORT
// ─────────────────────────────────────────────────────────────────────────────
async function generatePeriodReport(transactions, user, period) {
  const systemPrompt = await buildSystemPrompt(user);
  const currency = (user && user.currency) || 'COP';

  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const netProfit = totalIncome - totalExpense;

  const byCategory = transactions.reduce((acc, t) => {
    if (!acc[t.category]) acc[t.category] = { income: 0, expense: 0, puc: t.puc_code };
    if (t.type === 'income') acc[t.category].income += Math.abs(t.amount);
    else acc[t.category].expense += Math.abs(t.amount);
    return acc;
  }, {});

  const alerts = transactions.filter(t => t.alert).map(t => t.alert);
  const nonDeductible = transactions.filter(t => t.deductible === false || t.deductible === 0);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{
      role: 'user',
      content: `Genera un informe financiero completo para el período ${period} del usuario.
País: ${user.country_name || 'Colombia'}
Moneda: ${currency}
Régimen: ${user.tax_regime || 'no especificado'}

DATOS:
- Total Ingresos: ${totalIncome} ${currency}
- Total Gastos: ${totalExpense} ${currency}
- Utilidad/Pérdida Neta: ${netProfit} ${currency}
- Transacciones totales: ${transactions.length}
- Gastos no deducibles: ${nonDeductible.length}

POR CATEGORÍA:
${JSON.stringify(byCategory, null, 2)}

ALERTAS: ${alerts.length > 0 ? alerts.join('; ') : 'ninguna'}

Devuelve SOLO JSON válido con esta estructura:
{
  "summary": "resumen ejecutivo del período en 3-4 párrafos",
  "balanceSheet": {
    "assets": {"cash": número, "receivables": número, "total": número},
    "liabilities": {"payables": número, "taxesOwed": número, "total": número},
    "equity": número
  },
  "cashFlow": {
    "operatingInflows": número,
    "operatingOutflows": número,
    "netCashFlow": número
  },
  "taxObligations": [
    {
      "name": "nombre del impuesto",
      "amount": número estimado,
      "dueDate": "fecha límite aproximada",
      "description": "descripción breve"
    }
  ],
  "recommendations": ["recomendación 1", "recomendación 2"]
}`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    // fallback
  }

  return {
    summary: `Período ${period}: Ingresos ${totalIncome} ${currency}, Gastos ${totalExpense} ${currency}, Neto ${netProfit} ${currency}.`,
    balanceSheet: {
      assets: { cash: Math.max(netProfit, 0), receivables: 0, total: Math.max(netProfit, 0) },
      liabilities: { payables: 0, taxesOwed: 0, total: 0 },
      equity: netProfit
    },
    cashFlow: { operatingInflows: totalIncome, operatingOutflows: totalExpense, netCashFlow: netProfit },
    taxObligations: [],
    recommendations: []
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ONBOARDING HANDLER
// ─────────────────────────────────────────────────────────────────────────────
async function handleOnboarding(message, history, userId) {
  const { normalizeCountryCode, getCountryKnowledge } = require('./country-knowledge');

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: `Eres un asistente contable configurando una cuenta nueva. 
El usuario está respondiendo preguntas de configuración.
Extrae la información relevante del mensaje y devuelve JSON.
Responde siempre en español.`,
    messages: [
      ...history,
      { role: 'user', content: message }
    ]
  });

  const reply = response.content[0].text;

  // Try to extract country, regime, etc from message
  const countryCode = normalizeCountryCode(message);
  let countryName = null;
  let currency = null;

  if (countryCode) {
    try {
      const knowledge = await getCountryKnowledge(countryCode);
      countryName = knowledge.countryName;
      currency = knowledge.currency;
    } catch (e) { /* ignore */ }
  }

  return {
    reply,
    updates: {
      country: countryCode,
      country_name: countryName,
      currency
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERAL ACCOUNTANT CHAT
// ─────────────────────────────────────────────────────────────────────────────
async function askAccountant(message, history = [], user = null) {
  const systemPrompt = user ? await buildSystemPrompt(user) : ACCOUNTANT_SYSTEM_PROMPT;

  const messages = [
    ...history,
    { role: 'user', content: message }
  ];

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1000,
    system: systemPrompt,
    messages
  });

  return response.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: extract from email
// ─────────────────────────────────────────────────────────────────────────────
async function extractTransaction(email) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 500,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Analiza este email y extrae la transacción financiera. Si NO es una transacción real, devuelve null.

Email:
Asunto: ${email.subject}
De: ${email.from}
Fecha: ${email.date}
Cuerpo: ${email.body}

Devuelve SOLO JSON válido o null:
{
  "date": "YYYY-MM-DD",
  "amount": número COP,
  "currency": "COP",
  "original_currency": null,
  "original_amount": null,
  "description": "descripción",
  "category": "categoría",
  "puc_code": "código",
  "type": "income o expense",
  "source": "origen",
  "tax_notes": null,
  "deductible": true,
  "confidence": "high/medium/low",
  "alert": null
}`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.confidence === 'low') return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: generate summary
// ─────────────────────────────────────────────────────────────────────────────
async function generateSummary(transactions, context = 'empresa') {
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 1000,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Genera un análisis financiero en español.
Ingresos: ${totalIncome} COP
Gastos: ${totalExpense} COP
Neto: ${totalIncome - totalExpense} COP
Transacciones: ${transactions.length}`
    }]
  });

  return response.content[0].text;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEGACY: analyze transaction
// ─────────────────────────────────────────────────────────────────────────────
async function analyzeTransaction(description, amount, currency = 'COP', context = 'empresa') {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 600,
    system: ACCOUNTANT_SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: `Analiza esta transacción: ${description}, Monto: ${amount} ${currency}, Contexto: ${context}.
Indica: clasificación PUC, tipo, deducibilidad, IVA, retención y alertas.`
    }]
  });

  return response.content[0].text;
}

function formatCOP(amount) {
  return new Intl.NumberFormat('es-CO', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

module.exports = {
  ACCOUNTANT_SYSTEM_PROMPT,
  buildSystemPrompt,
  extractTransactionsFromText,
  extractTransactionsFromImage,
  generatePeriodReport,
  handleOnboarding,
  askAccountant,
  extractTransaction,
  generateSummary,
  analyzeTransaction,
  formatCOP
};
