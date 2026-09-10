---
name: performance
description: Investigate and improve performance across the client, server, database, and AI service — measured, not assumed. Use when something is reported slow, before claiming an optimization helps, or when reviewing a change for performance impact.
---

# Performance

Act as a senior engineer diagnosing performance in BuildSite 360's four moving parts: React client, Express API, PostgreSQL, and the Python AI service.

## When to Use

Something is reported slow, you're about to claim a change is "faster" or "more efficient," or a review needs to weigh a change's performance impact.

## Core Rule: Measure Before Claiming

Never assert a change is faster, lighter, or more efficient without a concrete basis — a timing, a query count, a bundle-size delta, a profiler trace, or at minimum a clear mechanical reason (e.g. "this removes an N+1 query that ran once per row"). This repo has no APM/profiling tooling installed, so use what's actually available:

- **Frontend**: browser DevTools Network/Performance tabs, React DevTools Profiler.
- **Backend/DB**: request timing (`console.time`/timestamps), Postgres `EXPLAIN ANALYZE`.
- **AI service**: the stats already exposed by `/api/detections/latest` (`framesRead`, `inferences`, `alertsSent`, `uptimeSeconds`) — use these before-and-after rather than guessing.

## Frontend Performance

- Check for unnecessary re-renders: values or callbacks passed to frequently-rendered children without `useMemo`/`useCallback` (see `LiveMonitoring.jsx` for the existing pattern to match).
- Check for polling that duplicates a Socket.io event the app already receives (chat, safety alerts, attendance are already pushed live) — don't add a poll loop next to an existing subscription for the same data.
- Watch bundle size before adding a new heavy dependency; the app currently ships React, Axios, `socket.io-client`, and Recharts only.

## Backend / API Performance

- Check for blocking work inline in a request handler — PDF generation (`reportGenerator.js`/`reportingService.js`) should run via `jobs/reportCron.js` or an explicit "generate now" action, not synchronously in a hot route.
- Check that fire-and-forget writes (e.g. the `Camera.status: 'ONLINE'` update in `safetyDetection.js`) are genuinely non-blocking (`.catch()`'d, not `await`'d into the response path).
- The global JSON body limit is 15mb specifically for base64 alert frames — don't casually raise it further, and don't assume a new endpoint needs anywhere near that.

## Database Performance

- Check for N+1 patterns: a list query followed by a per-row query instead of Prisma `include`/`select` (see the `database` skill).
- Check whether a slow query is filtering/sorting on a foreign-key column that has no index — the schema currently has no `@@index` beyond two `@@unique` constraints (see the `database` skill), so this is a real, not hypothetical, gap once data volume grows.
- Check for over-fetching — prefer `select` to narrow fields the way existing camera/user lookups already do, rather than returning full rows when only a few fields are used.

## AI Service Performance

`SAMPLE_FPS`, `INFERENCE_FPS`, and `STREAM_FPS` env vars exist specifically to trade detection responsiveness against CPU/GPU load — check these before assuming a "slow" stream needs a code change. Distinguish a real bug (reconnect loop, unbounded frame buffering, a stuck worker) from the project's own documented, expected limitation that inference on CPU is slow (see `PROJECT_OVERVIEW.md`'s "Known Limitations").

## Unnecessary Network Requests

Prefer the Socket.io-pushed detection snapshot over polling `/api/detections/latest` — the route already implements a push-first, fetch-as-fallback design (snapshot cache with a TTL) specifically to avoid redundant AI-service calls; read it before adding a new poll loop on top of it.

## Memory / Resource Issues

The in-memory `latestDetections` Map in `safetyDetection.js` already has a TTL sweep (`setInterval` cleanup, `.unref()`'d so it doesn't hold the process open) — treat this as the template for any new long-lived in-process cache: it needs the same kind of bounded eviction, not just something that grows without limit.

## Caching Opportunities

There is no caching layer in this app (no Redis, no route-level response cache) beyond that one in-memory detection snapshot. Before adding a cache, confirm the access pattern actually justifies it (a genuinely repeated, expensive read) rather than adding caching reflexively.

## Workflow

1. Reproduce and measure the actual slowness — don't guess which layer is at fault.
2. Isolate frontend vs. API vs. database vs. AI-service.
3. Identify the specific mechanism (N+1 query, missing index, avoidable re-render, blocking call, an FPS/threshold setting, a redundant poll).
4. Propose the smallest fix.
5. Measure again after the change.
6. Report the before/after basis honestly — including saying so if it genuinely couldn't be measured precisely with the tools available.

## Safety Rules

Don't add caching, memoization, or a database index speculatively without a measured or clearly mechanical justification. Don't change an FPS/threshold env default without flagging the tradeoff to the user. Don't claim a performance improvement that wasn't actually verified.

## Verification

For API/DB changes: compare query timing or `EXPLAIN ANALYZE` output before/after. For frontend: React DevTools Profiler or the browser Performance tab. For the AI service: compare the `/detections/latest` stats block before/after the change.
