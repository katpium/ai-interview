"use client";

import { useEffect, useState } from "react";
import type { InterviewState } from "@/lib/interviewState";

type Props = {
  state: InterviewState;
  errorMessage: string | null;
  isLastQuestion: boolean;
  transcriptOpen: boolean;
  retryLabel: string;
  onStopRecording: () => void;
  onNextQuestion: () => void;
  onRetry: () => void;
  onToggleTranscript: () => void;
};

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
    .toString()
    .padStart(2, "0");
  const sec = (s % 60).toString().padStart(2, "0");
  return `${m}:${sec}`;
}

function useRecordingTimer(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    setSeconds(0);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [active]);
  return seconds;
}

const THINKING_PHASES: { afterMs: number; label: string }[] = [
  { afterMs: 0,    label: "AI is thinking..." },
  { afterMs: 2500, label: "Looking up company information..." },
  { afterMs: 6000, label: "Preparing response..." },
];

function useThinkingLabel(active: boolean): string {
  const [label, setLabel] = useState(THINKING_PHASES[0].label);
  useEffect(() => {
    if (!active) {
      setLabel(THINKING_PHASES[0].label);
      return;
    }
    setLabel(THINKING_PHASES[0].label);
    const startedAt = Date.now();
    const id = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const phase = [...THINKING_PHASES].reverse().find((p) => elapsed >= p.afterMs);
      if (phase) setLabel(phase.label);
    }, 400);
    return () => window.clearInterval(id);
  }, [active]);
  return label;
}

function Spinner() {
  return (
    <span
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden
    />
  );
}

export default function InterviewStatusCard({
  state,
  errorMessage,
  isLastQuestion,
  transcriptOpen,
  retryLabel,
  onStopRecording,
  onNextQuestion,
  onRetry,
  onToggleTranscript,
}: Props) {
  const seconds = useRecordingTimer(state === "recording");
  const thinkingLabel = useThinkingLabel(state === "final_question_response");

  const body = renderBody();

  return (
    <div className="rounded-2xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Interview Status
      </p>
      <div className="mt-2">{body}</div>
      <div className="mt-3 border-t border-neutral-800 pt-3">
        <button
          type="button"
          onClick={onToggleTranscript}
          aria-pressed={transcriptOpen}
          className="w-full rounded-full border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:bg-neutral-800"
        >
          {transcriptOpen ? "Hide Transcript" : "Show Transcript"}
        </button>
      </div>
    </div>
  );

  function renderBody() {
    switch (state) {
      case "generating_question_audio":
        return (
          <Row tone="amber" label="Preparing question audio...">
            <Spinner />
          </Row>
        );

      case "intro_speaking":
        return (
          <Row tone="indigo" label="AI interviewer introducing the interview">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300" />
          </Row>
        );

      case "opening_speaking":
        return (
          <Row tone="indigo" label="AI interviewer welcoming you">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300" />
          </Row>
        );

      case "ai_speaking":
        return (
          <Row tone="indigo" label="AI interviewer speaking">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300" />
          </Row>
        );

      case "transition_speaking":
        return (
          <Row tone="amber" label="Moving to technical questions...">
            <span className="h-2 w-2 animate-pulse rounded-full bg-amber-300" />
          </Row>
        );

      case "closing_speaking":
        return (
          <Row tone="indigo" label="Wrapping up...">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300" />
          </Row>
        );

      case "recording":
        return (
          <div>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 rounded-full bg-red-500/20 px-2.5 py-1 text-xs font-semibold text-red-200">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-400" />
                REC
              </span>
              <span className="font-mono text-2xl font-semibold tabular-nums text-white">
                {formatTime(seconds)}
              </span>
            </div>
            <p className="mt-2 text-sm text-neutral-300">
              Recording your answer
            </p>
            <button
              type="button"
              onClick={onStopRecording}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-red-500"
            >
              <span className="h-2 w-2 rounded-full bg-white" />
              Stop Recording
            </button>
          </div>
        );

      case "recorded":
        return (
          <Row tone="neutral" label="Recording stopped">
            <span className="h-2 w-2 rounded-full bg-neutral-400" />
          </Row>
        );

      case "uploading":
        return (
          <Row tone="amber" label="Uploading your recording...">
            <Spinner />
          </Row>
        );

      case "transcribing":
        return (
          <Row tone="amber" label="Transcribing your answer...">
            <Spinner />
          </Row>
        );

      case "saving":
        return (
          <Row tone="amber" label="Saving your answer...">
            <Spinner />
          </Row>
        );

      case "final_question_response":
        return (
          <Row tone="amber" label={thinkingLabel}>
            <Spinner />
          </Row>
        );

      case "final_answer_speaking":
        return (
          <Row tone="indigo" label="AI interviewer answering your question">
            <span className="h-2 w-2 animate-pulse rounded-full bg-indigo-300" />
          </Row>
        );

      case "saved":
        return (
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-200">
              <CheckIcon />
              Answer saved
            </span>
            <p className="mt-2 text-sm text-neutral-300">
              {isLastQuestion
                ? "You're all set — finish to see your summary."
                : "Ready for the next question."}
            </p>
            <button
              type="button"
              onClick={onNextQuestion}
              className="mt-3 w-full rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-400"
            >
              {isLastQuestion ? "Finish Interview" : "Next Question"}
            </button>
          </div>
        );

      case "error":
        return (
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-semibold text-red-200">
              <AlertIcon />
              Error
            </span>
            <p className="mt-2 line-clamp-3 text-sm text-red-200">
              {errorMessage ?? "Error contacting model server."}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 w-full rounded-full bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-400"
            >
              {retryLabel}
            </button>
          </div>
        );

      case "starting":
        return (
          <Row tone="neutral" label="Starting interview...">
            <Spinner />
          </Row>
        );

      case "idle":
      case "complete":
      default:
        return <Row tone="neutral" label="Get ready..." />;
    }
  }
}

function Row({
  tone,
  label,
  children,
}: {
  tone: "amber" | "indigo" | "neutral";
  label: string;
  children?: React.ReactNode;
}) {
  const colorMap: Record<typeof tone, string> = {
    amber: "text-amber-200",
    indigo: "text-indigo-200",
    neutral: "text-neutral-300",
  };
  return (
    <div className={`flex items-center gap-2 ${colorMap[tone]}`}>
      {children}
      <p className="text-sm">{label}</p>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 9v4m0 4h.01M10.29 3.86l-8.59 14.86A2 2 0 003.42 22h17.16a2 2 0 001.72-3.28L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}
