"use client";

import type { InterviewQuestion } from "@/lib/questions";

type PerQuestionResult = {
  transcript: string | null;
  placeholderResponse: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  questions: InterviewQuestion[];
  results: Record<number, PerQuestionResult>;
  activeQuestionId: number;
};

export default function TranscriptPanel({
  open,
  onClose,
  questions,
  results,
  activeQuestionId,
}: Props) {
  if (!open) return null;

  const anyAnswers = questions.some(
    (q) => results[q.id]?.transcript && results[q.id]?.transcript !== ""
  );

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col overflow-hidden border-l border-neutral-800 bg-neutral-950 shadow-2xl"
        role="dialog"
        aria-label="Transcript"
      >
        <header className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Transcript</h2>
            <p className="text-xs text-neutral-500">
              Your previous answers in this interview.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-200 transition hover:bg-neutral-800"
          >
            Close
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {!anyAnswers ? (
            <p className="text-sm text-neutral-400">
              No answers yet. Your transcripts will appear here as you complete
              each question.
            </p>
          ) : (
            questions.map((q, i) => {
              const r = results[q.id];
              if (!r || !r.transcript) return null;
              const isActive = q.id === activeQuestionId;
              return (
                <article
                  key={q.id}
                  className={`rounded-xl border p-3 ${
                    isActive
                      ? "border-indigo-500/40 bg-indigo-500/10"
                      : "border-neutral-800 bg-neutral-900"
                  }`}
                >
                  <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                    Question {i + 1}
                  </p>
                  <p className="mt-1 text-sm text-neutral-300">{q.text}</p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-100">
                    <span className="text-neutral-500">You: </span>
                    {r.transcript}
                  </p>
                  {r.placeholderResponse ? (
                    <p className="mt-2 whitespace-pre-wrap rounded-md bg-purple-500/10 px-3 py-2 text-sm text-purple-100">
                      <span className="text-purple-300">AI: </span>
                      {r.placeholderResponse}
                    </p>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
}
