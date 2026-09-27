/**
 * Which camera a local device (a laptop/USB webcam, camera source "0", "1"...)
 * is assigned to.
 *
 * Several Camera rows - even in different projects - may point at the same
 * physical webcam, but only one can use it at a time. Which one is a user's
 * explicit choice: viewing, pausing or stopping a feed never moves it (see
 * routes/cameraDevice.js for the assign/release endpoints).
 *
 * The source of truth is whoever physically holds the device:
 *  - normally the AI detection service (safety_stream.py), queried over HTTP;
 *  - with LOCAL_CAMERA_DIRECT=true, this Node process, via an in-memory map
 *    (lost on restart, which simply leaves every device free).
 */
const { classifySource } = require('./cameraSource');
const { LOCAL_CAMERA_DIRECT, takeOverLocalDevice } = require('./ffmpeg');

// Same default as routes/safetyDetection.js and utils/ffmpeg.js.
const AI_SERVICE_URL = (
  process.env.SAFETY_STREAM_URL || `http://127.0.0.1:${process.env.STREAM_PORT || 8554}`
).replace(/\/$/, '');
const AI_TIMEOUT_MS = 15_000;

// device source -> cameraId, LOCAL_CAMERA_DIRECT mode only.
const directAssignments = new Map();

function isLocalDevice(source) {
  return classifySource(source).type === 'device_index';
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function aiRequest(method, path, params = {}) {
  const url = new URL(path, AI_SERVICE_URL);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  let res;
  try {
    res = await fetch(url, { method, signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
  } catch (err) {
    // Refused connection or timeout: the service that owns the webcam is down.
    throw httpError(503, 'Detection service is not running. Start it with: python safety_stream.py');
  }
  if (!res.ok) throw httpError(502, `Detection service returned HTTP ${res.status}`);
  return res.json();
}

/** cameraId currently assigned the device, or null if it is free. */
async function getHolder(source) {
  const device = String(source).trim();
  if (LOCAL_CAMERA_DIRECT) return directAssignments.get(device) || null;

  const { devices = [] } = await aiRequest('GET', '/devices');
  const held = devices.find((d) => d.source === device);
  return held ? held.cameraId : null;
}

/** Give the device to cameraId, moving it from any camera that holds it. */
async function assign(source, cameraId) {
  const device = String(source).trim();
  if (LOCAL_CAMERA_DIRECT) {
    // Free the physical device from whatever stream holds it now.
    if (directAssignments.get(device) !== cameraId) await takeOverLocalDevice(device);
    directAssignments.set(device, cameraId);
    return;
  }
  await aiRequest('POST', '/devices/assign', { source: device, cameraId });
}

/** Free the device if cameraId holds it. Returns whether anything changed. */
async function release(source, cameraId) {
  const device = String(source).trim();
  if (LOCAL_CAMERA_DIRECT) {
    if (directAssignments.get(device) !== cameraId) return false;
    directAssignments.delete(device);
    await takeOverLocalDevice(device); // ends the stream(s) using it
    return true;
  }
  const { released } = await aiRequest('POST', '/devices/release', { source: device, cameraId });
  return released;
}

module.exports = { isLocalDevice, getHolder, assign, release };
