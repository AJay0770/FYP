"""End-to-end verification of the BuildSite360 safety detection pipeline.

Runs the checks in dependency order and writes a report, so a failure tells you
which stage to fix rather than just "it does not work":

    1. environment      packages and configuration are present
    2. dataset          organized/ has the expected YOLO layout and class ids
    3. camera           CAMERA_SOURCE opens and yields a real frame
    4. model            models/best.pt loads and exposes the four classes
    5. inference        the model produces detections on a real frame
    6. stream service   safety_stream.py answers /health and /detections/latest
    7. node api         the Express API is up and the internal token works

Usage:
    python test_integration.py
    python test_integration.py --skip camera            # headless CI box
    python test_integration.py --source 0               # override CAMERA_SOURCE
    python test_integration.py --report data/output/verification_report.json

Exit code 0 = every non-skipped check passed. Network services that are simply
not running are reported as SKIP, not FAIL: this script verifies the pipeline,
it does not demand that every process be up.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

SERVICE_ROOT = Path(__file__).resolve().parent
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


_load_env()

PASS, FAIL, SKIP, WARN = "PASS", "FAIL", "SKIP", "WARN"

EXPECTED_CLASSES = ["hardhat", "construction_worker", "ppe", "no_ppe"]
ORGANIZED = SERVICE_ROOT / "data" / "datasets" / "organized"
MODEL_PATH = _resolve_model_path()
DEFAULT_REPORT = SERVICE_ROOT / "data" / "output" / "verification_report.json"

STREAM_URL = f"http://127.0.0.1:{os.getenv('STREAM_PORT', '8554')}"
NODE_API_URL = os.getenv("NODE_API_URL", "http://localhost:3000").rstrip("/")


@dataclass
class Result:
    name: str
    status: str
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    duration_ms: int = 0


class Suite:
    def __init__(self, skip: set[str]) -> None:
        self.skip = skip
        self.results: list[Result] = []
        self.context: dict[str, Any] = {}

    def run(self, key: str, label: str, fn: Callable[[], Result]) -> Result:
        if key in self.skip:
            result = Result(label, SKIP, "skipped on request")
            self.results.append(result)
            self._print(result)
            return result

        started = time.time()
        try:
            result = fn()
        except Exception as exc:
            result = Result(label, FAIL, f"{type(exc).__name__}: {exc}")
        result.duration_ms = int((time.time() - started) * 1000)
        self.results.append(result)
        self._print(result)
        return result

    @staticmethod
    def _print(result: Result) -> None:
        mark = {PASS: "[PASS]", FAIL: "[FAIL]", SKIP: "[SKIP]", WARN: "[WARN]"}[result.status]
        timing = f"{result.duration_ms:>5} ms" if result.duration_ms else "        "
        print(f"  {mark} {timing}  {result.name}")
        if result.message:
            print(f"                    {result.message}")
        for key, value in result.details.items():
            print(f"                    - {key}: {value}")

    @property
    def failures(self) -> list[Result]:
        return [r for r in self.results if r.status == FAIL]


# --------------------------------------------------------------------------
# 1. Environment
# --------------------------------------------------------------------------

def check_environment() -> Result:
    missing_packages = []
    versions = {}
    for module, pip_name in [
        ("cv2", "opencv-python"),
        ("numpy", "numpy"),
        ("requests", "requests"),
        ("fastapi", "fastapi"),
    ]:
        try:
            mod = __import__(module)
            versions[pip_name] = getattr(mod, "__version__", "installed")
        except ImportError:
            missing_packages.append(pip_name)

    if missing_packages:
        return Result(
            "environment", FAIL,
            f"missing packages: {', '.join(missing_packages)} - pip install -r requirements.txt",
        )

    unset = [name for name in ("CAMERA_SOURCE", "X_INTERNAL_TOKEN") if not os.getenv(name)]
    status = WARN if unset else PASS
    message = f"unset: {', '.join(unset)}" if unset else "packages and configuration present"

    return Result("environment", status, message, {
        **versions,
        "CAMERA_SOURCE": os.getenv("CAMERA_SOURCE", "(unset)"),
        "CAMERA_TYPE": os.getenv("CAMERA_TYPE", "(unset)"),
        "confidence": os.getenv("SAFETY_CONFIDENCE_THRESHOLD", "0.5"),
    })


# --------------------------------------------------------------------------
# 2. Dataset structure
# --------------------------------------------------------------------------

def check_dataset() -> Result:
    # dataset.yaml is what organize_dataset.py writes; data.yaml is accepted so a
    # dataset built by the guide's own organize_datasets.py still verifies.
    data_yaml = next(
        (p for p in (ORGANIZED / "dataset.yaml", ORGANIZED / "data.yaml") if p.exists()),
        None,
    )
    if data_yaml is None:
        return Result(
            "dataset structure", SKIP,
            "organized/dataset.yaml not found - run scripts/organize_dataset.py",
        )

    try:
        import yaml

        with open(data_yaml, encoding="utf-8") as handle:
            spec = yaml.safe_load(handle) or {}
    except ImportError:
        return Result("dataset structure", FAIL, "pyyaml is not installed")

    names = spec.get("names") or []
    if isinstance(names, dict):
        names = [names[k] for k in sorted(names, key=lambda k: int(k))]

    problems = []
    if list(names) != EXPECTED_CLASSES:
        problems.append(f"classes {list(names)} != expected {EXPECTED_CLASSES}")

    counts = {}
    for split in ("train", "val", "test"):
        images = ORGANIZED / "images" / split
        labels = ORGANIZED / "labels" / split
        n_images = len(list(images.glob("*"))) if images.exists() else 0
        n_labels = len(list(labels.glob("*.txt"))) if labels.exists() else 0
        counts[split] = f"{n_images} images / {n_labels} labels"
        if n_images != n_labels:
            problems.append(f"{split}: {n_images} images but {n_labels} labels")

    if not (ORGANIZED / "images" / "train").exists() or counts["train"].startswith("0 "):
        problems.append("train split is empty")

    # Class ids in the labels must be inside the declared range, or training
    # silently learns the wrong mapping.
    bad_ids = set()
    label_files = list((ORGANIZED / "labels" / "train").glob("*.txt"))[:200]
    for label_file in label_files:
        for line in label_file.read_text(encoding="utf-8", errors="ignore").splitlines():
            parts = line.split()
            if not parts:
                continue
            try:
                class_id = int(float(parts[0]))
            except ValueError:
                bad_ids.add(parts[0])
                continue
            if not 0 <= class_id < len(EXPECTED_CLASSES):
                bad_ids.add(str(class_id))
    if bad_ids:
        problems.append(f"out-of-range class ids in labels: {sorted(bad_ids)}")

    if problems:
        return Result("dataset structure", FAIL, "; ".join(problems), counts)
    return Result("dataset structure", PASS, f"{len(names)} classes, layout valid", counts)


# --------------------------------------------------------------------------
# 3. Camera connectivity
# --------------------------------------------------------------------------

def check_camera(source_override: str | None) -> Result:
    import cv2

    source = source_override or os.getenv("CAMERA_SOURCE")
    if not source:
        return Result("camera connectivity", SKIP, "CAMERA_SOURCE is not set")

    try:
        sys.path.insert(0, str(SERVICE_ROOT))
        from safety_stream import resolve_source

        capture_arg, source_type = resolve_source(source)
    except Exception as exc:
        return Result("camera connectivity", FAIL, f"could not resolve source: {exc}")

    capture = (
        cv2.VideoCapture(capture_arg, cv2.CAP_FFMPEG)
        if source_type in ("rtsp", "http", "file")
        else cv2.VideoCapture(capture_arg)
    )

    try:
        if not capture.isOpened():
            return Result(
                "camera connectivity", FAIL,
                f"cannot open {source!r} ({source_type}) - see TROUBLESHOOTING.md > Camera",
                {"source": source, "type": source_type},
            )

        # First reads on a network camera often fail while the stream negotiates.
        frame = None
        for _ in range(10):
            grabbed, frame = capture.read()
            if grabbed and frame is not None:
                break
            time.sleep(0.3)

        if frame is None:
            return Result("camera connectivity", FAIL, f"opened {source!r} but no frame arrived within ~3s")

        height, width = frame.shape[:2]
        fps = capture.get(cv2.CAP_PROP_FPS) or 0

        # Keep a sample so the inference check has a real frame to work with.
        sample_dir = SERVICE_ROOT / "data" / "output"
        sample_dir.mkdir(parents=True, exist_ok=True)
        sample = sample_dir / "camera_sample.jpg"
        cv2.imwrite(str(sample), frame)

        return Result("camera connectivity", PASS, f"{width}x{height} frame captured", {
            "source": source,
            "type": source_type,
            "fps_reported": round(fps, 1),
            "sample": str(sample),
        })
    finally:
        capture.release()


# --------------------------------------------------------------------------
# 4. Model loading
# --------------------------------------------------------------------------

def check_model(suite: Suite) -> Result:
    if not MODEL_PATH.exists():
        return Result(
            "model loading", SKIP,
            f"{MODEL_PATH} not found - run scripts/train_model.py",
        )

    try:
        from ultralytics import YOLO
    except ImportError:
        return Result("model loading", FAIL, "ultralytics is not installed (pip install ultralytics)")

    model = YOLO(str(MODEL_PATH))
    names = list((getattr(model, "names", {}) or {}).values())
    suite.context["model"] = model

    normalised = [str(n).strip().lower() for n in names]
    if normalised != EXPECTED_CLASSES:
        return Result(
            "model loading", WARN,
            f"model classes {names} differ from expected {EXPECTED_CLASSES} - "
            "the UI legend and violation mapping assume the expected names",
            {"size_mb": round(MODEL_PATH.stat().st_size / 1e6, 1)},
        )

    return Result("model loading", PASS, f"loaded {MODEL_PATH.name}", {
        "classes": names,
        "size_mb": round(MODEL_PATH.stat().st_size / 1e6, 1),
    })


# --------------------------------------------------------------------------
# 5. Inference
# --------------------------------------------------------------------------

def check_inference(suite: Suite) -> Result:
    model = suite.context.get("model")
    if model is None:
        return Result("yolov8 inference", SKIP, "model was not loaded")

    import cv2
    import numpy as np

    # Prefer a real frame from the camera, then any test image, then a synthetic
    # one - the last only proves the model runs, not that it detects anything.
    candidates = [SERVICE_ROOT / "data" / "output" / "camera_sample.jpg"]
    candidates += sorted((SERVICE_ROOT / "data" / "test_images").glob("*"))

    frame = None
    used = "synthetic"
    for candidate in candidates:
        if candidate.exists() and candidate.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}:
            frame = cv2.imread(str(candidate))
            if frame is not None:
                used = str(candidate)
                break

    if frame is None:
        frame = np.full((640, 640, 3), 127, dtype=np.uint8)

    threshold = float(os.getenv("SAFETY_CONFIDENCE_THRESHOLD", "0.5"))
    started = time.time()
    results = model.predict(source=frame, conf=threshold, verbose=False)[0]
    elapsed_ms = int((time.time() - started) * 1000)

    detections = []
    for box in results.boxes:
        detections.append({
            "label": str(results.names[int(box.cls)]).lower(),
            "confidence": round(float(box.conf), 3),
        })

    # Save an annotated copy so the run leaves visual evidence behind.
    output = SERVICE_ROOT / "data" / "output" / "inference_check.jpg"
    output.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(output), results.plot())

    message = f"{len(detections)} detection(s) in {elapsed_ms} ms on {Path(used).name}"
    if used == "synthetic":
        message += " (synthetic frame - zero detections is expected)"

    return Result("yolov8 inference", PASS, message, {
        "input": used,
        "threshold": threshold,
        "detections": detections[:10],
        "annotated": str(output),
    })


# --------------------------------------------------------------------------
# 6. Stream service
# --------------------------------------------------------------------------

def check_stream_service() -> Result:
    import requests

    try:
        health = requests.get(f"{STREAM_URL}/health", timeout=5)
    except requests.RequestException:
        return Result(
            "safety_stream service", SKIP,
            f"not reachable at {STREAM_URL} - start it with: python safety_stream.py",
        )

    if health.status_code != 200:
        return Result("safety_stream service", FAIL, f"/health returned {health.status_code}")

    payload = health.json()
    details = {
        "modelLoaded": payload.get("modelLoaded"),
        "defaultSource": payload.get("defaultSource"),
        "classes": payload.get("classes"),
    }

    try:
        latest = requests.get(f"{STREAM_URL}/detections/latest", timeout=20)
        if latest.status_code == 200:
            snapshot = latest.json()
            details["connected"] = snapshot.get("connected")
            details["counts"] = snapshot.get("counts")
        else:
            details["detections/latest"] = f"HTTP {latest.status_code}"
    except requests.RequestException as exc:
        details["detections/latest"] = f"failed: {exc}"

    if not payload.get("modelLoaded"):
        return Result("safety_stream service", WARN, "service is up but running without a model", details)
    return Result("safety_stream service", PASS, "healthy", details)


# --------------------------------------------------------------------------
# 7. Node API
# --------------------------------------------------------------------------

def check_node_api() -> Result:
    import requests

    try:
        health = requests.get(f"{NODE_API_URL}/api/health", timeout=5)
    except requests.RequestException:
        return Result(
            "node api", SKIP,
            f"not reachable at {NODE_API_URL} - start it with: npm run dev (in server/)",
        )

    if health.status_code != 200:
        return Result("node api", FAIL, f"/api/health returned {health.status_code}")

    token = os.getenv("X_INTERNAL_TOKEN")
    if not token:
        return Result("node api", WARN, "API is up but X_INTERNAL_TOKEN is unset, so alerts cannot be posted")

    # Deliberately invalid payload: this proves the shared secret is accepted
    # (400 = past the auth gate) without writing a bogus alert to the database.
    try:
        probe = requests.post(
            f"{NODE_API_URL}/api/internal/safety-alert",
            json={},
            headers={"X-Internal-Token": token},
            timeout=10,
        )
    except requests.RequestException as exc:
        return Result("node api", FAIL, f"internal endpoint unreachable: {exc}")

    if probe.status_code == 401:
        return Result("node api", FAIL, "X_INTERNAL_TOKEN rejected - it differs from the value in server/.env")
    if probe.status_code == 500:
        return Result("node api", FAIL, "server reports internal auth is not configured (X_INTERNAL_TOKEN unset there)")
    if probe.status_code == 400:
        return Result("node api", PASS, "reachable and internal token accepted", {"probe": "400 as expected"})
    return Result("node api", WARN, f"unexpected probe status {probe.status_code}")


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

def write_report(suite: Suite, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    summary = {status: sum(1 for r in suite.results if r.status == status) for status in (PASS, FAIL, WARN, SKIP)}
    payload = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "python": sys.version.split()[0],
        "modelPath": str(MODEL_PATH),
        "cameraSource": os.getenv("CAMERA_SOURCE"),
        "nodeApi": NODE_API_URL,
        "streamService": STREAM_URL,
        "summary": summary,
        "passed": not suite.failures,
        "checks": [asdict(r) for r in suite.results],
    }
    path.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--skip", nargs="*", default=[], metavar="CHECK",
                        help="any of: environment dataset camera model inference stream api")
    parser.add_argument("--source", help="override CAMERA_SOURCE for the camera check")
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT)
    args = parser.parse_args()

    suite = Suite(set(args.skip))

    print("=" * 72)
    print("BuildSite360 - safety detection integration test")
    print(f"  model  : {MODEL_PATH}")
    print(f"  camera : {args.source or os.getenv('CAMERA_SOURCE', '(unset)')}")
    print(f"  stream : {STREAM_URL}")
    print(f"  api    : {NODE_API_URL}")
    print("=" * 72)

    suite.run("environment", "environment", check_environment)
    suite.run("dataset", "dataset structure", check_dataset)
    suite.run("camera", "camera connectivity", lambda: check_camera(args.source))
    suite.run("model", "model loading", lambda: check_model(suite))
    suite.run("inference", "yolov8 inference", lambda: check_inference(suite))
    suite.run("stream", "safety_stream service", check_stream_service)
    suite.run("api", "node api", check_node_api)

    write_report(suite, args.report)

    counts = {status: sum(1 for r in suite.results if r.status == status) for status in (PASS, WARN, SKIP, FAIL)}
    print("=" * 72)
    print(f"  {counts[PASS]} passed, {counts[WARN]} warnings, {counts[SKIP]} skipped, {counts[FAIL]} failed")
    print(f"  report: {args.report}")
    if suite.failures:
        print("\n  Failures:")
        for result in suite.failures:
            print(f"    - {result.name}: {result.message}")
        print("\n  See TROUBLESHOOTING.md")
    print("=" * 72)

    sys.exit(1 if suite.failures else 0)


if __name__ == "__main__":
    main()
