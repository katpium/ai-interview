/**
 * Audio proxy: streams a TTS audio file from Server 1 through Server 2.
 *
 * The candidate browser must only talk to Server 2 (rule of the system).
 * Without this proxy, the browser would fetch the audio directly from
 * Server 1's URL, which (a) violates that rule and (b) is blocked as
 * mixed-content when the page is served over HTTPS but Server 1 is HTTP.
 *
 *   browser → /api/audio/<filename>         (same-origin)
 *           → Server 2                       (this route)
 *           → ${MODEL_API_BASE_URL}/audio/tts/<filename>
 *
 * Forwards Range so the HTMLAudioElement can seek/buffer normally.
 */

import { NextResponse } from "next/server";
import { getModelApiBaseUrl } from "@/lib/modelApi";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Path-safe filename only — Server 1 names are content-hashed (hex + ext).
  if (!/^[A-Za-z0-9._-]+$/.test(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  let base: string;
  try {
    base = getModelApiBaseUrl();
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Model API not configured",
      },
      { status: 500 }
    );
  }

  const upstreamUrl = `${base}/audio/tts/${filename}`;
  const range = req.headers.get("range") ?? undefined;

  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: "GET",
      headers: range ? { range } : undefined,
      cache: "no-store",
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to reach Server 1 for audio",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    const text = await upstream.text().catch(() => "");
    return new Response(text || "Upstream audio fetch failed", {
      status: upstream.status,
    });
  }

  // Forward the audio body + key headers so the browser sees a normal
  // audio response (including 206 partial content for Range requests).
  const headers = new Headers();
  for (const h of [
    "content-type",
    "content-length",
    "accept-ranges",
    "content-range",
    "cache-control",
    "last-modified",
    "etag",
  ]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers,
  });
}
