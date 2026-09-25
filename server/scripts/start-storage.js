/**
 * Local S3-compatible object storage for development, via SeaweedFS.
 *
 *   npm run storage        # from the repo root or server/
 *
 * MinIO (the original choice) archived its open-source server and stopped
 * distributing binaries, so this runs SeaweedFS's single-process `weed mini`
 * instead. Nothing in the app changes: it still talks plain S3 to
 * AWS_S3_ENDPOINT with the AWS_* keys.
 *
 * Everything is derived from server/.env so the storage and the API can never
 * disagree: the S3 port comes from AWS_S3_ENDPOINT, the credentials from
 * AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY, the bucket from AWS_S3_BUCKET, and
 * the browser origin allowed to upload (CORS) from CORS_ORIGIN.
 *
 * Binary: `weed` on PATH, or SEAWEEDFS_BIN pointing at it. Data lives in
 * STORAGE_DATA_DIR (default: <repo>/storage-data, which git ignores).
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const REPO_ROOT = path.join(__dirname, '..', '..');

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set in server/.env; storage cannot start without it.`);
    process.exit(1);
  }
  return value;
}

const endpoint = new URL(required('AWS_S3_ENDPOINT'));
const bucket = required('AWS_S3_BUCKET');
const accessKey = required('AWS_ACCESS_KEY_ID');
const secretKey = required('AWS_SECRET_ACCESS_KEY');
const s3Port = endpoint.port || (endpoint.protocol === 'https:' ? '443' : '80');
const allowedOrigins = process.env.CORS_ORIGIN || 'http://localhost:5173';

const dataDir = path.resolve(process.env.STORAGE_DATA_DIR || path.join(REPO_ROOT, 'storage-data'));
fs.mkdirSync(dataDir, { recursive: true });

// SeaweedFS identities. The app's keys get full access. The anonymous identity
// may only *read* this one bucket: stored URLs (utils/s3.js getPublicUrl) are
// shown directly in <img>/<a> tags, which cannot sign requests. Writes still
// require the app's keys or a presigned URL the API issued.
//
// Written into the data directory, not the repo, because it contains the
// secret key.
const s3ConfigPath = path.join(dataDir, 's3-identities.json');
fs.writeFileSync(
  s3ConfigPath,
  JSON.stringify(
    {
      identities: [
        {
          name: 'buildsite-app',
          credentials: [{ accessKey, secretKey }],
          actions: ['Admin', 'Read', 'List', 'Tagging', 'Write'],
        },
        { name: 'anonymous', actions: [`Read:${bucket}`] },
      ],
    },
    null,
    2
  ),
  { mode: 0o600 }
);

const bin = process.env.SEAWEEDFS_BIN || 'weed';
const args = [
  'mini',
  `-dir=${dataDir}`,
  // Loopback only: this is a dev store holding uploads and violation images.
  '-ip=127.0.0.1',
  '-ip.bind=127.0.0.1',
  `-s3.port=${s3Port}`,
  `-s3.config=${s3ConfigPath}`,
  `-s3.allowedOrigins=${allowedOrigins}`,
  `-bucket=${bucket}`,
  // Unused extras that would otherwise claim ports.
  '-s3.port.iceberg=0',
  '-admin.ui=false',
];

console.log(`Starting SeaweedFS S3 on ${endpoint.protocol}//127.0.0.1:${s3Port} (bucket "${bucket}", data in ${dataDir})`);

const child = spawn(bin, args, { stdio: 'inherit' });

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error(
      `SeaweedFS binary not found ("${bin}"). Download it from ` +
        'https://github.com/seaweedfs/seaweedfs/releases and either put `weed` on PATH ' +
        'or set SEAWEEDFS_BIN in server/.env to its full path.'
    );
  } else {
    console.error('Failed to start SeaweedFS:', err.message);
  }
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));

// Forward Ctrl+C so the storage shuts down cleanly with the launcher.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
