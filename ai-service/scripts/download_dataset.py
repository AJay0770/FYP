"""Download a PPE / construction-safety dataset into data/datasets/raw.

Three sources, in order of preference:

  1. Roboflow  (needs ROBOFLOW_API_KEY)   - recommended, already YOLOv8-formatted
         python scripts/download_dataset.py --source roboflow
  2. A direct URL to a .zip                - any public dataset export
         python scripts/download_dataset.py --source url --url https://host/ppe.zip
  3. A local .zip already on disk          - offline / manually downloaded
         python scripts/download_dataset.py --source local --archive ~/Downloads/ppe.zip

Everything lands under data/datasets/raw/<name>/ and is left exactly as the
provider shipped it. Reshaping into the training layout is the next step:

    python scripts/organize_dataset.py

Nothing here overwrites an existing download unless --force is passed.
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import zipfile
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = SERVICE_ROOT / "data" / "datasets" / "raw"

# Roboflow Universe project holding hardhat / worker / PPE annotations. Override
# any of these on the command line if you fork the dataset or pin a version.
DEFAULT_WORKSPACE = os.getenv("ROBOFLOW_WORKSPACE", "roboflow-universe-projects")
DEFAULT_PROJECT = os.getenv("ROBOFLOW_PROJECT", "construction-site-safety")
DEFAULT_VERSION = int(os.getenv("ROBOFLOW_VERSION", "30"))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["roboflow", "url", "local"], default="roboflow")
    parser.add_argument("--name", default="construction-safety", help="folder name under data/datasets/raw")
    parser.add_argument("--url", help="direct .zip URL (--source url)")
    parser.add_argument("--archive", type=Path, help="path to a local .zip (--source local)")
    parser.add_argument("--workspace", default=DEFAULT_WORKSPACE)
    parser.add_argument("--project", default=DEFAULT_PROJECT)
    parser.add_argument("--version", type=int, default=DEFAULT_VERSION)
    parser.add_argument("--format", default="yolov8", help="Roboflow export format")
    parser.add_argument("--force", action="store_true", help="re-download over an existing folder")
    return parser.parse_args()


def prepare_target(name: str, force: bool) -> Path:
    target = RAW_DIR / name
    if target.exists():
        if not force:
            sys.exit(
                f"{target} already exists. Re-run with --force to replace it, "
                "or pass a different --name."
            )
        print(f"Removing existing {target}")
        shutil.rmtree(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def download_roboflow(args: argparse.Namespace, target: Path) -> Path:
    api_key = os.getenv("ROBOFLOW_API_KEY")
    if not api_key:
        sys.exit(
            "ROBOFLOW_API_KEY is not set.\n"
            "  1. Sign in at https://app.roboflow.com and copy your private API key\n"
            "  2. Add ROBOFLOW_API_KEY=... to .env.local\n"
            "Or download the export manually and use --source local --archive <zip>."
        )

    try:
        from roboflow import Roboflow
    except ImportError:
        sys.exit("The roboflow package is missing. Install it with:  pip install roboflow")

    print(f"Downloading {args.workspace}/{args.project} v{args.version} as {args.format} ...")
    rf = Roboflow(api_key=api_key)
    project = rf.workspace(args.workspace).project(args.project)
    dataset = project.version(args.version).download(args.format, location=str(target))
    location = Path(getattr(dataset, "location", target))
    print(f"Downloaded to {location}")
    return location


def download_url(url: str, target: Path) -> Path:
    import requests

    target.mkdir(parents=True, exist_ok=True)
    archive = target / "dataset.zip"

    print(f"Fetching {url} ...")
    with requests.get(url, stream=True, timeout=120) as response:
        response.raise_for_status()
        total = int(response.headers.get("Content-Length") or 0)
        written = 0
        with open(archive, "wb") as handle:
            for chunk in response.iter_content(chunk_size=1 << 20):
                handle.write(chunk)
                written += len(chunk)
                if total:
                    print(f"\r  {written / 1e6:6.1f} / {total / 1e6:.1f} MB", end="", flush=True)
        print()

    extract(archive, target)
    archive.unlink()
    return target


def extract(archive: Path, target: Path) -> None:
    if not zipfile.is_zipfile(archive):
        sys.exit(f"{archive} is not a zip archive.")

    print(f"Extracting {archive.name} ...")
    with zipfile.ZipFile(archive) as zf:
        # Reject absolute paths and ../ traversal before writing anything: a
        # malicious archive could otherwise drop files anywhere on disk.
        for member in zf.namelist():
            resolved = (target / member).resolve()
            if not str(resolved).startswith(str(target.resolve())):
                sys.exit(f"Refusing to extract unsafe path from archive: {member}")
        zf.extractall(target)


def summarise(target: Path) -> None:
    images = sum(
        1
        for p in target.rglob("*")
        if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
    )
    labels = sum(1 for _ in target.rglob("*.txt"))
    yamls = [p for p in target.rglob("*.yaml")]

    print("\nDownload summary")
    print(f"  location : {target}")
    print(f"  images   : {images}")
    print(f"  labels   : {labels}")
    print(f"  yaml     : {', '.join(p.name for p in yamls) if yamls else 'none found'}")
    print("\nNext:  python scripts/organize_dataset.py")


def main() -> None:
    args = parse_args()
    target = prepare_target(args.name, args.force)

    if args.source == "roboflow":
        location = download_roboflow(args, target)
    elif args.source == "url":
        if not args.url:
            sys.exit("--url is required with --source url")
        location = download_url(args.url, target)
    else:
        if not args.archive or not args.archive.exists():
            sys.exit("--archive must point at an existing .zip with --source local")
        target.mkdir(parents=True, exist_ok=True)
        extract(args.archive, target)
        location = target

    summarise(location)


if __name__ == "__main__":
    main()
