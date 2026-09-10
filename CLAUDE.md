# CLAUDE.md

Project-wide instructions for Claude Code (and any other AI assistant) working in this repository. This is a single Git repo containing three services — read this before touching any of them.

## 1. Architecture

BuildSite 360 is a construction-site monitoring platform split into three services in one monorepo:

```
client/       React 18 + Vite frontend                (npm workspace)
server/       Node 20 + Express 4 API                  (npm workspace)
ai-service/   Python 3.10/3.11 + FastAPI ML microservice (standalone, not an npm workspace)
```

- **client/** — React 18, Vite, Axios, `socket.io-client`, Recharts. No router library: views switch manually via state in `App.jsx`. No CSS framework — hand-written design tokens in `src/styles/`. State lives in React Context (`AuthContext`), not Redux/Zustand.
- **server/** — Express 4, CommonJS (`require`/`module.exports`). Prisma 5 ORM over PostgreSQL 15 (`prisma/schema.prisma`, 14 models). Socket.io for realtime (chat, safety alerts, attendance). AWS SDK v3 for S3/MinIO file storage. `node-cron` for scheduled report generation. `ffmpeg` for RTSP camera relay/clip recording.
- **ai-service/** — FastAPI, bound to localhost only, never exposed to the browser. Ultralytics YOLOv8 + PyTorch for PPE safety detection; DeepFace/ArcFace for facial-recognition attendance; OpenCV for frame handling. **Must run on Python 3.10 or 3.11** — `deepface` pulls in TensorFlow, which has no wheels for 3.12+, so facial recognition cannot run on newer Python at all.

**API shape**: REST under `/api`, mostly nested by project id (`/api/projects/:id/updates`, `/materials`, `/chat`, `/cameras`, `/attendance`, `/analytics`, `/reports`). Camera streaming/recording and the safety-detection proxy are addressed by resource id instead, since they aren't project-nested resources. A separate `/api/internal/*` surface exists solely for the AI service to call back into Node (safety alerts, attendance records, live detection pushes), gated by a shared `X-Internal-Token`.

**Service boundary**: the browser never talks to `ai-service` directly. Node proxies the annotated safety stream and detection data (`routes/safetyDetection.js`), so camera credentials/URLs never reach the client and access control stays in one place (`utils/projectAccess.js`).

**Realtime**: Socket.io has its own connection-time auth (`sockets/auth.js`) and room-based scoping (`sockets/rooms.js` — clients join `project:<id>`). `sockets/io.js` exposes a `getIO()` singleton so route handlers can emit without a circular import.

**Data model**: PostgreSQL via Prisma, one schema for the whole app (`server/prisma/schema.prisma`). Key models: `User` (role: ADMIN/ENGINEER/CLIENT), `Project`, `ProjectEngineer` (many-to-many), `SiteUpdate`, `MaterialEntry`, `Camera`, `SafetyAlert`, `ChatMessage`, `Worker` (holds a face embedding), `AttendanceRecord`, `Subscription`, `Report`.

Do not introduce a new architectural pattern (a router library, a state-management library, a second database, a message queue, a different ORM) without discussing it first — the app is intentionally simple in these areas.

## 2. Coding Standards

- **No linter or formatter is configured** (no ESLint/Prettier config in `client/` or `server/`, no `black`/`ruff` in `ai-service/`). Match the style of the surrounding file rather than inventing a new one.
- `server/` is CommonJS (`require`, `module.exports`). `client/` is ESM (`"type": "module"`, `import`/`export`). Never mix the two within a file.
- `ai-service/` targets Python 3.10/3.11 syntax and dependency compatibility — do not use constructs or packages that require 3.12+.
- React components are functional with hooks; there is no class-component code to match.
- Keep the existing file-per-resource convention: one route file per resource in `server/src/routes/`, one service class/module per ML capability in `ai-service/services/`, one page per view in `client/src/pages/`.
- Prisma `Decimal` fields (`budgetEstimate`, `quantity`, `unitCost`, `confidenceScore`, `matchConfidence`) come back as `Decimal` objects, not plain JS numbers — handle that explicitly rather than assuming numeric operators work.
- Prefer the existing shared Prisma client (`server/src/utils/prisma.js`) over `new PrismaClient()` per file. (A few older files, e.g. `auth.js`, still instantiate their own — don't copy that into new code.)
- Comments should explain *why*, not *what* — this matches the existing codebase's style (see the extensive rationale comments in `safetyDetection.js`, `cameraSource.js`, `internalAuth.js`).

## 3. Security

- **Auth**: JWT access token (`JWT_SECRET`, 24h) + httpOnly refresh cookie (`JWT_REFRESH_SECRET`, 7d), with a `tokenVersion` counter on `User` for revocation at logout. Passwords hashed with bcrypt at cost factor 12. Never lower the cost factor or skip hashing.
- **Authorization has two layers, both required on project-scoped routes**: role (`authorizeRole()` — ADMIN/ENGINEER/CLIENT) *and* project membership (`utils/projectAccess.js`'s `userHasProjectAccess`). A role check alone does not stop one client/engineer from reading another project's data — never add a project-scoped route that skips the membership check.
- **Internal service boundary**: `/api/internal/*` (AI service → Node) is guarded by a shared secret compared in constant time (`middleware/internalAuth.js`, `crypto.timingSafeEqual`) and fails closed if the secret is unset. Never relax this to a simple `===` comparison, and never expose these routes without the guard.
- **Webhook signatures** (`routes/webhooks/easypaisa.js`) are verified over the *raw* request body (`req.rawBody`, stashed by the `express.json()` verify hook) — never re-serialize JSON and hash that instead, since key order/whitespace differences would produce a different digest and break verification.
- **MJPEG stream auth** (`authenticateTokenAllowQuery`) accepts a token via `?token=` only because `<img src>` can't set an Authorization header. This is a narrow, deliberate exception — do not reuse this pattern for a new route unless it has the exact same `<img>`-tag constraint.
- **Camera sources**: `Camera.rtspUrl` accepts more than RTSP (HTTP(S), RTMP, file paths, device indices) and is fed to ffmpeg/OpenCV subprocesses. Any new code touching this must go through `utils/cameraSource.js`'s `classifySource`/`isWellFormed` checks first — never interpolate a raw camera source into a shell command.
- **Biometric data**: `Worker.faceEmbedding` is sensitive personal data. Never log it, return it in an API response, or widen who can read/enroll it without being asked.
- Never commit secrets, and never hardcode a secret as a fallback default in code (e.g. `process.env.JWT_SECRET || 'devsecret'`) — if an env var is missing, the app should fail loudly, not silently downgrade security.
- No rate limiting currently exists anywhere in `server/`. Be aware of this when adding auth-adjacent endpoints; flag it rather than assuming it's handled elsewhere.

## 4. Testing

**There is no Jest, Vitest, Mocha, or pytest in this repo.** Do not introduce one to "properly" test something unless explicitly asked — testing here works through three existing mechanisms:

1. **`server/tests/e2e.postman_collection.json`**, run via `npm run test:e2e` (`server/scripts/run-e2e.js`). This reseeds the database (`scripts/seed-comprehensive.js`) and requires the dev server to already be running. Never point it at a database with data you care about. Extend it (via `server/scripts/build-postman-collection.js`) when adding a new API endpoint.
2. **`ai-service/test_integration.py`**, a dependency-ordered check (environment → dataset → camera → model → inference → stream service → Node API). A stage whose dependency is unavailable reports `SKIP`, not `FAIL` — that's expected, not a bug. Extend its stage list for new AI-service logic.
3. **`server/tests/manual-test-script.md`**, the human QA checklist for full user journeys. Use this for anything that needs a human in the loop (visual/UX checks, real camera hardware).

Before committing, run whichever of these applies to the change (see Git Workflow below). If nothing applies (e.g. a pure frontend visual change), verify manually in the browser per the README's Quick Start and say so explicitly rather than claiming automated coverage that doesn't exist.

## 5. Error Handling

- Follow the existing pattern in `server/src/routes/*`: `try/catch` around async handlers, `console.error('<Context> error:', err)` on failure, and a generic `{ error: '...' }` JSON body — never leak stack traces, Prisma internals, or raw error messages to the client.
- Auth failures are fail-closed by design: `verifyJWT` returns `null` on any failure (`middleware/auth.js`) rather than throwing, and `internalAuth` refuses the request if `X_INTERNAL_TOKEN` is unset rather than allowing it through. Preserve this fail-closed default in any new auth-adjacent code.
- Some project-scoped routes intentionally return 404 instead of 403 for "no access", so an unauthorized user can't confirm a resource exists. Match this where it's already the pattern; don't silently change it to 403.
- `ai-service/main.py` wraps optional ML router imports (e.g. `/enroll`) in `try/except` so a broken or missing ML dependency degrades that one feature instead of taking down `/health`. Follow this defensive-import pattern for any new optional AI capability.
- Fire-and-forget side effects (e.g. updating `Camera.status` when a stream connects) should not block or fail the primary response — catch and log their errors separately, as the existing code does.

## 6. Git Workflow

- Never work directly on `main`/`master` unless explicitly told to — prefer a feature branch (`feature/...`, `fix/...`).
- **Before committing**: run `git status` and inspect `git diff` (or the staged diff) yourself, and show the user what's about to be committed.
- **Before committing**: run whichever relevant test mechanism applies (see Testing above) — `npm run test:e2e` for server changes, `python test_integration.py` for ai-service changes.
- Never stage `.env`, `.env.local`, `server/.env`, `ai-service/.env`, `venv/`, or generated test output (`server/tests/seed-output.json`, `newman-env.json`) — double-check `git status` after any broad `git add`.
- If `server/prisma/schema.prisma` changes, its generated migration under `server/prisma/migrations/` must be committed in the same change — a schema edit without its migration diverges from the actual database.
- **Never push directly to `main`/`master`.**
- **Never force push.**
- **Never reset or discard uncommitted changes** (`git reset --hard`, `git checkout --`, `git clean`, etc.) without explicit permission — if something needs to be set aside, stash it instead.
- **Never push automatically.** Before pushing, show the current branch, `git status`, and the commits that will be pushed, confirm the destination branch, and wait for explicit confirmation.
- Do not create a commit unless explicitly asked or authorized.
- Do not create a PR unless explicitly asked; when asked, confirm target branch, ensure the relevant tests pass, and summarize the diff first.

## 7. Dependencies

- Package manager is **npm**, with npm workspaces (`server`, `client`) declared in the root `package.json`. `ai-service` is plain Python (`pip` + `requirements.txt`), not part of the workspace.
- Install/update dependencies from the repo root when touching a workspace package, so `package-lock.json` stays in sync — avoid running `npm install` only inside `server/` or `client/` in a way that produces a stray lockfile.
- `ai-service/requirements.txt` has version pins for a reason — several (`deepface`, `torch`, `ultralytics`) are tied to the Python 3.10/3.11 constraint documented at the top of the file. Don't bump versions casually; check compatibility with that constraint first.
- Don't add a new dependency (especially a new framework, ORM, state-management library, or test runner) without checking whether the existing stack already covers the need — this project deliberately keeps its dependency surface small.
- Never downgrade or remove a dependency to work around an error without understanding why it's needed first.

## 8. Environment Variables and Secrets

- Each service has its own env file, none of which are committed: `server/.env`, `client/.env.local`, `ai-service/.env`. Only the corresponding `.env.example`/`.env.local.example` files are tracked.
- Key server variables: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `X_INTERNAL_TOKEN`, `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `CORS_ORIGIN`, `SAFETY_STREAM_URL`/`STREAM_PORT`, `CAMERA_SOURCE`, `EASYPAISA_API_KEY`/`EASYPAISA_MERCHANT_ID`, `SMTP_*`.
- Key ai-service variables: `NODE_API_URL`, `X_INTERNAL_TOKEN` (must match the server's value), `YOLO_MODEL_PATH`, `CAMERA_SOURCE`/`CAMERA_TYPE`, `SAFETY_CONFIDENCE_THRESHOLD`, `ATTENDANCE_DISTANCE_THRESHOLD`, `ALERT_COOLDOWN_SECONDS`.
- Key client variable: `VITE_API_BASE_URL`.
- Never hardcode a real secret, key, or credential in source, tests, seed scripts, or documentation — use env vars and reference the `.example` files.
- Never print the contents of an actual `.env` file to the terminal or into a commit/PR description.
- If a required env var is missing, prefer failing loudly (as `internalAuth.js` does for `X_INTERNAL_TOKEN`) over defaulting to an insecure fallback.

## 9. Rules About Modifying Existing Code

- Read and understand a file (and how it's called elsewhere) before changing it — don't guess at behavior from a function name alone.
- Don't refactor, rename, or restructure working code as a side effect of an unrelated task. A bug fix should touch only what's needed to fix the bug.
- Preserve existing patterns already established in the codebase (auth ordering, error-handling shape, defensive imports, fail-closed checks) rather than introducing a different style in the same area.
- Don't remove a safety/validation check (auth middleware, project-access check, camera-source validation, signature verification) to make something "work" — if a check seems wrong, say so and ask rather than deleting it.
- Don't delete or rewrite comments that explain a non-obvious constraint (e.g. the ffmpeg flag-version note, the two-class YOLO model limitation in `safety_detector.py`) unless the underlying constraint has actually changed.
- If a change requires touching multiple services (e.g. a new field needs a Prisma migration, a server route, and a client consumer), make sure all three land together rather than leaving the app in an inconsistent state.
- When in doubt about scope, ask before proceeding rather than assuming the broadest interpretation of a request.
