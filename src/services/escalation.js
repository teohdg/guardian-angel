/**
 * Escalation Ladder
 * Level 1: Send SMS to all emergency contacts
 * Level 2: Call primary emergency contact
 */
const {
  sendSMS,
  initiateEmergencyCall,
} = require('./twilio');
const {
  getSession,
  getEmergencyContacts,
  getPrimaryContact,
  updateSessionStatus,
  logEvent,
} = require('../db');

/**
 * Execute full escalation: SMS to all + call to primary
 */
async function triggerEscalation(sessionId, location = null) {
  const session = getSession(sessionId);
  if (!session) {
    console.error('Session not found for escalation:', sessionId);
    return;
  }

  updateSessionStatus(sessionId, 'escalated');
  logEvent(sessionId, 'escalation_triggered', {
    userPhone: session.user_phone,
    location,
    timestamp: new Date().toISOString(),
  });

  const contacts = getEmergencyContacts(sessionId);
  const locationText = location ? `\n\nLocation: ${location}` : '';

  const smsBody = `🚨 GUARDIAN AI DISTRESS ALERT 🚨

We received an escalation signal from ${session.user_phone}.

Please check on them immediately.${locationText}

This is an automated alert from Guardian AI.`;

  // Level 1: Send SMS to ALL contacts
  for (const contact of contacts) {
    try {
      await sendSMS(contact.phone_number, smsBody);
      logEvent(sessionId, 'sms_sent', {
        to: contact.phone_number,
        isPrimary: contact.is_primary === 1,
      });
    } catch (err) {
      console.error('SMS send failed:', contact.phone_number, err.message);
      logEvent(sessionId, 'sms_failed', {
        to: contact.phone_number,
        error: err.message,
      });
    }
  }

  // Level 2: Call primary contact
  const primary = getPrimaryContact(sessionId);
  if (primary) {
    try {
      await initiateEmergencyCall(
        primary.phone_number,
        sessionId,
        session.user_phone
      );
      logEvent(sessionId, 'emergency_call_initiated', {
        to: primary.phone_number,
      });
    } catch (err) {
      console.error('Emergency call failed:', primary.phone_number, err.message);
      logEvent(sessionId, 'emergency_call_failed', {
        to: primary.phone_number,
        error: err.message,
      });
    }
  }
}

module.exports = {
  triggerEscalation,
};
