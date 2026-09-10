"""Run the fine-tuned PPE model over sample images and save annotated results.

Usage:
    python scripts/test_yolov8.py
    python scripts/test_yolov8.py --model models/best.pt --source data/test_images --conf 0.35
"""

import argparse
import sys
from pathlib import Path

import cv2

REPO_ROOT = Path(__file__).resolve().parent.parent
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args():
    parser = argparse.ArgumentParser(description="Run PPE detection on test images.")
    parser.add_argument("--model", default=REPO_ROOT / "models" / "best.pt", type=Path)
    parser.add_argument("--source", default=REPO_ROOT / "data" / "test_images", type=Path)
    parser.add_argument("--output", default=REPO_ROOT / "data" / "output", type=Path)
    parser.add_argument("--conf", type=float, default=0.35, help="confidence threshold")
    return parser.parse_args()


def main():
    args = parse_args()

    if not args.model.exists():
        sys.exit(
            f"Model not found: {args.model}\n"
            "Train it first with notebooks/yolov8_training.ipynb, then place best.pt there."
        )

    images = sorted(p for p in args.source.glob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    if not images:
        sys.exit(f"No images found in {args.source}")

    from ultralytics import YOLO

    model = YOLO(str(args.model))
    # This pinned ultralytics==8.0.0 predates the Results/Boxes object model
    # (no `result.boxes`, `result.names`, `result.save()`) -- predict() here
    # returns a plain list of [N, 6] tensors (x1, y1, x2, y2, conf, cls) in
    # absolute pixel coords, one per image, and class names live on the
    # underlying nn.Module (model.model.names), not on the YOLO wrapper.
    names = model.model.names
    args.output.mkdir(parents=True, exist_ok=True)

    total_detections = 0

    for image_path in images:
        detections = model.predict(source=str(image_path), conf=args.conf, verbose=False)[0]

        print(f"\n{image_path.name}")
        if len(detections) == 0:
            print("  no detections")

        image = cv2.imread(str(image_path))
        for x1, y1, x2, y2, confidence, cls_id in detections.tolist():
            label = names[int(cls_id)]
            x1, y1, x2, y2 = round(x1), round(y1), round(x2), round(y2)
            print(f"  {label:8s} conf={confidence:.3f}  box=({x1}, {y1}, {x2}, {y2})")
            total_detections += 1

            cv2.rectangle(image, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(image, f"{label} {confidence:.2f}", (x1, max(0, y1 - 5)),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

        cv2.imwrite(str(args.output / image_path.name), image)

    print(f"\n{len(images)} image(s), {total_detections} detection(s).")
    print(f"Annotated images written to {args.output}")


if __name__ == "__main__":
    main()
