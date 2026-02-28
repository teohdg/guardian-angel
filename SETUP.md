# Guardian AI - Complete Setup Guide

## Table of Contents
1. [Twilio Setup](#twilio-setup)
2. [OpenAI Setup](#openai-setup)
3. [Environment Variables](#environment-variables)
4. [Local Development](#local-development)
5. [Testing with ngrok](#testing-with-ngrok)
6. [Simulating Escalation](#simulating-escalation)
7. [Deployment](#deployment)

---

## Twilio Setup

### Step 1: Create a Twilio Account

1. Go to [https://www.twilio.com/try-twilio](https://www.twilio.com/try-twilio)
2. Sign up with email or phone
3. Verify your email/phone
4. You'll receive trial credits (enough for hackathon demos)

### Step 2: Buy a Twilio Phone Number

1. Log in to [Twilio Console](https://console.twilio.com/)
2. Go to **Phone Numbers** → **Manage** → **Buy a number**
3. Select your country (e.g., United States)
4. Check **Voice** and **SMS** capabilities
5. Click **Buy** on an available number
6. Note the number (e.g., `+15551234567`)

### Step 3: Get Account SID and Auth Token

1. On the [Twilio Console](https://console.twilio.com/) dashboard
2. **Account SID** is visible on the main page (starts with `AC`)
3. **Auth Token**: Click "Show" next to Auth Token to reveal it
4. Copy both - you'll need them for `.env`

### Step 4: Store Securely in Environment Variables

Create a `.env` file in the project root (copy from `.env.example`):

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+15551234567
```

**Never commit `.env` to git.** It's in `.gitignore`.

### Step 5: Configure Twilio Webhooks

Twilio webhooks are **configured dynamically** in our code. When we make an outbound call, we pass the webhook URL:

```
https://your-domain.com/api/webhooks/voice?sessionId=xxx
```

So you **do not** need to set webhooks in the Twilio Console. The URLs are built from `BASE_URL` in your environment.

**Important**: `BASE_URL` must be a **public URL** that Twilio can reach. For local dev, use ngrok (see below).

---

## OpenAI Setup

1. Go to [https://platform.openai.com/](https://platform.openai.com/)
2. Sign up or log in
3. Go to **API Keys** → **Create new secret key**
4. Copy the key (starts with `sk-`)
5. Add to `.env`:
   ```
   OPENAI_API_KEY=sk-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
   ```

---

## Environment Variables

Create `.env` from `.env.example`:

```bash
cp .env.example .env
```

Fill in all values. Minimum required:

| Variable | Description |
|----------|-------------|
| `TWILIO_ACCOUNT_SID` | From Twilio Console |
| `TWILIO_AUTH_TOKEN` | From Twilio Console |
| `TWILIO_PHONE_NUMBER` | Your Twilio number (E.164) |
| `OPENAI_API_KEY` | From OpenAI |
| `BASE_URL` | Public URL for webhooks (ngrok or production) |
| `PORT` | Server port (default 3000) |

---

## Local Development

### 1. Install Dependencies

```bash
npm install
```

### 2. Initialize Database

```bash
npm run init-db
```

### 3. Start Server

```bash
npm start
```

Or with auto-reload:

```bash
npm run dev
```

### 4. Open Frontend

Go to [http://localhost:3000](http://localhost:3000)

---

## Public URL vs API keys (important)

- **Public URL** = The *address* of your app (e.g. `https://your-app.onrender.com` or `https://abc.ngrok.io`) must be reachable from the internet so **Twilio’s servers** can send webhook requests to your server when a call is answered. That’s what “has to be public” means.
- **API keys stay secret.** They live in your `.env` (local) or in your host’s Environment Variables (deployed). They are never in the GitHub repo or in the browser. Making the app’s URL public does **not** expose your keys.

## Testing with ngrok

Twilio must reach your webhooks via a **public URL**. Localhost is not reachable. Use ngrok:

### 1. Install ngrok

- Download from [https://ngrok.com/download](https://ngrok.com/download)
- Or: `npm install -g ngrok`

### 2. Start Your Server

```bash
npm start
```

### 3. Start ngrok

```bash
ngrok http 3000
```

You'll see output like:

```
Forwarding  https://abc123.ngrok-free.app -> http://localhost:3000
```

### 4. Set BASE_URL

In your `.env`:

```
BASE_URL=https://abc123.ngrok-free.app
```

Restart the server. Now when Twilio receives a call, it will use this URL for webhooks.

**Note**: Free ngrok URLs change each time you restart ngrok. Update `BASE_URL` and restart the server when that happens.

---

## Calls not going through – troubleshooting

**Quick checks:**

- **Is your public URL reachable?** Open in a browser: `https://YOUR_BASE_URL/api/webhooks/ping` (e.g. your ngrok URL + `/api/webhooks/ping`). You should see `{"ok":true,...}`. If it doesn’t load, Twilio can’t reach your app.
- **Debug config:** Open `http://localhost:3000/api/debug` (or your public URL + `/api/debug`). It shows whether Twilio is configured, your BASE_URL, and recent pending sessions.

1. **BASE_URL must be public**  
   If `BASE_URL` is `http://localhost:3000`, Twilio cannot reach your app when the call is answered, so the call can fail or drop. Use ngrok (or a deployed URL) and set `BASE_URL` to that URL in `.env`.

2. **Twilio trial: verify the “To” number**  
   Trial accounts can only call/SMS numbers you’ve verified.  
   - [Twilio Console → Phone Numbers → Verified Caller IDs](https://console.twilio.com/us1/develop/phone-numbers/manage/verified)  
   - Add the phone number that receives the check-in call (and any emergency contacts for SMS).

3. **Test without waiting: “Call now”**  
   After activating a session, trigger a call immediately:
   ```bash
   curl -X POST http://localhost:3000/api/call-now/YOUR_SESSION_ID
   ```
   Replace `YOUR_SESSION_ID` with the `sessionId` from the activate response. If this fails, the server logs will show the Twilio error (e.g. unverified number).

4. **Check server logs**  
   When the scheduler runs or you use “call now”, you should see lines like:
   - `[Scheduler] Found N due session(s)`
   - `[Twilio] Initiating call to +1...`
   - `[Twilio] Call created successfully. Call SID: CA...`  
   If you see `[Twilio] Call failed:`, the message and `moreInfo` indicate the cause (e.g. 21211 = invalid “To” number, 21608 = number not verified).

5. **Scheduled time**  
   The scheduler runs every minute. The check-in runs when the server’s time is past the session’s `scheduled_at`. Ensure the time you set is in the future and that the server clock is correct.

---

## Simulating Escalation

### Quick Test Flow

1. **Activate** a session with:
   - Your real phone number (or a test number)
   - Safe word: `pineapple`
   - Escalation word: `banana`
   - Schedule time: 2-3 minutes from now
   - Add your phone as an emergency contact (to receive the SMS)

2. **Wait** for the call at the scheduled time

3. **When the call comes**:
   - Say **"banana"** → Escalation triggers, SMS sent to all contacts
   - Say **"pineapple"** → Safe, call ends normally
   - Say **"help me"** or something distressed → OpenAI may classify as distressed (>70%) and trigger escalation

### Testing Without Waiting

To test immediately, set `scheduledAt` to 1 minute from now when activating. The scheduler runs every minute.

### Twilio Trial Limitations

- Trial accounts can only call/SMS **verified** numbers
- Add verified numbers in Twilio Console → Phone Numbers → Verified Caller IDs
- You can verify your own phone for testing

---

## Deployment

### Option A: Render

1. **Push to GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git remote add origin https://github.com/yourusername/guardian-ai.git
   git push -u origin main
   ```

2. **Create Web Service on Render**
   - Go to [render.com](https://render.com)
   - New → Web Service
   - Connect your GitHub repo
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free

3. **Environment Variables**
   - In Render dashboard → Environment
   - Add: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `OPENAI_API_KEY`
   - Add: `BASE_URL` = your Render URL (e.g. `https://guardian-ai-xxx.onrender.com`)

4. **Deploy** - Render will build and deploy

5. **Webhook URL** - Your `BASE_URL` is used automatically. No Twilio Console config needed.

### Option B: Railway

1. Push to GitHub (same as above)
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select repo, Railway auto-detects Node.js
4. Add environment variables in Railway dashboard
5. Set `BASE_URL` to your Railway URL (e.g. `https://guardian-ai-production.up.railway.app`)

### Option C: Vercel

Vercel is optimized for serverless/frontend. For a long-running Node server with cron, **Render or Railway are better choices**. If you use Vercel, you'd need to use Vercel serverless functions and an external cron service (e.g. cron-job.org) to hit an endpoint every minute. Not recommended for this project.

---

## API Reference

### POST /api/activate

Activate a new check-in session.

**Body:**
```json
{
  "userPhone": "+15551234567",
  "safeWord": "pineapple",
  "escalationWord": "banana",
  "scheduledAt": "2025-02-28T15:30:00.000Z",
  "contacts": [
    { "phone": "+15559876543", "isPrimary": true },
    { "phone": "+15551112222" }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "sessionId": "uuid",
  "message": "Check-in call scheduled for ..."
}
```

### GET /api/session/:id

Get session details.

### GET /api/events/:sessionId

Get event log for a session (debugging).

---

## Speech-to-Text Choice

We use **Twilio's built-in transcription**.

- When `<Record transcribe="true">` is used in TwiML, Twilio records the call and automatically transcribes it when complete
- The transcription is sent to our `transcribeCallback` webhook
- **Why**: No extra API calls, seamless with recording flow, reliable for short responses
- **Alternative**: OpenAI Whisper would require downloading the recording file and making a separate API call—adds latency and complexity

---

## Server Restart & Persistence

- All scheduled sessions are stored in SQLite (`data/guardian.db`)
- The scheduler runs **every minute** and queries the DB for sessions where `scheduled_at <= now` and `status = 'pending'`
- On server restart, no special action needed—the next cron run will pick up any due sessions
- Sessions are never "lost" because they're in the database

---

## Security Summary

- **Environment variables**: Secrets (Twilio, OpenAI) never in code; use `.env` only
- **Rate limiting**: 100 req/15min for API, 200 req/min for webhooks
- **Webhook validation**: Twilio request signature validated via `x-twilio-signature`
- **Phone validation**: E.164 format via validator.js
- **Abuse prevention**: Rate limits + Twilio trial limits (verified numbers only)

## Testing the API with curl

```bash
# Activate a session (replace with your values)
curl -X POST http://localhost:3000/api/activate \
  -H "Content-Type: application/json" \
  -d '{
    "userPhone": "+15551234567",
    "safeWord": "pineapple",
    "escalationWord": "banana",
    "scheduledAt": "2025-02-28T20:00:00.000Z",
    "contacts": [{"phone": "+15559876543", "isPrimary": true}]
  }'
```
