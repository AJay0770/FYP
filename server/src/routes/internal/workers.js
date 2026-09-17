const express = require('express');
const router = express.Router();
const prisma = require('../../utils/prisma');
const internalAuth = require('../../middleware/internalAuth');

/**
 * GET /api/internal/workers?projectId=... | ?cameraId=...
 *
 * Returns enrolled workers and their stored face embeddings for one project,
 * so the AI service can match a live face against them without needing its
 * own database access. Consumed by services/attendance_detector.py (via
 * projectId) and safety_stream.py's per-worker violation attribution (via
 * cameraId, since a camera worker only ever knows its own camera id, not the
 * project it belongs to).
 *
 * Internal-only: this returns biometric data (faceEmbedding) that must never
 * be reachable with a normal user JWT.
 */
router.get('/workers', internalAuth, async (req, res) => {
  try {
    const { projectId: rawProjectId, cameraId } = req.query;
    let projectId = rawProjectId;

    if (!projectId && cameraId) {
      const camera = await prisma.camera.findUnique({
        where: { id: String(cameraId) },
        select: { projectId: true },
      });
      if (!camera) {
        return res.status(404).json({ error: 'Camera not found' });
      }
      projectId = camera.projectId;
    }

    if (!projectId) {
      return res.status(400).json({ error: 'projectId or cameraId is required' });
    }

    const workers = await prisma.worker.findMany({
      where: { projectId: String(projectId), faceEmbedding: { not: null } },
      select: { id: true, name: true, employeeId: true, faceEmbedding: true },
    });

    // faceEmbedding is stored as a JSON string; parse it here so callers get
    // a real array, matching what attendance_detector.py's numpy conversion expects.
    const parsed = workers.map((w) => ({
      ...w,
      faceEmbedding: JSON.parse(w.faceEmbedding),
    }));

    res.json(parsed);
  } catch (err) {
    console.error('Internal workers lookup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
