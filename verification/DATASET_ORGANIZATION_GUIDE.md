# Dataset Organization & YOLOv8 Training Guide

## Overview

This guide covers downloading, organizing, and preparing construction PPE datasets for YOLOv8 model training. According to the BuildSite360_Final_Report, you need:

- **Hard Hat Workers**: ~7,000 images
- **PPE Detection**: ~3,000 images  
- **Safety Helmet Detection**: ~5,000 images
- **Total**: ~15,000 images for training

**Sources**: Roboflow (free tier + API key), Kaggle (free account), and other public datasets

---

## Step 1: Create Directory Structure

```bash
# From project root:
mkdir -p ai-service/data/datasets/raw
mkdir -p ai-service/data/datasets/organized
mkdir -p ai-service/models

# This creates:
ai-service/
├── data/
│   └── datasets/
│       ├── raw/                 # Downloaded datasets
│       │   ├── hardhat_workers/
│       │   ├── ppe_detection/
│       │   └── safety_helmet/
│       └── organized/           # YOLOv8 format (images + labels)
│           ├── images/
│           │   ├── train/
│           │   ├── val/
│           │   └── test/
│           └── labels/          # YOLO .txt annotations
│               ├── train/
│               ├── val/
│               └── test/
└── models/
    ├── best.pt              # Trained model (after training)
    └── dataset.yaml         # YOLOv8 dataset config
```

---

## Step 2: Download Datasets

### Option A: Roboflow (Recommended - Pre-formatted)

**Advantage**: Often comes in YOLOv8 format already, easier preprocessing

#### 2A.1 Get Free Roboflow API Key

```
1. Go to https://roboflow.com (free account)
2. Sign up / Login
3. Go to Settings → API Keys
4. Copy your API key
```

#### 2A.2 Download Script

Create `ai-service/download_roboflow_datasets.py`:

```python
#!/usr/bin/env python3
"""
Downloads construction PPE datasets from Roboflow
Requires: pip install roboflow
"""

import os
import sys
from roboflow import Roboflow

# Configuration
API_KEY = input("Enter your Roboflow API key: ").strip()
DATASETS = {
    # Format: "workspace/project": "output_folder"
    "hardhat-workers/1": "ai-service/data/datasets/raw/hardhat_workers",
    # Note: Replace with actual Roboflow workspace/project names
    # You can find public projects at: https://roboflow.com/search
}

# Alternative public datasets to search for:
# - "construction-site-safety" 
# - "hard-hat-detection"
# - "ppe-detection"
# - "safety-helmet"

def download_from_roboflow():
    """Download datasets from Roboflow with proper formatting"""
    
    rf = Roboflow(api_key=API_KEY)
    
    for project_path, output_dir in DATASETS.items():
        try:
            workspace, project = project_path.split("/")
            print(f"\n📥 Downloading {project} from {workspace}...")
            
            # Authenticate and download
            project_obj = rf.workspace(workspace).project(project)
            dataset = project_obj.version(1).download("yolov8")
            
            print(f"✓ Downloaded to {dataset.location}")
            
        except Exception as e:
            print(f"✗ Error downloading {project}: {e}")
            print(f"  Make sure '{project}' exists in your Roboflow workspace")

if __name__ == "__main__":
    print("=" * 60)
    print("Roboflow Dataset Downloader for YOLOv8")
    print("=" * 60)
    download_from_roboflow()
```

### Option B: Kaggle Datasets (Free Alternative)

**Advantage**: Larger selection, no account requirements for download

#### 2B.1 Get Kaggle API Credentials

```bash
# Go to https://www.kaggle.com/settings/account
# Click "Create New API Token"
# Place downloaded kaggle.json in ~/.kaggle/

mkdir -p ~/.kaggle
# Copy kaggle.json here
chmod 600 ~/.kaggle/kaggle.json
```

#### 2B.2 Download Script

Create `ai-service/download_kaggle_datasets.py`:

```python
#!/usr/bin/env python3
"""
Downloads construction PPE datasets from Kaggle
Requires: pip install kaggle
"""

import os
import subprocess
from pathlib import Path

# Public Kaggle datasets for construction PPE
KAGGLE_DATASETS = {
    "hardhat-workers": [
        "jacksonccc/hard-hat-workers",
        "thawornwhat/hard-hat-detection-dataset"
    ],
    "ppe-detection": [
        "andrewmvd/ppe-detection",
        "datagenist/ppe-detection-yolov5"
    ],
    "safety-helmet": [
        "shreyasgopal/construction-site-safety-image-detection-v2",
        "huanghao123/safety-helmet-dataset"
    ]
}

def setup_kaggle():
    """Verify Kaggle API is configured"""
    kaggle_config = Path.home() / ".kaggle" / "kaggle.json"
    
    if not kaggle_config.exists():
        print("⚠️  Kaggle API not configured!")
        print("1. Go to https://www.kaggle.com/settings/account")
        print("2. Click 'Create New API Token'")
        print(f"3. Save kaggle.json to {kaggle_config}")
        print("4. Run: chmod 600 ~/.kaggle/kaggle.json")
        return False
    return True

def download_datasets():
    """Download all datasets"""
    
    if not setup_kaggle():
        return
    
    base_path = Path("ai-service/data/datasets/raw")
    base_path.mkdir(parents=True, exist_ok=True)
    
    for category, datasets in KAGGLE_DATASETS.items():
        category_path = base_path / category
        category_path.mkdir(exist_ok=True)
        
        for dataset in datasets:
            try:
                print(f"\n📥 Downloading {dataset}...")
                output_path = category_path / dataset.split("/")[-1]
                
                cmd = [
                    "kaggle", "datasets", "download",
                    "-d", dataset,
                    "-p", str(output_path),
                    "--unzip"
                ]
                
                subprocess.run(cmd, check=True)
                print(f"✓ Downloaded to {output_path}")
                
            except subprocess.CalledProcessError as e:
                print(f"✗ Failed to download {dataset}: {e}")
            except FileNotFoundError:
                print("✗ Kaggle CLI not installed. Run: pip install kaggle")

if __name__ == "__main__":
    print("=" * 60)
    print("Kaggle Dataset Downloader for Construction PPE")
    print("=" * 60)
    download_datasets()
```

### Option C: Manual Download (Fallback)

```bash
# Create a text file with popular Kaggle dataset links:
cat > ai-service/DATASET_LINKS.txt << 'EOF'
# Construction PPE Datasets (Manual Download)

## Hard Hat / Construction Worker Detection
- https://www.kaggle.com/datasets/jacksonccc/hard-hat-workers
- https://www.kaggle.com/datasets/thawornwhat/hard-hat-detection-dataset

## PPE Detection (General)
- https://www.kaggle.com/datasets/andrewmvd/ppe-detection
- https://www.kaggle.com/datasets/datagenist/ppe-detection-yolov5

## Safety Helmet Specific
- https://www.kaggle.com/datasets/shreyasgopal/construction-site-safety-image-detection-v2
- https://www.kaggle.com/datasets/huanghao123/safety-helmet-dataset

## Download Instructions:
1. Visit Kaggle link
2. Click "Download" button
3. Extract zip to ai-service/data/datasets/raw/[category]/
4. Run organize_datasets.py to convert to YOLOv8 format

## Note: Kaggle requires free account (takes 2 minutes to create)
EOF
```

---

## Step 3: Organize Datasets to YOLOv8 Format

Create `ai-service/organize_datasets.py`:

```python
#!/usr/bin/env python3
"""
Reorganize raw datasets into YOLOv8 format with train/val/test split
Handles: COCO JSON, Pascal VOC XML, or image-only folders
"""

import os
import shutil
import json
from pathlib import Path
from collections import defaultdict
import random

class YOLOv8Organizer:
    def __init__(self, raw_path="ai-service/data/datasets/raw", 
                 output_path="ai-service/data/datasets/organized"):
        self.raw_path = Path(raw_path)
        self.output_path = Path(output_path)
        self.classes = {
            "hardhat": 0,
            "helmet": 0,
            "hard hat": 0,
            "safety helmet": 0,
            "construction worker": 1,
            "worker": 1,
            "person": 1,
            "ppe": 2,
            "safety vest": 2,
            "reflective vest": 2,
            "vest": 2,
            "no ppe": 3,
            "no protection": 3,
        }
        
        # Setup output directories
        for split in ["train", "val", "test"]:
            (self.output_path / "images" / split).mkdir(parents=True, exist_ok=True)
            (self.output_path / "labels" / split).mkdir(parents=True, exist_ok=True)
    
    def process_coco_dataset(self, coco_json_path, images_dir):
        """Convert COCO format to YOLOv8"""
        print(f"Processing COCO dataset: {coco_json_path}")
        
        with open(coco_json_path) as f:
            coco_data = json.load(f)
        
        # Build image and annotation maps
        images_map = {img['id']: img for img in coco_data['images']}
        
        # Randomly split
        image_ids = list(images_map.keys())
        random.shuffle(image_ids)
        
        n_train = int(0.7 * len(image_ids))
        n_val = int(0.15 * len(image_ids))
        
        train_ids = set(image_ids[:n_train])
        val_ids = set(image_ids[n_train:n_train+n_val])
        test_ids = set(image_ids[n_train+n_val:])
        
        # Process annotations
        for ann in coco_data['annotations']:
            img_id = ann['image_id']
            img_info = images_map[img_id]
            
            # Determine split
            if img_id in train_ids:
                split = "train"
            elif img_id in val_ids:
                split = "val"
            else:
                split = "test"
            
            # Copy image
            src_img = Path(images_dir) / img_info['file_name']
            dst_img = self.output_path / "images" / split / img_info['file_name']
            
            if src_img.exists():
                shutil.copy2(src_img, dst_img)
            
            # Convert bbox to YOLO format and save
            self._save_yolo_annotation(
                ann, img_info, split, 
                img_info['file_name'].rsplit('.', 1)[0] + '.txt'
            )
        
        print(f"✓ Processed {len(images_map)} images")
    
    def process_image_folder(self, folder_path, split_ratio=(0.7, 0.15, 0.15)):
        """Process folder with images (no labels) - copy to train/val/test"""
        print(f"Processing image folder: {folder_path}")
        
        folder_path = Path(folder_path)
        images = list(folder_path.glob("*.jpg")) + list(folder_path.glob("*.png"))
        
        random.shuffle(images)
        
        n_train = int(split_ratio[0] * len(images))
        n_val = int(split_ratio[1] * len(images))
        
        splits = {
            "train": images[:n_train],
            "val": images[n_train:n_train+n_val],
            "test": images[n_train+n_val:]
        }
        
        for split, split_images in splits.items():
            for img_path in split_images:
                dst = self.output_path / "images" / split / img_path.name
                shutil.copy2(img_path, dst)
            
            print(f"  {split}: {len(split_images)} images")
        
        print(f"✓ Organized {len(images)} images")
    
    def _save_yolo_annotation(self, annotation, image_info, split, filename):
        """Save annotation in YOLO format"""
        bbox = annotation.get('bbox')
        if not bbox:
            return
        
        x, y, w, h = bbox
        img_w, img_h = image_info['width'], image_info['height']
        
        # Convert to YOLO format (normalized center x, center y, width, height)
        center_x = (x + w/2) / img_w
        center_y = (y + h/2) / img_h
        norm_w = w / img_w
        norm_h = h / img_h
        
        class_id = 0  # Default
        for class_name, c_id in self.classes.items():
            if class_name.lower() in str(annotation).lower():
                class_id = c_id
                break
        
        label_path = self.output_path / "labels" / split / filename
        with open(label_path, 'a') as f:
            f.write(f"{class_id} {center_x:.6f} {center_y:.6f} {norm_w:.6f} {norm_h:.6f}\n")
    
    def organize_all(self):
        """Main function - organize all downloaded datasets"""
        
        if not self.raw_path.exists():
            print(f"✗ Raw dataset path not found: {self.raw_path}")
            return
        
        print(f"\nOrganizing datasets from {self.raw_path}")
        print(f"Output to {self.output_path}\n")
        
        # Process each category
        for category_dir in self.raw_path.iterdir():
            if not category_dir.is_dir():
                continue
            
            print(f"\n--- Processing {category_dir.name} ---")
            
            # Look for COCO format (annotations.json or instances_*.json)
            coco_files = list(category_dir.glob("**/annotations.json")) + \
                         list(category_dir.glob("**/instances_*.json"))
            
            if coco_files:
                for coco_file in coco_files:
                    images_dir = coco_file.parent
                    self.process_coco_dataset(coco_file, images_dir)
            else:
                # Assume image-only folder
                self.process_image_folder(category_dir)
        
        print("\n✓ Dataset organization complete!")
        print(f"Images: {self.output_path}/images/{{train,val,test}}/")
        print(f"Labels: {self.output_path}/labels/{{train,val,test}}/")

if __name__ == "__main__":
    organizer = YOLOv8Organizer()
    organizer.organize_all()
```

**Run the organizer:**

```bash
cd ai-service
python3 organize_datasets.py
```

---

## Step 4: Create YOLOv8 Dataset Configuration

Create `ai-service/models/dataset.yaml`:

```yaml
# YOLOv8 Dataset Configuration
path: ../data/datasets/organized  # Dataset root path
train: images/train               # Training images folder
val: images/val                   # Validation images folder
test: images/test                 # Testing images folder

# Classes
nc: 4  # Number of classes
names: ['hardhat', 'construction_worker', 'ppe', 'no_ppe']

# Class indices
hardhat: 0
construction_worker: 1
ppe: 2
no_ppe: 3

# Metadata
description: "Construction Site PPE Detection Dataset"
author: "BuildSite360"
date: 2026
version: 1.0
```

---

## Step 5: Verify Dataset Integrity

Create `ai-service/verify_dataset.py`:

```python
#!/usr/bin/env python3
"""Verify dataset is properly organized for YOLOv8 training"""

import os
from pathlib import Path
from collections import Counter

def verify_dataset(dataset_path="ai-service/data/datasets/organized"):
    dataset_path = Path(dataset_path)
    
    print("=" * 60)
    print("Dataset Verification Report")
    print("=" * 60)
    
    stats = {}
    
    for split in ["train", "val", "test"]:
        images_dir = dataset_path / "images" / split
        labels_dir = dataset_path / "labels" / split
        
        if not images_dir.exists():
            print(f"⚠️  Missing {split} images directory")
            continue
        
        images = list(images_dir.glob("*.jpg")) + list(images_dir.glob("*.png"))
        labels = list(labels_dir.glob("*.txt")) if labels_dir.exists() else []
        
        stats[split] = {
            'images': len(images),
            'labels': len(labels),
            'ratio': len(labels) / len(images) if images else 0
        }
        
        print(f"\n{split.upper()}:")
        print(f"  Images: {len(images)}")
        print(f"  Labels: {len(labels)}")
        print(f"  Match: {len(images) == len(labels)} ✓" if len(images) == len(labels) else f"  Match: ✗ (mismatch!)")
        
        if labels:
            class_counter = Counter()
            for label_file in labels:
                with open(label_file) as f:
                    for line in f:
                        class_id = int(line.split()[0])
                        class_counter[class_id] += 1
            
            print(f"  Class distribution:")
            for class_id, count in sorted(class_counter.items()):
                class_names = ["hardhat", "construction_worker", "ppe", "no_ppe"]
                class_name = class_names[class_id] if class_id < len(class_names) else "unknown"
                print(f"    - {class_name} (id={class_id}): {count} boxes")
    
    print("\n" + "=" * 60)
    print("Summary:")
    total_images = sum(s['images'] for s in stats.values())
    total_labels = sum(s['labels'] for s in stats.values())
    print(f"Total images: {total_images}")
    print(f"Total labels: {total_labels}")
    print(f"Status: {'✓ READY FOR TRAINING' if total_images > 1000 else '✗ NEEDS MORE IMAGES'}")
    print("=" * 60)

if __name__ == "__main__":
    verify_dataset()
```

**Run verification:**

```bash
python3 ai-service/verify_dataset.py
```

---

## Step 6: Install YOLOv8 Training Dependencies

```bash
# From ai-service directory:
pip install ultralytics==8.0.240 torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118

# Verify installation:
python3 << 'EOF'
from ultralytics import YOLO
print("✓ YOLOv8 installed successfully")
EOF
```

---

## Step 7: Train YOLOv8 Model (Google Colab - Free T4 GPU)

This is the recommended approach as it provides free GPU access.

### Create Colab Notebook

Save `ai-service/YOLOv8_Training_Colab.ipynb`:

```
# Cell 1: Setup and Imports
!pip install -q ultralytics==8.0.240
from ultralytics import YOLO
import yaml

# Cell 2: Mount Google Drive (to save model)
from google.colab import drive
drive.mount('/content/drive')

# Cell 3: Upload Dataset
# Click upload button and select your organized dataset folder
# Or: Unzip from Google Drive

# Cell 4: Create dataset.yaml
dataset_config = """
path: /content/dataset
train: images/train
val: images/val
test: images/test
nc: 4
names: ['hardhat', 'construction_worker', 'ppe', 'no_ppe']
"""

with open('/content/dataset.yaml', 'w') as f:
    f.write(dataset_config)

# Cell 5: Train YOLOv8s Model
model = YOLO('yolov8s.pt')

results = model.train(
    data='/content/dataset.yaml',
    epochs=50,
    imgsz=640,
    batch=16,
    patience=20,
    save=True,
    device=0,  # GPU
    project='/content/drive/My Drive/BuildSite360',
    name='ppe_detection_model',
    pretrained=True
)

# Cell 6: Test Model
metrics = model.val()
print(f"mAP50: {metrics.box.map50}")
print(f"mAP50-95: {metrics.box.map}")

# Cell 7: Export Model
model.export(format='pt')  # PyTorch format
model.export(format='onnx')  # ONNX format
print("Model exported!")
```

### Quick Colab Steps:

```
1. Open https://colab.research.google.com
2. Create new notebook
3. Copy cells from YOLOv8_Training_Colab.ipynb
4. Upload dataset.zip from your computer
5. Run cells sequentially
6. Download best.pt from training results
```

### Training Time Estimate:
- **Dataset**: 15,000 images
- **Model**: YOLOv8s (fast)
- **Batch Size**: 16
- **Epochs**: 50
- **Hardware**: Google Colab T4 GPU
- **Estimated Time**: 1-2 hours

---

## Step 8: Download Trained Model

After training in Colab:

```bash
# The trained model will be saved as:
# /content/drive/My Drive/BuildSite360/ppe_detection_model/weights/best.pt

# Download and place in:
# ai-service/models/best.pt

# Verify model:
python3 << 'EOF'
from ultralytics import YOLO
model = YOLO('ai-service/models/best.pt')
print(f"✓ Model loaded: {model.names}")
EOF
```

---

## Alternative: Train Locally (If GPU Available)

```bash
python3 << 'EOF'
from ultralytics import YOLO

# Load model
model = YOLO('yolov8s.pt')

# Train
results = model.train(
    data='ai-service/models/dataset.yaml',
    epochs=50,
    imgsz=640,
    batch=8,  # Reduce if GPU memory < 8GB
    patience=20,
    device=0,  # GPU 0 (or 'cpu' if no GPU)
    project='ai-service/models',
    name='ppe_detection_v1'
)

# Save best model
model.save('ai-service/models/best.pt')
print("✓ Training complete!")
EOF
```

---

## Troubleshooting Dataset Issues

| Problem | Solution |
|---------|----------|
| **"No datasets found"** | Check directory structure. Run `ls -la ai-service/data/datasets/organized/images/train/` |
| **"Class mismatch"** | Verify dataset.yaml has correct number of classes. Check label files don't reference class IDs beyond nc-1 |
| **"Out of memory"** | Reduce batch size from 16 to 8 or 4. Use smaller model (yolov8n) instead of yolov8s |
| **"Labels don't match images"** | Run verify_dataset.py. Re-organize using organize_datasets.py |
| **"CUDA out of memory"** | Use Google Colab instead. Or train on CPU (slower but works) |
| **"Downloaded zip corrupted"** | Re-download from Kaggle/Roboflow. Check file size > 0 |

---

## Verification Checklist

After completing all steps:

```bash
# ✓ Directory structure created
ls -la ai-service/data/datasets/organized/

# ✓ Images organized
ls -la ai-service/data/datasets/organized/images/train/ | head
ls -la ai-service/data/datasets/organized/images/val/ | head

# ✓ Labels created
ls -la ai-service/data/datasets/organized/labels/train/ | head

# ✓ Dataset config exists
cat ai-service/models/dataset.yaml

# ✓ Dataset verification passed
python3 ai-service/verify_dataset.py

# ✓ Trained model exists
ls -lh ai-service/models/best.pt

# ✓ Model loads without error
python3 << 'EOF'
from ultralytics import YOLO
model = YOLO('ai-service/models/best.pt')
print(f"Classes: {model.names}")
print(f"Parameters: {sum(p.numel() for p in model.model.parameters()) / 1e6:.1f}M")
EOF
```

---

## Integration with Backend

Once model is trained, update `ai-service/routes/detection.py`:

```python
from ultralytics import YOLO
import cv2

# Load trained model
model = YOLO('models/best.pt')

class SafetyDetector:
    def __init__(self):
        self.model = model
        self.confidence_threshold = 0.5
    
    def detect(self, frame):
        """Run YOLOv8 detection on frame"""
        results = self.model(frame, conf=self.confidence_threshold)
        
        detections = []
        for result in results:
            for box in result.boxes:
                detections.append({
                    'class_id': int(box.cls[0]),
                    'class_name': result.names[int(box.cls[0])],
                    'confidence': float(box.conf[0]),
                    'bbox': box.xyxy[0].tolist()
                })
        
        return detections
```

---

## Next Steps

1. ✓ Download datasets (using download_roboflow_datasets.py or download_kaggle_datasets.py)
2. ✓ Organize to YOLOv8 format (using organize_datasets.py)
3. ✓ Verify dataset integrity (using verify_dataset.py)
4. ✓ Train on Google Colab (1-2 hours)
5. ✓ Download best.pt model
6. → Integrate with backend safety detection routes
7. → Test with real camera feed
8. → Integrate into frontend Live Monitoring page
