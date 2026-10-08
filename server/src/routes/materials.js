const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { isEngineerAssigned, userHasProjectAccess } = require('../utils/projectAccess');

const ENTRY_TYPES = ['RECEIVED', 'CONSUMED'];

// Bad numbers or dates would otherwise reach Prisma and surface as a 500.
function valueProblem(quantity, unitCost, date) {
  const q = quantity === null || quantity === '' ? NaN : Number(quantity);
  const c = unitCost === null || unitCost === '' ? NaN : Number(unitCost);
  if (!Number.isFinite(q) || q <= 0) return 'quantity must be a number greater than 0';
  if (!Number.isFinite(c) || c < 0) return 'unitCost must be a number of 0 or more';
  if (Number.isNaN(new Date(date).getTime())) return 'date must be a valid date';
  return null;
}

// POST /api/projects/:id/materials (ADMIN, or ENGINEER assigned to project)
router.post('/', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { name, category, entryType, quantity, unitCost, date } = req.body;

    if (!name || !category || !entryType || quantity === undefined || unitCost === undefined || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!ENTRY_TYPES.includes(entryType)) {
      return res.status(400).json({ error: 'entryType must be RECEIVED or CONSUMED' });
    }
    const invalid = valueProblem(quantity, unitCost, date);
    if (invalid) return res.status(400).json({ error: invalid });

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    const entry = await prisma.materialEntry.create({
      data: {
        projectId,
        name,
        category,
        entryType,
        quantity,
        unitCost,
        date: new Date(date),
        loggedById: req.user.userId,
      },
    });

    res.status(201).json(entry);
  } catch (err) {
    // P2003: an ADMIN posted to a project id that doesn't exist.
    if (err.code === 'P2003') return res.status(404).json({ error: 'Project not found' });
    console.error('Create material entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id/materials/:materialId (ADMIN, or ENGINEER assigned to project)
router.put('/:materialId', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId, materialId } = req.params;
    const { name, category, entryType, quantity, unitCost, date } = req.body;

    if (!name || !category || !entryType || quantity === undefined || unitCost === undefined || !date) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!ENTRY_TYPES.includes(entryType)) {
      return res.status(400).json({ error: 'entryType must be RECEIVED or CONSUMED' });
    }
    const invalid = valueProblem(quantity, unitCost, date);
    if (invalid) return res.status(400).json({ error: invalid });

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    // updateMany + a projectId filter, not update-by-id: an id alone can't
    // confirm the entry actually belongs to *this* project, and a plain
    // update() would happily edit another project's row if the id matched.
    const { count } = await prisma.materialEntry.updateMany({
      where: { id: materialId, projectId },
      data: { name, category, entryType, quantity, unitCost, date: new Date(date) },
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Material entry not found' });
    }

    const entry = await prisma.materialEntry.findUnique({ where: { id: materialId } });
    res.json(entry);
  } catch (err) {
    console.error('Update material entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/materials/:materialId (ADMIN, or ENGINEER assigned to project)
router.delete('/:materialId', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId, materialId } = req.params;

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    const { count } = await prisma.materialEntry.deleteMany({
      where: { id: materialId, projectId },
    });

    if (count === 0) {
      return res.status(404).json({ error: 'Material entry not found' });
    }

    res.status(204).end();
  } catch (err) {
    console.error('Delete material entry error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/materials (role-scoped, newest-first)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const entries = await prisma.materialEntry.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { loggedBy: { select: { id: true, name: true, email: true, role: true } } },
    });

    res.json(entries);
  } catch (err) {
    console.error('Get material entries error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/materials/summary (role-scoped, aggregated in the database)
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const summary = await prisma.$queryRaw`
      SELECT
        name,
        COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity ELSE 0 END), 0)::float AS "totalReceived",
        COALESCE(SUM(CASE WHEN "entryType" = 'CONSUMED' THEN quantity ELSE 0 END), 0)::float AS "totalConsumed",
        (
          COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN "entryType" = 'CONSUMED' THEN quantity ELSE 0 END), 0)
        )::float AS "difference",
        (
          COALESCE(SUM(CASE WHEN "entryType" = 'CONSUMED' THEN quantity ELSE 0 END), 0)
          > COALESCE(SUM(CASE WHEN "entryType" = 'RECEIVED' THEN quantity ELSE 0 END), 0)
        ) AS "discrepancy"
      FROM material_entries
      WHERE "projectId" = ${projectId}
      GROUP BY name
      ORDER BY name
    `;

    res.json(summary);
  } catch (err) {
    console.error('Get material summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
