/**
 * Audits every route's actual authorization against the spec.
 *
 * This is a BEHAVIOURAL audit, not a static one: it issues real requests with
 * real tokens for each role and compares the observed status against what the
 * spec says should happen. Static analysis of middleware chains would miss
 * in-handler checks (several routes enforce assignment inside the handler rather
 * than via authorizeRole), and would also happily pass a route whose middleware
 * looks right but whose logic is wrong.
 *
 *   npm run audit:roles     # server must be running, DB seeded via seed:full
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');

const SEED = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'tests', 'seed-output.json'), 'utf8')
);
const BASE = SEED.baseUrl;
const { ids, tokens, internalToken } = SEED;

// Outcome classes we assert on.
const ALLOW = 'allow';   // 2xx
const DENY = 'deny';     // 403 (authenticated but not permitted)
const HIDDEN = 'hidden'; // 404 (exists, but must not leak existence)
const UNAUTH = 'unauth'; // 401

function classify(status) {
  if (status >= 200 && status < 300) return ALLOW;
  if (status === 401) return UNAUTH;
  if (status === 403) return DENY;
  if (status === 404) return HIDDEN;
  return `http_${status}`;
}

/**
 * Spec table. `expect` maps role -> required outcome.
 * project1 is owned by client1 and assigned to engineer1;
 * engineer2 and client2 have no relationship to it.
 */
const SPEC = [
  // --- Projects ---
  { name: 'GET /projects (list, role-scoped)', method: 'GET', url: `${BASE}/projects`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW } },

  { name: 'GET /projects/:id (owner client)', method: 'GET', url: `${BASE}/projects/${ids.project1}`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  { name: 'PUT /projects/:id (ADMIN only)', method: 'PUT', url: `${BASE}/projects/${ids.project1}`,
    body: { status: 'ACTIVE' },
    expect: { admin: ALLOW, engineer1: DENY, client1: DENY } },

  { name: 'POST /projects/:id/assign-engineer (ADMIN only)', method: 'POST',
    url: `${BASE}/projects/${ids.project1}/assign-engineer`, body: { engineerId: ids.engineer2 },
    expect: { engineer1: DENY, client1: DENY } },

  // --- Site updates ---
  { name: 'GET updates (role-scoped)', method: 'GET', url: `${BASE}/projects/${ids.project1}/updates`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  { name: 'POST updates (assigned ENGINEER only)', method: 'POST',
    url: `${BASE}/projects/${ids.project1}/updates`, body: { description: 'audit probe' },
    expect: { engineer1: ALLOW, engineer2: DENY, admin: DENY, client1: DENY } },

  { name: 'POST updates/presign (assigned ENGINEER only)', method: 'POST',
    url: `${BASE}/projects/${ids.project1}/updates/presign`,
    body: { fileName: 'a.jpg', contentType: 'image/jpeg' },
    expect: { engineer1: ALLOW, engineer2: DENY, admin: DENY, client1: DENY } },

  // --- Materials ---
  { name: 'GET materials (role-scoped)', method: 'GET', url: `${BASE}/projects/${ids.project1}/materials`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  { name: 'GET materials/summary (role-scoped)', method: 'GET',
    url: `${BASE}/projects/${ids.project1}/materials/summary`,
    expect: { admin: ALLOW, client1: ALLOW, client2: HIDDEN } },

  { name: 'POST materials (assigned ENGINEER only)', method: 'POST',
    url: `${BASE}/projects/${ids.project1}/materials`,
    body: { name: 'Audit', category: 'X', entryType: 'RECEIVED', quantity: 1, unitCost: 1, date: '2026-01-01' },
    expect: { engineer1: ALLOW, engineer2: DENY, admin: DENY, client1: DENY } },

  // --- Chat ---
  { name: 'GET chat/history (role-scoped)', method: 'GET',
    url: `${BASE}/projects/${ids.project1}/chat/history`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  // --- Cameras ---
  { name: 'GET cameras (role-scoped)', method: 'GET', url: `${BASE}/projects/${ids.project1}/cameras`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  { name: 'POST cameras (ADMIN or assigned ENGINEER)', method: 'POST',
    url: `${BASE}/projects/${ids.project1}/cameras`,
    body: { name: 'Audit Cam', zone: 'STORAGE', rtspUrl: 'rtsp://127.0.0.1:8554/testcam' },
    expect: { admin: ALLOW, engineer1: ALLOW, engineer2: DENY, client1: DENY } },

  // --- Safety ---
  { name: 'GET safety-alerts (role-scoped)', method: 'GET',
    url: `${BASE}/projects/${ids.project1}/safety-alerts`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  // --- Workers / attendance ---
  { name: 'GET workers (role-scoped)', method: 'GET', url: `${BASE}/projects/${ids.project1}/workers`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, client2: HIDDEN } },

  { name: 'GET attendance (role-scoped)', method: 'GET',
    url: `${BASE}/projects/${ids.project1}/attendance?range=daily`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  // --- Analytics / reports ---
  { name: 'GET analytics (role-scoped)', method: 'GET', url: `${BASE}/projects/${ids.project1}/analytics`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, engineer2: HIDDEN, client2: HIDDEN } },

  { name: 'GET reports (role-scoped)', method: 'GET', url: `${BASE}/projects/${ids.project1}/reports`,
    expect: { admin: ALLOW, engineer1: ALLOW, client1: ALLOW, client2: HIDDEN } },

  { name: 'POST reports/generate-now (ADMIN only)', method: 'POST',
    url: `${BASE}/projects/${ids.project1}/reports/generate-now`, body: { reportType: 'DAILY' },
    expect: { engineer1: DENY, client1: DENY } },

  // --- Billing ---
  { name: 'GET billing/subscription (ADMIN only)', method: 'GET', url: `${BASE}/billing/subscription`,
    expect: { admin: ALLOW, engineer1: DENY, client1: DENY } },

  { name: 'POST billing/checkout (ADMIN only)', method: 'POST', url: `${BASE}/billing/checkout`,
    body: { plan: 'PRO', provider: 'EASYPAISA' },
    expect: { engineer1: DENY, client1: DENY } },
];

// Endpoints that must reject anything without the shared internal secret.
const INTERNAL_SPEC = [
  { name: 'POST /internal/safety-alert', url: `${BASE}/internal/safety-alert`,
    body: { cameraId: ids.cameraWorkArea, violationType: 'NO_HELMET', confidence: 0.9 } },
  { name: 'POST /internal/attendance-record', url: `${BASE}/internal/attendance-record`,
    body: { workerId: ids.worker1, confidence: 0.9 } },
];

const ROLE_TOKEN = {
  admin: tokens.adminToken,
  engineer1: tokens.engineer1Token,
  engineer2: tokens.engineer2Token,
  client1: tokens.client1Token,
  client2: tokens.client2Token,
};

async function request(method, url, token, body) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.status;
}

async function main() {
  const findings = [];
  let checks = 0;

  console.log('Auditing route authorization against spec...\n');

  for (const route of SPEC) {
    for (const [role, expected] of Object.entries(route.expect)) {
      checks++;
      const status = await request(route.method, route.url, ROLE_TOKEN[role], route.body);
      const actual = classify(status);

      if (actual !== expected) {
        findings.push({
          severity: expected === ALLOW ? 'HIGH (over-restrictive)' : 'CRITICAL (over-permissive)',
          route: route.name,
          role,
          expected,
          actual,
          status,
        });
      }
    }
  }

  // Unauthenticated access must be rejected everywhere.
  for (const route of SPEC) {
    checks++;
    const status = await request(route.method, route.url, null, route.body);
    if (classify(status) !== UNAUTH) {
      findings.push({
        severity: 'CRITICAL (no auth required)',
        route: route.name,
        role: '(none)',
        expected: UNAUTH,
        actual: classify(status),
        status,
      });
    }
  }

  // Expired tokens must be rejected everywhere.
  for (const route of SPEC) {
    checks++;
    const status = await request(route.method, route.url, tokens.expiredToken, route.body);
    if (classify(status) !== UNAUTH) {
      findings.push({
        severity: 'CRITICAL (expired token accepted)',
        route: route.name,
        role: '(expired)',
        expected: UNAUTH,
        actual: classify(status),
        status,
      });
    }
  }

  // Internal endpoints: no token, wrong token, and a *user* JWT must all fail.
  for (const route of INTERNAL_SPEC) {
    for (const [label, headerValue] of [
      ['no token', null],
      ['wrong token', 'not-the-secret'],
      ['user JWT instead of internal secret', tokens.adminToken],
    ]) {
      checks++;
      const headers = { 'Content-Type': 'application/json' };
      if (headerValue) headers['X-Internal-Token'] = headerValue;
      const res = await fetch(route.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(route.body),
      });
      if (res.status !== 401) {
        findings.push({
          severity: 'CRITICAL (internal endpoint unguarded)',
          route: `${route.name} [${label}]`,
          role: '(internal)',
          expected: UNAUTH,
          actual: classify(res.status),
          status: res.status,
        });
      }
    }
    // And the correct secret must work.
    checks++;
    const ok = await fetch(route.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Token': internalToken },
      body: JSON.stringify(route.body),
    });
    if (ok.status >= 400) {
      findings.push({
        severity: 'HIGH (valid internal token rejected)',
        route: `${route.name} [valid token]`,
        role: '(internal)',
        expected: ALLOW,
        actual: classify(ok.status),
        status: ok.status,
      });
    }
  }

  console.log(`Ran ${checks} authorization checks.\n`);

  if (findings.length === 0) {
    console.log('PASS: no mismatches between code and spec.');
    return;
  }

  console.log(`FAIL: ${findings.length} mismatch(es):\n`);
  for (const f of findings) {
    console.log(`  [${f.severity}]`);
    console.log(`    route    : ${f.route}`);
    console.log(`    role     : ${f.role}`);
    console.log(`    expected : ${f.expected}`);
    console.log(`    actual   : ${f.actual} (HTTP ${f.status})\n`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Audit failed to run:', err.message);
  process.exitCode = 2;
});
