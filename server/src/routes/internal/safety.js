const express = require('express');
const router = express.Router();
const prisma = require('../../utils/prisma');
const internalAuth = require('../../middleware/internalAuth');
const { uploadBuffer } = require('../../utils/s3');
const { getIO } = require('../../sockets/io');

const VIOLATION_TYPES = ['NO_HELMET', 'NO_VEST'];
const COOLDOWN_MS = 60_000;
const MAX_FRAME_BYTES = 10 * 1024 * 1024; // 10MB decoded

/**
 * Cooldown keyed by `${cameraId}:${violationType}`.
 *
 * In-memory as specified. Two consequences worth knowing:
 *  - a server restart clears it, so one duplicate alert can slip through
 *  - it is per-process, so multiple instances behind a load balancer each keep
 *    their own window
 * Move to Redis if either matters.
 */
const lastAlertAt = new Map();

// Stop the map growing without bound on a long-running server with many cameras.
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [key, timestamp] of lastAlertAt) {
    if (timestamp < cutoff) lastAlertAt.delete(key);
  }
}, 5 * 60_000).unref();

// POST /api/internal/safety-alert
router.post('/safety-alert', internalAuth, async (req, res) => {
  try {
    const { cameraId, violationType, confidence, frameImageBase64 } = req.body;

    if (!cameraId || !violationType || confidence === undefined) {
      return res.status(400).json({ error: 'cameraId, violationType, and confidence are required' });
    }

    if (!VIOLATION_TYPES.includes(violationType)) {
      return res.status(400).json({ error: `violationType must be one of: ${VIOLATION_TYPES.join(', ')}` });
    }

    const score = Number(confidence);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return res.status(400).json({ error: 'confidence must be a number between 0 and 1' });
    }

    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    const cooldownKey = `${cameraId}:${violationType}`;
    const previous = lastAlertAt.get(cooldownKey);
    const now = Date.now();

    if (previous && now - previous < COOLDOWN_MS) {
      return res.status(202).json({
        suppressed: true,
        reason: 'cooldown',
        retryAfterMs: COOLDOWN_MS - (now - previous),
      });
    }

    // Claim the cooldown slot before the slow work below, so two near-simultaneous
    // alerts can't both pass the check and produce duplicate records.
    lastAlertAt.set(cooldownKey, now);

    let frameImageUrl = '';
    if (frameImageBase64) {
      const base64 = frameImageBase64.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64, 'base64');

      if (buffer.length === 0) {
        lastAlertAt.delete(cooldownKey);
        return res.status(400).json({ error: 'frameImageBase64 is not valid base64' });
      }
      if (buffer.length > MAX_FRAME_BYTES) {
        lastAlertAt.delete(cooldownKey);
        return res.status(413).json({ error: 'Frame image too large' });
      }

      const upload = await uploadBuffer(buffer, `alert-${violationType.toLowerCase()}.jpg`, 'image/jpeg');
      frameImageUrl = upload.url;
    }

    const alert = await prisma.safetyAlert.create({
      data: {
        projectId: camera.projectId,
        cameraId,
        violationType,
        confidenceScore: score,
        frameImageUrl,
      },
      include: { camera: { select: { id: true, name: true, zone: true } } },
    });

    const io = getIO();
    if (io) {
      io.to(`project:${camera.projectId}`).emit('safety:alert', alert);
    }

    res.status(201).json(alert);
  } catch (err) {
    console.error('Safety alert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
