# Guardian AI

A proactive safety system that automatically calls users at scheduled times, listens for a safe word or escalation word, and sends SMS alerts to emergency contacts when help is needed.

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
- **Hardware Integration**: Raspberry Pi with GPIO alerts (optional)

## Raspberry Pi Integration

Guardian AI can trigger instant visual and auditory alerts on a Raspberry Pi when distress is detected:

```bash
# Quick start on Raspberry Pi
pip3 install RPi.GPIO requests python-dotenv
python3 scripts/distress_signal_pi_simple.py
```

The Raspberry Pi script:
- 🔴 **LED Alert**: Rapid flashing when escalation detected
- 🔊 **Buzzer Alert**: Synchronized sound alert
- 📊 **Continuous Alert**: LED + buzzer pulse until resolved
- 🔘 **Dismiss Button**: Manual silence button (full version)

**Setup Options:**
- **Quick Start**: [QUICK_START_PI.md](scripts/QUICK_START_PI.md) (5 minutes)
- **Full Setup**: [RASPBERRY_PI_SETUP.md](scripts/RASPBERRY_PI_SETUP.md) (detailed)
- **Scripts**: 
  - `distress_signal_pi_simple.py` - Basic implementation
  - `distress_signal_pi.py` - Advanced with button control

See [SETUP.md](SETUP.md) for full setup, Twilio configuration, ngrok testing, and deployment.

To push this project to GitHub, see [GITHUB.md](GITHUB.md).
"# guardian-angel" 
