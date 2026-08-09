const express = require('express');
const router = express.Router({ mergeParams: true });
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { generatePresignedUrl, getPublicUrl } = require('../utils/s3');

// Chat attachments are documents and photos, not site media, so the allowed set
// is broader than the site-update presign (which is images/video only).
const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'mp4', 'mov'];
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

// GET /api/projects/:id/chat/history (role-scoped)
router.get('/history', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    // Fetch newest 100 first (indexable, bounded), then reverse to chronological order.
    const recent = await prisma.chatMessage.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { sender: { select: { id: true, name: true, role: true } } },
    });

    res.json(recent.reverse());
  } catch (err) {
    console.error('Get chat history error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/projects/:id/chat/presign (role-scoped)
 *
 * Issues an upload URL for a chat attachment, so the ChatMessage.fileUrl field
 * has a supported way to be populated. Unlike the site-update presign (assigned
 * ENGINEERs only), this is open to anyone with access to the project's chat —
 * clients and admins take part in the conversation too.
 */
router.post('/presign', authenticateToken, async (req, res) => {
  try {
    const { id: projectId } = req.params;
    const { fileName, contentType, fileSize } = req.body;

    if (!fileName || !contentType) {
      return res.status(400).json({ error: 'fileName and contentType are required' });
    }

    const hasAccess = await userHasProjectAccess(projectId, req.user);
    if (!hasAccess) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const ext = fileName.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_EXTENSIONS.includes(ext)) {
      return res.status(400).json({ error: `Unsupported file type: .${ext || 'unknown'}` });
    }

    if (fileSize !== undefined && fileSize > MAX_FILE_SIZE_BYTES) {
      return res.status(400).json({ error: 'File exceeds maximum size of 25MB' });
    }

    const { presignedUrl, key } = await generatePresignedUrl(fileName, contentType);
    res.json({ presignedUrl, publicUrl: getPublicUrl(key) });
  } catch (err) {
    console.error('Chat presign error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
