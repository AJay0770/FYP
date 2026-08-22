# BuildSite360 — Troubleshooting

Symptoms are grouped by where they surface. Start with:

```bash
python ai-service/test_integration.py
```

It reports the first stage that is broken, which is usually the only one worth
fixing — the later failures are consequences.

---

## Camera

### `cannot open source '...'` / camera check FAILs

Work down this list; the first two account for most cases.

1. **Wrong URL shape.** The path matters as much as the host:
   - Android IP Webcam serves video at `/video`, not at the bare address.
   - Hikvision: `rtsp://user:pass@ip:554/Streaming/Channels/101`
   - Dahua: `rtsp://user:pass@ip:554/cam/realmonitor?channel=1&subtype=0`
2. **Different network.** The phone or camera and the PC must be on the same
   subnet. Phones on mobile data, or a "guest" Wi-Fi with client isolation, are
   unreachable no matter what the URL says.
3. **Test outside the app first.** If VLC cannot open it, Python will not either:
   ```bash
   ffplay -rtsp_transport tcp "rtsp://user:pass@192.168.1.64:554/Streaming/Channels/101"
   ```
4. **Special characters in the password.** `@`, `/` and `:` break URL parsing.
   Percent-encode them: `p@ss` → `p%40ss`.
5. **Camera busy.** Most IP cameras allow only 1–2 concurrent RTSP sessions. Close
   VLC and any other viewer.

### Webcam opens but every frame is black

The camera is in use by another application (Teams, Zoom, OBS), or on Windows the
capture backend is wrong. Try a different index (`CAMERA_SOURCE=1`), close the
other app, and check the OS camera privacy setting.

### Stream is several seconds behind

Lower the work per frame in `.env.local`:

```
STREAM_FRAME_WIDTH=640
INFERENCE_FPS=2
STREAM_FPS=8
```

Inference is the expensive part — `INFERENCE_FPS` matters far more than
`STREAM_FPS`. On RTSP, also confirm you are not on a high-resolution main stream
where a substream would do (Hikvision `Channels/102`, Dahua `subtype=1`).

### `/dev/video0: permission denied` (Linux)

```bash
sudo usermod -aG video $USER
```

Log out and back in for it to take effect.

---

## Detection service (`safety_stream.py`)

### `Running WITHOUT detection: weights not found`

Expected before training. The service still streams and the dashboard still
works; nothing is detected. Fix by training (`scripts/train_model.py`) or by
pointing `YOLO_MODEL_PATH` at existing weights.

If you *have* trained and still see this, check where it is looking — `/health`
reports the absolute `modelPath` it resolved. Relative paths are resolved against
the working directory, then the repo root, then `ai-service/`.

### `ModuleNotFoundError: No module named 'ultralytics'`

The virtualenv is not active, or packages were installed into a different
interpreter:

```bash
source ai-service/.venv/Scripts/activate
```

```bash
python -c "import sys; print(sys.executable)"
```

### `Address already in use` on 8554

Another copy is still running:

```bash
netstat -ano | findstr :8554
```

```bash
taskkill /PID <pid> /F
```

### The service ignores my `CAMERA_SOURCE`

Precedence is: exported environment variable → `.env.local` → `.env`. If a shell
variable is set, it wins on purpose. Check what the service actually resolved:

```bash
curl http://127.0.0.1:8554/health
```

### High CPU with no GPU

Every frame is being decoded and run through the model on the CPU. Reduce
`INFERENCE_FPS` to 1–2 and `STREAM_FRAME_WIDTH` to 640. `MAX_CAMERA_WORKERS`
caps how many cameras can be active at once.

---

## Training

### `Device: cpu` on a machine with an NVIDIA GPU

The CPU build of torch is installed. Replace it with a CUDA build:

```bash
pip uninstall -y torch torchvision
```

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu118
```

```bash
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

### `CUDA out of memory`

Lower the batch size, then the image size:

```bash
python ai-service/scripts/train_model.py --batch 8
```

```bash
python ai-service/scripts/train_model.py --batch 4 --imgsz 512
```

`--batch -1` lets ultralytics pick a size that fits.

### `organize_dataset.py` drops most of my annotations

The script prints every source class it could not map under "Dropped source
classes". Public datasets name things differently (`Hardhat`, `helmet`,
`safety_helmet`). Add the names to `CLASS_ALIASES` in
`ai-service/scripts/organize_dataset.py` and re-run with `--force`.

Dropping is deliberate: silently keeping an unknown class would shift every
class id and produce a model that is confidently wrong.

### `No training images were produced`

Either no image/label pairs were found (the download is incomplete) or every
annotation mapped to a dropped class (see above). Check the raw folder:

```bash
python ai-service/scripts/download_dataset.py --source roboflow --force
```

### mAP stays near zero

Usually the class mapping, not the model. Confirm `data.yaml` lists exactly
`[hardhat, construction_worker, ppe, no_ppe]`, then open a few images from
`organized/train/images` with their label boxes drawn. 50 epochs on a few hundred
images will not produce a usable model — expect a few thousand.

---

## API and streaming

### `503 Detection service is not running`

The Node API could not reach `safety_stream.py`. Start it, then confirm the URL
the API is using (`SAFETY_STREAM_URL`, default `http://127.0.0.1:8554`) matches
the port the service actually bound.

### `401 Invalid internal token`

`X_INTERNAL_TOKEN` differs between `server/.env` and `.env.local`. They must match
byte for byte — a trailing space or a quoted value counts as different.

### `500 Internal auth not configured`

`X_INTERNAL_TOKEN` is unset on the server side. It fails closed on purpose: a
blank secret must never mean "allow everyone".

### Alerts appear in the stream but never in the database

`SAFETY_CAMERA_ID` is unset, so the detector has no camera row to attach a
`SafetyAlert` to. Create a camera and put its id in `.env.local` — see
SETUP_INSTRUCTIONS.md step 4.

### `400 violationType must be one of: NO_HELMET, NO_VEST`

The detector sent a violation type the Prisma enum does not have — normally
`NO_PPE`. Either leave `NO_PPE_VIOLATION_TYPE=NO_HELMET`, or add `NO_PPE` to the
enum, migrate, **and** add it to `VIOLATION_TYPES` in
`server/src/routes/internal/safety.js`. Changing only the enum is the usual
mistake: the route validates against its own list.

### Only one alert per minute arrives

Working as designed. Two cooldowns apply: `ALERT_COOLDOWN_SECONDS` in the
detector and a 60s window per camera+violation in the API. Lower both to test.

### `501 ffmpeg is not installed on the server`

Only affects the raw relay `/api/cameras/:id/stream`. Install ffmpeg or set
`FFMPEG_PATH`. The annotated `/api/stream/safety` path uses OpenCV instead and is
unaffected.

---

## Frontend

### Stream tile shows "Stream unavailable"

The `<img>` request failed. Open its URL directly in a tab — the JSON error is
more specific than the placeholder. Common causes: the detector is down (503), the
JWT expired (401), or the camera belongs to another project (404).

### Boxes look offset or scaled wrong

Only affects "Browser-drawn boxes" mode. It scales boxes using `frameSize` from
`/detections/latest`; if the detector restarted with a different
`STREAM_FRAME_WIDTH`, refresh the page. Switching to server-drawn boxes always
matches, since they are burned into the frame.

### Counters stay at zero while the stream looks fine

The model is not loaded — the page says so under the video, and `/health` reports
`modelLoaded: false`. Train the model, then restart the detector.

### No toast when a violation is detected

Toasts come from the `safety:alert` socket event, which only fires when an alert
is *persisted*. If `SAFETY_CAMERA_ID` is unset, nothing is persisted and no toast
appears. Check the browser console for a socket connection error, and that the
user has access to the project.

---

## Environment

### Python 3.12+ — `torch==2.0.1` will not install

No wheels exist for that version. Options, in order of preference:

1. Install Python 3.11 and build the venv with it:
   ```bash
   py -3.11 -m venv ai-service/.venv
   ```
2. Run only the streaming service, which does not need torch:
   ```bash
   pip install opencv-python fastapi uvicorn requests python-dotenv pyyaml
   ```
3. Install unpinned versions and accept the risk of API drift:
   ```bash
   pip install torch torchvision ultralytics
   ```

`deepface` (attendance) has the same constraint and no workaround — it needs
TensorFlow, which is 3.11-only here.

### `@prisma/client did not initialize yet`

```bash
cd server && npx prisma generate
```

### Node cannot find `express`

Dependencies were never installed in `server/`:

```bash
npm install --prefix server
```

---

## Getting a clean read on the system

```bash
python ai-service/scripts/verify_setup.py
```

```bash
python ai-service/test_integration.py
```

```bash
curl http://127.0.0.1:8554/stats
```

```bash
curl http://localhost:3000/api/health
```

`ai-service/data/output/verification_report.json` holds the last full run,
including per-check timings — attach it when asking someone else for help.
