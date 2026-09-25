# BuildSite 360

A construction site monitoring platform with real-time safety detection, material tracking, and team attendance.

## Quick Start

### Prerequisites: software to install

Install these once on each computer that runs the project. Windows commands use
`winget` (built into Windows 10/11); macOS uses Homebrew; Linux uses apt.

| Software | Version | Windows | macOS / Linux |
|---|---|---|---|
| Git | any | `winget install Git.Git` | `brew install git` / `sudo apt install git` |
| Node.js | 20 or newer | `winget install OpenJS.NodeJS.LTS` | `brew install node@20` / [nodejs.org](https://nodejs.org) |
| PostgreSQL | 15 | `winget install PostgreSQL.PostgreSQL.15` | `brew install postgresql@15` / `sudo apt install postgresql` |
| Python | **3.11** (or 3.10) | `winget install Python.Python.3.11` | `brew install python@3.11` / `sudo apt install python3.11 python3.11-venv` |
| ffmpeg | any recent | `winget install Gyan.FFmpeg` | `brew install ffmpeg` / `sudo apt install ffmpeg` |
| SeaweedFS (file storage) | 4.x | download `windows_amd64.zip` from [releases](https://github.com/seaweedfs/seaweedfs/releases), unzip `weed.exe` | same page, your OS build |

Notes:
- **Python must be 3.10 or 3.11, not 3.12+.** Face recognition (`deepface`)
  needs TensorFlow 2.15, which has no builds for newer Python. Having 3.12 as
  well is fine; the setup below creates the AI environment with 3.11 explicitly.
- **Restart your terminal after installing**, so newly installed programs
  (especially ffmpeg) are found on `PATH`.
- If ffmpeg or SeaweedFS is not on `PATH`, set `FFMPEG_PATH` / `SEAWEEDFS_BIN`
  in `server/.env` to the full path of the program instead.
- Create an empty database for the app (e.g. `buildsite360`) in PostgreSQL and
  put its connection string in `DATABASE_URL` in `server/.env`.
- The trained model `ai-service/models/best.pt` is **not** in git. Copy it in by
  hand (USB drive, cloud storage); see step 4 of Setup.

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

> Port clash: MediaMTX's default RTSP port (8554) is also the AI detection
> service's default `STREAM_PORT`. To run both, move one of them, e.g. set
> `STREAM_PORT=8556` in `ai-service/.env` and `SAFETY_STREAM_URL`/`STREAM_PORT`
> to match in `server/.env`.

### Setup (any new computer)

1. **Install dependencies.** Run npm from the repo root: `server` and `client`
   are npm workspaces sharing one `package-lock.json`.
   ```bash
   npm install
   ```
   The AI service needs **Python 3.10 or 3.11** specifically. On Windows, where
   `python` may be a newer version, pick 3.11 explicitly with the `py` launcher:
   ```bash
   cd ai-service
   py -3.11 -m venv venv          # macOS/Linux: python3.11 -m venv venv
   venv\Scripts\pip install -r requirements.txt   # macOS/Linux: venv/bin/pip ...
   cd ..
   ```
   `requirements.txt` pins `tensorflow==2.15.1` on purpose. Newer TensorFlow
   ships Keras 3, which breaks `deepface` (face recognition) at import.

2. **Configure environment.** Each service has its own example file:
   ```bash
   copy server\.env.example server\.env
   copy client\.env.local.example client\.env.local
   copy ai-service\.env.example ai-service\.env
   ```
   Then fill in `server/.env` (`DATABASE_URL`, JWT secrets, storage keys).
   `X_INTERNAL_TOKEN` must be the same value in `server/.env` and `ai-service/.env`.

3. **Create the database tables:**
   ```bash
   cd server
   npx prisma migrate deploy
   ```

4. **Copy in the trained model.** `ai-service/models/best.pt` is deliberately
   not in git (`*.pt` is ignored). Copy it from the training machine, a USB
   drive, or cloud storage into `ai-service/models/best.pt`. Without it, video
   still streams but there is no helmet/vest detection.

5. **Check the setup:**
   ```bash
   npm run doctor
   ```
   This reports anything missing: Node and Python versions, env files, a token
   mismatch between services, database and migrations, ffmpeg, object storage,
   Python packages, the model file, and whether the AI services are running.
   It never prints secret values.

### Run Services

Each command runs in its own terminal, from the repo root.

**1. Object storage (S3-compatible)**: used for report PDFs, media uploads,
recorded clips and violation snapshots. The rest of the app works without it,
and violations are still recorded (without their snapshot image).

Local development uses [SeaweedFS](https://github.com/seaweedfs/seaweedfs/releases)
(download `windows_amd64.zip` or your OS build once, then put `weed` on PATH or
set `SEAWEEDFS_BIN` in `server/.env`):
```bash
npm run storage
```
It reads the port, keys, bucket and allowed browser origin from `server/.env`,
creates the bucket, listens on 127.0.0.1 only, and keeps data in `storage-data/`
(git-ignored). Stored files are publicly *readable* so images show in the app;
writing still needs the app's keys or a presigned URL the API issued.

> MinIO, the original choice, archived its open-source server and no longer
> distributes binaries (`dl.min.io` returns *410 Gone*). Any S3-compatible store
> (AWS S3, Supabase Storage) also works: point `AWS_S3_ENDPOINT` and the
> `AWS_*` keys at it.

**2. Node.js API**, on http://localhost:3000/api/health
```bash
npm run dev:server
```

**3. React client**, on http://localhost:5173
```bash
npm run dev:client
```

**4. AI detection service**: live PPE detection and the webcam/camera relay,
on 127.0.0.1:8554.
```bash
cd ai-service
venv\Scripts\python safety_stream.py      # macOS/Linux: venv/bin/python
```

**5. AI enrolment service**: face enrolment for workers, on 127.0.0.1:8000.
```bash
cd ai-service
venv\Scripts\python main.py
```

Both AI services listen on `127.0.0.1` only. The browser never talks to them
directly; the Node API proxies everything. Override with `STREAM_HOST` /
`AI_HOST` only if the API runs on a different machine.

### Using a laptop webcam as a site camera

A camera whose source is `0` is the computer's built-in webcam (`1`, `2`... for
extra USB cameras). In a project's **Live monitoring** panel, click **Change
source** on a camera and enter `0` (or click **Use laptop webcam**).

- The webcam can only be used by one feed at a time. Opening another project's
  webcam camera takes it over automatically; **Stop feed** releases it by hand.
- The feed goes through the AI detection service, so helmet/vest detection
  runs on it.
- If the AI service cannot be installed on a machine, set
  `LOCAL_CAMERA_DIRECT=true` in `server/.env`. ffmpeg then opens the webcam
  itself: live video works, but without detection. Turn it off while
  `safety_stream.py` runs, or the two will fight over the device.

### Test Health Checks

```bash
npm run doctor                      # everything at once
curl http://localhost:3000/api/health
curl http://127.0.0.1:8554/health   # detection service (modelLoaded: true)
curl http://127.0.0.1:8000/health   # enrolment service
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