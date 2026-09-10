---
name: security-review
description: Perform a security review of BuildSite 360 — a Node/Express + Prisma/PostgreSQL API, React/Vite frontend, and Python/FastAPI AI microservice, connected by JWT user auth and an internal shared-secret service boundary.
---

# Security Review

Act as a senior application security engineer reviewing BuildSite 360.

## This Project's Security Model

- **User auth**: JWT access token (`JWT_SECRET`, 24h expiry) + httpOnly refresh cookie (`JWT_REFRESH_SECRET`, 7d), with a `tokenVersion` counter on `User` for revocation at logout (`server/src/routes/auth.js`). Passwords hashed with bcrypt, cost factor 12.
- **Authorization**: role-based (`ADMIN`/`ENGINEER`/`CLIENT`) via `authorizeRole()`, *plus* a separate project-membership check (`utils/projectAccess.js`) required on every project-scoped route — a valid role alone does not imply access to a specific project's data.
- **Service-to-service boundary**: `/api/internal/*` (AI service → Node) is guarded by a shared secret in `X-Internal-Token`, compared in constant time (`middleware/internalAuth.js`, `crypto.timingSafeEqual`) and fails closed if the secret is unset. These routes must never be reachable from the public internet — that's enforced by network placement, not by the code.
- **Webhook signatures**: `routes/webhooks/easypaisa.js` verifies an HMAC-SHA256 signature over the *raw* request body (stashed by `express.json()`'s `verify` hook as `req.rawBody` in `index.js`, precisely so re-serializing JSON can't change the digest), compared with `crypto.timingSafeEqual`. The code itself flags that EasyPaisa's real algorithm/encoding/header is unconfirmed against their actual docs — treat that as a known open item, not a false positive to dismiss.
- **MJPEG stream auth**: `authenticateTokenAllowQuery` accepts a JWT via `?token=` because `<img src>` can't set an `Authorization` header. This is a deliberate, narrow exception (the code itself notes it leaks into logs/history/Referer) — flag any *new* route that adopts this pattern without the same `<img>`-tag justification.
- **Camera sources**: `Camera.rtspUrl` is user-supplied and not restricted to RTSP (`utils/cameraSource.js` also accepts HTTP(S), RTMP, file paths, device indices) before being handed to ffmpeg/OpenCV — anything that builds a subprocess command from it must go through `classifySource`/`isWellFormed` first.
- **Biometric data**: `Worker.faceEmbedding` stores a face embedding (JSON string) used for attendance matching — treat it as sensitive personal data. Check who can enroll/read it (`/api/projects/:id/workers/enroll`) and whether it's ever logged or returned in a response body.
- **File storage**: S3/MinIO via presigned URLs (`utils/s3.js`, `routes/updates.js`'s `/presign`) — buckets are private by default; check presigned URLs are scoped to the intended object and short-lived, not broad/reusable.

## Check

### Authentication

- JWT implementation
- Token validation
- Token expiration
- Password handling
- Session management
- `tokenVersion` revocation actually being checked on every refresh, not just login

### Authorization

- Role checks
- **Project-membership checks** (not just role) on every project-scoped route
- IDOR vulnerabilities — especially ids passed via `?cameraId=`, route params, or body that aren't re-validated against the caller's project access
- Privilege escalation

### APIs

- Input validation
- Rate limiting (none is currently configured anywhere in `server/` — flag brute-forceable endpoints like `/api/auth/login`)
- CORS (`CORS_ORIGIN` — check it isn't wildcarded in a way that undermines the cookie-based refresh flow)
- Error handling (no stack traces or Prisma internals leaking into 500 responses)
- Sensitive data exposure (`passwordHash`, `faceEmbedding`, tokens never present in a JSON response)
- HTTP security

### Web Security

- XSS
- CSRF (the refresh token is an httpOnly cookie — confirm `SameSite`/cookie flags are appropriate given the cookie crosses origins between the Vite dev server and the API)
- SQL injection (Prisma parameterizes by default — flag any raw `$queryRaw`/`$executeRaw` usage for closer review)
- Command injection (ffmpeg/OpenCV subprocess calls built from camera sources)
- Path traversal
- Unsafe file uploads (media uploaded via presigned S3 URLs — check content-type/size constraints)

### Secrets

Check for:

- API keys
- Passwords
- Tokens
- Private keys
- Credentials
- `.env`, `.env.local`, `server/.env`, `ai-service/.env` never committed (only `.env.example`/`.env.local.example` should be tracked)

Never expose or reproduce secrets in the review.

## Output

Rank findings:

CRITICAL
HIGH
MEDIUM
LOW

For every finding explain:

1. Vulnerability
2. Location
3. Attack/risk
4. Recommended mitigation

Do not modify files during the security review unless explicitly asked.
