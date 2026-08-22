"""Reshape a downloaded dataset into the YOLOv8 layout BuildSite360 trains on.

Input : data/datasets/raw/<name>/   (whatever shape the provider shipped)
Output: data/datasets/organized/
            images/{train,val,test}
            labels/{train,val,test}
            dataset.yaml

That layout - images/ and labels/ as siblings with the split beneath - is the one
verification/DATASET_ORGANIZATION_GUIDE.md documents and the one
scripts/verify_dataset.py checks, so both readers agree on where things live.

Two jobs are done here, and the second is the one that matters:

  1. Flatten and split. Any nesting is walked, images are paired with their
     YOLO .txt labels, and the set is split train/val/test (default 70/20/10).
  2. Remap class ids. Public PPE datasets ship 10+ classes with their own
     ordering; this project detects exactly four:

         0 hardhat   1 construction_worker   2 ppe   3 no_ppe

     CLASS_ALIASES maps the common source names onto those four. Anything not
     listed is dropped from the labels (and reported), so a stray class can
     never silently shift every id by one - which is the classic way to end up
     with a model that confidently predicts the wrong thing.

Usage:
    python scripts/organize_dataset.py
    python scripts/organize_dataset.py --raw data/datasets/raw/construction-safety
    python scripts/organize_dataset.py --split 0.8 0.1 0.1 --copy
"""

from __future__ import annotations

import argparse
import random
import shutil
import sys
from collections import Counter
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = SERVICE_ROOT / "data" / "datasets" / "raw"
ORGANIZED_DIR = SERVICE_ROOT / "data" / "datasets" / "organized"

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
SPLITS = ("train", "val", "test")

# Target classes, in the id order the model is trained with. Do not reorder:
# the ids are baked into every label file and into the exported weights.
TARGET_CLASSES = ["hardhat", "construction_worker", "ppe", "no_ppe"]

# Source class name (lowercased) -> target class name.
CLASS_ALIASES = {
    # hardhat / helmet
    "hardhat": "hardhat",
    "hard-hat": "hardhat",
    "hard hat": "hardhat",
    "helmet": "hardhat",
    "safety-helmet": "hardhat",
    "safety helmet": "hardhat",
    # the worker themself
    "person": "construction_worker",
    "worker": "construction_worker",
    "construction_worker": "construction_worker",
    "construction-worker": "construction_worker",
    "people": "construction_worker",
    # other PPE that counts as compliant
    "vest": "ppe",
    "safety-vest": "ppe",
    "safety vest": "ppe",
    "reflective-vest": "ppe",
    "mask": "ppe",
    "gloves": "ppe",
    "safety-boots": "ppe",
    "goggles": "ppe",
    "ppe": "ppe",
    # violations
    "no-hardhat": "no_ppe",
    "no hardhat": "no_ppe",
    "no-helmet": "no_ppe",
    "nohelmet": "no_ppe",
    "head": "no_ppe",           # bare head - the usual "no helmet" proxy class
    "no-vest": "no_ppe",
    "no-safety-vest": "no_ppe",
    "no-mask": "no_ppe",
    "no_ppe": "no_ppe",
    "no-ppe": "no_ppe",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=None, help="raw dataset folder (default: newest under data/datasets/raw)")
    parser.add_argument("--out", type=Path, default=ORGANIZED_DIR)
    parser.add_argument("--split", nargs=3, type=float, metavar=("TRAIN", "VAL", "TEST"), default=[0.7, 0.2, 0.1])
    parser.add_argument("--seed", type=int, default=42, help="split RNG seed, for reproducible datasets")
    parser.add_argument("--copy", action="store_true", help="copy files instead of hard-linking (slower, uses more disk)")
    parser.add_argument("--force", action="store_true", help="wipe an existing organized/ first")
    parser.add_argument("--keep-source-splits", action="store_true", help="respect the train/valid/test folders the source already has")
    return parser.parse_args()


def newest_raw_dataset() -> Path:
    candidates = [p for p in RAW_DIR.iterdir() if p.is_dir()] if RAW_DIR.exists() else []
    if not candidates:
        sys.exit(
            f"No dataset found under {RAW_DIR}.\n"
            "Download one first:  python scripts/download_dataset.py"
        )
    return max(candidates, key=lambda p: p.stat().st_mtime)


def load_source_classes(raw: Path) -> list[str]:
    """Read the class list from the dataset data.yaml, if it has one."""
    yaml_files = sorted(raw.rglob("*.yaml"))
    for candidate in yaml_files:
        try:
            import yaml

            with open(candidate, encoding="utf-8") as handle:
                spec = yaml.safe_load(handle) or {}
        except ImportError:
            sys.exit("PyYAML is required. Install it with:  pip install pyyaml")
        except Exception:
            continue

        names = spec.get("names")
        if isinstance(names, dict):
            names = [names[k] for k in sorted(names, key=lambda k: int(k))]
        if isinstance(names, list) and names:
            print(f"Source classes from {candidate.name}: {names}")
            return [str(n).strip().lower() for n in names]

    sys.exit(
        f"Could not find a data.yaml with a class list under {raw}.\n"
        "Without it the numeric class ids in the labels cannot be interpreted."
    )


def find_pairs(raw: Path) -> list[tuple[Path, Path | None]]:
    """Pair every image with its YOLO label file, wherever they live."""
    labels_by_stem: dict[str, Path] = {}
    for txt in raw.rglob("*.txt"):
        # requirements.txt-style files sitting next to the data are not labels.
        if txt.parent.name.lower() in {"labels", "label"} or txt.stem not in labels_by_stem:
            labels_by_stem.setdefault(txt.stem, txt)

    pairs: list[tuple[Path, Path | None]] = []
    for image in sorted(raw.rglob("*")):
        if image.suffix.lower() not in IMAGE_SUFFIXES:
            continue
        label = labels_by_stem.get(image.stem)
        pairs.append((image, label))
    return pairs


def remap_label(
    label_path: Path,
    source_classes: list[str],
    stats: Counter,
    dropped: Counter,
) -> list[str]:
    """Rewrite one label file onto the four target classes."""
    lines: list[str] = []

    for raw_line in label_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        parts = raw_line.split()
        if len(parts) < 5:
            continue

        try:
            source_id = int(float(parts[0]))
        except ValueError:
            continue

        if not 0 <= source_id < len(source_classes):
            dropped[f"id {source_id} (out of range)"] += 1
            continue

        source_name = source_classes[source_id]
        target_name = CLASS_ALIASES.get(source_name)
        if target_name is None:
            dropped[source_name] += 1
            continue

        target_id = TARGET_CLASSES.index(target_name)
        stats[target_name] += 1
        lines.append(" ".join([str(target_id), *parts[1:]]))

    return lines


def place(src: Path, dst: Path, copy: bool) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    if copy:
        shutil.copy2(src, dst)
        return
    try:
        # Hard links keep a multi-GB dataset from being duplicated on disk.
        if dst.exists():
            dst.unlink()
        import os

        os.link(src, dst)
    except OSError:
        shutil.copy2(src, dst)  # different volume, or a filesystem without links


def split_pairs(pairs: list, ratios: list[float], seed: int) -> dict[str, list]:
    total = sum(ratios)
    if total <= 0:
        sys.exit("--split values must add up to more than 0")
    ratios = [r / total for r in ratios]

    shuffled = list(pairs)
    random.Random(seed).shuffle(shuffled)

    n = len(shuffled)
    n_train = int(n * ratios[0])
    n_val = int(n * ratios[1])
    return {
        "train": shuffled[:n_train],
        "val": shuffled[n_train:n_train + n_val],
        "test": shuffled[n_train + n_val:],
    }


def split_from_source(pairs: list) -> dict[str, list] | None:
    """Use the train/valid/test folders the source already provides, if present."""
    buckets: dict[str, list] = {s: [] for s in SPLITS}
    matched = 0

    for image, label in pairs:
        parts = {p.lower() for p in image.parts}
        if "train" in parts:
            buckets["train"].append((image, label))
        elif {"val", "valid", "validation"} & parts:
            buckets["val"].append((image, label))
        elif "test" in parts:
            buckets["test"].append((image, label))
        else:
            continue
        matched += 1

    if matched < len(pairs) * 0.9:
        return None
    return buckets


def write_data_yaml(out: Path) -> Path:
    # Named dataset.yaml to match DATASET_ORGANIZATION_GUIDE.md and
    # scripts/verify_dataset.py; ultralytics does not care about the filename.
    path = out / "dataset.yaml"
    body = [
        "# Generated by scripts/organize_dataset.py - edit the script, not this file.",
        f"path: {out.resolve().as_posix()}",
        "train: images/train",
        "val: images/val",
        "test: images/test",
        "",
        f"nc: {len(TARGET_CLASSES)}",
        f"names: {TARGET_CLASSES}",
        "",
    ]
    path.write_text("\n".join(body), encoding="utf-8")
    return path


def main() -> None:
    args = parse_args()
    raw = args.raw or newest_raw_dataset()
    if not raw.exists():
        sys.exit(f"Raw dataset not found: {raw}")

    out: Path = args.out
    # .gitkeep is committed to keep the empty folder in git, so "not empty" has to
    # mean "contains real output" or the very first run always refuses to start.
    existing = [p for p in out.iterdir() if p.name != ".gitkeep"] if out.exists() else []
    if existing:
        if not args.force:
            sys.exit(f"{out} is not empty. Re-run with --force to rebuild it.")
        for item in existing:
            shutil.rmtree(item) if item.is_dir() else item.unlink()

    print(f"Organising {raw}\n       -> {out}")

    source_classes = load_source_classes(raw)
    pairs = find_pairs(raw)
    if not pairs:
        sys.exit(f"No images found under {raw}")

    unlabelled = [p for p in pairs if p[1] is None]
    pairs = [p for p in pairs if p[1] is not None]
    print(f"Found {len(pairs)} labelled images ({len(unlabelled)} unlabelled, skipped)")

    buckets = split_from_source(pairs) if args.keep_source_splits else None
    if buckets is None:
        buckets = split_pairs(pairs, args.split, args.seed)
    else:
        print("Reusing the train/val/test split from the source dataset")

    stats: Counter = Counter()
    dropped: Counter = Counter()
    empty_labels = 0
    written = {s: 0 for s in SPLITS}

    for split, items in buckets.items():
        for image, label in items:
            lines = remap_label(label, source_classes, stats, dropped)
            if not lines:
                # Every annotation on this image mapped to a dropped class. Keeping
                # it would teach the model that workers/PPE are background.
                empty_labels += 1
                continue

            stem = f"{image.parent.name}_{image.stem}"
            place(image, out / "images" / split / f"{stem}{image.suffix.lower()}", args.copy)
            (out / "labels" / split).mkdir(parents=True, exist_ok=True)
            (out / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
            written[split] += 1

    # Ultralytics expects every referenced split directory to exist.
    for split in SPLITS:
        (out / "images" / split).mkdir(parents=True, exist_ok=True)
        (out / "labels" / split).mkdir(parents=True, exist_ok=True)

    yaml_path = write_data_yaml(out)

    print("\nOrganised dataset")
    for split in SPLITS:
        print(f"  {split:<5} : {written[split]} images")
    print(f"  skipped (no usable class): {empty_labels}")
    print("\nAnnotations per target class")
    for name in TARGET_CLASSES:
        print(f"  {name:<20} {stats.get(name, 0)}")
    if dropped:
        print("\nDropped source classes (not in CLASS_ALIASES)")
        for name, count in dropped.most_common():
            print(f"  {name:<20} {count}")
        print("  -> add them to CLASS_ALIASES in this script if they should be kept")

    if written["train"] == 0:
        sys.exit("\nNo training images were produced - check CLASS_ALIASES against the source classes above.")

    print(f"\nWrote {yaml_path}")
    print("Next:  python scripts/train_model.py")


if __name__ == "__main__":
    main()
