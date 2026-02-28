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
async function triggerEscalation(sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    console.error('Session not found for escalation:', sessionId);
    return;
  }

  updateSessionStatus(sessionId, 'escalated');
  
  // Use location from session if available
  const location = session.location || null;
  
  logEvent(sessionId, 'escalation_triggered', {
    userPhone: session.user_phone,
    location,
    timestamp: new Date().toISOString(),
  });

  // Send SMS to the user asking them to submit their location
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
  const userLocationSMS = `🚨 GUARDIAN AI has triggered an emergency alert for you.

Your emergency contacts have been notified.

Reply with your location or click to submit: ${baseUrl}/location?sessionId=${sessionId}

Stay safe.`;

  try {
    await sendSMS(session.user_phone, userLocationSMS);
    logEvent(sessionId, 'location_request_sms_sent', {
      to: session.user_phone,
    });
    console.log('[Escalation] Location request SMS sent to:', session.user_phone);
  } catch (err) {
    console.error('Location request SMS failed:', err.message);
    logEvent(sessionId, 'location_request_sms_failed', {
      error: err.message,
    });
  }

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
        location,
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
