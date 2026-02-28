# Guardian AI

A proactive safety system that automatically calls users at scheduled times, listens for a safe word or escalation word, and sends SMS alerts to emergency contacts when help is needed.

## Quick Start

```bash
npm install
npm run init-db
cp .env.example .env
# Edit .env with your Twilio and OpenAI keys
npm start
```

Open http://localhost:3000

**For local testing with Twilio webhooks**, use [ngrok](https://ngrok.com) and set `BASE_URL` to your ngrok URL.

## Project Structure

```
guardian-ai/
├── public/
│   └── index.html          # Minimal frontend
├── src/
│   ├── db/
│   │   ├── schema.sql      # SQLite schema
│   │   ├── init.js         # DB init script
│   │   └── index.js        # DB helpers
│   ├── routes/
│   │   ├── api.js          # REST API (activate, session, events)
│   │   └── webhooks.js     # Twilio webhooks (voice, transcription, etc.)
│   ├── scheduler/
│   │   └── index.js        # Cron job - checks for due sessions every minute
│   ├── services/
│   │   ├── twilio.js       # Calls, SMS, TwiML
│   │   ├── openai.js       # Intent classification
│   │   ├── wordDetector.js # Safe/escalation word detection
│   │   └── escalation.js   # Level 1 (SMS) + Level 2 (call primary)
│   ├── utils/
│   │   └── logger.js       # Event logging
│   └── server.js           # Express app
├── data/
│   └── guardian.db         # SQLite (created on init)
├── .env.example
├── package.json
├── README.md
└── SETUP.md                # Detailed setup & deployment
```

## API Routes

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/activate | Create and schedule a check-in session |
| GET | /api/session/:id | Get session details |
| GET | /api/events/:sessionId | Get event log (debugging) |

## Flow

1. User activates with phone, safe word, escalation word, scheduled time, emergency contacts
2. At scheduled time, system calls the user
3. Voice says: "Hey, just checking in. Everything good?"
4. System records and transcribes the response (Twilio built-in)
5. If **escalation word** → Send SMS to all contacts + call primary contact
6. If **safe word** → End normally
7. If **neither** → OpenAI classifies distress; if >70%, escalate

## Tech Stack

- **Backend**: Node.js, Express
- **Database**: SQLite (better-sqlite3)
- **APIs**: Twilio (calls, SMS, transcription), OpenAI (intent classification)
- **Scheduler**: node-cron (every minute)

See [SETUP.md](SETUP.md) for full setup, Twilio configuration, ngrok testing, and deployment.
