const { spawn } = require('child_process');
const { classifySource } = require('./cameraSource');

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

/**
 * `-rtsp_transport`/the socket-timeout flag are RTSP demuxer options - this
 * build of ffmpeg does not silently ignore an option a demuxer doesn't
 * recognise, it hard-fails the whole input with "Option not found". So these
 * can only be added for an actually-RTSP URL; every other source (HTTP, a
 * local file, the AI-service redirect below) gets a plain generic input.
 */
function genericInputArgs(url) {
  return ['-loglevel', 'error', '-i', url];
}

/**
 * A raw multipart MJPEG stream (a real HTTP camera, or the AI-service redirect
 * below) carries no real per-frame timestamps, so ffmpeg's demuxer guesses a
 * fixed rate (observed: 25fps) and stamps every frame against that guess
 * instead of when it actually arrived. That guess is faster than this stream
 * actually delivers frames (~7-12fps in practice - STREAM_FPS-throttled and
 * capped by real camera/inference throughput), so anything duration-based
 * (`-t 30` for a clip) counts against the wrong clock: it waits for enough
 * frames to fill 30 seconds AT THE GUESSED RATE, which at the real delivery
 * rate takes ~3x longer in wall-clock time than the requested duration - a
 * "30 second" clip could take 90+ real seconds and blow through any sane
 * timeout. `-use_wallclock_as_timestamps` stamps frames by real arrival time
 * instead, so `-t N` means N real seconds, matching what a viewer actually
 * experiences.
 */
function liveHttpInputArgs(url) {
  return ['-loglevel', 'error', '-use_wallclock_as_timestamps', '1', '-i', url];
}

function rtspInputArgs(rtspUrl, timeoutSeconds) {
  return [
    '-loglevel', 'error',
    '-rtsp_transport', 'tcp', // UDP drops packets and produces smeared frames
    timeoutFlag, String(timeoutSeconds * 1_000_000),
    '-i', rtspUrl,
  ];
}

// Same default as routes/safetyDetection.js's AI_SERVICE_URL - kept as a
// separate constant rather than imported, since importing a route module
// into a utility would invert the dependency direction for no real benefit.
const AI_SERVICE_URL = (
  process.env.SAFETY_STREAM_URL || `http://127.0.0.1:${process.env.STREAM_PORT || 8554}`
).replace(/\/$/, '');

/**
 * Build the ffmpeg input args for whatever shape `source` is.
 *
 * RTSP/HTTP/file sources open directly, unchanged. A bare device index (a
 * local webcam - see utils/cameraSource.js) is NOT opened directly by ffmpeg:
 * a local camera can only be held open by one process at a time on Windows
 * (DirectShow has no shared-access mode), and the Python AI service
 * (safety_stream.py) already owns it for live detection - a second, direct
 * `ffmpeg -f dshow -i video=...` open fails with "device already in use by
 * other application" the moment detection is running, which defeats the
 * point (the whole reason to relay a local device is to watch/record the
 * same feed detection is already using).
 *
 * Instead, a device-index source is redirected to the AI service's own
 * `/stream` endpoint (annotated by default, so a recorded clip shows the
 * same helmet/vest/head boxes the live view does) and ffmpeg reads that as
 * a plain HTTP MJPEG input - the exact same code path already used for a
 * real network camera, just pointed at the service that holds the device
 * instead of the device itself. This also means only the AI service ever
 * touches the physical camera, so there is nothing left to contend over.
 */
function buildInputArgs(source, timeoutSeconds, cameraId) {
  const { type } = classifySource(source);

  if (type === 'device_index') {
    const url = new URL('/stream', AI_SERVICE_URL);
    url.searchParams.set('source', source);
    if (cameraId) url.searchParams.set('cameraId', cameraId);
    return liveHttpInputArgs(url.toString());
  }

  if (type === 'rtsp') {
    return rtspInputArgs(source, timeoutSeconds);
  }

  if (type === 'http') {
    return liveHttpInputArgs(source);
  }

  return genericInputArgs(source);
}

/**
 * Spawn ffmpeg to transcode a camera source into a stream of JPEG frames on stdout.
 */
function spawnMjpeg(source, { fps = 10, timeoutSeconds = 10, cameraId } = {}) {
  return spawn(FFMPEG_BIN, [
    ...buildInputArgs(source, timeoutSeconds, cameraId),
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
function spawnClipCapture(source, outputPath, { durationSeconds = 30, timeoutSeconds = 10, cameraId } = {}) {
  return spawn(FFMPEG_BIN, [
    ...buildInputArgs(source, timeoutSeconds, cameraId),
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
