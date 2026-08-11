"use client";

const SECTION_LABELS: Record<string, string> = {
  intro: "Introduction",
  behavioral: "Behavioral Questions",
  technical: "Technical Questions",
  final_candidate_question: "Candidate Questions",
  transition: "Moving to Technical Questions",
  closing: "Complete",
};

type Props = {
  questionNumber: number;
  totalQuestions: number;
  section: string;
  isFinalCandidateQuestion: boolean;
  isMessage: boolean;
};

export default function QuestionInfo({
  questionNumber,
  totalQuestions,
  section,
  isFinalCandidateQuestion,
  isMessage,
}: Props) {
  const pct = isMessage ? 100 : Math.round((questionNumber / totalQuestions) * 100);
  const sectionLabel = SECTION_LABELS[section] ?? section;

  return (
    <div className="rounded-2xl bg-neutral-900 p-4 ring-1 ring-neutral-800">
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        {isMessage ? "Section" : "Question"}
      </p>
      {isMessage ? (
        <p className="mt-1 text-base font-semibold text-amber-300">{sectionLabel}</p>
      ) : (
        <p className="mt-1 text-lg font-semibold text-white">
          {questionNumber}{" "}
          <span className="text-sm font-normal text-neutral-400">
            / {totalQuestions}
          </span>
        </p>
      )}
      <p className="mt-1 text-[11px] text-neutral-500">{!isMessage && sectionLabel}</p>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-indigo-500 transition-[width] duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      {isFinalCandidateQuestion ? (
        <p className="mt-3 inline-flex rounded-full bg-purple-500/15 px-2 py-0.5 text-[11px] font-medium text-purple-200">
          Your turn to ask
        </p>
      ) : null}
    </div>
  );
}
