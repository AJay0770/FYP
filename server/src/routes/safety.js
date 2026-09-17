const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// GET /api/projects/:id/safety-alerts?limit=&offset= (role-scoped, newest-first)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const [alerts, total] = await Promise.all([
      prisma.safetyAlert.findMany({
        where: { projectId },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: limit,
        include: {
          camera: { select: { id: true, name: true, zone: true } },
          worker: { select: { id: true, name: true, employeeId: true } },
        },
      }),
      prisma.safetyAlert.count({ where: { projectId } }),
    ]);

    res.json({ alerts, total, limit, offset });
  } catch (err) {
    console.error('Get safety alerts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
