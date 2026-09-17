"""Background PPE safety detection over live RTSP camera feeds.

One worker task per camera. Each task samples frames at a low rate, runs the
fine-tuned YOLOv8 model, and reports violations back to the Node API.

NOT the active detection pipeline — `safety_stream.py` (run via `main.py`) is
what actually serves the live-monitoring UI, and additionally attributes each
violation to an enrolled worker via DeepFace face matching, which the current
`/api/internal/safety-alert` endpoint now requires (see post_alert() below).
This module is kept as a minimal, single-responsibility reference for the
detection half of that pipeline; it will not successfully post alerts against
today's server without also implementing worker attribution.

`models/best.pt` now exists (see TRAINING.md) — it did not when this file was
first written, hence load_model()'s explicit check below.

Run standalone:
    python -m services.safety_detector --camera-id <id> --rtsp rtsp://...
"""

import argparse
import base64
import logging
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import requests
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("safety_detector")

MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "models/best.pt")
NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:3000")
INTERNAL_TOKEN = os.getenv("X_INTERNAL_TOKEN")

CONFIDENCE_THRESHOLD = 0.6
SAMPLE_FPS = 1.5
RECONNECT_DELAY_SECONDS = 5
MAX_CONSECUTIVE_FAILURES = 10

# The trained model (see TRAINING.md) has three classes: "helmet", "vest", and
# "head". "head" is an explicit negative class — a bare head with no helmet —
# so NO_HELMET can be read straight off a "head" detection, the same way
# safety_stream.py's HAZARD_CLASSES treats it. There is no equivalent negative
# class for vests: that would need a `person` class plus containment logic (a
# person box with no `vest` box inside it), which this dataset does not have.
# NO_VEST stays undetectable until a "no-vest"/bare-torso class is labeled and
# the model is retrained — a real, unresolved dataset gap, not a bug here.
PPE_CLASSES = {"head": "NO_HELMET"}


@dataclass
class Violation:
    violation_type: str
    confidence: float


def load_model(model_path=MODEL_PATH):
    if not os.path.exists(model_path):
        raise FileNotFoundError(
            f"YOLO weights not found at {model_path}. "
            "Train the model first (notebooks/yolov8_training.ipynb) and place best.pt there."
        )
    from ultralytics import YOLO

    return YOLO(model_path)


def detect_violations(model, frame, frame_path):
    """Return violations found in a single frame.

    ultralytics==8.0.0 (pinned in requirements.txt) has two version-specific
    quirks that safety_stream.py already works around — mirrored here:

    * `model.predict()` only accepts a real file path as `source`, not an
      in-memory ndarray (a raw multi-element array's truthiness is ambiguous
      internally and raises ValueError) — hence writing `frame` to
      `frame_path` before inference.
    * `predict()` returns a plain [N, 6] tensor (x1, y1, x2, y2, conf, cls) per
      image here, not a Results object with `.boxes`/`.names` — those don't
      exist in this pinned version.

    See PPE_CLASSES above for which detected classes count as violations, and
    why NO_VEST can't be one of them yet.
    """
    cv2.imwrite(str(frame_path), frame)
    detected = model.predict(source=str(frame_path), conf=CONFIDENCE_THRESHOLD, verbose=False)[0]
    names = getattr(model, "names", None) or getattr(model.model, "names", None) or {}

    violations = []
    for x1, y1, x2, y2, confidence, cls_id in detected.tolist():
        label = str(names.get(int(cls_id), int(cls_id))).strip().lower()
        if label in PPE_CLASSES:
            violations.append(Violation(PPE_CLASSES[label], float(confidence)))

    return violations


def post_alert(camera_id, violation, frame):
    if not INTERNAL_TOKEN:
        log.error("X_INTERNAL_TOKEN not set; cannot report alert.")
        return False

    ok, encoded = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
    if not ok:
        log.error("Failed to JPEG-encode frame.")
        return False

    payload = {
        "cameraId": camera_id,
        "violationType": violation.violation_type,
        "confidence": round(violation.confidence, 4),
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
        log.error("Alert POST failed: %s", exc)
        return False

    if response.status_code == 202:
        log.info("Alert suppressed by server cooldown.")
        return True
    if response.status_code >= 400:
        log.error("Alert rejected (%s): %s", response.status_code, response.text[:200])
        return False

    log.info("Reported %s (%.3f)", violation.violation_type, violation.confidence)
    return True


def watch_camera(camera_id, rtsp_url, stop_event=None):
    """Sample frames from one camera until stopped. Reconnects on stream loss."""
    model = load_model()
    interval = 1.0 / SAMPLE_FPS

    # One inference-scratch file per camera, matching safety_stream.py's fix
    # for the same source= constraint (see detect_violations above).
    frame_path = Path(tempfile.gettempdir()) / f"safety_detector_{camera_id}.jpg"

    try:
        while stop_event is None or not stop_event.is_set():
            capture = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

            if not capture.isOpened():
                log.warning("Cannot open %s; retrying in %ss", rtsp_url, RECONNECT_DELAY_SECONDS)
                capture.release()
                time.sleep(RECONNECT_DELAY_SECONDS)
                continue

            log.info("Watching camera %s", camera_id)
            failures = 0

            while stop_event is None or not stop_event.is_set():
                grabbed, frame = capture.read()

                if not grabbed:
                    failures += 1
                    if failures >= MAX_CONSECUTIVE_FAILURES:
                        log.warning("Lost stream for %s; reconnecting.", camera_id)
                        break
                    time.sleep(0.5)
                    continue

                failures = 0

                try:
                    for violation in detect_violations(model, frame, frame_path):
                        post_alert(camera_id, violation, frame)
                except Exception:
                    log.exception("Inference failed on a frame; continuing.")

                time.sleep(interval)

            capture.release()
            if stop_event is None or not stop_event.is_set():
                time.sleep(RECONNECT_DELAY_SECONDS)
    finally:
        frame_path.unlink(missing_ok=True)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Watch a camera for PPE violations.")
    parser.add_argument("--camera-id", required=True)
    parser.add_argument("--rtsp", required=True)
    args = parser.parse_args()

    watch_camera(args.camera_id, args.rtsp)


if __name__ == "__main__":
    main()
