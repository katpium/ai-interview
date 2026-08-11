# Server 2 — AI Interview Website

This is **Server 2** of the AI interview system. It hosts the candidate-facing
interview website and is the only server the candidate browser talks to.

```
Candidate Browser
  → Server 2 (this app — Next.js)
      → Server 1 (AI Model API — /api/tts, /api/stt)
  → Server 2
  → Candidate Browser
```

Server 2 never asks the browser to call Server 1 directly. All TTS and STT
traffic is proxied through Next.js API routes.

## What's in this MVP

- `/interview-room` — the full interview room flow
- Hardcoded interview questions (`lib/questions.ts`)
- `/api/health/model-server` — proxies Server 1's `/health`
- `/api/tts` — proxies Server 1's `/api/tts`
- `/api/stt` — proxies Server 1's `/api/stt` (multipart upload)

## What's intentionally NOT here (later phases)

- No database
- No login
- No company dashboard
- No recruiter dashboard
- No job board
- No **real** (LLM) question generation yet — there is now a company knowledge
  pipeline that produces **mock** questions from company files (see "Company
  Knowledge Pipeline" below). Real LLM generation and a review/approval step
  come later. If no generated set exists, the room falls back to the hardcoded
  questions in `lib/questions.ts`.
- No answer evaluation, scoring, or feedback
- The final "Do you have any questions for us?" stage shows a placeholder
  response after transcription. Wiring this to a real LLM that answers using
  company-provided information is a later phase.

## Tech stack

- Next.js 16 (App Router)
- React 19 + TypeScript
- Tailwind CSS
- Browser `MediaRecorder` API for candidate recording

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Create your local env file
cp .env.local.example .env.local
```

### ⚠️ API Key Required

**You must provide your own [OpenRouter](https://openrouter.ai/) API key** in `.env.local` for the app to work. Open the file and fill in:

- `OPENROUTER_API_KEY` — **required** for question generation, interview evaluation, and embeddings
- `MODEL_API_BASE_URL` — point this at your running Server 1 instance (for TTS/STT)
- `AUTH_SECRET` — change to a random string (≥32 chars) for JWT security
- `AUTH_USERS` — set your own usernames and passwords

Without a valid `OPENROUTER_API_KEY`, question generation and AI evaluation will fail.

```bash
# 3. Run the dev server
npm run dev
```

The app runs at <http://localhost:3000>. Visit
<http://localhost:3000/interview-room> for the interview room itself.

## Environment variables

| Variable              | Required | Description                                     |
| --------------------- | -------- | ----------------------------------------------- |
| `MODEL_API_BASE_URL`  | yes      | Base URL of Server 1, e.g. `http://1.2.3.4:8000` |
| `OPENROUTER_API_KEY`  | **yes**  | Your OpenRouter API key (get one at https://openrouter.ai/) |
| `OPENROUTER_BASE_URL` | no       | Defaults to `https://openrouter.ai/api/v1` |
| `LLM_MODEL`           | no       | LLM model to use (default: `google/gemini-2.5-flash-lite`) |
| `EMBEDDING_MODEL`     | no       | Embedding model (default: `openai/text-embedding-3-small`) |
| `LIGHTRAG_ENABLED`    | no       | Set `true` to enable embedding-based retrieval (requires API key) |
| `AUTH_SECRET`          | yes      | Random string (≥32 chars) for signing JWTs |
| `AUTH_USERS`           | yes      | JSON array of `{username, password, role}` objects |

`MODEL_API_BASE_URL` is **server-side only** — it is read inside API routes and
never exposed to the browser.

## Testing the connection to Server 1

With Server 1 running and `MODEL_API_BASE_URL` set in `.env.local`, you can
verify Server 2 can reach Server 1:

```bash
curl http://localhost:3000/api/health/model-server
```

A healthy response looks like:

```json
{
  "ok": true,
  "upstream_status": 200,
  "upstream_body": { "status": "ok" }
}
```

You can also test the TTS proxy end-to-end:

```bash
curl -X POST http://localhost:3000/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello world","voice":"Bella","speed":1.0}'
```

The response includes a fully-qualified `audio_url` (relative paths from
Server 1 are rewritten using `MODEL_API_BASE_URL`).

## Interview flow

The room is a small state machine. When the interview starts, the AI first
speaks a short self-introduction (grounded in the company/role when known),
then moves on to the questions:

```
idle → starting → generating_question_audio → intro_speaking
     → generating_question_audio → ai_speaking → recording → recorded
     → uploading → transcribing → saving → saved → (next question or)
     → final_question_response → saved → complete
```

On error, the state becomes `error` and the user can retry the step that
failed (e.g. a save failure retries the save without re-recording).

## Company Knowledge Pipeline

This is the **foundation** for generating interview questions from company
files. It runs today with **no LLM/embedding credentials** by using a mock RAG
fallback, and is structured so real LLM/LightRAG can be dropped in later
without changing the public API.

Pipeline stages:

1. **Company files** live in `storage/company-files/<companyId>/`. A demo seed
   file ships at `storage/company-files/demo-company/demo-company.txt`.
2. **MarkItDown** converts those files to Markdown in
   `storage/company-markdown/<companyId>/`. `.txt`/`.md` are converted natively
   (no dependencies). PDF/DOCX/PPTX/XLSX/HTML use the
   [MarkItDown](https://github.com/microsoft/markitdown) CLI **when it is
   installed** (`pip install markitdown`); otherwise those files are skipped
   with a reason — they never crash the run.
3. **LightRAG** (`lib/lightRagService.ts`) is the planned indexing/retrieval
   layer. Until a real backend + credentials exist, it falls back to chunking
   the Markdown and ranking chunks by keyword overlap, persisting an index to
   `storage/company-knowledge/<companyId>/index.json`. Flip `LIGHTRAG_ENABLED`
   and fill the `TODO(lightrag)` branches to connect real
   [LightRAG](https://github.com/HKUDS/LightRAG).
4. **Question generation** (`lib/questionGenerator.ts`) is currently a **mock**
   that fills a fixed template using the retrieved context (company/role are
   parsed out of it). Output is saved to
   `storage/generated-questions/demo-questions.json` with
   `"source": "mock-rag"`, `"status": "draft"`. Replace the mock at
   `TODO(llm)` with a real LLM call later, keeping the same output shape.

Endpoints:

| Method + path                        | Purpose                                            |
| ------------------------------------ | -------------------------------------------------- |
| `POST /api/admin/ingest-company-files` | Convert a company's files to Markdown            |
| `POST /api/generate-questions`       | Ingest → retrieve context → mock-generate + save   |
| `GET /api/questions`                 | Questions for the room (generated, else hardcoded) |

```bash
# Convert company files, then generate a draft question set:
curl -X POST http://localhost:3000/api/admin/ingest-company-files
curl -X POST http://localhost:3000/api/generate-questions
# What the interview room will load:
curl http://localhost:3000/api/questions
```

### Question bank vs. randomized interview sequence

Generation and selection are separate concerns:

- **Question bank** — generated once per company by `POST /api/generate-questions`
  and persisted to `storage/generated-questions/<companyId>-question-bank.json`.
  Holds ~21 questions tagged by type (`intro`, `behavioral`, `technical`,
  `final_candidate_question`), plus the `role` ("Software Engineer") this
  bank is for.
- **Interview sequence** — built **fresh every time** `GET /api/questions` is
  called, by `buildInterviewSequence(bank, INTERVIEW_CONFIG)`. Section order
  is fixed (`opening → intro → behavioral → transition → technical → final → closing`),
  and behavioral/technical questions are shuffled and sampled without repeats.
  Each response carries a `sequenceId` so you can tell runs apart.

Counts and toggles live in `lib/questionGenerator.ts → INTERVIEW_CONFIG`:

```ts
{
  introCount: 1,
  behavioralCount: 3,
  technicalCount: 3,
  includeOpeningMessage: true,
  includeFinalCandidateQuestion: true,
  includeTransitionMessage: true,
  includeClosingMessage: true,
}
```

Sequence items have one of two shapes — questions trigger recording, messages
are TTS-only (no recording, auto-advance):

```ts
{ kind: "question", section: "technical", type: "technical", text: "...", id: "t-4" }
{ kind: "message",  section: "opening",   type: "opening",   text: "Welcome…" }
```

Manual test — regenerate the bank once, then hit `/api/questions` a few
times and watch the behavioral/technical IDs change:

```bash
# 1) Regenerate the bank for "novaforge" (overwrites the existing file)
curl -X POST http://localhost:3000/api/generate-questions \
  -H "Content-Type: application/json" \
  -d '{"companyId":"novaforge"}'

# 2) Hit the questions endpoint three times — bank stays put, sequence changes
for i in 1 2 3; do
  echo "--- call $i ---"
  curl -s "http://localhost:3000/api/questions?companyId=novaforge" \
    | jq '{sequenceId, role,
            behavioralIds: [.interviewSequence[] | select(.section=="behavioral") | .id],
            technicalIds:  [.interviewSequence[] | select(.section=="technical")  | .id]}'
done
```

Expected:
- The file `storage/generated-questions/novaforge-question-bank.json` is **unchanged** across the three calls.
- The `behavioralIds` and `technicalIds` arrays should **vary** between calls.
- The section order in `interviewSequence` is fixed.
- `role` is `"Software Engineer"` and technical questions are scenario-based, not generic.
- The final candidate question is always exactly `"Do you have any questions for us?"`.
- The dev server log shows, per call:
  ```
  [Questions] Loaded question bank: behavioral=10 technical=9 intro=1
  [Questions] Selected behavioral question IDs: b-7, b-2, b-10
  [Questions] Selected technical question IDs: t-4, t-8, t-1
  [Questions] Built sequenceId: <uuid>
  ```

The interview room loads questions from `GET /api/questions` on mount; if no
bank exists (or it is unreadable), the room falls back to a hardcoded
sequence so the interview always works.

### Preparation screen + audio preload

When the candidate clicks **Join interview**, the room enters a `preparing`
state and **preloads TTS for every spoken item in parallel** before the
active interview starts. This is what makes the actual interview feel
instant — once the preparation screen reaches 100%, every question's audio
is already cached, so no 4–5s wait between questions.

Browser console during preparation:

```
[Preload] item=1 section=opening cached=true duration=120ms
[Preload] item=2 section=intro cached=false duration=4310ms
[Preload] item=3 section=behavioral cached=true duration=95ms
...
[Preload] all audio ready total=5240ms
```

`cached=true` means Server 1 already had that exact TTS in its on-disk cache
(hash-keyed), which is why the second run of the same interview is much
faster than the first.

### Candidate-question answering (final stage)

When the candidate answers `"Do you have any questions for us?"`, the room
sends their transcribed question to `POST /api/answer-candidate-question`,
which runs:

```
retrieveCompanyContext(companyId, question)   // RAG over company markdown
  → chatCompletion(...)                        // LLM, grounded in retrieved context
  → requestTts(answer)                         // Server 1 TTS
  ← { answer, audio_url, filename, cached, timing, model }
```

The room then plays the audio (`final_answer_speaking` state) and renders the
answer text inline. If the route fails for any reason, the room gracefully
falls back to the static placeholder so the interview is never stuck.

Manual test:

```bash
curl -s -X POST http://localhost:3000/api/answer-candidate-question \
  -H "Content-Type: application/json" \
  -d '{"companyId":"novaforge","question":"What does a typical day look like for a software engineer here?"}' \
  | jq '{answer, audio_url, cached, retrievalMethod, model, timing}'
```

The dev server logs:

```
[FinalAnswer] companyId=novaforge q="..." rag=1639ms llm=4941ms tts=39423ms total=46004ms retrieval=lightrag model=...
```

## Project structure

```
server-2-interview-website/
  app/
    interview-room/page.tsx                  # /interview-room route
    api/
      health/model-server/route.ts           # GET — proxies Server 1 /health
      tts/route.ts                            # POST — proxies Server 1 /api/tts
      stt/route.ts                            # POST — proxies Server 1 /api/stt
      audio/[filename]/route.ts               # GET  — streams Server 1 audio (same-origin)
      answer-candidate-question/route.ts      # POST — RAG+LLM+TTS for the candidate's final question
      sessions/...                            # local JSON session storage
      admin/ingest-company-files/route.ts     # POST — files → Markdown
      generate-questions/route.ts             # POST — mock-RAG question gen
      questions/route.ts                      # GET — questions for the room
  components/
    InterviewRoom.tsx                         # main state machine + flow
    AITile.tsx CandidateTile.tsx DialogBox.tsx
    QuestionInfo.tsx InterviewStatusCard.tsx
    TranscriptPanel.tsx CompletionSummary.tsx
  lib/
    questions.ts                              # hardcoded fallback questions
    modelApi.ts                               # server-side client for Server 1
    sessions.ts                               # local JSON session storage
    interviewState.ts                         # InterviewState union type
    companyFiles.ts                           # MarkItDown conversion
    lightRagService.ts                        # RAG index/retrieve (fallback)
    questionGenerator.ts                      # mock question generation
  storage/
    company-files/<companyId>/                # source company files (input)
    company-markdown/<companyId>/             # converted Markdown
    company-knowledge/<companyId>/            # LightRAG index (fallback)
    generated-questions/                      # generated question sets
    sessions/                                 # one JSON file per session
  .env.local.example
  README.md
```

## Browser permissions

The first time you open `/interview-room`, the browser asks for microphone
(and optionally camera) permission. The app prefers audio + video, but falls
back gracefully to audio-only if the camera is unavailable.

`getUserMedia` is only available in a **secure context** — see the section
below before deciding how to host this for testing.

## Local testing: LAN IP vs HTTPS tunnel

**TL;DR — LAN IP works for browsing, but not for camera/mic.**
Camera/microphone require a **secure context**, which means one of:

- `https://...`
- `http://localhost`
- `http://127.0.0.1`

A plain `http://<LAN-IP>:3000` URL is **not** a secure context, so
`navigator.mediaDevices` is `undefined` and `getUserMedia` cannot run. The
lobby detects this with `window.isSecureContext` and shows a warning banner
("Camera and microphone require HTTPS or localhost…"), and the "Enable
Camera + Mic" / "Mic Only" buttons are disabled so they don't appear to
fail silently. Open DevTools → Console to see the diagnostic logs:

```
[Permissions] Protocol: <http: | https:>
[Permissions] isSecureContext: <true | false>
[Permissions] mediaDevices available: <true | false>
[Permissions] Calling getUserMedia({ audio, video })
[Permissions] getUserMedia success — tracks: audio, video
# or on failure
[Permissions] getUserMedia failed: NotAllowedError: …
```

### 1. Opening Server 2 over LAN IP

You can open the interview website over a LAN IP — the page will load fine
and the UI works. Only the mic/camera step is blocked by the browser. To
bind the Next.js dev server to all interfaces so a phone/another laptop on
your LAN can reach it:

```bash
# inside server-2-interview-website/
npm run dev -- -H 0.0.0.0
# then open http://<your-LAN-IP>:3000/interview-room from the other device
```

### 2. Server 2 ↔ Server 1 over LAN

Server-to-server traffic does **not** care about secure contexts; browser
rules don't apply. `MODEL_API_BASE_URL=http://10.88.1.2:8000` works fine
from inside Server 2's API routes. CORS and mixed-content only constrain
the candidate browser.

### 3. Why the candidate browser never sees Server 1's URL

Every byte the browser fetches comes from Server 2:

| What the browser hits | What Server 2 does internally |
| --- | --- |
| `POST /api/tts` | calls Server 1 `/api/tts` |
| `POST /api/stt` | calls Server 1 `/api/stt` |
| `GET  /api/audio/<filename>` | streams from Server 1 `/audio/tts/<filename>` |
| `GET  /api/questions` | reads generated questions / hardcoded fallback |
| `POST /api/generate-questions` | runs the (mock) RAG pipeline |
| `POST /api/sessions[/…]` | local JSON session storage |

The TTS response's `audio_url` is rewritten by Server 2 to a same-origin
`/api/audio/<filename>` path, so the candidate browser never contacts
Server 1 directly. This is what makes the system work behind an HTTPS
tunnel without mixed-content errors.

### 4. If LAN IP doesn't work for you (because of mic/camera)

Use one of these to get a secure context:

- **ngrok** — `ngrok http 3000`, then open the **`https://`** URL it gives
  you (not the `http://` one). On the free tier you may need
  `ngrok-skip-browser-warning: 1` on `fetch()` calls if the interstitial
  starts intercepting your API requests.
- **Cloudflare Tunnel** — `cloudflared tunnel --url http://localhost:3000`.
- **Local HTTPS** — generate a dev cert with `mkcert` and run a small TLS
  reverse proxy in front of `next dev`.

Stick with `http://localhost:3000` when testing the desktop browser
locally — it's already a secure context, no tunnel needed.
