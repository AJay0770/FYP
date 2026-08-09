"""Enroll a worker by averaging ArcFace embeddings across several photos.

Usage:
    python scripts/enroll_worker.py --worker-id abc-123 --photos data/workers/abc-123/

Averaging ~10 photos taken under different lighting/angles gives a centroid that
generalises better than any single shot. Photos where no face is detected are
skipped and reported rather than failing the whole enrolment.
"""

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_NAME = "ArcFace"
DETECTOR_BACKEND = "retinaface"
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
MIN_RECOMMENDED_PHOTOS = 5


def parse_args():
    parser = argparse.ArgumentParser(description="Enroll a worker's face embedding.")
    parser.add_argument("--worker-id", required=True, help="worker id; becomes the filename")
    parser.add_argument("--photos", required=True, type=Path, help="directory of photos")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPO_ROOT / "models" / "embeddings",
    )
    return parser.parse_args()


def embed_photo(image_path):
    """Return a single ArcFace embedding, or None if no face was found."""
    from deepface import DeepFace

    try:
        results = DeepFace.represent(
            img_path=str(image_path),
            model_name=MODEL_NAME,
            detector_backend=DETECTOR_BACKEND,
            enforce_detection=True,
        )
    except ValueError:
        # DeepFace raises ValueError when no face is detected.
        return None

    if not results:
        return None
    if len(results) > 1:
        print(f"  {image_path.name}: {len(results)} faces found, skipping (ambiguous)")
        return None

    return np.array(results[0]["embedding"], dtype=np.float64)


def main():
    args = parse_args()

    if not args.photos.is_dir():
        sys.exit(f"Not a directory: {args.photos}")

    photos = sorted(p for p in args.photos.glob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    if not photos:
        sys.exit(f"No images found in {args.photos}")

    print(f"Enrolling {args.worker_id} from {len(photos)} photo(s) using {MODEL_NAME}...")

    embeddings = []
    skipped = []
    for photo in photos:
        embedding = embed_photo(photo)
        if embedding is None:
            skipped.append(photo.name)
            print(f"  {photo.name}: no usable face, skipped")
        else:
            embeddings.append(embedding)
            print(f"  {photo.name}: ok")

    if not embeddings:
        sys.exit("No usable faces found. Enrolment aborted.")

    if len(embeddings) < MIN_RECOMMENDED_PHOTOS:
        print(
            f"\nWarning: only {len(embeddings)} usable photo(s). "
            f"{MIN_RECOMMENDED_PHOTOS}+ across varied lighting is recommended for a stable centroid."
        )

    # L2-normalise each embedding before averaging so no single photo dominates,
    # then re-normalise the mean so cosine similarity is a plain dot product later.
    stacked = np.vstack([e / np.linalg.norm(e) for e in embeddings])
    centroid = stacked.mean(axis=0)
    centroid /= np.linalg.norm(centroid)

    # Spread of the enrolment photos around their own centroid. Low spread means
    # consistent photos; high spread suggests the set mixes people or conditions.
    self_similarity = stacked @ centroid

    args.output_dir.mkdir(parents=True, exist_ok=True)
    output_path = args.output_dir / f"{args.worker_id}.json"
    output_path.write_text(
        json.dumps(
            {
                "workerId": args.worker_id,
                "model": MODEL_NAME,
                "detectorBackend": DETECTOR_BACKEND,
                "embedding": centroid.tolist(),
                "dimensions": int(centroid.shape[0]),
                "photosUsed": len(embeddings),
                "photosSkipped": skipped,
                "selfSimilarityMin": float(self_similarity.min()),
                "selfSimilarityMean": float(self_similarity.mean()),
                "enrolledAt": datetime.now(timezone.utc).isoformat(),
            },
            indent=2,
        )
    )

    print(f"\nWrote {output_path}")
    print(f"  dimensions        : {centroid.shape[0]}")
    print(f"  photos used       : {len(embeddings)} ({len(skipped)} skipped)")
    print(f"  self-similarity   : min={self_similarity.min():.4f} mean={self_similarity.mean():.4f}")
    print("\nIf min self-similarity is low, check the photos are all the same person.")


if __name__ == "__main__":
    main()
