const { spawn } = require('child_process');

// Allow an explicit path via env so a bundled/downloaded binary can be used
// without putting it on PATH.
const FFMPEG_BIN = process.env.FFMPEG_PATH || 'ffmpeg';

function isAvailable() {
  return new Promise((resolve) => {
    const probe = spawn(FFMPEG_BIN, ['-version']);
    probe.on('error', () => resolve(false));
    probe.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Socket-timeout flag for RTSP input, in microseconds.
 *
 * The option was renamed: ffmpeg <= 5 called it `-stimeout`, ffmpeg 6+ calls it
 * `-timeout` and rejects `-stimeout` outright with "Unrecognized option". Passing
 * the wrong one is not a soft failure — ffmpeg refuses to start at all, so every
 * stream breaks, including from healthy cameras.
 *
 * Detected once at startup and cached. Defaults to the modern spelling.
 */
let timeoutFlag = '-timeout';
let timeoutFlagResolved = false;

function detectTimeoutFlag() {
  if (timeoutFlagResolved) return Promise.resolve(timeoutFlag);

  return new Promise((resolve) => {
    const probe = spawn(FFMPEG_BIN, ['-hide_banner', '-h', 'demuxer=rtsp']);
    let output = '';

    probe.stdout.on('data', (c) => (output += c.toString()));
    probe.stderr.on('data', (c) => (output += c.toString()));

    probe.on('error', () => {
      timeoutFlagResolved = true;
      resolve(timeoutFlag); // ffmpeg missing entirely; spawn will surface ENOENT
    });

    probe.on('close', () => {
      if (/^\s*-stimeout\b/m.test(output)) {
        timeoutFlag = '-stimeout';
      } else if (/^\s*-timeout\b/m.test(output)) {
        timeoutFlag = '-timeout';
      }
      timeoutFlagResolved = true;
      console.log(`ffmpeg RTSP timeout flag detected: ${timeoutFlag}`);
      resolve(timeoutFlag);
    });
  });
}

function rtspInputArgs(rtspUrl, timeoutSeconds) {
  return [
    '-loglevel', 'error',
    '-rtsp_transport', 'tcp', // UDP drops packets and produces smeared frames
    timeoutFlag, String(timeoutSeconds * 1_000_000),
    '-i', rtspUrl,
  ];
}

/**
 * Spawn ffmpeg to transcode an RTSP source into a stream of JPEG frames on stdout.
 */
function spawnMjpeg(rtspUrl, { fps = 10, timeoutSeconds = 10 } = {}) {
  return spawn(FFMPEG_BIN, [
    ...rtspInputArgs(rtspUrl, timeoutSeconds),
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-q:v', '5',
    '-r', String(fps),
    '-',
  ]);
}

/**
 * Spawn ffmpeg to capture a fixed-duration clip to a file on disk.
 */
function spawnClipCapture(rtspUrl, outputPath, { durationSeconds = 30, timeoutSeconds = 10 } = {}) {
  return spawn(FFMPEG_BIN, [
    ...rtspInputArgs(rtspUrl, timeoutSeconds),
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-pix_fmt', 'yuv420p',
    '-an',
    '-y',
    outputPath,
  ]);
}

module.exports = { FFMPEG_BIN, isAvailable, detectTimeoutFlag, spawnMjpeg, spawnClipCapture };
