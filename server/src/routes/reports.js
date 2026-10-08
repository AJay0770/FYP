const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { generateReport } = require('../services/reportGenerator');

const REPORT_TYPES = ['DAILY', 'WEEKLY'];

// POST /api/projects/:id/reports/generate-now (ADMIN, or an ENGINEER assigned to the project)
router.post('/generate-now', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const reportType = req.body?.reportType || 'DAILY';

    if (!REPORT_TYPES.includes(reportType)) {
      return res.status(400).json({ error: `reportType must be one of: ${REPORT_TYPES.join(', ')}` });
    }

    // Role alone is not enough: an engineer may only report on projects they
    // are assigned to. 404 (not 403) so an outsider can't confirm the id exists.
    if (!(await userHasProjectAccess(projectId, req.user))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const { report, sizeBytes } = await generateReport(projectId, reportType, {
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
    });

    res.status(201).json({ ...report, sizeBytes });
  } catch (err) {
    console.error('Generate report error:', err);
    // Only errors the generator raised on purpose (with a statusCode) carry a
    // user-facing message; anything else may hold internals - keep it generic.
    if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/reports (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) return res.status(404).json({ error: 'Project not found' });

    const reports = await prisma.report.findMany({
      where: { projectId },
      orderBy: { generatedAt: 'desc' },
    });

    res.json(reports);
  } catch (err) {
    console.error('Get reports error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
