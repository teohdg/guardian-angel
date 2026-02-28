/**
 * Twilio Webhook Handlers
 *
 * Twilio sends HTTP requests to these URLs. We must respond with TwiML (XML)
 * for voice, or 200 OK for status callbacks.
 *
 * Webhook URL configuration:
 * - Voice URL: Set per-call in initiateCheckInCall (dynamic)
 * - Recording/Transcription: Set in TwiML (dynamic)
 * - In production: BASE_URL must be your public domain (e.g. ngrok or Render)
 */
const express = require('express');
const router = express.Router();
const { urlencoded } = require('express');
const twilio = require('twilio');
const {
  getSession,
  updateSessionStatus,
  logEvent,
} = require('../db');
const {
  generateVoiceTwiML,
  generateEmergencyCallTwiML,
} = require('../services/twilio');
const { analyzeResponse } = require('../services/wordDetector');
const { classifyDistressIntent } = require('../services/openai');
const { triggerEscalation } = require('../services/escalation');

// Twilio sends form-urlencoded for webhooks
router.use(urlencoded({ extended: false }));

/**
 * Validate Twilio request signature (protects against spoofed webhooks)
 */
function validateTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'];
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const url = `${protocol}://${host}${req.originalUrl}`;
  const params = req.body;

  if (!process.env.TWILIO_AUTH_TOKEN) {
    return next(); // Skip in dev if not configured
  }

  const isValid = twilio.validateRequest(
    process.env.TWILIO_AUTH_TOKEN,
    signature,
    url,
    params
  );

  if (!isValid) {
    console.warn('Invalid Twilio signature - possible spoofed webhook');
    return res.status(403).send('Forbidden');
  }
  next();
}

router.use(validateTwilioSignature);

/**
 * GET /api/webhooks/voice?sessionId=xxx
 * Twilio requests this when the outbound call is answered.
 * We return TwiML: Say greeting + Record with transcription.
 */
router.get('/voice', (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).send('Missing sessionId');
  }

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).send('Session not found');
  }

  const twiml = generateVoiceTwiML(sessionId);
  res.type('text/xml');
  res.send(twiml);
});

/**
 * POST/GET /api/webhooks/recording-complete?sessionId=xxx
 * Twilio sends this when recording is finished (as 'action' URL).
 * We log the event and return TwiML to hang up the call.
 */
const hangupTwiML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

router.all('/recording-complete', (req, res) => {
  const { sessionId } = req.query;
  if (sessionId && req.body?.RecordingSid) {
    logEvent(sessionId, 'recording_complete', {
      recordingSid: req.body.RecordingSid,
      duration: req.body.RecordingDuration,
    });
  }
  res.type('text/xml');
  res.send(hangupTwiML);
});

/**
 * POST /api/webhooks/transcription?sessionId=xxx
 * Twilio sends the transcription here when it's ready.
 * This is where we check for safe/escalation word and trigger logic.
 */
router.post('/transcription', async (req, res) => {
  const { sessionId } = req.query;
  const transcription = req.body.TranscriptionText || req.body.transcriptionText || '';

  res.status(200).send(); // Respond quickly - Twilio expects fast response

  if (!sessionId) {
    console.warn('Transcription webhook: missing sessionId');
    return;
  }

  const session = getSession(sessionId);
  if (!session) {
    console.warn('Transcription webhook: session not found', sessionId);
    return;
  }

  logEvent(sessionId, 'transcription_received', {
    text: transcription,
    confidence: req.body.TranscriptionStatus,
  });

  const result = analyzeResponse(
    transcription,
    session.safe_word,
    session.escalation_word
  );

  if (result === 'escalate') {
    logEvent(sessionId, 'escalation_word_detected', { transcription });
    await triggerEscalation(sessionId);
    return;
  }

  if (result === 'safe') {
    logEvent(sessionId, 'safe_word_detected', { transcription });
    updateSessionStatus(sessionId, 'completed');
    return;
  }

  // Unknown - use OpenAI to classify distress
  const { isDistressed, score, reason } = await classifyDistressIntent(transcription);
  logEvent(sessionId, 'openai_classification', {
    transcription,
    score,
    reason,
    isDistressed,
  });

  if (isDistressed) {
    logEvent(sessionId, 'ai_distress_detected', { score, reason });
    await triggerEscalation(sessionId);
  } else {
    updateSessionStatus(sessionId, 'completed');
  }
});

/**
 * POST /api/webhooks/call-status?sessionId=xxx
 * Twilio sends call status updates (initiated, ringing, answered, completed)
 */
router.post('/call-status', (req, res) => {
  const { sessionId } = req.query;
  const { CallStatus, CallSid } = req.body;

  if (sessionId) {
    logEvent(sessionId, 'call_status', { CallStatus, CallSid });
  }

  res.status(200).send();
});

/**
 * GET /api/webhooks/emergency-call?sessionId=xxx&userPhone=+123
 * TwiML for the emergency call to primary contact
 */
router.get('/emergency-call', (req, res) => {
  const { sessionId, userPhone } = req.query;
  if (!userPhone) {
    return res.status(400).send('Missing userPhone');
  }

  const twiml = generateEmergencyCallTwiML(decodeURIComponent(userPhone));
  res.type('text/xml');
  res.send(twiml);
});

module.exports = router;
