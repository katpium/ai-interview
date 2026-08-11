/**
 * POST /api/re-evaluate-interview
 *
 * Re-runs AI structured evaluation for a completed interview using the latest transcripts
 * (edited transcripts take priority over original STT transcripts).
 *
 * Archives the previous evaluation to a history file before saving the new one.
 * Requires eval:generate permission (admin, recruiter, hr).
 *
 * Body: { sessionId: string, reason?: string }
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { readSession } from "@/lib/sessions";
import { verifyInvite } from "@/lib/invites";
import { extractCvText } from "@/lib/cvExtract";
import { retrieveCompanyContext } from "@/lib/lightRagService";
import { chatCompletion, type ChatMessage } from "@/lib/openRouterClient";
import { INTERVIEW_CONFIG } from "@/lib/questionGenerator";
import type { InterviewEvaluation, EvaluationCategory } from "@/app/api/evaluate-interview/route";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const EVALUATIONS_DIR = path.join(process.cwd(), "storage", "evaluations");

// ─── System prompt (mirrors evaluate-interview route) ─────────────────

const SYSTEM_PROMPT = `You are a structured interview evaluator completing a formal evaluation form for recruiter review. You do NOT make hiring decisions — you provide a recommendation only.

CRITICAL — Level-calibrated ratings:
All ratings are relative to the candidate's target level. A rating of 3 means "meets expectations for THIS level", not average in absolute terms. Calibrate your expectations as follows:

Intern:
- Expect limited or no professional experience; academic projects and coursework are valid evidence
- Technical depth should be basic; enthusiasm and learning potential matter most
- Do NOT penalise for lack of industry experience — that is expected

Junior (1–2 years):
- Expect foundational professional experience; some independent work
- Technical knowledge of core concepts; may need guidance on advanced topics
- Communication and growth mindset are key indicators

Mid-level (3–5 years):
- Expect solid independent delivery; owns tasks end-to-end
- Good technical depth; can solve problems with minimal guidance
- Starting to mentor others or lead small efforts

Senior (5–8 years):
- Expect deep expertise; drives technical decisions
- Architectural thinking; can handle ambiguous problems independently
- Mentors junior/mid engineers; influences team practices

Lead / Principal / Staff (8+ years):
- Expect cross-team technical leadership and system-level thinking
- Sets technical direction; influences engineering culture
- Should demonstrate strategic impact beyond individual delivery

Manager / Director:
- Focus on people leadership, team building, and organisational impact
- Technical depth is secondary to judgment, communication, and stakeholder management
- Expect evidence of coaching, hiring, and cross-functional collaboration

Rating scale (always relative to the level above):
5 = Exceptional — significantly exceeds expectations for this level
4 = Above Average — clearly above what is expected for this level
3 = Average — meets expectations for this level
2 = Satisfactory — slightly below expectations but shows potential
1 = Unsatisfactory — well below what is expected for this level

For each of the 9 evaluation categories below, provide:
- rating: integer 1–5 (calibrated to the candidate's level)
- comments: short job-related comment (1–2 sentences referencing the level)
- evidence: quoted or paraphrased evidence (see source rules below)
- improvementNotes: specific improvement suggestion relative to this level, or null if not needed

Categories (use these exact categoryName values):
1. Educational Background / CV Relevance
2. Prior Work or Project Experience
3. Technical Qualifications
4. Role-Specific Skills
5. Problem-Solving Ability
6. Communication Skills
7. Teamwork / Collaboration
8. Candidate Enthusiasm
9. Overall Impression and Recommendation

Evidence source rules:
- Categories 1 and 2 (Educational Background / CV Relevance, Prior Work or Project Experience):
  • PRIMARY source is the uploaded CV/resume — quote or paraphrase directly from it (e.g. degree, institution, years of experience, job titles, companies, projects listed in the CV)
  • If no CV was provided, note "No CV provided — based on candidate's self-introduction only" and use the intro transcript instead
  • Do NOT use the interview transcript as the primary evidence for these two categories
- Categories 3–9: use the interview transcript as evidence — quote or paraphrase what the candidate actually said

General rules:
- Do not infer protected characteristics or personal traits
- If a category cannot be assessed, rate it 3 and note "Insufficient data"
- The recommendation must be one of: "Strong Hire", "Hire", "Move to Next Round", "Needs Review", "Do Not Proceed"
- overallScore is the arithmetic mean of all 9 ratings, rounded to 1 decimal place

Respond with ONLY valid JSON — no markdown, no code fences, no commentary:
{
  "candidateName": "<name from CV if available, else null>",
  "overallSummary": "2–3 sentence overall assessment of the candidate",
  "categories": [
    {
      "categoryName": "<exact name from list above>",
      "rating": <1–5>,
      "comments": "<job-related comment>",
      "evidence": "<transcript evidence>",
      "improvementNotes": "<suggestion or null>"
    }
  ],
  "overallScore": <number>,
  "recommendation": "<one of the 5 options>"
}`;

type AnswerInput = {
  questionId: string;
  type: string;
  section: string;
  question: string;
  transcript: string;
};

function buildUserPrompt(
  companyId: string,
  role: string,
  level: string | null,
  answers: AnswerInput[],
  cvText: string | null,
  companyContext: string | null,
  interviewDate: string | null
): string {
  const lines: string[] = [];
  if (companyContext) lines.push("=== COMPANY CONTEXT ===", companyContext.slice(0, 3000), "");
  if (cvText) lines.push("=== CANDIDATE CV ===", cvText.slice(0, 3000), "");
  lines.push(
    `Company: ${companyId}`,
    `Role: ${role}${level ? ` (${level})` : ""}`,
  );
  if (interviewDate) lines.push(`Interview Date: ${interviewDate}`);
  lines.push(
    ``,
    `Interview transcript (${answers.length} answers):`,
  );
  answers.forEach((a, i) => {
    lines.push(
      ``,
      `[Answer ${i + 1}] type="${a.type}"`,
      `Question: ${a.question}`,
      `Candidate answer: ${a.transcript.trim() || "(no answer recorded)"}`,
    );
  });
  lines.push(
    ``,
    `Evaluate the candidate for the ${role}${level ? ` (${level})` : ""} role. Fill in all 9 evaluation categories. For categories 1 and 2, draw evidence directly from the CV above${cvText ? "" : " (no CV was provided — use the intro transcript)"}. For categories 3–9, draw evidence from the interview transcript. Return JSON only.`
  );
  return lines.join("\n");
}

// ─── Versioning helpers ───────────────────────────────────────────────

type HistoryFile = { history: Array<InterviewEvaluation & { archivedAt: string }> };

function evalFilePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-z0-9-]/gi, "").slice(0, 36);
  return path.join(EVALUATIONS_DIR, `${safe}-eval.json`);
}

function historyFilePath(sessionId: string): string {
  const safe = sessionId.replace(/[^a-z0-9-]/gi, "").slice(0, 36);
  return path.join(EVALUATIONS_DIR, `${safe}-eval-history.json`);
}

async function archiveCurrentEval(sessionId: string): Promise<number> {
  const evalFile = evalFilePath(sessionId);
  let existing: InterviewEvaluation | null = null;
  try {
    existing = JSON.parse(await fs.readFile(evalFile, "utf8")) as InterviewEvaluation;
  } catch {
    return 0; // no existing eval to archive
  }

  const histFile = historyFilePath(sessionId);
  let histData: HistoryFile = { history: [] };
  try {
    histData = JSON.parse(await fs.readFile(histFile, "utf8")) as HistoryFile;
    if (!Array.isArray(histData.history)) histData.history = [];
  } catch {
    // no history yet
  }

  histData.history.push({ ...existing, archivedAt: new Date().toISOString() });
  const tmp = `${histFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(histData, null, 2), "utf8");
  await fs.rename(tmp, histFile);

  return existing.evaluationVersion ?? 1;
}

async function saveEval(eval_: InterviewEvaluation, sessionId: string): Promise<void> {
  await fs.mkdir(EVALUATIONS_DIR, { recursive: true });
  const file = evalFilePath(sessionId);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(eval_, null, 2), "utf8");
  await fs.rename(tmp, file);
}

// ─── Route ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // Auth
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { sessionId?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : null;
  const reason =
    typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : null;

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
  }

  // Load session
  const session = await readSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Build answers using editedTranscript where available
  const answers: AnswerInput[] = session.answers
    .filter((a) => a.question_kind !== "candidate_question")
    .sort((a, b) => a.question_number - b.question_number)
    .map((a, i) => {
      const type =
        i < INTERVIEW_CONFIG.introCount ? "intro"
        : i < INTERVIEW_CONFIG.introCount + INTERVIEW_CONFIG.behavioralCount ? "behavioral"
        : "technical";
      return {
        questionId: String(a.question_id),
        type,
        section: type,
        question: a.question_text,
        transcript: (a.editedTranscript ?? a.transcript) || "",
      };
    });

  if (answers.length === 0) {
    return NextResponse.json({ error: "No evaluatable answers found" }, { status: 400 });
  }

  const companyId = "novaforge";
  const role = session.interview_role ?? "Software Engineer";
  const level = session.interview_level ?? null;
  const interviewDate = session.started_at ?? null;

  // Load CV: session-level CV takes priority over invite-level CV
  let cvText: string | null = null;
  try {
    if (session.cvFilename) {
      cvText = await extractCvText(session.cvFilename);
      if (cvText) console.log(`[ReEvaluate] loaded session CV: ${session.cvFilename} (${cvText.length} chars)`);
    } else if (session.invite_token) {
      const { invite } = await verifyInvite(session.invite_token);
      if (invite?.cvFilename) {
        cvText = await extractCvText(invite.cvFilename);
        if (cvText) console.log(`[ReEvaluate] loaded invite CV: ${invite.cvFilename} (${cvText.length} chars)`);
      }
    }
  } catch (err) {
    console.warn("[ReEvaluate] CV lookup failed:", err instanceof Error ? err.message : err);
  }

  // Load company context
  let companyContext: string | null = null;
  try {
    const retrieval = await retrieveCompanyContext(
      companyId,
      `${role} interview evaluation criteria responsibilities`
    );
    companyContext = retrieval.context;
  } catch (err) {
    console.warn("[ReEvaluate] company context failed:", err instanceof Error ? err.message : err);
  }

  const editedCount = answers.filter((_, i) => {
    const orig = session.answers.filter((a) => a.question_kind !== "candidate_question")[i];
    return orig?.transcriptEdited;
  }).length;

  console.log(
    `[ReEvaluate] session=${sessionId.slice(0, 8)} role=${role} answers=${answers.length} ` +
      `editedTranscripts=${editedCount} by=${payload.username}`
  );

  const startMs = Date.now();
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(companyId, role, level, answers, cvText, companyContext, interviewDate) },
    ];

    const result = await chatCompletion(messages, { temperature: 0.3, maxTokens: 4000 });

    let jsonStr = result.content.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

    let parsed: {
      candidateName: string | null;
      overallSummary: string;
      categories: EvaluationCategory[];
      overallScore: number;
      recommendation: string;
    };
    try {
      parsed = JSON.parse(jsonStr) as typeof parsed;
    } catch (parseErr) {
      throw new Error(
        `LLM returned invalid JSON: ${parseErr instanceof Error ? parseErr.message : "parse error"}`
      );
    }

    if (!Array.isArray(parsed.categories)) throw new Error("LLM response missing categories array");

    // Compute overallScore server-side as a safety net
    const computedScore = parsed.categories.length > 0
      ? Math.round((parsed.categories.reduce((sum, c) => sum + (c.rating ?? 3), 0) / parsed.categories.length) * 10) / 10
      : (parsed.overallScore ?? 0);

    // Archive old eval and get previous version number
    const prevVersion = await archiveCurrentEval(sessionId);
    const newVersion = prevVersion + 1;

    const newEval: InterviewEvaluation = {
      companyId,
      role,
      level,
      evaluationType: "structured_interview_evaluation",
      sessionId,
      evaluatedAt: new Date().toISOString(),
      candidateName: parsed.candidateName ?? null,
      interviewDate,
      categories: parsed.categories ?? [],
      overallScore: computedScore,
      overallSummary: parsed.overallSummary ?? "",
      recommendation: (parsed.recommendation as InterviewEvaluation["recommendation"]) ?? "Needs Review",
      recommendationNote:
        "This evaluation is AI-assisted. The recommendation is advisory only — the final hiring decision must be made by a human recruiter.",
      evaluationVersion: newVersion,
      reevaluatedBy: payload.username as string,
      reevaluatedAt: new Date().toISOString(),
      reevaluationReason: reason,
    };

    await saveEval(newEval, sessionId);

    const total_ms = Date.now() - startMs;
    console.log(
      `[ReEvaluate] ✓ session=${sessionId.slice(0, 8)} v${newVersion} total=${total_ms}ms ` +
        `score=${newEval.overallScore} recommendation=${newEval.recommendation}`
    );

    return NextResponse.json({ ok: true, ...newEval });
  } catch (err) {
    console.error(`[ReEvaluate] error:`, err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to re-evaluate",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
