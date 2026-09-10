---
name: database
description: Make schema, query, and data-integrity changes in the Prisma/PostgreSQL layer — migrations, relationships, indexes, transactions, and query performance specific to this project's schema. Use when adding/changing a Prisma model or writing a non-trivial query.
---

# Database

Act as a senior backend engineer working on BuildSite 360's Prisma/PostgreSQL layer.

## When to Use

Adding or changing a Prisma model, writing a query with more than a trivial `findUnique`/`findMany`, or touching anything under `server/prisma/`.

## This Project's Stack

PostgreSQL 15, Prisma 5 ORM, a single schema file (`server/prisma/schema.prisma`, 14 models), migrations under `server/prisma/migrations/`.

## Schema Design

Existing models consistently:
- Use a UUID primary key (`id String @id @default(uuid())`).
- Include `createdAt DateTime @default(now())`, and `updatedAt DateTime @updatedAt` on mutable records.
- Declare every child-to-parent relation with `onDelete: Cascade` (e.g. `SiteUpdate.project`, `SafetyAlert.camera`) so deleting a `Project`/`Camera`/`User` cleans up dependents instead of leaving orphans.

Match these conventions for any new model rather than inventing a different id/timestamp/cascade style.

## Relationships

- Many-to-many uses an explicit join model (`ProjectEngineer`), not Prisma's implicit m:n — follow that pattern if a new many-to-many relation is needed.
- A single model can hold more than one relation to the same target table via named relations (see `User`'s `createdProjects` `@relation("CreatedBy")` vs. `clientProjects` `@relation("ClientId")`) — use a named `@relation` whenever a model needs a second FK into a table it already references.

## Migrations

Every `schema.prisma` change ships with a matching migration, generated via:

```
npx prisma migrate dev --name <description>
```

Never hand-edit a migration file that's already been applied elsewhere, and never leave a schema edit without its migration in the same commit (see `CLAUDE.md` and the `git-workflow` skill).

## Indexes

Today the schema has **no explicit `@@index` directives** — only `@@unique([projectId, engineerId])` and `@@unique([workerId, date])`. Postgres does not automatically index foreign-key columns (`projectId`, `cameraId`, `workerId`, `senderId`, etc.), so a query that filters or sorts heavily on one of these at real scale is a legitimate candidate for an explicit `@@index`. Don't add indexes speculatively, though — add one when a specific query pattern needs it, and say which query justifies it.

## Query Performance / Avoiding N+1

Use Prisma's `include`/`select` to fetch relations in a single query — existing code already does this (e.g. `routes/safetyDetection.js` selecting `{ camera: { select: { id, name, zone } } }` alongside a `SafetyAlert` query) — rather than fetching a list and then querying related data per row in a loop. When reviewing or writing a list endpoint, check for exactly that loop-and-query shape before considering it correct.

## Transactions

No `$transaction` usage currently exists anywhere in `server/src`. That doesn't mean it's never needed: any new operation that writes to more than one model and must succeed or fail as a unit (e.g. creating a `Subscription` alongside a related `User` update, or a multi-step billing state change) should be wrapped in `prisma.$transaction([...])`. Don't leave a genuinely multi-step write unguarded just because existing code hasn't needed one yet.

## Data Validation

Prisma enforces types and enums (`Role`, `ProjectStatus`, `ViolationType`, `EntryType`, etc.) at the database level, but request-body validation still happens by hand in the route handler before the Prisma call — there's no Zod/Joi in this project (see the `api-development` skill). Validate first, matching the existing manual-check style.

## Database Security

- Prisma's query builder parameterizes automatically — never build a query with string-concatenated values.
- If `$queryRaw`/`$executeRaw` is ever genuinely needed, use tagged-template parameterization only, never string interpolation.
- Row-level access control (which project's data a user may see) is enforced in route handlers via `utils/projectAccess.js`, not by the schema itself — never assume the database layer restricts anything on its own; a query without an explicit `projectId`/access filter will return everyone's data.

## Workflow

1. Read `schema.prisma` to understand the existing models and relations before adding to them.
2. Design the change following the conventions above (UUID id, timestamps, cascade FKs, named relations if the model needs more than one FK to the same table).
3. Run `npx prisma migrate dev --name <name>`.
4. Update/verify any route queries affected by the change.
5. Check new query code for N+1 risk.
6. Decide whether the change needs a transaction.
7. Re-seed (`scripts/seed-comprehensive.js`) and run the Postman/E2E suite.

## Verification

`npx prisma migrate dev` locally, then a manual check (Prisma Studio or a direct query) that the data looks right, then `npm run test:e2e` in `server/` to confirm the API still round-trips correctly against the new schema.
