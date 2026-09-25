/**
 * Setup checker for a fresh machine: reports what is missing or misconfigured
 * across all three services, without starting anything or printing secrets.
 *
 *   npm run doctor            # from the repo root or server/
 *
 * FAIL = the app will not work until fixed. WARN = one feature is degraded, or
 * a service simply isn't started yet. Exit code is 1 if anything FAILed.
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const dotenv = require('dotenv');

const SERVER_DIR = path.join(__dirname, '..');
const REPO_ROOT = path.join(SERVER_DIR, '..');
const AI_DIR = path.join(REPO_ROOT, 'ai-service');

const results = [];
function report(level, name, detail = '') {
  results.push(level);
  console.log(`  ${level.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ''}`);
}
const pass = (n, d) => report('PASS', n, d);
const warn = (n, d) => report('WARN', n, d);
const fail = (n, d) => report('FAIL', n, d);

function readEnv(file) {
  return fs.existsSync(file) ? dotenv.parse(fs.readFileSync(file)) : null;
}

async function reachable(url, timeoutMs = 3000) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('\nBuildSite 360 setup check\n');

  // --- Node -----------------------------------------------------------------
  console.log('Node / server');
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 20) pass('Node.js version', process.versions.node);
  else fail('Node.js version', `${process.versions.node}; need 20 or newer`);

  const serverEnv = readEnv(path.join(SERVER_DIR, '.env'));
  if (!serverEnv) {
    fail('server/.env', 'missing; copy server/.env.example and fill it in');
  } else {
    pass('server/.env', 'present');
    // Load it so the checks below (Prisma, S3 client, ffmpeg) see the same
    // configuration the server will run with.
    dotenv.config({ path: path.join(SERVER_DIR, '.env') });
    const required = [
      'DATABASE_URL', 'JWT_SECRET', 'JWT_REFRESH_SECRET', 'X_INTERNAL_TOKEN',
      'AWS_S3_BUCKET', 'AWS_S3_ENDPOINT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
    ];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length) fail('required server variables', `not set: ${missing.join(', ')}`);
    else pass('required server variables', 'all set');
  }

  // --- Client ---------------------------------------------------------------
  if (fs.existsSync(path.join(REPO_ROOT, 'client', '.env.local'))) pass('client/.env.local', 'present');
  else warn('client/.env.local', 'missing; the client falls back to http://localhost:3000/api (copy client/.env.local.example)');

  // --- Database ---------------------------------------------------------------
  console.log('\nDatabase');
  if (process.env.DATABASE_URL) {
    const prisma = require('../src/utils/prisma');
    try {
      await prisma.$queryRaw`SELECT 1`;
      pass('PostgreSQL connection');
      const onDisk = fs
        .readdirSync(path.join(SERVER_DIR, 'prisma', 'migrations'), { withFileTypes: true })
        .filter((d) => d.isDirectory()).length;
      const rows = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
      const applied = rows[0].n;
      if (applied >= onDisk) pass('migrations applied', `${applied}/${onDisk}`);
      else fail('migrations applied', `${applied}/${onDisk}; run: cd server && npx prisma migrate deploy`);
    } catch (err) {
      const noTable = /_prisma_migrations/.test(err.message);
      fail('PostgreSQL', noTable
        ? 'connected, but no migrations applied; run: cd server && npx prisma migrate deploy'
        : 'cannot connect; check DATABASE_URL and that PostgreSQL is running');
    } finally {
      await prisma.$disconnect();
    }
  }

  // --- Media tooling / storage ---------------------------------------------
  console.log('\nVideo and storage');
  const { FFMPEG_BIN, isAvailable } = require('../src/utils/ffmpeg');
  if (await isAvailable()) pass('ffmpeg', FFMPEG_BIN === 'ffmpeg' ? 'found on PATH' : 'found at FFMPEG_PATH');
  else fail('ffmpeg', 'not found; install it and put it on PATH, or set FFMPEG_PATH in server/.env (camera tiles and clips need it)');

  if (process.env.AWS_S3_ENDPOINT && process.env.AWS_S3_BUCKET) {
    const { HeadBucketCommand } = require('@aws-sdk/client-s3');
    const s3 = require('../src/config/s3');
    try {
      await s3.send(new HeadBucketCommand({ Bucket: process.env.AWS_S3_BUCKET }));
      pass('object storage', `bucket "${process.env.AWS_S3_BUCKET}" reachable`);
    } catch (err) {
      const code = err?.$metadata?.httpStatusCode;
      warn('object storage', code === 404
        ? `bucket "${process.env.AWS_S3_BUCKET}" does not exist`
        : `not reachable at ${process.env.AWS_S3_ENDPOINT}; start it with: npm run storage (reports, media uploads, clips and alert images need it)`);
    }
  }

  // --- AI service --------------------------------------------------------------
  console.log('\nAI service');
  const aiEnv = readEnv(path.join(AI_DIR, '.env'));
  if (!aiEnv) {
    fail('ai-service/.env', 'missing; copy ai-service/.env.example');
  } else {
    pass('ai-service/.env', 'present');
    if (!aiEnv.X_INTERNAL_TOKEN) fail('X_INTERNAL_TOKEN (ai-service)', 'not set');
    else if (process.env.X_INTERNAL_TOKEN && aiEnv.X_INTERNAL_TOKEN !== process.env.X_INTERNAL_TOKEN) {
      fail('X_INTERNAL_TOKEN', 'differs between server/.env and ai-service/.env; alerts and attendance will be rejected');
    } else pass('X_INTERNAL_TOKEN', 'matches the server');
  }

  const venvPython = process.platform === 'win32'
    ? path.join(AI_DIR, 'venv', 'Scripts', 'python.exe')
    : path.join(AI_DIR, 'venv', 'bin', 'python');
  if (!fs.existsSync(venvPython)) {
    fail('Python venv', 'ai-service/venv not found; create it with Python 3.10 or 3.11 (see README)');
  } else {
    const version = execFileSync(venvPython, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])']).toString().trim();
    if (['3.10', '3.11'].includes(version)) pass('Python venv', `Python ${version}`);
    else fail('Python venv', `Python ${version}; face recognition needs 3.10 or 3.11`);
    try {
      execFileSync(venvPython, ['-c', 'import cv2, fastapi, ultralytics, deepface'], { stdio: 'ignore', cwd: AI_DIR });
      pass('Python packages', 'cv2, fastapi, ultralytics, deepface import');
    } catch {
      fail('Python packages', 'missing or broken; run: venv pip install -r requirements.txt');
    }
  }

  // Same resolution as safety_stream.py's resolve_model_path(): relative paths
  // are tried against ai-service/ first, then the repo root.
  const configured = (aiEnv && aiEnv.YOLO_MODEL_PATH) || 'models/best.pt';
  const modelPath = [path.resolve(AI_DIR, configured), path.resolve(REPO_ROOT, configured)].find((p) => fs.existsSync(p));
  if (modelPath) pass('YOLO model', path.relative(REPO_ROOT, modelPath));
  else warn('YOLO model', `${configured} not found; streams work but without helmet detection (it is not in git; copy best.pt in)`);

  const streamUrl = (process.env.SAFETY_STREAM_URL || 'http://127.0.0.1:8554').replace(/\/$/, '');
  const aiUrl = (process.env.PYTHON_AI_SERVICE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
  if (await reachable(`${streamUrl}/health`)) pass('detection service', `running at ${streamUrl}`);
  else warn('detection service', `not running at ${streamUrl}; start: cd ai-service && venv python safety_stream.py`);
  if (await reachable(`${aiUrl}/health`)) pass('enrolment service', `running at ${aiUrl}`);
  else warn('enrolment service', `not running at ${aiUrl}; start: cd ai-service && venv python main.py`);

  const failed = results.filter((r) => r === 'FAIL').length;
  const warned = results.filter((r) => r === 'WARN').length;
  console.log(`\n${failed} failed, ${warned} warning(s), ${results.length - failed - warned} passed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('doctor crashed:', err);
  process.exit(1);
});
