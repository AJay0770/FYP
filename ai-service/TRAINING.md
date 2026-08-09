# AI Model Training & Validation

Covers the two AI components: YOLOv8 PPE detection and ArcFace facial recognition.

> **Status: code complete, results not yet recorded.**
>
> Every table below marked `NOT YET MEASURED` is waiting on a training/validation run
> that has not happened yet. Those runs need credentials and data that aren't in this
> repo (see [Blockers](#blockers)). **Do not fill these in with numbers from a paper,
> a blog post, or another project's results** — the entire purpose of this file is to
> record what *this* model achieved on *this* data. Unverified numbers here would be
> worse than no numbers, because downstream safety and attendance decisions get made
> on the assumption these were measured.

---

## Part A — YOLOv8 PPE Detection

Detects two classes: `helmet` and `vest`.

### Pipeline

| Stage | Where |
|---|---|
| Training | [`notebooks/yolov8_training.ipynb`](notebooks/yolov8_training.ipynb) (Google Colab, GPU runtime) |
| Inference test | [`scripts/test_yolov8.py`](scripts/test_yolov8.py) |
| Trained weights | `models/best.pt` — **not yet produced** |

### Dataset sources

| Field | Value |
|---|---|
| Primary source | Roboflow Universe, construction-site PPE dataset (exact workspace/project/version set in notebook cell 3) |
| Train / val / test counts | `NOT YET RECORDED` — the notebook prints these |
| Original class list | `NOT YET RECORDED` — varies by dataset; notebook prints it |
| Classes after remap | `helmet`, `vest` |

Public PPE datasets typically ship more than two classes (`helmet`, `no-helmet`, `head`,
`person`, `vest`, ...). The notebook remaps them down to the two this project needs via
`CLASS_MAP` and drops the rest. **Verify the printed class list matches your `CLASS_MAP`
before training** — a silent mismatch there produces a model that trains happily and
detects the wrong things.

### Training parameters

Set in the notebook; recorded here so the run is reproducible.

| Parameter | Value | Why |
|---|---|---|
| Base weights | `yolov8s.pt` (COCO-pretrained) | |
| Epochs | 100 (early stop, patience 20) | |
| Image size | 640 | |
| Batch | 16 | Fits a 16GB T4; reduce to 8 on a 6GB card |
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

| Metric | Value |
|---|---|
| mAP@0.5 | `NOT YET MEASURED` |
| mAP@0.5:0.95 | `NOT YET MEASURED` |
| Precision | `NOT YET MEASURED` |
| Recall | `NOT YET MEASURED` |
| helmet mAP@0.5 | `NOT YET MEASURED` |
| vest mAP@0.5 | `NOT YET MEASURED` |

Notebook section 5 prints all of these on the held-out test split. Copy them here verbatim.

### Sample inference results

`NOT YET RUN` — needs `models/best.pt` plus images in `data/test_images/`.

```bash
python scripts/test_yolov8.py --conf 0.35
```

Writes annotated images to `data/output/` and prints per-detection class, confidence,
and box coordinates.

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
