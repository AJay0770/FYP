const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const bcrypt = require('bcrypt');
const { CameraZone, ProjectStatus } = require('@prisma/client');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { enforceProjectLimit, canCreateProject } = require('../middleware/subscriptionGate');
const { clientIdsForEngineer, userHasProjectAccess } = require('../utils/projectAccess');
const { classifySource, isWellFormed } = require('../utils/cameraSource');
const { passwordProblem } = require('../utils/passwordPolicy');
const localDevices = require('../utils/localDevices');
const { resetCamera } = require('../utils/alertCooldowns');

const CAMERA_ZONES = Object.values(CameraZone);
const PROJECT_STATUSES = Object.values(ProjectStatus);
const MAX_CAMERAS = 20;
// Deliberately loose: it only catches typos; the login itself proves the address.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// What a project page needs: engineer names and the client's public fields.
const PROJECT_DETAIL_INCLUDE = {
  engineers: { include: { engineer: { select: { id: true, name: true, email: true } } } },
  client: { select: { id: true, name: true, email: true, role: true } },
};

// Validates a { name, email, password } account typed into the create form.
// Returns { error } or { account } with a lowercased email.
function parseNewAccount(raw, label) {
  const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
  const email = typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
  const password = typeof raw?.password === 'string' ? raw.password : '';
  if (!name || !EMAIL_PATTERN.test(email)) {
    return { error: `The new ${label} needs a name and a valid email` };
  }
  const weak = passwordProblem(password);
  if (weak) {
    const Label = label.charAt(0).toUpperCase() + label.slice(1);
    return { error: `${Label} password: ${weak.charAt(0).toLowerCase()}${weak.slice(1)}` };
  }
  return { account: { name, email, password } };
}

// COMPLETED projects don't count against the plan (subscriptionGate.js), so
// reopening one takes a slot back. Without this check a user could complete a
// project, create another, then reopen the first and run over the limit.
// Counted against whoever created the project, as on creation. Returns the
// limit check when the move is blocked, or null when it is allowed.
async function reopenBlocked(projectId, newStatus) {
  if (newStatus === undefined || newStatus === 'COMPLETED') return null;
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { status: true, createdById: true, createdBy: { select: { role: true } } },
  });
  if (!project || project.status !== 'COMPLETED') return null;
  const check = await canCreateProject({ userId: project.createdById, role: project.createdBy.role });
  return check.allowed ? null : check;
}

function sendLimitReached(res, check) {
  return res.status(402).json({
    error: 'Project limit reached for current plan',
    message: `This project can't be reopened. ${check.message}`,
    limit: check.limit === Infinity ? 'unlimited' : check.limit,
    current: check.current,
  });
}

// GPS is optional (a text address is enough); if given it must be real.
// Returns { error } or { gpsLat, gpsLng } (both null when not given).
function parseGps(body) {
  const hasGps = body.gpsLat !== undefined && body.gpsLat !== null && body.gpsLat !== '';
  if (!hasGps) return { gpsLat: null, gpsLng: null };
  const gpsLat = Number(body.gpsLat);
  const gpsLng = Number(body.gpsLng);
  if (!Number.isFinite(gpsLat) || !Number.isFinite(gpsLng) || Math.abs(gpsLat) > 90 || Math.abs(gpsLng) > 180) {
    return { error: 'gpsLat/gpsLng must be valid coordinates' };
  }
  return { gpsLat, gpsLng };
}

// POST /api/projects (ADMIN or ENGINEER, subject to the plan's project limit)
//
// Creates a project from scratch in one step: the project, optionally a brand
// new client account, and any cameras - all in one transaction, so a failure
// part-way never leaves a half-made project behind.
//
// Body:
//   name, address, startDate, expectedCompletionDate, budgetEstimate  (required)
//   gpsLat, gpsLng                                                    (optional)
//   clientId  - an existing CLIENT user, or
//   newClient - { name, email, password } to create one (always role CLIENT)
//   cameras   - [{ name, zone?, source? }]; source defaults to "0" (webcam)
//   engineerIds - ADMIN only; an ENGINEER is always assigned to what they create
//   newEngineer - ADMIN only: { name, email, password } to create an ENGINEER
//                 account and assign it (alongside any engineerIds)
router.post('/', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), enforceProjectLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const isEngineer = req.user.role === 'ENGINEER';

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    if (!name || !address || !body.startDate || !body.expectedCompletionDate || body.budgetEstimate === undefined || body.budgetEstimate === '') {
      return res.status(400).json({ error: 'name, address, startDate, expectedCompletionDate and budgetEstimate are required' });
    }
    if (name.length > 120) return res.status(400).json({ error: 'name must be 120 characters or fewer' });

    const startDate = new Date(body.startDate);
    const expectedCompletionDate = new Date(body.expectedCompletionDate);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(expectedCompletionDate.getTime())) {
      return res.status(400).json({ error: 'startDate and expectedCompletionDate must be valid dates' });
    }
    if (expectedCompletionDate < startDate) {
      return res.status(400).json({ error: 'expectedCompletionDate cannot be before startDate' });
    }

    const budget = Number(body.budgetEstimate);
    if (!Number.isFinite(budget) || budget < 0) {
      return res.status(400).json({ error: 'budgetEstimate must be a number of 0 or more' });
    }

    const gps = parseGps(body);
    if (gps.error) return res.status(400).json({ error: gps.error });
    const { gpsLat, gpsLng } = gps;

    // --- Cameras ---
    const rawCameras = body.cameras === undefined ? [] : body.cameras;
    if (!Array.isArray(rawCameras) || rawCameras.length > MAX_CAMERAS) {
      return res.status(400).json({ error: `cameras must be a list of at most ${MAX_CAMERAS}` });
    }
    const cameras = [];
    for (const [i, cam] of rawCameras.entries()) {
      const camName = typeof cam?.name === 'string' ? cam.name.trim() : '';
      if (!camName || camName.length > 80) {
        return res.status(400).json({ error: `Camera ${i + 1}: a name of up to 80 characters is required` });
      }
      const zone = cam.zone || 'WORK_AREA';
      if (!CAMERA_ZONES.includes(zone)) {
        return res.status(400).json({ error: `Camera ${i + 1}: zone must be one of ${CAMERA_ZONES.join(', ')}` });
      }
      // Sources end up as ffmpeg/OpenCV inputs: validate like every other camera path.
      const { source, safe, reason } = classifySource(cam.source === undefined || cam.source === '' ? '0' : cam.source);
      if (!isWellFormed(source) || !safe) {
        return res.status(400).json({ error: `Camera ${i + 1}: ${reason || 'source is malformed'}` });
      }
      cameras.push({ name: camName, zone, rtspUrl: source });
    }

    // --- Client: an existing one, or a new account ---
    const hasExisting = Boolean(body.clientId);
    const hasNew = Boolean(body.newClient);
    if (hasExisting === hasNew) {
      return res.status(400).json({ error: 'Provide either clientId or newClient' });
    }

    let newClient = null;
    if (hasExisting) {
      const client = await prisma.user.findUnique({ where: { id: String(body.clientId) }, select: { id: true, role: true } });
      if (!client || client.role !== 'CLIENT') {
        return res.status(400).json({ error: 'clientId must be an existing client' });
      }
      // Engineers only ever see (and may only pick) clients of their own projects.
      if (isEngineer && !(await clientIdsForEngineer(req.user.userId)).includes(client.id)) {
        return res.status(403).json({ error: 'You can only choose a client from your own projects' });
      }
    } else {
      const parsed = parseNewAccount(body.newClient, 'client');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { name: clientName, email, password } = parsed.account;
      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
        return res.status(409).json({ error: 'A user with that email already exists - choose them as an existing client instead' });
      }
      // bcrypt cost 12, same as registration. Role is fixed to CLIENT: an
      // engineer can never create an ADMIN or ENGINEER account this way.
      newClient = { name: clientName, email, passwordHash: await bcrypt.hash(password, 12), role: 'CLIENT' };
    }

    const engineerIds = isEngineer ? [req.user.userId] : Array.isArray(body.engineerIds) ? [...new Set(body.engineerIds.map(String))] : [];
    if (!isEngineer && engineerIds.length) {
      const found = await prisma.user.count({ where: { id: { in: engineerIds }, role: 'ENGINEER' } });
      if (found !== engineerIds.length) {
        return res.status(400).json({ error: 'engineerIds must all be existing engineers' });
      }
    }

    // --- A brand-new engineer account (ADMIN only) ---
    // Creating staff accounts stays with the admin, same as POST /api/users.
    let newEngineer = null;
    if (body.newEngineer) {
      if (isEngineer) {
        return res.status(403).json({ error: 'Only an admin can create engineer accounts' });
      }
      const parsed = parseNewAccount(body.newEngineer, 'engineer');
      if (parsed.error) return res.status(400).json({ error: parsed.error });
      const { name: engineerName, email, password } = parsed.account;
      if (newClient && newClient.email === email) {
        return res.status(400).json({ error: 'The new client and the new engineer need different emails' });
      }
      if (await prisma.user.findUnique({ where: { email }, select: { id: true } })) {
        return res.status(409).json({ error: 'A user with that email already exists - choose them as an existing engineer instead' });
      }
      // Role fixed to ENGINEER; bcrypt cost 12 as everywhere else.
      newEngineer = { name: engineerName, email, passwordHash: await bcrypt.hash(password, 12), role: 'ENGINEER' };
    }

    const project = await prisma.$transaction(async (tx) => {
      const clientId = newClient ? (await tx.user.create({ data: newClient, select: { id: true } })).id : String(body.clientId);
      if (newEngineer) {
        engineerIds.push((await tx.user.create({ data: newEngineer, select: { id: true } })).id);
      }
      return tx.project.create({
        data: {
          name,
          address,
          gpsLat,
          gpsLng,
          clientId,
          startDate,
          expectedCompletionDate,
          budgetEstimate: budget,
          createdById: req.user.userId,
          engineers: { create: engineerIds.map((engineerId) => ({ engineerId })) },
          cameras: { create: cameras },
        },
        include: { ...PROJECT_DETAIL_INCLUDE, cameras: true },
      });
    });

    res.status(201).json(project);
  } catch (err) {
    // A concurrent sign-up with the same email lands here as a unique violation.
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'A user with that email already exists' });
    }
    console.error('Create project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/quota - how many projects the caller may still create.
// Lets the app show the upgrade notice before someone fills in the whole form.
router.get('/quota', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const check = await canCreateProject(req.user);
    res.json({
      allowed: check.allowed,
      current: check.current,
      limit: check.limit === Infinity ? null : check.limit,
      plan: check.plan,
      message: check.message,
    });
  } catch (err) {
    console.error('Project quota error:', err);
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
      orderBy: { createdAt: 'desc' },
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
      // Names for the project header; public fields only.
      include: PROJECT_DETAIL_INCLUDE,
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

// PUT /api/projects/:id (ADMIN, or an ENGINEER assigned to the project)
//
// Edits the project's details. Every field is optional - only what is sent
// changes. The client and engineer list are not edited here (engineers are
// added via /assign-engineer).
//
// Body: name, address, startDate, expectedCompletionDate, budgetEstimate,
//       gpsLat + gpsLng (both null to clear), status
router.put('/:id', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const body = req.body || {};

    // Membership too, not just role. 404, not 403, so an engineer can't use
    // this to confirm that another project's id exists.
    if (!(await userHasProjectAccess(req.params.id, req.user))) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const current = await prisma.project.findUnique({
      where: { id: req.params.id },
      select: { startDate: true, expectedCompletionDate: true },
    });
    if (!current) return res.status(404).json({ error: 'Project not found' });

    const data = {};

    for (const field of ['name', 'address']) {
      if (body[field] === undefined) continue;
      const value = typeof body[field] === 'string' ? body[field].trim() : '';
      if (!value) return res.status(400).json({ error: `${field} cannot be empty` });
      data[field] = value;
    }
    if (data.name && data.name.length > 120) {
      return res.status(400).json({ error: 'name must be 120 characters or fewer' });
    }

    for (const field of ['startDate', 'expectedCompletionDate']) {
      if (body[field] === undefined) continue;
      const date = new Date(body[field]);
      if (body[field] === null || body[field] === '' || Number.isNaN(date.getTime())) {
        return res.status(400).json({ error: `${field} must be a valid date` });
      }
      data[field] = date;
    }
    // Compare against the stored value of whichever date wasn't sent.
    const start = data.startDate || current.startDate;
    const end = data.expectedCompletionDate || current.expectedCompletionDate;
    if (end < start) {
      return res.status(400).json({ error: 'expectedCompletionDate cannot be before startDate' });
    }

    if (body.budgetEstimate !== undefined) {
      const budget = body.budgetEstimate === null || body.budgetEstimate === '' ? NaN : Number(body.budgetEstimate);
      if (!Number.isFinite(budget) || budget < 0) {
        return res.status(400).json({ error: 'budgetEstimate must be a number of 0 or more' });
      }
      data.budgetEstimate = budget;
    }

    if (body.gpsLat !== undefined || body.gpsLng !== undefined) {
      const gps = parseGps(body);
      if (gps.error) return res.status(400).json({ error: gps.error });
      data.gpsLat = gps.gpsLat;
      data.gpsLng = gps.gpsLng;
    }

    if (body.status !== undefined) {
      if (!PROJECT_STATUSES.includes(body.status)) {
        return res.status(400).json({ error: `status must be one of: ${PROJECT_STATUSES.join(', ')}` });
      }
      data.status = body.status;
      const blocked = await reopenBlocked(req.params.id, body.status);
      if (blocked) return sendLimitReached(res, blocked);
    }

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data,
      include: PROJECT_DETAIL_INCLUDE,
    });

    res.json(project);
  } catch (err) {
    // P2025: deleted between the access check and the update.
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    console.error('Update project error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/projects/:id/status (ADMIN, or an ENGINEER assigned to the project)
//
// Moves a project between PLANNING, ACTIVE, ON_HOLD and COMPLETED - the
// status picker on the project page. Status matters beyond the badge: the
// nightly report job only covers ACTIVE projects (jobs/reportCron.js), and a
// COMPLETED project frees a slot in the plan's project limit.
router.patch('/:id/status', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!PROJECT_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${PROJECT_STATUSES.join(', ')}` });
    }

    // Role alone is not enough - membership too. 404, not 403, so an engineer
    // can't use this to confirm that another project's id exists.
    if (!(await userHasProjectAccess(req.params.id, req.user))) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const blocked = await reopenBlocked(req.params.id, status);
    if (blocked) return sendLimitReached(res, blocked);

    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { status },
      select: { id: true, status: true, updatedAt: true },
    });

    res.json(project);
  } catch (err) {
    // P2025: deleted between the access check and the update.
    if (err.code === 'P2025') return res.status(404).json({ error: 'Project not found' });
    console.error('Update project status error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id (ADMIN only)
//
// Removes the project and, through the schema's onDelete: Cascade relations,
// everything recorded under it (cameras, updates, materials, chat, workers and
// their face embeddings, attendance, alerts, reports, media rows). Files
// already in S3/MinIO are left in place. The client's account is kept: it may
// belong to other projects. Engineers can't delete - they mark a finished
// project COMPLETED instead, which keeps its history and frees a plan slot.
router.delete('/:id', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const cameras = await prisma.camera.findMany({
      where: { projectId: req.params.id },
      select: { id: true, rtspUrl: true },
    });

    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ message: 'Project deleted' });

    // After the response: free any webcam a deleted camera held and drop its
    // alert cooldowns. A failure here (e.g. the AI service is down) must not
    // fail the delete - log it and move on.
    for (const camera of cameras) {
      resetCamera(camera.id);
      if (localDevices.isLocalDevice(camera.rtspUrl)) {
        localDevices.release(camera.rtspUrl, camera.id).catch((err) => {
          console.error('Release device after project delete error:', err.message);
        });
      }
    }
  } catch (err) {
    // P2025: deleted concurrently, between the access check and the delete.
    if (err.code === 'P2025' && !res.headersSent) return res.status(404).json({ error: 'Project not found' });
    if (res.headersSent) return console.error('Delete project cleanup error:', err);
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

    const project = await prisma.project.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    // Only an ENGINEER account can be assigned - never a client or an admin.
    const engineer = await prisma.user.findUnique({ where: { id: String(engineerId) }, select: { role: true } });
    if (!engineer || engineer.role !== 'ENGINEER') {
      return res.status(400).json({ error: 'engineerId must be an existing engineer' });
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

// DELETE /api/projects/:id/engineers/:engineerId (ADMIN only)
//
// Takes an engineer off a project. Only the assignment goes: the account and
// everything they recorded on the project (updates, materials, chat) stay.
// They lose access at once - every project route re-checks the assignment.
router.delete('/:id/engineers/:engineerId', authenticateToken, authorizeRole('ADMIN'), async (req, res) => {
  try {
    const { count } = await prisma.projectEngineer.deleteMany({
      where: { projectId: req.params.id, engineerId: req.params.engineerId },
    });
    if (count === 0) {
      return res.status(404).json({ error: 'That engineer is not assigned to this project' });
    }
    res.status(204).end();
  } catch (err) {
    console.error('Unassign engineer error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
