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

module.exports = {
  classifyDistressIntent,
  DISTRESS_THRESHOLD,
};
