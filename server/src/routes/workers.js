const express = require('express');
const router = express.Router({ mergeParams: true });
const axios = require('axios');
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { isEngineerAssigned } = require('../utils/projectAccess');

const AI_SERVICE_URL = process.env.PYTHON_AI_SERVICE_URL || 'http://localhost:8000';
const ENROLL_TIMEOUT_MS = 120_000; // embedding several photos is slow

// POST /api/projects/:id/workers/enroll (ADMIN, or ENGINEER assigned to project)
router.post('/enroll', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { name, employeeId, photos } = req.body;

    if (!name || !employeeId || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'name, employeeId, and a non-empty photos array are required' });
    }

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    let embedding;
    try {
      const response = await axios.post(
        `${AI_SERVICE_URL}/enroll`,
        { photos },
        {
          timeout: ENROLL_TIMEOUT_MS,
          headers: { 'X-Internal-Token': process.env.X_INTERNAL_TOKEN },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
        }
      );
      embedding = response.data?.embedding;
    } catch (err) {
      const detail = err.response?.data?.detail || err.message;
      console.error('AI enrolment call failed:', detail);
      // 503: the AI service, not this request, is what failed.
      return res.status(503).json({ error: `Face enrolment service unavailable: ${detail}` });
    }

    if (!Array.isArray(embedding) || embedding.length === 0) {
      return res.status(502).json({ error: 'AI service returned no usable embedding' });
    }

    const worker = await prisma.worker.create({
      data: {
        projectId,
        name,
        employeeId,
        faceEmbedding: JSON.stringify(embedding),
      },
    });

    // Never return the raw embedding — it is biometric data and the client has
    // no use for it.
    const { faceEmbedding, ...safeWorker } = worker;
    res.status(201).json({ ...safeWorker, embeddingDimensions: embedding.length });
  } catch (err) {
    console.error('Enroll worker error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/workers (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { userHasProjectAccess } = require('../utils/projectAccess');

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) return res.status(404).json({ error: 'Project not found' });

    const workers = await prisma.worker.findMany({
      where: { projectId },
      select: { id: true, name: true, employeeId: true, enrolledAt: true },
      orderBy: { enrolledAt: 'desc' },
    });

    res.json(workers);
  } catch (err) {
    console.error('Get workers error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
