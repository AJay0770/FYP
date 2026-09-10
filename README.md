# BuildSite 360

A construction site monitoring platform with real-time safety detection, material tracking, and team attendance.

## Quick Start (3 Terminals)

### Prerequisites
- Node.js 20
- Python 3.10 or 3.11 — **not 3.12+**; `deepface` needs TensorFlow, which has no
  wheels beyond 3.11, so facial recognition cannot run there (`torch`/`ultralytics` can)
- PostgreSQL 15 (or Supabase)
- MinIO (Docker, or the standalone binary — see below)
- **ffmpeg** — required for RTSP camera streaming and clip recording. Either put it
  on `PATH` or set `FFMPEG_PATH` in `server/.env` to the binary.

> ffmpeg note: the RTSP socket-timeout flag was renamed between versions
> (`-stimeout` in ffmpeg ≤5, `-timeout` in 6+). The server probes for the correct
> one at startup and logs which it picked; passing the wrong flag makes ffmpeg
> refuse to start, which breaks *every* stream, not just unreachable ones.

### Testing cameras without real hardware

Run an RTSP server ([MediaMTX](https://github.com/bluenviron/mediamtx/releases)) and
publish a synthetic feed to it:

```bash
mediamtx.exe
```

```bash
ffmpeg -re -stream_loop -1 -f lavfi -i "testsrc=size=640x480:rate=15" \
  -c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g 30 \
  -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/testcam
```

Then register a camera with `rtspUrl` of `rtsp://127.0.0.1:8554/testcam`.

### Setup

1. **Clone and install dependencies:**
```bash
   cd E:\buildsite360_website
   cd server && npm install && cd ..
   cd client && npm install && cd ..
   cd ai-service && python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt && cd ..
```

2. **Configure environment:**
```bash
   # Copy .env.example to .env in each service folder
   copy .env.example server\.env
   copy .env.example client\.env.local
   copy .env.example ai-service\.env
   # Update with your Supabase DATABASE_URL and other credentials
```

3. **Run Supabase migrations (if using local PostgreSQL):**
```bash
   cd server
   npx prisma migrate dev --name init
```

### Run Services

**Terminal 1: MinIO (S3 Alternative)**

With Docker:
```bash
docker run -p 9000:9000 -p 9001:9001 \
  -e MINIO_ROOT_USER=minioadmin \
  -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data --console-address ":9001"
```

Without Docker (standalone binary — download once from https://dl.min.io/server/minio/release/windows-amd64/minio.exe):
```bash
set MINIO_ROOT_USER=minioadmin
set MINIO_ROOT_PASSWORD=minioadmin
minio.exe server .\minio-data --address ":9000" --console-address ":9001"
```

Either way, create the bucket once (matches `AWS_S3_BUCKET` in `.env`):
```bash
# via the AWS CLI, mc, or the MinIO console at http://localhost:9001
```
The bucket is private by default — `getPublicUrl()` returns the URL objects will live at once a bucket policy or CDN makes them publicly readable; that's a deployment decision, not something the app configures automatically.

**Terminal 2: Node.js API**
```bash
cd server
npm run dev
# Runs on http://localhost:3000/api/health
```

**Terminal 3: React Client**
```bash
cd client
npm run dev
# Runs on http://localhost:5173
```

**Terminal 4 (Optional): Python AI Service**
```bash
cd ai-service
source venv/bin/activate  # or venv\Scripts\activate on Windows
python main.py
# Runs on http://localhost:8000/health
```

### Test Health Checks

```bash
# API
curl http://localhost:3000/api/health

# AI Service
curl http://localhost:8000/health

# Client
Open http://localhost:5173 in browser
```
# Git Workflow

- Never push directly to main/master.
- Never force push.
- Never reset or discard user changes without explicit permission.
- Always work on a feature/fix branch.
- Before committing, inspect git diff and git status.
- Run relevant tests before committing.
- Do not create a commit unless requested or explicitly authorized by the user.
- Before pushing, show the user what will be pushed.
- Pull requests should target the team's designated development branch.

## Push Safety

Before running `git push`:

1. Show the current branch.
2. Show git status.
3. Show the commits that will be pushed.
4. Confirm that the destination is not main/master.
5. Ask the user for confirmation before pushing.

Never push automatically.