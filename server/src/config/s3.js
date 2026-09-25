const { S3Client } = require('@aws-sdk/client-s3');

const s3Client = new S3Client({
  endpoint: process.env.AWS_S3_ENDPOINT,
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true, // required for MinIO (path-style bucket addressing)
  // Since @aws-sdk/client-s3 3.729 the default is WHEN_SUPPORTED, which makes
  // getSignedUrl() bake an x-amz-checksum-crc32 of an *empty* body into every
  // presigned PUT. Any real file uploaded through that URL then fails with
  // BadDigest - on AWS S3 and S3-compatible stores alike. Only compute
  // checksums where an operation actually requires one.
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
});

module.exports = s3Client;
