/**
 * Server-side client for Server 1 (the model API).
 *
 * Only imported from Next.js API routes — the candidate browser should
 * never call Server 1 directly.
 */

export type TtsResponse = {
  audio_url: string;
  filename: string;
  cached?: boolean;
  // How long the Server 2 → Server 1 TTS call took (ms).
  timing: { server2_to_server1_tts_ms: number };
};

export type SttResponse = {
  transcript: string;
  // How long the Server 2 → Server 1 STT call took (ms).
  timing: { server2_to_server1_stt_ms: number };
};

export function getModelApiBaseUrl(): string {
  const base = process.env.MODEL_API_BASE_URL;
  if (!base) {
    throw new Error(
      "MODEL_API_BASE_URL is not set. Add it to .env.local (see .env.local.example)."
    );
  }
  return base.replace(/\/+$/, "");
}

/**
 * The same-origin URL the browser uses to fetch a TTS audio file. The actual
 * bytes come from Server 1, but the browser sees /api/audio/<filename> on
 * Server 2 (see app/api/audio/[filename]/route.ts) so that:
 *   - the candidate browser never calls Server 1 directly, and
 *   - HTTPS pages don't trip the mixed-content block on Server 1's plain HTTP.
 */
export function proxiedAudioUrl(filename: string): string {
  return `/api/audio/${encodeURIComponent(filename)}`;
}

export async function checkModelServerHealth(): Promise<{
  ok: boolean;
  status: number;
  body: unknown;
}> {
  const base = getModelApiBaseUrl();
  const res = await fetch(`${base}/health`, { cache: "no-store" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }
  return { ok: res.ok, status: res.status, body };
}

export type TtsRequest = {
  text: string;
  voice?: string;
  speed?: number;
};

export async function requestTts(input: TtsRequest): Promise<TtsResponse> {
  const base = getModelApiBaseUrl();
  const startedAt = Date.now();
  const res = await fetch(`${base}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: input.text,
      voice: input.voice ?? "af_heart",
      speed: input.speed ?? 1.0,
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Server 1 /api/tts failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json()) as {
    audio_url: string;
    filename: string;
    cached?: boolean;
  };
  const server2_to_server1_tts_ms = Date.now() - startedAt;
  return {
    ...data,
    audio_url: proxiedAudioUrl(data.filename),
    timing: { server2_to_server1_tts_ms },
  };
}

export async function requestStt(file: File | Blob): Promise<SttResponse> {
  const base = getModelApiBaseUrl();
  const form = new FormData();
  form.append("file", file, (file as File).name ?? "recording.webm");

  const startedAt = Date.now();
  const res = await fetch(`${base}/api/stt`, {
    method: "POST",
    body: form,
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Server 1 /api/stt failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json()) as { transcript: string };
  const server2_to_server1_stt_ms = Date.now() - startedAt;
  return {
    ...data,
    timing: { server2_to_server1_stt_ms },
  };
}
