"""Background facial-recognition attendance over an ENTRANCE camera feed.

Samples frames, embeds any detected face, matches against enrolled workers by
cosine similarity, and reports check-ins to the Node API.

REQUIRES deepface (Python 3.10/3.11 only — see TRAINING.md) and at least one
enrolled worker.

Run standalone:
    python -m services.attendance_detector --project-id <id> --rtsp rtsp://...
"""

import argparse
import logging
import os
import tempfile
import time

import cv2
import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv()

log = logging.getLogger("attendance_detector")

NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:3000")
INTERNAL_TOKEN = os.getenv("X_INTERNAL_TOKEN")
MODEL_NAME = "ArcFace"
# "opencv", not "retinaface": retinaface crashes outright in this project's
# actual installed combo (deepface==0.0.71 + retina-face==0.0.18 + TF 2.15) -
# see ai-service/endpoints/enrollment.py for the full explanation.
DETECTOR_BACKEND = "opencv"

# Cosine SIMILARITY threshold (higher = more alike), matching scripts/match_face.py.
# NOTE: DeepFace's published 0.68 for ArcFace is a cosine DISTANCE, equivalent to
# 0.32 similarity — so this default is about twice as strict. Validate against real
# enrolment data before deployment; see TRAINING.md > "The 0.68 problem".
MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.68"))

SAMPLE_INTERVAL_SECONDS = 2.0
RECONNECT_DELAY_SECONDS = 5
# Don't re-report the same worker repeatedly while they stand at the gate. The
# server also rejects same-day duplicates; this just avoids the pointless traffic.
LOCAL_RESEND_COOLDOWN_SECONDS = 300


def load_enrolled_workers(project_id, api_token):
    """Fetch enrolled workers and their stored embeddings from the API."""
    response = requests.get(
        f"{NODE_API_URL}/api/internal/workers",
        params={"projectId": project_id},
        headers={"X-Internal-Token": INTERNAL_TOKEN},
        timeout=20,
    )
    response.raise_for_status()

    worker_ids, vectors = [], []
    for worker in response.json():
        embedding = worker.get("faceEmbedding")
        if not embedding:
            continue
        vector = np.array(embedding, dtype=np.float64)
        norm = np.linalg.norm(vector)
        if norm == 0:
            continue
        worker_ids.append(worker["id"])
        vectors.append(vector / norm)

    if not vectors:
        return [], None

    return worker_ids, np.vstack(vectors)


def embed_frame(frame):
    """Return a normalised embedding for the largest face in the frame."""
    from deepface import DeepFace

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
        temp_path = handle.name
    cv2.imwrite(temp_path, frame)

    try:
        # deepface==0.0.71's represent() returns the embedding vector itself
        # (a flat list of floats) for the one face it detects/crops - there is
        # no facial_area/multi-face list to pick the largest from in this
        # version, unlike later deepface releases.
        embedding = DeepFace.represent(
            img_path=temp_path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
    except ValueError:
        return None
    finally:
        os.unlink(temp_path)

    vector = np.array(embedding, dtype=np.float64)
    return vector / np.linalg.norm(vector)


def post_checkin(worker_id, confidence):
    try:
        response = requests.post(
            f"{NODE_API_URL}/api/internal/attendance-record",
            json={"workerId": worker_id, "confidence": round(float(confidence), 4)},
            headers={"X-Internal-Token": INTERNAL_TOKEN},
            timeout=15,
        )
    except requests.RequestException as exc:
        log.error("Check-in POST failed: %s", exc)
        return False

    if response.status_code >= 400:
        log.error("Check-in rejected (%s): %s", response.status_code, response.text[:200])
        return False

    body = response.json()
    if body.get("duplicate"):
        log.info("Worker %s already checked in today.", worker_id)
    else:
        log.info("Checked in %s (%.4f)", worker_id, confidence)
    return True


def watch_entrance(project_id, rtsp_url, api_token=None, stop_event=None):
    worker_ids, enrolled = load_enrolled_workers(project_id, api_token)
    if enrolled is None:
        log.error("No enrolled workers with embeddings for project %s. Nothing to match.", project_id)
        return

    log.info("Loaded %d enrolled worker(s). Threshold %.2f (cosine similarity).",
             len(worker_ids), MATCH_THRESHOLD)

    recently_sent = {}

    while stop_event is None or not stop_event.is_set():
        capture = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)

        if not capture.isOpened():
            log.warning("Cannot open %s; retrying in %ss", rtsp_url, RECONNECT_DELAY_SECONDS)
            capture.release()
            time.sleep(RECONNECT_DELAY_SECONDS)
            continue

        while stop_event is None or not stop_event.is_set():
            grabbed, frame = capture.read()
            if not grabbed:
                break

            try:
                probe = embed_frame(frame)
            except Exception:
                log.exception("Embedding failed on a frame; continuing.")
                probe = None

            if probe is not None:
                similarities = enrolled @ probe
                best_index = int(np.argmax(similarities))
                best_score = float(similarities[best_index])

                if best_score >= MATCH_THRESHOLD:
                    worker_id = worker_ids[best_index]
                    last_sent = recently_sent.get(worker_id, 0)
                    if time.time() - last_sent > LOCAL_RESEND_COOLDOWN_SECONDS:
                        if post_checkin(worker_id, best_score):
                            recently_sent[worker_id] = time.time()
                else:
                    log.debug("Face seen but best similarity %.4f below threshold.", best_score)

            time.sleep(SAMPLE_INTERVAL_SECONDS)

        capture.release()
        if stop_event is None or not stop_event.is_set():
            time.sleep(RECONNECT_DELAY_SECONDS)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = argparse.ArgumentParser(description="Watch an entrance camera for worker check-ins.")
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--rtsp", required=True)
    args = parser.parse_args()

    watch_entrance(args.project_id, args.rtsp)


if __name__ == "__main__":
    main()
