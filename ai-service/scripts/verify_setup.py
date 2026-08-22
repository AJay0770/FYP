"""Pre-flight check for the AI service: interpreter, packages, folders, config.

    python scripts/verify_setup.py
    python scripts/verify_setup.py --json      # machine-readable, for CI

Answers "is this machine ready to run the safety pipeline?" and nothing else -
it opens no cameras and loads no weights. test_integration.py does that.

Exit code is 0 when every REQUIRED check passes, 1 otherwise, so it can gate a
setup script.
"""

from __future__ import annotations

import argparse
import importlib
import json
import os
import platform
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parent.parent
REPO_ROOT = SERVICE_ROOT.parent


def _load_env() -> None:
    """Load .env files with real environment variables taking precedence.

    override=False everywhere, so an exported CAMERA_SOURCE beats .env.local and
    .env.local beats .env - the same precedence safety_stream.py uses. Loading
    with override=True would let a stale file silently win over what the operator
    just typed on the command line.
    """
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    for candidate in (
        SERVICE_ROOT / ".env.local",
        REPO_ROOT / ".env.local",
        SERVICE_ROOT / ".env",
        REPO_ROOT / ".env",
    ):
        load_dotenv(candidate, override=False)


def _resolve_model_path() -> Path:
    """Interpret YOLO_MODEL_PATH the same way safety_stream.py does.

    It is conventionally written repo-relative ("ai-service/models/best.pt"), so
    resolving it against the working directory alone reports a file that does not
    exist whenever the script is run from ai-service/.
    """
    candidate = Path((os.getenv("YOLO_MODEL_PATH") or "models/best.pt").strip())
    if candidate.is_absolute():
        return candidate
    for base in (Path.cwd(), REPO_ROOT, SERVICE_ROOT):
        resolved = (base / candidate).resolve()
        if resolved.exists():
            return resolved
    base = REPO_ROOT if candidate.parts and candidate.parts[0] == SERVICE_ROOT.name else SERVICE_ROOT
    return (base / candidate).resolve()


# Loaded at import, before any check reads a variable: check_model() runs before
# check_env(), and loading inside the latter made the model path depend on check
# order.
_load_env()

OK, WARN, FAIL = "PASS", "WARN", "FAIL"

# (import name, pip name, required?)
PACKAGES = [
    ("cv2", "opencv-python", True),
    ("numpy", "numpy", True),
    ("fastapi", "fastapi", True),
    ("uvicorn", "uvicorn", True),
    ("requests", "requests", True),
    ("dotenv", "python-dotenv", True),
    ("yaml", "pyyaml", True),
    ("ultralytics", "ultralytics", False),
    ("torch", "torch", False),
    ("roboflow", "roboflow", False),
    ("deepface", "deepface", False),
]

REQUIRED_DIRS = [
    SERVICE_ROOT / "models",
    SERVICE_ROOT / "data" / "datasets" / "raw",
    SERVICE_ROOT / "data" / "datasets" / "organized",
    SERVICE_ROOT / "data" / "test_images",
]

REQUIRED_FILES = [
    SERVICE_ROOT / "safety_stream.py",
    SERVICE_ROOT / "test_integration.py",
    SERVICE_ROOT / "scripts" / "download_dataset.py",
    SERVICE_ROOT / "scripts" / "organize_dataset.py",
    SERVICE_ROOT / "scripts" / "train_model.py",
]

# (env var, required?, note)
ENV_VARS = [
    ("CAMERA_SOURCE", True, "camera feed the stream reads"),
    ("CAMERA_TYPE", False, "informational label"),
    ("SAFETY_CONFIDENCE_THRESHOLD", False, "defaults to 0.5"),
    ("STREAM_PORT", False, "defaults to 8554"),
    ("NODE_API_URL", False, "defaults to http://localhost:3000"),
    ("X_INTERNAL_TOKEN", True, "without it no alert can be written to the database"),
    ("SAFETY_CAMERA_ID", False, "alerts are not persisted unless a camera id is set"),
    ("ROBOFLOW_API_KEY", False, "only needed for scripts/download_dataset.py"),
]


class Report:
    def __init__(self) -> None:
        self.rows: list[dict] = []

    def add(self, section: str, name: str, status: str, detail: str = "", required: bool = True) -> None:
        self.rows.append(
            {"section": section, "name": name, "status": status, "detail": detail, "required": required}
        )

    @property
    def failed(self) -> list[dict]:
        return [r for r in self.rows if r["status"] == FAIL and r["required"]]

    def render(self) -> None:
        width = max(len(r["name"]) for r in self.rows) + 2
        current = None
        for row in self.rows:
            if row["section"] != current:
                current = row["section"]
                print(f"\n{current}")
                print("-" * (width + 30))
            mark = {OK: "[ok]  ", WARN: "[warn]", FAIL: "[FAIL]"}[row["status"]]
            print(f"  {mark} {row['name']:<{width}} {row['detail']}")


def check_python(report: Report) -> None:
    version = sys.version_info
    detail = f"{platform.python_version()} on {platform.system()} {platform.machine()}"

    if version < (3, 10):
        report.add("Interpreter", "python", FAIL, f"{detail} - 3.10+ required")
    elif version >= (3, 12):
        # torch 2.0.1 / deepface publish no wheels this new; the stream service
        # itself is fine, face recognition is not.
        report.add(
            "Interpreter", "python", WARN,
            f"{detail} - requirements.txt pins packages that need 3.10/3.11",
            required=False,
        )
    else:
        report.add("Interpreter", "python", OK, detail)

    in_venv = sys.prefix != getattr(sys, "base_prefix", sys.prefix)
    report.add(
        "Interpreter", "virtualenv",
        OK if in_venv else WARN,
        sys.prefix if in_venv else "not running inside a virtualenv",
        required=False,
    )


def check_packages(report: Report) -> None:
    for module, pip_name, required in PACKAGES:
        try:
            mod = importlib.import_module(module)
            version = getattr(mod, "__version__", "installed")
            report.add("Packages", pip_name, OK, str(version), required)
        except Exception as exc:
            detail = f"pip install {pip_name}"
            if not isinstance(exc, ImportError):
                detail = f"{type(exc).__name__}: {exc}"
            report.add("Packages", pip_name, FAIL if required else WARN, detail, required)


def check_layout(report: Report) -> None:
    for directory in REQUIRED_DIRS:
        rel = directory.relative_to(SERVICE_ROOT)
        exists = directory.is_dir()
        report.add("Project layout", str(rel), OK if exists else FAIL, "" if exists else "missing - mkdir it")

    for file in REQUIRED_FILES:
        rel = file.relative_to(SERVICE_ROOT)
        report.add("Project layout", str(rel), OK if file.exists() else FAIL, "" if file.exists() else "missing")


def check_model(report: Report) -> None:
    model_path = _resolve_model_path()
    if model_path.exists():
        report.add("Model", "best.pt", OK, f"{model_path} ({model_path.stat().st_size / 1e6:.1f} MB)")
    else:
        report.add(
            "Model", "best.pt", WARN,
            f"{model_path} not found - run scripts/train_model.py (the stream still runs, undetected)",
            required=False,
        )


def check_dataset(report: Report) -> None:
    organized = SERVICE_ROOT / "data" / "datasets" / "organized"
    data_yaml = next(
        (p for p in (organized / "dataset.yaml", organized / "data.yaml") if p.exists()),
        None,
    )

    if data_yaml is None:
        report.add("Dataset", "dataset.yaml", WARN, "not built yet - run scripts/organize_dataset.py", required=False)
        return

    report.add("Dataset", "dataset.yaml", OK, str(data_yaml))
    for split in ("train", "val", "test"):
        images = organized / "images" / split
        count = len(list(images.glob("*"))) if images.exists() else 0
        status = OK if count else (WARN if split == "test" else FAIL)
        report.add("Dataset", f"{split} images", status, str(count), required=(split == "train"))


def check_env(report: Report) -> None:
    loaded = [p.name for p in (REPO_ROOT / ".env.local", REPO_ROOT / ".env", SERVICE_ROOT / ".env.local") if p.exists()]
    report.add("Environment", "config files", OK if loaded else WARN, ", ".join(loaded) or "no .env/.env.local found", required=False)

    for name, required, note in ENV_VARS:
        value = os.getenv(name)
        if value:
            shown = "***" if "TOKEN" in name or "KEY" in name else value
            report.add("Environment", name, OK, shown, required)
        else:
            report.add("Environment", name, FAIL if required else WARN, f"unset - {note}", required)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", action="store_true", help="emit JSON instead of a table")
    args = parser.parse_args()

    report = Report()
    check_python(report)
    check_packages(report)
    check_layout(report)
    check_model(report)
    check_dataset(report)
    check_env(report)

    if args.json:
        print(json.dumps({"rows": report.rows, "ok": not report.failed}, indent=2))
    else:
        print("=" * 68)
        print("BuildSite360 AI service - setup verification")
        print("=" * 68)
        report.render()
        print("\n" + "=" * 68)
        if report.failed:
            print(f"{len(report.failed)} required check(s) failed:")
            for row in report.failed:
                print(f"  - {row['name']}: {row['detail']}")
            print("See TROUBLESHOOTING.md")
        else:
            print("All required checks passed. Next: python test_integration.py")
        print("=" * 68)

    sys.exit(1 if report.failed else 0)


if __name__ == "__main__":
    main()
