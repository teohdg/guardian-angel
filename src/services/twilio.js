/**
 * Twilio Service - Outbound calls, recording, SMS
 * 
 * Speech-to-Text Choice: We use Twilio's BUILT-IN transcription.
 * Why: When you use <Record transcribe="true"> in TwiML, Twilio automatically
 * transcribes the recording when it completes. The transcription is sent to
 * our transcribeCallback webhook. No extra API calls, seamless integration
 * with the recording flow, and reliable for short voice responses.
 * 
 * Alternative considered: OpenAI Whisper - would require downloading the
 * recording file and making an API call. More flexible but adds latency
 * and complexity. Twilio's transcription is sufficient for keyword detection.
 */
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhone = process.env.TWILIO_PHONE_NUMBER;
const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

let client = null;

function getClient() {
  if (!client) {
    if (!accountSid || !authToken) {
      throw new Error('TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN must be set');
    }
    client = twilio(accountSid, authToken);
  }
  return client;
}

/**
 * Initiate outbound call to user for check-in
 * @param {string} toPhone - User's phone number
 * @param {string} sessionId - Session ID for webhook context
 */
async function initiateCheckInCall(toPhone, sessionId) {
  if (!twilioPhone) {
    throw new Error('TWILIO_PHONE_NUMBER is not set in .env');
  }
  if (baseUrl.includes('localhost')) {
    console.warn(
      '[Twilio] BASE_URL is localhost. Twilio cannot reach your server when the call is answered. ' +
      'Use ngrok (e.g. ngrok http 3000) and set BASE_URL to the ngrok URL.'
    );
  }

  const client = getClient();
  const voiceUrl = `${baseUrl}/api/webhooks/voice?sessionId=${sessionId}`;

  console.log('[Twilio] Initiating call to', toPhone, '| voice URL:', voiceUrl);

  try {
    const call = await client.calls.create({
      to: toPhone,
      from: twilioPhone,
      url: voiceUrl,
      statusCallback: `${baseUrl}/api/webhooks/call-status?sessionId=${sessionId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      timeout: 30,
    });
    console.log('[Twilio] Call created successfully. Call SID:', call.sid);
    return call.sid;
  } catch (err) {
    const msg = err.message || '';
    const code = err.code || err.status;
    const more = err.moreInfo || '';
    console.error('[Twilio] Call failed:', { code, message: msg, moreInfo: more });
    if (msg.includes('verified') || msg.includes('Verified')) {
      throw new Error(
        'Twilio trial account: the "To" number must be verified. ' +
        'Add it at https://console.twilio.com/us1/develop/phone-numbers/manage/verified'
      );
    }
    throw err;
  }
}

/**
 * Generate TwiML for the check-in call
 * - Plays greeting
 * - Records user response with transcription enabled
 * - Transcribe callback receives the transcribed text
 */
function generateVoiceTwiML(sessionId) {
  const recordUrl = `${baseUrl}/api/webhooks/recording-complete?sessionId=${sessionId}`;
  const transcribeUrl = `${baseUrl}/api/webhooks/transcription?sessionId=${sessionId}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">
    Hey, just checking in. Everything good?
  </Say>
  <Record 
    maxLength="30" 
    playBeep="true"
    transcribe="true"
    transcribeCallback="${transcribeUrl}"
    recordingStatusCallback="${recordUrl}"
    recordingStatusCallbackEvent="completed"
    action="${baseUrl}/api/webhooks/recording-complete?sessionId=${sessionId}"
  />
</Response>`;
}

/**
 * Send SMS to emergency contact
 */
async function sendSMS(toPhone, message) {
  const client = getClient();
  const result = await client.messages.create({
    body: message,
    from: twilioPhone,
    to: toPhone,
  });
  return result.sid;
}

/**
 * Initiate outbound call (Level 2 escalation - call primary contact)
 */
async function initiateEmergencyCall(toPhone, sessionId, userPhone) {
  const client = getClient();
  const voiceUrl = `${baseUrl}/api/webhooks/emergency-call?sessionId=${sessionId}&userPhone=${encodeURIComponent(userPhone)}`;
  
  const call = await client.calls.create({
    to: toPhone,
    from: twilioPhone,
    url: voiceUrl,
    timeout: 30,
  });

  return call.sid;
}

/**
 * Generate TwiML for emergency call to primary contact
 */
function generateEmergencyCallTwiML(userPhone) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice" language="en-US">
    This is Guardian AI. We have received a distress signal from ${userPhone}. 
    Please check on them immediately. This is an automated emergency alert.
  </Say>
  <Pause length="2"/>
  <Say voice="alice" language="en-US">
    Again, please check on ${userPhone} immediately. Goodbye.
  </Say>
</Response>`;
}

module.exports = {
  getClient,
  initiateCheckInCall,
  generateVoiceTwiML,
  sendSMS,
  initiateEmergencyCall,
  generateEmergencyCallTwiML,
};
