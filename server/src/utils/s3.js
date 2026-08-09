const crypto = require('crypto');
const { PutObjectCommand } = require('@aws-sdk/client-s3');
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

module.exports = { generatePresignedUrl, getPublicUrl, uploadBuffer };
