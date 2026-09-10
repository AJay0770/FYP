"""Validate a YOLO-format dataset before training.

Checks image/label 1:1 correspondence, YOLO line format (5 tokens, valid class
id, normalized coords), class distribution per split, and opens every image to
catch corrupt/unreadable files early -- a bad file 40 epochs into a run is a
much more expensive way to find this out.

Usage:
    python scripts/validate_dataset.py --root C:\\Projects\\FYP\\Dataset
"""

import argparse
import sys
from collections import Counter
from pathlib import Path

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args():
    parser = argparse.ArgumentParser(description="Validate a YOLO-format dataset.")
    parser.add_argument("--root", required=True, type=Path)
    parser.add_argument("--splits", nargs="+", default=["train", "val", "test"])
    return parser.parse_args()


def check_split(root: Path, split: str, class_counts: Counter, box_stats: dict):
    img_dir = root / "images" / split
    lbl_dir = root / "labels" / split

    images = {p.stem: p for p in img_dir.glob("*") if p.suffix.lower() in IMAGE_SUFFIXES}
    labels = {p.stem: p for p in lbl_dir.glob("*.txt")}

    missing_labels = sorted(set(images) - set(labels))
    missing_images = sorted(set(labels) - set(images))

    format_errors = []
    corrupt_images = []
    total_boxes = 0

    import cv2

    for stem, img_path in images.items():
        img = cv2.imread(str(img_path))
        if img is None:
            corrupt_images.append(img_path.name)
            continue

        lbl_path = labels.get(stem)
        if lbl_path is None:
            continue

        for lineno, line in enumerate(lbl_path.read_text().splitlines(), start=1):
            if not line.strip():
                continue
            parts = line.split()
            if len(parts) != 5:
                format_errors.append(f"{lbl_path.name}:{lineno} expected 5 tokens, got {len(parts)}")
                continue
            try:
                cls = int(parts[0])
                x, y, w, h = (float(v) for v in parts[1:])
            except ValueError:
                format_errors.append(f"{lbl_path.name}:{lineno} non-numeric field")
                continue
            if not all(0.0 <= v <= 1.0 for v in (x, y, w, h)):
                format_errors.append(f"{lbl_path.name}:{lineno} coord out of [0,1]: {parts[1:]}")
                continue

            class_counts[cls] += 1
            total_boxes += 1
            stats = box_stats.setdefault(cls, {"n": 0, "w": 0.0, "h": 0.0})
            stats["n"] += 1
            stats["w"] += w
            stats["h"] += h

    return {
        "split": split,
        "n_images": len(images),
        "n_labels": len(labels),
        "missing_labels": missing_labels,
        "missing_images": missing_images,
        "corrupt_images": corrupt_images,
        "format_errors": format_errors,
        "total_boxes": total_boxes,
    }


def main():
    args = parse_args()
    class_counts = Counter()
    box_stats = {}
    results = []

    for split in args.splits:
        print(f"Scanning {split}...", file=sys.stderr)
        results.append(check_split(args.root, split, class_counts, box_stats))

    print("\n=== Dataset Summary ===")
    print(f"{'split':8s} {'images':>8s} {'labels':>8s} {'boxes':>8s} {'missing_lbl':>12s} {'missing_img':>12s} {'corrupt':>8s} {'fmt_errs':>9s}")
    for r in results:
        print(
            f"{r['split']:8s} {r['n_images']:8d} {r['n_labels']:8d} {r['total_boxes']:8d} "
            f"{len(r['missing_labels']):12d} {len(r['missing_images']):12d} "
            f"{len(r['corrupt_images']):8d} {len(r['format_errors']):9d}"
        )

    print("\n=== Class Distribution (all splits combined) ===")
    for cls in sorted(class_counts):
        stats = box_stats[cls]
        print(
            f"class {cls}: n={class_counts[cls]:7d}  avg_w={stats['w']/stats['n']:.4f}  avg_h={stats['h']/stats['n']:.4f}"
        )

    any_problems = any(
        r["missing_labels"] or r["missing_images"] or r["corrupt_images"] or r["format_errors"]
        for r in results
    )
    if any_problems:
        print("\n=== Problems found ===")
        for r in results:
            for name, items in [
                ("missing label for image", r["missing_labels"]),
                ("missing image for label", r["missing_images"]),
                ("corrupt image", r["corrupt_images"]),
                ("format error", r["format_errors"]),
            ]:
                for item in items[:10]:
                    print(f"[{r['split']}] {name}: {item}")
                if len(items) > 10:
                    print(f"[{r['split']}] ... and {len(items) - 10} more {name} issue(s)")
        sys.exit(1)

    print("\nNo structural problems found.")


if __name__ == "__main__":
    main()
