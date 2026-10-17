# WorkSight — warehouse prototype

A working video evidence pipeline on the assigned lab VM. No model training or local GPU is required. The VM orchestrates shared GPU services. App code and persisted results are in `/home/mmiki8052/warehouse-prototype`.

The management view now centers the videos: a compact review queue, large current/reference playback, shared play/pause/seek, Scene/Person switching, a playable gallery of earlier matches and a five-clip visual history. Long reports and operational controls are collapsed under Details. The included ten-second scene is now indexed as five two-second windows; the latest window has four eligible earlier matches. These are portions of one simulated recording, not separate historical sessions. Review flags suggest a human check-in and do not diagnose wellbeing.

## Open the dashboard

On the laptop, keep an SSH tunnel running:

```powershell
ssh -N -L 18765:127.0.0.1:8765 bc-mmiki8052
```

Then open **http://127.0.0.1:18765**. The server binds only `127.0.0.1` on the VM. The tunnel must stay open. A tunnel was started during setup.

To open the project in Cursor from the laptop:

```powershell
cursor --remote ssh-remote+bc-mmiki8052 /home/mmiki8052/warehouse-prototype
```

## Start / restart on the VM

```bash
cd /home/mmiki8052/warehouse-prototype
.venv/bin/python start.py
```

`start.py` detaches the process from the SSH session and records `server.pid`; it does not install a system service. To restart, verify that the recorded PID belongs to this project's `serve.py` before stopping it, then run `start.py` again. Server logs are in `server.log`. Do not run multiple app workers: the single-worker queue deliberately limits shared GPU calls.

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Dependencies are private to `.venv`. The initial setup used Python's `venv --without-pip` and the official `https://bootstrap.pypa.io/pip/pip.pyz` because Ubuntu's ensurepip is unavailable. No apt/system package installation. `requirements.txt` describes runtime requirements; `requirements.lock` records the tested full environment. Supervision is pinned to 0.26.1 because later releases removed its ByteTrack API ([official versioned reference](https://supervision.roboflow.com/0.26.1/trackers/)). FFmpeg/FFprobe are preinstalled on the VM.

## Pipeline

1. **Import** the assigned warehouse sample from the workshop library, or upload a 1–30 second MP4 (80 MB maximum) with a real capture timestamp and task label. Exact duplicates are rejected. Original source and normalized context are preserved.
2. **Detect** people with the shared YOLO11s service after standardizing to 30 fps and at most 1280×720. Detector frame indices therefore match video timestamps.
3. **Track** with real ByteTrack on the CPU. A track ID is valid inside one recording only. Up to four tracks with at least 1.5 seconds and 60% observed-frame coverage are processed. No cross-camera identity inference.
4. **Crop** non-overlapping windows of at most five seconds. Each fixed crop covers that track's observed path with padding; it can include other people or objects. Windows with insufficient detections abstain. The full scene is retained alongside every crop. FFmpeg writes standard H.264 seekable MP4s, not fragmented MP4s.
5. **Embed** each crop using `nvidia/cosmos-embed1`. Validate and normalize its 256D vector; save it in SQLite with worker/track, recording, task, time, source and visibility metadata.
6. **Retrieve** only earlier, non-overlapping windows of the same task. Inside one recording, the same continuous ByteTrack ID is eligible. Across recordings, both identities must be human-confirmed with the same worker ID, and real capture times are required. Only then rank candidates by exact cosine similarity. This intentionally small prototype uses a local vector index; the shared corpus has no persistent worker IDs suitable for this filter.
7. **Reason** with `nvidia/cosmos3-nano-reasoner`: assemble one video containing earlier crop, current crop and current scene. The service accepts one video per prompt. Require structured JSON describing observable changes, task alternatives, limitations and an unvalidated review suggestion. Invalid model output fails the job; it is never recorded as a successful comparison.
8. **Review** the source evidence, model observations and timeline. Confirm a worker/task mapping when independently known, then recompute. Changing a mapping invalidates affected reports. Save a human review note. No emails or automatic management alerts are sent.

The first window establishes a baseline and makes no change claim. A later window without an eligible reference also abstains. Similarity is a retrieval score, not health confidence. Credentials come only from `/config/team-2.config`, stay in server memory and are never sent to the browser. Failed/interrupted jobs cannot appear completed.

## What the included demo proves

The supplied sample is a **10-second simulated warehouse recording**, not a months-long construction dataset. The initial real run processed 300 frames, kept one track at 99% observed-frame coverage, generated two five-second person crops, stored two 256D embeddings, retrieved the earlier crop, and obtained a valid Cosmos comparison. The full job took about 10.2 seconds on the tested VM and shared services; latency will vary with shared load.

It proves service integration and a within-recording evidence workflow. It does **not** validate wellbeing, emotion, fatigue, true worker identity or long-term change. A model can misdescribe visible actions. A reviewer must inspect the footage. Demo recordings without real capture dates are explicitly excluded from cross-recording historical retrieval even if someone labels a worker ID.

For actual longitudinal use, supply repeated recordings with trustworthy timestamps, task labels and independently confirmed worker mappings. The other dataset search can feed that path later. This is a short-clip hackathon prototype, not a continuous camera ingestion or production monitoring system.

## Files and routes

`warehouse/core.py`: filters and validation; `tracking.py`: ByteTrack; `media.py`: FFmpeg; `services.py`: workshop clients; `pipeline.py`: jobs and orchestration; `store.py`: SQLite; `app.py`: API; `static/`: browser UI. Generated videos, vectors and metadata live in ignored `data/`. A public state response excludes raw vectors and frame-level boxes. Media routes prevent directory traversal. API mutations require same-origin browser requests; the server is local to the VM.

Useful endpoints: `GET /api/state`, `GET /api/health`, `POST /api/sample`, `POST /api/upload`, `POST /api/tracks/{id}/identity`, `POST /api/tracks/{id}/compare`, `POST /api/analyses/{id}/review`. Machine-readable API schema: `/openapi.json`. No external scripts or CDN assets are needed for the dashboard.

Dashboard logic regressions can also be run with Node 20+ on a development laptop: `node tests/test_dashboard.cjs`. Node is not required on the VM. The browser layout was not visually inspected because the user stopped Windows Computer Use; API responses, video streaming, JavaScript syntax and the dashboard state transitions were checked separately.
