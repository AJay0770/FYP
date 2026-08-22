#!/usr/bin/env python3
"""
Downloads construction PPE datasets from Roboflow (free tier)
Requires: pip install roboflow

Roboflow advantages:
- Often pre-formatted for YOLOv8
- Better labeling quality
- Free tier with API key

Note: If datasets don't exist in your Roboflow workspace,
fallback to Kaggle using download_kaggle_datasets.py
"""

import os
import sys
from pathlib import Path

def install_roboflow():
    """Check if roboflow package is installed"""
    try:
        import roboflow
        print("✓ Roboflow package installed")
        return True
    except ImportError:
        print("\n⚠️  Roboflow not installed. Installing...")
        try:
            import subprocess
            subprocess.run([sys.executable, "-m", "pip", "install", "-q", "roboflow"],
                          check=True)
            print("✓ Roboflow installed")
            return True
        except Exception as e:
            print(f"❌ Failed to install Roboflow: {e}")
            return False

def get_api_key():
    """Get Roboflow API key from user or environment"""

    # Check environment variable first
    if api_key := os.getenv('ROBOFLOW_API_KEY'):
        print(f"✓ Using ROBOFLOW_API_KEY from environment")
        return api_key

    # Prompt user
    print("\n" + "="*60)
    print("🔑 Roboflow API Key Required")
    print("="*60)
    print("\nSteps to get your API key:")
    print("1. Go to: https://roboflow.com (sign up if needed)")
    print("2. Go to Settings → API Keys")
    print("3. Copy your API key")
    print("\nAlternative: Set environment variable:")
    print("   export ROBOFLOW_API_KEY=your_key_here\n")

    api_key = input("Enter your Roboflow API key: ").strip()

    if not api_key:
        print("❌ API key required")
        return None

    # Save to .env for future use
    env_file = Path(".env.local")
    try:
        if env_file.exists():
            content = env_file.read_text()
            if "ROBOFLOW_API_KEY" not in content:
                env_file.write_text(content + f"\nROBOFLOW_API_KEY={api_key}\n")
        else:
            env_file.write_text(f"ROBOFLOW_API_KEY={api_key}\n")
        print(f"✓ Saved to .env.local")
    except Exception as e:
        print(f"⚠️  Could not save to .env.local: {e}")

    return api_key

def find_public_datasets():
    """Find popular public construction PPE datasets on Roboflow"""
    print("\n" + "="*60)
    print("🔍 Popular Public Construction PPE Datasets")
    print("="*60)

    datasets = [
        {
            "name": "hard-hat-workers",
            "workspace": "universe",
            "description": "7,000+ hard hat detection images"
        },
        {
            "name": "construction-site-safety",
            "workspace": "universe",
            "description": "Multi-class construction safety detection"
        },
        {
            "name": "ppe-detection-roboflow",
            "workspace": "universe",
            "description": "General PPE detection dataset"
        }
    ]

    print("\nNote: These are common Roboflow datasets.")
    print("If you have a specific dataset in your workspace, enter its details below.\n")

    return datasets

def download_from_roboflow(api_key, workspace, project_name, version=1):
    """Download dataset from Roboflow"""

    from roboflow import Roboflow

    try:
        print(f"\n📥 Downloading {project_name} from {workspace}...")

        rf = Roboflow(api_key=api_key)

        # Get workspace
        workspace_obj = rf.workspace(workspace)

        # Get project
        project_obj = workspace_obj.project(project_name)

        # Get version and download
        dataset = project_obj.version(version).download("yolov8")

        print(f"✓ Downloaded to: {dataset.location}")
        return dataset.location

    except Exception as e:
        error_msg = str(e).lower()
        if "not found" in error_msg or "404" in error_msg:
            print(f"⚠️  Dataset not found: {workspace}/{project_name}")
            print(f"   Check that it exists in your Roboflow workspace:")
            print(f"   https://roboflow.com/{workspace}/{project_name}")
        else:
            print(f"❌ Error: {e}")
        return None

def download_datasets():
    """Main download workflow"""

    print("\n" + "="*60)
    print("🎯 Roboflow Construction PPE Dataset Downloader")
    print("="*60)

    # Check dependencies
    if not install_roboflow():
        print("\n💡 Try using Kaggle instead:")
        print("   python3 download_kaggle_datasets.py")
        return

    # Create directories
    base_path = Path("ai-service/data/datasets/raw")
    base_path.mkdir(parents=True, exist_ok=True)

    # Get API key
    api_key = get_api_key()
    if not api_key:
        print("\n💡 Try using Kaggle instead:")
        print("   python3 download_kaggle_datasets.py")
        return

    # Show public datasets
    public_datasets = find_public_datasets()

    print("Recommended datasets to try:")
    for i, ds in enumerate(public_datasets, 1):
        print(f"{i}. {ds['name']}: {ds['description']}")

    # Get user input
    print("\n" + "="*60)
    print("📋 Select datasets to download")
    print("="*60)
    print("\nEnter dataset details (or 'q' to quit):\n")

    downloaded = 0
    failed = 0

    while True:
        try:
            workspace = input("Workspace (default: 'universe'): ").strip() or "universe"
            project = input("Project name (or 'q' to finish): ").strip()

            if project.lower() == 'q':
                break

            version = input("Version (default: 1): ").strip() or "1"

            # Download
            location = download_from_roboflow(api_key, workspace, project, int(version))

            if location:
                downloaded += 1

                # Organize into category folder
                category_name = project.replace("-", "_").lower()
                category_path = base_path / category_name
                category_path.mkdir(exist_ok=True)

                # Count images
                images = list(Path(location).glob("**/*.jpg")) + list(Path(location).glob("**/*.png"))
                print(f"   Contains: {len(images)} images")
            else:
                failed += 1

        except KeyboardInterrupt:
            print("\n\nCancelled by user")
            break
        except Exception as e:
            print(f"❌ Error: {e}")
            failed += 1

    # Summary
    print("\n" + "="*60)
    print("📊 Download Summary")
    print("="*60)
    print(f"✓ Successfully downloaded: {downloaded} datasets")
    print(f"❌ Failed: {failed} datasets")

    if downloaded > 0:
        print("\n📂 Datasets saved to: ai-service/data/datasets/raw/")
        print("\n🔄 Next step: Run 'python3 organize_datasets.py'")
    else:
        print("\n💡 No datasets downloaded. Try Kaggle instead:")
        print("   python3 download_kaggle_datasets.py")

    print("="*60 + "\n")

if __name__ == "__main__":
    download_datasets()
