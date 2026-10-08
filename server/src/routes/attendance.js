const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { classifySource, isWellFormed } = require('../utils/cameraSource');

// Same default as routes/safetyDetection.js and utils/localDevices.js.
const AI_SERVICE_URL = (
  process.env.SAFETY_STREAM_URL || `http://127.0.0.1:${process.env.STREAM_PORT || 8554}`
).replace(/\/$/, '');
const SCAN_SECONDS = 12;

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

// POST /api/projects/:id/attendance/scan  body: { cameraId }
// (ADMIN, or an ENGINEER assigned to the project)
//
// "Detect & mark attendance": the detection service watches this camera's
// frames for SCAN_SECONDS, matches faces against the project's enrolled
// workers and records check-ins through the usual internal endpoint (so the
// one-per-day rule and the live socket update apply). Synchronous: the
// response lists who was checked in.
router.post('/scan', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const cameraId = req.body?.cameraId ? String(req.body.cameraId) : '';
    if (!cameraId) return res.status(400).json({ error: 'cameraId is required' });

    // Role alone isn't enough - membership too. 404 so outsiders learn nothing.
    if (!(await userHasProjectAccess(projectId, req.user))) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const camera = await prisma.camera.findFirst({ where: { id: cameraId, projectId } });
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    const { source, safe } = classifySource(camera.rtspUrl);
    if (!isWellFormed(source) || !safe) {
      return res.status(422).json({ error: 'Camera source is malformed' });
    }

    const url = new URL('/attendance/scan', AI_SERVICE_URL);
    url.searchParams.set('source', source);
    url.searchParams.set('cameraId', camera.id);
    url.searchParams.set('seconds', String(SCAN_SECONDS));

    let upstream;
    try {
      upstream = await fetch(url, { method: 'POST', signal: AbortSignal.timeout((SCAN_SECONDS + 30) * 1000) });
    } catch (err) {
      return res.status(503).json({ error: 'Detection service is not running. Start it with: python safety_stream.py' });
    }

    if (upstream.status === 409) {
      return res.status(409).json({
        error: 'The webcam is not on this camera. Use "Use webcam here" on it in Live monitoring, then try again.',
      });
    }
    if (!upstream.ok) {
      console.error('Attendance scan upstream error:', upstream.status, (await upstream.text()).slice(0, 300));
      return res.status(502).json({ error: 'The detection service could not run the scan' });
    }

    res.json({ camera: { id: camera.id, name: camera.name }, seconds: SCAN_SECONDS, ...(await upstream.json()) });
  } catch (err) {
    console.error('Attendance scan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
