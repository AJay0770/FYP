---
name: api-development
description: Design and implement REST endpoints in the Express/Prisma backend — routing, validation, auth/authorization, status codes, error shape, logging, and response conventions specific to this project. Use when adding or changing an /api/* route.
---

# API Development

Act as a senior backend engineer building on BuildSite 360's existing Express API.

## When to Use

Adding a new `/api/*` route, changing request/response shape on an existing one, or wiring a new resource into the API.

## This Project's API Conventions

- Express 4, CommonJS, one router file per resource under `server/src/routes/`, mounted in `server/src/index.js`.
- Routes are nested by project id where the resource belongs to a project: `/api/projects/:id/updates`, `/materials`, `/chat`, `/cameras`, `/workers`, `/attendance`, `/analytics`, `/reports`. Resources addressed independently of a project (camera streaming/recording, the safety-detection proxy) are mounted at `/api/cameras/...` or `/api/...` instead — don't force a non-project resource into the nested shape.
- `/api/internal/*` exists solely for the AI service to call back into Node (safety alerts, attendance records, live detection pushes) — never mount a browser-facing route there.
- No request-validation library (no Joi/Zod/express-validator/express-fileupload-style schema) — validation is manual `if (!field) return res.status(400)...` at the top of the handler, matching `auth.js`/`materials.js`. Keep new routes consistent with that style rather than introducing a validation library unprompted.
- The global JSON body limit is 15mb (`index.js`), raised specifically for base64 alert frames — don't assume a smaller default, and don't raise it further per-route without reason.

## Authentication & Authorization

- Default: `authenticateToken` (Bearer JWT). Use `authenticateTokenAllowQuery` only for endpoints an `<img>`/MJPEG tag must hit directly — it's a deliberate, narrow exception (see `security-review` skill) — never adopt it as a general convenience.
- JWT payload: access token carries `{ userId, role }` (`JWT_SECRET`, 24h); `verifyJWT` returns `null` on any failure rather than throwing, so treat "invalid" and "expired" identically.
- For project-scoped routes, always apply **both** layers, in this order: `authenticateToken` → (`authorizeRole(...)` if the action is role-restricted) → `userHasProjectAccess(projectId, req.user)` (`utils/projectAccess.js`) before touching any project-owned data. A role check alone is not sufficient — it does not prove the caller belongs to *this* project.
- For AI-service → Node calls, use `internalAuth` (`middleware/internalAuth.js`) — never authenticate an internal route with a user JWT.

## HTTP Status Codes (match existing usage)

- `200` — success. `201` — resource created (e.g. register, new project). `202` — accepted for async/fire-and-forget (the internal detections push). `400` — malformed/missing input. `401` — missing or invalid token. `403` — authenticated but wrong role. `404` — not found, **and also used deliberately for "no project access"** on some routes so an unauthorized caller can't confirm a resource exists — match that pattern where it's already used, don't silently switch it to 403. `409` — conflict (e.g. duplicate email on register). `422` — semantically invalid input the type system can't catch (e.g. a malformed camera source). `500` — unhandled server error, always with a generic message.

## Error Handling

- Wrap handlers in `try/catch`; on failure, `console.error('<Context> error:', err)` then respond with a generic `{ error: '...' }` body — never forward `err.message`, a stack trace, or a raw Prisma error to the client.
- Fire-and-forget side effects (e.g. updating `Camera.status` after a stream connects) must not block or fail the primary response — `.catch()` them separately, as `safetyDetection.js` does.

## API Security

- Never trust a client-supplied `projectId`/`cameraId`/etc. without re-checking access — see Authorization above.
- Any new shared-secret or signature check must use `crypto.timingSafeEqual`, matching `internalAuth.js` and `webhooks/easypaisa.js` — never a plain `===` on a secret.
- Webhook-style signature verification must hash `req.rawBody` (stashed by the global `express.json()` verify hook), not a re-serialized JSON object.
- Never log or return `passwordHash`, `faceEmbedding`, tokens, or internal secrets in a response body.

## Logging

- `console.log`/`console.error` only — no Winston/Pino configured. Prefix messages with context the way existing routes do (`'Register error:'`, `'Safety stream proxy error:'`) so failures are greppable.
- Never log secrets, tokens, password hashes, or face embeddings.

## Pagination / Filtering

There is no consistent pagination system in this repo today — most list endpoints use a fixed `take: N` cap with no `skip`/cursor/page parameters at all (chat history: `take: 100`; safety alert history: `take: 10`). When a new endpoint genuinely needs pagination:

- Prefer a simple, explicit `?limit=&cursor=` (or `?skip=&take=`) query-param convention, applied consistently to whatever you're adding.
- Don't retrofit pagination onto an existing capped endpoint unless asked — that's a scope change, not part of adding a new feature.

## Workflow

1. Find the closest existing route for the resource shape you're adding and match its structure.
2. Decide the URL shape: project-nested vs. id-addressed vs. internal.
3. Apply the auth/authorization layers in the order above.
4. Validate the request body/params manually, matching existing style.
5. Query via the shared Prisma client (`utils/prisma.js`) — see the `database` skill for schema/query conventions.
6. Shape the response and pick the status code per the table above.
7. Wire the router into `server/src/index.js` if it's new.
8. Add the endpoint to `server/tests/e2e.postman_collection.json` (via `server/scripts/build-postman-collection.js`) — including its negative paths (missing token, wrong role, wrong project) alongside the happy path.

## Verification

Start the server (`npm run dev`) and exercise the endpoint manually, then run `npm run test:e2e` in `server/` (reseeds the database — don't point it at data you care about). Confirm 401/403/404 behavior for at least one wrong-role and one wrong-project case before calling it done.
