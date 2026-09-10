---
name: deployment
description: Handle production build, environment, and deployment configuration for this project, which currently has no CI/CD or containerization. Use when asked about deploying, building for production, or setting up CI/CD.
---

# Deployment

Act as a senior engineer handling deployment for BuildSite 360.

## When to Use

Deploying a service, preparing a production build, or setting up CI/CD.

## Current State (verified, not assumed)

This repo has **no CI/CD configuration** (no `.github/workflows/`, no other CI config anywhere in the tree), **no `Dockerfile`/`docker-compose`**, and **no platform config** (`vercel.json`, `Procfile`, Railway config). `PROJECT_OVERVIEW.md`'s own "Current Deployment Status" confirms this directly: the intended targets are Vercel (client), Railway-or-similar (server + ai-service), and a production Supabase database, but none of it is wired up yet. Treat any deployment task as **new setup**, not "fix the existing pipeline" — there isn't one.

## Production Builds

- **client**: `npm run build` (Vite) in `client/` — produces a static bundle for a static host/CDN.
- **server**: `package.json`'s `build` script is literally `echo 'No build step'`. "Deploying the server" means running the Node process (`npm start` / `node src/index.js`), not producing a build artifact.
- **ai-service**: no build step either — it's a Python process (`python main.py`, or a production ASGI entrypoint) plus its `venv`/`requirements.txt`.

## Environment Variables & Secrets

Each service needs its own production environment (full variable list in `CLAUDE.md` section 8). Production `JWT_SECRET`/`JWT_REFRESH_SECRET`/`X_INTERNAL_TOKEN` must be strong, unique values — never the same as any local `.env`, and never committed. `X_INTERNAL_TOKEN` must match **exactly** between the deployed server and ai-service, or every internal endpoint fails closed by design (see `middleware/internalAuth.js`).

## CI/CD

None exists today. If asked to add it, propose the smallest reasonable pipeline — e.g. a GitHub Actions workflow running `npm run test:e2e` against a throwaway Postgres service container, plus `python test_integration.py --skip camera --skip model` for whatever can run headlessly — rather than assuming an existing workflow needs modification. Get explicit confirmation before adding a workflow file: CI config affects the shared repo for everyone who pushes to it.

## Deployment Configuration

- `ai-service` must run on **Python 3.10 or 3.11** in production too — a 3.12+ runtime breaks `deepface`/TensorFlow exactly as it does locally.
- `ffmpeg` must be present on the server's production host (or `FFMPEG_PATH` set) for camera streaming/recording to work at all.
- The AI service must stay network-isolated from the public internet in production (bound to localhost or an internal network). The code enforces the internal-token check but does **not** itself prevent public exposure — that's an infrastructure decision, not a code guarantee.

## Production Safety Checks

Before treating a service as deployment-ready, confirm:
- `NODE_ENV=production` is set (this also flips the refresh-token cookie's `secure` flag on automatically — see `routes/auth.js`).
- `CORS_ORIGIN` points at the real production frontend origin, not `http://localhost:5173`.
- The S3/MinIO bucket's public-access policy matches intent (private by default, per the README).
- Payment webhook secrets are the real provider values, **and** the EasyPaisa signature scheme has actually been confirmed against EasyPaisa's real merchant docs — `webhooks/easypaisa.js` explicitly flags its current HMAC scheme as an unverified placeholder. Do not treat that code as production-ready for real money without resolving that first.

## Rollback Considerations

There's no release-versioning or rollback tooling in this project yet (no tags, no blue/green setup). If you're setting up a deployment target, rely on that platform's own rollback mechanism (Vercel and Railway both retain previous deployments) rather than building custom rollback tooling — don't over-engineer this for a project at this stage unless explicitly asked to.

## Never Expose Credentials

Never print real production secrets in chat, logs, commit messages, or documentation. Never commit a populated `.env` for any service. When writing example CI/deployment configs, use placeholder/secret-reference syntax only (e.g. `${{ secrets.X }}` in a GitHub Actions example) — never a literal value.

## Workflow

1. Confirm exactly what's being deployed (one service, or all three).
2. Gather the required environment variables for that service.
3. Verify version constraints (Node 20, Python 3.10/3.11, ffmpeg present).
4. Run the production build command if one exists (client only).
5. Run the relevant test mechanism against a staging/local instance first (see the `testing` skill).
6. Get explicit confirmation before any action that touches real infrastructure or secrets — this is a risky, hard-to-reverse action by the project's own operating rules.
7. Document the new deployment steps in the appropriate existing doc (see the `documentation` skill) so they aren't rediscovered from scratch next time.

## Verification

After deploying, hit each service's health check (`/api/health`, `/health`). Confirm the internal-token handshake works between server and ai-service. Confirm the client's `VITE_API_BASE_URL` actually resolves to the deployed API before calling the deployment done.
