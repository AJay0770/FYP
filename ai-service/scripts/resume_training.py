"""Resume a YOLOv8 training run after an interruption (power loss, crash, manual stop).

Ultralytics checkpoints `last.pt` (plus optimizer/epoch/EMA state) at the end of
every completed epoch under runs/detect/<name>/weights/. On an unplanned
interruption -- a power outage with no UPS is the case this project cares
about -- at most the epoch in progress at the moment of interruption is lost;
everything before it is on disk. This script finds the most recent run's
last.pt and continues training from exactly that point, rather than
restarting from epoch 0 and the original yolov8s.pt weights.

IMPORTANT, learned the hard way: `yolo task=detect mode=train resume=<path>`
alone is NOT enough on ultralytics 8.0.0. Its Hydra-based CLI merges every key
you don't explicitly override from its own baked-in default.yaml (model:
yolov8n.yaml, data: coco128.yaml, ...) BEFORE any resume-specific Python logic
ever runs -- so a bare `resume=` silently launches a fresh yolov8n/coco128 run
instead of continuing this one (it fails loudly enough once it tries to
download coco128, but the real bug is upstream of that error). The fix is to
replay every hyperparameter from the interrupted run's own saved args.yaml
explicitly, with `resume` swapped from `false` to the checkpoint path -- not
to rely on ultralytics inferring them from the checkpoint alone.

Usage:
    python scripts/resume_training.py                  # auto-find the latest run
    python scripts/resume_training.py --run ppe_yolov8s_v2   # resume a specific run by name
"""

import argparse
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
RUNS_DIR = REPO_ROOT / "runs" / "detect"

# Not real trainer input args -- `hydra` is Hydra's own nested config block
# (invalid as a flat `key=value` override) and `save_dir` is a value the
# trainer computes from project+name, not one it accepts as input.
NON_OVERRIDE_KEYS = {"hydra", "save_dir"}


def parse_args():
    parser = argparse.ArgumentParser(description="Resume an interrupted YOLOv8 training run.")
    parser.add_argument("--run", help="Run folder name under runs/detect/ (default: most recently modified).")
    return parser.parse_args()


def find_run_dir(run_name: str | None) -> Path:
    if run_name:
        run_dir = RUNS_DIR / run_name
        if not (run_dir / "weights" / "last.pt").exists():
            sys.exit(f"No checkpoint at {run_dir / 'weights' / 'last.pt'}")
        return run_dir

    candidates = sorted(
        RUNS_DIR.glob("*/weights/last.pt"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        sys.exit(f"No last.pt checkpoint found anywhere under {RUNS_DIR}. Nothing to resume -- start a new run.")
    return candidates[0].parent.parent


def format_override(key: str, value) -> str:
    if value is None:
        return f"{key}=null"
    if isinstance(value, bool):
        return f"{key}={'true' if value else 'false'}"
    return f"{key}={value}"


def main():
    args = parse_args()
    run_dir = find_run_dir(args.run)
    ckpt = run_dir / "weights" / "last.pt"
    args_yaml = run_dir / "args.yaml"

    if not args_yaml.exists():
        sys.exit(f"No args.yaml at {args_yaml} -- can't reconstruct the original run config to resume safely.")

    with open(args_yaml) as f:
        saved_args = yaml.safe_load(f)

    # Point both `model` and `resume` at this run's own checkpoint (relative to
    # REPO_ROOT, the subprocess's cwd, with forward slashes -- Windows accepts
    # those natively and it sidesteps any risk of a backslash confusing Hydra's
    # override parser). `model` must be the checkpoint too, not the saved
    # args.yaml's original starting weights (e.g. yolov8s.pt): engine/model.py's
    # Model.train() does `if overrides.get("resume"): overrides["resume"] =
    # self.ckpt_path`, and self.ckpt_path is derived from whatever `model=` was
    # passed to `YOLO(...)`. Leaving model=yolov8s.pt there silently replaces
    # our correct resume path with yolov8s.pt's own path, which sends
    # check_resume()'s `last.parent.parent / 'args.yaml'` lookup to the wrong
    # directory and crashes with "UnboundLocalError: local variable 'args'
    # referenced before assignment" -- a real bug in this pinned ultralytics
    # version, worked around here rather than in site-packages.
    rel_ckpt = ckpt.relative_to(REPO_ROOT).as_posix()
    saved_args["model"] = rel_ckpt
    saved_args["resume"] = rel_ckpt

    overrides = [
        format_override(k, v) for k, v in saved_args.items() if k not in NON_OVERRIDE_KEYS
    ]

    yolo = REPO_ROOT / "venv" / "Scripts" / "yolo.exe"
    if not yolo.exists():
        yolo = "yolo"  # fall back to PATH (e.g. non-Windows, or a differently named venv)

    cmd = [str(yolo), *overrides]
    print(f"Resuming run: {run_dir.name}", flush=True)
    print(f"Checkpoint:   {ckpt}", flush=True)
    print("Running:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd, cwd=REPO_ROOT)
    sys.exit(result.returncode)


if __name__ == "__main__":
    main()
