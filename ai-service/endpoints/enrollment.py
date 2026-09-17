"""Face enrolment endpoint. Mounted by main.py.

Accepts a batch of photos (base64 or data URLs) and returns a single averaged
ArcFace embedding, using the same centroid method as scripts/enroll_worker.py so
enrolments are consistent whichever path created them.

REQUIRES deepface, which cannot be installed on Python 3.13/3.14 (its TensorFlow
dependency has no wheels there). Import is deferred so the rest of the API still
starts; this endpoint returns 503 instead of crashing the service.
"""

import base64
import binascii
import os
import tempfile

import numpy as np
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

router = APIRouter()

MODEL_NAME = "ArcFace"
# NOTE: "retinaface" is the more accurate detector and was the original
# choice here, but it fails outright in this project's actual installed
# combination (deepface==0.0.71 + retina-face==0.0.18 + TensorFlow 2.15).
#
# Root cause, confirmed by direct reproduction against real enrolment photos
# (2026-09-13): RetinaFaceWrapper.detect_face()'s align=True branch calls
# postprocess.alignment_procedure(), which returns a value functions.py's
# detect_face() doesn't recognise as either a face array or None - the
# function then falls off the end and implicitly returns bare `None`, which
# preprocess_face() unpacks as a 2-tuple, raising
# `TypeError: cannot unpack non-iterable NoneType object`. This happened on
# 6/6 real face photos tested (not an edge case - every photo where
# RetinaFace actually finds a face and proceeds to align it triggers this).
#
# Passing align=False avoids the crash 100% of the time (6/6 photos
# succeeded), so it IS a viable code-level workaround. It was not adopted:
# re-running this endpoint's exact enrol-then-match flow (5-photo centroid,
# then a real check-in photo) with retinaface+align=False produced a genuine
# same-person cosine similarity of only ~0.22, far below the 0.68 match
# threshold - i.e. the crash-avoiding workaround appears to trade a hard
# crash for silent false rejections, likely because ArcFace was trained
# expecting aligned input and this photo had head tilt. "opencv" (Haar
# cascade, no crash, alignment via its own eye cascade) remains the verified
# option end-to-end, despite being less accurate at odd angles/low light.
# Revisit only with a broader real test set (multiple identities/conditions)
# to confirm whether that 0.22 result was representative or an outlier -
# one genuine-match sample isn't enough to trust either way.
DETECTOR_BACKEND = "opencv"
MAX_PHOTOS = 25


class EnrollRequest(BaseModel):
    photos: list[str]  # base64-encoded images, with or without a data: prefix


def _require_internal_token(provided):
    expected = os.getenv("X_INTERNAL_TOKEN")
    if not expected:
        raise HTTPException(status_code=500, detail="X_INTERNAL_TOKEN not configured")
    if not provided or provided != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-Internal-Token")


def _decode_photo(encoded):
    if "," in encoded and encoded.strip().startswith("data:"):
        encoded = encoded.split(",", 1)[1]
    try:
        return base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        return None


def _embed(image_bytes):
    """Return a normalised embedding for one image, or None if no single face."""
    from deepface import DeepFace

    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as handle:
        handle.write(image_bytes)
        temp_path = handle.name

    try:
        # deepface==0.0.71's represent() returns the embedding vector itself
        # (a flat list of floats) for the one face it detects/crops - not the
        # list-of-dicts-with-facial_area format later deepface versions use.
        # There is no way to enumerate multiple faces from this call in this
        # version; enforce_detection=True raises ValueError if none is found.
        embedding = DeepFace.represent(
            img_path=temp_path,
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
    except ValueError:
        return None  # no face detected
    finally:
        os.unlink(temp_path)

    vector = np.array(embedding, dtype=np.float64)
    return vector / np.linalg.norm(vector)


@router.post("/enroll")
async def enroll(request: EnrollRequest, x_internal_token: str = Header(default=None)):
    _require_internal_token(x_internal_token)

    if not request.photos:
        raise HTTPException(status_code=400, detail="photos must not be empty")
    if len(request.photos) > MAX_PHOTOS:
        raise HTTPException(status_code=400, detail=f"at most {MAX_PHOTOS} photos")

    try:
        import deepface  # noqa: F401
    except ImportError as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "deepface is not installed in this environment "
                f"({exc}). It requires TensorFlow, which needs Python 3.10/3.11."
            ),
        )

    embeddings = []
    skipped = 0

    for encoded in request.photos:
        image_bytes = _decode_photo(encoded)
        if image_bytes is None:
            skipped += 1
            continue
        vector = _embed(image_bytes)
        if vector is None:
            skipped += 1
            continue
        embeddings.append(vector)

    if not embeddings:
        raise HTTPException(status_code=422, detail="No usable face found in any photo")

    centroid = np.vstack(embeddings).mean(axis=0)
    centroid /= np.linalg.norm(centroid)

    return {
        "embedding": centroid.tolist(),
        "dimensions": int(centroid.shape[0]),
        "photosUsed": len(embeddings),
        "photosSkipped": skipped,
        "model": MODEL_NAME,
    }
