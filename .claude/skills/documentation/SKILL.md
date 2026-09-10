---
name: documentation
description: Write and keep in sync this project's README, setup guides, architecture notes, and API/developer documentation. Use when a feature needs documenting, or when docs have drifted from the actual code.
---

# Documentation

Act as a senior engineer maintaining BuildSite 360's documentation.

## When to Use

A change needs documenting, or existing docs no longer match the code.

## Existing Documentation (update the right one — don't create a new top-level doc that duplicates it)

- `README.md` — quick start / environment setup, terminal-by-terminal run instructions.
- `PROJECT_OVERVIEW.md` — architecture, stack, project structure, database schema summary, API endpoint summary. The closest thing this project has to a living architecture doc.
- `FEATURE_STATUS.md`, `PHASE_COMPLETION_TRACKER.md` — implementation progress tracking.
- `QUICK_REFERENCE.md`, `QUICK_TEST_COMMANDS.md`, `SETUP_INSTRUCTIONS.md`, `LOCAL_TESTING_GUIDE.md`, `TROUBLESHOOTING.md` — operational/how-to docs.
- `CLAUDE.md` — instructions for AI assistants working in this repo, not user-facing documentation.
- `server/README.md`, `ai-service/TRAINING.md`, `server/BILLING_SANDBOX.md`, `server/tests/manual-test-script.md` — service-specific docs.

## README / Setup Instructions

Match the existing style: numbered, terminal-by-terminal setup (README.md's "Quick Start (3/4 Terminals)"), explicit prerequisite versions (Node 20, Python **3.10 or 3.11 specifically**, PostgreSQL 15, ffmpeg), and callouts for version-sensitive gotchas the project has already been burned by — the ffmpeg `-stimeout`/`-timeout` flag rename between versions, the Python 3.12+ / TensorFlow / `deepface` incompatibility. When adding a new setup step, explain *what could silently break and why*, the way these existing callouts do — not just a bare command.

## Architecture Documentation

`PROJECT_OVERVIEW.md` is the source of truth for stack, structure, and the endpoint list. When a change adds a new route, Prisma model, or service boundary, update the corresponding section ("API Endpoints Summary," "Database Schema," "Project Structure") in the same change so it doesn't silently drift out of date.

## API Documentation

There's no OpenAPI/Swagger spec in this project. The two things that function as API documentation are `PROJECT_OVERVIEW.md`'s endpoint list and `server/tests/e2e.postman_collection.json` (which doubles as executable documentation via Newman). When adding an endpoint, update both.

## Developer Documentation (inline comments)

This codebase's comment style explains *why*, not *what* — see the rationale blocks in `safetyDetection.js`, `cameraSource.js`, `internalAuth.js`, and `webhooks/easypaisa.js`. Match that voice for new code: don't write comments that restate what a line already says; do write down a non-obvious constraint, a deliberate tradeoff, or a workaround for a specific issue.

## Documenting Decisions

When a design tradeoff is made deliberately — a security shortcut with a known caveat, a stopgap pending a real integration, a documented limitation — write it down inline next to the code (as `easypaisa.js`'s "READ BEFORE GOING LIVE" block or `safety_detector.py`'s two-class-model caveat do), not only in a chat response that won't persist past the conversation.

## Keeping Documentation Synchronized

After any change that affects setup steps, environment variables, API endpoints, or the database schema, check whether `README.md`, `PROJECT_OVERVIEW.md`, and the relevant `.env.example` file(s) need updating in the same change. Treat stale documentation as a defect to fix, not a minor footnote to skip.

## Workflow

1. Identify which existing doc file actually owns this information — don't create a new top-level `.md` file for something that fits an existing one.
2. Update it precisely, without rewriting unrelated sections.
3. If a new environment variable was added, update every relevant `.env.example`.
4. If a new endpoint was added, update `PROJECT_OVERVIEW.md` and the Postman collection.
5. Reread the updated section against the actual code for accuracy.

## Safety Rules

Don't fabricate a status, percentage, or "done" claim without verifying it against the code. Don't remove a documented caveat or limitation unless the underlying issue is actually resolved. Never write a real credential into documentation — use the same placeholder style as the `.env.example` files.

## Verification

Confirm every documented command actually runs (`npm run test:e2e`, `python test_integration.py`, etc.) and every documented endpoint or environment variable actually exists in the current code before writing it down.
