---
name: git-workflow
description: Safely manage Git changes, branches, commits, and pushes for the BuildSite 360 monorepo (single repo covering server/, client/, and ai-service/, pushed to github.com/AJay0770/FYP).
---

# Git Workflow

Follow safe Git practices for this repo.

## This Repo

- A single Git repository containing all three services (`server/`, `client/`, `ai-service/`) plus root-level docs — there is no per-service repo split, so a change spanning multiple services can go in one commit/PR unless the user asks to split it.
- `server` and `client` are npm workspaces declared in the root `package.json`; `ai-service` is plain Python and not part of that workspace.
- Remote: `origin` → `github.com/AJay0770/FYP.git`. Default/shared branch: `main`.

## Before Making Git Changes

Check:

- Current branch
- Git status
- Existing changes
- Recent commits

Never assume the repository is clean.

## Branches

Never work directly on:

- main
- master

unless the user explicitly instructs you to.

Prefer feature branches such as:

feature/login

fix/api-error

feature/dashboard

## Before Commit

1. Run git status.
2. Inspect git diff.
3. Review the changes.
4. Run relevant tests — `npm run test:e2e` in `server/` for API changes, `python test_integration.py` in `ai-service/` for AI-service changes (see the `testing` skill; there is no unit-test suite to run instead).
5. Explain what will be committed.
6. Confirm no `.env`/`.env.local`/service-level `.env` files, `venv/`, or generated Postman/Prisma output (`server/tests/seed-output.json`, `newman-env.json`) are staged — double-check `git status` after any broad `git add`.
7. If `server/prisma/schema.prisma` changed, confirm the corresponding migration under `server/prisma/migrations/` is included in the same commit — a schema edit without its migration will diverge from the actual database.

## Commit

Do not create a commit unless the user explicitly asks or authorizes it.

Use clear commit messages.

## Push

NEVER automatically push changes.

Before pushing:

1. Show the current branch.
2. Show git status.
3. Show commits that will be pushed.
4. Confirm the destination branch — pushing to `main` on `origin` (`AJay0770/FYP`) is pushing to the shared branch, not a personal fork.
5. Ask the user for confirmation.

Never:

- Force push
- Delete branches
- Reset user changes
- Discard uncommitted work

without explicit permission.

## Pull Requests

Before creating a PR:

- Ensure tests pass, per this project's actual test setup — the Postman/E2E collection and/or the AI-service integration script, not a generic "run the test suite".
- Review the diff.
- Explain the changes.
- Tell the user the target branch.

Ask for confirmation before creating the PR if the user has not explicitly requested it.
