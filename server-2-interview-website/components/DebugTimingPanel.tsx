"use client";

import { useState } from "react";
import type { QuestionTiming } from "@/components/InterviewRoom";

type Props = {
  timings: Record<number, QuestionTiming>;
  currentQuestionId: number;
};

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function DebugTimingPanel({
  timings,
  currentQuestionId,
}: Props) {
  const [open, setOpen] = useState(false);

  const entries = Object.values(timings).sort(
    (a, b) => a.question_id - b.question_id
  );

  return (
    <div className="fixed bottom-3 left-3 z-50 w-72 max-w-[calc(100vw-1.5rem)]">
      {open ? (
        <div className="mb-2 max-h-[60vh] overflow-y-auto rounded-xl border border-neutral-700 bg-neutral-900/95 p-3 text-xs text-neutral-200 shadow-xl backdrop-blur">
          {entries.length === 0 ? (
            <p className="text-neutral-400">No timing data yet.</p>
          ) : (
            <div className="space-y-3">
              {entries.map((t) => {
                const isCurrent = t.question_id === currentQuestionId;
                return (
                  <div
                    key={t.question_id}
                    className={`rounded-lg p-2 ring-1 ${
                      isCurrent
                        ? "bg-indigo-500/10 ring-indigo-400/50"
                        : "ring-neutral-800"
                    }`}
                  >
                    <p className="mb-1 font-semibold text-neutral-100">
                      Question {t.question_id} timing
                      {isCurrent ? (
                        <span className="ml-1 text-indigo-300">(current)</span>
                      ) : null}
                    </p>
                    <dl className="space-y-0.5">
                      {t.question_load_ms > 0 ? (
                        <Row label="Questions load" value={secs(t.question_load_ms)} />
                      ) : null}
                      {t.queue_source ? (
                        <Row
                          label="Queue source"
                          value={t.queue_source}
                          highlight={t.queue_source === "queue"}
                        />
                      ) : null}
                      {t.queue_prepare_ms > 0 ? (
                        <Row label="Queue prep" value={secs(t.queue_prepare_ms)} />
                      ) : null}
                      {t.queue_rag_ms > 0 ? (
                        <Row label="Queue RAG" value={secs(t.queue_rag_ms)} />
                      ) : null}
                      {t.queue_llm_ms > 0 ? (
                        <Row label="Queue LLM" value={secs(t.queue_llm_ms)} />
                      ) : null}
                      {t.queue_tts_ms > 0 ? (
                        <Row label="Queue TTS" value={secs(t.queue_tts_ms)} />
                      ) : null}
                      {t.queue_wait_ms > 0 ? (
                        <Row label="Queue wait" value={secs(t.queue_wait_ms)} />
                      ) : null}
                      <Row label="TTS request" value={secs(t.tts_request_ms)} />
                      <Row label="Audio load" value={secs(t.audio_load_ms)} />
                      <Row label="Audio play" value={secs(t.audio_play_duration_ms)} />
                      <Row label="Recording" value={secs(t.recording_duration_ms)} />
                      <Row label="STT request" value={secs(t.stt_request_ms)} />
                      <Row
                        label="Total"
                        value={secs(t.total_question_time_ms)}
                        bold
                      />
                    </dl>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-pressed={open}
        className="rounded-full border border-neutral-700 bg-neutral-900/90 px-3 py-1.5 text-xs font-medium text-neutral-300 shadow-lg backdrop-blur transition hover:bg-neutral-800 hover:text-neutral-100"
      >
        {open ? "Hide Debug Timing" : "Debug Timing"}
      </button>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  highlight,
}: {
  label: string;
  value: string;
  bold?: boolean;
  highlight?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between ${
        bold ? "border-t border-neutral-700 pt-0.5 font-semibold text-white" : ""
      }`}
    >
      <dt className="text-neutral-400">{label}</dt>
      <dd className={`font-mono tabular-nums ${
        highlight ? "text-emerald-400" : ""
      }`}>{value}</dd>
    </div>
  );
}
