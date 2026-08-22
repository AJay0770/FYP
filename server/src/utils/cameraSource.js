/**
 * Classifies the many shapes a "camera" can take in this system.
 *
 * `Camera.rtspUrl` is named for the common case but is not restricted to RTSP:
 * a phone running IP Webcam serves HTTP MJPEG, a demo runs off a video file,
 * and a laptop webcam is just a device index. The AI service accepts all of
 * them, so the API only has to recognise a source well enough to validate it
 * and to report the type back to the UI.
 *
 * Types: http | rtsp | rtmp | file | v4l2 | device_index | unknown
 */

const DEVICE_INDEX = /^\d+$/;
const V4L2_PATH = /^\/dev\/video\d+$/;
const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/;

/**
 * @param {string} source
 * @returns {{ source: string, type: string, safe: boolean, reason?: string }}
 */
function classifySource(source) {
  const raw = typeof source === 'string' ? source.trim() : '';

  if (!raw) {
    return { source: raw, type: 'unknown', safe: false, reason: 'source is empty' };
  }

  if (DEVICE_INDEX.test(raw)) {
    return { source: raw, type: 'device_index', safe: true };
  }

  const lowered = raw.toLowerCase();

  if (lowered.startsWith('rtsp://')) return { source: raw, type: 'rtsp', safe: true };
  if (lowered.startsWith('http://') || lowered.startsWith('https://')) {
    return { source: raw, type: 'http', safe: true };
  }
  if (lowered.startsWith('rtmp://')) return { source: raw, type: 'rtmp', safe: true };
  if (V4L2_PATH.test(raw)) return { source: raw, type: 'v4l2', safe: true };

  if (raw.startsWith('/') || raw.startsWith('./') || WINDOWS_PATH.test(raw)) {
    return { source: raw, type: 'file', safe: true };
  }

  // Anything else (a bare hostname, a typo) is passed through as unknown rather
  // than guessed at: the AI service will fail to open it and say so, which is a
  // clearer error than silently prefixing a scheme the camera does not speak.
  return {
    source: raw,
    type: 'unknown',
    safe: false,
    reason: 'unrecognised source: expected rtsp://, http(s)://, a file path, /dev/videoN, or a device index',
  };
}

/**
 * A source is safe to hand to ffmpeg/OpenCV only if it cannot be read as a
 * shell argument list. Nothing here is executed through a shell, but a source
 * containing newlines or NUL bytes is malformed regardless and is rejected
 * before it reaches a subprocess.
 */
function isWellFormed(source) {
  return typeof source === 'string' && source.length > 0 && !/[\0\r\n]/.test(source);
}

module.exports = { classifySource, isWellFormed };
