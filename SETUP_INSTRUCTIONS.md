# BuildSite360 — Safety Detection Setup

End-to-end setup for the AI safety detection pipeline: camera → YOLOv8 → annotated
stream → alerts in the database → live dashboard.

Every command is run from the repository root unless a step says otherwise.
For a one-screen version see [QUICK_REFERENCE.md](QUICK_REFERENCE.md); when
something breaks, [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

Background reading lives in `verification/`: `CAMERA_SETUP_GUIDE.md` (per-device
camera walkthroughs), `DATASET_ORGANIZATION_GUIDE.md` (dataset sources and the
training recipe), `MISSING_COMPONENTS_QUICKSTART.md` and
`IMPLEMENTATION_SUMMARY.md`. Its four scripts were copied into
`ai-service/scripts/` and are usable alongside the ones documented here — see
*Two toolchains* below.

---

## What you are building

```
  camera (phone / IP cam / USB / file)
        │
        ▼
  ai-service/safety_stream.py ──── YOLOv8 (models/best.pt) ──── draws boxes
        │  MJPEG :8554                     │
        │                                  └── POST /api/internal/safety-alert
        ▼                                                  │
  server  GET /api/stream/safety  ◀── auth + project scope ─┤
          GET /api/detections/latest                        ▼
        │                                        SafetyAlert row + S3 frame
        ▼                                                  │
  client  LiveMonitoring.jsx  ◀──── socket.io "safety:alert" ┘
```

Two things are worth knowing before you start:

- **The Python service does the vision work.** Node never runs a model; it
  authenticates, scopes to a project, and proxies. That is why the browser never
  sees a camera URL.
- **The model is optional at boot.** Without `models/best.pt` the stream still
  runs and the dashboard still works — it just reports `modelLoaded: false` and
  detects nothing. Set the camera up first, train second.

---

## Two toolchains, one dataset

`ai-service/scripts/` now holds two sets of dataset tools that produce the same
result in the same place:

| Purpose | This build | Copied from `verification/` |
|---|---|---|
| Download | `download_dataset.py` (Roboflow / URL / local zip) | `download_kaggle_datasets.py`, `download_roboflow_datasets.py` |
| Organize | `organize_dataset.py` | `organize_datasets.py` |
| Verify | `test_integration.py`, `verify_setup.py` | `verify_dataset.py` |

Both organizers write `organized/images/{split}` + `organized/labels/{split}` with
the same four classes, so either can be followed and every verifier still reads
the output. The steps below use the first set because it is wired into
`test_integration.py`; the guide's scripts remain the reference for the Kaggle
route. The copied scripts run from the **repository root** (their paths are
written as `ai-service/data/...`).

---

## Prerequisites

| Component | Version | Notes |
|---|---|---|
| Node.js | 20+ | `node --version` |
| PostgreSQL | 15 | or the Docker service in the root README |
| Python | **3.10 or 3.11** | 3.12+ has no wheels for the pinned `torch`/`deepface` |
| ffmpeg | 6+ | already used by the raw camera relay |
| GPU (optional) | CUDA 11.8+ | CPU training works but takes hours |

> **Python 3.12/3.13 users:** `safety_stream.py` itself runs fine (it needs only
> opencv, fastapi, uvicorn, requests, dotenv). Training and face recognition do
> not — install 3.11 alongside and point the venv at it. See TROUBLESHOOTING.md.

---

## Step 1 — Python environment

```bash
cd ai-service
python -m venv .venv
```

```bash
source ai-service/.venv/Scripts/activate   # Windows (Git Bash); use .venv/bin/activate on macOS/Linux
```

```bash
pip install -r ai-service/requirements.txt
```

If the heavy packages fail on your Python version, the streaming service only
needs these:

```bash
pip install opencv-python fastapi uvicorn requests python-dotenv pyyaml
```

Verify the machine is ready — this opens no camera and loads no model, it only
checks packages, folders and configuration:

```bash
python ai-service/scripts/verify_setup.py
```

---

## Step 2 — Configure the camera

```bash
cp .env.local.example .env.local
```

Then edit `.env.local`. Pick the row that matches your camera:

| Camera | `CAMERA_TYPE` | `CAMERA_SOURCE` |
|---|---|---|
| Android phone (IP Webcam app) | `android_ip` | `http://192.168.1.100:8080/video` |
| iPhone (EpocCam / Iriun) | `usb` | `0` |
| IP camera (Hikvision) | `rtsp` | `rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101` |
| IP camera (Dahua) | `rtsp` | `rtsp://user:pass@192.168.1.64:554/cam/realmonitor?channel=1&subtype=0` |
| Laptop webcam | `usb` | `0` |
| Linux USB camera | `usb` | `/dev/video0` |
| Recorded clip (demo) | `file` | `./ai-service/data/test_clip.mp4` |

**Android in three steps:** install *IP Webcam* from the Play Store → scroll down
and tap **Start server** → it shows a URL like `http://192.168.1.100:8080`. Your
source is that URL with `/video` appended. The phone and the PC must be on the
same Wi-Fi network.

Confirm the feed is reachable before going further:

```bash
python ai-service/test_integration.py --skip dataset model inference stream api
```

That runs only the camera check and writes a sample frame to
`ai-service/data/output/camera_sample.jpg`. Open it — if it is your camera view,
the hard part is done.

---

## Step 3 — Dataset and training

Skip this section if you already have `ai-service/models/best.pt`.

### 3a. Download

```bash
python ai-service/scripts/download_dataset.py --source roboflow
```

Needs `ROBOFLOW_API_KEY` in `.env.local` (free account → Settings → API key).
No account? Export the dataset manually and load the zip:

```bash
python ai-service/scripts/download_dataset.py --source local --archive ~/Downloads/ppe.zip
```

Everything lands under `ai-service/data/datasets/raw/<name>/`, untouched.

### 3b. Organize

```bash
python ai-service/scripts/organize_dataset.py
```

This is the step that matters. It flattens the download, splits it 70/20/10, and
**remaps every class id** onto the four this project uses:

```
0 hardhat      1 construction_worker      2 ppe      3 no_ppe
```

Public PPE datasets ship 10+ classes in their own order, so the script reads the
source `data.yaml`, maps names through `CLASS_ALIASES`, and drops anything
unmapped. Read the summary it prints — if a class you care about is listed under
"Dropped source classes", add it to `CLASS_ALIASES` in
`ai-service/scripts/organize_dataset.py` and re-run with `--force`.

Output: `ai-service/data/datasets/organized/` with `images/{train,val,test}`,
`labels/{train,val,test}` and a generated `dataset.yaml` — the layout
`verification/DATASET_ORGANIZATION_GUIDE.md` documents, so the guide's own
`scripts/verify_dataset.py` reads it without modification:

```bash
python ai-service/scripts/verify_dataset.py
```

### 3c. Train

```bash
python ai-service/scripts/train_model.py --epochs 50
```

Check the banner it prints: if `Device: cpu` and you own an NVIDIA GPU, stop and
install the CUDA build of torch (TROUBLESHOOTING.md § Training). On a GPU expect
roughly 30–60 minutes for 50 epochs; on CPU, several hours.

On success the best checkpoint is copied to `ai-service/models/best.pt`, which is
exactly where `safety_stream.py` looks — training a better model and restarting
the service is the whole deployment process. The previous weights are kept as
`best.previous.pt`.

---

## Step 4 — Wire the services together

The Python service authenticates to the Node API with a shared secret. It must
match **byte for byte** on both sides or every alert is rejected with 401.

`server/.env`:

```
X_INTERNAL_TOKEN=pick-a-long-random-string
SAFETY_STREAM_URL=http://127.0.0.1:8554
```

`.env.local` (repo root, read by the Python service):

```
X_INTERNAL_TOKEN=pick-a-long-random-string
NODE_API_URL=http://localhost:3000
```

### Attributing alerts to a camera

A `SafetyAlert` row needs a `cameraId`, so the detector must know which camera
row it is watching. Create one (as ADMIN or an assigned ENGINEER):

```bash
curl -X POST http://localhost:3000/api/projects/<projectId>/cameras -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"name":"Gate cam","zone":"ENTRANCE","rtspUrl":"http://192.168.1.100:8080/video"}'
```

Put the returned `id` into `.env.local` as `SAFETY_CAMERA_ID`. Without it the
stream and the live counters still work; only database persistence is skipped.

> **`rtspUrl` is not restricted to RTSP.** The column keeps its original name, but
> HTTP/MJPEG URLs, file paths, `/dev/videoN` and device indices are all accepted —
> `server/src/utils/cameraSource.js` classifies them.

### The `no_ppe` mapping

The Prisma `ViolationType` enum has two values, `NO_HELMET` and `NO_VEST`, while
the model emits `no_ppe`. The detector maps `no_ppe` → `NO_HELMET` by default
(`NO_PPE_VIOLATION_TYPE` in `.env.local`). To store it under its own name instead,
add the value and migrate:

```
enum ViolationType {
  NO_HELMET
  NO_VEST
  NO_PPE
}
```

```bash
cd server && npx prisma migrate dev --name add_no_ppe_violation
```

Then set `NO_PPE_VIOLATION_TYPE=NO_PPE`. The API validates against its own list in
`server/src/routes/internal/safety.js` — add `'NO_PPE'` to `VIOLATION_TYPES` there
too, or the new value is rejected with 400.

---

## Step 5 — Run everything

Four terminals (or use the root `package.json` scripts):

```bash
cd server && npm run dev
```

```bash
cd client && npm run dev
```

```bash
cd ai-service && python safety_stream.py
```

```bash
cd ai-service && python main.py
```

The fourth is only needed for attendance/face enrolment; safety detection does
not depend on it.

Expected startup line from the detector:

```
INFO [safety_stream] safety_stream ready on :8554 (default source='http://…/video' type=android_ip, conf=0.50, model=loaded)
```

---

## Step 6 — Verify

```bash
python ai-service/test_integration.py
```

Seven checks in dependency order — environment, dataset, camera, model,
inference, stream service, Node API — with a JSON report written to
`ai-service/data/output/verification_report.json`. Services that are not running
are reported as SKIP rather than FAIL, so the script is also useful mid-setup.

Manual spot checks:

```bash
curl http://127.0.0.1:8554/health
```

```bash
curl "http://127.0.0.1:8554/detections/latest"
```

In the browser: log in, open a project, and scroll to **Live safety monitoring**.
You should see the annotated feed, four class counters, the Recharts bar chart,
and any alert appearing as a toast within a second of the violation.

---

## API reference

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/stream/safety?cameraId=&token=` | JWT (header or query) | Annotated MJPEG. `&annotate=0` for the raw feed |
| `GET /api/detections/latest?cameraId=` | JWT | Live detections, per-class counts, last 10 alerts |
| `POST /api/internal/detections` | `X-Internal-Token` | Detection snapshot push → socket fan-out |
| `POST /api/internal/safety-alert` | `X-Internal-Token` | Violation → S3 frame + `SafetyAlert` row + socket |
| `GET /api/projects/:id/safety-alerts` | JWT | Paginated alert history |
| `GET /api/cameras/:id/stream?token=` | JWT | Raw camera relay via ffmpeg (no detection) |

Socket.io events on room `project:<id>`: `safety:alert` (persisted violation),
`safety:detections` (live snapshot).

Python service (localhost only — do not expose it): `/health`, `/stream`,
`/detections/latest`, `/stats`, `/cameras`.

---

## Production notes

Things that are deliberately dev-shaped in this build:

1. **Stream tokens.** `<img>` cannot send an `Authorization` header, so the JWT
   travels in the query string and lands in access logs. Issue a short-lived,
   stream-scoped token instead.
2. **Bind the internal endpoints to the internal network.** `X-Internal-Token` is
   the only thing between an attacker and forged safety alerts.
3. **Cooldowns are per-process and in memory.** Behind a load balancer each
   instance keeps its own window; move it to Redis if duplicate alerts matter.
4. **Detection snapshots are cached in memory**, not persisted — only
   `SafetyAlert` rows are the record.
5. **HLS** is listed as the secondary stream format in the project spec but is not
   implemented; MJPEG is the only path today. Add an ffmpeg HLS muxer alongside
   the MJPEG generator in `safety_stream.py` if you need it.
