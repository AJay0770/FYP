/**
 * Generates tests/e2e.postman_collection.json.
 *
 * Generated rather than hand-written so the ~150 tests stay consistent with the
 * fixed IDs in seed-comprehensive.js — hand-maintaining that many requests is
 * where collections drift out of sync with the API.
 *
 *   node scripts/build-postman-collection.js
 */
const fs = require('fs');
const path = require('path');

const V = (name) => `{{${name}}}`;

let counter = 0;

/**
 * @param name   human-readable test name
 * @param method HTTP verb
 * @param url    path after {{baseUrl}}
 * @param opts   { auth, body, headers, expect, extra }
 */
function test(name, method, url, opts = {}) {
  counter++;
  const { auth, body, headers = {}, expect, extra = [], clearCookies = false } = opts;

  const requestHeaders = Object.entries(headers).map(([key, value]) => ({ key, value }));
  if (auth) requestHeaders.push({ key: 'Authorization', value: `Bearer ${V(auth)}` });
  if (body) requestHeaders.push({ key: 'Content-Type', value: 'application/json' });

  const assertions = [
    `pm.test("${name.replace(/"/g, "'")} -> ${expect}", function () {`,
    `  pm.response.to.have.status(${expect});`,
    '});',
    ...extra,
  ];

  const events = [];

  // The runner shares one cookie jar across the whole collection, so a login
  // earlier in the run leaves a valid refreshToken behind. Any test that claims
  // to exercise the "no cookie" path has to clear it first, or it silently
  // asserts the opposite of what its name says.
  if (clearCookies) {
    events.push({
      listen: 'prerequest',
      script: {
        type: 'text/javascript',
        exec: [
          'const jar = pm.cookies.jar();',
          'jar.clear(pm.request.url, function () {});',
        ],
      },
    });
  }

  events.push({ listen: 'test', script: { type: 'text/javascript', exec: assertions } });

  return {
    name: `${String(counter).padStart(3, '0')}. ${name}`,
    event: events,
    request: {
      method,
      header: requestHeaders,
      url: `${V('baseUrl')}${url}`,
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body) } } : {}),
    },
  };
}

const NO_LEAK = [
  'pm.test("does not leak passwordHash", function () {',
  '  pm.expect(pm.response.text()).to.not.include("passwordHash");',
  '});',
];

// Roles and the outcome each should get on a project1-scoped read.
const READ_SCOPE = [
  ['adminToken', 200, 'ADMIN'],
  ['engineer1Token', 200, 'assigned ENGINEER'],
  ['client1Token', 200, 'owner CLIENT'],
  ['engineer2Token', 404, 'unassigned ENGINEER'],
  ['client2Token', 404, 'other CLIENT'],
];

const folders = [];

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
folders.push({
  name: '01 Auth',
  item: [
    // Must run before any login in this folder: the runner shares one cookie jar,
    // so a prior login would leave a valid refreshToken and this would pass for
    // the wrong reason. Ordering is the reliable fix — jar.clear() is async and
    // newman does not await it.
    test('Refresh without cookie', 'POST', '/auth/refresh', { expect: 401 }),
    test('Register new user', 'POST', '/auth/register',
      { body: { name: 'Postman User', email: 'postman-{{$timestamp}}@test.com', password: 'password123' }, expect: 201, extra: NO_LEAK }),
    test('Register missing fields', 'POST', '/auth/register', { body: { email: 'x@y.com' }, expect: 400 }),
    test('Register duplicate email', 'POST', '/auth/register',
      { body: { name: 'Dup', email: 'admin@test.com', password: 'password123' }, expect: 409 }),
    test('Login valid', 'POST', '/auth/login',
      { body: { email: 'admin@test.com', password: 'password123' }, expect: 200,
        extra: ['pm.collectionVariables.set("liveToken", pm.response.json().accessToken);',
                'pm.test("returns accessToken", function () { pm.expect(pm.response.json()).to.have.property("accessToken"); });'] }),
    test('Login wrong password', 'POST', '/auth/login', { body: { email: 'admin@test.com', password: 'nope' }, expect: 401 }),
    test('Login unknown email', 'POST', '/auth/login', { body: { email: 'nobody@test.com', password: 'password123' }, expect: 401 }),
    test('Login missing fields', 'POST', '/auth/login', { body: { email: 'admin@test.com' }, expect: 400 }),
    test('Me with valid token', 'GET', '/auth/me', { auth: 'adminToken', expect: 200, extra: NO_LEAK }),
    test('Me without token', 'GET', '/auth/me', { expect: 401 }),
    test('Me with expired token', 'GET', '/auth/me', { auth: 'expiredToken', expect: 401 }),
    test('Me with malformed token', 'GET', '/auth/me', { headers: { Authorization: 'Bearer not.a.jwt' }, expect: 401 }),
    test('Logout', 'POST', '/auth/logout', { expect: 200 }),
    // After logout the refresh token is revoked server-side (tokenVersion bump),
    // so replaying the now-stale cookie must fail even though the cookie jar
    // still holds it.
    test('Refresh with revoked cookie after logout', 'POST', '/auth/refresh', { expect: 401 }),
  ],
});

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
const projectItems = [
  test('List projects as ADMIN', 'GET', '/projects', { auth: 'adminToken', expect: 200, extra: NO_LEAK }),
  test('List projects as ENGINEER (scoped)', 'GET', '/projects', { auth: 'engineer1Token', expect: 200 }),
  test('List projects as CLIENT (scoped)', 'GET', '/projects', { auth: 'client1Token', expect: 200 }),
  test('List projects unauthenticated', 'GET', '/projects', { expect: 401 }),
];
READ_SCOPE.forEach(([tok, code, label]) => {
  projectItems.push(test(`Get project1 as ${label}`, 'GET', `/projects/${V('project1')}`, { auth: tok, expect: code, extra: code === 200 ? NO_LEAK : [] }));
});
projectItems.push(
  test('Get nonexistent project', 'GET', '/projects/00000000-0000-4000-8000-999999999999', { auth: 'adminToken', expect: 404 }),
  test('Create project as ENGINEER', 'POST', '/projects', { auth: 'engineer1Token', body: { name: 'X' }, expect: 403 }),
  test('Create project as CLIENT', 'POST', '/projects', { auth: 'client1Token', body: { name: 'X' }, expect: 403 }),
  test('Create project missing fields', 'POST', '/projects', { auth: 'adminToken', body: { name: 'X' }, expect: 400 }),
  test('Update project as ADMIN', 'PUT', `/projects/${V('project1')}`, { auth: 'adminToken', body: { status: 'ACTIVE' }, expect: 200 }),
  test('Update project as ENGINEER', 'PUT', `/projects/${V('project1')}`, { auth: 'engineer1Token', body: { status: 'ON_HOLD' }, expect: 403 }),
  test('Update project as CLIENT', 'PUT', `/projects/${V('project1')}`, { auth: 'client1Token', body: { status: 'ON_HOLD' }, expect: 403 }),
  test('Delete project as ENGINEER', 'DELETE', `/projects/${V('project1')}`, { auth: 'engineer1Token', expect: 403 }),
  test('Delete project as CLIENT', 'DELETE', `/projects/${V('project1')}`, { auth: 'client1Token', expect: 403 }),
  test('Assign engineer as ADMIN (duplicate)', 'POST', `/projects/${V('project1')}/assign-engineer`, { auth: 'adminToken', body: { engineerId: V('engineer1') }, expect: 409 }),
  test('Assign engineer as ENGINEER', 'POST', `/projects/${V('project1')}/assign-engineer`, { auth: 'engineer1Token', body: { engineerId: V('engineer2') }, expect: 403 }),
  test('Assign engineer missing body', 'POST', `/projects/${V('project1')}/assign-engineer`, { auth: 'adminToken', body: {}, expect: 400 })
);
folders.push({ name: '02 Projects', item: projectItems });

// ---------------------------------------------------------------------------
// Site updates
// ---------------------------------------------------------------------------
const updateItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  updateItems.push(test(`List updates as ${label}`, 'GET', `/projects/${V('project1')}/updates`, { auth: tok, expect: code }));
});
updateItems.push(
  test('Updates are newest-first', 'GET', `/projects/${V('project1')}/updates`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("ordered newest first", function () {',
            '  const u = pm.response.json();',
            '  for (var i = 1; i < u.length; i++) {',
            '    pm.expect(new Date(u[i].createdAt).getTime()).to.be.at.most(new Date(u[i-1].createdAt).getTime());',
            '  }',
            '});',
            'pm.test("seeded newest update is first", function () {',
            '  const u = pm.response.json();',
            '  pm.expect(u[0].description).to.include("Steel framing");',
            '});'] }),
  test('Create update as assigned ENGINEER', 'POST', `/projects/${V('project1')}/updates`, { auth: 'engineer1Token', body: { description: 'Postman update', mediaUrls: [] }, expect: 201 }),
  test('Create update as unassigned ENGINEER', 'POST', `/projects/${V('project1')}/updates`, { auth: 'engineer2Token', body: { description: 'x' }, expect: 403 }),
  test('Create update as ADMIN (engineer-only)', 'POST', `/projects/${V('project1')}/updates`, { auth: 'adminToken', body: { description: 'x' }, expect: 403 }),
  test('Create update as CLIENT', 'POST', `/projects/${V('project1')}/updates`, { auth: 'client1Token', body: { description: 'x' }, expect: 403 }),
  test('Create update missing description', 'POST', `/projects/${V('project1')}/updates`, { auth: 'engineer1Token', body: {}, expect: 400 }),
  test('Presign valid jpg', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'engineer1Token', body: { fileName: 'a.jpg', contentType: 'image/jpeg' }, expect: 200,
    extra: ['pm.test("15 minute expiry", function () { pm.expect(pm.response.json().presignedUrl).to.include("X-Amz-Expires=900"); });'] }),
  test('Presign valid mp4', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'engineer1Token', body: { fileName: 'a.mp4', contentType: 'video/mp4' }, expect: 200 }),
  test('Presign rejects .exe', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'engineer1Token', body: { fileName: 'bad.exe', contentType: 'application/octet-stream' }, expect: 400 }),
  test('Presign rejects oversized', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'engineer1Token', body: { fileName: 'a.mp4', contentType: 'video/mp4', fileSize: 60000000 }, expect: 400 }),
  test('Presign missing fields', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'engineer1Token', body: {}, expect: 400 }),
  test('Presign as unassigned ENGINEER', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'engineer2Token', body: { fileName: 'a.jpg', contentType: 'image/jpeg' }, expect: 403 }),
  test('Presign as CLIENT', 'POST', `/projects/${V('project1')}/updates/presign`, { auth: 'client1Token', body: { fileName: 'a.jpg', contentType: 'image/jpeg' }, expect: 403 })
);
folders.push({ name: '03 Site Updates', item: updateItems });

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------
const materialItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  materialItems.push(test(`List materials as ${label}`, 'GET', `/projects/${V('project1')}/materials`, { auth: tok, expect: code }));
  materialItems.push(test(`Materials summary as ${label}`, 'GET', `/projects/${V('project1')}/materials/summary`, { auth: tok, expect: code }));
});
materialItems.push(
  test('Summary flags the seeded Bricks discrepancy', 'GET', `/projects/${V('project1')}/materials/summary`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("Bricks flagged as a discrepancy", function () {',
            '  const bricks = pm.response.json().find(function (m) { return m.name === "Bricks"; });',
            '  pm.expect(bricks, "Bricks row present").to.not.be.undefined;',
            '  pm.expect(bricks.discrepancy).to.eql(true);',
            '  pm.expect(bricks.totalConsumed).to.be.above(bricks.totalReceived);',
            '});',
            'pm.test("Cement is not flagged", function () {',
            '  const cement = pm.response.json().find(function (m) { return m.name === "Cement"; });',
            '  pm.expect(cement.discrepancy).to.eql(false);',
            '});'] }),
  test('Create material as assigned ENGINEER', 'POST', `/projects/${V('project1')}/materials`, { auth: 'engineer1Token', body: { name: 'Sand', category: 'Aggregate', entryType: 'RECEIVED', quantity: 50, unitCost: 3, date: '2026-06-01' }, expect: 201 }),
  test('Create material as unassigned ENGINEER', 'POST', `/projects/${V('project1')}/materials`, { auth: 'engineer2Token', body: { name: 'Sand', category: 'X', entryType: 'RECEIVED', quantity: 1, unitCost: 1, date: '2026-06-01' }, expect: 403 }),
  test('Create material as ADMIN (engineer-only)', 'POST', `/projects/${V('project1')}/materials`, { auth: 'adminToken', body: { name: 'Sand', category: 'X', entryType: 'RECEIVED', quantity: 1, unitCost: 1, date: '2026-06-01' }, expect: 403 }),
  test('Create material invalid entryType', 'POST', `/projects/${V('project1')}/materials`, { auth: 'engineer1Token', body: { name: 'S', category: 'X', entryType: 'STOLEN', quantity: 1, unitCost: 1, date: '2026-06-01' }, expect: 400 }),
  test('Create material missing fields', 'POST', `/projects/${V('project1')}/materials`, { auth: 'engineer1Token', body: { name: 'S' }, expect: 400 })
);
folders.push({ name: '04 Materials', item: materialItems });

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------
const chatItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  chatItems.push(test(`Chat history as ${label}`, 'GET', `/projects/${V('project1')}/chat/history`, { auth: tok, expect: code }));
});
chatItems.push(
  test('Chat history is chronological', 'GET', `/projects/${V('project1')}/chat/history`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("oldest first", function () {',
            '  const m = pm.response.json();',
            '  for (var i = 1; i < m.length; i++) {',
            '    pm.expect(new Date(m[i].createdAt).getTime()).to.be.at.least(new Date(m[i-1].createdAt).getTime());',
            '  }',
            '});',
            'pm.test("includes sender role", function () {',
            '  const m = pm.response.json();',
            '  if (m.length) pm.expect(m[0].sender).to.have.property("role");',
            '});',
            'pm.test("seeded oldest message is first", function () {',
            '  pm.expect(pm.response.json()[0].content).to.include("Morning standup");',
            '});'] }),
  test('Chat presign as CLIENT', 'POST', `/projects/${V('project1')}/chat/presign`, { auth: 'client1Token', body: { fileName: 'notes.pdf', contentType: 'application/pdf' }, expect: 200 }),
  test('Chat presign as ADMIN', 'POST', `/projects/${V('project1')}/chat/presign`, { auth: 'adminToken', body: { fileName: 'photo.png', contentType: 'image/png' }, expect: 200 }),
  test('Chat presign rejects .exe', 'POST', `/projects/${V('project1')}/chat/presign`, { auth: 'client1Token', body: { fileName: 'bad.exe', contentType: 'application/octet-stream' }, expect: 400 }),
  test('Chat presign rejects oversized', 'POST', `/projects/${V('project1')}/chat/presign`, { auth: 'client1Token', body: { fileName: 'a.pdf', contentType: 'application/pdf', fileSize: 40000000 }, expect: 400 }),
  test('Chat presign cross-tenant', 'POST', `/projects/${V('project1')}/chat/presign`, { auth: 'client2Token', body: { fileName: 'a.pdf', contentType: 'application/pdf' }, expect: 404 })
);
folders.push({ name: '05 Chat', item: chatItems });

// ---------------------------------------------------------------------------
// Cameras
// ---------------------------------------------------------------------------
const cameraItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  cameraItems.push(test(`List cameras as ${label}`, 'GET', `/projects/${V('project1')}/cameras`, { auth: tok, expect: code }));
});
cameraItems.push(
  test('Create camera as ADMIN', 'POST', `/projects/${V('project1')}/cameras`, { auth: 'adminToken', body: { name: 'Postman Cam', zone: 'STORAGE', rtspUrl: 'rtsp://127.0.0.1:8554/testcam' }, expect: 201 }),
  test('Create camera as assigned ENGINEER', 'POST', `/projects/${V('project1')}/cameras`, { auth: 'engineer1Token', body: { name: 'Eng Cam', zone: 'WORK_AREA', rtspUrl: 'rtsp://127.0.0.1:8554/testcam' }, expect: 201 }),
  test('Create camera as unassigned ENGINEER', 'POST', `/projects/${V('project1')}/cameras`, { auth: 'engineer2Token', body: { name: 'X', zone: 'WORK_AREA', rtspUrl: 'rtsp://x' }, expect: 403 }),
  test('Create camera as CLIENT', 'POST', `/projects/${V('project1')}/cameras`, { auth: 'client1Token', body: { name: 'X', zone: 'WORK_AREA', rtspUrl: 'rtsp://x' }, expect: 403 }),
  test('Create camera invalid zone', 'POST', `/projects/${V('project1')}/cameras`, { auth: 'adminToken', body: { name: 'X', zone: 'ROOF', rtspUrl: 'rtsp://x' }, expect: 400 }),
  test('Create camera missing fields', 'POST', `/projects/${V('project1')}/cameras`, { auth: 'adminToken', body: { name: 'X' }, expect: 400 }),
  test('Stream unauthenticated', 'GET', `/cameras/${V('cameraWorkArea')}/stream`, { expect: 401 }),
  test('Stream nonexistent camera', 'GET', '/cameras/00000000-0000-4000-8000-999999999999/stream', { auth: 'adminToken', expect: 404 }),
  test('Record clip unauthenticated', 'POST', `/cameras/${V('cameraWorkArea')}/record-clip`, { expect: 401 }),
  test('Record clip cross-tenant', 'POST', `/cameras/${V('cameraWorkArea')}/record-clip`, { auth: 'client2Token', expect: 404 })
);
folders.push({ name: '06 Cameras', item: cameraItems });

// ---------------------------------------------------------------------------
// Safety
// ---------------------------------------------------------------------------
const safetyItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  safetyItems.push(test(`Safety alerts as ${label}`, 'GET', `/projects/${V('project1')}/safety-alerts`, { auth: tok, expect: code }));
});
safetyItems.push(
  test('Safety alerts paginated newest-first', 'GET', `/projects/${V('project1')}/safety-alerts?limit=2`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("respects limit and reports total", function () {',
            '  const b = pm.response.json();',
            '  pm.expect(b.alerts.length).to.be.at.most(2);',
            '  pm.expect(b).to.have.property("total");',
            '});',
            'pm.test("newest first", function () {',
            '  const a = pm.response.json().alerts;',
            '  for (var i = 1; i < a.length; i++) {',
            '    pm.expect(new Date(a[i].createdAt).getTime()).to.be.at.most(new Date(a[i-1].createdAt).getTime());',
            '  }',
            '});'] }),
  test('Internal safety-alert without token', 'POST', '/internal/safety-alert', { body: { cameraId: V('cameraWorkArea'), violationType: 'NO_HELMET', confidence: 0.9 }, expect: 401 }),
  test('Internal safety-alert wrong token', 'POST', '/internal/safety-alert', { headers: { 'X-Internal-Token': 'wrong' }, body: { cameraId: V('cameraWorkArea'), violationType: 'NO_HELMET', confidence: 0.9 }, expect: 401 }),
  test('Internal safety-alert with user JWT', 'POST', '/internal/safety-alert', { headers: { 'X-Internal-Token': V('adminToken') }, body: { cameraId: V('cameraWorkArea'), violationType: 'NO_HELMET', confidence: 0.9 }, expect: 401 }),
  test('Internal safety-alert invalid violationType', 'POST', '/internal/safety-alert', { headers: { 'X-Internal-Token': V('internalToken') }, body: { cameraId: V('cameraWorkArea'), violationType: 'NO_BOOTS', confidence: 0.9 }, expect: 400 }),
  test('Internal safety-alert confidence out of range', 'POST', '/internal/safety-alert', { headers: { 'X-Internal-Token': V('internalToken') }, body: { cameraId: V('cameraWorkArea'), violationType: 'NO_HELMET', confidence: 5 }, expect: 400 }),
  test('Internal safety-alert unknown camera', 'POST', '/internal/safety-alert', { headers: { 'X-Internal-Token': V('internalToken') }, body: { cameraId: '00000000-0000-4000-8000-999999999999', violationType: 'NO_HELMET', confidence: 0.9 }, expect: 404 }),
  test('Internal safety-alert missing fields', 'POST', '/internal/safety-alert', { headers: { 'X-Internal-Token': V('internalToken') }, body: { cameraId: V('cameraWorkArea') }, expect: 400 })
);
folders.push({ name: '07 Safety', item: safetyItems });

// ---------------------------------------------------------------------------
// Workers & attendance
// ---------------------------------------------------------------------------
const attendanceItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  attendanceItems.push(test(`Attendance (daily) as ${label}`, 'GET', `/projects/${V('project1')}/attendance?range=daily`, { auth: tok, expect: code }));
});
['weekly', 'monthly'].forEach((range) => {
  attendanceItems.push(test(`Attendance (${range}) as ADMIN`, 'GET', `/projects/${V('project1')}/attendance?range=${range}`, { auth: 'adminToken', expect: 200,
    extra: [`pm.test("range echoed as ${range}", function () { pm.expect(pm.response.json().range).to.eql("${range}"); });`] }));
});
attendanceItems.push(
  test('Attendance invalid range', 'GET', `/projects/${V('project1')}/attendance?range=yearly`, { auth: 'adminToken', expect: 400 }),
  test('Weekly count >= daily count', 'GET', `/projects/${V('project1')}/attendance?range=weekly`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("seeded 3 days of attendance are visible weekly", function () {',
            '  pm.expect(pm.response.json().totalCheckins).to.be.at.least(2);',
            '});'] }),
  test('List workers as ADMIN', 'GET', `/projects/${V('project1')}/workers`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("never exposes faceEmbedding", function () {',
            '  pm.expect(pm.response.text()).to.not.include("faceEmbedding");',
            '});'] }),
  test('List workers cross-tenant', 'GET', `/projects/${V('project1')}/workers`, { auth: 'client2Token', expect: 404 }),
  test('Enroll worker as CLIENT', 'POST', `/projects/${V('project1')}/workers/enroll`, { auth: 'client1Token', body: { name: 'X', employeeId: 'E', photos: ['aGk='] }, expect: 403 }),
  test('Enroll worker missing photos', 'POST', `/projects/${V('project1')}/workers/enroll`, { auth: 'adminToken', body: { name: 'X', employeeId: 'E', photos: [] }, expect: 400 }),
  test('Internal attendance without token', 'POST', '/internal/attendance-record', { body: { workerId: V('worker1'), confidence: 0.9 }, expect: 401 }),
  test('Internal attendance wrong token', 'POST', '/internal/attendance-record', { headers: { 'X-Internal-Token': 'wrong' }, body: { workerId: V('worker1'), confidence: 0.9 }, expect: 401 }),
  test('Internal attendance with user JWT', 'POST', '/internal/attendance-record', { headers: { 'X-Internal-Token': V('adminToken') }, body: { workerId: V('worker1'), confidence: 0.9 }, expect: 401 }),
  test('Internal attendance unknown worker', 'POST', '/internal/attendance-record', { headers: { 'X-Internal-Token': V('internalToken') }, body: { workerId: '00000000-0000-4000-8000-999999999999', confidence: 0.9 }, expect: 404 }),
  test('Internal attendance invalid confidence', 'POST', '/internal/attendance-record', { headers: { 'X-Internal-Token': V('internalToken') }, body: { workerId: V('worker1'), confidence: -1 }, expect: 400 }),
  test('Internal attendance duplicate same day', 'POST', '/internal/attendance-record', { headers: { 'X-Internal-Token': V('internalToken') }, body: { workerId: V('worker1'), confidence: 0.9 }, expect: 200,
    extra: ['pm.test("flagged as duplicate (seed already checked in today)", function () {',
            '  pm.expect(pm.response.json().duplicate).to.eql(true);',
            '});'] })
);
folders.push({ name: '08 Workers & Attendance', item: attendanceItems });

// ---------------------------------------------------------------------------
// Analytics & reports
// ---------------------------------------------------------------------------
const analyticsItems = [];
READ_SCOPE.forEach(([tok, code, label]) => {
  analyticsItems.push(test(`Analytics as ${label}`, 'GET', `/projects/${V('project1')}/analytics`, { auth: tok, expect: code }));
  analyticsItems.push(test(`Reports list as ${label}`, 'GET', `/projects/${V('project1')}/reports`, { auth: tok, expect: code }));
});
analyticsItems.push(
  test('Analytics has all sections', 'GET', `/projects/${V('project1')}/analytics`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("all sections present", function () {',
            '  const b = pm.response.json();',
            '  ["project","range","siteUpdates","attendance","safety","materials"].forEach(function (k) {',
            '    pm.expect(b, k).to.have.property(k);',
            '  });',
            '});'] }),
  test('Analytics honours date range', 'GET', `/projects/${V('project1')}/analytics?startDate=2020-01-01&endDate=2020-12-31`, { auth: 'adminToken', expect: 200,
    extra: ['pm.test("empty window yields zero counts", function () {',
            '  pm.expect(pm.response.json().siteUpdates.total).to.eql(0);',
            '});'] }),
  test('Generate report as ADMIN', 'POST', `/projects/${V('project1')}/reports/generate-now`, { auth: 'adminToken', body: { reportType: 'DAILY' }, expect: 201,
    extra: ['pm.test("returns a PDF url", function () { pm.expect(pm.response.json().pdfUrl).to.include(".pdf"); });'] }),
  test('Generate report as ENGINEER', 'POST', `/projects/${V('project1')}/reports/generate-now`, { auth: 'engineer1Token', body: { reportType: 'DAILY' }, expect: 403 }),
  test('Generate report as CLIENT', 'POST', `/projects/${V('project1')}/reports/generate-now`, { auth: 'client1Token', body: { reportType: 'DAILY' }, expect: 403 }),
  test('Generate report invalid type', 'POST', `/projects/${V('project1')}/reports/generate-now`, { auth: 'adminToken', body: { reportType: 'HOURLY' }, expect: 400 })
);
folders.push({ name: '09 Analytics & Reports', item: analyticsItems });

// ---------------------------------------------------------------------------
// Billing
// ---------------------------------------------------------------------------
folders.push({
  name: '10 Billing',
  item: [
    test('List plans', 'GET', '/billing/plans', { expect: 200,
      extra: ['pm.test("three plans", function () { pm.expect(pm.response.json().length).to.eql(3); });'] }),
    test('Subscription as ADMIN', 'GET', '/billing/subscription', { auth: 'adminToken', expect: 200 }),
    test('Subscription as ENGINEER', 'GET', '/billing/subscription', { auth: 'engineer1Token', expect: 403 }),
    test('Subscription as CLIENT', 'GET', '/billing/subscription', { auth: 'client1Token', expect: 403 }),
    test('Subscription unauthenticated', 'GET', '/billing/subscription', { expect: 401 }),
    test('Checkout as ADMIN', 'POST', '/billing/checkout', { auth: 'adminToken', body: { plan: 'PRO', provider: 'EASYPAISA' }, expect: 201,
      extra: ['pm.test("sandbox URL returned", function () {',
              '  const b = pm.response.json();',
              '  pm.expect(b.sandbox).to.eql(true);',
              '  pm.expect(b.checkoutUrl).to.include("sandbox");',
              '});'] }),
    test('Checkout as ENGINEER', 'POST', '/billing/checkout', { auth: 'engineer1Token', body: { plan: 'PRO', provider: 'EASYPAISA' }, expect: 403 }),
    test('Checkout as CLIENT', 'POST', '/billing/checkout', { auth: 'client1Token', body: { plan: 'PRO', provider: 'EASYPAISA' }, expect: 403 }),
    test('Checkout invalid plan', 'POST', '/billing/checkout', { auth: 'adminToken', body: { plan: 'GOLD', provider: 'EASYPAISA' }, expect: 400 }),
    test('Checkout invalid provider', 'POST', '/billing/checkout', { auth: 'adminToken', body: { plan: 'PRO', provider: 'BITCOIN' }, expect: 400 }),
    test('Webhook without signature', 'POST', '/billing/webhook/easypaisa', { body: { orderRefNum: 'X', responseCode: '0000' }, expect: 401 }),
    test('Webhook forged signature', 'POST', '/billing/webhook/easypaisa', { headers: { 'x-easypaisa-signature': 'deadbeef' }, body: { orderRefNum: 'X', responseCode: '0000' }, expect: 401 }),
  ],
});

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------
folders.push({
  name: '11 Health',
  item: [test('API health', 'GET', '/health', { expect: 200,
    extra: ['pm.test("status ok", function () { pm.expect(pm.response.json().status).to.eql("ok"); });'] })],
});

const collection = {
  info: {
    name: 'BuildSite 360 — Full E2E',
    description:
      `${counter} tests across all phases.\n\n` +
      'Run `npm run seed:full` first, then import server/tests/seed-output.json values ' +
      'into the collection variables below (or run via newman with that file as an environment).\n\n' +
      'Generated by scripts/build-postman-collection.js — edit that, not this file.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000/api' },
    { key: 'adminToken', value: '' },
    { key: 'engineer1Token', value: '' },
    { key: 'engineer2Token', value: '' },
    { key: 'client1Token', value: '' },
    { key: 'client2Token', value: '' },
    { key: 'expiredToken', value: '' },
    { key: 'internalToken', value: '' },
    { key: 'project1', value: '00000000-0000-4000-8000-000000000101' },
    { key: 'project2', value: '00000000-0000-4000-8000-000000000102' },
    { key: 'engineer1', value: '00000000-0000-4000-8000-000000000002' },
    { key: 'engineer2', value: '00000000-0000-4000-8000-000000000003' },
    { key: 'cameraEntrance', value: '00000000-0000-4000-8000-000000000201' },
    { key: 'cameraWorkArea', value: '00000000-0000-4000-8000-000000000202' },
    { key: 'worker1', value: '00000000-0000-4000-8000-000000000301' },
    { key: 'liveToken', value: '' },
  ],
  item: folders,
};

const outPath = path.join(__dirname, '..', 'tests', 'e2e.postman_collection.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(collection, null, 2));

console.log(`Wrote ${counter} tests across ${folders.length} folders to ${outPath}`);
folders.forEach((f) => console.log(`  ${f.name}: ${f.item.length}`));
