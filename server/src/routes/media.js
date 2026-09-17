const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken, authorizeRole } = require('../middleware/auth');
const { isEngineerAssigned, userHasProjectAccess } = require('../utils/projectAccess');
const { generatePresignedUrl, getPublicUrl, deleteObject, keyFromPublicUrl } = require('../utils/s3');

// Mirrors the site-update presign's allowed types (images/video only) - this
// is a media library, not a general document store like chat attachments.
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov'];
const MAX_FILE_SIZE_BYTES = 200 * 1024 * 1024; // 200MB - clips run a few MB/30s, leave headroom
const MEDIA_TYPES = ['IMAGE', 'VIDEO'];

// GET /api/projects/:id/media (role-scoped, newest first)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const assets = await prisma.mediaAsset.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        camera: { select: { id: true, name: true, zone: true } },
        uploadedBy: { select: { id: true, name: true, role: true } },
      },
    });

    res.json(assets);
  } catch (err) {
    console.error('Get media assets error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/media/presign (ADMIN, or ENGINEER assigned to project)
router.post('/presign', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { fileName, contentType, fileSize } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: `Unsupported file type: .${ext || 'unknown'}` });
    }

    if (fileSize !== undefined && fileSize > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds maximum size of 200MB' });
    }

    const { presignedUrl, key } = await generatePresignedUrl(fileName, contentType);
    res.json({ presignedUrl, publicUrl: getPublicUrl(key) });
  } catch (err) {
    console.error('Media presign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/projects/:id/media (ADMIN, or ENGINEER assigned to project) - call
// after the presigned upload above completes, to record it in the library.
router.post('/', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { url, type, caption, cameraId } = req.body;

    if (!url || !type) {
      return res.status(400).json({ error: 'url and type are required' });
    }
    if (!MEDIA_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${MEDIA_TYPES.join(', ')}` });
    }

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    if (cameraId) {
      const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
      if (!camera || camera.projectId !== projectId) {
        return res.status(404).json({ error: 'Camera not found for this project' });
      }
    }

    const asset = await prisma.mediaAsset.create({
      data: {
        projectId,
        cameraId: cameraId || null,
        type,
        source: 'MANUAL_UPLOAD',
        url,
        caption: caption || null,
        uploadedById: req.user.userId,
      },
      include: {
        camera: { select: { id: true, name: true, zone: true } },
        uploadedBy: { select: { id: true, name: true, role: true } },
      },
    });

    res.status(201).json(asset);
  } catch (err) {
    console.error('Create media asset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE /api/projects/:id/media/:mediaAssetId (ADMIN, or ENGINEER assigned to project)
router.delete('/:mediaAssetId', authenticateToken, authorizeRole('ADMIN', 'ENGINEER'), async (req, res) => {
  try {
    const { id: projectId, mediaAssetId } = req.params;

    if (req.user.role === 'ENGINEER') {
      const assigned = await isEngineerAssigned(projectId, req.user.userId);
      if (!assigned) {
        return res.status(403).json({ error: 'Forbidden: not assigned to this project' });
      }
    }

    // Fetch-then-delete-by-id (rather than deleteMany) because the S3 cleanup
    // below needs the asset's url - the projectId filter here is still what
    // confirms the asset actually belongs to *this* project.
    const asset = await prisma.mediaAsset.findFirst({ where: { id: mediaAssetId, projectId } });
    if (!asset) {
      return res.status(404).json({ error: 'Media asset not found' });
    }

    await prisma.mediaAsset.delete({ where: { id: asset.id } });

    // Best-effort: the MediaAsset row is the source of truth, not the object's
    // presence in storage, so a storage failure here shouldn't fail the
    // delete the user asked for (same fire-and-forget pattern as elsewhere).
    deleteObject(keyFromPublicUrl(asset.url)).catch((err) =>
      console.error('Failed to delete S3 object for media asset:', err.message)
    );

    res.status(204).end();
  } catch (err) {
    console.error('Delete media asset error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
