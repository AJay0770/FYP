# buildsite360-server

Node.js/Express API for BuildSite 360.

## Setup

```bash
npm install
npx prisma generate
npx prisma migrate dev --name init
```

Copy `.env.example` to `.env` and set `DATABASE_URL` to a reachable PostgreSQL instance.

## Seeding test data

Before manual or Postman testing, reset the database with known test data:

```bash
npm run seed
```

This clears all tables and creates:

| Role | Email | Password |
|---|---|---|
| ADMIN | admin@test.com | password123 |
| ENGINEER | engineer1@test.com | password123 |
| ENGINEER | engineer2@test.com | password123 |
| CLIENT | client1@test.com | password123 |
| CLIENT | client2@test.com | password123 |

It also creates two projects:
- **Riverside Tower** — owned by `client1`, assigned to `engineer1`
- **Lakeside Villas** — owned by `client2`, assigned to `engineer2`

The script prints each user's ID and a ready-to-use 24h JWT access token, plus both project IDs, so you can paste them straight into Postman variables without going through the login flow manually.

Re-run `npm run seed` any time to reset back to this known state — it wipes existing data first.

## Postman collection

Import `postman_collection.json` (Auth, Projects, Negative Paths — 17 tests total), then set these collection variables from the seed script's output before running:

| Variable | Value |
|---|---|
| `adminToken` | seed output: `admin` token |
| `engineerToken` | seed output: `engineer1` token |
| `otherClientToken` | seed output: `client1` token |
| `clientId` | seed output: `client1` user id |
| `engineerId` | seed output: `engineer1` user id |
| `seedProject2Id` | seed output: `project2` id (Lakeside Villas) |
| `seedEngineer2Id` | seed output: `engineer2` user id |

`accessToken` and `projectId` are populated automatically by the collection's own Login and Create Project requests — leave them blank. The Auth and Projects folders create, log in as, and delete their own scratch data; the Negative Paths folder deliberately targets the seed script's `project2` so it works even if run on its own.

## Running

```bash
npm run dev    # nodemon, http://localhost:3000
```

Health check: `GET /api/health` → `{ "status": "ok" }`
