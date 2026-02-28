/**
 * REST API Routes
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const validator = require('validator');
const {
  db,
  createSession,
  addEmergencyContacts,
  getSession,
  logEvent,
  updateSessionStatus,
  updateSessionLocation,
  getEmergencyContacts,
} = require('../db');
const { addSession } = require('../scheduler');
const { initiateCheckInCall, sendSMS } = require('../services/twilio');

function generateId() {
  return uuidv4();
}

/**
 * Normalize phone to E.164
 */
function normalizePhone(phone) {
  const cleaned = String(phone).replace(/\D/g, '');
  if (cleaned.length === 10) return `+1${cleaned}`;
  if (cleaned.length === 11 && cleaned.startsWith('1')) return `+${cleaned}`;
  return phone.startsWith('+') ? phone : `+${phone}`;
}

/**
 * Validate phone number
 */
function isValidPhone(phone) {
  const normalized = normalizePhone(phone);
  return validator.isMobilePhone(normalized, 'any');
}

/**
 * POST /api/activate
 * Body: {
 *   userPhone, safeWord, escalationWord, scheduledAt,
 *   contacts: [{ phone, isPrimary? }]
 * }
 */
router.post('/activate', (req, res) => {
  try {
    const {
      userPhone,
      safeWord,
      escalationWord,
      scheduledAt,
      location = null,
      contacts = [],
    } = req.body;

    if (!userPhone || !safeWord || !escalationWord || !scheduledAt) {
      return res.status(400).json({
        error: 'Missing required fields: userPhone, safeWord, escalationWord, scheduledAt',
      });
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({
        error: 'At least one emergency contact is required',
      });
    }

    const normalizedUserPhone = normalizePhone(userPhone);
    if (!isValidPhone(normalizedUserPhone)) {
      return res.status(400).json({ error: 'Invalid user phone number' });
    }

    const scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime()) || scheduledDate <= new Date()) {
      return res.status(400).json({
        error: 'scheduledAt must be a valid future date/time',
      });
    }

    const contactList = contacts.map((c, i) => ({
      phone: normalizePhone(c.phone),
      isPrimary: !!c.isPrimary || (i === 0 && contacts.length > 0),
    }));

    for (const c of contactList) {
      if (!isValidPhone(c.phone)) {
        return res.status(400).json({
          error: `Invalid emergency contact: ${c.phone}`,
        });
      }
    }

    const sessionId = generateId();

    createSession({
      id: sessionId,
      userPhone: normalizedUserPhone,
      safeWord: String(safeWord).trim(),
      escalationWord: String(escalationWord).trim(),
      scheduledAt: scheduledDate.toISOString(),
      location: location ? String(location).trim() : null,
    });

    addEmergencyContacts(sessionId, contactList);
    addSession({ id: sessionId, scheduled_at: scheduledDate.toISOString(), user_phone: normalizedUserPhone });

    logEvent(sessionId, 'session_activated', {
      userPhone: normalizedUserPhone,
      scheduledAt: scheduledDate.toISOString(),
      contactCount: contactList.length,
    });

    res.status(201).json({
      success: true,
      sessionId,
      message: `Check-in call scheduled for ${scheduledDate.toLocaleString()}`,
    });
  } catch (err) {
    console.error('Activate error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * POST /api/clear-due
 * Admin endpoint to mark all past pending sessions as completed.
 * Useful when you want to clear out 'due' calls without running them.
 */
router.post('/clear-due', (req, res) => {
  try {
    const result = db.prepare(
      "UPDATE sessions SET status='completed' WHERE status='pending' AND scheduled_at <= datetime('now')"
    ).run();
    res.json({ success: true, updated: result.changes });
  } catch (err) {
    console.error('Clear-due error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

/**
 * GET /api/debug
 * Check config and recent sessions (no secrets). Use to see why calls might not be going through.
 */
router.get('/debug', (req, res) => {
  const { db } = require('../db');
  const hasTwilio = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
  const baseUrl = process.env.BASE_URL || '';
  const isPublicUrl = baseUrl && !baseUrl.includes('localhost');
  const pending = db.prepare(
    "SELECT id, user_phone, scheduled_at, status FROM sessions WHERE status = 'pending' ORDER BY scheduled_at DESC LIMIT 5"
  ).all();
  res.json({
    twilioConfigured: hasTwilio,
    baseUrl: baseUrl || '(not set)',
    baseUrlIsPublic: isPublicUrl,
    hint: !isPublicUrl ? 'Set BASE_URL to your public URL (ngrok or deployed) so Twilio can reach your webhooks.' : null,
    pendingSessionsCount: pending.length,
    pendingSessions: pending,
    serverTime: new Date().toISOString(),
  });
});

/**
 * GET /api/session/:id
 */
router.get('/session/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(session);
});

/**
 * GET /api/events/:sessionId
 * Get event log for a session (for debugging/demo)
 */
router.get('/events/:sessionId', (req, res) => {
  const { db } = require('../db');
  const events = db.prepare(`
    SELECT * FROM event_log WHERE session_id = ? ORDER BY created_at ASC
  `).all(req.params.sessionId);
  res.json(events);
});

/**
 * POST /api/call-now/:sessionId
 * Trigger the check-in call immediately (for testing without waiting for scheduler).
 * Use after activating a session to verify Twilio works.
 */
router.post('/call-now/:sessionId', async (req, res) => {
  try {
    const session = getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    if (session.status !== 'pending') {
      return res.status(400).json({
        error: `Session status is "${session.status}". Call now only works for pending sessions.`,
      });
    }
    const callSid = await initiateCheckInCall(session.user_phone, session.id);
    updateSessionStatus(session.id, 'active');
    logEvent(session.id, 'call_outbound_sent', { userPhone: session.user_phone, triggeredBy: 'call-now' });
    res.json({
      success: true,
      message: 'Call initiated. Your phone should ring shortly.',
      callSid,
    });
  } catch (err) {
    console.error('Call now failed:', err);
    res.status(500).json({
      error: err.message || 'Failed to initiate call',
    });
  }
});

/**
 * POST /api/send-location
 * User submits their location during an emergency
 * Body: { sessionId, location }
 */
router.post('/send-location', async (req, res) => {
  try {
    const { sessionId, location } = req.body;

    if (!sessionId || !location) {
      return res.status(400).json({
        error: 'Missing required fields: sessionId, location',
      });
    }

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const locationStr = String(location).trim();
    if (locationStr.length === 0 || locationStr.length > 500) {
      return res.status(400).json({
        error: 'Location must be 1-500 characters',
      });
    }

    // Update session with location
    updateSessionLocation(sessionId, locationStr);

    logEvent(sessionId, 'location_submitted', {
      location: locationStr,
      submittedAt: new Date().toISOString(),
    });

    console.log('[Location] User submitted location for', sessionId, ':', locationStr);

    // Send updated SMS to all emergency contacts with the new location
    const contacts = getEmergencyContacts(sessionId);
    const updatedSmsBody = `🚨 GUARDIAN AI - LOCATION UPDATE 🚨

User ${session.user_phone} has provided their location.

Location: ${locationStr}

Please check on them immediately.

This is an automated alert from Guardian AI.`;

    for (const contact of contacts) {
      try {
        await sendSMS(contact.phone_number, updatedSmsBody);
        logEvent(sessionId, 'location_update_sms_sent', {
          to: contact.phone_number,
          location: locationStr,
        });
        console.log('[Location] Updated SMS sent to:', contact.phone_number);
      } catch (err) {
        console.error('[Location] SMS failed to', contact.phone_number, ':', err.message);
        logEvent(sessionId, 'location_update_sms_failed', {
          to: contact.phone_number,
          error: err.message,
        });
      }
    }

    res.json({
      success: true,
      message: 'Location received and sent to emergency contacts',
      location: locationStr,
    });
  } catch (err) {
    console.error('Send location error:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
