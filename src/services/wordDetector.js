/**
 * Word Detection Logic
 * Normalizes text and checks for safe word, escalation word, or neither
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check if text contains the target word (exact or as whole word)
 * Handles partial matches for flexibility (e.g. "help" in "help me")
 */
function containsWord(text, word) {
  const normalized = normalizeText(text);
  const normalizedWord = normalizeText(word);
  if (!normalizedWord) return false;
  // Word boundary or substring for short responses
  const regex = new RegExp(`\\b${escapeRegex(normalizedWord)}\\b|${escapeRegex(normalizedWord)}`, 'i');
  return regex.test(normalized);
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Analyze user response
 * @returns {'safe' | 'escalate' | 'unknown'}
 */
function analyzeResponse(transcription, safeWord, escalationWord) {
  const normalized = normalizeText(transcription);

  // Check escalation first (safety priority)
  if (containsWord(normalized, escalationWord)) {
    return 'escalate';
  }

  // Check safe word
  if (containsWord(normalized, safeWord)) {
    return 'safe';
  }

  return 'unknown';
}

module.exports = {
  normalizeText,
  containsWord,
  analyzeResponse,
};
