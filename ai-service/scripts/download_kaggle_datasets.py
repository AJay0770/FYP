#!/usr/bin/env python3
"""
Downloads construction PPE datasets from Kaggle
Requires: pip install kaggle

Creates directory structure:
ai-service/data/datasets/raw/
├── hardhat_workers/
├── ppe_detection/
└── safety_helmet/
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
import subprocess
import sys
from pathlib import Path

# Public Kaggle datasets for construction PPE
KAGGLE_DATASETS = {
    "hardhat_workers": [
        "jacksonccc/hard-hat-workers",
        "thawornwhat/hard-hat-detection-dataset"
    ],
    "ppe_detection": [
        "andrewmvd/ppe-detection",
        "datagenist/ppe-detection-yolov5"
    ],
    "safety_helmet": [
        "shreyasgopal/construction-site-safety-image-detection-v2",
        "huanghao123/safety-helmet-dataset"
    ]
}

def setup_kaggle():
    """Verify Kaggle API is configured"""
    kaggle_config = Path.home() / ".kaggle" / "kaggle.json"

    if not kaggle_config.exists():
        print("\n" + "="*60)
        print("❌ Kaggle API not configured!")
        print("="*60)
        print("\nSetup steps:")
        print("1. Go to: https://www.kaggle.com/settings/account")
        print("2. Click 'Create New API Token'")
        print(f"3. Save kaggle.json to: {kaggle_config}")
        print(f"4. Run: chmod 600 {kaggle_config}")
        print("\nThen run this script again.\n")
        return False

    # Verify permissions
    if not os.access(kaggle_config, os.R_OK):
        os.chmod(kaggle_config, 0o600)
        print(f"✓ Fixed permissions for {kaggle_config}")

    return True

def install_kaggle_cli():
    """Check if kaggle CLI is installed"""
    try:
        subprocess.run(["kaggle", "--version"], capture_output=True, check=True)
        print("✓ Kaggle CLI installed")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("\n⚠️  Kaggle CLI not found. Installing...")
        try:
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "kaggle"],
                          check=True)
            print("✓ Kaggle CLI installed")
            return True
        except subprocess.CalledProcessError:
            print("❌ Failed to install Kaggle CLI")
            return False

def download_datasets():
    """Download all datasets"""

    if not install_kaggle_cli():
        return

    if not setup_kaggle():
        return

    base_path = Path("ai-service/data/datasets/raw")
    base_path.mkdir(parents=True, exist_ok=True)

    total_downloaded = 0
    total_failed = 0

    print("\n" + "="*60)
    print("📥 Downloading Construction PPE Datasets from Kaggle")
    print("="*60)

    for category, datasets in KAGGLE_DATASETS.items():
        category_path = base_path / category
        category_path.mkdir(exist_ok=True)

        print(f"\n📂 Category: {category}")
        print("-" * 60)

        for dataset in datasets:
            try:
                print(f"\n  📥 {dataset}...")
                output_path = category_path / dataset.split("/")[-1]

                # Skip if already downloaded
                if output_path.exists() and list(output_path.glob("*.jpg")) + list(output_path.glob("*.png")):
                    print(f"     ✓ Already downloaded, skipping")
                    total_downloaded += 1
                    continue

                # Download
                cmd = [
                    "kaggle", "datasets", "download",
                    "-d", dataset,
                    "-p", str(output_path),
                    "--unzip"
                ]

                result = subprocess.run(cmd, capture_output=True, text=True)

                if result.returncode == 0:
                    # Count images
                    images = list(output_path.glob("*.jpg")) + list(output_path.glob("*.png"))
                    images += list(output_path.glob("**/*.jpg")) + list(output_path.glob("**/*.png"))
                    images = list(set(images))  # Remove duplicates

                    print(f"     ✓ Downloaded: {len(images)} images")
                    total_downloaded += 1
                else:
                    error_msg = result.stderr.strip()
                    if "404" in error_msg or "not found" in error_msg.lower():
                        print(f"     ⚠️  Dataset not found or access denied")
                    else:
                        print(f"     ❌ Error: {error_msg[:100]}")
                    total_failed += 1

            except subprocess.CalledProcessError as e:
                print(f"     ❌ Failed: {e}")
                total_failed += 1
            except Exception as e:
                print(f"     ❌ Unexpected error: {e}")
                total_failed += 1

    # Summary
    print("\n" + "="*60)
    print("📊 Download Summary")
    print("="*60)
    print(f"✓ Successfully downloaded: {total_downloaded} datasets")
    print(f"❌ Failed: {total_failed} datasets")

    # Count images
    try:
        all_images = list(base_path.glob("**/*.jpg")) + list(base_path.glob("**/*.png"))
        all_images = list(set(all_images))  # Remove duplicates
        print(f"\n📸 Total images: {len(all_images):,}")

        if len(all_images) > 5000:
            print("✓ Sufficient data for training (>5,000 images)")
        else:
            print(f"⚠️  Limited data ({len(all_images)} images). Recommend >5,000 for good results")

    except Exception as e:
        print(f"⚠️  Could not count images: {e}")

    print("\n📂 Dataset location: ai-service/data/datasets/raw/")
    print("\n🔄 Next step: Run 'python3 organize_datasets.py'")
    print("="*60 + "\n")

if __name__ == "__main__":
    download_datasets()
