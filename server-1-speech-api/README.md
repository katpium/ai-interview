# AI Model API Server (Server 1)

Private/internal API server that exposes local TTS and STT models as HTTP endpoints.

**This is not a website.** Server 2 (the interview website) will call this server whenever it needs text-to-speech or speech-to-text.

## Architecture

```
Candidate Browser
  → Server 2: Interview Website (port 3000)
    → Server 1: AI Model API (port 8000)
  → Server 2
→ Candidate Browser
```

- Server 1 listens on `0.0.0.0:8000`
- Server 2 calls Server 1 using `MODEL_API_BASE_URL=http://SERVER_1_IP:8000`
- The candidate browser never calls Server 1 directly

## System Dependencies

**ffmpeg** is required for Whisper audio processing.

Ubuntu:
```bash
sudo apt update
sudo apt install ffmpeg
```

macOS:
```bash
brew install ffmpeg
```

## Python Setup

Requires Python 3.11.

```bash
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

## Download TTS Model

Kokoro TTS requires model files downloaded separately:

```bash
mkdir -p models/kokoro
curl -L -o models/kokoro/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/kokoro/voices-v1.0.bin https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

## Run Server

```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

To use a larger Whisper model for better accuracy:
```bash
WHISPER_MODEL=small uvicorn main:app --host 0.0.0.0 --port 8000
```

Available Whisper models: `tiny`, `base`, `small`, `medium`, `large`

If `WHISPER_MODEL` is not set, defaults to `base`.

On startup, the server loads both models into memory:
- **TTS:** Kokoro-82M (kokoro-onnx)
- **STT:** Whisper (configurable via WHISPER_MODEL env var)

This takes ~10-15 seconds. Once you see `Application startup complete`, the server is ready.

## API Endpoints

### GET /health

Check if the server and models are ready.

```bash
curl http://localhost:8000/health
```

Response:
```json
{
  "status": "ok",
  "tts_ready": true,
  "stt_ready": true,
  "tts_model": "Kokoro-82M (kokoro-onnx)",
  "stt_model": "whisper-small"
}
```

### POST /api/tts

Generate speech audio from text. Server 2 calls this to produce interview question audio.

```bash
curl -X POST http://localhost:8000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Welcome to your AI interview.","voice":"af_bella","speed":1.0}'
```

Request body:
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| text | string | required | Text to convert to speech |
| voice | string | "af_bella" | Voice name (e.g. af_bella, am_adam, af_heart) |
| speed | float | 1.0 | Speed (0.1 to 3.0) |

Response:
```json
{
  "audio_url": "/audio/tts/a1b2c3d4-e5f6-7890-abcd-ef1234567890.wav",
  "filename": "a1b2c3d4-e5f6-7890-abcd-ef1234567890.wav"
}
```

The generated audio file is playable at:
```
http://localhost:8000/audio/tts/<filename>
```

### POST /api/stt

Transcribe uploaded audio. Server 2 calls this to convert candidate answer recordings into text.

```bash
curl -X POST http://localhost:8000/api/stt \
  -F "file=@sample.webm"
```

Request: `multipart/form-data` with field name `file`.

Response:
```json
{
  "transcript": "The candidate answer transcript goes here.",
  "filename": "a1b2c3d4-e5f6-7890-abcd-ef1234567890.webm"
}
```

## How Server 2 Will Call This API

Server 2 should set the environment variable:
```
MODEL_API_BASE_URL=http://SERVER_1_IP:8000
```

Example calls from Server 2 (Python):
```python
import requests

MODEL_API = "http://SERVER_1_IP:8000"

# Check if Server 1 is ready
health = requests.get(f"{MODEL_API}/health").json()

# Generate question audio
tts = requests.post(f"{MODEL_API}/api/tts", json={
    "text": "Tell me about a challenging project you worked on.",
    "voice": "af_bella",
    "speed": 1.0,
}).json()
audio_url = f"{MODEL_API}{tts['audio_url']}"

# Transcribe candidate answer
with open("candidate_answer.webm", "rb") as f:
    stt = requests.post(f"{MODEL_API}/api/stt", files={"file": f}).json()
transcript = stt["transcript"]
```

## File Storage

```
storage/
  tts/       # Generated TTS .wav files
  uploads/   # Uploaded audio files for STT
```

Folders are created automatically on startup. No database is used.

## Error Handling

| Scenario | Status | Response |
|----------|--------|----------|
| Empty text in /api/tts | 400 | `{"detail": "Text is required and cannot be empty."}` |
| Speed out of range | 400 | `{"detail": "Speed must be between 0.1 and 3.0."}` |
| No file in /api/stt | 422 | `{"detail": "Field required"}` |
| Empty file in /api/stt | 400 | `{"detail": "Uploaded file is empty."}` |
| TTS generation fails | 500 | `{"detail": "TTS generation failed: ..."}` |
| Transcription fails | 500 | `{"detail": "Transcription failed: ..."}` |

## Notes

- Server 1 must listen on `0.0.0.0` so Server 2 can reach it across the network.
- No authentication is implemented yet. Add API key auth before production.
- No Docker setup yet.
- CORS allows `http://localhost:3000` and `http://127.0.0.1:3000` for development.
