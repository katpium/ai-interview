"use client";

import { useEffect, useState } from "react";
import type { InterviewEvaluation, AnswerEval } from "@/app/api/evaluate-interview/route";

// ─── Local types ─────────────────────────────────────────────────────

type SessionAnswer = {
  question_id: number;
  question_number: number;
  question_text: string;
  question_kind: "interview" | "candidate_question";
  transcript: string;
  audio_filename: string | null;
  created_at: string;
};

type InterviewSession = {
  session_id: string;
  status: "in_progress" | "completed";
  questions_total: number;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  answers: SessionAnswer[];
  interview_role?: string | null;
  interview_level?: string | null;
  invite_token?: string | null;
};

type SeqMetaItem = { pos: number; type: string; section: string };

type FetchState = "loading" | "ready" | "error";
type EvalState = "idle" | "loading" | "ready" | "error";

// ─── Helpers ─────────────────────────────────────────────────────────

function formatTimestamp(iso: string): string {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "—";
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "—";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

function ScorePip({ value, max = 5 }: { value: number; max?: number }) {
  const colour =
    value >= 4 ? "bg-emerald-500" : value >= 3 ? "bg-amber-500" : "bg-red-500";
  return (
    <span className="inline-flex items-center gap-1 text-xs">
      <span className={`inline-block h-2 w-2 rounded-full ${colour}`} />
      <span className="tabular-nums text-neutral-300">{value}/{max}</span>
    </span>
  );
}

function ScoreGrid({ scores }: { scores: Record<string, number> }) {
  const entries = Object.entries(scores);
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
      {entries.map(([key, val]) => (
        <div key={key} className="flex items-center justify-between gap-2">
          <dt className="text-xs text-neutral-400 capitalize">
            {key.replace(/_/g, " ")}
          </dt>
          <dd>
            <ScorePip value={val} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function AnswerEvalCard({ ev }: { ev: AnswerEval }) {
  const [open, setOpen] = useState(false);
  const overall = (ev.scores as Record<string, number>).overall ?? 0;
  const colour =
    overall >= 4 ? "border-emerald-700/40 bg-emerald-900/10"
    : overall >= 3 ? "border-amber-700/40 bg-amber-900/10"
    : "border-red-700/40 bg-red-900/10";

  return (
    <article className={`rounded-lg border p-4 ${colour}`}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            {ev.type}
          </p>
          <p className="mt-0.5 text-sm font-medium text-neutral-100 line-clamp-2">
            {ev.question}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-3">
          <ScorePip value={overall} />
          <span className="text-neutral-500 text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 mb-1">Summary</p>
            <p className="text-sm text-neutral-300">{ev.summary}</p>
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500 mb-2">Scores</p>
            <ScoreGrid scores={ev.scores as Record<string, number>} />
          </div>

          {ev.strengths.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-500 mb-1">Strengths</p>
              <ul className="space-y-0.5">
                {ev.strengths.map((s, i) => (
                  <li key={i} className="text-sm text-emerald-300 flex gap-2">
                    <span className="text-emerald-600 flex-shrink-0">+</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ev.improvements.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-amber-500 mb-1">Improvements</p>
              <ul className="space-y-0.5">
                {ev.improvements.map((s, i) => (
                  <li key={i} className="text-sm text-amber-300 flex gap-2">
                    <span className="text-amber-600 flex-shrink-0">→</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {ev.redFlags.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-red-500 mb-1">Red Flags</p>
              <ul className="space-y-0.5">
                {ev.redFlags.map((s, i) => (
                  <li key={i} className="text-sm text-red-300 flex gap-2">
                    <span className="text-red-600 flex-shrink-0">!</span>{s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Main component ───────────────────────────────────────────────────

export default function CompletionSummary({
  sessionId,
  companyId,
  seqMeta,
}: {
  sessionId: string | null;
  companyId?: string;
  seqMeta?: SeqMetaItem[];
}) {
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [status, setStatus] = useState<FetchState>("loading");
  const [error, setError] = useState<string | null>(null);

  const [evalState, setEvalState] = useState<EvalState>("idle");
  const [evalError, setEvalError] = useState<string | null>(null);
  const [evaluation, setEvaluation] = useState<InterviewEvaluation | null>(null);

  const load = async (sid: string) => {
    setStatus("loading");
    setError(null);
    try {
      const res = await fetch(`/api/sessions/${sid}`, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`GET /api/sessions/${sid} ${res.status} ${text}`);
      }
      setSession((await res.json()) as InterviewSession);
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setStatus("error");
    }
  };

  useEffect(() => {
    if (!sessionId) { setStatus("error"); setError("No session id available."); return; }
    void load(sessionId);
  }, [sessionId]);

  const generateReview = async () => {
    if (!session || evalState === "loading") return;
    setEvalState("loading");
    setEvalError(null);

    // Build the answers array, tagging each with type/section from seqMeta
    const typeMap = new Map<number, SeqMetaItem>();
    seqMeta?.forEach((m) => typeMap.set(m.pos, m));

    const answers = session.answers
      .slice()
      .sort((a, b) => a.question_number - b.question_number)
      .filter((a) => a.question_kind !== "candidate_question")
      .map((a) => {
        const meta = typeMap.get(a.question_id);
        return {
          questionId: String(a.question_id),
          type: meta?.type ?? (a.question_number === 1 ? "intro" : "behavioral"),
          section: meta?.section ?? "behavioral",
          question: a.question_text,
          transcript: a.transcript,
        };
      });

    try {
      const res = await fetch("/api/evaluate-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyId ?? "unknown",
          role: session?.interview_role ?? "Software Engineer",
          level: session?.interview_level ?? null,
          sessionId,
          answers,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`POST /api/evaluate-interview ${res.status} ${text}`);
      }
      const data = (await res.json()) as InterviewEvaluation;
      setEvaluation(data);
      setEvalState("ready");
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Unknown error");
      setEvalState("error");
    }
  };

  // ── Loading / error states ──────────────────────────────────────────

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6 text-center">
        <h1 className="text-3xl font-semibold text-white">Interview complete</h1>
        <p className="text-slate-300">Loading your summary...</p>
      </div>
    );
  }

  if (status === "error" || !session) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-6 text-center">
        <h1 className="text-3xl font-semibold text-white">Interview complete</h1>
        <p className="text-slate-300">Your answers were submitted, but the summary could not be loaded.</p>
        {error && <p className="rounded-md bg-red-900/40 p-3 text-sm text-red-200">{error}</p>}
        {sessionId && (
          <button type="button" onClick={() => void load(sessionId)}
            className="rounded-md bg-amber-500 px-4 py-2 font-medium text-white hover:bg-amber-400">
            Retry
          </button>
        )}
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1 text-center">
        <h1 className="text-3xl font-semibold text-white">Interview complete</h1>
        <p className="text-slate-300">Thank you for completing the interview. Your responses have been saved.</p>
      </header>

      {/* Session metadata */}
      <section className="rounded-2xl border border-slate-700 bg-slate-800/60 p-5">
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div><dt className="text-slate-400">Session</dt>
            <dd className="font-mono text-slate-200 break-all">{session.session_id}</dd></div>
          <div><dt className="text-slate-400">Status</dt>
            <dd className="text-emerald-300">{session.status}</dd></div>
          <div><dt className="text-slate-400">Started</dt>
            <dd className="text-slate-200">{formatTimestamp(session.started_at)}</dd></div>
          <div><dt className="text-slate-400">Completed</dt>
            <dd className="text-slate-200">{session.completed_at ? formatTimestamp(session.completed_at) : "—"}</dd></div>
          <div><dt className="text-slate-400">Duration</dt>
            <dd className="text-slate-200">{formatDuration(session.started_at, session.completed_at)}</dd></div>
          <div><dt className="text-slate-400">Answers</dt>
            <dd className="text-slate-200">{session.answers.length} of {session.questions_total}</dd></div>
        </dl>
      </section>

      {/* Answers transcript */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Transcript</h2>
        {session.answers
          .slice()
          .sort((a, b) => a.question_number - b.question_number)
          .map((a) => (
            <article key={a.question_number}
              className="rounded-lg border border-slate-700 bg-slate-800/60 p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm text-slate-400">
                  Question {a.question_number}
                  {a.question_kind === "candidate_question" && (
                    <span className="ml-2 rounded-full bg-purple-600/30 px-2 py-0.5 text-xs text-purple-200">your question</span>
                  )}
                </p>
                <time className="text-xs text-slate-500">{formatTimestamp(a.created_at)}</time>
              </div>
              <p className="mt-1 text-slate-100">{a.question_text}</p>
              <p className="mt-3 whitespace-pre-wrap text-slate-300">
                <span className="text-slate-400">Your answer: </span>
                {a.transcript || <span className="italic text-slate-500">(empty)</span>}
              </p>
            </article>
          ))}
      </section>

      {/* ── AI Review section ─────────────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">AI Review</h2>
          {evalState !== "ready" && (
            <button
              type="button"
              disabled={evalState === "loading"}
              onClick={() => void generateReview()}
              className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {evalState === "loading" ? "Generating AI review…" : "Generate AI Review"}
            </button>
          )}
        </div>

        {evalState === "loading" && (
          <div className="flex items-center gap-3 rounded-xl border border-indigo-700/40 bg-indigo-900/10 p-4 text-sm text-indigo-300">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent flex-shrink-0" />
            Generating AI-assisted review… this may take 30–60 seconds.
          </div>
        )}

        {evalState === "error" && evalError && (
          <div className="rounded-xl border border-red-700/40 bg-red-900/10 p-4">
            <p className="text-sm font-medium text-red-300">Review generation failed</p>
            <p className="mt-1 text-xs text-red-400">{evalError}</p>
            <button type="button" onClick={() => void generateReview()}
              className="mt-3 rounded-full bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-400">
              Retry
            </button>
          </div>
        )}

        {evalState === "ready" && evaluation && (
          <div className="space-y-4">
            {/* Disclaimer */}
            <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-3 text-xs text-amber-300">
              ⚠ AI-assisted review — human recruiter should make final decisions.
            </div>

            {/* Overall summary */}
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500 mb-1">Overall Summary</p>
              <p className="text-sm text-slate-200">{evaluation.overallSummary}</p>
            </div>

            {/* Per-answer evaluations (collapsed by default) */}
            <div className="space-y-2">
              {evaluation.answers.map((ev) => (
                <AnswerEvalCard key={ev.questionId} ev={ev} />
              ))}
            </div>

            {/* Recommendation note */}
            <p className="text-center text-xs text-slate-500 italic">
              {evaluation.recommendationNote}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
