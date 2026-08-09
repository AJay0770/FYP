const express = require('express');
const router = express.Router();
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const prisma = require('../utils/prisma');
const { authenticateToken } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { spawnClipCapture } = require('../utils/ffmpeg');
const { uploadBuffer } = require('../utils/s3');

const CLIP_SECONDS = 30;
// Capture is 30s; allow generous headroom for connect + encode before giving up.
const CAPTURE_TIMEOUT_MS = (CLIP_SECONDS + 30) * 1000;

function captureClip(rtspUrl, outputPath) {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawnClipCapture(rtspUrl, outputPath, { durationSeconds: CLIP_SECONDS });
    let stderr = '';

    const timer = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(Object.assign(new Error('Clip capture timed out'), { statusCode: 504 }));
    }, CAPTURE_TIMEOUT_MS);

    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(Object.assign(new Error('ffmpeg is not installed on the server'), { statusCode: 501 }));
      } else {
        reject(Object.assign(new Error(err.message), { statusCode: 502 }));
      }
    });

    ffmpeg.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) return resolve();
      reject(
        Object.assign(new Error(`ffmpeg exited ${code}: ${stderr.trim().slice(0, 300)}`), {
          statusCode: 502,
        })
      );
    });
  });
}

// POST /api/cameras/:id/record-clip
router.post('/:id/record-clip', authenticateToken, async (req, res) => {
  const { id: cameraId } = req.params;
  let tempPath;

  try {
    const camera = await prisma.camera.findUnique({ where: { id: cameraId } });
    if (!camera) return res.status(404).json({ error: 'Camera not found' });

    const hasAccess = await userHasProjectAccess(camera.projectId, req.user);
    if (!hasAccess) return res.status(404).json({ error: 'Camera not found' });

    tempPath = path.join(os.tmpdir(), `clip-${crypto.randomUUID()}.mp4`);

    await captureClip(camera.rtspUrl, tempPath);

    const buffer = await fs.readFile(tempPath);
    if (buffer.length === 0) {
      await prisma.camera.update({ where: { id: cameraId }, data: { status: 'OFFLINE' } });
      return res.status(502).json({ error: 'Camera produced an empty clip' });
    }

    const safeName = camera.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const { url } = await uploadBuffer(buffer, `${safeName}-clip.mp4`, 'video/mp4');

    await prisma.camera.update({ where: { id: cameraId }, data: { status: 'ONLINE' } });

    res.status(201).json({
      clipUrl: url,
      cameraId,
      durationSeconds: CLIP_SECONDS,
      sizeBytes: buffer.length,
    });
  } catch (err) {
    console.error('Record clip error:', err.message);

    // A capture failure means we could not reach the source.
    if (err.statusCode === 502 || err.statusCode === 504) {
      await prisma.camera
        .update({ where: { id: cameraId }, data: { status: 'OFFLINE' } })
        .catch(() => {});
    }

    res.status(err.statusCode || 500).json({ error: err.message || 'Internal server error' });
  } finally {
    if (tempPath) await fs.unlink(tempPath).catch(() => {});
  }
});

module.exports = router;
