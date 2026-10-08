const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { clientIdsForEngineer } = require('../utils/projectAccess');
const { passwordProblem } = require('../utils/passwordPolicy');

// Roles an admin may create here. ADMIN is deliberately not one of them: a
// second admin has full control of the company, which should stay a
// deliberate, out-of-band decision rather than a form field.
const CREATABLE_ROLES = ['ENGINEER', 'CLIENT'];
// Loose on purpose: it only catches typos; logging in proves the address.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Never select passwordHash or tokenVersion into a response.
const PUBLIC_FIELDS = { id: true, name: true, email: true, role: true, createdAt: true };

// GET /api/users (ADMIN) - optional ?role=ENGINEER|CLIENT|ADMIN
router.get('/', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const { role } = req.query;
    if (role && !['ADMIN', 'ENGINEER', 'CLIENT'].includes(role)) {
      return res.status(400).json({ error: 'role must be ADMIN, ENGINEER or CLIENT' });
    }
    const users = await prisma.user.findMany({
      where: role ? { role } : {},
      select: { ...PUBLIC_FIELDS, _count: { select: { assignedProjects: true, clientProjects: true } } },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
    res.json(users);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/users (ADMIN) - create an ENGINEER or CLIENT account
router.post('/', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const { password, role } = req.body || {};

    if (!name || !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'A name and a valid email are required' });
    }
    if (!CREATABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${CREATABLE_ROLES.join(', ')}` });
    }
    const weak = passwordProblem(password);
    if (weak) return res.status(400).json({ error: weak });

    if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    // bcrypt cost 12, same as registration.
    const user = await prisma.user.create({
      data: { name, email, role, passwordHash: await bcrypt.hash(password, 12) },
      select: PUBLIC_FIELDS,
    });
    res.status(201).json(user);
  } catch (err) {
    // A concurrent create with the same email lands here as a unique violation.
    if (err.code === 'P2002') return res.status(409).json({ error: 'A user with that email already exists' });
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/users/clients (ADMIN or ENGINEER)
//
// Client accounts to choose from when creating a project. ADMIN sees every
// client; an ENGINEER sees only clients of projects they are assigned to -
// never the company's whole client list. Only id, name and email are returned.
router.get('/clients', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const where = { role: 'CLIENT' };
    if (req.user.role === 'ENGINEER') {
      where.id = { in: await clientIdsForEngineer(req.user.userId) };
    }

    const clients = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true },
      orderBy: { name: 'asc' },
    });

    res.json(clients);
  } catch (err) {
    console.error('List clients error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
