/**
 * Cross-cutting infrastructure checks.
 *
 * The role audit proves each route guards itself. This proves the shared
 * mechanisms behave identically wherever they're used — the class of bug that
 * only shows up when you compare modules side by side:
 *
 *   1. Socket.io: one authenticated connection, one room join, all three
 *      event types (chat / safety / attendance) delivered on it.
 *   2. Internal auth: enforced identically on every /api/internal endpoint.
 *   3. S3: every upload path produces URLs from the same bucket and key shape.
 *
 *   npm run verify:infra    # server must be running, DB seeded via seed:full
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { io } = require('socket.io-client');

const SEED = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tests', 'seed-output.json'), 'utf8')
);
const BASE = SEED.baseUrl;
const ORIGIN = BASE.replace(/\/api\/?$/, '');
const { ids, tokens, internalToken } = SEED;

const results = [];
function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function post(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// 1. Socket.io — one connection carries all three real-time event types
// ---------------------------------------------------------------------------
async function checkSockets() {
  console.log('\n[1] Socket.io auth + room delivery');

  // Rejection without a token.
  await new Promise((resolve) => {
    const s = io(ORIGIN, { auth: {}, reconnection: false, forceNew: true, timeout: 5000 });
    s.on('connect', () => { record('connection without JWT is rejected', false, 'connected anyway'); s.disconnect(); resolve(); });
    s.on('connect_error', () => { record('connection without JWT is rejected', true); s.disconnect(); resolve(); });
    setTimeout(resolve, 6000);
  });

  // Unauthorized room join.
  await new Promise((resolve) => {
    const s = io(ORIGIN, { auth: { token: tokens.engineer2Token }, reconnection: false, forceNew: true });
    let done = false;
    const finish = (passed, detail) => { if (done) return; done = true; record('unauthorized project:join emits error', passed, detail); s.disconnect(); resolve(); };
    s.on('connect', () => s.emit('project:join', { projectId: ids.project1 }));
    s.on('project:joined', () => finish(false, 'join was allowed'));
    s.on('error', () => finish(true));
    setTimeout(() => finish(false, 'timed out'), 8000);
  });

  // One connection, one join, three event types.
  await new Promise((resolve) => {
    const s = io(ORIGIN, { auth: { token: tokens.adminToken }, reconnection: false, forceNew: true });
    const seen = { chat: false, safety: false, attendance: false };
    let finished = false;

    const finish = () => {
      if (finished) return;
      finished = true;
      record('chat:message delivered on shared connection', seen.chat);
      record('safety:alert delivered on shared connection', seen.safety);
      record('attendance:checkin delivered on shared connection', seen.attendance);
      s.disconnect();
      resolve();
    };

    s.on('chat:message', () => { seen.chat = true; if (seen.chat && seen.safety && seen.attendance) finish(); });
    s.on('safety:alert', () => { seen.safety = true; if (seen.chat && seen.safety && seen.attendance) finish(); });
    s.on('attendance:checkin', () => { seen.attendance = true; if (seen.chat && seen.safety && seen.attendance) finish(); });

    s.on('connect', () => s.emit('project:join', { projectId: ids.project1 }));

    s.on('project:joined', async () => {
      s.emit('chat:send', { projectId: ids.project1, content: 'infra verification probe' });

      await post(`${BASE}/internal/safety-alert`,
        { cameraId: ids.cameraWorkArea, violationType: 'NO_VEST', confidence: 0.71 },
        { 'X-Internal-Token': internalToken });

      // Attendance is once-per-day per worker; clear today's row so the event fires.
      const prisma = require('../src/utils/prisma');
      const now = new Date();
      const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
      await prisma.attendanceRecord.deleteMany({ where: { workerId: ids.worker1, date: today } });

      await post(`${BASE}/internal/attendance-record`,
        { workerId: ids.worker1, confidence: 0.9 },
        { 'X-Internal-Token': internalToken });
    });

    setTimeout(finish, 15000);
  });
}

// ---------------------------------------------------------------------------
// 2. Internal auth consistency
// ---------------------------------------------------------------------------
async function checkInternalAuth() {
  console.log('\n[2] Internal auth enforced identically on all /api/internal endpoints');

  const endpoints = [
    { name: 'safety-alert', url: `${BASE}/internal/safety-alert`,
      body: { cameraId: ids.cameraWorkArea, violationType: 'NO_HELMET', confidence: 0.8 } },
    { name: 'attendance-record', url: `${BASE}/internal/attendance-record`,
      body: { workerId: ids.worker1, confidence: 0.8 } },
  ];

  for (const ep of endpoints) {
    const noToken = await post(ep.url, ep.body);
    record(`${ep.name}: rejects missing header`, noToken.status === 401, `got ${noToken.status}`);

    const wrong = await post(ep.url, ep.body, { 'X-Internal-Token': 'wrong' });
    record(`${ep.name}: rejects wrong secret`, wrong.status === 401, `got ${wrong.status}`);

    const userJwt = await post(ep.url, ep.body, { 'X-Internal-Token': tokens.adminToken });
    record(`${ep.name}: rejects user JWT as secret`, userJwt.status === 401, `got ${userJwt.status}`);

    const valid = await post(ep.url, ep.body, { 'X-Internal-Token': internalToken });
    record(`${ep.name}: accepts valid secret`, valid.status < 400, `got ${valid.status}`);
  }
}

// ---------------------------------------------------------------------------
// 3. S3 URL consistency across every upload path
// ---------------------------------------------------------------------------
async function checkS3Consistency() {
  console.log('\n[3] S3 URL shape consistent across all upload paths');

  const bucket = process.env.AWS_S3_BUCKET;
  const endpoint = (process.env.AWS_S3_ENDPOINT || '').replace(/\/$/, '');
  const prefix = `${endpoint}/${bucket}/`;
  // Keys are `${timestamp}-${uuid}-${filename}`.
  const KEY_SHAPE = /^\d{13}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/;

  const observed = [];

  // (a) Site update presign
  const presign = await post(`${BASE}/projects/${ids.project1}/updates/presign`,
    { fileName: 'infra.jpg', contentType: 'image/jpeg' },
    { Authorization: `Bearer ${tokens.engineer1Token}` });
  if (presign.ok) {
    const { publicUrl, presignedUrl } = await presign.json();
    observed.push({ source: 'site update presign', url: publicUrl });
    record('presigned URL expires in 15 min', /X-Amz-Expires=900/.test(presignedUrl),
      presignedUrl.match(/X-Amz-Expires=\d+/)?.[0] || 'no expiry param');
  } else {
    record('site update presign reachable', false, `HTTP ${presign.status}`);
  }

  // (b) Safety alert frame upload
  // 1x1 JPEG.
  const tinyJpeg =
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
    'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
  const alert = await post(`${BASE}/internal/safety-alert`,
    { cameraId: ids.cameraEntrance, violationType: 'NO_HELMET', confidence: 0.95, frameImageBase64: tinyJpeg },
    { 'X-Internal-Token': internalToken });
  if (alert.status === 201) {
    const body = await alert.json();
    if (body.frameImageUrl) observed.push({ source: 'safety alert frame', url: body.frameImageUrl });
    else record('safety alert produced a frame URL', false, 'frameImageUrl empty');
  } else if (alert.status === 202) {
    record('safety alert frame upload', true, 'skipped (cooldown active)');
  } else {
    record('safety alert frame upload', false, `HTTP ${alert.status}`);
  }

  // (c) Generated report PDF
  const report = await post(`${BASE}/projects/${ids.project1}/reports/generate-now`,
    { reportType: 'DAILY' }, { Authorization: `Bearer ${tokens.adminToken}` });
  if (report.status === 201) {
    const body = await report.json();
    observed.push({ source: 'report PDF', url: body.pdfUrl });
  } else {
    record('report PDF upload', false, `HTTP ${report.status}`);
  }

  // Compare shapes.
  for (const item of observed) {
    const rightBucket = item.url.startsWith(prefix);
    const key = rightBucket ? item.url.slice(prefix.length) : '';
    record(`${item.source}: same bucket/endpoint`, rightBucket, rightBucket ? '' : item.url);
    record(`${item.source}: same key shape`, KEY_SHAPE.test(key), key.slice(0, 60));
  }

  // Camera clips use the same uploadBuffer() helper as the two above; recording a
  // real clip takes 30s of wall time, so this checks the code path is shared
  // rather than re-recording. Flag it explicitly rather than implying it was run.
  const clipsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'cameraClips.js'), 'utf8');
  record('camera clips use the shared uploadBuffer helper',
    /uploadBuffer/.test(clipsSource), 'static check — live 30s recording not re-run here');

  // Chat attachments (ChatMessage.fileUrl) must have a presign path of their own,
  // and it must produce the same URL shape as every other upload path.
  const chatPresign = await post(`${BASE}/projects/${ids.project1}/chat/presign`,
    { fileName: 'notes.pdf', contentType: 'application/pdf' },
    { Authorization: `Bearer ${tokens.client1Token}` });

  if (chatPresign.ok) {
    const { publicUrl } = await chatPresign.json();
    const rightBucket = publicUrl.startsWith(prefix);
    record('chat attachment presign: same bucket/endpoint', rightBucket, rightBucket ? '' : publicUrl);
    record('chat attachment presign: same key shape',
      KEY_SHAPE.test(publicUrl.slice(prefix.length)), publicUrl.slice(prefix.length, prefix.length + 60));
  } else {
    record('chat attachments have a presign endpoint', false, `HTTP ${chatPresign.status}`);
  }

  // A user with no access to the project must not get an upload URL for its chat.
  const chatPresignDenied = await post(`${BASE}/projects/${ids.project1}/chat/presign`,
    { fileName: 'notes.pdf', contentType: 'application/pdf' },
    { Authorization: `Bearer ${tokens.client2Token}` });
  record('chat presign is role-scoped', chatPresignDenied.status === 404, `got ${chatPresignDenied.status}`);
}

async function main() {
  console.log('Infrastructure verification\n' + '='.repeat(60));

  await checkSockets();
  await checkInternalAuth();
  await checkS3Consistency();

  const failed = results.filter((r) => !r.passed);
  console.log('\n' + '='.repeat(60));
  console.log(`${results.length - failed.length}/${results.length} checks passed.`);

  if (failed.length) {
    console.log('\nFailures:');
    failed.forEach((f) => console.log(`  - ${f.name}${f.detail ? ` (${f.detail})` : ''}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error('Verification failed to run:', err);
    process.exitCode = 2;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 500));
