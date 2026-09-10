---
name: code-review
description: Review code for bugs, security issues, maintainability problems, performance issues, and missing tests in this Node/Express + React/Vite + Prisma/PostgreSQL + Python/FastAPI monorepo. Use when reviewing existing code or changes before committing or creating a pull request.
---

# Code Review

Act as a senior software engineer reviewing the code for BuildSite 360.

## This Project's Stack

- **server/** — Node.js 20, Express 4 (CommonJS `require`/`module.exports`), Prisma 5 ORM over PostgreSQL 15, Socket.io, JWT auth (`jsonwebtoken` + `bcrypt`), AWS SDK v3 for S3/MinIO.
- **client/** — React 18 + Vite (ESM), Axios, `socket.io-client`, Recharts. No router library — views are switched manually in `App.jsx`. No CSS framework — hand-written design tokens.
- **ai-service/** — Python 3.10/3.11 only (not 3.12+ — `deepface` → TensorFlow has no wheels beyond 3.11), FastAPI, Ultralytics YOLOv8 + PyTorch for PPE detection, DeepFace/ArcFace for facial recognition, OpenCV.
- **Package manager:** npm, with npm workspaces (`server`, `client`) declared at the repo root — `ai-service` is plain Python, not part of that workspace.
- **API architecture:** REST under `/api`, mostly nested by project id (`/api/projects/:id/...`); Socket.io for realtime (chat, safety alerts, attendance); a separate `/api/internal/*` surface for the AI service to call back into Node, gated by a shared `X-Internal-Token`.

## Review Goals

Look for:

- Logic errors
- Bugs
- Security vulnerabilities
- Incorrect assumptions
- Edge cases
- Poor error handling
- Duplicated code
- Unnecessary complexity
- Performance problems
- Maintainability problems
- Missing validation
- Missing tests
- Poor naming
- Architectural problems

### Project-specific checks

- **Prisma usage**: new route files should import the shared client from `server/src/utils/prisma.js` rather than instantiating `new PrismaClient()` directly (a few older routes, e.g. `auth.js`, still do the latter — don't propagate that into new code).
- **Auth ordering on new routes**: project-scoped endpoints need both `authenticateToken` (or `authenticateTokenAllowQuery`, reserved for `<img>`/MJPEG endpoints) *and* the project-membership check (`utils/projectAccess.js`'s `userHasProjectAccess`) — a role check alone (`authorizeRole`) does not prevent one client/engineer from reading another project's data.
- **Internal routes**: anything under `/api/internal/*` must be wrapped in `middleware/internalAuth.js` and never assumed to be network-isolated by the code itself (that's a deployment concern, not a code guarantee).
- **Prisma `Decimal` fields** (`budgetEstimate`, `quantity`, `unitCost`, `confidenceScore`, `matchConfidence`) serialize as `Decimal` objects, not plain numbers — check that new response payloads and frontend consumers handle that correctly.
- **Schema changes** must ship a Prisma migration (`prisma migrate dev`) alongside the `schema.prisma` edit, not just the edited schema file.
- **CommonJS vs ESM**: `server/` is CommonJS, `client/` is ESM (`"type": "module"`) — don't mix `import`/`require` within a file.
- **Python service**: new ML-adjacent code in `ai-service/` should stay compatible with Python 3.10/3.11 (avoid 3.12+-only syntax or dependencies) and follow `main.py`'s pattern of catching import/init failures around optional ML features so `/health` keeps working even if a model or dependency is missing.
- **Camera sources**: anything that shells out to ffmpeg/OpenCV with a camera URL must go through `utils/cameraSource.js`'s `classifySource`/`isWellFormed` checks first, not use `Camera.rtspUrl` raw.
- **"Missing tests" in this repo**: there is no Jest/Vitest/pytest unit-test suite. A finding here should point at extending `server/tests/e2e.postman_collection.json` (via `server/scripts/build-postman-collection.js`) for a new endpoint, or `ai-service/test_integration.py`'s stage list for AI-service logic — not suggest bringing in a new test framework unprompted.

## Review Process

Before making any suggestions:

1. Understand the existing architecture.
2. Read the relevant files.
3. Understand how the changed code interacts with the rest of the application.
4. Inspect the actual git diff when reviewing changes.
5. Do not make assumptions about code that has not been inspected.

## Severity

Classify findings as:

### CRITICAL
Issues that could cause severe security problems, data loss, or major system failure.

### HIGH
Serious bugs, security vulnerabilities, or functionality problems.

### MEDIUM
Problems that could cause bugs, maintenance issues, or degraded performance.

### LOW
Minor improvements, style issues, or optional improvements.

## Output

For every issue provide:

1. Severity
2. File and relevant code
3. What is wrong
4. Why it matters
5. Recommended fix

Do not modify files during a review unless explicitly asked.

If no significant problems are found, say so clearly.

Do not invent problems simply to produce findings.
