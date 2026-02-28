#!/usr/bin/env python3
"""
Guardian AI - Raspberry Pi Distress Signal Handler
Monitors the server for distress/escalation events and triggers GPIO alerts
"""

import requests
import time
import sys
import logging
from typing import Optional
from datetime import datetime
from dotenv import load_dotenv
import os

# Try to import GPIO libraries (optional - won't fail if not on RPi)
try:
    import RPi.GPIO as GPIO
    HAS_GPIO = True
except ImportError:
    HAS_GPIO = False
    print("⚠️  RPi.GPIO not available - running in simulation mode")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('/tmp/guardian_pi.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

class DistressSignalMonitor:
    """Monitor for distress signals and trigger GPIO alerts"""
    
    def __init__(self, 
                 server_url: str = "http://localhost:3000",
                 polling_interval: int = 5,
                 led_pin: int = 17,
                 buzzer_pin: int = 27,
                 button_pin: int = 22):
        """
        Initialize the distress signal monitor
        
        Args:
            server_url: URL of the Guardian AI server
            polling_interval: Seconds between checks (minimum 2)
            led_pin: GPIO pin for LED alert
            buzzer_pin: GPIO pin for buzzer/speaker
            button_pin: GPIO pin for manual dismiss button
        """
        self.server_url = server_url.rstrip('/')
        self.polling_interval = max(polling_interval, 2)  # Minimum 2 seconds
        self.led_pin = led_pin
        self.buzzer_pin = buzzer_pin
        self.button_pin = button_pin
        self.is_alerting = False
        self.session_id = None
        
        self._setup_gpio()
        logger.info(f"✅ Distress Signal Monitor initialized (polling: {self.polling_interval}s)")
    
    def _setup_gpio(self):
        """Configure GPIO pins for output"""
        if not HAS_GPIO:
            logger.warning("GPIO not available - alerts will be logged only")
            return
        
        try:
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            
            # Setup output pins
            GPIO.setup(self.led_pin, GPIO.OUT, initial=GPIO.LOW)
            GPIO.setup(self.buzzer_pin, GPIO.OUT, initial=GPIO.LOW)
            
            # Setup input pin with pull-up and falling edge detection
            GPIO.setup(self.button_pin, GPIO.IN, pull_up_down=GPIO.PUD_UP)
            GPIO.add_event_detect(
                self.button_pin,
                GPIO.FALLING,
                callback=self._button_pressed,
                bouncetime=200
            )
            
            logger.info(f"GPIO configured - LED:{self.led_pin}, Buzzer:{self.buzzer_pin}, Button:{self.button_pin}")
        except Exception as e:
            logger.error(f"GPIO setup failed: {e}")
            HAS_GPIO = False
    
    def _button_pressed(self, channel):
        """Callback for manual dismiss button"""
        logger.info("🔔 Dismiss button pressed - silencing alert")
        self.silence_alert()
    
    def trigger_alert(self, session_id: str):
        """Trigger visual and auditory alerts"""
        self.is_alerting = True
        self.session_id = session_id
        logger.warning(f"🚨 DISTRESS SIGNAL DETECTED - Session: {session_id}")
        
        if HAS_GPIO:
            try:
                # LED: Fast blink pattern
                for _ in range(10):
                    GPIO.output(self.led_pin, GPIO.HIGH)
                    time.sleep(0.2)
                    GPIO.output(self.led_pin, GPIO.LOW)
                    time.sleep(0.2)
                
                # Keep LED on
                GPIO.output(self.led_pin, GPIO.HIGH)
                
                # Buzzer: Double beep pattern
                self._buzzer_pattern()
                
                # Keep buzzer soft pulse
                self._start_pulse_buzzer()
                
            except Exception as e:
                logger.error(f"Alert trigger failed: {e}")
        else:
            print("\n" + "=" * 50)
            print("🚨 DISTRESS SIGNAL ALERT!")
            print(f"Session ID: {session_id}")
            print("=" * 50 + "\n")
    
    def _buzzer_pattern(self):
        """Play a distinctive double-beep pattern"""
        if not HAS_GPIO:
            return
        
        try:
            # Double beep
            for _ in range(2):
                GPIO.output(self.buzzer_pin, GPIO.HIGH)
                time.sleep(0.3)
                GPIO.output(self.buzzer_pin, GPIO.LOW)
                time.sleep(0.2)
        except Exception as e:
            logger.error(f"Buzzer pattern failed: {e}")
    
    def _start_pulse_buzzer(self):
        """Start soft pulsing buzzer pattern (0.5 second cycle)"""
        if not HAS_GPIO or not self.is_alerting:
            return
        
        try:
            GPIO.output(self.buzzer_pin, GPIO.HIGH)
            time.sleep(0.1)
            GPIO.output(self.buzzer_pin, GPIO.LOW)
            # Will repeat in main polling loop
        except Exception as e:
            logger.error(f"Buzzer pulse failed: {e}")
    
    def silence_alert(self):
        """Silence the alert"""
        if not self.is_alerting:
            return
        
        self.is_alerting = False
        logger.info("🔇 Alert silenced")
        
        if HAS_GPIO:
            try:
                GPIO.output(self.led_pin, GPIO.LOW)
                GPIO.output(self.buzzer_pin, GPIO.LOW)
            except Exception as e:
                logger.error(f"Failed to silence alert: {e}")
    
    def check_distress_signal(self) -> Optional[str]:
        """
        Poll the server for active distress signals
        Returns session_id if distress detected, None otherwise
        """
        try:
            # Check for active escalations
            response = requests.get(
                f"{self.server_url}/api/status",
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                
                # Check if there's an active escalation
                if data.get('status') == 'escalated' or data.get('has_active_escalation'):
                    session_id = data.get('session_id')
                    return session_id
            
            return None
            
        except requests.exceptions.RequestException as e:
            logger.warning(f"Server connection error: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error checking distress signal: {e}")
            return None
    
    def run(self):
        """Main monitoring loop"""
        logger.info(f"Starting distress signal monitoring (checking {self.server_url}/api/status)")
        
        try:
            while True:
                # Check for distress signals
                distress_session = self.check_distress_signal()
                
                if distress_session:
                    # Escalation detected
                    if not self.is_alerting or self.session_id != distress_session:
                        self.trigger_alert(distress_session)
                    
                    # Maintain pulse while alerting
                    if self.is_alerting and HAS_GPIO:
                        try:
                            # Soft pulse pattern
                            GPIO.output(self.buzzer_pin, GPIO.HIGH)
                            time.sleep(0.05)
                            GPIO.output(self.buzzer_pin, GPIO.LOW)
                        except Exception as e:
                            logger.error(f"Pulse maintenance failed: {e}")
                else:
                    # No distress signal
                    if self.is_alerting:
                        self.silence_alert()
                
                time.sleep(self.polling_interval)
                
        except KeyboardInterrupt:
            logger.info("Shutdown signal received")
            self.shutdown()
        except Exception as e:
            logger.error(f"Unhandled exception in monitoring loop: {e}")
            self.shutdown()
            sys.exit(1)
    
    def shutdown(self):
        """Clean shutdown"""
        logger.info("Shutting down distress signal monitor...")
        self.silence_alert()
        
        if HAS_GPIO:
            try:
                GPIO.cleanup()
                logger.info("GPIO cleaned up")
            except Exception as e:
                logger.error(f"GPIO cleanup error: {e}")


def main():
    """Entry point"""
    # Get configuration from environment or use defaults
    server_url = os.getenv('GUARDIAN_SERVER_URL', 'http://localhost:3000')
    polling_interval = int(os.getenv('POLLING_INTERVAL', '5'))
    led_pin = int(os.getenv('LED_PIN', '17'))
    buzzer_pin = int(os.getenv('BUZZER_PIN', '27'))
    button_pin = int(os.getenv('BUTTON_PIN', '22'))
    
    monitor = DistressSignalMonitor(
        server_url=server_url,
        polling_interval=polling_interval,
        led_pin=led_pin,
        buzzer_pin=buzzer_pin,
        button_pin=button_pin
    )
    
    monitor.run()


if __name__ == '__main__':
    main()
