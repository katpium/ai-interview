"""
AI Model API Server (Server 1)
Exposes local TTS and STT models as HTTP API endpoints.
"""

import hashlib
import os
import time
import uuid
from contextlib import asynccontextmanager

import soundfile as sf
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel


# --- Storage folder setup ---
STORAGE_TTS = "storage/tts"
STORAGE_UPLOADS = "storage/uploads"
os.makedirs(STORAGE_TTS, exist_ok=True)
os.makedirs(STORAGE_UPLOADS, exist_ok=True)


# --- Model config ---
TTS_MODEL_NAME = "Kokoro-82M (kokoro-onnx)"
TTS_MODEL_PATH = os.path.join("models", "kokoro", "kokoro-v1.0.onnx")
TTS_VOICES_PATH = os.path.join("models", "kokoro", "voices-v1.0.bin")
STT_MODEL_SIZE = os.getenv("WHISPER_MODEL", "base")
STT_MODEL_NAME = f"whisper-{STT_MODEL_SIZE}"
TTS_SAMPLE_RATE = 24000


# --- Global model holders loaded once at startup ---
tts_model = None
stt_model = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load ML models once at startup, not on every request."""
    global tts_model
    global stt_model

    print("Loading TTS model...")
    from kokoro_onnx import Kokoro

    tts_model = Kokoro(TTS_MODEL_PATH, TTS_VOICES_PATH)
    print(f"TTS model loaded. Voices: {tts_model.get_voices()}")

    print(f"Loading STT model: Whisper {STT_MODEL_SIZE}...")
    import whisper

    stt_model = whisper.load_model(STT_MODEL_SIZE)
    print("STT model loaded.")

    yield


# --- App setup ---
app = FastAPI(
    title="AI Interview Model API",
    version="1.1.0",
    lifespan=lifespan,
)


# CORS for development.
# Server 2 calls this API, but allowing localhost frontend origins is useful for testing.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# Serve generated TTS audio files at /audio/tts/<filename>
app.mount("/audio/tts", StaticFiles(directory=STORAGE_TTS), name="tts_audio")


# ============================================================
# Helpers
# ============================================================
def make_tts_cache_key(text: str, voice: str, speed: float) -> str:
    """
    Create a stable cache key from text + voice + speed.

    If the same text, voice, and speed are requested again,
    we reuse the same generated audio file instead of regenerating it.
    """
    normalized = f"{text.strip()}|{voice.strip()}|{speed:.2f}"
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


# ============================================================
# GET /health — Basic health check
# ============================================================
@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "tts_ready": tts_model is not None,
        "stt_ready": stt_model is not None,
        "tts_model": TTS_MODEL_NAME,
        "stt_model": STT_MODEL_NAME,
        "tts_cache_enabled": True,
    }


# ============================================================
# POST /api/tts — Generate speech audio from text
# ============================================================
class TTSRequest(BaseModel):
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


@app.post("/api/tts")
def text_to_speech(req: TTSRequest):
    total_start = time.perf_counter()

    # Validate input before calling model
    if not req.text or not req.text.strip():
        raise HTTPException(
            status_code=400,
            detail="Text is required and cannot be empty.",
        )

    if not (0.1 <= req.speed <= 3.0):
        raise HTTPException(
            status_code=400,
            detail="Speed must be between 0.1 and 3.0.",
        )

    if tts_model is None:
        raise HTTPException(
            status_code=503,
            detail="TTS model is not loaded yet.",
        )

    try:
        # Cache filename is based on text + voice + speed
        cache_key = make_tts_cache_key(req.text, req.voice, req.speed)
        filename = f"{cache_key}.wav"
        filepath = os.path.join(STORAGE_TTS, filename)

        # Cache hit: return existing file immediately
        if os.path.exists(filepath):
            total_time = time.perf_counter() - total_start
            print(
                f"[TTS CACHE HIT] text_length={len(req.text)} "
                f"voice={req.voice} speed={req.speed} "
                f"total={total_time:.3f}s"
            )

            return {
                "audio_url": f"/audio/tts/{filename}",
                "filename": filename,
                "cached": True,
            }

        # Generate audio
        generate_start = time.perf_counter()
        audio, sample_rate = tts_model.create(
            req.text,
            voice=req.voice,
            speed=req.speed,
        )
        generate_time = time.perf_counter() - generate_start

        # Save audio
        save_start = time.perf_counter()
        sf.write(filepath, audio, sample_rate)
        save_time = time.perf_counter() - save_start

        total_time = time.perf_counter() - total_start

        print(
            f"[TTS GENERATED] text_length={len(req.text)} "
            f"voice={req.voice} speed={req.speed} "
            f"generate={generate_time:.3f}s "
            f"save={save_time:.3f}s "
            f"total={total_time:.3f}s"
        )

        return {
            "audio_url": f"/audio/tts/{filename}",
            "filename": filename,
            "cached": False,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"TTS generation failed: {str(e)}",
        )


# ============================================================
# POST /api/tts/preload — Generate/cache multiple TTS files
# Optional helper for Server 2
# ============================================================
class TTSPreloadItem(BaseModel):
    id: int | str
    text: str
    voice: str = "af_heart"
    speed: float = 1.0


class TTSPreloadRequest(BaseModel):
    items: list[TTSPreloadItem]


@app.post("/api/tts/preload")
def preload_tts(req: TTSPreloadRequest):
    """
    Pre-generate multiple TTS files.

    Server 2 can call this before or during an interview so the candidate
    does not wait for audio generation between questions.
    """
    results = []

    for item in req.items:
        result = text_to_speech(
            TTSRequest(
                text=item.text,
                voice=item.voice,
                speed=item.speed,
            )
        )

        results.append(
            {
                "id": item.id,
                "audio_url": result["audio_url"],
                "filename": result["filename"],
                "cached": result.get("cached", False),
            }
        )

    return {
        "items": results,
    }


# ============================================================
# POST /api/stt — Transcribe uploaded audio using Whisper
# ============================================================
@app.post("/api/stt")
async def speech_to_text(file: UploadFile = File(...)):
    total_start = time.perf_counter()

    # Validate file was provided
    if not file or not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Audio file is required.",
        )

    # Validate file has content
    contents = await file.read()
    if len(contents) == 0:
        raise HTTPException(
            status_code=400,
            detail="Uploaded file is empty.",
        )

    if stt_model is None:
        raise HTTPException(
            status_code=503,
            detail="STT model is not loaded yet.",
        )

    # Save uploaded file to storage/uploads/ with UUID prefix
    ext = os.path.splitext(file.filename)[1] or ".webm"
    saved_filename = f"{uuid.uuid4()}{ext}"
    filepath = os.path.join(STORAGE_UPLOADS, saved_filename)

    save_start = time.perf_counter()
    with open(filepath, "wb") as f:
        f.write(contents)
    save_time = time.perf_counter() - save_start

    try:
        # Transcribe using Whisper
        transcribe_start = time.perf_counter()
        result = stt_model.transcribe(filepath)
        transcribe_time = time.perf_counter() - transcribe_start

        transcript = result.get("text", "").strip()
        total_time = time.perf_counter() - total_start

        print(
            f"[STT] filename={file.filename} "
            f"bytes={len(contents)} "
            f"save={save_time:.3f}s "
            f"transcribe={transcribe_time:.3f}s "
            f"total={total_time:.3f}s"
        )

        return {
            "transcript": transcript,
            "filename": saved_filename,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Transcription failed: {str(e)}",
        )