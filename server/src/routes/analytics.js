const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateToken } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { getProjectSummary } = require('../services/reportingService');

// GET /api/projects/:id/analytics?startDate=&endDate= (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) return res.status(404).json({ error: 'Project not found' });

    const summary = await getProjectSummary(projectId, {
      startDate: req.query.startDate,
      endDate: req.query.endDate,
    });

    if (!summary) return res.status(404).json({ error: 'Project not found' });

    res.json(summary);
  } catch (err) {
    console.error('Get analytics error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
