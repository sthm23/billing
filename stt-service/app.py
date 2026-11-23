"""
Order assistant speech-to-text (billing/docs/voice-order/DESIGN.md §6, STT_SERVICE.md).

Local HTTP service for the NestJS backend only: bind it to 127.0.0.1. One transcription at a
time (CPU), up to QUEUE_SIZE requests wait, the rest get 429. Audio is never written to disk.

  POST /transcribe  multipart `audio` → {"text": "...", "durationMs": 14200}
  GET  /health      → {"status": "ok", "model": "..."}

Env: STT_MODEL, STT_THREADS (2), STT_QUEUE_SIZE (3), STT_MAX_SECONDS (65), STT_MAX_BYTES (3 MB).
"""
import asyncio
import io
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from faster_whisper import WhisperModel
from faster_whisper.audio import decode_audio

MODEL = os.getenv("STT_MODEL", "AlexAnoshka/fast-whisper-uz-rubaistt-v2-medium-ct2")
THREADS = int(os.getenv("STT_THREADS", "2"))
QUEUE_SIZE = int(os.getenv("STT_QUEUE_SIZE", "3"))
MAX_SECONDS = float(os.getenv("STT_MAX_SECONDS", "65"))
MAX_BYTES = int(os.getenv("STT_MAX_BYTES", str(3 * 1024 * 1024)))
SAMPLE_RATE = 16000

log = logging.getLogger("stt")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

model: WhisperModel | None = None
lock = asyncio.Lock()
pending = 0  # running + waiting


@asynccontextmanager
async def lifespan(_: FastAPI):
    global model
    started = time.perf_counter()
    model = await asyncio.to_thread(
        WhisperModel, MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS
    )
    log.info("model %s loaded in %.1fs", MODEL, time.perf_counter() - started)
    yield


app = FastAPI(title="sthm-stt", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)


@app.get("/health")
def health() -> dict:
    return {"status": "ok" if model else "loading", "model": MODEL}


def max_tokens(duration: float) -> int:
    """Tokens per 30 s window: generous for dictation, stops a repeat loop early.
    Whisper's limit is 448 per window including the prompt."""
    return int(min(400, 20 + 12 * min(duration, 30)))


def transcribe_sync(data: bytes) -> tuple[str, int]:
    try:
        audio = decode_audio(io.BytesIO(data), sampling_rate=SAMPLE_RATE)
    except Exception as error:  # not an audio file PyAV can read
        raise HTTPException(422, "Audio could not be decoded") from error
    duration = len(audio) / SAMPLE_RATE
    if duration > MAX_SECONDS:
        raise HTTPException(413, f"Audio is longer than {MAX_SECONDS:.0f} s")
    # Settings chosen in the stage 0 bake-off: no hotwords (they broke the output).
    # No temperature fallback + a token cap: on short / unclear audio the fallback
    # re-decoded up to 6 times with runaway repeats — 2.7 s of speech took 135–158 s
    # (past the backend timeout). Same text on the bake-off dictations, faster.
    segments, _ = model.transcribe(
        audio,
        language="uz",
        beam_size=5,
        vad_filter=True,
        temperature=0.0,
        condition_on_previous_text=False,
        max_new_tokens=max_tokens(duration),
    )
    text = " ".join(s.text.strip() for s in segments).strip()
    return text, round(duration * 1000)


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)) -> dict:
    global pending
    if model is None:
        raise HTTPException(503, "Model is loading")
    if pending >= 1 + QUEUE_SIZE:
        raise HTTPException(429, "Speech recognition is busy")
    data = await audio.read(MAX_BYTES + 1)
    if not data:
        raise HTTPException(422, "Empty audio")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Audio file is too large")

    pending += 1
    try:
        async with lock:
            started = time.perf_counter()
            text, duration_ms = await asyncio.to_thread(transcribe_sync, data)
            # Stats only — never the text (personal data)
            log.info("transcribed %d ms of audio in %.1fs, %d chars", duration_ms,
                     time.perf_counter() - started, len(text))
    finally:
        pending -= 1

    if not text:
        raise HTTPException(422, "Speech not recognized")
    return {"text": text, "durationMs": duration_ms}
