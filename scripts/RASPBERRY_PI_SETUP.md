# Guardian AI - Raspberry Pi Setup Guide

## Hardware Requirements

### Components
- **Raspberry Pi** (3B+ or newer recommended)
- **LED** (Red, 2-3V) with resistor (220Ω)
- **Piezo Buzzer** (5V passive or active)
- **Push Button** (momentary)
- **Resistors & Breadboard** (optional, for prototyping)
- **Jumper wires**
- **5V Power supply** (2.5A+ recommended)

## GPIO Wiring

### Default Pin Configuration
```
led_pin = GPIO 17    (Physical pin 11)
buzzer_pin = GPIO 27 (Physical pin 13)
button_pin = GPIO 22 (Physical pin 15)
GND = Physical pins 6, 9, 14, 20, 25, 30, 34, 39

LED Wiring:
  GPIO 17 (pin 11) → LED Anode (long leg)
  LED Cathode (short leg) → 220Ω Resistor → GND

Buzzer Wiring:
  GPIO 27 (pin 13) → Buzzer Positive
  Buzzer Negative → GND

Button Wiring:
  GPIO 22 (pin 15) → Button pin 1
  Button pin 2 → GND
  (Pulled up internally in code)
```

### Physical Pin Layout
```
      3V3 (1)  (2) 5V
     GPIO2 (3) (4) 5V
     GPIO3 (5) (6) GND
     GPIO4 (7) (8) GPIO14
      GND (9)(10) GPIO15
    GPIO17(11)(12) GPIO18  ← LED
    GPIO27(13)(14) GND      ← Buzzer = GND
    GPIO22(15)(16) GPIO23   ← Button
      3V3(17)(18) GPIO24
     GPIO10(19)(20) GND
      GPIO9(21)(22) GPIO25
     GPIO11(23)(24) GPIO8
      GND(25)(26) GPIO7
```

## Software Setup

### 1. Install Raspberry Pi OS
- Download [Raspberry Pi Imager](https://www.raspberrypi.com/software/)
- Flash to SD card
- Enable SSH & I2C/SPI in raspi-config if needed

### 2. Install Python Dependencies

```bash
sudo apt-get update
sudo apt-get install python3-pip python3-venv git

# Install RPi.GPIO
pip3 install RPi.GPIO

# Install required packages
pip3 install requests python-dotenv
```

### 3. Clone Project

```bash
cd ~
git clone <your-repo-url>
cd hackathon
```

### 4. Create Environment Configuration

Create `.env.pi` in the project root:

```bash
# Server Configuration
GUARDIAN_SERVER_URL=http://your-hackathon-server:3000
POLLING_INTERVAL=5

# GPIO Pin Configuration
LED_PIN=17
BUZZER_PIN=27
BUTTON_PIN=22
```

### 5. Run the Script

**Development/Testing:**
```bash
python3 scripts/distress_signal_pi.py
```

**With environment file:**
```bash
export $(cat .env.pi | xargs)
python3 scripts/distress_signal_pi.py
```

**As background service:**
```bash
nohup python3 scripts/distress_signal_pi.py > /tmp/guardian_pi.log 2>&1 &
```

## Running as Systemd Service

Create `/etc/systemd/system/guardian-pi.service`:

```ini
[Unit]
Description=Guardian AI Distress Signal Monitor
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/hackathon
ExecStart=/usr/bin/python3 /home/pi/hackathon/scripts/distress_signal_pi.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable guardian-pi.service
sudo systemctl start guardian-pi.service

# Check status
sudo systemctl status guardian-pi.service

# View logs
sudo journalctl -u guardian-pi.service -f
```

## Testing

### Manual LED/Buzzer Test

```bash
python3 << 'EOF'
import RPi.GPIO as GPIO
import time

GPIO.setmode(GPIO.BCM)
GPIO.setup(17, GPIO.OUT)  # LED
GPIO.setup(27, GPIO.OUT)  # Buzzer

# Test LED
for i in range(5):
    GPIO.output(17, GPIO.HIGH)
    time.sleep(0.5)
    GPIO.output(17, GPIO.LOW)
    time.sleep(0.5)

# Test Buzzer
for i in range(3):
    GPIO.output(27, GPIO.HIGH)
    time.sleep(0.3)
    GPIO.output(27, GPIO.LOW)
    time.sleep(0.3)

GPIO.cleanup()
EOF
```

### Trigger Distress Signal
From your server machine:
```bash
curl -X POST http://your-hackathon-server:3000/api/activate \
  -H "Content-Type: application/json" \
  -d '{
    "userPhone": "+1234567890",
    "safeWord": "safe",
    "escalationWord": "help",
    "scheduledAt": 300,
    "contacts": [{"phone": "+0987654321"}]
  }'
```

## Troubleshooting

### GPIO Permission Denied
```bash
# Add user to gpio group
sudo usermod -a -G gpio pi

# Log out and log back in
exit
ssh pi@raspberry

# Verify
groups pi
```

### Buzzer Not Working
- Test voltage: `cat /sys/class/gpio/gpio27/value`
- Check if using correct GPIO pin
- Verify buzzer is rated for 3.3V or use a transistor driver for 5V buzzers

### LED Dim or Not Lit
- Check resistor value (should be 220Ω for standard LED)
- Verify polarity (longer leg = positive)
- Test with multimeter

### Server Connection Issues
- Check network connectivity: `ping your-server-ip`
- Verify server URL in `.env.pi`
- Check firewall: `sudo ufw allow 3000`

## Additional Features

### Siren Mode (for active buzzer)
Replace buzzer control in script:
```python
# For continuous siren (uses PWM)
GPIO.PWM(self.buzzer_pin, 1000).start(50)  # 50% duty cycle
```

### SMS Notification to Pi Owner
Modify script to send SMS when distress triggered:
```python
from twilio.rest import Client

def notify_owner(self):
    client = Client(os.getenv('TWILIO_ACCOUNT_SID'), 
                    os.getenv('TWILIO_AUTH_TOKEN'))
    client.messages.create(
        to='+1234567890',
        from_=os.getenv('TWILIO_PHONE_NUMBER'),
        body='🚨 Distress signal detected! Check location.'
    )
```

## References

- [RPi GPIO Documentation](https://sourceforge.net/p/raspberry-gpio-python/wiki/Home/)
- [Raspberry Pi Pinout](https://pinout.xyz/)
- [Guardian AI Server API](../README.md)
