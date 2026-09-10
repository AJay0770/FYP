---
name: debugging
description: Systematically investigate and fix software bugs in this Node/Express, React/Vite, Prisma/PostgreSQL, and Python/FastAPI (YOLOv8 + DeepFace) monorepo. Use when the user reports an error, unexpected behavior, crash, or failing test.
---

# Debugging

Act as a senior debugging engineer for BuildSite 360.

## Rules

Do not immediately modify code.

First understand the problem.

## Debugging Process

1. Read the error message carefully.
2. Identify the relevant files.
3. Trace the execution path.
4. Inspect related functions and components.
5. Determine the root cause.
6. Explain the root cause.
7. Propose the smallest appropriate fix.
8. Implement the fix only after understanding the cause.
9. Run relevant tests.
10. Verify that the original problem is resolved.

## Where to Look, By Symptom

- **401/403 on an API call**: check `server/src/middleware/auth.js` (`verifyJWT` returns `null` rather than throwing, so a bad/expired token looks identical to a missing one) and, for project-scoped routes, `utils/projectAccess.js`. Some project-scoped routes deliberately return 404 instead of 403 for "no access" so a user can't confirm a resource exists — that's by design, not a bug.
- **Socket.io messages not arriving**: check `sockets/auth.js` (connection-time auth), `sockets/rooms.js` (clients must join `project:<id>` to receive project-scoped events), and whether `utils/io.js`'s `getIO()` was called before `initSockets()` ran (returns `undefined` if so).
- **Camera stream / RTSP issues**: check that `utils/ffmpeg.js`'s `detectTimeoutFlag()` ran at startup (it logs which flag it picked) — ffmpeg ≤5 uses `-stimeout`, 6+ uses `-timeout`, and picking the wrong one makes ffmpeg refuse to start for *every* stream, not just the broken one. Also check `utils/cameraSource.js`'s classification if a camera source is rejected as malformed/unsafe.
- **Safety detection stream (`/api/stream/safety`) failing**: this proxies to the Python AI service (`SAFETY_STREAM_URL`/`STREAM_PORT`, default `http://127.0.0.1:8554`) — confirm that process is actually running before assuming a Node bug. `routes/safetyDetection.js` forwards the AI service's own JSON error body when it responds with non-200.
- **AI service won't start / `deepface` import errors**: check the Python version first — `deepface` needs TensorFlow, which has no wheels for Python 3.12+. `ai-service/main.py` wraps the `/enroll` router import defensively, so a broken DeepFace install shows as "WARNING: /enroll unavailable" in the console rather than crashing `/health`.
- **YOLO model errors**: `services/safety_detector.py` requires `models/best.pt` to exist and raises `FileNotFoundError` if it doesn't (see `TRAINING.md`) — expected until the model is trained, not a bug to chase.
- **Frontend not reflecting backend changes**: check the Axios instance/interceptors in `client/src/api/axios.js` for token attachment and refresh-on-401 behavior, and confirm `CORS_ORIGIN` on the server matches the Vite dev origin (`http://localhost:5173`).
- **Prisma errors**: `P2002` = unique constraint (e.g. duplicate `AttendanceRecord` for `[workerId, date]`, duplicate `ProjectEngineer` assignment); `P2025` = record not found on update/delete. Most routes catch these generically into a 500 — check the server console for the actual Prisma error code, not just the generic client-facing message.

## Important

Do not:

- Guess the root cause without inspecting the code.
- Randomly modify multiple files.
- Rewrite working code unnecessarily.
- Hide or suppress errors just to make them disappear.
- Remove tests to make them pass.

## Verifying a Fix

This project has no unit-test framework to run automatically. Depending on where the fix landed:

- **Backend/API**: run `npm run test:e2e` in `server/` (reseeds the database via `scripts/seed-comprehensive.js` — don't point it at data you care about) or check the specific endpoint manually against a running `npm run dev`.
- **AI service**: run `python test_integration.py` (use `--skip camera` / `--skip model` etc. for stages not relevant to the fix).
- **Frontend**: there is no automated test — verify manually in the browser per the README's Quick Start, exercising the actual flow that was broken.

## Final Response

Explain:

- Root cause
- Files changed
- What was changed
- Tests performed
- Whether the problem was successfully resolved
