const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { generatePresignedUrl, getPublicUrl } = require('../utils/s3');
const { isEngineerAssigned, userHasProjectAccess } = require('../utils/projectAccess');

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'mp4', 'mov'];
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024; // 50MB

// POST /api/projects/:id/updates/presign (ENGINEER only, must be assigned)
router.post('/presign', authenticateToken, authorizeRole('ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { fileName, contentType, fileSize } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    const assigned = await isEngineerAssigned(projectId, req.user.userId);
    if (!assigned) {
      return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
    }

    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: `Unsupported file type: .${ext || 'unknown'}` });
    }

    if (fileSize !== undefined && fileSize > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds maximum size of 50MB' });
    }

    const { presignedUrl, key } = await generatePresignedUrl(fileName, contentType);
    const publicUrl = getPublicUrl(key);

    res.json({ presignedUrl, publicUrl });
  } catch (err) {
    console.error('Presign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/updates (ENGINEER only, must be assigned)
router.post('/', authenticateToken, authorizeRole('ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { description, mediaUrls } = req.body;

    if (!description) {
      return res.status(400).json({ error: 'description is required' });
    }

    const assigned = await isEngineerAssigned(projectId, req.user.userId);
    if (!assigned) {
      return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
    }

    const update = await prisma.siteUpdate.create({
      data: {
        projectId,
        engineerId: req.user.userId,
        description,
        mediaUrls: mediaUrls || [],
      },
    });

    res.status(201).json(update);
  } catch (err) {
    console.error('Create update error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/projects/:id/updates (role-scoped, newest-first)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const updates = await prisma.siteUpdate.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { engineer: { select: { id: true, name: true, email: true, role: true } } },
    });

    res.json(updates);
  } catch (err) {
    console.error('Get updates error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
