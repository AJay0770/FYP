"""Fine-tune YOLOv8 on the organized PPE dataset and publish models/best.pt.

    python scripts/train_model.py                       # 50 epochs, yolov8s, 640px
    python scripts/train_model.py --epochs 100 --batch 8
    python scripts/train_model.py --device 0            # force a specific GPU
    python scripts/train_model.py --resume              # continue the last run

Training writes to runs/detect/<name>/. On success the best checkpoint is copied
to models/best.pt, which is the path safety_stream.py and safety_detector.py both
load from - so a finished run is immediately live for the whole stack.

CPU-only training on this dataset takes hours. Check `Device` in the banner below
before walking away: if it says CPU and you have an NVIDIA GPU, the CUDA build of
torch is not installed (see TROUBLESHOOTING.md).
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
DATA_YAML = SERVICE_ROOT / "data" / "datasets" / "organized" / "dataset.yaml"
MODELS_DIR = SERVICE_ROOT / "models"

TARGET_CLASSES = ["hardhat", "construction_worker", "ppe", "no_ppe"]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", type=Path, default=DATA_YAML)
    parser.add_argument("--weights", default="yolov8s.pt", help="starting checkpoint (downloaded on first use)")
    parser.add_argument("--epochs", type=int, default=50)
    parser.add_argument("--imgsz", type=int, default=640)
    parser.add_argument("--batch", type=int, default=16, help="-1 lets ultralytics auto-size to the GPU")
    parser.add_argument("--device", default=None, help="cuda index, 'cpu', or omit to auto-detect")
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--patience", type=int, default=15, help="early-stop after N epochs without improvement")
    parser.add_argument("--name", default="ppe-detector")
    parser.add_argument("--project", type=Path, default=SERVICE_ROOT / "runs")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--no-publish", action="store_true", help="do not copy best.pt into models/")
    return parser.parse_args()


def check_dataset(data_yaml: Path) -> tuple[Path, dict]:
    if not data_yaml.exists():
        # The guide's own organize_datasets.py writes dataset.yaml too, but older
        # runs left data.yaml. Accept either rather than failing on a filename.
        alternative = data_yaml.with_name("data.yaml")
        if alternative.exists():
            data_yaml = alternative

    if not data_yaml.exists():
        sys.exit(
            f"Dataset descriptor not found: {data_yaml}\n"
            "Build it first:\n"
            "  python scripts/download_dataset.py\n"
            "  python scripts/organize_dataset.py"
        )

    try:
        import yaml
    except ImportError:
        sys.exit("PyYAML is required. Install it with:  pip install pyyaml")

    with open(data_yaml, encoding="utf-8") as handle:
        spec = yaml.safe_load(handle) or {}

    root = Path(spec.get("path", data_yaml.parent))
    counts = {}
    for split in ("train", "val", "test"):
        rel = spec.get(split)
        if not rel:
            continue
        images = root / rel
        counts[split] = len(list(images.glob("*"))) if images.exists() else 0

    if counts.get("train", 0) == 0:
        sys.exit(f"No training images under {root}. Re-run scripts/organize_dataset.py.")
    if counts.get("val", 0) == 0:
        print("WARNING: the validation split is empty - mAP numbers will be meaningless.")

    names = spec.get("names") or []
    if list(names) != TARGET_CLASSES:
        print(f"WARNING: data.yaml classes {list(names)} differ from the expected {TARGET_CLASSES}.")
        print("         The Node/React layers assume the expected order; retrain or fix data.yaml.")

    return data_yaml, counts


def resolve_device(requested: str | None) -> str:
    if requested is not None:
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "0"
    except ImportError:
        pass
    return "cpu"


def publish(run_dir: Path) -> Path | None:
    best = run_dir / "weights" / "best.pt"
    if not best.exists():
        print(f"WARNING: no best.pt produced under {run_dir}")
        return None

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    destination = MODELS_DIR / "best.pt"

    # Keep the previous weights around: a worse run should never be an
    # irreversible loss of a good model.
    if destination.exists():
        backup = MODELS_DIR / "best.previous.pt"
        shutil.copy2(destination, backup)
        print(f"Previous weights backed up to {backup}")

    shutil.copy2(best, destination)
    print(f"Published {destination} ({destination.stat().st_size / 1e6:.1f} MB)")
    return destination


def main() -> None:
    args = parse_args()
    args.data, counts = check_dataset(args.data)

    try:
        from ultralytics import YOLO
    except ImportError:
        sys.exit("ultralytics is not installed. Run:  pip install -r requirements.txt")

    device = resolve_device(args.device)

    print("=" * 68)
    print("BuildSite360 - YOLOv8 PPE training")
    print("=" * 68)
    print(f"  Data     : {args.data}")
    print(f"  Images   : " + ", ".join(f"{k}={v}" for k, v in counts.items()))
    print(f"  Classes  : {TARGET_CLASSES}")
    print(f"  Weights  : {args.weights}")
    print(f"  Epochs   : {args.epochs}   Batch: {args.batch}   Image size: {args.imgsz}")
    print(f"  Device   : {device}{'  (training on CPU will be slow)' if device == 'cpu' else ''}")
    print("=" * 68)

    model = YOLO(args.weights)

    try:
        model.train(
            data=str(args.data),
            epochs=args.epochs,
            imgsz=args.imgsz,
            batch=args.batch,
            device=device,
            workers=args.workers,
            patience=args.patience,
            project=str(args.project),
            name=args.name,
            resume=args.resume,
            exist_ok=True,
            plots=True,
        )
    except KeyboardInterrupt:
        sys.exit("\nTraining interrupted. Re-run with --resume to continue from the last epoch.")
    except Exception as exc:
        sys.exit(f"\nTraining failed: {type(exc).__name__}: {exc}\nSee TROUBLESHOOTING.md > Training.")

    run_dir = Path(model.trainer.save_dir) if getattr(model, "trainer", None) else args.project / args.name

    print("\nValidating best checkpoint ...")
    try:
        metrics = model.val()
        box = getattr(metrics, "box", None)
        if box is not None:
            print(f"  mAP50    : {box.map50:.4f}")
            print(f"  mAP50-95 : {box.map:.4f}")
    except Exception as exc:
        print(f"  validation skipped: {exc}")

    if not args.no_publish:
        publish(run_dir)

    print(f"\nRun artefacts: {run_dir}")
    print("Next:")
    print("  python test_integration.py            # verify the whole pipeline")
    print("  python safety_stream.py               # serve the annotated stream")


if __name__ == "__main__":
    main()
