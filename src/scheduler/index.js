/**
 * Job Scheduler - Triggers outbound Twilio calls at scheduled times
 *
 * Strategy: Run a cron job every minute. Query DB for sessions where
 * scheduled_at <= now and status = 'pending'. Trigger the call for each.
 *
 * Persistence: All data is in SQLite. On server restart, we simply
 * continue running the every-minute check. No in-memory state needed.
 */
const cron = require('node-cron');
const db = require('../db').db;
const { updateSessionStatus, logEvent } = require('../db');
const { initiateCheckInCall } = require('../services/twilio');

let isRunning = false;

/**
 * Check for due sessions and initiate calls
 */
async function checkDueSessions() {
  if (isRunning) return;
  isRunning = true;

  try {
    const all = db.prepare(`
      SELECT * FROM sessions WHERE status = 'pending' ORDER BY scheduled_at ASC
    `).all();
    const now = new Date();
    const due = all.filter((s) => new Date(s.scheduled_at) <= now);

    if (due.length > 0) {
      console.log('[Scheduler] Found', due.length, 'due session(s). Initiating calls.');
    }

    for (const session of due) {
      try {
        console.log('[Scheduler] Triggering call for session', session.id, 'to', session.user_phone);
        logEvent(session.id, 'call_initiated', { userPhone: session.user_phone });
        updateSessionStatus(session.id, 'active');
        await initiateCheckInCall(session.user_phone, session.id);
        logEvent(session.id, 'call_outbound_sent', { userPhone: session.user_phone });
      } catch (err) {
        console.error('[Scheduler] Failed to initiate check-in call:', session.id, err.message);
        logEvent(session.id, 'call_failed', { error: err.message });
        updateSessionStatus(session.id, 'pending');
      }
    }
  } finally {
    isRunning = false;
  }
}

/**
 * Start the scheduler - runs every minute
 */
function startScheduler() {
  cron.schedule('* * * * *', checkDueSessions);
  console.log('Scheduler started - checking for due sessions every minute');
  // Also run immediately on startup to catch any missed during downtime
  checkDueSessions();
}

/**
 * Add a new session - no need to "add" to scheduler; DB is the source of truth.
 * The every-minute cron will pick it up when due.
 */
function addSession(session) {
  const scheduledDate = new Date(session.scheduled_at);
  if (scheduledDate <= new Date()) {
    throw new Error('Scheduled time must be in the future');
  }
  // Session is already in DB; scheduler will pick it up
  return true;
}

module.exports = {
  startScheduler,
  addSession,
  checkDueSessions,
};
