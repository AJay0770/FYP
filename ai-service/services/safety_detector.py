"""Background PPE safety detection over live RTSP camera feeds.

One worker task per camera. Each task samples frames at a low rate, runs the
fine-tuned YOLOv8 model, and reports violations back to the Node API.

REQUIRES `models/best.pt`, which does not exist yet — see TRAINING.md. Without it
the detector refuses to start rather than silently reporting nothing.

Run standalone:
    python -m services.safety_detector --camera-id <id> --rtsp rtsp://...
"""

import argparse
import base64
import logging
import os
import time
from dataclasses import dataclass

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

# The model detects PPE that IS present ("helmet", "vest"). A violation is the
# ABSENCE of that PPE on a detected person, which is not itself a class — see
# detect_violations() for how absence is inferred.
PPE_CLASSES = {"helmet": "NO_HELMET", "vest": "NO_VEST"}


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


def detect_violations(model, frame):
    """Return violations found in a single frame.

    IMPORTANT — this depends on what the trained model's classes actually are:

    * If the model was trained with only positive classes (`helmet`, `vest`), then
      a violation must be inferred: detect people, then check whether each person's
      box contains the corresponding PPE. That requires a `person` class, which the
      two-class model from TRAINING.md does NOT have.

    * If the model was trained with explicit negative classes (`no-helmet`,
      `no-vest`), violations are read straight off the detections.

    The two-class pipeline in yolov8_training.ipynb produces the FIRST case, so this
    function currently cannot infer absence on its own. Resolve this before relying
    on the detector: either retrain including `person` (and add containment logic
    here), or retrain with explicit negative classes and simplify this to a lookup.
    Until then it only reports classes it can name with certainty.
    """
    results = model.predict(source=frame, conf=CONFIDENCE_THRESHOLD, verbose=False)[0]

    violations = []
    for box in results.boxes:
        label = results.names[int(box.cls)].lower()
        confidence = float(box.conf)

        # Explicit negative classes, if the model provides them.
        if label in ("no-helmet", "no_helmet", "nohelmet"):
            violations.append(Violation("NO_HELMET", confidence))
        elif label in ("no-vest", "no_vest", "novest"):
            violations.append(Violation("NO_VEST", confidence))

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
                for violation in detect_violations(model, frame):
                    post_alert(camera_id, violation, frame)
            except Exception:
                log.exception("Inference failed on a frame; continuing.")

            time.sleep(interval)

        capture.release()
        if stop_event is None or not stop_event.is_set():
            time.sleep(RECONNECT_DELAY_SECONDS)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Watch a camera for PPE violations.")
    parser.add_argument("--camera-id", required=True)
    parser.add_argument("--rtsp", required=True)
    args = parser.parse_args()

    watch_camera(args.camera_id, args.rtsp)


if __name__ == "__main__":
    main()
