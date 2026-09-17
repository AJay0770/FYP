const crypto = require('crypto');
const { PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3');

const BUCKET = process.env.AWS_S3_BUCKET;
const PRESIGN_EXPIRY_SECONDS = 15 * 60; // 15 minutes

// Returns { presignedUrl, key }. The key is derived here (not passed in) so
// callers can't collide on filenames; getPublicUrl(key) below reconstructs
// the eventual public URL from the same key once the upload completes.
async function generatePresignedUrl(fileName, contentType) {
  const key = `${Date.now()}-${crypto.randomUUID()}-${fileName}`;

  const command = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: PRESIGN_EXPIRY_SECONDS });

  return { presignedUrl, key };
}

function getPublicUrl(key) {
  const endpoint = (process.env.AWS_S3_ENDPOINT || '').replace(/\/$/, '');
  return `${endpoint}/${BUCKET}/${key}`;
}

/**
 * Upload a buffer directly from the server (used for artefacts the server itself
 * produces: recorded clips, alert frames, generated PDFs). Returns the public URL.
 */
async function uploadBuffer(buffer, fileName, contentType) {
  const key = `${Date.now()}-${crypto.randomUUID()}-${fileName}`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    })
  );

  return { key, url: getPublicUrl(key) };
}

// Reverses getPublicUrl() above - both must stay in sync with the same
// `${endpoint}/${BUCKET}/${key}` shape. Returns null for a URL that doesn't
// match (e.g. one predating a stored asset's current AWS_S3_ENDPOINT), since
// there's no key to delete in that case.
function keyFromPublicUrl(url) {
  const prefix = `${(process.env.AWS_S3_ENDPOINT || '').replace(/\/$/, '')}/${BUCKET}/`;
  return typeof url === 'string' && url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

// Best-effort deletion of the underlying object (used when a MediaAsset row
// is deleted). Callers should treat failure as non-fatal - the database row
// is the source of truth, not the object's presence in storage.
async function deleteObject(key) {
  if (!key) return;
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { generatePresignedUrl, getPublicUrl, uploadBuffer, deleteObject, keyFromPublicUrl };
