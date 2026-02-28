/**
 * Database connection and helper functions
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '../../data/guardian.db');

// Ensure data dir exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Auto-initialize schema if tables don't exist (so server starts without running init-db)
const tableExists = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
).get();
if (!tableExists) {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  console.log('Database schema auto-initialized.');
}

/**
 * Create a new session
 */
function createSession({ id, userPhone, safeWord, escalationWord, scheduledAt, location = null }) {
  const stmt = db.prepare(`
    INSERT INTO sessions (id, user_phone, safe_word, escalation_word, scheduled_at, location, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')
  `);
  stmt.run(id, userPhone, safeWord, escalationWord, scheduledAt, location);
  return id;
}

/**
 * Add emergency contacts to a session
 */
function addEmergencyContacts(sessionId, contacts) {
  const stmt = db.prepare(`
    INSERT INTO emergency_contacts (session_id, phone_number, is_primary, display_order)
    VALUES (?, ?, ?, ?)
  `);
  const insertMany = db.transaction((contacts) => {
    contacts.forEach((c, i) => {
      stmt.run(sessionId, c.phone, c.isPrimary ? 1 : 0, i);
    });
  });
  insertMany(contacts);
}

/**
 * Get session by ID
 */
function getSession(sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) return null;
  const contacts = db.prepare('SELECT * FROM emergency_contacts WHERE session_id = ? ORDER BY is_primary DESC, display_order')
    .all(sessionId);
  return { ...session, contacts };
}

/**
 * Get all pending sessions (for scheduler on restart)
 */
function getPendingSessions() {
  return db.prepare(`
    SELECT * FROM sessions 
    WHERE status = 'pending' AND scheduled_at > datetime('now')
    ORDER BY scheduled_at ASC
  `).all();
}

/**
 * Update session status
 */
function updateSessionStatus(sessionId, status) {
  db.prepare(`
    UPDATE sessions SET status = ?, updated_at = datetime('now') WHERE id = ?
  `).run(status, sessionId);
}

/**
 * Update session location
 */
function updateSessionLocation(sessionId, location) {
  db.prepare(`
    UPDATE sessions SET location = ?, updated_at = datetime('now') WHERE id = ?
  `).run(location, sessionId);
}

/**
 * Log event
 */
function logEvent(sessionId, eventType, payload = null) {
  db.prepare(`
    INSERT INTO event_log (session_id, event_type, payload)
    VALUES (?, ?, ?)
  `).run(sessionId, eventType, payload ? JSON.stringify(payload) : null);
}

/**
 * Get primary contact for a session
 */
function getPrimaryContact(sessionId) {
  const c = db.prepare(`
    SELECT * FROM emergency_contacts WHERE session_id = ? AND is_primary = 1 LIMIT 1
  `).get(sessionId);
  if (c) return c;
  return db.prepare(`
    SELECT * FROM emergency_contacts WHERE session_id = ? ORDER BY display_order LIMIT 1
  `).get(sessionId);
}

/**
 * Get all emergency contacts for a session
 */
function getEmergencyContacts(sessionId) {
  return db.prepare(`
    SELECT * FROM emergency_contacts WHERE session_id = ? ORDER BY is_primary DESC, display_order
  `).all(sessionId);
}

module.exports = {
  db,
  createSession,
  addEmergencyContacts,
  getSession,
  getPendingSessions,
  updateSessionStatus,
  updateSessionLocation,
  logEvent,
  getPrimaryContact,
  getEmergencyContacts,
};
