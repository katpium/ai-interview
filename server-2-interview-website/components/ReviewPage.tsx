"use client";

import { useEffect, useRef, useState } from "react";
import type { InterviewEvaluation, EvaluationCategory } from "@/app/api/evaluate-interview/route";
import AdminNav from "@/components/AdminNav";

// ─── Types ────────────────────────────────────────────────────────────

type DecisionStatus = "pending" | "needs_review" | "shortlisted" | "hired" | "rejected";

type HiringDecision = {
  sessionId: string;
  decision: DecisionStatus;
  decisionBy: string;
  decisionAt: string;
  decisionNote: string | null;
};

type SessionAnswer = {
  question_id: number;
  question_number: number;
  question_text: string;
  question_kind: "interview" | "candidate_question";
  transcript: string;
  audio_filename: string | null;
  candidate_audio_filename: string | null;
  created_at: string;
  // Transcript edit audit fields
  editedTranscript?: string | null;
  transcriptEdited?: boolean;
  editedBy?: string | null;
  editedAt?: string | null;
};

type Session = {
  session_id: string;
  status: "in_progress" | "completed";
  questions_total: number;
  started_at: string;
  completed_at: string | null;
  answers: SessionAnswer[];
  interview_role?: string | null;
  interview_level?: string | null;
  invite_token?: string | null;
  cvFilename?: string | null;
  inviteCvFilename?: string | null; // enriched by the sessions API from the linked invite
  hiringDecision?: HiringDecision | null; // enriched by the sessions API from decisions storage
};

type ExtendedEval = InterviewEvaluation & {
  historyCount?: number;
};

type AuthUser = { username: string; role: string };

type Permissions = {
  canEditTranscript: boolean;
  canSetDecision: boolean;
  canReEvaluate: boolean;
  canGenerateDraft: boolean;
};

// ─── Helpers ─────────────────────────────────────────────────────────

function fmt(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function duration(start: string, end: string | null) {
  if (!end) return "—";
  const s = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

const DECISION_LABELS: Record<DecisionStatus, string> = {
  pending: "Pending",
  needs_review: "Needs Review",
  shortlisted: "Shortlisted",
  hired: "Hired",
  rejected: "Rejected",
};

const DECISION_COLORS: Record<DecisionStatus, string> = {
  pending: "bg-neutral-800 text-neutral-400 border-neutral-700",
  needs_review: "bg-amber-900/40 text-amber-300 border-amber-700/40",
  shortlisted: "bg-blue-900/40 text-blue-300 border-blue-700/40",
  hired: "bg-emerald-900/40 text-emerald-300 border-emerald-700/40",
  rejected: "bg-red-900/40 text-red-300 border-red-700/40",
};

// ─── AudioPlayer (AI question audio — always audio-only) ─────────────

function AudioPlayer({ src, label }: { src: string; label: string }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggle = () => {
    if (state === "playing") {
      audioRef.current?.pause();
      setState("idle");
      return;
    }
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    setState("loading");
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.oncanplay = () => { setState("playing"); void audio.play(); };
    audio.onended = () => setState("idle");
    audio.onerror = () => setState("error");
    audio.load();
  };

  return (
    <button type="button" onClick={toggle}
      className={`mt-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition
        ${state === "playing" ? "bg-indigo-600 text-white hover:bg-indigo-500"
          : state === "error" ? "bg-red-900/40 text-red-300"
          : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"}`}>
      {state === "loading" && <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />}
      {state === "playing" ? "⏸" : state === "error" ? "✕" : "▶"}
      {" "}{state === "loading" ? "Loading…" : state === "playing" ? `Pause ${label}` : state === "error" ? "Error" : `Play ${label}`}
    </button>
  );
}

// ─── RecordingPlayer ─────────────────────────────────────────────────
// Inline video/audio player for candidate recordings.

function RecordingPlayer({ src, label }: { src: string; label: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition
          ${open ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700"}`}
      >
        {open ? "▲" : "▶"} {open ? `Hide ${label}` : `Play ${label}`}
      </button>
      {open && (
        <div className="mt-2 overflow-hidden rounded-xl bg-black ring-1 ring-neutral-700">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video
            src={src}
            controls
            autoPlay
            playsInline
            className="w-full"
            style={{ maxHeight: "320px" }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Evaluation display ───────────────────────────────────────────────

const RATING_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  5: { label: "Exceptional",    color: "text-emerald-300", bg: "bg-emerald-900/30 border-emerald-700/40" },
  4: { label: "Above Average",  color: "text-emerald-400", bg: "bg-emerald-900/20 border-emerald-800/40" },
  3: { label: "Average",        color: "text-amber-300",   bg: "bg-amber-900/20 border-amber-800/40" },
  2: { label: "Satisfactory",   color: "text-orange-300",  bg: "bg-orange-900/20 border-orange-800/40" },
  1: { label: "Unsatisfactory", color: "text-red-300",     bg: "bg-red-900/20 border-red-800/40" },
};

const RECOMMENDATION_STYLES: Record<string, { color: string; bg: string; dot: string }> = {
  "Strong Hire":        { color: "text-emerald-300", bg: "bg-emerald-900/30 border-emerald-600/50", dot: "bg-emerald-400" },
  "Hire":               { color: "text-emerald-400", bg: "bg-emerald-900/20 border-emerald-700/40", dot: "bg-emerald-500" },
  "Move to Next Round": { color: "text-indigo-300",  bg: "bg-indigo-900/20 border-indigo-700/40",   dot: "bg-indigo-400" },
  "Needs Review":       { color: "text-amber-300",   bg: "bg-amber-900/20 border-amber-700/40",     dot: "bg-amber-400" },
  "Do Not Proceed":     { color: "text-red-300",     bg: "bg-red-900/20 border-red-700/40",         dot: "bg-red-400" },
};

function RatingBadge({ rating }: { rating: number }) {
  const info = RATING_LABELS[rating] ?? RATING_LABELS[3];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${info.bg} ${info.color}`}>
      <span className="font-bold tabular-nums">{rating}/5</span>
      <span>·</span>
      <span>{info.label}</span>
    </span>
  );
}

function CategoryCard({ cat, index }: { cat: EvaluationCategory; index: number }) {
  const [open, setOpen] = useState(false);
  return (
    <article className="rounded-lg border border-neutral-800 bg-neutral-900/60">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-800 text-[11px] font-semibold text-neutral-400">
            {index + 1}
          </span>
          <span className="text-sm font-medium text-neutral-200 truncate">{cat.categoryName}</span>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <RatingBadge rating={cat.rating} />
          <span className="text-neutral-600 text-xs">{open ? "▲" : "▼"}</span>
        </div>
      </button>
      {open && (
        <div className="border-t border-neutral-800 px-4 pb-4 pt-3 space-y-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">Comments</p>
            <p className="text-sm text-neutral-300">{cat.comments}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-indigo-400 mb-1">Evidence from Transcript</p>
            <p className="text-sm text-neutral-400 italic border-l-2 border-indigo-800 pl-3">{cat.evidence}</p>
          </div>
          {cat.improvementNotes && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-500 mb-1">Improvement Notes</p>
              <p className="text-sm text-amber-300/80">{cat.improvementNotes}</p>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

// ─── Transcript edit row ──────────────────────────────────────────────

function TranscriptEditRow({
  answer,
  sessionId,
  canEdit,
  onSaved,
}: {
  answer: SessionAnswer;
  sessionId: string;
  canEdit: boolean;
  onSaved: (updatedAnswer: SessionAnswer) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(answer.editedTranscript ?? answer.transcript);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const currentDisplay = answer.editedTranscript ?? answer.transcript;

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/transcript`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionNumber: answer.question_number, editedTranscript: editText }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      const data = await res.json() as { ok: boolean; session: Session };
      const updatedAnswer = data.session.answers.find(
        (a) => a.question_number === answer.question_number
      );
      if (updatedAnswer) onSaved(updatedAnswer);
      setEditing(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2">
      {/* Transcript display */}
      {answer.transcriptEdited && !editing && (
        <div className="mb-2 space-y-1">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-600 mb-0.5">Original (STT)</p>
            <p className="text-sm text-neutral-500 italic">{answer.transcript || "(empty)"}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-blue-600 mb-0.5">
              Edited transcript
              {answer.editedBy && (
                <span className="ml-1 text-neutral-600 normal-case tracking-normal">
                  · by {answer.editedBy} on {fmt(answer.editedAt ?? "")}
                </span>
              )}
            </p>
            <p className="text-sm text-neutral-200">{currentDisplay || "(empty)"}</p>
          </div>
        </div>
      )}

      {!answer.transcriptEdited && !editing && (
        <p className="mt-1 text-sm text-neutral-300">
          <span className="text-neutral-500">Answer: </span>
          {answer.transcript || <span className="italic text-neutral-600">(empty)</span>}
        </p>
      )}

      {/* Inline edit form */}
      {editing && (
        <div className="mt-2 space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wide text-blue-400">Edit transcript</p>
          <textarea
            className="w-full rounded-lg border border-blue-700/50 bg-neutral-900 p-3 text-sm text-neutral-100 placeholder-neutral-600 focus:border-blue-500 focus:outline-none resize-y min-h-[80px]"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Enter corrected transcript…"
          />
          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save edit"}
            </button>
            <button
              type="button"
              onClick={() => { setEditing(false); setEditText(answer.editedTranscript ?? answer.transcript); setSaveError(null); }}
              className="rounded-full border border-neutral-700 px-4 py-1.5 text-xs text-neutral-400 hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {canEdit && !editing && (
        <button
          type="button"
          onClick={() => { setEditText(answer.editedTranscript ?? answer.transcript); setEditing(true); }}
          className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-[11px] text-neutral-500 transition hover:border-blue-700 hover:text-blue-400"
        >
          ✏ Edit transcript
        </button>
      )}
    </div>
  );
}

// ─── Candidate audio row ──────────────────────────────────────────────

function CandidateAudioRow({
  candidateFilename,
  aiFilename,
}: {
  candidateFilename: string | null;
  aiFilename: string | null;
}) {
  const [deleted, setDeleted] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleteRecording = async () => {
    if (!candidateFilename) return;
    setDeleting(true);
    setConfirmDelete(false);
    try {
      await fetch(`/api/recordings/${candidateFilename}`, { method: "DELETE" });
      setDeleted(true);
    } catch {
      setDeleted(true);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mt-2 space-y-1">
      {candidateFilename && !deleted && (
        <div>
          {/* Play button + delete controls on one row */}
          <div className="flex flex-wrap items-center gap-2">
            <RecordingPlayer src={`/api/recordings/${candidateFilename}`} label="candidate answer" />
            {confirmDelete ? (
              <>
                <span className="text-xs text-red-400">Delete recording?</span>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => void deleteRecording()}
                  className="inline-flex items-center gap-1 rounded-full border border-red-700 bg-red-900/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/40 disabled:opacity-50"
                >
                  {deleting ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(true)}
                className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-500 transition hover:border-red-700 hover:text-red-400 disabled:opacity-50"
              >
                🗑 Delete recording
              </button>
            )}
          </div>
        </div>
      )}
      {candidateFilename && deleted && (
        <span className="text-xs text-neutral-600 italic">Recording deleted</span>
      )}
      {aiFilename && (
        <AudioPlayer src={`/api/audio/${aiFilename}`} label="AI question" />
      )}
    </div>
  );
}

// ─── AI Evaluation panel ──────────────────────────────────────────────

type EvalPanelProps = {
  sessionId: string;
  answers: SessionAnswer[];
  interviewRole?: string | null;
  interviewLevel?: string | null;
  canReEvaluate: boolean;
};

function EvalPanel({ sessionId, answers, interviewRole, interviewLevel, canReEvaluate }: EvalPanelProps) {
  const [evalState, setEvalState] = useState<"loading-existing" | "idle" | "generating" | "re-evaluating" | "ready" | "error">("loading-existing");
  const [evaluation, setEvaluation] = useState<ExtendedEval | null>(null);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [showReEvalForm, setShowReEvalForm] = useState(false);
  const [reEvalReason, setReEvalReason] = useState("");

  useEffect(() => {
    fetch(`/api/evaluate-interview?sessionId=${sessionId}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: (ExtendedEval & { ok: boolean }) | null) => {
        if (d?.ok && d.categories) { setEvaluation(d); setEvalState("ready"); }
        else setEvalState("idle");
      })
      .catch(() => setEvalState("idle"));
  }, [sessionId]);

  const generate = async () => {
    setEvalState("generating");
    setEvalError(null);
    // Map sorted index to question type: index 0 = intro, 1-3 = behavioral, 4+ = technical
    const getAnswerType = (i: number) =>
      i === 0 ? "intro" : i < 4 ? "behavioral" : "technical";
    const evalAnswers = answers
      .filter(a => a.question_kind !== "candidate_question")
      .sort((a, b) => a.question_number - b.question_number)
      .map((a, i) => ({
        questionId: String(a.question_id),
        type: getAnswerType(i),
        section: getAnswerType(i),
        question: a.question_text,
        transcript: a.transcript,
      }));
    try {
      const res = await fetch("/api/evaluate-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: "novaforge",
          role: interviewRole ?? "Software Engineer",
          level: interviewLevel ?? null,
          sessionId,
          answers: evalAnswers,
        }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      const d = await res.json() as ExtendedEval;
      setEvaluation(d);
      setEvalState("ready");
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Unknown error");
      setEvalState("error");
    }
  };

  const reEvaluate = async () => {
    setEvalState("re-evaluating");
    setEvalError(null);
    setShowReEvalForm(false);
    try {
      const res = await fetch("/api/re-evaluate-interview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, reason: reEvalReason.trim() || null }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      const d = await res.json() as ExtendedEval;
      setEvaluation(d);
      setReEvalReason("");
      setEvalState("ready");
    } catch (err) {
      setEvalError(err instanceof Error ? err.message : "Unknown error");
      setEvalState("error");
    }
  };

  if (evalState === "loading-existing") {
    return <p className="text-sm text-neutral-500">Loading evaluation…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
            AI-Assisted Notes
          </h3>
          {evaluation?.evaluationVersion && (
            <p className="text-[11px] text-neutral-600 mt-0.5">
              Version {evaluation.evaluationVersion}
              {evaluation.reevaluatedBy && ` · re-evaluated by ${evaluation.reevaluatedBy}`}
              {evaluation.historyCount ? ` · ${evaluation.historyCount} previous version${evaluation.historyCount > 1 ? "s" : ""}` : ""}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          {evalState !== "ready" && evalState !== "re-evaluating" && (
            <button type="button" disabled={evalState === "generating"} onClick={() => void generate()}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed">
              {evalState === "generating" ? "Generating…" : "Generate AI Notes"}
            </button>
          )}
          {evalState === "ready" && canReEvaluate && !showReEvalForm && (
            <button type="button" onClick={() => setShowReEvalForm(true)}
              className="rounded-full border border-indigo-700/60 px-4 py-1.5 text-xs font-semibold text-indigo-400 hover:border-indigo-500 hover:text-indigo-300">
              Re-evaluate
            </button>
          )}
        </div>
      </div>

      {/* Re-evaluate form */}
      {showReEvalForm && (
        <div className="rounded-xl border border-indigo-700/30 bg-indigo-900/10 p-4 space-y-3">
          <p className="text-xs font-medium text-indigo-300">
            Re-running evaluation will use edited transcripts where available and archive the current version.
          </p>
          <textarea
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2.5 text-sm text-neutral-200 placeholder-neutral-600 focus:border-indigo-500 focus:outline-none resize-none h-16"
            placeholder="Reason for re-evaluation (optional)"
            value={reEvalReason}
            onChange={(e) => setReEvalReason(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => void reEvaluate()}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">
              Confirm re-evaluate
            </button>
            <button type="button" onClick={() => { setShowReEvalForm(false); setReEvalReason(""); }}
              className="rounded-full border border-neutral-700 px-4 py-1.5 text-xs text-neutral-400 hover:text-white">
              Cancel
            </button>
          </div>
        </div>
      )}

      {(evalState === "generating" || evalState === "re-evaluating") && (
        <div className="flex items-center gap-3 rounded-xl border border-indigo-700/40 bg-indigo-900/10 p-4 text-sm text-indigo-300">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          {evalState === "re-evaluating" ? "Re-evaluating… this may take 30–60 seconds." : "Generating AI notes… this may take 30–60 seconds."}
        </div>
      )}

      {evalState === "error" && evalError && (
        <div className="rounded-xl border border-red-700/40 bg-red-900/10 p-4">
          <p className="text-sm text-red-300">{evalError}</p>
          <button type="button" onClick={() => void generate()}
            className="mt-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400">Retry</button>
        </div>
      )}

      {evalState === "ready" && evaluation && (
        <div className="space-y-4">
          <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-3 text-xs text-amber-300">
            ⚠ AI-assisted evaluation — the recommendation is advisory only. The final hiring decision must be made by a human.
          </div>

          {evaluation.reevaluationReason && (
            <p className="text-xs text-neutral-500 italic">Re-evaluation reason: {evaluation.reevaluationReason}</p>
          )}

          {/* Header card: candidate info + overall score + recommendation */}
          <div className="rounded-xl border border-neutral-700 bg-neutral-800/60 p-4 space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
              {evaluation.candidateName && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Candidate</p>
                  <p className="mt-0.5 text-neutral-200 font-medium">{evaluation.candidateName}</p>
                </div>
              )}
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Role</p>
                <p className="mt-0.5 text-neutral-200">{evaluation.role}</p>
              </div>
              {evaluation.level && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Level</p>
                  <p className="mt-0.5 text-neutral-200">{evaluation.level}</p>
                </div>
              )}
              {evaluation.interviewDate && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Interview Date</p>
                  <p className="mt-0.5 text-neutral-200">{new Date(evaluation.interviewDate).toLocaleDateString()}</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-6 pt-2 border-t border-neutral-700/50">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">Overall Score</p>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-2xl font-bold text-neutral-100 tabular-nums">{evaluation.overallScore.toFixed(1)}</span>
                  <span className="text-sm text-neutral-500">/ 5</span>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">AI Recommendation</p>
                {(() => {
                  const style = RECOMMENDATION_STYLES[evaluation.recommendation] ?? RECOMMENDATION_STYLES["Needs Review"];
                  return (
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${style.bg} ${style.color}`}>
                      <span className={`h-2 w-2 rounded-full ${style.dot}`} />
                      {evaluation.recommendation}
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>

          {/* Overall summary */}
          <div className="rounded-xl border border-neutral-700 bg-neutral-800/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500 mb-1">Overall Summary</p>
            <p className="text-sm text-neutral-200">{evaluation.overallSummary}</p>
          </div>

          {/* Category cards */}
          <div className="space-y-2">
            {evaluation.categories.map((cat, i) => (
              <CategoryCard key={cat.categoryName} cat={cat} index={i} />
            ))}
          </div>

          <p className="text-center text-xs text-neutral-500 italic">{evaluation.recommendationNote}</p>
        </div>
      )}
    </div>
  );
}

// ─── Decision panel ───────────────────────────────────────────────────

function DecisionPanel({
  sessionId,
  candidateRole,
  permissions,
  onDecisionChange,
}: {
  sessionId: string;
  candidateRole?: string | null;
  permissions: Permissions;
  onDecisionChange: (decision: HiringDecision | null) => void;
}) {
  const [loadState, setLoadState] = useState<"loading" | "idle">("loading");
  const [current, setCurrent] = useState<HiringDecision | null>(null);
  const [selected, setSelected] = useState<DecisionStatus>("pending");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`/api/sessions/${sessionId}/decision`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { ok: boolean; decision: HiringDecision | null } | null) => {
        if (d?.decision) {
          setCurrent(d.decision);
          setSelected(d.decision.decision);
          setNote(d.decision.decisionNote ?? "");
          onDecisionChange(d.decision);
        }
        setLoadState("idle");
      })
      .catch(() => setLoadState("idle"));
  }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/sessions/${sessionId}/decision`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: selected, decisionNote: note.trim() || null }),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      const data = await res.json() as { ok: boolean; decision: HiringDecision };
      setCurrent(data.decision);
      onDecisionChange(data.decision);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const DECISION_OPTIONS: { value: DecisionStatus; label: string; className: string }[] = [
    { value: "pending", label: "Pending", className: "border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-200" },
    { value: "needs_review", label: "Needs Review", className: "border-amber-700 text-amber-400 hover:border-amber-500 hover:text-amber-300" },
    { value: "shortlisted", label: "Shortlisted", className: "border-blue-700 text-blue-400 hover:border-blue-500 hover:text-blue-300" },
    { value: "hired", label: "Hired", className: "border-emerald-700 text-emerald-400 hover:border-emerald-500 hover:text-emerald-300" },
    { value: "rejected", label: "Rejected", className: "border-red-700 text-red-400 hover:border-red-500 hover:text-red-300" },
  ];

  if (loadState === "loading") {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4">
        <p className="text-sm text-neutral-500">Loading decision…</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Hiring Decision
        </h3>
        {current && (
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${DECISION_COLORS[current.decision]}`}>
            {DECISION_LABELS[current.decision]}
          </span>
        )}
      </div>

      {current && (
        <p className="text-xs text-neutral-500">
          Set by <span className="text-neutral-300">{current.decisionBy}</span> on {fmt(current.decisionAt)}
          {current.decisionNote && <> · <span className="italic text-neutral-400">"{current.decisionNote}"</span></>}
        </p>
      )}

      {permissions.canSetDecision ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {DECISION_OPTIONS.map(opt => (
              <button
                key={opt.value}
                type="button"
                onClick={() => { setSelected(opt.value); setSaved(false); }}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                  selected === opt.value
                    ? "ring-2 ring-offset-1 ring-offset-neutral-900 " + opt.className
                    : "border-neutral-800 text-neutral-600 hover:border-neutral-600 hover:text-neutral-400"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <textarea
            className="w-full rounded-lg border border-neutral-700 bg-neutral-900 p-2.5 text-sm text-neutral-200 placeholder-neutral-600 focus:border-neutral-500 focus:outline-none resize-none h-16"
            placeholder="Decision note (optional — internal only)"
            value={note}
            onChange={(e) => { setNote(e.target.value); setSaved(false); }}
          />

          {saveError && <p className="text-xs text-red-400">{saveError}</p>}
          {saved && <p className="text-xs text-emerald-400">Decision saved.</p>}

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-full bg-neutral-700 px-5 py-1.5 text-xs font-semibold text-white hover:bg-neutral-600 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save decision"}
          </button>

          <p className="text-[11px] text-neutral-600 italic">
            The final hiring decision must be made by a human. AI evaluation above is advisory only.
          </p>
        </div>
      ) : (
        <p className="text-sm text-neutral-500">
          {current
            ? `Decision: ${DECISION_LABELS[current.decision]}`
            : "No decision recorded yet."}
        </p>
      )}
    </div>
  );
}

// ─── Message draft templates ──────────────────────────────────────────

const DRAFT_DECISIONS: DecisionStatus[] = ["shortlisted", "hired", "needs_review", "rejected"];

function buildMessageTemplate(decision: DecisionStatus, role: string): string {
  const r = role.trim() || "the position";
  switch (decision) {
    case "hired":
      return (
        `We are pleased to inform you that, following your recent interview for the ${r} role, ` +
        `we would like to offer you the position. We were genuinely impressed with your experience ` +
        `and believe you would be a great fit for our team.\n\n` +
        `Our team will be in touch shortly with the formal offer details and information on the next steps. ` +
        `We very much look forward to welcoming you aboard.`
      );
    case "shortlisted":
      return (
        `Thank you for taking the time to interview with us for the ${r} role. ` +
        `We were impressed with your background and experience, and we would like to invite you ` +
        `to continue to the next stage of our selection process.\n\n` +
        `A member of our team will be reaching out shortly to discuss the next steps. ` +
        `We look forward to speaking with you again.`
      );
    case "needs_review":
      return (
        `Thank you for your patience following your interview for the ${r} role. ` +
        `We are currently completing our review of all candidates and expect to have a decision for you soon.\n\n` +
        `We appreciate the time and effort you invested in this process and will be in touch as soon as possible.`
      );
    case "rejected":
      return (
        `Thank you for taking the time to interview with us for the ${r} role. ` +
        `After careful consideration, we have decided to move forward with other candidates ` +
        `whose experience more closely aligns with our current requirements.\n\n` +
        `We genuinely appreciate the time and effort you put into this process ` +
        `and wish you all the best in your search.`
      );
    default:
      return "";
  }
}

// ─── Message draft panel ──────────────────────────────────────────────

function MessageDraftPanel({
  decision,
  candidateRole,
  permissions,
}: {
  decision: HiringDecision | null;
  candidateRole?: string | null;
  permissions: Permissions;
}) {
  const role = candidateRole || "the position";
  const decisionKey = decision?.decision ?? ("" as DecisionStatus);

  const [draft, setDraft] = useState(() =>
    decision && DRAFT_DECISIONS.includes(decision.decision)
      ? buildMessageTemplate(decision.decision, role)
      : ""
  );

  useEffect(() => {
    if (decision && DRAFT_DECISIONS.includes(decision.decision)) {
      setDraft(buildMessageTemplate(decision.decision, role));
    }
  }, [decisionKey, role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!decision || !permissions.canGenerateDraft) return null;
  if (!DRAFT_DECISIONS.includes(decision.decision)) return null;

  const draftColor = ["hired", "shortlisted"].includes(decision.decision)
    ? "border-emerald-700/30 bg-emerald-900/10"
    : decision.decision === "needs_review"
    ? "border-amber-700/30 bg-amber-900/10"
    : "border-red-700/30 bg-red-900/10";

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Candidate Message Draft
        </h3>
        <span className="text-xs text-neutral-600">for: {DECISION_LABELS[decision.decision]}</span>
      </div>

      <div className={`rounded-lg border p-3 ${draftColor}`}>
        <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 mb-2">
          Edit before sending
        </p>
        <textarea
          className="w-full bg-transparent text-sm text-neutral-200 resize-y focus:outline-none min-h-[110px]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(draft)}
          className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:border-neutral-500 hover:text-white"
        >
          Copy
        </button>
        <button
          type="button"
          onClick={() => setDraft(buildMessageTemplate(decision.decision, role))}
          className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-500 hover:text-neutral-300"
        >
          Reset to template
        </button>
      </div>
      <p className="text-[11px] text-neutral-600 italic">
        Draft only — copy and send manually. Not sent automatically.
      </p>
    </div>
  );
}

// ─── CV upload panel ──────────────────────────────────────────────────

function CvUploadPanel({
  session,
  canUpload,
  onCvChange,
}: {
  session: Session;
  canUpload: boolean;
  onCvChange: (cvFilename: string | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccess(null);
    try {
      const form = new FormData();
      form.append("cv", file);
      const res = await fetch(`/api/sessions/${session.session_id}/cv`, { method: "POST", body: form });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => "")}`);
      const d = await res.json() as { ok: boolean; cvFilename: string };
      onCvChange(d.cvFilename);
      setFile(null);
      setSuccess("Resume uploaded — re-run evaluation to apply it.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async () => {
    setRemoving(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/sessions/${session.session_id}/cv`, { method: "DELETE" });
      if (!res.ok) throw new Error(`${res.status}`);
      onCvChange(null);
      setSuccess("Resume removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Candidate Resume
        </h3>
        {(session.cvFilename || session.inviteCvFilename) && (
          <span className="text-xs text-indigo-400">
            {(session.cvFilename ?? session.inviteCvFilename ?? "").replace(/^session-[^.]+/, "resume")}
          </span>
        )}
      </div>

      {session.cvFilename ? (
        session.cvFilename.startsWith("session-") ? (
          <p className="text-xs text-emerald-400">
            ✓ Resume uploaded manually — used for Categories 1 &amp; 2 in the AI evaluation.
          </p>
        ) : (
          <p className="text-xs text-emerald-400">
            ✓ Resume attached from invite link — used automatically for Categories 1 &amp; 2 in the AI evaluation.
          </p>
        )
      ) : session.inviteCvFilename ? (
        <p className="text-xs text-emerald-400">
          ✓ Resume attached from invite link — used automatically for Categories 1 &amp; 2 in the AI evaluation.
        </p>
      ) : (
        <p className="text-xs text-neutral-500">
          No resume attached. Categories 1 &amp; 2 will be based on the candidate&apos;s self-introduction.
        </p>
      )}

      {canUpload && (
        <div className="space-y-2">
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="file"
              accept=".pdf,.docx,.doc,.txt,.md"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setSuccess(null); setError(null); }}
              className="block text-sm text-neutral-400 file:mr-3 file:rounded-full file:border-0 file:bg-neutral-800 file:px-3 file:py-1 file:text-xs file:text-neutral-300 file:cursor-pointer hover:file:bg-neutral-700"
            />
            <button
              type="button"
              disabled={!file || uploading}
              onClick={() => void upload()}
              className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? "Uploading…" : (session.cvFilename || session.inviteCvFilename) ? "Replace resume" : "Upload resume"}
            </button>
            {session.cvFilename && (
              <button
                type="button"
                disabled={removing}
                onClick={() => void remove()}
                className="rounded-full border border-neutral-700 px-3 py-1.5 text-xs text-neutral-500 hover:border-red-700 hover:text-red-400 disabled:opacity-40"
              >
                {removing ? "Removing…" : "Remove"}
              </button>
            )}
          </div>
          {file && <p className="text-xs text-neutral-400">Selected: {file.name} ({Math.round(file.size / 1024)} KB)</p>}
          {error && <p className="text-xs text-red-400">{error}</p>}
          {success && <p className="text-xs text-emerald-400">{success}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Session detail ────────────────────────────────────────────────────

function SessionDetail({
  session,
  permissions,
  onClose,
  onDelete,
  onSessionUpdate,
}: {
  session: Session;
  permissions: Permissions;
  onClose: () => void;
  onDelete: (id: string) => void;
  onSessionUpdate: (updated: Session) => void;
}) {
  const sorted = [...session.answers].sort((a, b) => a.question_number - b.question_number);
  const [currentDecision, setCurrentDecision] = useState<HiringDecision | null>(null);

  const handleDecisionChange = (decision: HiringDecision | null) => {
    setCurrentDecision(decision);
    onSessionUpdate({ ...session, hiringDecision: decision });
  };

  const handleAnswerSaved = (updatedAnswer: SessionAnswer) => {
    const updatedAnswers = session.answers.map((a) =>
      a.question_number === updatedAnswer.question_number ? updatedAnswer : a
    );
    onSessionUpdate({ ...session, answers: updatedAnswers });
  };

  const handleCvChange = (cvFilename: string | null) => {
    onSessionUpdate({ ...session, cvFilename });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-mono text-xs text-neutral-500">{session.session_id}</p>
          {(session.interview_role || session.interview_level) && (
            <p className="text-base font-semibold text-neutral-100 mt-0.5">
              {[session.interview_level, session.interview_role].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="text-sm text-neutral-400 mt-0.5">
            {fmt(session.started_at)} · {duration(session.started_at, session.completed_at)} · {session.answers.length}/{session.questions_total} answers
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:text-white">
            ← Back
          </button>
          <button type="button"
            onClick={() => { onDelete(session.session_id); onClose(); }}
            className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-500 hover:border-red-700 hover:text-red-400">
            🗑 Delete session
          </button>
        </div>
      </div>

      {/* Transcript & Recordings */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">Transcript & Recordings</h3>
        {sorted.map((a) => (
          <div key={a.question_number} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-medium text-neutral-500">
                Q{a.question_number}
                {a.question_kind === "candidate_question" && (
                  <span className="ml-2 rounded-full bg-purple-600/30 px-1.5 py-0.5 text-purple-300">their question</span>
                )}
                {a.transcriptEdited && (
                  <span className="ml-2 rounded-full bg-blue-900/40 border border-blue-700/40 px-1.5 py-0.5 text-blue-400">edited</span>
                )}
              </p>
              <span className="text-xs text-neutral-600">{fmt(a.created_at)}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-neutral-100">{a.question_text}</p>

            <TranscriptEditRow
              answer={a}
              sessionId={session.session_id}
              canEdit={permissions.canEditTranscript && a.question_kind !== "candidate_question"}
              onSaved={handleAnswerSaved}
            />

            <CandidateAudioRow
              candidateFilename={a.candidate_audio_filename}
              aiFilename={a.audio_filename}
            />
          </div>
        ))}
      </div>

      {/* Candidate Resume */}
      <CvUploadPanel
        session={session}
        canUpload={permissions.canEditTranscript}
        onCvChange={handleCvChange}
      />

      {/* AI Evaluation */}
      <EvalPanel
        sessionId={session.session_id}
        answers={sorted}
        interviewRole={session.interview_role}
        interviewLevel={session.interview_level}
        canReEvaluate={permissions.canReEvaluate}
      />

      {/* Human Hiring Decision */}
      <DecisionPanel
        sessionId={session.session_id}
        candidateRole={session.interview_role}
        permissions={permissions}
        onDecisionChange={handleDecisionChange}
      />

      {/* Candidate Message Draft */}
      <MessageDraftPanel
        decision={currentDecision}
        candidateRole={session.interview_role}
        permissions={permissions}
      />
    </div>
  );
}

// ─── Main page ─────────────────────────────────────────────────────────

export default function ReviewPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Session | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then((d: { user: AuthUser | null }) => setCurrentUser(d.user ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch("/api/sessions")
      .then(r => r.json())
      .then((d: { sessions: Session[] }) => { setSessions(d.sessions); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, []);

  const permissions: Permissions = {
    canEditTranscript: ["admin", "recruiter", "hr"].includes(currentUser?.role ?? ""),
    canSetDecision: ["admin", "recruiter", "hr"].includes(currentUser?.role ?? ""),
    canReEvaluate: ["admin", "recruiter", "hr"].includes(currentUser?.role ?? ""),
    canGenerateDraft: ["admin", "recruiter", "hr"].includes(currentUser?.role ?? ""),
  };

  const updateSelectedSession = (updated: Session) => {
    setSelected(updated);
    setSessions(prev => prev.map(s => s.session_id === updated.session_id ? updated : s));
  };

  const deleteSession = async (sessionId: string) => {
    await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    setPendingDeleteId(null);
    setSessions(prev => prev.filter(s => s.session_id !== sessionId));
    if (selected?.session_id === sessionId) setSelected(null);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AdminNav />
      <div className="mx-auto max-w-3xl p-6 space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Interview Sessions</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Review transcripts, play recordings, edit transcripts, and record hiring decisions</p>
        </header>

        {loading && <p className="text-neutral-400">Loading sessions…</p>}
        {error && <p className="rounded-xl bg-red-900/30 p-4 text-sm text-red-300">{error}</p>}

        {!loading && !error && !selected && (
          <div className="space-y-2">
            {sessions.length === 0 && <p className="text-neutral-500">No sessions yet.</p>}
            {sessions.map(s => (
              <div key={s.session_id} className="flex items-stretch gap-2">
                <button type="button" onClick={() => setSelected(s)}
                  className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-left transition hover:border-neutral-600">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-neutral-500 truncate">{s.session_id}</p>
                      {(s.interview_role || s.interview_level) && (
                        <p className="mt-0.5 text-sm font-medium text-neutral-100">
                          {[s.interview_level, s.interview_role].filter(Boolean).join(" · ")}
                        </p>
                      )}
                      <p className={`text-xs text-neutral-500 ${s.interview_role ? "" : "mt-0.5 text-sm text-neutral-200"}`}>
                        {fmt(s.started_at)}
                      </p>
                      <p className="text-xs text-neutral-500 mt-0.5">
                        {duration(s.started_at, s.completed_at)} · {s.answers.length}/{s.questions_total} answers
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 flex-col items-end gap-1.5">
                      <span className={`w-24 text-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        s.status === "completed" ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/40 text-amber-300"
                      }`}>{s.status}</span>
                      {s.hiringDecision && (
                        <span className={`w-24 text-center rounded-full border px-2 py-0.5 text-xs font-medium ${DECISION_COLORS[s.hiringDecision.decision]}`}>
                          {DECISION_LABELS[s.hiringDecision.decision]}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                {pendingDeleteId === s.session_id ? (
                  <div className="flex flex-shrink-0 items-center gap-1 rounded-xl border border-red-800/50 bg-red-900/10 px-2">
                    <span className="text-xs text-red-400">Delete?</span>
                    <button
                      type="button"
                      onClick={() => void deleteSession(s.session_id)}
                      className="rounded-full border border-red-700 bg-red-900/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/50"
                    >
                      Yes
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(null)}
                      className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(s.session_id)}
                    title="Delete session"
                    className="flex-shrink-0 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 text-neutral-600 transition hover:border-red-800 hover:bg-red-900/10 hover:text-red-400"
                  >
                    🗑
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {selected && (
          <SessionDetail
            session={selected}
            permissions={permissions}
            onClose={() => setSelected(null)}
            onDelete={(id) => { setSelected(null); setPendingDeleteId(id); }}
            onSessionUpdate={updateSelectedSession}
          />
        )}
      </div>
    </div>
  );
}
