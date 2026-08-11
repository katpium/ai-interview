/**
 * Answer the candidate's question at the end of the interview.
 * Grounded in company knowledge via the RAG layer.
 *
 *   browser → POST /api/answer-candidate-question
 *               { companyId, question, sessionId? }
 *           → cache check (companyId + normalised question)
 *           → getSessionCachedRagContext(sessionId)  — instant if cached
 *             OR retrieveCompanyContext(…, { maxChunks: 3 })  — top 3 chunks
 *           → chatCompletion(…, maxTokens: 150)      — 2-3 sentence answer
 *           → requestTts(answer)                     — Server 1 TTS (cached)
 *
 *   ← { answer, audio_url, filename, cached, timing, model, retrievalMethod }
 *
 * Speed-up stack (no model change):
 *   1. Per-process in-memory answer cache — identical questions are instant
 *   2. Session RAG context reuse — skips embedding search entirely
 *   3. Only 3 RAG chunks — smaller prompt, faster LLM
 *   4. maxTokens: 150 — 2-3 sentences, no padding
 *   5. Server 1 TTS cache — same answer text reuses cached audio
 */

import { NextResponse } from "next/server";
import { retrieveCompanyContext } from "@/lib/lightRagService";
import { chatCompletion, type ChatMessage } from "@/lib/openRouterClient";
import { requestTts } from "@/lib/modelApi";
import { getSessionCachedRagContext } from "@/lib/questionQueue";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const DEFAULT_COMPANY_ID = "novaforge";

// ─── In-process answer cache ──────────────────────────────────────────────
// Keyed by `${companyId}:${normalised question}`. Survives HMR in dev.

type CachedAnswer = {
  answer: string;
  audio_url: string;
  filename: string;
};

const _g = globalThis as unknown as { __answerCache?: Map<string, CachedAnswer> };
if (!_g.__answerCache) _g.__answerCache = new Map();
const answerCache: Map<string, CachedAnswer> = _g.__answerCache;

function normaliseQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ─── Prompt ───────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI interviewer at a technology company answering a candidate's question. Use only the company context provided. Keep your answer to 2-3 sentences, friendly, and conversational — it will be read aloud by text-to-speech. No lists, no markdown, no invented facts. Address the candidate directly.`;

// ─── Route ────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { companyId?: unknown; question?: unknown; sessionId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const companyId =
    typeof body.companyId === "string" && body.companyId.trim()
      ? body.companyId.trim()
      : DEFAULT_COMPANY_ID;

  const question =
    typeof body.question === "string" ? body.question.trim() : "";

  if (!question) {
    return NextResponse.json(
      { error: "`question` is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : null;

  // ── Cache hit? ──────────────────────────────────────────────────────────
  const cacheKey = `${companyId}:${normaliseQuestion(question)}`;
  const hit = answerCache.get(cacheKey);
  if (hit) {
    console.log(
      `[FinalAnswer] cache HIT companyId=${companyId} ` +
        `q="${question.slice(0, 60)}" key="${cacheKey.slice(0, 80)}"`
    );
    return NextResponse.json({
      ok: true,
      answer: hit.answer,
      audio_url: hit.audio_url,
      filename: hit.filename,
      cached: true,
      retrievalMethod: "answer-cache",
      model: "cached",
      timing: { rag_ms: 0, llm_ms: 0, tts_ms: 0, total_ms: 0 },
    });
  }

  const totalStart = Date.now();
  try {
    // ── 1. Company context ──────────────────────────────────────────────
    let context: string;
    let retrievalMethod: string;
    let rag_ms = 0;

    const cachedContext = sessionId ? getSessionCachedRagContext(sessionId) : null;
    if (cachedContext) {
      context = cachedContext;
      retrievalMethod = "session-cache";
      console.log(
        `[FinalAnswer] RAG session-cache hit — sessionId=${sessionId?.slice(0, 8)} ` +
          `len=${context.length}`
      );
    } else {
      const ragStart = Date.now();
      // Top 3 chunks only — enough context for a 2-3 sentence answer, much
      // shorter prompt than the full 8-chunk interview context.
      const retrieval = await retrieveCompanyContext(companyId, question, { maxChunks: 3 });
      rag_ms = Date.now() - ragStart;
      context = retrieval.context;
      retrievalMethod = retrieval.method;
      console.log(
        `[FinalAnswer] RAG fresh — ${rag_ms}ms method=${retrievalMethod} ` +
          `chunks=${retrieval.chunks.length} sessionId=${sessionId ?? "none"}`
      );
    }

    // ── 2. LLM answer ───────────────────────────────────────────────────
    const llmStart = Date.now();
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Company context:\n\n---\n${context}\n---\n\n` +
          `Candidate asked: "${question}"\n\nAnswer in 2-3 sentences.`,
      },
    ];
    const result = await chatCompletion(messages, {
      temperature: 0.4,
      maxTokens: 150,
    });
    const llm_ms = Date.now() - llmStart;

    const rawAnswer = result.content
      .trim()
      .replace(/^```[\w-]*\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim();

    const answer =
      rawAnswer ||
      "I don't have specific details on that right now, but I'd recommend following up with the recruiting team who can give you a more accurate answer.";

    if (!rawAnswer) {
      console.warn(
        `[FinalAnswer] LLM returned empty content — using fallback answer. ` +
          `raw="${result.content.slice(0, 200)}"`
      );
    }

    // ── 3. TTS ──────────────────────────────────────────────────────────
    // Server 1 caches audio by text hash — same answer text reuses the file.
    const ttsStart = Date.now();
    const tts = await requestTts({ text: answer });
    const tts_ms = Date.now() - ttsStart;

    const total_ms = Date.now() - totalStart;
    console.log(
      `[FinalAnswer] done — companyId=${companyId} ` +
        `rag=${rag_ms}ms llm=${llm_ms}ms tts=${tts_ms}ms total=${total_ms}ms ` +
        `retrieval=${retrievalMethod} model=${result.model} ` +
        `answer="${answer.slice(0, 80)}"`
    );

    // Store in answer cache for future identical questions.
    answerCache.set(cacheKey, { answer, audio_url: tts.audio_url, filename: tts.filename });

    return NextResponse.json({
      ok: true,
      answer,
      audio_url: tts.audio_url,
      filename: tts.filename,
      cached: tts.cached ?? false,
      retrievalMethod,
      model: result.model,
      timing: { rag_ms, llm_ms, tts_ms, total_ms },
    });
  } catch (err) {
    console.error(
      `[FinalAnswer] error after ${Date.now() - totalStart}ms:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to generate candidate-question answer",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
