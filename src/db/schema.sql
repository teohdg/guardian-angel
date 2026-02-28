-- Guardian AI Database Schema
-- SQLite - stores users, sessions, contacts, and event logs

-- Sessions: Each "Activate" creates a session with scheduled check-in
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_phone TEXT NOT NULL,
    safe_word TEXT NOT NULL,
    escalation_word TEXT NOT NULL,
    location TEXT,                        -- Optional user location for emergency alerts
    scheduled_at TEXT NOT NULL,           -- ISO 8601 datetime
    status TEXT DEFAULT 'pending',       -- pending, active, completed, escalated, cancelled
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Emergency contacts for each session
CREATE TABLE IF NOT EXISTS emergency_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,         -- 1 = primary contact (for Level 2 escalation)
    display_order INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- Event log: All system events for audit trail
CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    event_type TEXT NOT NULL,             -- call_initiated, recording_complete, transcription_received, safe_word_detected, escalation_triggered, sms_sent, etc.
    payload TEXT,                         -- JSON details
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_contacts_session ON emergency_contacts(session_id);
CREATE INDEX IF NOT EXISTS idx_event_log_session ON event_log(session_id);
