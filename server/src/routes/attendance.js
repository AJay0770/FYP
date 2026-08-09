const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');

const RANGES = { daily: 1, weekly: 7, monthly: 30 };

// GET /api/projects/:id/attendance?range=daily|weekly|monthly (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const range = req.query.range || 'daily';

    if (!RANGES[range]) {
      return res.status(400).json({ error: `range must be one of: ${Object.keys(RANGES).join(', ')}` });
    }

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) return res.status(404).json({ error: 'Project not found' });

    // UTC midnight of the local calendar day — see the note in
    // routes/internal/attendance.js. Using local midnight here would shift the
    // window by a day in any timezone east of UTC and silently drop or add a
    // day's worth of check-ins at the boundary.
    const now = new Date();
    const since = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    since.setUTCDate(since.getUTCDate() - (RANGES[range] - 1));

    // Aggregated by the database, not by looping in JS.
    const grouped = await prisma.attendanceRecord.groupBy({
      by: ['workerId'],
      where: { projectId, date: { gte: since } },
      _count: { _all: true },
      _avg: { matchConfidence: true },
      _max: { checkInTime: true },
    });

    // One extra query to resolve names, rather than N queries inside a loop.
    const workers = await prisma.worker.findMany({
      where: { id: { in: grouped.map((g) => g.workerId) } },
      select: { id: true, name: true, employeeId: true },
    });
    const workerById = new Map(workers.map((w) => [w.id, w]));

    const perWorker = grouped
      .map((g) => ({
        workerId: g.workerId,
        name: workerById.get(g.workerId)?.name ?? 'Unknown',
        employeeId: workerById.get(g.workerId)?.employeeId ?? null,
        daysPresent: g._count._all,
        avgMatchConfidence: g._avg.matchConfidence ? Number(g._avg.matchConfidence) : null,
        lastCheckIn: g._max.checkInTime,
      }))
      .sort((a, b) => b.daysPresent - a.daysPresent);

    const totalCheckins = perWorker.reduce((sum, w) => sum + w.daysPresent, 0);

    res.json({
      range,
      from: since.toISOString(),
      to: now.toISOString(),
      uniqueWorkers: perWorker.length,
      totalCheckins,
      workers: perWorker,
    });
  } catch (err) {
    console.error('Get attendance error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
