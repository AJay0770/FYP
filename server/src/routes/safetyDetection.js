/**
 * Safety detection: annotated live stream + current detections.
 *
 *   GET  /api/stream/safety          MJPEG with YOLOv8 boxes drawn on it
 *   GET  /api/detections/latest      JSON: live detections, counts, recent alerts
 *   POST /api/internal/detections    AI service -> API push (internal token)
 *
 * Where the work happens: decoding, inference and drawing all live in the Python
 * service (ai-service/safety_stream.py). This module is the authenticated,
 * project-scoped door to it. Doing it this way means the browser never learns a
 * camera URL or credentials, access control stays in one place (the same
 * `userHasProjectAccess` used by every other route), and the AI service can stay
 * bound to localhost.
 *
 * Contrast with /api/cameras/:id/stream, which relays the RAW camera via ffmpeg
 * and has no detection in the path. Both exist on purpose: raw is cheap and
 * always available, annotated needs the model.
 *
 * Camera sources are not restricted to RTSP - see utils/cameraSource.js.
 */

const express = require('express');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const router = express.Router();
const internalRouter = express.Router();

const prisma = require('../utils/prisma');
const internalAuth = require('../middleware/internalAuth');
const { authenticateToken, authenticateTokenAllowQuery } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { classifySource, isWellFormed } = require('../utils/cameraSource');
const { getIO } = require('../sockets/io');

const AI_SERVICE_URL = (
  process.env.SAFETY_STREAM_URL || `http://127.0.0.1:${process.env.STREAM_PORT || 8554}`
).replace(/\/$/, '');

// Fallback source for local development, when no Camera row exists yet. Only
// ADMIN/ENGINEER may use it: it is not tied to a project, so it cannot be
// access-checked the way a registered camera can.
const DEFAULT_SOURCE = process.env.CAMERA_SOURCE || '';

const DETECTIONS_TIMEOUT_MS = 8000;
const STREAM_CONNECT_TIMEOUT_MS = 15000;
const ALERT_HISTORY_LIMIT = 10;
// Beyond this a pushed snapshot is treated as stale and the AI service is asked
// directly, so a crashed detector cannot leave the dashboard showing old boxes.
const SNAPSHOT_TTL_MS = 10_000;

/**
 * Most recent detection snapshot per camera, pushed by the AI service.
 *
 * In-memory and per-process, like the alert cooldown in routes/internal/safety.js:
 * it is a cache of live state, never a record. Anything that must survive a
 * restart is written to the database as a SafetyAlert.
 */
const latestDetections = new Map();

setInterval(() => {
  const cutoff = Date.now() - SNAPSHOT_TTL_MS * 6;
  for (const [cameraId, snapshot] of latestDetections) {
    if (snapshot.receivedAt < cutoff) latestDetections.delete(cameraId);
  }
}, 60_000).unref();

// --------------------------------------------------------------------------
// Shared resolution: which camera, and is the caller allowed to see it?
// --------------------------------------------------------------------------

/**
 * Resolves ?cameraId= (preferred) or falls back to the configured dev source.
 * Returns { error, status } instead of throwing so both handlers can respond
 * in their own format (JSON vs. a stream that has not started yet).
 */
async function resolveTarget(req) {
  const cameraId = req.query.cameraId;

  if (cameraId) {
    let camera;
    try {
      camera = await prisma.camera.findUnique({ where: { id: String(cameraId) } });
    } catch (err) {
      console.error('Safety detection camera lookup failed:', err);
      return { status: 500, error: 'Internal server error' };
    }

    if (!camera) return { status: 404, error: 'Camera not found' };

    const hasAccess = await userHasProjectAccess(camera.projectId, req.user);
    // 404 rather than 403: a user with no access should not learn the id exists.
    if (!hasAccess) return { status: 404, error: 'Camera not found' };

    const classified = classifySource(camera.rtspUrl);
    if (!isWellFormed(classified.source)) {
      return { status: 422, error: 'Camera source is malformed' };
    }
    if (!classified.safe) {
      return { status: 422, error: `Camera source rejected: ${classified.reason}` };
    }

    return { camera, projectId: camera.projectId, ...classified };
  }

  if (!DEFAULT_SOURCE) {
    return {
      status: 400,
      error: 'cameraId is required (no CAMERA_SOURCE fallback is configured)',
    };
  }

  if (req.user.role !== 'ADMIN' && req.user.role !== 'ENGINEER') {
    return { status: 403, error: 'cameraId is required for this role' };
  }

  const classified = classifySource(DEFAULT_SOURCE);
  if (!classified.safe || !isWellFormed(classified.source)) {
    return { status: 500, error: 'CAMERA_SOURCE is misconfigured on the server' };
  }
  return { camera: null, projectId: null, ...classified };
}

function aiServiceUrl(path, params) {
  const url = new URL(path, AI_SERVICE_URL);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

// --------------------------------------------------------------------------
// GET /api/stream/safety
// --------------------------------------------------------------------------

/**
 * Annotated MJPEG, viewable directly in an <img src>.
 *
 * Auth note (same trade-off as /api/cameras/:id/stream): a browser cannot set an
 * Authorization header on an <img>, so the token may arrive as ?token=. That puts
 * it in access logs and history; production should issue a short-lived,
 * stream-scoped token instead of the session access token.
 *
 * Query: cameraId (preferred), annotate=0 to get the raw feed back.
 */
router.get('/stream/safety', authenticateTokenAllowQuery, async (req, res) => {
  const target = await resolveTarget(req);
  if (target.error) {
    return res.status(target.status).json({ error: target.error });
  }

  const upstream = aiServiceUrl('/stream', {
    source: target.source,
    cameraId: target.camera?.id,
    annotate: req.query.annotate === '0' ? 'false' : 'true',
  });

  const client = upstream.protocol === 'https:' ? https : http;
  let settled = false;

  const proxyReq = client.request(
    upstream,
    { method: 'GET', timeout: STREAM_CONNECT_TIMEOUT_MS },
    (proxyRes) => {
      settled = true;

      // The AI service answers JSON on failure (no such camera, too many
      // workers). Forward that verbatim rather than opening a broken stream.
      if (proxyRes.statusCode !== 200) {
        const chunks = [];
        proxyRes.on('data', (c) => chunks.length < 20 && chunks.push(c));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8').slice(0, 500);
          console.error(
            `Safety stream upstream ${proxyRes.statusCode} for camera ${target.camera?.id ?? 'default'}: ${body}`
          );
          if (!res.headersSent) {
            res.status(502).json({
              error: 'Detection service could not start the stream',
              upstreamStatus: proxyRes.statusCode,
            });
          } else {
            res.end();
          }
        });
        return;
      }

      res.writeHead(200, {
        'Content-Type':
          proxyRes.headers['content-type'] || 'multipart/x-mixed-replace; boundary=buildsite360frame',
        'Cache-Control': 'no-store, no-cache, must-revalidate',
        Pragma: 'no-cache',
        Connection: 'close',
      });

      proxyRes.pipe(res);

      proxyRes.on('error', (err) => {
        console.error('Safety stream upstream error:', err.message);
        res.end();
      });

      if (target.camera) {
        // Frames are flowing, so the camera is reachable. Fire-and-forget: a
        // status write must never delay the stream.
        prisma.camera
          .update({ where: { id: target.camera.id }, data: { status: 'ONLINE' } })
          .catch((err) => console.error('Camera status update failed:', err.message));
      }
    }
  );

  proxyReq.on('timeout', () => {
    proxyReq.destroy(new Error('timed out connecting to the detection service'));
  });

  proxyReq.on('error', (err) => {
    if (settled) return;
    settled = true;
    console.error(`Safety stream proxy error (${AI_SERVICE_URL}):`, err.message);
    if (!res.headersSent) {
      const refused = err.code === 'ECONNREFUSED';
      res.status(refused ? 503 : 502).json({
        error: refused
          ? 'Detection service is not running. Start it with: python safety_stream.py'
          : 'Detection service error',
      });
    } else {
      res.end();
    }
  });

  // Viewer closed the tab: tear the upstream connection down so the AI service
  // stops encoding for a client that is gone.
  const cleanup = () => proxyReq.destroy();
  req.on('close', cleanup);
  res.on('close', cleanup);

  proxyReq.end();
});

// --------------------------------------------------------------------------
// GET /api/detections/latest
// --------------------------------------------------------------------------

/**
 * Current detections for one camera, plus the alerts that were persisted from
 * them. Serves the last pushed snapshot when it is fresh, otherwise asks the AI
 * service directly.
 *
 * Always 200 when the caller is authorised: an unreachable AI service is
 * reported as `aiService.available = false` with the reason, so the dashboard
 * can show the database-backed alert history instead of an empty error page.
 */
router.get('/detections/latest', authenticateToken, async (req, res) => {
  const target = await resolveTarget(req);
  if (target.error) {
    return res.status(target.status).json({ error: target.error });
  }

  const cameraId = target.camera?.id ?? null;
  const cached = cameraId ? latestDetections.get(cameraId) : null;
  const cacheIsFresh = cached && Date.now() - cached.receivedAt < SNAPSHOT_TTL_MS;

  let snapshot = cacheIsFresh ? cached.snapshot : null;
  let aiService = { available: true, source: cacheIsFresh ? 'push' : 'fetch', url: AI_SERVICE_URL };

  if (!snapshot) {
    const url = aiServiceUrl('/detections/latest', { source: target.source, cameraId });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DETECTIONS_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (response.ok) {
        snapshot = await response.json();
      } else {
        aiService = {
          available: false,
          url: AI_SERVICE_URL,
          error: `detection service returned HTTP ${response.status}`,
        };
      }
    } catch (err) {
      const aborted = err.name === 'AbortError';
      aiService = {
        available: false,
        url: AI_SERVICE_URL,
        error: aborted
          ? `detection service did not respond within ${DETECTIONS_TIMEOUT_MS}ms`
          : 'detection service is not running (start it with: python safety_stream.py)',
      };
      console.error('detections/latest upstream failed:', err.message);
    } finally {
      clearTimeout(timer);
    }
  }

  // Persisted alerts come from the database regardless of AI service health -
  // that history is the auditable record, the live snapshot is not.
  let alerts = [];
  try {
    if (target.projectId) {
      alerts = await prisma.safetyAlert.findMany({
        where: { projectId: target.projectId, ...(cameraId ? { cameraId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: ALERT_HISTORY_LIMIT,
        include: { camera: { select: { id: true, name: true, zone: true } } },
      });
    }
  } catch (err) {
    console.error('Failed to load recent safety alerts:', err);
  }

  res.json({
    cameraId,
    camera: target.camera
      ? { id: target.camera.id, name: target.camera.name, zone: target.camera.zone, status: target.camera.status }
      : null,
    sourceType: target.type,
    aiService,
    detections: snapshot?.detections ?? [],
    counts: snapshot?.counts ?? { hardhat: 0, construction_worker: 0, ppe: 0, no_ppe: 0 },
    hazardCount: snapshot?.hazardCount ?? 0,
    frameSize: snapshot?.frameSize ?? null,
    modelLoaded: snapshot?.modelLoaded ?? false,
    modelError: snapshot?.modelError ?? null,
    connected: snapshot?.connected ?? false,
    stats: snapshot
      ? {
          framesRead: snapshot.framesRead,
          inferences: snapshot.inferences,
          alertsSent: snapshot.alertsSent,
          alertsSuppressed: snapshot.alertsSuppressed,
          classTotals: snapshot.classTotals,
          uptimeSeconds: snapshot.uptimeSeconds,
        }
      : null,
    alerts,
    fetchedAt: new Date().toISOString(),
  });
});

// --------------------------------------------------------------------------
// POST /api/internal/detections  (AI service -> API)
// --------------------------------------------------------------------------

/**
 * Optional live push from the AI service, so the browser sees detection counts
 * without polling. Violations still go through /api/internal/safety-alert:
 * that endpoint owns cooldown, S3 upload and the database write. This one only
 * updates the in-memory snapshot and fans it out over Socket.io.
 */
internalRouter.post('/detections', internalAuth, async (req, res) => {
  try {
    const { cameraId, detections, counts, hazardCount, modelLoaded, connected, frameSize } = req.body || {};

    if (!cameraId) {
      return res.status(400).json({ error: 'cameraId is required' });
    }
    if (detections !== undefined && !Array.isArray(detections)) {
      return res.status(400).json({ error: 'detections must be an array' });
    }

    const camera = await prisma.camera.findUnique({
      where: { id: String(cameraId) },
      select: { id: true, projectId: true, name: true, zone: true },
    });
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    const snapshot = {
      detections: detections ?? [],
      counts: counts ?? {},
      hazardCount: hazardCount ?? (detections ?? []).filter((d) => d && d.hazard).length,
      modelLoaded: Boolean(modelLoaded),
      connected: Boolean(connected),
      frameSize: frameSize ?? null,
    };

    latestDetections.set(camera.id, { snapshot, receivedAt: Date.now() });

    const io = getIO();
    if (io) {
      io.to(`project:${camera.projectId}`).emit('safety:detections', {
        cameraId: camera.id,
        cameraName: camera.name,
        zone: camera.zone,
        ...snapshot,
        at: new Date().toISOString(),
      });
    }

    res.status(202).json({ accepted: true });
  } catch (err) {
    console.error('Detection push error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, internalRouter, latestDetections };
