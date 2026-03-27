const { google } = require('googleapis');

// Gmail OAuth2 setup
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Generate auth URL for user to connect their Gmail
function getAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
    prompt: 'consent'
  });
}

// Exchange code for tokens
async function getTokens(code) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);
  return tokens;
}

// Fetch emails related to payments/transactions
async function fetchPaymentEmails(tokens, maxResults = 100) {
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Search for payment-related emails
  const queries = [
    'subject:(payment OR invoice OR receipt OR transfer OR transaction OR pago OR factura OR recibo OR transferencia)',
    'from:(paypal OR stripe OR bank OR nequi OR bancolombia OR davivienda OR payoneer OR wise)'
  ];

  const allMessages = [];

  for (const q of queries) {
    try {
      const res = await gmail.users.messages.list({
        userId: 'me',
        q,
        maxResults: Math.floor(maxResults / queries.length)
      });

      const messages = res.data.messages || [];

      for (const msg of messages) {
        const full = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'full'
        });

        const headers = full.data.payload.headers;
        const subject = headers.find(h => h.name === 'Subject')?.value || '';
        const from = headers.find(h => h.name === 'From')?.value || '';
        const date = headers.find(h => h.name === 'Date')?.value || '';

        // Get email body
        let body = '';
        const parts = full.data.payload.parts || [full.data.payload];
        for (const part of parts) {
          if (part.mimeType === 'text/plain' && part.body?.data) {
            body = Buffer.from(part.body.data, 'base64').toString('utf-8').substring(0, 1000);
            break;
          }
        }

        allMessages.push({ id: msg.id, subject, from, date, body });
      }
    } catch (e) {
      console.error('Gmail query error:', e.message);
    }
  }

  // Deduplicate by ID
  const seen = new Set();
  return allMessages.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

module.exports = { getAuthUrl, getTokens, fetchPaymentEmails };
