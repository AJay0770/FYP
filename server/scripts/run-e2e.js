/**
 * One-command E2E run: seed -> build newman environment -> run the collection.
 *
 *   npm run test:e2e
 *
 * Requires the server to be running. Reseeds the database, so do not point this
 * at anything you care about.
 */
require('dotenv').config();
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER_DIR = path.join(__dirname, '..');
const TESTS_DIR = path.join(SERVER_DIR, 'tests');

function run(command, args) {
  execFileSync(command, args, { cwd: SERVER_DIR, stdio: 'inherit', shell: true });
}

(async () => {
  const base = `http://localhost:${process.env.PORT || 3000}/api`;
  try {
    const health = await fetch(`${base}/health`);
    if (!health.ok) throw new Error(`health returned ${health.status}`);
  } catch (err) {
    console.error(`Server is not reachable at ${base} (${err.message}).`);
    console.error('Start it with `npm run dev` first.');
    process.exit(1);
  }

  console.log('\n[1/3] Seeding database...');
  run('node', ['scripts/seed-comprehensive.js']);

  console.log('\n[2/3] Building collection + environment...');
  run('node', ['scripts/build-postman-collection.js']);

  const seed = JSON.parse(fs.readFileSync(path.join(TESTS_DIR, 'seed-output.json'), 'utf8'));
  const values = [
    { key: 'baseUrl', value: seed.baseUrl, enabled: true },
    { key: 'internalToken', value: seed.internalToken, enabled: true },
    ...Object.entries(seed.tokens).map(([key, value]) => ({ key, value, enabled: true })),
    ...Object.entries(seed.ids).map(([key, value]) => ({ key, value, enabled: true })),
  ];
  fs.writeFileSync(
    path.join(TESTS_DIR, 'newman-env.json'),
    JSON.stringify({ id: 'buildsite-env', name: 'BuildSite E2E', values }, null, 2)
  );

  console.log('\n[3/3] Running collection...');
  run('npx', [
    'newman', 'run', 'tests/e2e.postman_collection.json',
    '-e', 'tests/newman-env.json',
    '--reporters', 'cli',
    '--reporter-cli-no-assertions',
    '--reporter-cli-no-console',
    '--reporter-cli-no-success-assertions',
  ]);
})();
