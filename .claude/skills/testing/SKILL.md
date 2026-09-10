---
name: testing
description: Analyze, extend, and run this project's Postman/Newman E2E suite and Python integration checks — there is no Jest/Vitest/pytest unit-test framework here. Use when adding endpoints, investigating test failures, or verifying changes.
---

# Testing

Act as a senior test engineer for BuildSite 360.

## This Project Has No Unit-Test Framework

There is no Jest, Vitest, Mocha, or pytest configured anywhere in this repo (confirmed against `server/package.json`, `client/package.json`, and `ai-service/requirements.txt` — none are present). "Writing a test" here does **not** mean creating a new test file with a test runner. Testing happens through three existing mechanisms instead:

1. **`server/tests/e2e.postman_collection.json`** — a Postman collection, generated/extended via `server/scripts/build-postman-collection.js`, run end-to-end with `npm run test:e2e` (`server/scripts/run-e2e.js`). That script reseeds the database (`scripts/seed-comprehensive.js`) and requires the dev server to already be running (`npm run dev`) — never point it at a database you care about.
2. **`ai-service/test_integration.py`** — a dependency-ordered verification script (environment → dataset → camera → model → inference → stream service → Node API). A stage whose dependency isn't available (no camera attached, model not trained yet) reports `SKIP`, not `FAIL` — don't "fix" a skip by forcing it to run. `ai-service/scripts/test_yolov8.py` is a narrower standalone check of the YOLO model alone.
3. **`server/tests/manual-test-script.md`** — the human QA checklist for full user journeys (login → project → updates → materials → chat → cameras → safety → attendance → billing). Point the user here for anything that genuinely needs a human in the loop (visual/UX checks, camera hardware).

## Process

1. Understand the functionality being tested.
2. Identify which of the three mechanisms above fits: a new/changed API endpoint → extend the Postman collection; new/changed AI-service logic → extend `test_integration.py`'s stage list; a UI-only change → manual verification, documented in `manual-test-script.md` if it's a new user-facing flow.
3. Inspect the existing collection/script before adding to it, to match its structure (the Postman collection already exercises 401/403/404 negative paths per role — new endpoints should follow that pattern).
4. Make the addition.
5. Run it: `npm run test:e2e` (server), `python test_integration.py` (ai-service).
6. Investigate failures against the actual running services, not assumptions.
7. Fix the implementation when the failure is a real bug; fix the test/collection when the test itself was wrong — and explain why before doing either.
8. Re-run to confirm.

## Test Coverage

Consider:

- Happy paths
- Invalid input
- Edge cases
- Error handling
- Authentication
- Authorization — role checks **and** project-membership checks (this app has both; see `utils/projectAccess.js`)
- API failures
- Empty states
- Loading states
- Boundary conditions
- Cross-project access (a CLIENT/ENGINEER on Project A must not be able to read/act on Project B's resources)

## Rules

Do not modify tests simply to make the implementation pass.

If a test is genuinely incorrect, explain why before changing it.

Do not introduce a new test framework (Jest, Vitest, pytest, etc.) to "properly" test something unless the user explicitly asks for it — it would sit alongside, not replace, the existing Postman/integration-script setup, and that tradeoff is the user's call.
