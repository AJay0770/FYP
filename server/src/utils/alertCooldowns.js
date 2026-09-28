/**
 * Safety-alert cooldowns, shared by the alert intake route
 * (routes/internal/safety.js) and the webcam assignment route
 * (routes/cameraDevice.js).
 *
 * 15 minutes, not the old 60s: the same person standing bare-headed for a while
 * shouldn't re-alert every minute. Keyed per camera, then per enrolled worker
 * (or "unidentified" when no face matched), then violation type - so a
 * *different* worker's violation is never suppressed by this one.
 *
 * Starting a feed resets its camera's cooldowns (resetCamera): when a user
 * points the webcam at a camera, the first violation on that new feed should
 * alert immediately rather than stay silent because of an earlier session.
 *
 * In-memory as specified. Two consequences worth knowing:
 *  - a server restart clears it, so one duplicate alert can slip through
 *  - it is per-process, so multiple instances behind a load balancer each keep
 *    their own window
 * Move to Redis if either matters.
 */
const COOLDOWN_MS = 15 * 60_000;

const lastAlertAt = new Map();

// Stop the map growing without bound on a long-running server with many cameras.
setInterval(() => {
  const cutoff = Date.now() - COOLDOWN_MS;
  for (const [key, timestamp] of lastAlertAt) {
    if (timestamp < cutoff) lastAlertAt.delete(key);
  }
}, 5 * 60_000).unref();

function cooldownKey(cameraId, workerId, violationType) {
  return `${cameraId}:${workerId || 'unidentified'}:${violationType}`;
}

/** Forget every cooldown for one camera, so its next violation alerts at once. */
function resetCamera(cameraId) {
  const prefix = `${cameraId}:`;
  for (const key of lastAlertAt.keys()) {
    if (key.startsWith(prefix)) lastAlertAt.delete(key);
  }
}

module.exports = { COOLDOWN_MS, lastAlertAt, cooldownKey, resetCamera };
