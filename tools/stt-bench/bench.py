"""
Stage 0 STT bake-off (billing/docs/voice-order/PLAN.md). Runs LOCALLY only: voice is personal data.

  python bench.py <samples dir> <hotwords.json> <out.json> [model ...]

<samples dir>: sub-folders (or the dir itself) with audio files + labels.csv (file,said,expected).
Every model runs on every file twice: without and with warehouse hotwords.
Output JSON is scored by `npx tsx tools/stt-bench/catalogue.ts match <warehouse> <out.json>`.
"""
import csv
import json
import os
import sys
import time

import psutil
from faster_whisper import WhisperModel

DEFAULT_MODELS = [
    "yuldashev222/whisper-small-uz-v1-ct2",
    "AlexAnoshka/fast-whisper-uz-rubaistt-v2-medium-ct2",
    "hostmepanda/whisper-large-v3-turbo-uzbek-ct2",
]
# Base multilingual large-v3-turbo (language forced to uz) was tried 2026-11-23: unusable on Uzbek.
AUDIO = (".ogg", ".oga", ".opus", ".m4a", ".mp3", ".wav", ".aac", ".webm")
CPU_THREADS = 2  # production target: 2 vCPU


def load_samples(root):
    samples = []
    for folder, _, files in os.walk(root):
        if ".venv" in folder or "labels.csv" not in files:
            continue
        with open(os.path.join(folder, "labels.csv"), encoding="utf-8-sig") as f:
            labels = {row["file"]: row for row in csv.DictReader(f)}
        for name in sorted(files):
            if name.lower().endswith(AUDIO):
                row = labels.get(name, {})
                samples.append({
                    "file": os.path.relpath(os.path.join(folder, name), root),
                    "path": os.path.join(folder, name),
                    "said": row.get("said", ""),
                    "expected": row.get("expected", ""),
                })
    return samples


def save(samples, out_path):
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump([{k: v for k, v in s.items() if k != "path"} for s in samples], f, ensure_ascii=False, indent=2)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    root, hotwords_path, out_path, *models = sys.argv[1:]
    models = models or DEFAULT_MODELS
    with open(hotwords_path, encoding="utf-8") as f:
        hotwords = " ".join(json.load(f))
    samples = load_samples(root)
    for s in samples:
        s["runs"] = []
    proc = psutil.Process()

    for name in models:
        print(f"== {name}", flush=True)
        model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=CPU_THREADS)
        for s in samples:
            for use_hw in (False, True):
                started = time.perf_counter()
                segments, _ = model.transcribe(
                    s["path"],
                    language="uz",
                    beam_size=5,
                    vad_filter=True,
                    hotwords=hotwords if use_hw else None,
                )
                text = " ".join(seg.text.strip() for seg in segments).strip()
                seconds = time.perf_counter() - started
                ram = proc.memory_info().rss / 2**20
                s["runs"].append({
                    "model": name.split("/")[-1],
                    "hotwords": use_hw,
                    "text": text,
                    "seconds": round(seconds, 2),
                    "ramMb": round(ram),
                })
                print(f"  {s['file']} hw={use_hw} {seconds:.1f}s {ram:.0f}MB: {text}", flush=True)
        del model
        save(samples, out_path)  # after every model: a crash keeps finished runs


if __name__ == "__main__":
    main()
