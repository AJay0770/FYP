#!/usr/bin/env python3
"""
Verify dataset integrity and readiness for YOLOv8 training
Checks:
- Image/label matching
- Valid YOLO label format
- Class distribution
- Image quality
"""

# --- added for Windows compatibility (BuildSite360) ---------------------------
# This script prints emoji. A Windows console defaults to cp1252, which cannot
# encode them, so the first print() raises UnicodeEncodeError and the script dies
# before doing any work. Reconfiguring stdout keeps the original output intact.
import sys as _sys

if hasattr(_sys.stdout, "reconfigure"):
    _sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# -----------------------------------------------------------------------------

import os
from pathlib import Path
from collections import defaultdict
import cv2

def verify_dataset(dataset_path="ai-service/data/datasets/organized"):
    dataset_path = Path(dataset_path)

    print("\n" + "="*60)
    print("🔍 Dataset Verification Report")
    print("="*60)

    if not dataset_path.exists():
        print(f"\n❌ Dataset path not found: {dataset_path}")
        print("\nRun: python3 organize_datasets.py")
        return False

    stats = {}
    all_good = True

    for split in ["train", "val", "test"]:
        images_dir = dataset_path / "images" / split
        labels_dir = dataset_path / "labels" / split

        if not images_dir.exists():
            print(f"\n⚠️  Missing {split} images directory")
            continue

        images = list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png")) + \
                list(images_dir.glob("*.jpeg")) + list(images_dir.glob("*.JPEG"))
        labels = list(labels_dir.glob("*.txt")) if labels_dir.exists() else []

        if not images:
            print(f"\n⚠️  No images in {split} directory")
            continue

        stats[split] = {
            'images': len(images),
            'labels': len(labels),
            'match': len(images) == len(labels),
            'class_distribution': defaultdict(int),
            'issues': []
        }

        print(f"\n{'='*60}")
        print(f"📊 {split.upper()}")
        print(f"{'='*60}")
        print(f"Images: {len(images)}")
        print(f"Labels: {len(labels)}")

        # Check matching
        if len(images) != len(labels):
            print(f"⚠️  MISMATCH: {len(images)} images vs {len(labels)} labels")
            all_good = False
        else:
            print(f"✓ Images and labels match")

        # Validate labels
        invalid_labels = 0
        for label_file in labels:
            try:
                with open(label_file) as f:
                    lines = f.readlines()

                for line_num, line in enumerate(lines):
                    if not line.strip():
                        continue

                    try:
                        parts = line.strip().split()
                        if len(parts) != 5:
                            stats[split]['issues'].append(
                                f"{label_file.name} line {line_num+1}: expected 5 values, got {len(parts)}"
                            )
                            invalid_labels += 1
                            continue

                        class_id = int(parts[0])
                        x_c, y_c, w, h = map(float, parts[1:])

                        # Check ranges
                        if not (0 <= x_c <= 1 and 0 <= y_c <= 1 and 0 < w <= 1 and 0 < h <= 1):
                            stats[split]['issues'].append(
                                f"{label_file.name}: invalid bbox values (should be 0-1): {parts[1:]}"
                            )
                            invalid_labels += 1
                            continue

                        if not (0 <= class_id <= 3):  # 4 classes: 0-3
                            stats[split]['issues'].append(
                                f"{label_file.name}: invalid class ID {class_id} (should be 0-3)"
                            )
                            invalid_labels += 1
                            continue

                        # Track class distribution
                        stats[split]['class_distribution'][class_id] += 1

                    except ValueError:
                        stats[split]['issues'].append(
                            f"{label_file.name} line {line_num+1}: invalid format"
                        )
                        invalid_labels += 1

            except Exception as e:
                stats[split]['issues'].append(f"Error reading {label_file.name}: {e}")

        if invalid_labels == 0:
            print(f"✓ All {len(labels)} labels are valid")
        else:
            print(f"❌ {invalid_labels} invalid labels found")
            all_good = False

        # Check images
        corrupted_images = 0
        for img_path in images:
            try:
                img = cv2.imread(str(img_path))
                if img is None:
                    stats[split]['issues'].append(f"Corrupted: {img_path.name}")
                    corrupted_images += 1
            except Exception as e:
                stats[split]['issues'].append(f"Cannot read {img_path.name}: {e}")
                corrupted_images += 1

        if corrupted_images == 0:
            print(f"✓ All {len(images)} images are readable")
        else:
            print(f"⚠️  {corrupted_images} corrupted images")
            all_good = False

        # Class distribution
        if stats[split]['class_distribution']:
            print(f"\n📈 Class Distribution:")
            class_names = {0: 'hardhat', 1: 'construction_worker', 2: 'ppe', 3: 'no_ppe'}
            for class_id in sorted(stats[split]['class_distribution'].keys()):
                count = stats[split]['class_distribution'][class_id]
                class_name = class_names.get(class_id, f'unknown_{class_id}')
                percentage = (count / sum(stats[split]['class_distribution'].values())) * 100
                bar = "█" * int(percentage / 5)
                print(f"  {class_name:20} {count:6} boxes ({percentage:5.1f}%) {bar}")

        # Show issues
        if stats[split]['issues']:
            print(f"\n⚠️  Found {len(stats[split]['issues'])} issues:")
            for issue in stats[split]['issues'][:10]:  # Show first 10
                print(f"  - {issue}")
            if len(stats[split]['issues']) > 10:
                print(f"  ... and {len(stats[split]['issues']) - 10} more")

    # Overall summary
    print(f"\n{'='*60}")
    print("📊 OVERALL SUMMARY")
    print(f"{'='*60}")

    total_images = sum(s['images'] for s in stats.values())
    total_labels = sum(s['labels'] for s in stats.values())
    total_matched = sum(1 for s in stats.values() if s['match'])

    print(f"Total images: {total_images:,}")
    print(f"Total labels: {total_labels:,}")
    print(f"Matched sets: {total_matched}/{len(stats)}")

    # Readiness assessment
    print(f"\n{'='*60}")
    print("✅ READINESS CHECK")
    print(f"{'='*60}")

    checks = [
        ("Images exist", total_images > 0, "❌" if total_images == 0 else "✓"),
        ("Labels exist", total_labels > 0, "❌" if total_labels == 0 else "✓"),
        ("Images/labels match", total_images == total_labels, "❌" if total_images != total_labels else "✓"),
        ("Sufficient data", total_images >= 1000, "⚠️ " if 1000 <= total_images < 5000 else ("❌" if total_images < 1000 else "✓")),
        ("Valid labels", all_good, "❌" if not all_good else "✓"),
    ]

    for check_name, passed, icon in checks:
        status = "PASS" if passed else "FAIL"
        print(f"{icon} {check_name}: {status}")

    # Final verdict
    print(f"\n{'='*60}")
    if total_images >= 1000 and total_labels > 0 and total_images == total_labels and all_good:
        print("✅ DATASET READY FOR TRAINING")
        print(f"{'='*60}")
        print(f"\nRecommended training command:")
        print(f"  python3 train_yolov8.py")
        print(f"\nOr on Google Colab:")
        print(f"  See YOLOv8_TRAINING_GUIDE.md")
    elif total_images >= 100:
        print("⚠️  DATASET NEEDS REVIEW")
        print(f"{'='*60}")
        print(f"\nIssues found:")
        for issue in stats.get('train', {}).get('issues', [])[:5]:
            print(f"  - {issue}")
        print(f"\nRecommendations:")
        print(f"  1. Remove corrupted images")
        print(f"  2. Re-organize dataset: python3 organize_datasets.py")
        print(f"  3. Re-verify: python3 verify_dataset.py")
    else:
        print("❌ INSUFFICIENT DATA FOR TRAINING")
        print(f"{'='*60}")
        print(f"\nActions needed:")
        print(f"  - Download more datasets (need at least 1,000 images)")
        print(f"  - Run: python3 download_kaggle_datasets.py")
        print(f"  - Then: python3 organize_datasets.py")

    print("="*60 + "\n")

    return all_good and total_images >= 1000

if __name__ == "__main__":
    verify_dataset()
