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
 */
function generateVoiceTwiML(sessionId) {
  if (!baseUrl || baseUrl.includes('localhost')) {
    console.error('[TwiML] ERROR: baseUrl is not configured properly', { baseUrl });
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Error: Server is not configured for Twilio. BASE_URL must be set to a public URL.</Say></Response>';
  }

  const recordUrl = `${baseUrl}/api/webhooks/recording-complete?sessionId=${sessionId}`;

  // Compact, single-line TwiML to avoid whitespace parsing issues
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">Hey, just checking in. Everything good?</Say><Record maxLength="30" playBeep="true" finishOnKey="#" transcribe="true" action="${recordUrl}"/></Response>`;

  console.log('[TwiML] Generated voice TwiML:', { sessionId, baseUrl, urlLength: recordUrl.length, twimlLength: twiml.length });
  return twiml;
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
 * @param {string} toPhone - Emergency contact phone number
 * @param {string} sessionId - Session ID
 * @param {string} userPhone - Original caller's phone number
 */
async function initiateEmergencyCall(toPhone, sessionId, userPhone) {
  const client = getClient();
  // Location will be retrieved from database in the webhook
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
 * @param {string} userPhone - Original caller's phone number
 * @param {string} location - Optional location information
 */
function generateEmergencyCallTwiML(userPhone, location = null) {
  // Read phone number digit by digit by adding spaces between digits
  const phoneDigits = String(userPhone).replace(/\D/g, '').split('').join(' ');
  const locationMsg = location ? `Their location is ${location}. ` : '';
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="en-US">This is Guardian AI. We have received a distress signal from ${phoneDigits}. Please check on them immediately. ${locationMsg}This is an automated emergency alert.</Say><Pause length="2"/><Say voice="alice" language="en-US">Again, please check on ${phoneDigits} immediately. Goodbye.</Say></Response>`;
}

module.exports = {
  getClient,
  initiateCheckInCall,
  generateVoiceTwiML,
  sendSMS,
  initiateEmergencyCall,
  generateEmergencyCallTwiML,
};
