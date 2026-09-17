"""BuildSite360 - live PPE safety detection stream (FastAPI + OpenCV + YOLOv8).

Serves an annotated MJPEG stream and a JSON view of the current detections for
one or more camera sources, and reports PPE violations back to the Node API so
they land in the database and reach the browser over Socket.io.

    Node API  --GET /stream?source=...-->  this service --> MJPEG (boxes drawn)
                                                |
                                                +--POST /api/internal/safety-alert--> Node API --socket--> React

Camera sources are accepted in five shapes (see `resolve_source`):

    http(s)://host:8080/video   Android IP Webcam / any MJPEG or HTTP feed
    rtsp://user:pass@host/live  IP camera
    /path/to/clip.mp4           video file (loops, useful for demos/tests)
    /dev/video0                 Linux V4L2 device
    0, 1, 2 ...                 OpenCV device index (built-in/USB webcam)

Run:
    cd ai-service
    python safety_stream.py                       # honours STREAM_PORT (default 8554)
    uvicorn safety_stream:app --port 8554         # equivalent

Endpoints:
    GET /health                      liveness + whether the model loaded
    GET /stream                      multipart/x-mixed-replace MJPEG
    GET /detections/latest           current detections, per-class counts, alerts
    GET /stats                       aggregate counters for every active worker
    GET /cameras                     active workers and their state

The model is OPTIONAL at boot: if `models/best.pt` is missing the service still
streams raw frames and reports `model_loaded: false`, so camera wiring can be
verified before the model has finished training.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import threading
import time
from collections import Counter, deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import cv2
import requests
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse

SERVICE_ROOT = Path(__file__).resolve().parent
REPO_ROOT = SERVICE_ROOT.parent

# Precedence, highest first: real environment variables, then .env.local
# (machine-specific), then .env (committed defaults).
#
# Every call passes override=False, so whatever is already set wins and the
# files are consulted in the order listed. Loading .env.local with override=True
# would look equivalent but is not: it would also clobber variables the operator
# explicitly exported, so `CAMERA_SOURCE=... python safety_stream.py` would
# silently run against the wrong camera.
for _env_file in (
    SERVICE_ROOT / ".env.local",
    REPO_ROOT / ".env.local",
    SERVICE_ROOT / ".env",
    REPO_ROOT / ".env",
):
    load_dotenv(_env_file, override=False)

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-7s [safety_stream] %(message)s",
)
log = logging.getLogger("safety_stream")

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def resolve_model_path(configured: str | None) -> Path:
    """Resolve YOLO_MODEL_PATH, which is conventionally written repo-relative.

    `ai-service/models/best.pt` in .env.local means the same file whether the
    service is started from the repo root or from ai-service/. Relative paths are
    therefore tried against the repo root and the service root, not just the
    working directory - otherwise the same config silently fails depending on
    where you launched it from.
    """
    raw = (configured or "models/best.pt").strip()
    candidate = Path(raw)

    if candidate.is_absolute():
        return candidate

    for base in (Path.cwd(), REPO_ROOT, SERVICE_ROOT):
        resolved = (base / candidate).resolve()
        if resolved.exists():
            return resolved

    # Nothing exists yet (the model has not been trained). Report the path
    # train_model.py will publish to, so the warning names the right file.
    base = REPO_ROOT if candidate.parts and candidate.parts[0] == SERVICE_ROOT.name else SERVICE_ROOT
    return (base / candidate).resolve()


MODEL_PATH = resolve_model_path(os.getenv("YOLO_MODEL_PATH"))
CAMERA_SOURCE = os.getenv("CAMERA_SOURCE", "0")
CAMERA_TYPE = os.getenv("CAMERA_TYPE", "auto")
CONFIDENCE_THRESHOLD = float(os.getenv("SAFETY_CONFIDENCE_THRESHOLD", "0.5"))
STREAM_PORT = int(os.getenv("STREAM_PORT", "8554"))
STREAM_FPS = float(os.getenv("STREAM_FPS", "12"))
INFERENCE_FPS = float(os.getenv("INFERENCE_FPS", "4"))
JPEG_QUALITY = int(os.getenv("STREAM_JPEG_QUALITY", "80"))
FRAME_WIDTH = int(os.getenv("STREAM_FRAME_WIDTH", "960"))  # 0 disables downscaling

NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:3000").rstrip("/")
INTERNAL_TOKEN = os.getenv("X_INTERNAL_TOKEN")
# `or None` matters: .env.local ships SAFETY_CAMERA_ID= blank, and an empty
# string would read as "configured" and be sent as a camera id the API rejects.
DEFAULT_CAMERA_ID = os.getenv("SAFETY_CAMERA_ID") or None  # optional: alert attribution
# 15 minutes, not the old 60s: a violation is now attributed to a specific
# enrolled worker (see "Per-worker face matching" below), so the cooldown is
# keyed per worker+violation type, not per camera - the same worker standing
# in frame bare-headed for an extended period shouldn't re-alert every minute.
ALERT_COOLDOWN_SECONDS = float(os.getenv("ALERT_COOLDOWN_SECONDS", str(15 * 60)))

# --------------------------------------------------------------------------
# Per-worker face matching
# --------------------------------------------------------------------------
#
# Only an enrolled worker can ever be reported as a violation (a bare head on
# someone who isn't an enrolled worker - a visitor, someone not yet enrolled -
# is shown on the annotated feed for situational awareness but never alerted
# or counted as a hazard). This means every hazard detection needs a face
# match against that camera's project's enrolled workers before it can become
# an alert, using the same ArcFace/cosine-similarity approach already used for
# attendance (see services/attendance_detector.py) - reused here rather than
# reinvented, including the same threshold-is-a-similarity-not-a-distance
# caveat documented in scripts/match_face.py.
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.68"))
FACE_MATCH_MODEL = "ArcFace"
# "opencv", not "retinaface": retinaface crashes outright in this project's
# actual installed combo (deepface==0.0.71 + retina-face==0.0.18 + TF 2.15) -
# see ai-service/endpoints/enrollment.py for the full explanation.
FACE_MATCH_DETECTOR_BACKEND = "opencv"
# How often to re-fetch a camera's enrolled-worker list. Long enough that
# matching a violation doesn't cost a Node round-trip every time, short enough
# that a worker enrolled mid-shift is usable without restarting this service.
WORKER_CACHE_TTL_SECONDS = float(os.getenv("WORKER_CACHE_TTL_SECONDS", "300"))

OPEN_RETRY_SECONDS = float(os.getenv("CAMERA_RETRY_SECONDS", "5"))
IDLE_SHUTDOWN_SECONDS = float(os.getenv("CAMERA_IDLE_SHUTDOWN_SECONDS", "120"))
MAX_CONSECUTIVE_READ_FAILURES = 30
MAX_WORKERS = int(os.getenv("MAX_CAMERA_WORKERS", "8"))

# Fallback only, used before the model has loaded (or if it fails to load) so
# /health and /detections/latest still have *some* class list to report. Once
# a model is loaded, `get_class_names()` reads its real classes instead - see
# below. The trained model (ai-service/TRAINING.md) actually has 3 classes:
# `helmet`, `vest` (PPE present) and `head` (a bare head with no helmet - this
# IS the NO_HELMET violation signal, not a fourth unrelated concept). This
# constant intentionally reflects that real model rather than the originally
# planned 4-class hardhat/construction_worker/ppe/no_ppe scheme, which this
# project never actually trained.
CLASS_NAMES = ["helmet", "vest", "head"]

# `head` (bare head, no helmet) is this model's actual hazard signal. The
# no_ppe/no_helmet/no_vest spellings are kept too in case a future retrain
# adds explicit negative classes per TRAINING.md's other documented option.
HAZARD_CLASSES = {
    "head", "no_ppe", "no-ppe", "noppe", "no_helmet", "no-helmet", "no_vest", "no-vest",
}

# BGR - OpenCV channel order, not RGB.
COLOR_SAFE = (76, 175, 80)      # green  - PPE present
COLOR_HAZARD = (54, 67, 244)    # red    - PPE missing, attributed to an enrolled worker
COLOR_PERSON = (219, 152, 52)   # blue   - a worker, neither safe nor hazardous alone
COLOR_UNIDENTIFIED = (33, 165, 245)  # amber - a bare head that isn't an enrolled worker
CLASS_COLORS = {
    "helmet": COLOR_SAFE,
    "vest": COLOR_SAFE,
    "head": COLOR_HAZARD,
    # Kept for a future retrain with the originally planned classes.
    "hardhat": COLOR_SAFE,
    "ppe": COLOR_SAFE,
    "construction_worker": COLOR_PERSON,
    "no_ppe": COLOR_HAZARD,
}

# The Prisma `ViolationType` enum only has NO_HELMET and NO_VEST, so a model
# class has to be mapped onto one of them before the API will accept it.
# `head` (bare head, no helmet) maps directly to NO_HELMET - it's a genuine
# violation detection, not a heuristic. There is no equivalent for vests: this
# dataset has no explicit "bare torso / no vest" class, so a NO_VEST alert
# cannot be produced from this model alone (would need person-detection +
# containment logic - see safety_detector.py's docstring and TRAINING.md).
# Override the no_ppe fallback with NO_PPE_VIOLATION_TYPE, or add a NO_PPE
# value to the enum and run a migration - see SETUP_INSTRUCTIONS.md.
NO_PPE_VIOLATION_TYPE = os.getenv("NO_PPE_VIOLATION_TYPE", "NO_HELMET")
VIOLATION_TYPE_MAP = {
    "head": "NO_HELMET",
    "no_ppe": NO_PPE_VIOLATION_TYPE,
    "no-ppe": NO_PPE_VIOLATION_TYPE,
    "no_helmet": "NO_HELMET",
    "no-helmet": "NO_HELMET",
    "no_hardhat": "NO_HELMET",
    "no-hardhat": "NO_HELMET",
    "no_vest": "NO_VEST",
    "no-vest": "NO_VEST",
}

BOUNDARY = "buildsite360frame"
BANNER_HEIGHT = 26  # status strip drawn across the top of every frame


# --------------------------------------------------------------------------
# Model loading
# --------------------------------------------------------------------------

_model = None
_model_error: str | None = None
_model_lock = threading.Lock()


def load_model(model_path: Path = MODEL_PATH):
    """Load YOLOv8 weights once, lazily, and cache them.

    Returns None (and records the reason) when the weights are missing or
    ultralytics is not installed - the service degrades to a plain relay
    instead of refusing to start, so camera wiring stays testable while the
    model is still training.
    """
    global _model, _model_error

    with _model_lock:
        if _model is not None or _model_error is not None:
            return _model

        if not Path(model_path).exists():
            _model_error = (
                f"weights not found at {model_path} - train the model first "
                "(python scripts/train_model.py) or set YOLO_MODEL_PATH"
            )
            log.warning("Running WITHOUT detection: %s", _model_error)
            return None

        try:
            from ultralytics import YOLO

            _model = YOLO(str(model_path))
            log.info("Loaded YOLOv8 model %s (classes: %s)", model_path, list(get_class_names().values()))
        except Exception as exc:  # pragma: no cover - depends on local install
            _model_error = f"{type(exc).__name__}: {exc}"
            log.exception("Failed to load model at %s", model_path)
            return None

        return _model


def get_class_names() -> dict[int, str]:
    """The loaded model's real class id -> name map, falling back to CLASS_NAMES.

    ultralytics==8.0.0 (pinned in requirements.txt) has no `.names` on the YOLO
    wrapper itself - only on the underlying nn.Module (`model.model.names`).
    Checking the wrapper first keeps this working if that pin is ever upgraded.
    """
    if _model is not None:
        names = getattr(_model, "names", None) or getattr(_model.model, "names", None)
        if names:
            return names
    return dict(enumerate(CLASS_NAMES))


# --------------------------------------------------------------------------
# Enrolled-worker cache + face matching
# --------------------------------------------------------------------------

# camera_id -> {"fetched_at": float, "ids": [...], "names": [...], "vectors": np.ndarray}
_worker_cache: dict[str, dict] = {}
_worker_cache_lock = threading.Lock()


def _fetch_enrolled_workers(camera_id: str) -> dict:
    """Fetch and L2-normalise enrolled-worker embeddings for camera_id's project.

    Node resolves camera -> project server-side (GET /api/internal/workers
    accepts cameraId directly) - this service never needs its own database
    access or to know which project a camera belongs to.
    """
    import numpy as np

    try:
        response = requests.get(
            f"{NODE_API_URL}/api/internal/workers",
            params={"cameraId": camera_id},
            headers={"X-Internal-Token": INTERNAL_TOKEN},
            timeout=10,
        )
        response.raise_for_status()
        workers = response.json()
    except requests.RequestException as exc:
        log.error("Failed to fetch enrolled workers for camera %s: %s", camera_id, exc)
        workers = []

    ids, names, vectors = [], [], []
    for worker in workers:
        embedding = worker.get("faceEmbedding")
        if not embedding:
            continue
        vector = np.array(embedding, dtype=np.float64)
        norm = np.linalg.norm(vector)
        if norm == 0:
            continue
        ids.append(worker["id"])
        names.append(worker.get("name", "Unknown"))
        vectors.append(vector / norm)

    return {
        "fetched_at": time.time(),
        "ids": ids,
        "names": names,
        "vectors": np.vstack(vectors) if vectors else None,
    }


def _get_enrolled_workers(camera_id: str) -> dict:
    with _worker_cache_lock:
        cached = _worker_cache.get(camera_id)
        if cached and (time.time() - cached["fetched_at"]) < WORKER_CACHE_TTL_SECONDS:
            return cached

    fresh = _fetch_enrolled_workers(camera_id)
    with _worker_cache_lock:
        _worker_cache[camera_id] = fresh
    return fresh


def match_enrolled_worker(face_crop, camera_id: str | None) -> tuple[str | None, str | None, float]:
    """Return (worker_id, worker_name, similarity) for the best enrolled match,
    or (None, None, 0.0) if no enrolled worker matches (or none are enrolled,
    or camera_id is unknown - a face can't be attributed to a project's
    workers without knowing which project it belongs to).
    """
    import numpy as np

    if not camera_id:
        return None, None, 0.0

    cache = _get_enrolled_workers(camera_id)
    if cache["vectors"] is None:
        return None, None, 0.0

    try:
        from deepface import DeepFace

        embedding = DeepFace.represent(
            img_path=face_crop,
            model_name=FACE_MATCH_MODEL,
            detector_backend=FACE_MATCH_DETECTOR_BACKEND,
            enforce_detection=True,
        )
    except ValueError:
        return None, None, 0.0  # no face in the crop
    except Exception:
        log.exception("Face matching failed on a violation crop; treating as unmatched")
        return None, None, 0.0

    probe = np.array(embedding, dtype=np.float64)
    probe /= np.linalg.norm(probe)

    similarities = cache["vectors"] @ probe
    best_index = int(np.argmax(similarities))
    best_score = float(similarities[best_index])

    if best_score < FACE_MATCH_THRESHOLD:
        return None, None, best_score

    return cache["ids"][best_index], cache["names"][best_index], best_score


# --------------------------------------------------------------------------
# Camera source resolution
# --------------------------------------------------------------------------

def resolve_source(source: str) -> tuple[Any, str]:
    """Map a configured source string onto a cv2.VideoCapture argument.

    Returns (capture_argument, detected_type). The type is informational: it is
    surfaced on /cameras and /health so a misconfigured CAMERA_SOURCE is obvious
    without reading logs.
    """
    raw = str(source).strip()

    if raw == "":
        raise ValueError("camera source is empty")

    # Device index - "0", "1", ... (OpenCV wants an int, not the string).
    if re.fullmatch(r"\d+", raw):
        return int(raw), "device_index"

    lowered = raw.lower()
    if lowered.startswith(("http://", "https://")):
        return raw, "http"
    if lowered.startswith("rtsp://"):
        return raw, "rtsp"
    if lowered.startswith(("rtmp://", "udp://", "tcp://")):
        return raw, lowered.split("://", 1)[0]
    if raw.startswith("/dev/video"):
        return raw, "v4l2"

    path = Path(raw)
    if path.exists():
        return str(path), "file"

    # Unknown but non-empty: hand it to OpenCV anyway and let the open fail
    # loudly with the real source in the message.
    return raw, "unknown"


# --------------------------------------------------------------------------
# Detection worker
# --------------------------------------------------------------------------

@dataclass
class Detection:
    label: str
    confidence: float
    box: list[int]          # [x1, y1, x2, y2] in frame pixels
    hazard: bool
    worker_id: str | None = None
    worker_name: str | None = None

    def as_dict(self) -> dict:
        return {
            "label": self.label,
            "confidence": round(self.confidence, 4),
            "box": self.box,
            "hazard": self.hazard,
            "workerId": self.worker_id,
            "workerName": self.worker_name,
        }


@dataclass
class WorkerState:
    """Everything the HTTP layer reads. Guarded by CameraWorker._lock."""
    connected: bool = False
    last_error: str | None = None
    detections: list[Detection] = field(default_factory=list)
    frame_size: tuple[int, int] = (0, 0)
    frames_read: int = 0
    inferences: int = 0
    alerts_sent: int = 0
    alerts_suppressed: int = 0
    last_frame_at: float = 0.0
    last_inference_at: float = 0.0
    class_totals: Counter = field(default_factory=Counter)
    recent_alerts: deque = field(default_factory=lambda: deque(maxlen=20))


class CameraWorker:
    """Owns one camera: a background thread that reads, infers, annotates and alerts.

    One worker per distinct source. HTTP handlers never touch OpenCV - they read
    the most recent JPEG the worker produced, so any number of viewers can watch
    a camera while it is decoded exactly once.
    """

    def __init__(self, source: str, camera_id: str | None = None):
        self.source = source
        self.camera_id = camera_id or DEFAULT_CAMERA_ID
        self.capture_arg, self.source_type = resolve_source(source)

        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._frame_event = threading.Condition()
        self._latest_jpeg: bytes | None = None
        self._latest_raw_jpeg: bytes | None = None
        self._frame_seq = 0
        self._cooldowns: dict[str, float] = {}
        self.state = WorkerState()
        self.started_at = time.time()
        self.last_viewer_at = time.time()

        # ultralytics==8.0.0's predict() only accepts a file path for `source=`
        # (an in-memory ndarray crashes - see _infer()); each worker gets its
        # own scratch file so concurrent cameras never overwrite each other's
        # in-flight frame.
        self._infer_frame_path = SERVICE_ROOT / "data" / "output" / f"_stream_frame_{id(self)}.jpg"
        self._infer_frame_path.parent.mkdir(parents=True, exist_ok=True)

        self._thread = threading.Thread(
            target=self._run, name=f"camera[{source}]", daemon=True
        )

    # -- lifecycle ---------------------------------------------------------

    def start(self) -> "CameraWorker":
        self._thread.start()
        return self

    def stop(self) -> None:
        self._stop.set()
        with self._frame_event:
            self._frame_event.notify_all()

    @property
    def alive(self) -> bool:
        return self._thread.is_alive() and not self._stop.is_set()

    # -- capture loop ------------------------------------------------------

    def _open(self):
        # CAP_FFMPEG is right for network/file sources; leave the backend to
        # OpenCV for local devices so Windows/DirectShow and V4L2 both work.
        if self.source_type in ("rtsp", "http", "file", "rtmp", "udp", "tcp"):
            capture = cv2.VideoCapture(self.capture_arg, cv2.CAP_FFMPEG)
        else:
            capture = cv2.VideoCapture(self.capture_arg)

        # Keep the decoder from queueing stale frames: on a live feed we always
        # want the newest one, never a backlog.
        try:
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
        except Exception:
            pass
        return capture

    def _run(self) -> None:
        model = load_model()
        inference_interval = 1.0 / INFERENCE_FPS if INFERENCE_FPS > 0 else 0.0
        last_inference = 0.0
        last_detections: list[Detection] = []

        while not self._stop.is_set():
            capture = None
            try:
                capture = self._open()
            except Exception as exc:
                self._set_error(f"open failed: {exc}")

            if capture is None or not capture.isOpened():
                self._set_error(f"cannot open source {self.source!r} ({self.source_type})")
                if capture is not None:
                    capture.release()
                if self._stop.wait(OPEN_RETRY_SECONDS):
                    break
                continue

            log.info("Camera open: %s (%s)", self.source, self.source_type)
            with self._lock:
                self.state.connected = True
                self.state.last_error = None

            failures = 0
            while not self._stop.is_set():
                grabbed, frame = capture.read()

                if not grabbed or frame is None:
                    # A file source that ran out is not an error - loop it, which
                    # makes recorded clips usable as a stand-in camera in demos.
                    if self.source_type == "file":
                        capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                        continue
                    failures += 1
                    if failures >= MAX_CONSECUTIVE_READ_FAILURES:
                        self._set_error("stream dropped; reconnecting")
                        break
                    time.sleep(0.1)
                    continue

                failures = 0
                frame = self._downscale(frame)

                now = time.time()
                if model is not None and (now - last_inference) >= inference_interval:
                    last_inference = now
                    try:
                        last_detections = self._infer(model, frame)
                        self._record_inference(last_detections)
                        self._maybe_alert(last_detections, frame)
                    except Exception:
                        log.exception("Inference failed on a frame; continuing")
                        last_detections = []

                self._publish(frame, last_detections)

                if STREAM_FPS > 0:
                    time.sleep(max(0.0, (1.0 / STREAM_FPS) - (time.time() - now)))

            capture.release()
            with self._lock:
                self.state.connected = False

            if not self._stop.is_set():
                time.sleep(OPEN_RETRY_SECONDS)

        log.info("Camera worker stopped: %s", self.source)

    # -- frame processing --------------------------------------------------

    @staticmethod
    def _downscale(frame):
        if FRAME_WIDTH <= 0 or frame.shape[1] <= FRAME_WIDTH:
            return frame
        scale = FRAME_WIDTH / frame.shape[1]
        return cv2.resize(frame, (FRAME_WIDTH, int(frame.shape[0] * scale)))

    def _infer(self, model, frame) -> list[Detection]:
        # See the comment on self._infer_frame_path in __init__: this version of
        # ultralytics evaluates `source or self.args.source` internally, and a
        # raw multi-element ndarray's truthiness is ambiguous (ValueError) - it
        # only accepts a real file path here, not an in-memory frame.
        cv2.imwrite(str(self._infer_frame_path), frame)
        detected = model.predict(source=str(self._infer_frame_path), conf=CONFIDENCE_THRESHOLD, verbose=False)[0]
        names = get_class_names()

        # Same version gap: predict() returns a plain [N, 6] tensor
        # (x1, y1, x2, y2, conf, cls) per image here, not a Results object
        # with .boxes/.names (those don't exist in ultralytics==8.0.0).
        detections: list[Detection] = []
        for x1, y1, x2, y2, confidence, cls_id in detected.tolist():
            label = str(names.get(int(cls_id), int(cls_id))).strip().lower()
            det = Detection(
                label=label,
                confidence=float(confidence),
                box=[int(x1), int(y1), int(x2), int(y2)],
                hazard=label in HAZARD_CLASSES,
            )
            if det.hazard:
                self._attribute_worker(det, frame)
            detections.append(det)
        return detections

    def _attribute_worker(self, det: Detection, frame) -> None:
        """Match a hazard detection's face against this camera's enrolled workers.

        A hazard only remains a reportable violation once attributed to a
        specific enrolled worker (see the module docstring, "Per-worker face
        matching"). An unmatched detection is downgraded rather than dropped -
        it still shows on the annotated feed for situational awareness, just
        without counting toward alerts or the violation banner.
        """
        x1, y1, x2, y2 = det.box
        height, width = frame.shape[:2]
        # A tight YOLO head box crops close to the skull; pad outward (more
        # below than around, to catch the jaw/chin) so the face detector
        # inside match_enrolled_worker has a normal-looking face to work with.
        pad_x = int((x2 - x1) * 0.4)
        pad_y = int((y2 - y1) * 0.6)
        crop = frame[max(0, y1 - pad_y):min(height, y2 + pad_y), max(0, x1 - pad_x):min(width, x2 + pad_x)]

        if crop.size == 0:
            det.hazard = False
            return

        worker_id, worker_name, _ = match_enrolled_worker(crop, self.camera_id)
        if worker_id:
            det.worker_id = worker_id
            det.worker_name = worker_name
        else:
            det.hazard = False

    def _annotate(self, frame, detections: list[Detection]):
        annotated = frame.copy()

        for det in detections:
            # A "head" detection that didn't match an enrolled worker is not a
            # reportable violation (det.hazard was already downgraded to False
            # for it in _attribute_worker), but it's still worth distinguishing
            # visually from a genuine no-PPE-on-an-enrolled-worker hazard.
            if det.label == "head" and not det.hazard:
                color = COLOR_UNIDENTIFIED
            else:
                color = CLASS_COLORS.get(det.label, COLOR_HAZARD if det.hazard else COLOR_SAFE)
            x1, y1, x2, y2 = det.box
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            caption = f"{det.worker_name} {det.confidence:.2f}" if det.worker_name else f"{det.label} {det.confidence:.2f}"
            (tw, th), _ = cv2.getTextSize(caption, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
            # Keep the label inside the frame, and below the status banner, when
            # the box touches the top edge - otherwise the two overprint and
            # neither is readable.
            label_top = max(BANNER_HEIGHT, y1 - th - 6)
            cv2.rectangle(annotated, (x1, label_top), (x1 + tw + 6, label_top + th + 6), color, -1)
            cv2.putText(
                annotated, caption, (x1 + 3, label_top + th + 1),
                cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA,
            )

        hazards = sum(1 for d in detections if d.hazard)
        banner = "PPE VIOLATION" if hazards else ("MONITORING" if _model is not None else "NO MODEL")
        banner_color = COLOR_HAZARD if hazards else (COLOR_SAFE if _model is not None else COLOR_PERSON)
        cv2.rectangle(annotated, (0, 0), (annotated.shape[1], BANNER_HEIGHT), (32, 32, 32), -1)
        cv2.putText(
            annotated,
            f"{banner}  |  {len(detections)} detection(s)  |  {time.strftime('%H:%M:%S')}",
            (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.55, banner_color, 1, cv2.LINE_AA,
        )
        return annotated

    def _publish(self, frame, detections: list[Detection]) -> None:
        params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
        ok, annotated = cv2.imencode(".jpg", self._annotate(frame, detections), params)
        if not ok:
            log.warning("JPEG encode failed; dropping frame")
            return
        raw_ok, raw = cv2.imencode(".jpg", frame, params)

        with self._lock:
            self.state.frames_read += 1
            self.state.last_frame_at = time.time()
            self.state.frame_size = (frame.shape[1], frame.shape[0])

        with self._frame_event:
            self._latest_jpeg = annotated.tobytes()
            self._latest_raw_jpeg = raw.tobytes() if raw_ok else None
            self._frame_seq += 1
            self._frame_event.notify_all()

    def _record_inference(self, detections: list[Detection]) -> None:
        with self._lock:
            self.state.detections = detections
            self.state.inferences += 1
            self.state.last_inference_at = time.time()
            for det in detections:
                self.state.class_totals[det.label] += 1

    def _set_error(self, message: str) -> None:
        log.warning("[%s] %s", self.source, message)
        with self._lock:
            self.state.connected = False
            self.state.last_error = message

    # -- alerting ----------------------------------------------------------

    def _maybe_alert(self, detections: list[Detection], frame) -> None:
        """POST the highest-confidence hazard per (worker, violation type), rate-limited.

        Only detections already attributed to an enrolled worker reach here -
        `_attribute_worker` downgrades anything unmatched to hazard=False, so
        an unidentified bare head never becomes an alert. The Node API applies
        its own matching cooldown; this one exists so a busy site does not
        spend the whole frame budget on HTTP round-trips the server will only
        reject.
        """
        hazards = [d for d in detections if d.hazard and d.worker_id]
        if not hazards or not self.camera_id:
            return

        by_key: dict[tuple[str, str], Detection] = {}
        for det in hazards:
            violation = VIOLATION_TYPE_MAP.get(det.label, NO_PPE_VIOLATION_TYPE)
            key = (det.worker_id, violation)
            if key not in by_key or det.confidence > by_key[key].confidence:
                by_key[key] = det

        now = time.time()
        for (worker_id, violation), det in by_key.items():
            cooldown_key = f"{worker_id}:{violation}"
            last = self._cooldowns.get(cooldown_key, 0.0)
            if now - last < ALERT_COOLDOWN_SECONDS:
                with self._lock:
                    self.state.alerts_suppressed += 1
                continue
            self._cooldowns[cooldown_key] = now
            self._post_alert(violation, det, frame)

    def _post_alert(self, violation_type: str, detection: Detection, frame) -> None:
        if not INTERNAL_TOKEN:
            log.error("X_INTERNAL_TOKEN is not set; cannot report %s", violation_type)
            return

        ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
        if not ok:
            log.error("Could not encode alert frame for %s", violation_type)
            return

        payload = {
            "cameraId": self.camera_id,
            "workerId": detection.worker_id,
            "violationType": violation_type,
            "confidence": round(detection.confidence, 4),
            "frameImageBase64": base64.b64encode(encoded.tobytes()).decode("ascii"),
        }

        try:
            response = requests.post(
                f"{NODE_API_URL}/api/internal/safety-alert",
                json=payload,
                headers={"X-Internal-Token": INTERNAL_TOKEN},
                timeout=15,
            )
        except requests.RequestException as exc:
            log.error("Alert POST failed for %s: %s", violation_type, exc)
            return

        record = {
            "violationType": violation_type,
            "label": detection.label,
            "confidence": round(detection.confidence, 4),
            "workerId": detection.worker_id,
            "workerName": detection.worker_name,
            "at": time.time(),
            "status": response.status_code,
        }

        if response.status_code == 202:
            log.info("Alert %s for %s suppressed by server cooldown", violation_type, detection.worker_name)
            with self._lock:
                self.state.alerts_suppressed += 1
            return
        if response.status_code >= 400:
            log.error(
                "Alert %s rejected (%s): %s",
                violation_type, response.status_code, response.text[:200],
            )
            return

        log.info(
            "Reported %s (%.2f) for %s on camera %s",
            violation_type, detection.confidence, detection.worker_name, self.camera_id,
        )
        with self._lock:
            self.state.alerts_sent += 1
            self.state.recent_alerts.appendleft(record)

    # -- readers used by the HTTP layer ------------------------------------

    def frames(self, annotate: bool = True):
        """Yield JPEG bytes as they are produced, newest-only (no backlog)."""
        last_seen = -1
        self.last_viewer_at = time.time()

        while not self._stop.is_set():
            with self._frame_event:
                # Wait for a frame newer than the one this viewer already got.
                if self._frame_seq == last_seen:
                    self._frame_event.wait(timeout=5.0)
                if self._frame_seq == last_seen:
                    continue  # timed out: loop so a stopped worker can exit
                last_seen = self._frame_seq
                payload = self._latest_jpeg if annotate else (self._latest_raw_jpeg or self._latest_jpeg)

            if payload:
                self.last_viewer_at = time.time()
                yield payload

    def snapshot(self) -> dict:
        with self._lock:
            state = self.state
            detections = [d.as_dict() for d in state.detections]
            counts = Counter(d["label"] for d in detections)
            return {
                "source": self.source,
                "sourceType": self.source_type,
                "cameraId": self.camera_id,
                "connected": state.connected,
                "modelLoaded": _model is not None,
                "modelError": _model_error,
                "lastError": state.last_error,
                "frameSize": {"width": state.frame_size[0], "height": state.frame_size[1]},
                "detections": detections,
                "counts": {name: counts.get(name, 0) for name in get_class_names().values()},
                "hazardCount": sum(1 for d in detections if d["hazard"]),
                "confidenceThreshold": CONFIDENCE_THRESHOLD,
                "framesRead": state.frames_read,
                "inferences": state.inferences,
                "alertsSent": state.alerts_sent,
                "alertsSuppressed": state.alerts_suppressed,
                "classTotals": dict(state.class_totals),
                "recentAlerts": list(state.recent_alerts),
                "lastFrameAt": state.last_frame_at,
                "lastInferenceAt": state.last_inference_at,
                "uptimeSeconds": round(time.time() - self.started_at, 1),
            }


# --------------------------------------------------------------------------
# Worker registry
# --------------------------------------------------------------------------

_workers: dict[str, CameraWorker] = {}
_workers_lock = threading.Lock()


def get_worker(source: str | None = None, camera_id: str | None = None) -> CameraWorker:
    """Return the worker for `source`, starting it on first use."""
    resolved = (source or CAMERA_SOURCE).strip()
    key = f"{resolved}|{camera_id or DEFAULT_CAMERA_ID or ''}"

    with _workers_lock:
        worker = _workers.get(key)
        if worker is not None and worker.alive:
            return worker

        if len(_workers) >= MAX_WORKERS:
            _reap_locked()
            if len(_workers) >= MAX_WORKERS:
                raise HTTPException(503, f"Too many active cameras (max {MAX_WORKERS})")

        try:
            worker = CameraWorker(resolved, camera_id).start()
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

        _workers[key] = worker
        return worker


def _reap_locked() -> None:
    """Drop dead workers and ones nobody has watched recently. Caller holds the lock."""
    now = time.time()
    for key, worker in list(_workers.items()):
        idle = now - worker.last_viewer_at
        if not worker.alive or idle > IDLE_SHUTDOWN_SECONDS:
            worker.stop()
            _workers.pop(key, None)
            log.info("Reaped camera worker: %s (idle %.0fs)", worker.source, idle)


def _reaper() -> None:
    while True:
        time.sleep(30)
        with _workers_lock:
            _reap_locked()


threading.Thread(target=_reaper, name="worker-reaper", daemon=True).start()


# --------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(_app: FastAPI):
    load_model()
    log.info(
        "safety_stream ready on :%s (default source=%r type=%s, conf=%.2f, model=%s)",
        STREAM_PORT, CAMERA_SOURCE, CAMERA_TYPE, CONFIDENCE_THRESHOLD,
        "loaded" if _model is not None else f"MISSING ({_model_error})",
    )

    yield

    # Stop every capture thread on shutdown, or uvicorn hangs waiting on cameras
    # that are still reconnecting.
    with _workers_lock:
        for worker in _workers.values():
            worker.stop()
        _workers.clear()


app = FastAPI(
    title="BuildSite360 Safety Stream",
    description="Annotated MJPEG stream and live PPE detections.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in os.getenv("CORS_ORIGIN", "*").split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "modelLoaded": _model is not None,
        "modelPath": str(MODEL_PATH),
        "modelError": _model_error,
        "defaultSource": CAMERA_SOURCE,
        "cameraType": CAMERA_TYPE,
        "confidenceThreshold": CONFIDENCE_THRESHOLD,
        "classes": list(get_class_names().values()),
        "activeCameras": len(_workers),
    }


@app.get("/stream")
def stream(
    source: str | None = Query(None, description="Camera source; defaults to CAMERA_SOURCE"),
    camera_id: str | None = Query(None, alias="cameraId"),
    annotate: bool = Query(True, description="Draw detection boxes on the frames"),
):
    """multipart/x-mixed-replace MJPEG - drop straight into an <img src>."""
    worker = get_worker(source, camera_id)

    def generate():
        try:
            for jpeg in worker.frames(annotate=annotate):
                yield (
                    b"--" + BOUNDARY.encode() + b"\r\n"
                    b"Content-Type: image/jpeg\r\n"
                    b"Content-Length: " + str(len(jpeg)).encode() + b"\r\n\r\n"
                    + jpeg + b"\r\n"
                )
        except GeneratorExit:  # viewer went away
            raise
        except Exception:
            log.exception("Stream generator failed for %s", worker.source)

    return StreamingResponse(
        generate(),
        media_type=f"multipart/x-mixed-replace; boundary={BOUNDARY}",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache"},
    )


@app.get("/detections/latest")
def detections_latest(
    source: str | None = Query(None),
    camera_id: str | None = Query(None, alias="cameraId"),
):
    """Current detections, per-class counts and recent alerts for one camera."""
    worker = get_worker(source, camera_id)
    return JSONResponse(worker.snapshot())


@app.get("/stats")
def stats() -> dict:
    with _workers_lock:
        workers = list(_workers.values())
    return {
        "modelLoaded": _model is not None,
        "cameras": [w.snapshot() for w in workers],
    }


@app.get("/cameras")
def cameras() -> dict:
    with _workers_lock:
        return {
            "active": [
                {
                    "source": w.source,
                    "sourceType": w.source_type,
                    "cameraId": w.camera_id,
                    "connected": w.state.connected,
                    "alive": w.alive,
                    "uptimeSeconds": round(time.time() - w.started_at, 1),
                }
                for w in _workers.values()
            ]
        }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=os.getenv("STREAM_HOST", "0.0.0.0"), port=STREAM_PORT)
