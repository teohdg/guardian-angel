// run with node scripts/clearDue.js
const { db } = require('../src/db');

console.log('Updating pending sessions to completed...');
const res = db.prepare("UPDATE sessions SET status='completed' WHERE status='pending' AND scheduled_at <= datetime('now')").run();
console.log('Rows updated:', res.changes);
process.exit(0);
