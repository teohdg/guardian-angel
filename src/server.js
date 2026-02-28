/**
 * Guardian AI - Main Server
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rateLimit = require('express-rate-limit');
const apiRoutes = require('./routes/api');
const webhookRoutes = require('./routes/webhooks');
const { startScheduler } = require('./scheduler');

const PORT = process.env.PORT || 3000;
const app = express();

// Optional: serve index.html at / so http://localhost:3000/ works
const publicPath = path.join(__dirname, '../public');

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Trust proxy (ngrok adds X-Forwarded-For headers)
app.set('trust proxy', 1);

// Rate limiting - protect against abuse
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: { error: 'Too many requests, please try again later.' },
});
app.use('/api/', apiLimiter);

// Webhooks: Twilio sends form-urlencoded, need higher limit for callbacks
const webhookLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 200,
});
app.use('/api/webhooks', webhookLimiter);

// --- Routes ---
app.use('/api/webhooks', webhookRoutes);
app.use('/api', apiRoutes);


// Static frontend (index.html at / and other files)
app.use(express.static(publicPath));

// Location submission form
app.get('/location', (req, res) => {
  res.sendFile(path.join(publicPath, 'location.html'));
});

app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// --- Start ---
try {
  startScheduler();
} catch (err) {
  console.error('Scheduler warning (server still starting):', err.message);
}

// Warn if Twilio webhooks will fail (Twilio cannot reach localhost)
const baseUrl = process.env.BASE_URL || '';
if (baseUrl.includes('localhost') || !baseUrl) {
  console.warn(
    '\n*** WARNING: BASE_URL is localhost or unset. Outbound calls may be created but will fail when answered because Twilio cannot fetch your voice URL. Use ngrok: run "ngrok http ' + PORT + '" then set BASE_URL to the ngrok URL in .env ***\n'
  );
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Guardian AI server running on http://localhost:${PORT}`);
  if (!baseUrl.includes('localhost')) {
    console.log('Webhooks BASE_URL:', baseUrl);
  }
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try another port: PORT=3001 npm start`);
  } else {
    console.error('Server failed to start:', err.message);
  }
  process.exit(1);
});
