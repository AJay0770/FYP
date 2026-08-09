const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { enforceProjectLimit } = require('../middleware/subscriptionGate');

const prisma = new PrismaClient();

// POST /api/projects (ADMIN only, subject to the plan's project limit)
router.post('/', authenticateToken, authorizeRole('ADMIN'), enforceProjectLimit, async (req, res) => {
  try {
    const { name, gpsLat, gpsLng, address, clientId, startDate, expectedCompletionDate, budgetEstimate, engineerIds } = req.body;

    if (!name || gpsLat === undefined || gpsLng === undefined || !address || !clientId || !startDate || !expectedCompletionDate || !budgetEstimate) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const project = await prisma.project.create({
      data: {
        name,
        gpsLat,
        gpsLng,
        address,
        clientId,
        startDate: new Date(startDate),
        expectedCompletionDate: new Date(expectedCompletionDate),
        budgetEstimate,
        createdById: req.user.userId,
        engineers: {
          create: (engineerIds || []).map(engineerId => ({ engineerId }))
        }
      },
      include: { engineers: true }
    });

    res.status(201).json(project);
  } catch (err) {
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    let where = {};

    if (req.user.role === 'ADMIN') {
      // ADMIN sees all projects
    } else if (req.user.role === 'ENGINEER') {
      // ENGINEER sees only assigned projects
      where = {
        engineers: {
          some: { engineerId: req.user.userId }
        }
      };
    } else if (req.user.role === 'CLIENT') {
      // CLIENT sees only their own projects
      where = { clientId: req.user.userId };
    }

    const projects = await prisma.project.findMany({
      where,
      include: {
        engineers: true,
        client: { select: { id: true, name: true, email: true, role: true } }
      }
    });

    res.json(projects);
  } catch (err) {
    console.error('Get projects error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id (role-scoped, 404 if no access)
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const project = await prisma.project.findUnique({
      where: { id: req.params.id },
      include: {
        engineers: true,
        client: { select: { id: true, name: true, email: true, role: true } }
      }
    });

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Check role-based access
    if (req.user.role === 'ADMIN') {
      // ADMIN can access any project
    } else if (req.user.role === 'ENGINEER') {
      // ENGINEER can access if assigned
      const isAssigned = project.engineers.some(e => e.engineerId === req.user.userId);
      if (!isAssigned) return res.status(404).json({ error: 'Project not found' });
    } else if (req.user.role === 'CLIENT') {
      // CLIENT can access if they are clientId
      if (project.clientId !== req.user.userId) {
        return res.status(404).json({ error: 'Project not found' });
      }
    }

    res.json(project);
  } catch (err) {
    console.error('Get project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/projects/:id (ADMIN only)
router.put('/:id', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const { name, status, budgetEstimate } = req.body;

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { name, status, budgetEstimate },
      include: { engineers: true }
    });

    res.json(project);
  } catch (err) {
    console.error('Update project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id (ADMIN only)
router.delete('/:id', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ message: 'Project deleted' });
  } catch (err) {
    console.error('Delete project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/assign-engineer (ADMIN only)
router.post('/:id/assign-engineer', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const { engineerId } = req.body;

    if (!engineerId) {
      return res.status(400).json({ error: 'engineerId required' });
    }

    const projectEngineer = await prisma.projectEngineer.create({
      data: {
        projectId: req.params.id,
        engineerId
      }
    });

    res.status(201).json(projectEngineer);
  } catch (err) {
    if (err.code === 'P2002') { // Unique constraint
      return res.status(409).json({ error: 'Engineer already assigned to this project' });
    }
    console.error('Assign engineer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
