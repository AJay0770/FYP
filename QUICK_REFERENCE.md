# BuildSite360 — Quick Reference

Copy-paste commands, one phase per section. Full explanations in
[SETUP_INSTRUCTIONS.md](SETUP_INSTRUCTIONS.md); fixes in
[TROUBLESHOOTING.md](TROUBLESHOOTING.md).

All commands run from the repository root.

---

## Phase 0 — First-time setup

```bash
npm install --prefix server && npm install --prefix client
```

```bash
cd server && npx prisma generate && npx prisma migrate dev && cd ..
```

```bash
python -m venv ai-service/.venv
```

```bash
source ai-service/.venv/Scripts/activate
```

```bash
pip install -r ai-service/requirements.txt
```

```bash
cp .env.local.example .env.local
```

```bash
cp server/.env.example server/.env
```

---

## Phase 1 — Camera

Edit `CAMERA_TYPE` / `CAMERA_SOURCE` in `.env.local`, then:

```bash
python ai-service/scripts/verify_setup.py
```

```bash
python ai-service/test_integration.py --skip dataset model inference stream api
```

The captured frame is written to `ai-service/data/output/camera_sample.jpg`.

| Camera | `CAMERA_SOURCE` |
|---|---|
| Android IP Webcam | `http://192.168.1.100:8080/video` |
| Hikvision RTSP | `rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101` |
| Dahua RTSP | `rtsp://user:pass@192.168.1.64:554/cam/realmonitor?channel=1&subtype=0` |
| Laptop webcam | `0` |
| Linux USB | `/dev/video0` |
| Video file | `./ai-service/data/test_clip.mp4` |

---

## Phase 2 — Dataset

```bash
python ai-service/scripts/download_dataset.py --source roboflow
```

```bash
python ai-service/scripts/download_dataset.py --source local --archive ~/Downloads/ppe.zip
```

```bash
python ai-service/scripts/organize_dataset.py
```

```bash
python ai-service/scripts/organize_dataset.py --force --split 0.8 0.1 0.1
```

```bash
python ai-service/scripts/verify_dataset.py
```

Result: `ai-service/data/datasets/organized/images/{train,val,test}` +
`labels/{train,val,test}` + `dataset.yaml`, classes
`[hardhat, construction_worker, ppe, no_ppe]`.

Alternative toolchain from `verification/` (run from the repo root):

```bash
python ai-service/scripts/download_kaggle_datasets.py
```

```bash
python ai-service/scripts/organize_datasets.py
```

---

## Phase 3 — Training

```bash
python ai-service/scripts/train_model.py --epochs 50
```

```bash
python ai-service/scripts/train_model.py --epochs 100 --batch 8 --device 0
```

```bash
python ai-service/scripts/train_model.py --resume
```

Publishes `ai-service/models/best.pt` (previous weights kept as `best.previous.pt`).

---

## Phase 4 — Run

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

Ports: API `3000`, client `5173`, safety stream `8554`, AI service `8000`.

---

## Phase 5 — Verify

```bash
python ai-service/test_integration.py
```

```bash
curl http://127.0.0.1:8554/health
```

```bash
curl http://127.0.0.1:8554/detections/latest
```

```bash
curl http://127.0.0.1:8554/stats
```

Report: `ai-service/data/output/verification_report.json`.

---

## API cheat sheet

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/detections/latest?cameraId=$CAMERA_ID"
```

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/projects/$PROJECT_ID/safety-alerts?limit=20"
```

```bash
curl -X POST http://localhost:3000/api/projects/$PROJECT_ID/cameras -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"name":"Gate cam","zone":"ENTRANCE","rtspUrl":"http://192.168.1.100:8080/video"}'
```

Stream in a browser (token in the query string — `<img>` cannot send headers):

```
http://localhost:3000/api/stream/safety?cameraId=<id>&token=<jwt>
```

| Route | Auth | Returns |
|---|---|---|
| `GET /api/stream/safety` | JWT | MJPEG with boxes (`&annotate=0` = raw) |
| `GET /api/detections/latest` | JWT | detections + counts + last 10 alerts |
| `GET /api/projects/:id/safety-alerts` | JWT | alert history |
| `GET /api/cameras/:id/stream` | JWT | raw ffmpeg relay, no detection |
| `POST /api/internal/safety-alert` | `X-Internal-Token` | persist a violation |
| `POST /api/internal/detections` | `X-Internal-Token` | push a live snapshot |

Socket.io (room `project:<id>`): `safety:alert`, `safety:detections`.

---

## Environment variables

| Variable | Default | Used by |
|---|---|---|
| `CAMERA_TYPE` | `auto` | label only |
| `CAMERA_SOURCE` | `0` | Python stream; Node fallback |
| `STREAM_PORT` | `8554` | Python stream |
| `STREAM_FORMAT` | `mjpeg` | (MJPEG is the only implemented format) |
| `STREAM_FPS` / `INFERENCE_FPS` | `12` / `4` | Python stream |
| `SAFETY_CONFIDENCE_THRESHOLD` | `0.5` | Python stream |
| `ATTENDANCE_DISTANCE_THRESHOLD` | `0.65` | face matching |
| `YOLO_MODEL_PATH` | `models/best.pt` | Python stream, tests |
| `SAFETY_CAMERA_ID` | — | which camera alerts attach to |
| `NO_PPE_VIOLATION_TYPE` | `NO_HELMET` | enum mapping for `no_ppe` |
| `ALERT_COOLDOWN_SECONDS` | `60` | client-side alert throttle |
| `SAFETY_STREAM_URL` | `http://127.0.0.1:8554` | Node proxy target |
| `X_INTERNAL_TOKEN` | — | **must match** on both sides |
| `ROBOFLOW_API_KEY` | — | dataset download only |

Precedence: real environment variables → `.env.local` → `.env`.

---

## File map

| Path | What it is |
|---|---|
| `ai-service/safety_stream.py` | detection + MJPEG service |
| `ai-service/scripts/download_dataset.py` | fetch a dataset |
| `ai-service/scripts/organize_dataset.py` | split + remap to 4 classes |
| `ai-service/scripts/train_model.py` | fine-tune, publish `best.pt` |
| `ai-service/scripts/verify_setup.py` | pre-flight environment check |
| `ai-service/scripts/verify_dataset.py` | dataset integrity report (from `verification/`) |
| `ai-service/scripts/download_kaggle_datasets.py` | Kaggle download (from `verification/`) |
| `ai-service/scripts/download_roboflow_datasets.py` | Roboflow download (from `verification/`) |
| `ai-service/scripts/organize_datasets.py` | alternative organizer (from `verification/`) |
| `ai-service/test_integration.py` | 7-stage pipeline test + report |
| `ai-service/services/safety_detector.py` | headless per-camera watcher (no stream) |
| `server/src/routes/safetyDetection.js` | `/stream/safety`, `/detections/latest` |
| `server/src/routes/internal/safety.js` | alert persistence + socket emit |
| `server/src/utils/cameraSource.js` | camera source classification |
| `client/src/pages/LiveMonitoring.jsx` | live view, overlay, stats, alerts |
| `client/src/components/SafetyAlertsPanel.jsx` | alert history table |
