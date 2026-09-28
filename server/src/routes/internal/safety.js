const express = require('express');
const router = express.Router();
const prisma = require('../../utils/prisma');
const internalAuth = require('../../middleware/internalAuth');
const { uploadBuffer } = require('../../utils/s3');
const { getIO } = require('../../sockets/io');

// Cooldown window and keying are explained in utils/alertCooldowns.js.
const { COOLDOWN_MS, lastAlertAt, cooldownKey: makeCooldownKey } = require('../../utils/alertCooldowns');

const VIOLATION_TYPES = ['NO_HELMET', 'NO_VEST'];
const MAX_FRAME_BYTES = 10 * 1024 * 1024; // 10MB decoded

// POST /api/internal/safety-alert
router.post('/safety-alert', internalAuth, async (req, res) => {
  try {
    const { cameraId, workerId, violationType, confidence, frameImageBase64 } = req.body;

    // workerId is optional: without it the violation is recorded as
    // unidentified (a bare head the AI service could not match to an
    // enrolled worker - see ALERT_UNIDENTIFIED_VIOLATIONS in safety_stream.py).
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

    // When a worker is named, it must be a real, enrolled worker in *this*
    // camera's project - never a bare id string the caller supplied, and
    // never a worker from another project.
    if (workerId) {
      const worker = await prisma.worker.findUnique({ where: { id: workerId } });
      if (!worker || worker.projectId !== camera.projectId) {
        return res.status(404).json({ error: 'Worker not found for this camera\'s project' });
      }
    }

    const cooldownKey = makeCooldownKey(cameraId, workerId, violationType);
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

      // The alert row is the auditable record and feeds analytics; the frame
      // is supporting evidence. If object storage is down, keep the violation
      // (without an image) rather than failing the request and losing it.
      try {
        const upload = await uploadBuffer(buffer, `alert-${violationType.toLowerCase()}.jpg`, 'image/jpeg');
        frameImageUrl = upload.url;
      } catch (uploadErr) {
        // A refused connection is an AggregateError with an empty message.
        console.error(
          'Safety alert frame upload failed; saving alert without image:',
          uploadErr.message || uploadErr.code || uploadErr.name
        );
      }
    }

    const alert = await prisma.safetyAlert.create({
      data: {
        projectId: camera.projectId,
        cameraId,
        workerId: workerId || null,
        violationType,
        confidenceScore: score,
        frameImageUrl,
      },
      include: {
        camera: { select: { id: true, name: true, zone: true } },
        worker: { select: { id: true, name: true, employeeId: true } },
      },
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
