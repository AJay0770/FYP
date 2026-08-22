#!/usr/bin/env python3
"""
Organize raw datasets into YOLOv8 format
Converts various formats (COCO JSON, images only) into YOLOv8 standard

YOLOv8 format:
dataset/
├── images/
│   ├── train/
│   ├── val/
│   └── test/
└── labels/
    ├── train/
    ├── val/
    └── test/

Each image has corresponding .txt label file with format:
<class_id> <x_center> <y_center> <width> <height>
(normalized to 0-1)
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
import json
import shutil
import random
from pathlib import Path
from collections import defaultdict
import sys

class YOLOv8Organizer:
    def __init__(self, raw_path="ai-service/data/datasets/raw",
                 output_path="ai-service/data/datasets/organized"):
        self.raw_path = Path(raw_path)
        self.output_path = Path(output_path)

        # Class mapping for construction PPE
        self.class_names = [
            'hardhat',
            'construction_worker',
            'ppe',
            'no_ppe'
        ]

        # Setup output directories
        for split in ["train", "val", "test"]:
            (self.output_path / "images" / split).mkdir(parents=True, exist_ok=True)
            (self.output_path / "labels" / split).mkdir(parents=True, exist_ok=True)

        print(f"✓ Output directory: {self.output_path}")

    def map_class_name(self, label_str):
        """Map various label formats to standardized class IDs"""
        label_lower = str(label_str).lower().strip()

        # Hardhat / Helmet detection
        if any(x in label_lower for x in ['hardhat', 'hard_hat', 'helmet', 'hat']):
            return 0

        # Person / Worker detection
        if any(x in label_lower for x in ['person', 'worker', 'construction_worker']):
            return 1

        # PPE / Vest detection
        if any(x in label_lower for x in ['ppe', 'vest', 'safety_vest', 'safety vest']):
            return 2

        # No PPE detection
        if any(x in label_lower for x in ['no_ppe', 'no ppe', 'no_protection']):
            return 3

        # Default to person
        return 1

    def process_coco_dataset(self, coco_json_path, images_dir):
        """Convert COCO format JSON to YOLOv8"""
        print(f"\n📋 Processing COCO dataset: {coco_json_path.name}")

        try:
            with open(coco_json_path) as f:
                coco_data = json.load(f)
        except json.JSONDecodeError:
            print(f"  ❌ Invalid JSON file: {coco_json_path}")
            return 0

        # Build image and annotation maps
        images_map = {img['id']: img for img in coco_data.get('images', [])}
        categories = {cat['id']: cat['name'] for cat in coco_data.get('categories', [])}

        if not images_map:
            print(f"  ⚠️  No images in COCO file")
            return 0

        # Randomly split images
        image_ids = list(images_map.keys())
        random.shuffle(image_ids)

        n_total = len(image_ids)
        n_train = int(0.7 * n_total)
        n_val = int(0.15 * n_total)

        train_ids = set(image_ids[:n_train])
        val_ids = set(image_ids[n_train:n_train + n_val])
        test_ids = set(image_ids[n_train + n_val:])

        # Process annotations
        images_processed = set()

        for ann in coco_data.get('annotations', []):
            img_id = ann['image_id']
            if img_id not in images_map:
                continue

            img_info = images_map[img_id]

            # Determine split
            if img_id in train_ids:
                split = "train"
            elif img_id in val_ids:
                split = "val"
            else:
                split = "test"

            # Copy image
            src_img = images_dir / img_info['file_name']

            if not src_img.exists():
                continue

            dst_img = self.output_path / "images" / split / img_info['file_name']
            shutil.copy2(src_img, dst_img)

            # Save YOLO annotation
            bbox = ann.get('bbox')
            if bbox:
                # COCO bbox is [x, y, width, height]
                x, y, w, h = bbox
                img_w, img_h = img_info['width'], img_info['height']

                # Normalize to center format
                center_x = (x + w / 2) / img_w
                center_y = (y + h / 2) / img_h
                norm_w = w / img_w
                norm_h = h / img_h

                # Get class ID
                category_id = ann.get('category_id', 0)
                category_name = categories.get(category_id, 'person')
                class_id = self.map_class_name(category_name)

                # Save label
                label_filename = img_info['file_name'].rsplit('.', 1)[0] + '.txt'
                label_path = self.output_path / "labels" / split / label_filename

                with open(label_path, 'a') as f:
                    f.write(f"{class_id} {center_x:.6f} {center_y:.6f} {norm_w:.6f} {norm_h:.6f}\n")

                images_processed.add(img_id)

        print(f"  ✓ Processed {len(images_processed)} images")
        return len(images_processed)

    def process_image_folder(self, folder_path, split_ratio=(0.7, 0.15, 0.15)):
        """Process folder with images only (no annotations)"""
        print(f"\n📁 Processing image folder: {folder_path.name}")

        folder_path = Path(folder_path)

        # Find all images
        images = []
        for ext in ['*.jpg', '*.jpeg', '*.JPG', '*.JPEG', '*.png', '*.PNG']:
            images.extend(folder_path.glob(ext))
            images.extend(folder_path.glob(f"**/{ext}"))

        images = list(set(images))  # Remove duplicates

        if not images:
            print(f"  ⚠️  No images found in {folder_path}")
            return 0

        random.shuffle(images)

        n_total = len(images)
        n_train = int(split_ratio[0] * n_total)
        n_val = int(split_ratio[1] * n_total)

        splits = {
            "train": images[:n_train],
            "val": images[n_train:n_train + n_val],
            "test": images[n_train + n_val:]
        }

        total_copied = 0

        for split, split_images in splits.items():
            for img_path in split_images:
                try:
                    dst = self.output_path / "images" / split / img_path.name
                    shutil.copy2(img_path, dst)

                    # Create empty label file (no annotations)
                    label_file = dst.with_suffix('.txt')
                    label_file.touch()

                    total_copied += 1
                except Exception as e:
                    print(f"  ⚠️  Error copying {img_path.name}: {e}")

            print(f"  ✓ {split}: {len(split_images)} images")

        print(f"  ✓ Total copied: {total_copied} images")
        return total_copied

    def process_yolov8_format(self, folder_path):
        """Process folders already in YOLOv8 format"""
        print(f"\n📦 Processing YOLOv8 format: {folder_path.name}")

        folder_path = Path(folder_path)
        images_dir = folder_path / "images"
        labels_dir = folder_path / "labels"

        if not images_dir.exists():
            print(f"  ⚠️  No 'images' subdirectory found")
            return 0

        # Find splits
        total_copied = 0

        for split in ["train", "val", "test", "train", "valid", "val"]:
            split_img_dir = images_dir / split if (images_dir / split).exists() else images_dir

            if not split_img_dir.exists():
                continue

            images = list(split_img_dir.glob("*.jpg")) + list(split_img_dir.glob("*.png"))
            if not images:
                continue

            # Determine destination split
            dest_split = "train" if split in ["train"] else "val" if split in ["val", "valid"] else "test"

            for img_path in images:
                try:
                    dst_img = self.output_path / "images" / dest_split / img_path.name
                    shutil.copy2(img_path, dst_img)

                    # Copy label if exists
                    if labels_dir.exists():
                        src_label = (labels_dir / split / img_path.stem).with_suffix('.txt') if \
                                   (labels_dir / split).exists() else \
                                   (labels_dir / img_path.stem).with_suffix('.txt')

                        if src_label.exists():
                            dst_label = self.output_path / "labels" / dest_split / src_label.name
                            shutil.copy2(src_label, dst_label)
                        else:
                            # Create empty label
                            dst_label = self.output_path / "labels" / dest_split / img_path.stem
                            dst_label.with_suffix('.txt').touch()

                    total_copied += 1

                except Exception as e:
                    print(f"  ⚠️  Error: {e}")

            print(f"  ✓ {dest_split}: {len(images)} images")

        return total_copied

    def organize_all(self):
        """Organize all downloaded datasets"""

        if not self.raw_path.exists():
            print(f"❌ Raw dataset path not found: {self.raw_path}")
            print("\n📥 Download datasets first:")
            print("   python3 download_kaggle_datasets.py")
            print("   or")
            print("   python3 download_roboflow_datasets.py")
            return

        print("\n" + "="*60)
        print("🔄 Organizing Datasets for YOLOv8")
        print("="*60)
        print(f"Input:  {self.raw_path}")
        print(f"Output: {self.output_path}")

        total_processed = 0

        # Process each category
        for category_dir in sorted(self.raw_path.iterdir()):
            if not category_dir.is_dir():
                continue

            print(f"\n{'='*60}")
            print(f"📂 {category_dir.name.upper()}")
            print(f"{'='*60}")

            # Look for different dataset formats
            coco_files = list(category_dir.glob("**/annotations.json")) + \
                        list(category_dir.glob("**/instances_*.json"))

            if coco_files:
                # COCO format
                for coco_file in coco_files:
                    images_dir = coco_file.parent
                    processed = self.process_coco_dataset(coco_file, images_dir)
                    total_processed += processed

            # Check for YOLOv8 format subdirectories
            elif (category_dir / "images").exists():
                processed = self.process_yolov8_format(category_dir)
                total_processed += processed

            else:
                # Image-only folder
                processed = self.process_image_folder(category_dir)
                total_processed += processed

        # Create dataset.yaml
        self.create_dataset_config()

        # Summary
        print("\n" + "="*60)
        print("✅ Organization Complete!")
        print("="*60)
        print(f"📸 Total images processed: {total_processed:,}")
        print(f"\n📁 Output structure:")
        print(f"   {self.output_path}/")
        print(f"   ├── images/")
        print(f"   │   ├── train/")
        print(f"   │   ├── val/")
        print(f"   │   └── test/")
        print(f"   └── labels/")
        print(f"       ├── train/")
        print(f"       ├── val/")
        print(f"       └── test/")

        print(f"\n🔄 Next step: Run 'python3 verify_dataset.py'")
        print("="*60 + "\n")

    def create_dataset_config(self):
        """Create dataset.yaml for YOLOv8"""
        dataset_config = {
            'path': str(self.output_path.absolute()),
            'train': 'images/train',
            'val': 'images/val',
            'test': 'images/test',
            'nc': len(self.class_names),
            'names': self.class_names
        }

        config_path = self.output_path / "dataset.yaml"

        # Write YAML format
        with open(config_path, 'w') as f:
            f.write(f"# YOLOv8 Dataset Configuration\n")
            f.write(f"path: {dataset_config['path']}\n")
            f.write(f"train: {dataset_config['train']}\n")
            f.write(f"val: {dataset_config['val']}\n")
            f.write(f"test: {dataset_config['test']}\n")
            f.write(f"\n")
            f.write(f"nc: {dataset_config['nc']}\n")
            f.write(f"names: {dataset_config['names']}\n")

        print(f"✓ Created: {config_path}")

if __name__ == "__main__":
    organizer = YOLOv8Organizer()
    organizer.organize_all()
