# AI Model Training & Validation

Covers the two AI components: YOLOv8 PPE detection and ArcFace facial recognition.

> **Status: Part A (YOLOv8 PPE detection) trained and measured 2026-09-10. Part B
> (ArcFace) still has no results — see its section below.**
>
> Tables still marked `NOT YET MEASURED` are waiting on a run that has not happened
> yet. **Do not fill these in with numbers from a paper, a blog post, or another
> project's results** — the entire purpose of this file is to record what *this*
> model achieved on *this* data. Unverified numbers here would be worse than no
> numbers, because downstream safety and attendance decisions get made on the
> assumption these were measured.

---

## Part A — YOLOv8 PPE Detection

Detects three classes: `helmet`, `vest`, `head`. (Originally scoped as two classes,
`helmet`/`vest` — see "Why three classes, not two" below for why `head` was kept.)

### Pipeline

| Stage | Where |
|---|---|
| Training | `scripts/validate_dataset.py` (pre-flight check) then the `yolo` CLI directly — see [Training run log](#training-run-log) below. `notebooks/yolov8_training.ipynb` was the originally planned path but wasn't used for this run. |
| Class-mapping sanity check | [`scripts/inspect_classes.py`](scripts/inspect_classes.py) — draws ground-truth boxes per raw class id onto sample images so a human confirms what each id actually depicts, before spending GPU time training on a possibly-wrong mapping |
| Resume after interruption | [`scripts/resume_training.py`](scripts/resume_training.py) — see [Interruption and resume](#interruption-and-resume) |
| Inference test | [`scripts/test_yolov8.py`](scripts/test_yolov8.py) |
| Trained weights | `models/best.pt` — **produced, ~21.5 MB** |

### Dataset sources

| Field | Value |
|---|---|
| Location | `C:\Projects\FYP\Dataset` (pre-split YOLO format; not copied into `ai-service/data/` — 22k images, kept in place to avoid doubling disk usage) |
| Train / val / test counts | 17,248 / 2,438 / 2,455 images |
| Raw class ids in the label files | `0`, `1`, `2` (a 4th name, `person`, is listed in `labels/classes.txt` but has zero instances anywhere in this dataset) |
| Classes used for training | `0: helmet`, `1: vest`, `2: head` |

### Why three classes, not two

This dataset was not produced by the notebook's Roboflow/`CLASS_MAP` remap pipeline
described above — it's a separate, pre-organized 22k-image set that still carries its
original 3-class labeling. Before trusting `labels/classes.txt`'s stated order, each
class id was visually verified with `scripts/inspect_classes.py` (ground-truth boxes
drawn on real sample images, not inferred from box-size statistics alone) — this
confirmed **class 2 ("head") is a bare head with no helmet on it**, i.e. it is already
an explicit negative signal for the `NO_HELMET` violation, not a fourth unrelated
concept. That directly resolves half of the ambiguity flagged elsewhere in this
codebase (`services/safety_detector.py`'s docstring, option "retrain with explicit
negative classes"): a `head` detection on its own can be read as a helmet violation
without needing person-containment logic. The same is not yet true for vests — there is
no explicit `no-vest`/bare-torso class in this data, so inferring a vest violation still
needs a `person` class this dataset doesn't have populated. Training on all three
available classes uses strictly more of the labeled signal than artificially discarding
`head` to force the originally-planned two-class model, and was the deliberate choice
here given the goal was best achievable accuracy.

Public PPE datasets typically ship more than two classes (`helmet`, `no-helmet`, `head`,
`person`, `vest`, ...). **Whatever the source, verify the printed/visually-checked class
list actually matches what you assume before training** — a silent mismatch there
produces a model that trains happily and detects the wrong things.

### Training parameters

As originally specified below, with one change: **batch 4, not 16.** This ran on a
local RTX 3070 (8GB VRAM), not the 16GB T4 the original guidance assumed. Batch 8 was
tried first and looked fine initially, but GPU memory climbed steadily over ~600
iterations until the CUDA allocator started thrashing (iteration time went from ~0.35s
to 30s+). Batch 4 stayed flat at ~5.6-6GB for the full run.

| Parameter | Value | Why |
|---|---|---|
| Base weights | `yolov8s.pt` (COCO-pretrained) | |
| Epochs | 100 (early stop, patience 20) | |
| Image size | 640 | |
| Batch | **4** (not 16 — see above) | Fits a 16GB T4; reduce to 8 on a 6GB card; reduce further on 8GB if memory climbs during the run |
| Optimizer | AdamW | |
| `lr0` / `lrf` | 0.001 / 0.01 | cosine decay to lr0×lrf |
| Warmup | 3 epochs | |
| Weight decay | 0.0005 | |
| Seed | 42 | |

Augmentation, chosen for outdoor/dusty site conditions:

| Parameter | Value | Rationale |
|---|---|---|
| `hsv_v` | 0.4 | harsh sun through overcast; dust haze washes out value |
| `hsv_s` | 0.7 | dust desaturates; hi-vis vests must stay detectable |
| `hsv_h` | 0.015 | small — hue is the main signal for a hi-vis vest, so don't destroy it |
| `degrees` | 10.0 | pole/corner-mounted cameras see workers off-axis |
| `perspective` | 0.0005 | same reason, mild keystoning |
| `scale` | 0.5 | fixed camera, workers at widely varying distance |
| `translate` | 0.1 | subject not centered |
| `fliplr` | 0.5 | no left/right bias on a site |
| `flipud` | 0.0 | **off** — workers are upright; vertical flips teach nothing real |
| `mosaic` | 1.0, off for last 10 epochs | helps small objects (distant helmets); disabled late to stabilise |

### Results

Measured 2026-09-10 with `yolo task=detect mode=val model=models/best.pt` against the
**test** split (2,455 images, held out from both training and the val-based checkpoint
selection during training). Ultralytics 8.0.0's validator has no `split=` CLI flag, so
this used a second config (`data/dataset_test_eval.yaml`) that points its `val:` key at
the test images — training itself used the real `data/dataset.yaml`.

| Metric | Value |
|---|---|
| mAP@0.5 | 0.891 |
| mAP@0.5:0.95 | 0.522 |
| Precision | 0.876 |
| Recall | 0.846 |
| helmet mAP@0.5 | 0.908 |
| vest mAP@0.5 | 0.862 |
| head mAP@0.5 | 0.905 |

Per-class precision/recall, for reference:

| Class | Precision | Recall | mAP@0.5 | mAP@0.5:0.95 |
|---|---|---|---|---|
| helmet | 0.917 | 0.851 | 0.908 | 0.577 |
| vest | 0.824 | 0.789 | 0.862 | 0.512 |
| head | 0.889 | 0.898 | 0.905 | 0.477 |

`best.pt` is the checkpoint from **epoch 46**, not the final epoch — see below.

### Interruption and resume

This run was interrupted (unattended machine, no UPS, likely a power outage) after
completing epoch 46 of 100, with metrics already strong at that point (val mAP@0.5
0.884, recall 0.847). `scripts/resume_training.py` was written specifically to make
recovering from exactly this kind of interruption a single command rather than a
restart from scratch — see its docstring for the two real bugs in this pinned
`ultralytics==8.0.0` it has to work around (a bare `resume=<path>` silently discards
every other CLI override, and `Model.train()` derives the resume checkpoint from
whatever `model=` you pass, so replaying the original `model=yolov8s.pt` redirects the
resume lookup to the wrong file).

The resume itself succeeded mechanically — training correctly continued from epoch 47
using the checkpoint's weights, optimizer state, and epoch count — but something in
this version's LR-schedule continuation caused a training collapse right at the resume
boundary: val mAP@0.5 dropped from 0.884 (epoch 44) to essentially zero (0.0002) by
epoch 49, and only partially recovered by epoch 99 (mAP@0.5 0.663), never regaining
epoch 46's level. **This is a plausible bug in ultralytics 8.0.0's resume path, not
something this project's config caused** — but it was not root-caused further here.

None of this reached the deployed model: Ultralytics tracks `best_fitness` across
resume (loaded from the checkpoint), so `best.pt` was never overwritten by the
post-collapse, worse-performing epochs and still holds the epoch-46 weights. This was
confirmed by directly validating `best.pt` (not assumed from file metadata) — the
Results table above is that validation. `last.pt` (epoch 99) is the degraded model and
should not be used.

**Practical takeaway for next time**: if this pipeline is ever interrupted and resumed
again on this ultralytics version, validate `best.pt` against the test set immediately
after the resumed run finishes, rather than assuming the final epoch is the best one.

### Sample inference results

Run 2026-09-10 against 7 real images from the test split (`data/test_images/`):

```bash
python scripts/test_yolov8.py --model models/best.pt --conf 0.35
```

31 detections across 7 images, all visually correct on inspection (tight boxes,
correct class per object — helmets on hard-hatted heads, `head` on bare heads, `vest`
on hi-vis torsos). Annotated images written to `data/output/`.

Note: `scripts/test_yolov8.py` needed a fix to run at all under `ultralytics==8.0.0` —
this version predates the `Results`/`Boxes` object model (no `result.boxes`,
`result.names`, `result.save()`); `predict()` here returns a plain list of `[N, 6]`
tensors (`x1, y1, x2, y2, conf, cls`) per image, and class names live on
`model.model.names`, not on the `YOLO` wrapper. The script now handles that directly
with OpenCV instead of the newer Results API.

### A note on expected file size

A fine-tuned **YOLOv8s** checkpoint is **~22 MB** (11.2M parameters). It will not exceed
100 MB. For reference: YOLOv8m ≈ 52 MB, YOLOv8l ≈ 87 MB, YOLOv8x ≈ 130 MB.

If a spec or checklist expects `best.pt > 100 MB`, that expectation doesn't match the
YOLOv8s architecture this pipeline trains — either the target is a much larger variant,
or the size figure is mistaken. **File size is not a proxy for model quality.** Judge the
model on the mAP table above.

---

## Part B — ArcFace Facial Recognition

Worker enrolment and 1:N check-in matching for site attendance.

### Pipeline

| Stage | Where |
|---|---|
| Enrolment | [`scripts/enroll_worker.py`](scripts/enroll_worker.py) |
| Matching | [`scripts/match_face.py`](scripts/match_face.py) |
| Stored embeddings | `models/embeddings/{worker_id}.json` |

Enrolment averages ArcFace embeddings over ~10 photos, L2-normalising each before
averaging and re-normalising the centroid, so cosine similarity reduces to a dot product
at match time. It also records `selfSimilarityMin/Mean` — the spread of the enrolment
photos around their own centroid — which flags a photo set that accidentally mixes people.

### Threshold: the 0.68 problem

**This needs a decision before deployment.**

`match_face.py` scores with cosine **similarity** in `[-1, 1]` (higher = more alike) and
matches when `similarity >= threshold`. The default is `0.68`, as specified.

However, DeepFace's own published ArcFace threshold of `0.68` is a cosine **distance**,
where `distance = 1 - similarity` and *lower* means more alike. So:

| Interpretation | Match condition | Equivalent similarity |
|---|---|---|
| DeepFace's published default (distance) | `distance < 0.68` | `similarity > 0.32` |
| This script's default as written (similarity) | `similarity >= 0.68` | `similarity >= 0.68` |

**These are not the same threshold.** `0.68` as a similarity is roughly twice as strict as
DeepFace's documented default.

Being stricter is a defensible choice here: it biases toward **false rejects** (a worker is
turned away and re-scans) over **false accepts** (one worker checks in as another, corrupting
attendance and payroll, and defeating the point of biometric check-in). For an attendance
system the false-accept direction is clearly the more damaging error.

But "defensible in principle" is not "validated". Too strict a threshold produces constant
re-scans, workers get frustrated, and someone disables the check entirely — a failure mode
that ends with *worse* security than a correctly-tuned threshold. **Pick the final value from
the measured sweep below, not from either default.**

### Validation results

| Measurement | Value |
|---|---|
| Workers enrolled | `NOT YET MEASURED` |
| Photos per worker | `NOT YET MEASURED` |
| Genuine-pair similarity (mean / min) | `NOT YET MEASURED` |
| Impostor-pair similarity (mean / max) | `NOT YET MEASURED` |
| False accept rate @ 0.68 | `NOT YET MEASURED` |
| False reject rate @ 0.68 | `NOT YET MEASURED` |
| Equal error rate threshold | `NOT YET MEASURED` |
| **Recommended production threshold** | `NOT YET DETERMINED` |

Per-condition breakdown:

| Condition | Genuine mean | False reject rate |
|---|---|---|
| Bright/direct sun | `NOT YET MEASURED` |
| Overcast | `NOT YET MEASURED` |
| Low light / dusk | `NOT YET MEASURED` |
| Backlit | `NOT YET MEASURED` |
| Hard hat + safety glasses worn | `NOT YET MEASURED` |
| Dust/partial occlusion | `NOT YET MEASURED` |

The hard-hat row matters more than it looks: workers will be wearing PPE at check-in, which
occludes the hairline and forehead that face embeddings partly rely on. Enrolment photos
should include hard-hat-on shots, or the genuine-pair scores at the gate will sit well below
what clean enrolment photos predict.

### How to run this validation

1. Enrol each worker from their photo set:
   ```bash
   python scripts/enroll_worker.py --worker-id <id> --photos data/workers/<id>/
   ```
2. For **genuine** pairs, match held-out photos of enrolled workers — every result *should*
   match the correct id. Record the similarity scores.
3. For **impostor** pairs, match photos of people who are *not* enrolled — every result
   *should* return no match. Record the highest similarity each produces.
4. Sweep the threshold across the range where those two distributions overlap; pick the value
   that meets the project's tolerance for each error type. Record it above.

Impostor testing is the step most often skipped and the one that actually catches a bad
threshold — genuine-only testing will happily validate a threshold that also accepts strangers.

---

## Blockers

Neither model has been trained or validated. What's missing:

| Blocker | Blocks | Detail |
|---|---|---|
| Kaggle + Roboflow API credentials | YOLOv8 training | Notebook needs both to download datasets. Not in repo (correctly — they're secrets). |
| Worker photo dataset | Face validation | Requires real photos of real people. See consent note below. |
| `deepface` cannot install | Both face scripts | This machine runs **Python 3.14**; `deepface` requires TensorFlow, which publishes no 3.14 wheels. Needs a Python 3.10/3.11 environment. `torch`/`ultralytics` *do* work on 3.14 (via newer versions than `requirements.txt` pins). |

### On the face-recognition test data

Validating this properly needs real photographs of real, identifiable people, and the
resulting embeddings are biometric data. That's a normal, legitimate part of shipping a
workplace attendance system — but the photos need to come from actual enrolled workers (or
consenting volunteers) under whatever consent and data-retention rules apply in the
deployment jurisdiction. Scraped or third-party face images would make the measured numbers
meaningless *and* create a compliance problem, so this validation is deliberately left for
someone with access to a legitimate enrolment set.

Worth confirming before launch: how long embeddings are retained, what happens to them when
a worker leaves, and whether workers are told their face data is being stored.
