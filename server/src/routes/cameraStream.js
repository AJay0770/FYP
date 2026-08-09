const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const { authenticateTokenAllowQuery } = require('../middleware/auth');
const { userHasProjectAccess } = require('../utils/projectAccess');
const { spawnMjpeg } = require('../utils/ffmpeg');

const BOUNDARY = 'buildsite360frame';
const JPEG_SOI = Buffer.from([0xff, 0xd8]); // start of image
const JPEG_EOI = Buffer.from([0xff, 0xd9]); // end of image
const FIRST_FRAME_TIMEOUT_MS = 12_000;

async function setCameraStatus(cameraId, status) {
  try {
    await prisma.camera.update({ where: { id: cameraId }, data: { status } });
  } catch (err) {
    console.error(`Failed to set camera ${cameraId} status to ${status}:`, err.message);
  }
}

/**
 * GET /api/cameras/:id/stream
 *
 * Relays an RTSP source as multipart/x-mixed-replace MJPEG, viewable directly
 * in an <img> tag.
 *
 * Note on auth: browsers cannot set an Authorization header on <img src>, so
 * this accepts the token via ?token= as well as the usual header. That places
 * the token in the URL (and therefore in server logs and browser history),
 * which is the standard trade-off for <img>-based MJPEG. A production
 * deployment should prefer a short-lived, stream-scoped token over the
 * session access token — see the note in README.
 */
router.get('/:id/stream', authenticateTokenAllowQuery, async (req, res) => {
  const { id: cameraId } = req.params;

  let camera;
  try {
    camera = await prisma.camera.findUnique({ where: { id: cameraId } });
  } catch (err) {
    console.error('Stream lookup error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }

  if (!camera) {
    return res.status(404).json({ error: 'Camera not found' });
  }

  const hasAccess = await userHasProjectAccess(camera.projectId, req.user);
  if (!hasAccess) {
    return res.status(404).json({ error: 'Camera not found' });
  }

  let ffmpeg;
  try {
    ffmpeg = spawnMjpeg(camera.rtspUrl);
  } catch (err) {
    await setCameraStatus(cameraId, 'OFFLINE');
    return res.status(502).json({ error: 'Failed to start video pipeline' });
  }

  let headersSent = false;
  let buffer = Buffer.alloc(0);
  let settled = false;
  // Distinguishes "the viewer closed the tab" from "the camera dropped". Without
  // this, every normal disconnect would mark a perfectly healthy camera OFFLINE,
  // so the dashboard would show all cameras dead whenever nobody is watching.
  let clientDisconnected = false;

  // If no frame arrives in time the source is unreachable. Fail the request
  // rather than holding the connection open indefinitely.
  const firstFrameTimer = setTimeout(async () => {
    if (headersSent || settled) return;
    settled = true;
    ffmpeg.kill('SIGKILL');
    await setCameraStatus(cameraId, 'OFFLINE');
    if (!res.headersSent) {
      res.status(504).json({ error: 'Camera unreachable: no frames received' });
    }
  }, FIRST_FRAME_TIMEOUT_MS);

  const cleanup = () => {
    clientDisconnected = true;
    clearTimeout(firstFrameTimer);
    if (!ffmpeg.killed) ffmpeg.kill('SIGKILL');
  };

  ffmpeg.on('error', async (err) => {
    if (settled) return;
    settled = true;
    clearTimeout(firstFrameTimer);
    console.error(`ffmpeg spawn error for camera ${cameraId}:`, err.message);
    await setCameraStatus(cameraId, 'OFFLINE');
    if (!res.headersSent) {
      const isMissing = err.code === 'ENOENT';
      res.status(isMissing ? 501 : 502).json({
        error: isMissing ? 'ffmpeg is not installed on the server' : 'Video pipeline error',
      });
    } else {
      res.end();
    }
  });

  ffmpeg.stderr.on('data', (chunk) => {
    console.error(`[camera ${cameraId}] ffmpeg: ${chunk.toString().trim()}`);
  });

  // Deliberately NOT an async handler. Awaiting anything between the
  // `headersSent` check and res.writeHead() lets a second 'data' event slip
  // through and call res.write() first, which makes Node flush its own default
  // headers — the stream then arrives with no Content-Type and no <img> tag
  // will render it. Header write must be synchronous; the DB update is
  // fire-and-forget.
  ffmpeg.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // ffmpeg writes concatenated JPEGs; split them on SOI/EOI markers so each
    // is emitted as its own multipart part.
    while (true) {
      const start = buffer.indexOf(JPEG_SOI);
      if (start === -1) break;
      const end = buffer.indexOf(JPEG_EOI, start + 2);
      if (end === -1) break;

      const frame = buffer.subarray(start, end + 2);
      buffer = buffer.subarray(end + 2);

      if (!headersSent) {
        headersSent = true;
        settled = true;
        clearTimeout(firstFrameTimer);
        res.writeHead(200, {
          'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
          'Cache-Control': 'no-store, no-cache, must-revalidate',
          Pragma: 'no-cache',
          Connection: 'close',
        });
        setCameraStatus(cameraId, 'ONLINE'); // not awaited: must not delay the header
      }

      res.write(
        `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`
      );
      res.write(frame);
      res.write('\r\n');
    }
  });

  ffmpeg.on('close', async (code) => {
    clearTimeout(firstFrameTimer);
    if (!headersSent && !settled) {
      settled = true;
      await setCameraStatus(cameraId, 'OFFLINE');
      if (!res.headersSent) {
        res.status(502).json({ error: `Camera unreachable (ffmpeg exited ${code})` });
      }
      return;
    }
    if (headersSent) {
      // Frames were flowing, so the camera is reachable. Only mark it OFFLINE if
      // the feed died on its own; a viewer closing the tab says nothing about
      // camera health.
      if (!clientDisconnected) {
        await setCameraStatus(cameraId, 'OFFLINE');
      }
      res.end();
    }
  });

  // Client navigated away or closed the tab — stop transcoding immediately.
  req.on('close', cleanup);
  res.on('close', cleanup);
});

module.exports = router;
