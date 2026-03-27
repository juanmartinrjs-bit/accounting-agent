const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Extract transaction data from email
async function extractTransaction(email) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Extract financial transaction data from this email. Return ONLY valid JSON or null if not a transaction.

Email:
Subject: ${email.subject}
From: ${email.from}
Date: ${email.date}
Body: ${email.body}

Return this format:
{
  "date": "YYYY-MM-DD",
  "amount": number (positive for income, negative for expense),
  "currency": "USD or COP or EUR etc",
  "description": "brief description",
  "category": "one of: Income/Sales/Subscription/Salary/Transfer/Refund/Software/Marketing/Services/Other",
  "type": "income or expense",
  "source": "sender/platform name",
  "confidence": "high or medium or low"
}`
    }]
  });

  try {
    const text = response.content[0].text.trim();
    if (text === 'null' || !text.startsWith('{')) return null;
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

// Generate P&L summary
async function generateSummary(transactions) {
  const totalIncome = transactions.filter(t => t.type === 'income').reduce((s, t) => s + Math.abs(t.amount), 0);
  const totalExpense = transactions.filter(t => t.type === 'expense').reduce((s, t) => s + Math.abs(t.amount), 0);
  const netProfit = totalIncome - totalExpense;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are a financial analyst. Generate a brief P&L summary in Spanish based on these transactions:

Total Income: $${totalIncome.toFixed(2)}
Total Expenses: $${totalExpense.toFixed(2)}
Net Profit/Loss: $${netProfit.toFixed(2)}

Transactions by category:
${JSON.stringify(
  transactions.reduce((acc, t) => {
    acc[t.category] = (acc[t.category] || 0) + Math.abs(t.amount);
    return acc;
  }, {}),
  null, 2
)}

Provide a 3-4 sentence summary with key insights and recommendations.`
    }]
  });

  return response.content[0].text;
}

module.exports = { extractTransaction, generateSummary };
