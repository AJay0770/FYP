# Manual End-to-End Test Script

A single-session walkthrough of all ten modules. Roughly 25–30 minutes.

Automated coverage (`npm run test:e2e`, `npm run audit:roles`, `npm run verify:infra`)
already covers status codes and authorization. This script covers what those cannot:
that the UI renders real data, that real-time updates appear without a refresh, and
that a human can actually complete each journey.

---

## Before you start

| Service | Command | Check |
|---|---|---|
| PostgreSQL | (system service) | `psql -h 127.0.0.1 -U postgres -l` lists `buildsite360` |
| MinIO | `minio.exe server ./data --console-address ":9001"` | http://localhost:9000/minio/health/live → 200 |
| RTSP source | `mediamtx.exe` + the ffmpeg publish command in the root README | port 8554 listening |
| API | `cd server && npm run dev` | http://localhost:3000/api/health → `{"status":"ok"}` |
| Client | `cd client && npm run dev` | http://localhost:5173 loads |

Then seed:

```bash
cd server && npm run seed:full
```

Accounts (all password `password123`):

| Role | Email | Sees |
|---|---|---|
| ADMIN | admin@test.com | everything |
| ENGINEER | engineer1@test.com | Riverside Tower only |
| ENGINEER | engineer2@test.com | Lakeside Villas only |
| CLIENT | client1@test.com | Riverside Tower only |
| CLIENT | client2@test.com | Lakeside Villas only |

> Record a PASS/FAIL against each numbered step. If a step fails, note the step
> number and the actual behaviour — do not "fix as you go", since a later step may
> depend on the broken state and mask a second problem.

---

## 1. Authentication

1. Open http://localhost:5173. **Expect:** "API Status: Connected".
2. Register with a new email and any password. **Expect:** "Registration successful. Please log in." — no browser alert dialog.
3. Register again with the *same* email. **Expect:** an inline "Email already registered" message.
4. Log in with a wrong password. **Expect:** inline "Invalid email or password".
5. Log in as `admin@test.com`. **Expect:** "Welcome, admin@test.com (ADMIN)", plus Logout and Billing buttons.
6. Open DevTools → Application → Local Storage. **Expect:** *empty*. The access token is held in memory only; finding a token here is a failure.
7. Application → Cookies. **Expect:** a `refreshToken` cookie marked **HttpOnly**.

## 2. Projects and role scoping

8. **Expect:** the project table lists *both* Riverside Tower and Lakeside Villas, and a "Create Project" button is visible.
9. Log out, log in as `engineer1@test.com`. **Expect:** only **Riverside Tower**, and **no** "Create Project" button.
10. Log out, log in as `client2@test.com`. **Expect:** only **Lakeside Villas**.
11. Log back in as `admin@test.com` and click **Riverside Tower**. **Expect:** the detail page with sections Updates, Materials, Chat, Live Monitoring, Alerts, Attendance, Analytics, Reports.
12. Click "Back to Projects". **Expect:** the list again.

## 3. Site updates

13. On Riverside Tower, find the Updates section. **Expect:** the seeded updates, newest first ("Steel framing delivered" above "Foundation slab poured").

## 4. Materials

14. Find the Materials section. **Expect:** Cement, Steel Rebar, Bricks, and Sand.
15. **Expect: Bricks is flagged as a discrepancy** — 800 consumed against 500 received. This is seeded deliberately; if nothing is flagged, discrepancy detection has regressed.

## 5. Chat (real-time)

16. In Chat, **expect** the three seeded messages, oldest first, each prefixed by the sender's role.
17. Type a message and Send. **Expect:** it appears immediately, prefixed `ADMIN said:`.
18. **Two-window test:** open a second browser window (use a private window so sessions don't share), log in as `client1@test.com`, open Riverside Tower.
19. Send a message from the client window. **Expect:** it appears in the **admin** window **without a refresh**. This is the real-time path — a message that only appears after reloading is a failure.

## 6. Live monitoring

20. Find Live Monitoring. **Expect:** cameras "Main Gate" and "Work Area North".
21. **Expect:** a moving video image for each camera pointed at the running RTSP source, and the status label reading **ONLINE** shortly after the image starts.
22. Stop the ffmpeg publisher, then reload. **Expect:** no image; the request fails within ~12 seconds rather than hanging, and the camera shows **OFFLINE**. Restart the publisher afterwards.
23. Click "Record 30s Clip" on a live camera. **Expect:** the button disables and reads "Recording 30s..."; after ~30 s a "Download clip" link appears. Open it — the clip should play.

## 7. Safety alerts (real-time)

24. Find Alerts. **Expect:** the three seeded alerts, newest first, with violation type, camera, zone, confidence, and time.
25. With the project page open, trigger an alert from a terminal (substitute the internal token from `server/.env`):

    ```bash
    curl -X POST http://localhost:3000/api/internal/safety-alert \
      -H "X-Internal-Token: your-shared-internal-secret" \
      -H "Content-Type: application/json" \
      -d '{"cameraId":"00000000-0000-4000-8000-000000000202","violationType":"NO_HELMET","confidence":0.94}'
    ```

26. **Expect:** a banner appears in the browser **without a refresh**, and a new row is added to the table.
27. Run the same command again immediately. **Expect:** HTTP **202** with `"suppressed": true` — the 60-second cooldown. No second banner, no duplicate row.
28. Run it once more with `"violationType":"NO_VEST"`. **Expect:** HTTP 201 — a different violation type has its own cooldown.

## 8. Attendance

29. Find Attendance. **Expect:** worker "Ali Hassan" (EMP-001) with days present and average confidence.
30. Switch daily → weekly → monthly. **Expect:** the counts change (the seed creates three days), and each view labels its range.
31. **Expect:** the check-in date shown matches **today's local date**, not yesterday's. An off-by-one here is a timezone regression.
32. Trigger a check-in:

    ```bash
    curl -X POST http://localhost:3000/api/internal/attendance-record \
      -H "X-Internal-Token: your-shared-internal-secret" \
      -H "Content-Type: application/json" \
      -d '{"workerId":"00000000-0000-4000-8000-000000000301","confidence":0.93}'
    ```

    **Expect:** `"duplicate": true` — the seed already checked this worker in today.

33. Worker enrollment form: fill name and ID, select photos, submit. **Expect:** a clear error stating the face-recognition service is unavailable. **This is currently the correct behaviour** — `deepface` cannot be installed on Python 3.12+ (see `ai-service/TRAINING.md`). A silent success would be the bug.

## 9. Analytics

34. Find Analytics. **Expect:** three charts — safety violations by type (bar), attendance (line), materials received vs consumed (bar).
35. **Expect:** the numbers agree with what the other sections showed. Analytics and the PDF read from the same `reportingService`, so a mismatch means one of them is not using it.
36. **Expect:** no console errors from Recharts.

## 10. Reports

37. Find Reports. Click "Generate Daily Report". **Expect:** a new row appears with a PDF link.
38. Open the PDF. **Expect:** heading, date range, and sections for Site Updates, Attendance, Safety Violations, and Materials — with **Bricks marked as a discrepancy**.
39. Log in as `engineer1@test.com` and open the project. **Expect:** no "Generate Daily Report" button.

## 11. Billing

40. As admin, click **Billing**. **Expect:** "Sandbox mode — no real payments are processed", the current PRO subscription, next billing date, and project usage.
41. **Expect:** three plans listed, with the current one showing "Current plan" rather than a Subscribe button.
42. Click "Subscribe" on a different plan. **Expect:** a new tab opens to a **sandbox** EasyPaisa URL. Do **not** enter real payment details anywhere in this flow.

## 12. Responsive + accessibility

43. Resize the browser to **1024px** wide. **Expect:** no horizontal page scrolling; wide tables scroll inside their own container.
44. Resize to **768px**. **Expect:** still usable, no content clipped off-screen.
45. Press `Tab` repeatedly from the top of the page. **Expect:** a visible focus ring on every button, link, and input, in a sensible order.
46. **Expect:** every camera image and alert thumbnail has alt text (check with DevTools or a screen reader).

---

## Result

| Section | Steps | Result |
|---|---|---|
| Authentication | 1–7 | |
| Projects | 8–12 | |
| Site updates | 13 | |
| Materials | 14–15 | |
| Chat | 16–19 | |
| Live monitoring | 20–23 | |
| Safety alerts | 24–28 | |
| Attendance | 29–33 | |
| Analytics | 34–36 | |
| Reports | 37–39 | |
| Billing | 40–42 | |
| Responsive / a11y | 43–46 | |

Tester: ________________  Date: ____________  Build/commit: ____________
