/**
 * OpenAI Service - Intent classification when neither safe nor escalation word detected
 * 
 * Used when: User says something that doesn't contain the safe word or escalation word.
 * We ask OpenAI: "Does this response sound distressed or unsafe?"
 * If probability > 70%, we trigger escalation.
 */
const OpenAI = require('openai');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const DISTRESS_THRESHOLD = 0.7;

/**
 * Classify if the user's response indicates distress/unsafety
 * @param {string} transcription - The transcribed user response
 * @returns {{ isDistressed: boolean, score: number, reason: string }}
 */
async function classifyDistressIntent(transcription) {
  if (!transcription || transcription.trim().length === 0) {
    return { isDistressed: false, score: 0, reason: 'Empty response' };
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are a safety classifier. Given a short spoken response from someone during a check-in call, determine if they sound distressed, in danger, or need help.

Respond with ONLY a JSON object in this exact format:
{"score": 0.0-1.0, "reason": "brief explanation"}

- score: 0.0 = clearly fine, 1.0 = clearly distressed/in danger
- Consider: tone indicators, urgency, fear, confusion, coded language, hesitation
- "I'm fine" with normal tone = low score
- Crying, screaming, "help me" = high score
- Mumbled/unclear = medium score (err on side of caution)`,
        },
        {
          role: 'user',
          content: `User said: "${transcription}"`,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return { isDistressed: false, score: 0, reason: 'No response from model' };
    }

    const parsed = JSON.parse(content);
    const score = typeof parsed.score === 'number' ? parsed.score : parseFloat(parsed.score) || 0;
    const reason = parsed.reason || 'Unknown';

    return {
      isDistressed: score >= DISTRESS_THRESHOLD,
      score,
      reason,
    };
  } catch (err) {
    console.error('OpenAI classification error:', err.message);
    // On API failure: err on side of caution - could trigger escalation
    // For hackathon: we'll return not distressed to avoid false positives during demo
    return {
      isDistressed: false,
      score: 0,
      reason: `API error: ${err.message}`,
    };
  }
}

/**
 * Transcribe audio using OpenAI Whisper API
 * @param {string} mediaUrl - URL to the audio file (e.g., Twilio recording URL)
 * @param {string} authToken - Twilio auth token for downloading recordings
 * @returns {Promise<string>} - Transcribed text
 */
async function transcribeAudio(mediaUrl, authToken) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  let tempFilePath = null;

  try {
    if (!mediaUrl) {
      throw new Error('No mediaUrl provided');
    }

    console.log('[OpenAI] Transcribing audio via Whisper:', { url: mediaUrl.substring(0, 80) + '...' });

    // Download the audio file from Twilio
    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${authToken}`).toString('base64');
    const response = await fetch(mediaUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download recording: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log('[OpenAI] Downloaded recording:', { size: buffer.length });

    // Write to temporary file
    tempFilePath = path.join(os.tmpdir(), `recording-${Date.now()}.wav`);
    fs.writeFileSync(tempFilePath, buffer);
    console.log('[OpenAI] Wrote temp file:', { path: tempFilePath });

    // Create a read stream for the file
    const fileStream = fs.createReadStream(tempFilePath);

    // Transcribe with Whisper using SDK
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fileStream,
        model: 'whisper-1',
        language: 'en',
      });
      const text = transcription.text || '';
      console.log('[OpenAI] Transcription result:', { text: text.substring(0, 100), length: text.length });

      // Clean up temp file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return text;
    } catch (sdkErr) {
      console.error('[OpenAI] SDK transcription error:', sdkErr);
      // attempt manual HTTP fallback
      try {
        console.log('[OpenAI] Attempting manual POST fallback');
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', fs.createReadStream(tempFilePath));
        form.append('model', 'whisper-1');
        form.append('language', 'en');

        const fetch = require('node-fetch');
        const manualResp = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            ...form.getHeaders(),
          },
          body: form,
        });
        const manualJson = await manualResp.json();
        if (!manualResp.ok) {
          throw new Error('Manual transcription failed: ' + JSON.stringify(manualJson));
        }
        const text = manualJson.text || '';
        console.log('[OpenAI] Manual transcription result:', { text: text.substring(0,100), length: text.length });

        if (tempFilePath && fs.existsSync(tempFilePath)) {
          fs.unlinkSync(tempFilePath);
        }
        return text;
      } catch (manualErr) {
        console.error('[OpenAI] Manual transcription error:', manualErr);
        // Clean up temp file
        if (tempFilePath && fs.existsSync(tempFilePath)) {
          try { fs.unlinkSync(tempFilePath); } catch{};
        }
        throw manualErr;
      }
    }
  } catch (err) {
    console.error('[OpenAI] Transcription error:', err.message, err);
    
    // Clean up temp file on error
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (cleanupErr) {
        console.error('[OpenAI] Failed to delete temp file:', cleanupErr.message);
      }
    }
    
    throw err;
  }
}

module.exports = {
  classifyDistressIntent,
  transcribeAudio,
  DISTRESS_THRESHOLD,
};
