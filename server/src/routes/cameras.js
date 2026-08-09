const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { isEngineerAssigned, userHasProjectAccess } = require('../utils/projectAccess');

const ZONES = ['ENTRANCE', 'WORK_AREA', 'STORAGE'];

// POST /api/projects/:id/cameras (ADMIN, or ENGINEER assigned to the project)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { name, zone, rtspUrl } = req.body;

    if (!name || !zone || !rtspUrl) {
      return res.status(400).json({ error: 'name, zone, and rtspUrl are required' });
    }

    if (!ZONES.includes(zone)) {
      return res.status(400).json({ error: `zone must be one of: ${ZONES.join(', ')}` });
    }

    if (req.user.role === 'ADMIN') {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: 'Project not found' });
    } else if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const camera = await prisma.camera.create({
      data: { projectId, name, zone, rtspUrl },
    });

    res.status(201).json(camera);
  } catch (err) {
    console.error('Create camera error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/cameras (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const cameras = await prisma.camera.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(cameras);
  } catch (err) {
    console.error('Get cameras error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
