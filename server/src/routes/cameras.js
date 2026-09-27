const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { isEngineerAssigned, userHasProjectAccess } = require('../utils/projectAccess');
const { classifySource, isWellFormed } = require('../utils/cameraSource');
const localDevices = require('../utils/localDevices');

const ZONES = ['ENTRANCE', 'WORK_AREA', 'STORAGE'];

// POST /api/projects/:id/cameras (ADMIN, or ENGINEER assigned to the project)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { name, zone, rtspUrl } = req.body;

    if (!name || !zone || !rtspUrl) {
      return res.status(400).json({ error: 'name, zone, and rtspUrl are required' });
    }

    if (!ZONES.includes(zone)) {
      return res.status(400).json({ error: `zone must be one of: ${ZONES.join(', ')}` });
    }

    if (req.user.role === 'ADMIN') {
      const project = await prisma.project.findUnique({ where: { id: projectId } });
      if (!project) return res.status(404).json({ error: 'Project not found' });
    } else if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const camera = await prisma.camera.create({
      data: { projectId, name, zone, rtspUrl },
    });

    res.status(201).json(camera);
  } catch (err) {
    console.error('Create camera error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PATCH /api/projects/:id/cameras/:cameraId (ADMIN, or ENGINEER assigned to the project)
//
// Re-points an existing camera at a different source - e.g. "0" to show the
// laptop's built-in webcam in that camera's slot. The source ends up as an
// ffmpeg/OpenCV input, so it is validated here rather than trusted as-is.
router.patch('/:cameraId', authenticateToken, async (req, res) => {
  try {
    const { id: projectId, cameraId } = req.params;
    const { rtspUrl } = req.body;

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    } else if (req.user.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { source, safe, reason } = classifySource(rtspUrl);
    if (!isWellFormed(source)) {
      return res.status(400).json({ error: 'rtspUrl is required and must be a single line' });
    }
    if (!safe) {
      return res.status(400).json({ error: `Camera source rejected: ${reason}` });
    }

    // Scoped by projectId as well as id, so a camera from another project
    // cannot be edited through this project's URL.
    const existing = await prisma.camera.findFirst({ where: { id: cameraId, projectId } });
    if (!existing) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    // Re-pointing a camera that holds the laptop webcam: release it first, or
    // the webcam would stay assigned to a camera that no longer uses it.
    // Best-effort - if the detection service is down it holds nothing anyway.
    if (existing.rtspUrl.trim() !== source && localDevices.isLocalDevice(existing.rtspUrl)) {
      try {
        if ((await localDevices.getHolder(existing.rtspUrl)) === cameraId) {
          await localDevices.release(existing.rtspUrl, cameraId);
        }
      } catch (releaseErr) {
        console.error('Releasing webcam before source change failed:', releaseErr.message);
      }
    }

    const camera = await prisma.camera.update({
      where: { id: cameraId },
      // A new source says nothing about whether it is reachable yet; the
      // stream route flips this to ONLINE once the first frame arrives.
      data: { rtspUrl: source, status: 'OFFLINE' },
    });

    res.json(camera);
  } catch (err) {
    console.error('Update camera error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/cameras (role-scoped)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const cameras = await prisma.camera.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    res.json(cameras);
  } catch (err) {
    console.error('Get cameras error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
