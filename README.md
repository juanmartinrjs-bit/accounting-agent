# 🧾 Accounting Agent

AI-powered accounting agent that reads Gmail, extracts transactions, and generates P&L reports in Excel.

## What it does

1. User connects their Gmail via OAuth
2. Agent scans emails for payments, invoices, receipts, transfers
3. Claude extracts: date, amount, category, type (income/expense)
4. Generates Excel with:
   - All transactions list
   - P&L summary by category and month
   - AI analysis and insights

## Stack

- **Node.js** + Express
- **Gmail API** (Google OAuth)
- **Claude Sonnet** — transaction extraction + analysis
- **XLSX** — Excel generation

## Setup

```bash
npm install
cp .env.example .env
# Add your API keys to .env
npm start
```

## Environment Variables

```
ANTHROPIC_API_KEY=your_claude_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_secret
GOOGLE_REDIRECT_URI=http://localhost:3002/auth/callback
PORT=3002
```

## Google OAuth Setup

1. Go to console.cloud.google.com
2. Create project → Enable Gmail API
3. Create OAuth credentials (Web application)
4. Add redirect URI: http://localhost:3002/auth/callback
5. Copy Client ID and Secret to .env

## API Endpoints

```
GET  /auth/gmail          → Redirect to Google OAuth
GET  /auth/callback       → OAuth callback
GET  /auth/url            → Get OAuth URL
POST /generate            → Start P&L generation
GET  /result/:userId      → Poll for results
GET  /download/:filename  → Download Excel file
```
