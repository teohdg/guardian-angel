# Quick Start - Guardian AI on Raspberry Pi

## 5-Minute Setup

### 1. Hardware Wiring (5 minutes)

Connect to your Raspberry Pi:
- **GPIO 17** → Red LED (+ resistor to GND)
- **GPIO 27** → Buzzer (+ to buzzer, - to GND)  
- **GPIO 22** → Button (to GND)

[Detailed wiring diagram in RASPBERRY_PI_SETUP.md]

### 2. Software Installation (3 minutes)

```bash
# Update system
sudo apt-get update && sudo apt-get install -y python3-pip

# Install dependencies
pip3 install RPi.GPIO requests python-dotenv

# Copy environment config
cd ~/hackathon
cp scripts/.env.pi.example scripts/.env.pi
```

### 3. Configure Server URL

Edit `scripts/.env.pi`:
```bash
nano scripts/.env.pi

# Change this line to your server:
GUARDIAN_SERVER_URL=http://your-server-ip:3000
```

### 4. Test the Setup

```bash
# Test GPIO (should blink LED 5 times)
python3 << 'EOF'
import RPi.GPIO as GPIO
import time
GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)
for i in range(5):
    GPIO.output(17, GPIO.HIGH)
    time.sleep(0.5)
    GPIO.output(17, GPIO.LOW)
    time.sleep(0.5)
GPIO.cleanup()
EOF

# Run the monitor
python3 scripts/distress_signal_pi_simple.py
```

### 5. Make it Auto-Start (Optional)

```bash
# Create service file
sudo nano /etc/systemd/system/guardian-pi.service
```

Paste:
```ini
[Unit]
Description=Guardian AI Distress Signal Monitor
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/hackathon
ExecStart=/usr/bin/python3 /home/pi/hackathon/scripts/distress_signal_pi_simple.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable guardian-pi
sudo systemctl start guardian-pi
sudo systemctl status guardian-pi
```

## What It Does

**Monitoring Loop:**
1. Checks Guardian AI server every 5 seconds for active escalations
2. When distress detected:
   - 🔴 LED blinks rapidly 5 times
   - 🔊 Buzzer sounds in sync with LED
   - 💡 LED stays on as alert
   - 📊 Buzzer pulses softly
3. When distress ends:
   - LED turns off
   - Buzzer stops

## Scripts Included

| File | Purpose |
|------|---------|
| `distress_signal_pi.py` | **Full-featured** version with button dismiss, better logging |
| `distress_signal_pi_simple.py` | **Minimal** version, easiest to modify |
| `RASPBERRY_PI_SETUP.md` | Complete hardware/software documentation |
| `.env.pi.example` | Configuration template |

## Choose Your Version

### Simple (Recommended for Beginners)
```bash
export $(cat scripts/.env.pi | xargs)
python3 scripts/distress_signal_pi_simple.py
```

### Full Featured (with Button Dismiss)
```bash
export $(cat scripts/.env.pi | xargs)
python3 scripts/distress_signal_pi.py
```

## Modify GPIO Pins

If you wired to different pins, edit `.env.pi`:

```bash
LED_PIN=18        # Change from 17
BUZZER_PIN=23     # Change from 27
BUTTON_PIN=24     # Change from 22
```

## Debugging

**See logs:**
```bash
# If running as service
sudo journalctl -u guardian-pi -f

# If running directly, just watch output
python3 scripts/distress_signal_pi_simple.py
```

**Check server connection:**
```bash
curl http://your-server-ip:3000/api/status
```

**GPIO test:**
```bash
python3 -c "import RPi.GPIO as GPIO; print('GPIO OK')"
```

## What Happens When Someone Uses the Panic Button

1. They activate distress on your Guardian AI server
2. Guardian AI server sets session status to `escalated`
3. Your Raspberry Pi detects this within 5 seconds
4. **LED flashes and buzzer sounds immediately!**
5. You're alerted to help

## Next Steps

- Add SMS notifications to yourself when alert triggers
- Add camera activation to monitor the location
- Create a physical reset button with LED indicator
- Track response times in database

See [RASPBERRY_PI_SETUP.md](RASPBERRY_PI_SETUP.md) for advanced features.
