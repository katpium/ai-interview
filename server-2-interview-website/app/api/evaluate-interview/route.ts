/**
 * POST /api/evaluate-interview
 *
 * AI-assisted structured evaluation of a completed interview.
 * Returns a formal evaluation form with 9 categories — NOT a hiring decision.
 *
 * Input:
 *   {
 *     companyId: string,
 *     role: string,
 *     sessionId?: string,
 *     answers: AnswerInput[]
 *   }
 *
 * Skips:  final_candidate_question, any answer with an empty transcript.
 * Saves:  storage/evaluations/<sessionId|timestamp>-eval.json
 */

import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { chatCompletion, type ChatMessage } from "@/lib/openRouterClient";
import { readSession } from "@/lib/sessions";
import { verifyInvite } from "@/lib/invites";
import { extractCvText } from "@/lib/cvExtract";
import { retrieveCompanyContext } from "@/lib/lightRagService";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Load an existing evaluation by sessionId. Includes historyCount in response. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId query param required" }, { status: 400 });
  }
  const safe = sessionId.replace(/[^a-z0-9-]/gi, "").slice(0, 36);
  const file = path.join(EVALUATIONS_DIR, `${safe}-eval.json`);
  try {
    const raw = await fs.readFile(file, "utf8");
    const evaluation = JSON.parse(raw) as InterviewEvaluation;

    // Count archived versions for UI display
    let historyCount = 0;
    try {
      const histFile = path.join(EVALUATIONS_DIR, `${safe}-eval-history.json`);
      const histRaw = await fs.readFile(histFile, "utf8");
      const { history } = JSON.parse(histRaw) as { history: unknown[] };
      historyCount = Array.isArray(history) ? history.length : 0;
    } catch {
      // no history file yet
    }

    return NextResponse.json({ ok: true, ...evaluation, historyCount });
  } catch {
    return NextResponse.json({ ok: false, error: "No evaluation found" }, { status: 404 });
  }
}

const EVALUATIONS_DIR = path.join(process.cwd(), "storage", "evaluations");

// ─── Input types ─────────────────────────────────────────────────────

type AnswerInput = {
  questionId: string;
  type: string;
  section: string;
  question: string;
  transcript: string;
};

// ─── Output types ────────────────────────────────────────────────────

export type EvaluationCategory = {
  categoryName: string;
  rating: number; // 1–5
  comments: string;
  evidence: string;
  improvementNotes: string | null;
};

export type InterviewEvaluation = {
  companyId: string;
  role: string;
  level: string | null;
  evaluationType: "structured_interview_evaluation";
  sessionId: string | null;
  evaluatedAt: string;
  candidateName: string | null;
  interviewDate: string | null;
  categories: EvaluationCategory[];
  overallScore: number;
  overallSummary: string;
  recommendation: "Strong Hire" | "Hire" | "Move to Next Round" | "Needs Review" | "Do Not Proceed";
  recommendationNote: string;
  // Re-evaluation versioning (set on re-evaluations, absent on the first evaluation)
  evaluationVersion?: number;
  reevaluatedBy?: string | null;
  reevaluatedAt?: string | null;
  reevaluationReason?: string | null;
};

// ─── System prompt ────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────

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

  if (companyContext) {
    lines.push("=== COMPANY CONTEXT ===", companyContext.slice(0, 3000), "");
  }

  if (cvText) {
    lines.push("=== CANDIDATE CV ===", cvText.slice(0, 3000), "");
  }

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

function isEvaluatable(a: AnswerInput): boolean {
  if (a.type === "final_candidate_question") return false;
  if (a.section === "final_candidate_question") return false;
  return true;
}

async function saveEvaluation(
  evaluation: InterviewEvaluation,
  sessionId: string | null
): Promise<string> {
  await fs.mkdir(EVALUATIONS_DIR, { recursive: true });
  const slug = sessionId ?? `anon-${Date.now()}`;
  const filename = `${slug}-eval.json`;
  const file = path.join(EVALUATIONS_DIR, filename);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(evaluation, null, 2), "utf8");
  await fs.rename(tmp, file);
  return filename;
}

// ─── Route ────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: {
    companyId?: unknown;
    role?: unknown;
    level?: unknown;
    sessionId?: unknown;
    answers?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const companyId =
    typeof body.companyId === "string" && body.companyId.trim()
      ? body.companyId.trim()
      : "unknown";
  const role =
    typeof body.role === "string" && body.role.trim()
      ? body.role.trim()
      : "Software Engineer";
  const sessionId =
    typeof body.sessionId === "string" && body.sessionId.trim()
      ? body.sessionId.trim()
      : null;
  let level =
    typeof body.level === "string" && body.level.trim()
      ? body.level.trim()
      : null;

  if (!Array.isArray(body.answers) || body.answers.length === 0) {
    return NextResponse.json(
      { error: "`answers` must be a non-empty array" },
      { status: 400 }
    );
  }

  const rawAnswers = body.answers as AnswerInput[];
  const evaluatableAnswers = rawAnswers.filter(isEvaluatable);

  if (evaluatableAnswers.length === 0) {
    return NextResponse.json(
      { error: "No evaluatable answers found (all were final_candidate_question or empty)" },
      { status: 400 }
    );
  }

  // ── Fetch CV and company context ────────────────────────────────────
  let cvText: string | null = null;
  let companyContext: string | null = null;
  let interviewDate: string | null = null;

  // Look up CV: session-level CV takes priority over invite-level CV
  if (sessionId) {
    try {
      const session = await readSession(sessionId);
      // Use level from session if not explicitly provided in request body.
      if (!level && session?.interview_level) level = session.interview_level;
      if (session?.started_at) interviewDate = session.started_at;

      if (session?.cvFilename) {
        cvText = await extractCvText(session.cvFilename);
        if (cvText) console.log(`[Evaluate] loaded session CV: ${session.cvFilename} (${cvText.length} chars)`);
        else console.warn(`[Evaluate] session CV found but could not extract text: ${session.cvFilename}`);
      } else if (session?.invite_token) {
        const { invite } = await verifyInvite(session.invite_token);
        if (invite?.cvFilename) {
          cvText = await extractCvText(invite.cvFilename);
          if (cvText) console.log(`[Evaluate] loaded invite CV: ${invite.cvFilename} (${cvText.length} chars)`);
          else console.warn(`[Evaluate] invite CV found but could not extract text: ${invite.cvFilename}`);
        }
      }
    } catch (err) {
      console.warn("[Evaluate] CV lookup failed:", err instanceof Error ? err.message : err);
    }
  }

  // Retrieve company context
  try {
    const retrieval = await retrieveCompanyContext(
      companyId === "unknown" ? "novaforge" : companyId,
      `${role} interview evaluation criteria responsibilities`
    );
    companyContext = retrieval.context;
    console.log(`[Evaluate] company context: ${retrieval.chunks.length} chunks via ${retrieval.method}`);
  } catch (err) {
    console.warn("[Evaluate] company context retrieval failed:", err instanceof Error ? err.message : err);
  }

  console.log(
    `[Evaluate] sessionId=${sessionId?.slice(0, 8) ?? "none"} ` +
      `companyId=${companyId} role=${role} ` +
      `answers=${rawAnswers.length} evaluatable=${evaluatableAnswers.length} ` +
      `cv=${cvText ? "yes" : "no"} companyCtx=${companyContext ? "yes" : "no"}`
  );

  const startMs = Date.now();
  try {
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(companyId, role, level, evaluatableAnswers, cvText, companyContext, interviewDate) },
    ];

    const result = await chatCompletion(messages, {
      temperature: 0.3,
      maxTokens: 4000,
    });

    const llm_ms = Date.now() - startMs;
    console.log(`[Evaluate] LLM responded in ${llm_ms}ms model=${result.model}`);

    // Parse LLM response — strip any accidental code fences
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
      console.error("[Evaluate] JSON parse failed:", jsonStr.slice(0, 400));
      throw new Error(
        `LLM returned invalid JSON: ${parseErr instanceof Error ? parseErr.message : "parse error"}`
      );
    }

    if (!Array.isArray(parsed.categories)) {
      throw new Error("LLM response missing `categories` array");
    }

    // Compute overallScore server-side as a safety net
    const computedScore = parsed.categories.length > 0
      ? Math.round((parsed.categories.reduce((sum, c) => sum + (c.rating ?? 3), 0) / parsed.categories.length) * 10) / 10
      : (parsed.overallScore ?? 0);

    const evaluation: InterviewEvaluation = {
      companyId,
      role,
      level,
      evaluationType: "structured_interview_evaluation",
      sessionId,
      evaluatedAt: new Date().toISOString(),
      candidateName: parsed.candidateName ?? null,
      interviewDate: interviewDate ?? null,
      categories: parsed.categories ?? [],
      overallScore: computedScore,
      overallSummary: parsed.overallSummary ?? "",
      recommendation: (parsed.recommendation as InterviewEvaluation["recommendation"]) ?? "Needs Review",
      recommendationNote:
        "This evaluation is AI-assisted. The recommendation is advisory only — the final hiring decision must be made by a human recruiter.",
    };

    const filename = await saveEvaluation(evaluation, sessionId);
    const total_ms = Date.now() - startMs;
    console.log(
      `[Evaluate] ✓ saved to ${filename} total=${total_ms}ms ` +
        `categories=${evaluation.categories.length} score=${evaluation.overallScore} recommendation=${evaluation.recommendation}`
    );

    return NextResponse.json({ ok: true, ...evaluation, savedAs: filename });
  } catch (err) {
    console.error(
      `[Evaluate] error after ${Date.now() - startMs}ms:`,
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to generate evaluation",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
