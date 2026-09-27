const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { isEngineerAssigned, userHasProjectAccess } = require('../utils/projectAccess');
const localDevices = require('../utils/localDevices');

/**
 * Explicit control of which camera uses a local device (laptop webcam).
 *
 *   GET  /api/cameras/:id/device           who holds this camera's device
 *   POST /api/cameras/:id/device/assign    use the device on this camera
 *   POST /api/cameras/:id/device/release   free the device
 *
 * The device only ever moves through assign/release - viewing, pausing or
 * stopping a feed never hands it to another camera. Assigning a device held
 * by another camera requires { "takeover": true }, so the client must ask
 * the user before moving it away from someone else's feed.
 */

// Loads the camera and applies the membership check. Responds and returns
// null on failure. 404 (not 403) for no access, like the other camera routes,
// so an outsider cannot confirm the camera exists.
async function loadCamera(req, res) {
  const camera = await prisma.camera.findUnique({ where: { id: req.params.id } });
  if (!camera || !(await userHasProjectAccess(camera.projectId, req.user))) {
    res.status(404).json({ error: 'Camera not found' });
    return null;
  }
  if (!localDevices.isLocalDevice(camera.rtspUrl)) {
    res.status(400).json({ error: 'This camera does not use a local device' });
    return null;
  }
  return camera;
}

// Same rule as editing a camera: ADMIN, or an ENGINEER assigned to the project.
async function canControl(user, projectId) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'ENGINEER') return isEngineerAssigned(projectId, user.userId);
  return false;
}

// The holder's name is shown only to users who may see that camera's project;
// anyone else just learns the device is busy elsewhere.
async function describe(camera, holderId, user) {
  const base = { source: camera.rtspUrl.trim(), canControl: await canControl(user, camera.projectId) };
  if (!holderId) return { ...base, state: 'free' };
  if (holderId === camera.id) return { ...base, state: 'here' };

  const holder = await prisma.camera.findUnique({
    where: { id: holderId },
    select: { id: true, name: true, projectId: true, project: { select: { name: true } } },
  });
  if (holder && (await userHasProjectAccess(holder.projectId, user))) {
    return {
      ...base,
      state: 'elsewhere',
      holder: { cameraId: holder.id, cameraName: holder.name, projectId: holder.projectId, projectName: holder.project.name },
    };
  }
  return { ...base, state: 'elsewhere', holder: { restricted: true } };
}

function sendError(res, context, err) {
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  console.error(`${context} error:`, err);
  return res.status(500).json({ error: 'Internal server error' });
}

// GET /api/cameras/:id/device
router.get('/:id/device', authenticateToken, async (req, res) => {
  try {
    const camera = await loadCamera(req, res);
    if (!camera) return;
    const holderId = await localDevices.getHolder(camera.rtspUrl);
    res.json(await describe(camera, holderId, req.user));
  } catch (err) {
    sendError(res, 'Get camera device', err);
  }
});

// POST /api/cameras/:id/device/assign   body: { takeover?: boolean }
router.post('/:id/device/assign', authenticateToken, async (req, res) => {
  try {
    const camera = await loadCamera(req, res);
    if (!camera) return;
    if (!(await canControl(req.user, camera.projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const holderId = await localDevices.getHolder(camera.rtspUrl);
    if (holderId && holderId !== camera.id && req.body?.takeover !== true) {
      return res.status(409).json({
        error: 'The webcam is in use by another camera',
        ...(await describe(camera, holderId, req.user)),
      });
    }

    await localDevices.assign(camera.rtspUrl, camera.id);
    res.json(await describe(camera, camera.id, req.user));
  } catch (err) {
    sendError(res, 'Assign camera device', err);
  }
});

// POST /api/cameras/:id/device/release
router.post('/:id/device/release', authenticateToken, async (req, res) => {
  try {
    const camera = await loadCamera(req, res);
    if (!camera) return;
    if (!(await canControl(req.user, camera.projectId))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const holderId = await localDevices.getHolder(camera.rtspUrl);
    if (holderId !== camera.id) {
      return res.status(409).json({
        error: 'This camera is not using the webcam',
        ...(await describe(camera, holderId, req.user)),
      });
    }

    await localDevices.release(camera.rtspUrl, camera.id);
    // A released camera is no longer streaming; the stream route marks it
    // ONLINE again once it is reassigned and frames flow. Fire-and-forget.
    prisma.camera
      .update({ where: { id: camera.id }, data: { status: 'OFFLINE' } })
      .catch((e) => console.error('Camera status update failed:', e.message));
    res.json(await describe(camera, null, req.user));
  } catch (err) {
    sendError(res, 'Release camera device', err);
  }
});

module.exports = router;
