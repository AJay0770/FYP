---
name: feature-development
description: Plan and implement a new feature end-to-end across this project's client/server/ai-service stack. Use when implementing a new feature — not for an isolated bug fix (see debugging) or a standalone review (see code-review).
---

# Feature Development

Act as a senior engineer implementing a new feature in BuildSite 360.

## When to Use

Implementing a new feature, as opposed to fixing a bug (`debugging` skill) or reviewing existing code (`code-review` skill).

## Workflow

1. **Understand the existing architecture.** Read `CLAUDE.md` first. Identify which service(s) the feature touches — client, server, ai-service, or more than one (a new detection type, for example, typically needs ai-service logic, a new `/api/internal/*` route, a Prisma model/migration, and a client panel).

2. **Identify affected files and dependencies.** Find the closest existing analog: a similar route in `server/src/routes/`, a similar page/panel in `client/src/`, a similar Prisma model, any Socket.io events it should emit or listen for, any new environment variables it needs.

3. **Create an implementation plan before making significant changes.** For anything beyond a trivial single-file change, sketch the plan — files to add/change, whether a Prisma migration is needed, new route(s) and their auth requirements, new client component/page, new env vars — and check it against the user's intent before writing code. This project's `CLAUDE.md` explicitly favors asking before proceeding on anything that spans multiple services or is ambiguous in scope.

4. **Implement the smallest maintainable solution.** No speculative abstractions, config flags, or generalization the feature doesn't need yet — this matches `CLAUDE.md`'s coding-standards and modifying-existing-code rules.

5. **Reuse existing patterns and components.** Auth/authorization ordering from other routes (`api-development` skill), Prisma modeling conventions (`database` skill), UI primitives from `components/ui` (`frontend-development` skill). Don't reinvent something this codebase already has.

6. **Add/update tests.** This repo has no unit-test framework. "Tests" means: extending `server/tests/e2e.postman_collection.json` for a new/changed endpoint, extending `ai-service/test_integration.py`'s stage list for new AI-service logic, and updating `server/tests/manual-test-script.md` for a new user-facing flow (see the `testing` skill for the full picture).

7. **Run relevant tests, linting, and type checking where available.** There is no linter, formatter, or type checker configured anywhere in this repo (no ESLint/Prettier/TypeScript) — don't invent output from tools that aren't there. Instead run `npm run test:e2e` (server changes) and/or `python test_integration.py` (ai-service changes); for a client-only change, manually verify in the browser (`npm run dev`), since no automated frontend test exists.

8. **Review the final diff.** `git status` + `git diff` across every touched file and service before considering the feature done. Check for stray debug output, accidental formatting-only churn, and — if the schema changed — that the Prisma migration is included.

9. **Report what changed and what was verified.** Summarize per service (client / server / ai-service / database) what changed, and be explicit about what was actually run and observed versus what could only be checked by reading the code. Don't imply test coverage or verification that didn't happen.

## Safety Rules

- Don't commit or push as part of "implementing" the feature — that belongs to the `git-workflow` skill and needs its own explicit confirmation.
- Don't skip the planning step (3) for anything touching more than one file or service.
- Don't leave a Prisma schema change without its migration.
- Don't ship a new endpoint without authentication and, for project-scoped resources, the project-access check (cross-reference `api-development` and `security-review`).
- Don't scope-creep: implement what was asked, not adjacent improvements that weren't.

## Verification

Same as step 7: run whichever of `npm run test:e2e`, `python test_integration.py`, or manual browser verification actually applies to the parts of the stack the feature touched, and report exactly which of those were run.
