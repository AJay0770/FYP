"""Draw a handful of ground-truth boxes per class so a human can confirm what
each raw class id actually depicts, before trusting classes.txt's stated
order. See TRAINING.md: a silent id/name mismatch trains a model that
"detects the wrong things" without any error along the way.

Usage:
    python scripts/inspect_classes.py --root C:\\Projects\\FYP\\Dataset --out data/output/class_check
"""

import argparse
from collections import defaultdict
from pathlib import Path

import cv2

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--split", default="train")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--per-class", type=int, default=3)
    return parser.parse_args()


def main():
    args = parse_args()
    img_dir = args.root / "images" / args.split
    lbl_dir = args.root / "labels" / args.split
    args.out.mkdir(parents=True, exist_ok=True)

    picked = defaultdict(int)
    images = sorted(p for p in img_dir.glob("*") if p.suffix.lower() in IMAGE_SUFFIXES)

    for img_path in images:
        lbl_path = lbl_dir / f"{img_path.stem}.txt"
        if not lbl_path.exists():
            continue

        lines = [l.split() for l in lbl_path.read_text().splitlines() if l.strip()]
        classes_here = {int(l[0]) for l in lines}

        # Only save this image for a class if that class still needs examples,
        # so we don't just get N images of the single most common class.
        wanted = {c for c in classes_here if picked[c] < args.per_class}
        if not wanted:
            continue

        img = cv2.imread(str(img_path))
        if img is None:
            continue
        height, width = img.shape[:2]

        for cls_str, xc, yc, w, h in lines:
            cls = int(cls_str)
            xc, yc, w, h = (float(v) for v in (xc, yc, w, h))
            x1 = int((xc - w / 2) * width)
            y1 = int((yc - h / 2) * height)
            x2 = int((xc + w / 2) * width)
            y2 = int((yc + h / 2) * height)
            color = [(0, 0, 255), (0, 255, 0), (255, 0, 0), (0, 255, 255)][cls % 4]
            cv2.rectangle(img, (x1, y1), (x2, y2), color, 2)
            cv2.putText(img, str(cls), (x1, max(0, y1 - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.7, color, 2)

        for cls in wanted:
            picked[cls] += 1
            out_path = args.out / f"class{cls}_{img_path.stem}.jpg"
            cv2.imwrite(str(out_path), img)
            print(f"wrote {out_path} (classes in image: {sorted(classes_here)})")

        if all(picked[c] >= args.per_class for c in picked) and len(picked) >= 4:
            break

    print("\nCounts saved per class:", dict(picked))


if __name__ == "__main__":
    main()
