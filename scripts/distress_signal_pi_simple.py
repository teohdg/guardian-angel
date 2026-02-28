#!/usr/bin/env python3
"""
Guardian AI - Raspberry Pi Distress Signal Handler (Simplified Version)
Minimal implementation for basic distress alert functionality
"""

import requests
import time
import logging
import os
from pathlib import Path

# Optional GPIO - gracefully degrades if not available
try:
    import RPi.GPIO as GPIO
    HAS_GPIO = True
except ImportError:
    HAS_GPIO = False
    print("⚠️  Running in simulation mode (no GPIO available)")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class SimpleDistressMonitor:
    """Simple distress signal monitor"""
    
    def __init__(self, 
                 server_url="http://localhost:3000",
                 poll_interval=5,
                 led_pin=17,
                 buzzer_pin=27):
        self.server_url = server_url.rstrip('/')
        self.poll_interval = poll_interval
        self.led_pin = led_pin
        self.buzzer_pin = buzzer_pin
        self.alerting = False
        self._init_gpio()
    
    def _init_gpio(self):
        """Initialize GPIO if available"""
        if not HAS_GPIO:
            logger.info("GPIO not available - alerts will be logged")
            return
        
        try:
            GPIO.setmode(GPIO.BCM)
            GPIO.setwarnings(False)
            GPIO.setup(self.led_pin, GPIO.OUT, initial=GPIO.LOW)
            GPIO.setup(self.buzzer_pin, GPIO.OUT, initial=GPIO.LOW)
            logger.info(f"GPIO ready - LED on pin {self.led_pin}, Buzzer on pin {self.buzzer_pin}")
        except Exception as e:
            logger.error(f"GPIO init failed: {e}")
    
    def trigger_alert(self):
        """Trigger the alert"""
        logger.warning("🚨 DISTRESS SIGNAL DETECTED!")
        self.alerting = True
        
        if HAS_GPIO:
            try:
                # LED blink pattern
                for _ in range(5):
                    GPIO.output(self.led_pin, GPIO.HIGH)
                    GPIO.output(self.buzzer_pin, GPIO.HIGH)
                    time.sleep(0.3)
                    GPIO.output(self.led_pin, GPIO.LOW)
                    GPIO.output(self.buzzer_pin, GPIO.LOW)
                    time.sleep(0.2)
                
                # Keep LED on, buzzer pulsing
                GPIO.output(self.led_pin, GPIO.HIGH)
            except Exception as e:
                logger.error(f"Alert trigger failed: {e}")
    
    def silence_alert(self):
        """Stop the alert"""
        if not self.alerting:
            return
        
        logger.info("Alert silenced")
        self.alerting = False
        
        if HAS_GPIO:
            try:
                GPIO.output(self.led_pin, GPIO.LOW)
                GPIO.output(self.buzzer_pin, GPIO.LOW)
            except:
                pass
    
    def check_for_distress(self):
        """Check server for active distress signals"""
        try:
            response = requests.get(
                f"{self.server_url}/api/status",
                timeout=5
            )
            
            if response.status_code == 200:
                data = response.json()
                return data.get('status') == 'escalated'
            
            return False
        except Exception as e:
            logger.warning(f"Server error: {str(e)[:50]}")
            return False
    
    def run(self):
        """Main loop"""
        logger.info(f"Starting monitor - checking {self.server_url}/api/status every {self.poll_interval}s")
        
        try:
            while True:
                has_distress = self.check_for_distress()
                
                if has_distress and not self.alerting:
                    self.trigger_alert()
                elif not has_distress and self.alerting:
                    self.silence_alert()
                
                # Maintain pulse if alerting
                if self.alerting and HAS_GPIO:
                    try:
                        GPIO.output(self.buzzer_pin, GPIO.HIGH)
                        time.sleep(0.05)
                        GPIO.output(self.buzzer_pin, GPIO.LOW)
                    except:
                        pass
                
                time.sleep(self.poll_interval)
        
        except KeyboardInterrupt:
            logger.info("Shutdown")
            self.silence_alert()
            if HAS_GPIO:
                GPIO.cleanup()


if __name__ == '__main__':
    monitor = SimpleDistressMonitor(
        server_url=os.getenv('GUARDIAN_SERVER_URL', 'http://localhost:3000'),
        poll_interval=int(os.getenv('POLLING_INTERVAL', '5')),
        led_pin=int(os.getenv('LED_PIN', '17')),
        buzzer_pin=int(os.getenv('BUZZER_PIN', '27'))
    )
    monitor.run()
