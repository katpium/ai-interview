import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import {
  readQuestionBank,
  buildInterviewSequence,
  buildOpeningText,
  normalizeBank,
  checkInterviewReadiness,
  type InterviewSequenceItem,
  FINAL_CANDIDATE_QUESTION,
  INTERVIEW_ROLE,
} from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

const DEFAULT_COMPANY_ID = "novaforge";

/**
 * Build a fallback interview sequence when no question bank exists.
 * Mirrors the real sequence shape so the room consumer doesn't need a
 * special case.
 */
function fallbackSequence(role?: string | null, level?: string | null): InterviewSequenceItem[] {
  return [
    {
      kind: "message",
      section: "opening",
      type: "opening",
      text: buildOpeningText(role, level),
    },
    {
      kind: "question",
      section: "intro",
      type: "intro",
      text: "Tell me about yourself and why you are interested in this role.",
      id: "fallback-1",
    },
    {
      kind: "question",
      section: "behavioral",
      type: "behavioral",
      text: "Tell me about a time you worked with a team under pressure.",
      id: "fallback-2",
    },
    {
      kind: "question",
      section: "behavioral",
      type: "behavioral",
      text: "Describe a situation where you had to meet a tight deadline.",
      id: "fallback-3",
    },
    {
      kind: "question",
      section: "behavioral",
      type: "behavioral",
      text: "How do you approach learning a new technology?",
      id: "fallback-4",
    },
    {
      kind: "message",
      section: "transition",
      type: "transition",
      text: "Thank you. Now we'll move on to some more technical questions.",
    },
    {
      kind: "question",
      section: "technical",
      type: "technical",
      text: "Describe a project where you solved a difficult technical problem.",
      id: "fallback-5",
    },
    {
      kind: "question",
      section: "technical",
      type: "technical",
      text: "Tell me about a time you worked with an API or connected two systems together.",
      id: "fallback-6",
    },
    {
      kind: "question",
      section: "technical",
      type: "technical",
      text: "How do you ensure the quality and reliability of the code you write?",
      id: "fallback-7",
    },
    {
      kind: "question",
      section: "final_candidate_question",
      type: "final_candidate_question",
      text: FINAL_CANDIDATE_QUESTION,
      id: "fallback-8",
    },
    {
      kind: "message",
      section: "closing",
      type: "closing",
      text: "Thank you for completing the interview. Your responses have been submitted.",
    },
  ];
}

/**
 * Return a randomized interview sequence built from the company question bank.
 *
 * ?companyId=novaforge  (defaults to "novaforge")
 *
 * Each call randomizes behavioral/technical question selection.
 *
 * Test:
 *   curl "http://localhost:3000/api/questions?companyId=novaforge"
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId  = searchParams.get("companyId") ?? DEFAULT_COMPANY_ID;
  const role       = searchParams.get("role")       ?? null;
  const level      = searchParams.get("level")      ?? null;
  // allowDraft=true is for admin preview only — never used in candidate invite flow
  const allowDraft = searchParams.get("allowDraft") === "true";

  try {
    const bank = await readQuestionBank(companyId, role, level);
    if (bank && Array.isArray(bank.questionBank) && bank.questionBank.length > 0) {
      const introCount = bank.questionBank.filter((q) => q.type === "intro").length;
      const behavioralCount = bank.questionBank.filter((q) => q.type === "behavioral").length;
      const technicalCount = bank.questionBank.filter((q) => q.type === "technical").length;
      console.log(
        `[Questions] Loaded question bank: behavioral=${behavioralCount} technical=${technicalCount} intro=${introCount}`
      );

      const normalizedBank = normalizeBank(bank);

      // In normal candidate flow, use approved questions only.
      // allowDraft=true is for admin preview.
      if (!allowDraft) {
        const readiness = checkInterviewReadiness(normalizedBank);
        if (!readiness.ready) {
          return NextResponse.json({
            ok: false,
            error: "Interview not ready",
            missing: readiness.missing,
            approvedCounts: readiness.approvedCounts,
            required: readiness.required,
            role: role ?? bank.role ?? null,
            level: level ?? bank.level ?? null,
          }, { status: 409 });
        }
      }

      let interviewSequence: InterviewSequenceItem[];
      try {
        interviewSequence = buildInterviewSequence(normalizedBank, undefined, { role, level, approvedOnly: !allowDraft });
      } catch (err) {
        const e = err as { code?: string; type?: string; required?: number; available?: number };
        if (e.code === "NOT_ENOUGH_QUESTIONS") {
          return NextResponse.json({
            ok: false,
            error: `Not enough approved ${e.type ?? "?"} questions`,
            required: e.required,
            available: e.available,
            role: role ?? bank.role ?? null,
            level: level ?? bank.level ?? null,
          }, { status: 409 });
        }
        throw err;
      }
      const sequenceId = randomUUID();
      const selectedBehavioralIds = interviewSequence
        .filter((s) => s.kind === "question" && s.section === "behavioral")
        .map((s) => (s.kind === "question" ? s.id : ""));
      const selectedTechnicalIds = interviewSequence
        .filter((s) => s.kind === "question" && s.section === "technical")
        .map((s) => (s.kind === "question" ? s.id : ""));
      console.log(
        `[Questions] Selected behavioral question IDs: ${selectedBehavioralIds.join(", ")}`
      );
      console.log(
        `[Questions] Selected technical question IDs: ${selectedTechnicalIds.join(", ")}`
      );
      console.log(`[Questions] Built sequenceId: ${sequenceId}`);

      return NextResponse.json({
        source: "generated",
        companyId: bank.companyId,
        companyName: bank.companyName ?? formatCompanyId(bank.companyId),
        role: bank.role ?? INTERVIEW_ROLE,
        generatedAt: bank.generatedAt,
        sequenceId,
        status: bank.status,
        interviewSequence,
      });
    }
  } catch {
    // Corrupt / unreadable — fall back.
  }

  console.warn(`[Questions] No question bank for "${companyId}" — using fallback`);
  const sequenceId = randomUUID();
  console.log(`[Questions] Built sequenceId: ${sequenceId} (fallback)`);
  return NextResponse.json({
    source: "fallback",
    companyId,
    companyName: formatCompanyId(companyId),
    role: INTERVIEW_ROLE,
    generatedAt: null,
    sequenceId,
    status: null,
    interviewSequence: fallbackSequence(role, level),
  });
}

function formatCompanyId(id: string): string {
  return id
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
