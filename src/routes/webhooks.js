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
const { classifyDistressIntent, transcribeAudio } = require('../services/openai');
const { triggerEscalation } = require('../services/escalation');

// Twilio sends form-urlencoded for webhooks
router.use(urlencoded({ extended: false }));

/**
 * Validate Twilio request signature (protects against spoofed webhooks)
 */
function validateTwilioSignature(req, res, next) {
  const signature = req.headers['x-twilio-signature'];
  
  if (!process.env.TWILIO_AUTH_TOKEN) {
    console.log('[Signature] Skipping validation - TWILIO_AUTH_TOKEN not set');
    return next();
  }

  // In development with ngrok, signature validation can be tricky due to URL reconstruction
  // Use SKIP_TWILIO_VALIDATION=true to bypass for testing
  if (process.env.SKIP_TWILIO_VALIDATION === 'true') {
    console.log('[Signature] Skipping validation (SKIP_TWILIO_VALIDATION=true)');
    return next();
  }

  // Reconstruct the URL that Twilio used to sign the request
  // Behind a proxy (ngrok), use X-Forwarded headers
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const url = `${protocol}://${host}${req.originalUrl}`;
  
  // For Twilio validation, we need the exact URL and params as they were when signed
  const params = req.method === 'GET' ? req.query : req.body;

  console.log('[Signature] Validating', { 
    method: req.method,
    url: url.substring(0, 80),
    paramsKeys: Object.keys(params).slice(0, 5),
    signatureProvided: !!signature,
    authTokenSet: !!process.env.TWILIO_AUTH_TOKEN
  });

  try {
    const isValid = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      signature,
      url,
      params
    );

    if (!isValid) {
      console.warn('[Signature] Invalid signature', { 
        url: url.substring(0, 80),
        method: req.method,
        signature: signature ? signature.substring(0, 20) + '...' : 'missing',
        bodyKeys: Object.keys(params)
      });
      return res.status(403).send('Forbidden');
    }
    console.log('[Signature] Valid signature');
  } catch (err) {
    console.error('[Signature] Validation error:', err.message);
    return res.status(403).send('Forbidden');
  }
  
  next();
}

/**
 * GET /api/webhooks/ping
 * No auth. Use this to verify your public URL is reachable (e.g. open in browser or curl).
 */
router.get('/ping', (req, res) => {
  res.json({
    ok: true,
    message: 'Webhook server is reachable. Twilio can use this BASE_URL.',
    baseUrl: process.env.BASE_URL,
  });
});

/**
 * GET /api/webhooks/test-twiml?sessionId=test
 * TEST ENDPOINT: See what TwiML is being generated
 */
router.get('/test-twiml', (req, res) => {
  try {
    const { sessionId } = req.query;
    const testSessionId = sessionId || 'test-session-123';
    const twiml = generateVoiceTwiML(testSessionId);
    console.log('[TEST] TwiML generated:', twiml);
    res.type('text/xml').send(twiml);
  } catch (err) {
    console.error('[TEST] Error:', err.message);
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

router.use(validateTwilioSignature);

/**
 * GET/POST /api/webhooks/voice?sessionId=xxx
 * Twilio requests this when the outbound call is answered.
 * We return TwiML: Say greeting + Record with transcription.
 */
router.all('/voice', (req, res) => {
  try {
    const sessionId = req.query.sessionId || req.body.sessionId;
    console.log('[Webhook] Voice URL hit', { sessionId, method: req.method, headers: Object.keys(req.headers) });
    
    if (!sessionId) {
      console.error('[Webhook] Voice: missing sessionId');
      const errorTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error: missing session</Say></Response>';
      return res.status(400).type('text/xml').send(errorTwiml);
    }

    const session = getSession(sessionId);
    if (!session) {
      console.warn('[Webhook] Voice: session not found', sessionId);
      const errorTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error: session not found</Say></Response>';
      return res.status(404).type('text/xml').send(errorTwiml);
    }

    const twiml = generateVoiceTwiML(sessionId);
    console.log('[Webhook] Voice: TwiML generated successfully', { sessionId, twimlLength: twiml.length });
    
    // Ensure proper response headers for Twilio
    res.status(200).type('text/xml').send(twiml);
    console.log('[Webhook] Voice: TwiML sent successfully');
    
  } catch (err) {
    console.error('[Webhook] Voice error:', { error: err.message, stack: err.stack });
    const errorTwiml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Server error occurred</Say></Response>';
    res.status(500).type('text/xml').send(errorTwiml);
  }
});

/**
 * POST/GET /api/webhooks/recording-complete?sessionId=xxx
 * Twilio sends this when recording is finished (as 'action' URL).
 * We log the event and return TwiML to hang up the call.
 */
const hangupTwiML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>';

router.all('/recording-complete', async (req, res) => {
  try {
    const { sessionId } = req.query;
    let transcriptionText = req.body.TranscriptionText || req.body.transcriptionText || '';
    const recordingSid = req.body.RecordingSid;
    const recordingUrl = req.body.RecordingUrl;
    const transcriptionStatus = req.body.TranscriptionStatus;
    
    console.log('[Webhook] Recording complete', { sessionId, recordingSid, transcriptionStatus, hasText: !!transcriptionText });
    
    if (!sessionId) {
      console.error('[Webhook] Recording complete: missing sessionId');
      res.status(200).type('text/xml').send(hangupTwiML);
      return;
    }

    const session = getSession(sessionId);
    if (!session) {
      console.warn('[Webhook] Recording complete: session not found', sessionId);
      res.status(200).type('text/xml').send(hangupTwiML);
      return;
    }

    // Log recording completion
    if (recordingSid) {
      logEvent(sessionId, 'recording_complete', {
        recordingSid,
        duration: req.body.RecordingDuration,
        transcriptionStatus,
      });
    }

    // If Twilio transcription failed, use OpenAI Whisper as fallback
    if (!transcriptionText && recordingUrl) {
      console.log('[Webhook] Twilio transcription not available, falling back to OpenAI Whisper', { recordingUrl: recordingUrl.substring(0, 80) + '...' });
      try {
        transcriptionText = await transcribeAudio(recordingUrl, process.env.TWILIO_AUTH_TOKEN);
        console.log('[Webhook] Whisper transcription succeeded:', { textLength: transcriptionText.length });
        logEvent(sessionId, 'whisper_transcription', { text: transcriptionText });
      } catch (err) {
        console.error('[Webhook] Whisper transcription failed:', err.message);
        logEvent(sessionId, 'whisper_transcription_failed', { error: err.message });
      }
    }

    // Process transcription if available
    if (transcriptionText) {
      console.log('[Webhook] Processing transcription', { sessionId, textLength: transcriptionText.length });
      logEvent(sessionId, 'transcription_received', {
        text: transcriptionText,
        status: transcriptionStatus,
      });

      const result = analyzeResponse(
        transcriptionText,
        session.safe_word,
        session.escalation_word
      );

      if (result === 'escalate') {
        logEvent(sessionId, 'escalation_word_detected', { transcriptionText });
        await triggerEscalation(sessionId);
        res.status(200).type('text/xml').send(hangupTwiML);
        return;
      }

      if (result === 'safe') {
        logEvent(sessionId, 'safe_word_detected', { transcriptionText });
        updateSessionStatus(sessionId, 'completed');
        res.status(200).type('text/xml').send(hangupTwiML);
        return;
      }

      // Unknown - use OpenAI to classify distress
      const { isDistressed, score, reason } = await classifyDistressIntent(transcriptionText);
      logEvent(sessionId, 'openai_classification', {
        transcriptionText,
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
    } else {
      console.warn('[Webhook] No transcription text available for session', sessionId);
      logEvent(sessionId, 'no_transcription_available', {});
    }

    res.status(200).type('text/xml').send(hangupTwiML);
  } catch (err) {
    console.error('[Webhook] Recording complete error:', err);
    res.status(200).type('text/xml').send(hangupTwiML);
  }
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
 * GET/POST /api/webhooks/emergency-call?sessionId=xxx&userPhone=+123
 * TwiML for the emergency call to primary contact
 * Location is retrieved from database using sessionId
 */
router.all('/emergency-call', (req, res) => {
  const sessionId = req.query.sessionId || req.body.sessionId;
  const userPhone = req.query.userPhone || req.body.userPhone;
  
  if (!userPhone) {
    return res.status(400).send('Missing userPhone');
  }

  // Get location from database instead of URL parameter
  let location = null;
  if (sessionId) {
    const session = getSession(sessionId);
    location = session ? session.location : null;
  }

  const twiml = generateEmergencyCallTwiML(
    decodeURIComponent(userPhone),
    location
  );
  console.log('[Emergency-Call] Webhook hit:', { sessionId, userPhone, location });
  res.type('text/xml');
  res.send(twiml);
});

module.exports = router;
