require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const socketIo = require('socket.io');
const cookieParser = require('cookie-parser');
const { initSockets } = require('./sockets');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

initSockets(io);

// Middleware
app.use(cookieParser());
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true
}));
// Alert frames arrive as base64 JSON, so the default 100kb body limit is too small.
// `verify` stashes the raw bytes on the request: webhook signature verification
// must hash exactly what the provider sent, and re-serialising the parsed object
// (key order, whitespace, unicode escaping) would produce a different digest.
app.use(
  express.json({
    limit: '15mb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/projects/:id/updates', require('./routes/updates'));
app.use('/api/projects/:id/materials', require('./routes/materials'));
app.use('/api/projects/:id/chat', require('./routes/chat'));
app.use('/api/projects/:id/cameras', require('./routes/cameras'));
app.use('/api/projects/:id/safety-alerts', require('./routes/safety'));
app.use('/api/projects/:id/workers', require('./routes/workers'));
app.use('/api/projects/:id/attendance', require('./routes/attendance'));
app.use('/api/projects/:id/analytics', require('./routes/analytics'));
app.use('/api/projects/:id/reports', require('./routes/reports'));

// Camera streaming/recording are addressed by camera id, not nested under project.
app.use('/api/cameras', require('./routes/cameraStream'));
app.use('/api/cameras', require('./routes/cameraClips'));

// AI safety detection: annotated stream + live detections. Mounted at /api so the
// paths read /api/stream/safety and /api/detections/latest — these are about the
// detector, not about one camera resource, and take ?cameraId= instead.
const safetyDetection = require('./routes/safetyDetection');
app.use('/api', safetyDetection.router);

// Service-to-service endpoints (AI service -> API), guarded by X-Internal-Token.
app.use('/api/internal', require('./routes/internal/safety'));
app.use('/api/internal', require('./routes/internal/attendance'));
app.use('/api/internal', safetyDetection.internalRouter);

// Billing
app.use('/api/billing', require('./routes/billing'));
app.use('/api/billing/webhook', require('./routes/webhooks/easypaisa'));

// Resolve the ffmpeg RTSP timeout flag name once, before any stream is requested.
require('./utils/ffmpeg')
  .detectTimeoutFlag()
  .catch((err) => console.error('ffmpeg probe failed:', err.message));

// Scheduled report generation. Opt-out via DISABLE_CRON=true so short-lived
// processes (tests, one-off scripts) don't hold the event loop open.
if (process.env.DISABLE_CRON !== 'true') {
  require('./jobs/reportCron').registerReportJobs();
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

module.exports = { app, io, server };
