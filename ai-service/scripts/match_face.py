"""Match a photo against enrolled worker embeddings using cosine similarity.

Usage:
    python scripts/match_face.py --photo data/checkin/frame.jpg
    python scripts/match_face.py --photo frame.jpg --threshold 0.40 --json

Threshold semantics (read this before tuning):
    This script scores with cosine SIMILARITY in [-1, 1], where higher = more alike,
    and treats `similarity >= threshold` as a match.

    DeepFace's own published ArcFace threshold of 0.68 is a cosine DISTANCE, where
    distance = 1 - similarity and LOWER means more alike. Its 0.68 distance is
    therefore equivalent to a similarity of 0.32 here, not 0.68.

    Defaulting to 0.68 similarity is roughly twice as strict as DeepFace's default.
    That biases hard toward false rejects (a worker gets turned away and retries)
    over false accepts (one worker checks in as another), which is the safer
    failure mode for attendance records. But it must be validated against real
    enrolment data before deployment — see TRAINING.md.
"""

import argparse
import json
import sys
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = "ArcFace"
# "opencv", not "retinaface": retinaface crashes outright in this project's
# actual installed combo (deepface==0.0.71 + retina-face==0.0.18 + TF 2.15) -
# see endpoints/enrollment.py for the full explanation.
DETECTOR_BACKEND = "opencv"
DEFAULT_THRESHOLD = 0.68


def parse_args():
    parser = argparse.ArgumentParser(description="Match a face against enrolled workers.")
    parser.add_argument("--photo", required=True, type=Path)
    parser.add_argument(
        "--embeddings-dir",
        type=Path,
        default=REPO_ROOT / "models" / "embeddings",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=DEFAULT_THRESHOLD,
        help=f"minimum cosine similarity to count as a match (default {DEFAULT_THRESHOLD})",
    )
    parser.add_argument("--top", type=int, default=3, help="how many candidates to show")
    parser.add_argument("--json", action="store_true", help="emit JSON only")
    return parser.parse_args()


def load_enrolled(embeddings_dir):
    """Return (worker_ids, matrix of L2-normalised embeddings)."""
    files = sorted(embeddings_dir.glob("*.json"))
    if not files:
        sys.exit(f"No enrolled embeddings in {embeddings_dir}. Run enroll_worker.py first.")

    worker_ids, vectors = [], []
    for path in files:
        record = json.loads(path.read_text())
        if record.get("model") != MODEL_NAME:
            print(
                f"Skipping {path.name}: enrolled with {record.get('model')}, expected {MODEL_NAME}",
                file=sys.stderr,
            )
            continue
        vector = np.array(record["embedding"], dtype=np.float64)
        vectors.append(vector / np.linalg.norm(vector))
        worker_ids.append(record["workerId"])

    if not vectors:
        sys.exit(f"No embeddings in {embeddings_dir} match model {MODEL_NAME}.")

    return worker_ids, np.vstack(vectors)


def embed_photo(image_path):
    from deepface import DeepFace

    try:
        # deepface==0.0.71's represent() returns the embedding vector itself
        # (a flat list of floats) for the one face it detects/crops - there is
        # no facial_area/multi-face list to pick the largest from in this
        # version, unlike later deepface releases.
        embedding = DeepFace.represent(
            img_path=str(image_path),
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
    except ValueError:
        return None

    vector = np.array(embedding, dtype=np.float64)
    return vector / np.linalg.norm(vector)


def main():
    args = parse_args()

    if not args.photo.exists():
        sys.exit(f"Photo not found: {args.photo}")

    worker_ids, enrolled = load_enrolled(args.embeddings_dir)
    probe = embed_photo(args.photo)

    if probe is None:
        payload = {"match": False, "reason": "no_face_detected", "workerId": None, "confidence": None}
        print(json.dumps(payload, indent=2) if args.json else "No face detected in photo.")
        sys.exit(0)

    # Both sides are L2-normalised, so the dot product is the cosine similarity.
    similarities = enrolled @ probe
    order = np.argsort(-similarities)[: args.top]

    best_index = int(order[0])
    best_score = float(similarities[best_index])
    matched = best_score >= args.threshold

    payload = {
        "match": matched,
        "workerId": worker_ids[best_index] if matched else None,
        "confidence": best_score,
        "threshold": args.threshold,
        "candidates": [
            {"workerId": worker_ids[int(i)], "similarity": float(similarities[int(i)])}
            for i in order
        ],
    }

    if args.json:
        print(json.dumps(payload, indent=2))
        return

    print(f"Compared against {len(worker_ids)} enrolled worker(s), threshold {args.threshold}\n")
    for rank, i in enumerate(order, start=1):
        marker = "<-- best" if rank == 1 else ""
        print(f"  {rank}. {worker_ids[int(i)]:36s} {similarities[int(i)]:.4f} {marker}")

    if matched:
        print(f"\nMATCH: {worker_ids[best_index]} (similarity {best_score:.4f})")
    else:
        print(f"\nNO MATCH: best similarity {best_score:.4f} is below threshold {args.threshold}")

    # A near-tie between the top two means the decision is fragile.
    if len(order) > 1:
        margin = best_score - float(similarities[int(order[1])])
        if margin < 0.05:
            print(f"Warning: top-2 margin is only {margin:.4f}. Treat this match as unreliable.")


if __name__ == "__main__":
    main()
