const express = require('express');
const router = express.Router();
const prisma = require('../../utils/prisma');
const internalAuth = require('../../middleware/internalAuth');
const { getIO } = require('../../sockets/io');

/**
 * The site's current calendar day, as UTC midnight.
 *
 * Two things have to be true at once:
 *  - the day must be the *local* calendar day (a worker arriving at 08:00 in
 *    Karachi is present on that date, not the UTC date)
 *  - the value must serialise to UTC midnight, because the column is @db.Date
 *
 * `new Date(y, m, d)` builds LOCAL midnight, which in any timezone east of UTC
 * serialises to the previous day (UTC+5 local midnight is 19:00 the day before),
 * so every check-in would be filed one day early. Reading the local Y/M/D and
 * rebuilding via Date.UTC keeps the right day and lands on 00:00Z.
 */
function startOfToday() {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

// POST /api/internal/attendance-record
router.post('/attendance-record', internalAuth, async (req, res) => {
  try {
    const { workerId, confidence } = req.body;

    if (!workerId || confidence === undefined) {
      return res.status(400).json({ error: 'workerId and confidence are required' });
    }

    const score = Number(confidence);
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      return res.status(400).json({ error: 'confidence must be a number between 0 and 1' });
    }

    const worker = await prisma.worker.findUnique({ where: { id: workerId } });
    if (!worker) {
      return res.status(404).json({ error: 'Worker not found' });
    }

    const today = startOfToday();

    const existing = await prisma.attendanceRecord.findUnique({
      where: { workerId_date: { workerId, date: today } },
    });

    if (existing) {
      return res.status(200).json({
        duplicate: true,
        message: 'Worker already checked in today',
        record: existing,
      });
    }

    let record;
    try {
      record = await prisma.attendanceRecord.create({
        data: {
          workerId,
          projectId: worker.projectId,
          matchConfidence: score,
          date: today,
        },
        include: { worker: { select: { id: true, name: true, employeeId: true } } },
      });
    } catch (err) {
      // Two frames matching the same worker within milliseconds can both pass the
      // findUnique check above; the DB unique constraint is the real guard.
      if (err.code === 'P2002') {
        return res.status(200).json({ duplicate: true, message: 'Worker already checked in today' });
      }
      throw err;
    }

    const io = getIO();
    if (io) {
      io.to(`project:${worker.projectId}`).emit('attendance:checkin', record);
    }

    res.status(201).json(record);
  } catch (err) {
    console.error('Attendance record error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
