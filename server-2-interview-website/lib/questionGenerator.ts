/**
 * RAG-powered interview question generator.
 *
 * Given company context retrieved from the LightRAG knowledge layer, uses
 * deepseek/deepseek-v4-flash via OpenRouter to generate tailored Software
 * Engineer interview questions grounded in company knowledge.
 *
 * Falls back to mock generation if LLM call fails or is disabled.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { chatCompletion, type ChatMessage } from "@/lib/openRouterClient";
import roleContextRaw from "@/data/role-question-context.json";

const GENERATED_QUESTIONS_DIR = path.join(
  process.cwd(),
  "storage",
  "generated-questions"
);

export const DEFAULT_QUESTIONS_FILE = "demo-questions.json";

// The final stage is always the candidate asking questions. This text must
// stay exact — the interview room treats it as the candidate-question stage.
export const FINAL_CANDIDATE_QUESTION = "Do you have any questions for us?";

// ─── Interview config ─────────────────────────────────────────────────

export const INTERVIEW_CONFIG = {
  introCount: 1,
  behavioralCount: 3,
  technicalCount: 3,
  includeOpeningMessage: true,
  includeFinalCandidateQuestion: true,
  includeTransitionMessage: true,
  includeClosingMessage: true,
} as const;

export type InterviewConfig = {
  introCount: number;
  behavioralCount: number;
  technicalCount: number;
  includeOpeningMessage: boolean;
  includeFinalCandidateQuestion: boolean;
  includeTransitionMessage: boolean;
  includeClosingMessage: boolean;
};

// Spoken role label used in the opening message and the room UI.
export const INTERVIEW_ROLE = "Software Engineer";

export const OPENING_MESSAGE_TEXT =
  `Welcome to your AI interview for the ${INTERVIEW_ROLE} role.` +
  " I'll start with a short introduction question, then ask a few behavioral questions," +
  " followed by some technical questions. When you're ready, let's begin.";

// ─── Question bank types ──────────────────────────────────────────────

export type QuestionBankItemType =
  | "intro"
  | "behavioral"
  | "technical"
  | "final_candidate_question";

export type QuestionBankItemStatus = "draft" | "approved" | "rejected";

export type QuestionBankItem = {
  id: string;
  type: QuestionBankItemType;
  text: string;
  // Approval fields (added in review system)
  status: QuestionBankItemStatus;
  approved: boolean;
  editedText: string | null;
  role: string | null;    // role this question was generated for
  level: string | null;   // level this question was generated for
};

export type QuestionBank = {
  companyId: string;
  companyName?: string;
  role?: string | null;
  level?: string | null;
  source: string;
  status: "draft";
  generatedAt: string;
  questionBank: QuestionBankItem[];
};

// ─── Role-specific question context ──────────────────────────────────

export type RoleContext = {
  responsibilities: string[];
  collaborators: string[];
  behavioralScenarios: string[];
  technicalTopics: string[];
  requiredKeywords: string[];
  exampleGoodQuestions: {
    intro?: string[];
    behavioral?: string[];
    technical?: string[];
  };
};

const ROLE_CONTEXTS: Record<string, RoleContext> =
  roleContextRaw as Record<string, RoleContext>;

/** Generic question patterns that fail validation for ANY role. */
const GENERIC_BANNED_PATTERNS = [
  "describe a situation where you had to meet a tight deadline",
  "how do you handle disagreements with teammates",
  "what is your greatest strength",
  "what is your greatest weakness",
  "where do you see yourself in 5 years",
  "how do you handle stress",
  "tell me about a time you worked on a team",
  "why do you want to work here",
  "what motivates you",
  "describe your ideal work environment",
];

/**
 * Find role context by name.  Tries exact match first, then substring match
 * (so "Senior Software Engineer" matches "Software Engineer").
 * Returns null when no match is found.
 */
// Split a role label into words, treating hyphens and slashes as separators.
function roleWords(s: string): string[] {
  return s.toLowerCase().replace(/[-/]/g, " ").replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
}

export function getRoleContext(role: string | null): RoleContext | null {
  if (!role) return null;
  const normalized = role.toLowerCase().trim();

  // 1. Exact match
  for (const [key, ctx] of Object.entries(ROLE_CONTEXTS)) {
    if (key.toLowerCase() === normalized) return ctx as RoleContext;
  }

  // 2. Substring containment (original behaviour)
  for (const [key, ctx] of Object.entries(ROLE_CONTEXTS)) {
    const k = key.toLowerCase();
    if (normalized.includes(k) || k.includes(normalized)) return ctx as RoleContext;
  }

  // 3. Word-set match: every word in the JSON key must appear in the query
  //    ("QA / Test Engineer" matches "QA Engineer" because both "qa" and "engineer" are present)
  const queryWords = roleWords(normalized);
  for (const [key, ctx] of Object.entries(ROLE_CONTEXTS)) {
    const keyWordSet = roleWords(key);
    if (keyWordSet.length > 0 && keyWordSet.every(w => queryWords.includes(w))) {
      return ctx as RoleContext;
    }
  }

  return null;
}

/**
 * Validate a single generated question against the role context.
 * Intro questions only need to avoid generic banned patterns.
 * Behavioral and technical must also contain at least one role keyword.
 */
function validateQuestion(
  text: string,
  type: string,
  roleCtx: RoleContext,
): { valid: boolean; reason?: string } {
  const lower = text.toLowerCase();

  for (const pattern of GENERIC_BANNED_PATTERNS) {
    if (lower.includes(pattern)) {
      return { valid: false, reason: `matches banned generic pattern: "${pattern}"` };
    }
  }

  if (type === "intro" || type === "final_candidate_question") return { valid: true };

  const allKeywords = [...roleCtx.requiredKeywords, ...roleCtx.technicalTopics];
  const matched = allKeywords.find(kw => lower.includes(kw.toLowerCase()));
  if (!matched) {
    return {
      valid: false,
      reason: `missing role-specific keywords — expected at least one of: ${roleCtx.requiredKeywords.slice(0, 6).join(", ")}, ...`,
    };
  }
  return { valid: true };
}

// ─── Readiness check ──────────────────────────────────────────────────

export type ReadinessReport = {
  ready: boolean;
  approvedCounts: { intro: number; behavioral: number; technical: number; final: number; total: number };
  draftCounts:    { intro: number; behavioral: number; technical: number; final: number; total: number };
  rejectedCounts: { intro: number; behavioral: number; technical: number; final: number; total: number };
  required: { intro: number; behavioral: number; technical: number; final: number };
  missing: string[];
};

export function checkInterviewReadiness(
  bank: QuestionBank,
  config: typeof INTERVIEW_CONFIG = INTERVIEW_CONFIG
): ReadinessReport {
  const items = bank.questionBank.map(normalizeItem);
  const count = (arr: QuestionBankItem[], type: QuestionBankItemType, s: QuestionBankItemStatus) =>
    arr.filter(q => q.type === type && q.status === s).length;

  const approvedCounts = {
    intro:      count(items, "intro",      "approved"),
    behavioral: count(items, "behavioral", "approved"),
    technical:  count(items, "technical",  "approved"),
    final:      count(items, "final_candidate_question", "approved"),
    total:      items.filter(q => q.status === "approved").length,
  };
  const draftCounts = {
    intro:      count(items, "intro",      "draft"),
    behavioral: count(items, "behavioral", "draft"),
    technical:  count(items, "technical",  "draft"),
    final:      count(items, "final_candidate_question", "draft"),
    total:      items.filter(q => q.status === "draft").length,
  };
  const rejectedCounts = {
    intro:      count(items, "intro",      "rejected"),
    behavioral: count(items, "behavioral", "rejected"),
    technical:  count(items, "technical",  "rejected"),
    final:      count(items, "final_candidate_question", "rejected"),
    total:      items.filter(q => q.status === "rejected").length,
  };
  const required = {
    intro:      config.introCount,
    behavioral: config.behavioralCount,
    technical:  config.technicalCount,
    final:      config.includeFinalCandidateQuestion ? 1 : 0,
  };

  const missing: string[] = [];
  if (approvedCounts.intro      < required.intro)      missing.push(`${required.intro - approvedCounts.intro} more approved intro question(s)`);
  if (approvedCounts.behavioral < required.behavioral) missing.push(`${required.behavioral - approvedCounts.behavioral} more approved behavioral question(s)`);
  if (approvedCounts.technical  < required.technical)  missing.push(`${required.technical - approvedCounts.technical} more approved technical question(s)`);
  if (approvedCounts.final      < required.final)      missing.push(`${required.final - approvedCounts.final} more approved final candidate question(s)`);

  return { ready: missing.length === 0, approvedCounts, draftCounts, rejectedCounts, required, missing };
}

/** Fills in missing approval fields with safe defaults (backward compat). */
export function normalizeItem(q: Partial<QuestionBankItem> & Pick<QuestionBankItem, "id" | "type" | "text">): QuestionBankItem {
  return {
    ...q,
    status:     q.status     ?? "draft",
    approved:   q.approved   ?? false,
    editedText: q.editedText ?? null,
    role:       q.role       ?? null,
    level:      q.level      ?? null,
  };
}

export function normalizeBank(bank: QuestionBank): QuestionBank {
  return {
    ...bank,
    questionBank: bank.questionBank.map(normalizeItem),
  };
}

// ─── Interview sequence types ─────────────────────────────────────────

export type InterviewSequenceSection =
  | "opening"
  | "intro"
  | "behavioral"
  | "transition"
  | "technical"
  | "final_candidate_question"
  | "closing";

export type InterviewMessageType = "opening" | "transition" | "closing";

export type InterviewSequenceItem =
  | {
      kind: "question";
      section: InterviewSequenceSection;
      type: QuestionBankItemType;
      text: string;
      id: string;
    }
  | {
      kind: "message";
      section: "opening" | "transition" | "closing";
      type: InterviewMessageType;
      text: string;
    };

// ─── Legacy types (kept for backward compat) ─────────────────────────

export type GeneratedQuestionType =
  | "intro"
  | "technical"
  | "behavioral"
  | "learning"
  | "final_candidate_question";

export type GeneratedQuestion = {
  id: number;
  type: GeneratedQuestionType;
  text: string;
};

export type GeneratedQuestionSet = {
  company: string;
  role: string;
  source: string;
  status: string;
  questions: GeneratedQuestion[];
};

// Pull a "Label: value" line out of the retrieved context, if present.
function extractField(context: string, label: string): string | null {
  const re = new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, "im");
  const m = context.match(re);
  return m ? m[1].trim() : null;
}

const LLM_ENABLED = process.env.LIGHTRAG_ENABLED === "true";
const MOCK_QUESTIONS_ENABLED = process.env.MOCK_QUESTIONS === "true";

// ─── System prompt for question generation ───────────────────────────

const SYSTEM_PROMPT = `You are an expert technical interviewer at a technology company. Your job is to generate interview questions for a Software Engineer role.

You will be given company context retrieved from the company's knowledge base. Use this context to create questions that are:
1. Grounded in the company's actual products, tech stack, and culture
2. Relevant to a Software Engineer role
3. A mix of types: intro, technical, behavioral, and learning questions
4. Professional and clear

You MUST respond with ONLY valid JSON in this exact format (no markdown, no code fences):
{
  "company": "<company name>",
  "role": "Software Engineer",
  "questions": [
    { "id": 1, "type": "intro", "text": "..." },
    { "id": 2, "type": "technical", "text": "..." },
    { "id": 3, "type": "technical", "text": "..." },
    { "id": 4, "type": "technical", "text": "..." },
    { "id": 5, "type": "behavioral", "text": "..." },
    { "id": 6, "type": "behavioral", "text": "..." },
    { "id": 7, "type": "learning", "text": "..." },
    { "id": 8, "type": "final_candidate_question", "text": "Do you have any questions for us?" }
  ]
}

Rules:
- Generate exactly 8 questions
- Question types must be: 1 intro, 3 technical, 2 behavioral, 1 learning, 1 final_candidate_question
- The last question MUST always be exactly: "Do you have any questions for us?"
- Technical questions should reference the company's specific products, tech stack, or domain
- Behavioral questions should relate to the company's culture and values
- Do NOT include generic questions — tailor everything to the company context provided`;

/**
 * Generate interview questions using deepseek/deepseek-v4-flash via OpenRouter.
 * Falls back to mock generation if the LLM call fails.
 */
export async function generateQuestions(
  context: string
): Promise<GeneratedQuestionSet> {
  if (!LLM_ENABLED) {
    console.log("[QuestionGen] LLM disabled, using mock questions");
    return generateMockQuestions(context);
  }

  try {
    console.log("[QuestionGen] Generating questions with deepseek/deepseek-v4-flash...");

    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Here is the company context retrieved from our knowledge base:\n\n---\n${context}\n---\n\nBased on this context, generate 8 tailored interview questions for a Software Engineer position at this company. Remember to respond with ONLY valid JSON.`,
      },
    ];

    const result = await chatCompletion(messages, {
      temperature: 0.7,
      maxTokens: 2048,
    });

    // Parse the LLM response — strip code fences if present
    let jsonStr = result.content.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

    const parsed = JSON.parse(jsonStr) as {
      company: string;
      role: string;
      questions: GeneratedQuestion[];
    };

    // Ensure the last question is always the candidate question
    const questions = parsed.questions.map((q, i) => ({
      ...q,
      id: i + 1,
    }));

    // Make sure final question is the candidate question
    const lastQ = questions[questions.length - 1];
    if (lastQ) {
      lastQ.type = "final_candidate_question";
      lastQ.text = FINAL_CANDIDATE_QUESTION;
    }

    const questionSet: GeneratedQuestionSet = {
      company: parsed.company || "the company",
      role: parsed.role || "Software Engineer",
      source: "lightrag-llm",
      status: "generated",
      questions,
    };

    console.log(
      `[QuestionGen] ✓ Generated ${questions.length} questions for ${questionSet.company} (model: ${result.model})`
    );

    return questionSet;
  } catch (err) {
    console.error(
      "[QuestionGen] LLM generation failed, falling back to mock:",
      err instanceof Error ? err.message : err
    );
    return generateMockQuestions(context);
  }
}

/**
 * Mock fallback: Build a 6-question draft set from retrieved company context.
 * Used when LLM is disabled or fails.
 */
export function generateMockQuestions(context: string): GeneratedQuestionSet {
  const company =
    extractField(context, "Company Name") ??
    extractField(context, "Company") ??
    "the company";
  const role = "Software Engineer";

  const questions: GeneratedQuestion[] = [
    {
      id: 1,
      type: "intro",
      text: `Tell me about yourself and why you are interested in the ${role} role at ${company}.`,
    },
    {
      id: 2,
      type: "technical",
      text: "Describe a project where you solved a difficult technical problem.",
    },
    {
      id: 3,
      type: "technical",
      text: "Tell me about a time you worked with an API or connected two systems together.",
    },
    {
      id: 4,
      type: "behavioral",
      text: "Tell me about a time you worked with a team under pressure.",
    },
    {
      id: 5,
      type: "learning",
      text: "How do you approach learning a new technology?",
    },
    {
      id: 6,
      type: "final_candidate_question",
      text: FINAL_CANDIDATE_QUESTION,
    },
  ];

  return {
    company,
    role,
    source: "mock-rag",
    status: "draft",
    questions,
  };
}

// ─── Adaptive follow-up generation ───────────────────────────────────

export type AnsweredTurn = {
  question: string;
  transcript: string;
};

const FOLLOWUP_SYSTEM_PROMPT = `You are an expert technical interviewer at a technology company conducting a Software Engineer interview.

You will be given company context plus the questions already asked and the candidate's answers so far. Generate ONE natural follow-up interview question that:
1. Builds on what the candidate has said (probe deeper, clarify, or pivot to an untouched area)
2. Stays grounded in the company's products, tech stack, and culture from the context
3. Is professional, concise, and conversational

Respond with ONLY the question text — no preamble, no quotes, no JSON, no numbering.`;

/**
 * Generate a single adaptive follow-up question using the LLM, grounded in
 * the cached company RAG context and the conversation so far.
 * Falls back to a generic question if the LLM is disabled or fails.
 */
export async function generateFollowUpQuestion(
  context: string,
  history: AnsweredTurn[]
): Promise<{ text: string; model: string }> {
  if (!LLM_ENABLED) {
    return { text: mockFollowUpQuestion(history), model: "mock" };
  }

  try {
    const historyText =
      history.length > 0
        ? history
            .map(
              (h, i) =>
                `Q${i + 1}: ${h.question}\nA${i + 1}: ${
                  h.transcript || "(no answer recorded)"
                }`
            )
            .join("\n\n")
        : "(no questions answered yet)";

    const messages: ChatMessage[] = [
      { role: "system", content: FOLLOWUP_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Company context retrieved from our knowledge base:\n\n---\n${context}\n---\n\nConversation so far:\n\n${historyText}\n\nGenerate the next follow-up interview question.`,
      },
    ];

    const result = await chatCompletion(messages, {
      temperature: 0.8,
      maxTokens: 256,
    });

    // Strip stray quotes / leading numbering the model sometimes adds.
    const text = result.content
      .trim()
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/^\d+[.)]\s*/, "")
      .trim();

    return {
      text: text || mockFollowUpQuestion(history),
      model: result.model,
    };
  } catch (err) {
    console.error(
      "[QuestionGen] follow-up generation failed, using fallback:",
      err instanceof Error ? err.message : err
    );
    return { text: mockFollowUpQuestion(history), model: "mock-fallback" };
  }
}

function mockFollowUpQuestion(history: AnsweredTurn[]): string {
  const generic = [
    "Can you walk me through a technical decision you made and the trade-offs you considered?",
    "Tell me about a time you had to debug a particularly tricky issue. How did you approach it?",
    "How do you keep your skills current as technology evolves?",
  ];
  return generic[history.length % generic.length];
}

// ─── Answer evaluation ────────────────────────────────────────────────

export type AnswerEvaluation = {
  score: number; // 0-100
  feedback: string;
  model: string;
};

const EVAL_SYSTEM_PROMPT = `You are an expert technical interviewer evaluating a candidate's answer to a Software Engineer interview question.

You will be given company context, the question asked, and the candidate's transcribed answer. Score the answer from 0 to 100 and give one or two sentences of concise, constructive feedback.

You MUST respond with ONLY valid JSON (no markdown, no code fences):
{ "score": <0-100 integer>, "feedback": "<one or two sentences>" }`;

/**
 * Evaluate a candidate's answer using the LLM, grounded in company context.
 * Falls back to a neutral evaluation if the LLM is disabled or fails.
 */
export async function evaluateAnswer(
  context: string,
  question: string,
  transcript: string
): Promise<AnswerEvaluation> {
  if (!LLM_ENABLED) {
    return { score: 0, feedback: "Evaluation disabled (mock).", model: "mock" };
  }

  try {
    const messages: ChatMessage[] = [
      { role: "system", content: EVAL_SYSTEM_PROMPT },
      {
        role: "user",
        content: `Company context:\n\n---\n${context}\n---\n\nQuestion: ${question}\n\nCandidate answer: ${
          transcript || "(no answer recorded)"
        }\n\nEvaluate this answer. Respond with ONLY valid JSON.`,
      },
    ];

    const result = await chatCompletion(messages, {
      temperature: 0.3,
      maxTokens: 256,
    });

    let jsonStr = result.content.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
    const parsed = JSON.parse(jsonStr) as { score: number; feedback: string };

    return {
      score:
        typeof parsed.score === "number"
          ? Math.max(0, Math.min(100, Math.round(parsed.score)))
          : 0,
      feedback: parsed.feedback ?? "",
      model: result.model,
    };
  } catch (err) {
    console.error(
      "[QuestionGen] answer evaluation failed:",
      err instanceof Error ? err.message : err
    );
    return {
      score: 0,
      feedback: "Evaluation failed.",
      model: "mock-fallback",
    };
  }
}

export async function saveGeneratedQuestions(
  set: GeneratedQuestionSet,
  filename: string = DEFAULT_QUESTIONS_FILE
): Promise<string> {
  await fs.mkdir(GENERATED_QUESTIONS_DIR, { recursive: true });
  const file = path.join(GENERATED_QUESTIONS_DIR, filename);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(set, null, 2), "utf8");
  await fs.rename(tmp, file);
  return file;
}

export async function readGeneratedQuestions(
  filename: string = DEFAULT_QUESTIONS_FILE
): Promise<GeneratedQuestionSet | null> {
  try {
    const raw = await fs.readFile(
      path.join(GENERATED_QUESTIONS_DIR, filename),
      "utf8"
    );
    return JSON.parse(raw) as GeneratedQuestionSet;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// ─── Question bank generation ─────────────────────────────────────────

/** Which question types can be selectively generated (final_candidate_question is always added programmatically). */
export type GeneratableQuestionType = "intro" | "behavioral" | "technical";
export const ALL_GENERATABLE_TYPES: GeneratableQuestionType[] = ["intro", "behavioral", "technical"];

/**
 * Build a system prompt for question bank generation.
 * When roleCtx is provided the prompt includes role-specific responsibilities,
 * scenarios, required keywords, and example good questions so the LLM produces
 * concrete, role-grounded output instead of generic HR questions.
 */
function buildBankSystemPrompt(
  types: GeneratableQuestionType[],
  role: string | null,
  level: string | null,
  roleCtx: RoleContext | null,
): string {
  const sections: string[] = [];
  const exampleItems: string[] = [];

  if (types.includes("intro")) {
    sections.push(
      `1 INTRO question — self-introduction ONLY\n` +
      `  • Ask the candidate to introduce themselves: who they are, their background, and why they want this specific role\n` +
      `  • This is a warm opening — NOT a behavioral or technical question\n` +
      `  • Must invite the candidate to speak about themselves (e.g. "Tell me about yourself...", "Walk me through your background...")\n` +
      `  • Must reference the specific role by name\n` +
      `  • 1-2 sentences when spoken aloud\n` +
      `  • NEVER ask about a past situation, project, or technical topic — that belongs in behavioral or technical sections`
    );
    exampleItems.push(`    { "id": "intro-1", "type": "intro", "text": "..." }`);
  }

  if (types.includes("behavioral")) {
    sections.push(
      `10 BEHAVIORAL questions — each must target a DIFFERENT theme AND be specific to the role:\n` +
      `  b-1  Collaboration with a specific role collaborator (e.g. developer, PM, designer)\n` +
      `  b-2  Conflict or disagreement related to role-specific work\n` +
      `  b-3  Handling a constraint (technical, time, resource) in this role's context\n` +
      `  b-4  Taking ownership of a problem or failure in this role\n` +
      `  b-5  Learning a new tool, skill, or domain relevant to this role\n` +
      `  b-6  Giving or receiving feedback on role-specific work\n` +
      `  b-7  Improving a process or workflow specific to this role\n` +
      `  b-8  Communicating a role-specific technical or design decision to stakeholders\n` +
      `  b-9  Handling ambiguity or unclear requirements in a role-specific context\n` +
      `  b-10 A project in this role you are particularly proud of`
    );
    for (let i = 1; i <= 10; i++) {
      exampleItems.push(`    { "id": "b-${i}", "type": "behavioral", "text": "..." }`);
    }
  }

  if (types.includes("technical")) {
    sections.push(
      `9 TECHNICAL questions — scenario-based, role-specific, MUST cover 9 DIFFERENT areas.\n\n` +
      `  Each technical question must:\n` +
      `  • Name a specific, realistic scenario from this role's domain\n` +
      `  • Ask the candidate to walk through their approach or trade-offs\n` +
      `  • Reference role-specific tools, systems, or processes\n` +
      `  • Be 1-2 sentences — natural to speak aloud\n` +
      `  • Match the difficulty to the target level`
    );
    for (let i = 1; i <= 9; i++) {
      exampleItems.push(`    { "id": "t-${i}", "type": "technical", "text": "..." }`);
    }
  }

  const totalCount = (types.includes("intro") ? 1 : 0) +
    (types.includes("behavioral") ? 10 : 0) +
    (types.includes("technical") ? 9 : 0);

  // Build the role-specific context block
  let roleBlock = "";
  if (roleCtx && role) {
    const behavioralExamples = (roleCtx.exampleGoodQuestions.behavioral ?? []).slice(0, 2);
    const technicalExamples = (roleCtx.exampleGoodQuestions.technical ?? []).slice(0, 2);
    const introExamples = (roleCtx.exampleGoodQuestions.intro ?? []).slice(0, 1);

    roleBlock = `
═══ ROLE-SPECIFIC CONTEXT (REQUIRED) ═══
Role: ${[level, role].filter(Boolean).join(" ")}

Responsibilities:
${roleCtx.responsibilities.map(r => `  • ${r}`).join("\n")}

Works with:
${roleCtx.collaborators.map(c => `  • ${c}`).join("\n")}

Behavioral scenarios to draw from (use these as inspiration for behavioral questions):
${roleCtx.behavioralScenarios.map(s => `  • ${s}`).join("\n")}

Technical areas relevant to this role (use for technical questions):
${roleCtx.technicalTopics.map(t => `  • ${t}`).join("\n")}

REQUIRED: Every behavioral and technical question MUST include or clearly reference at least one of these role-specific keywords:
  ${roleCtx.requiredKeywords.join(", ")}

EXAMPLE GOOD QUESTIONS for this role:
${introExamples.length > 0 ? `Intro:\n  ✓ "${introExamples[0]}"` : ""}
${behavioralExamples.length > 0 ? `Behavioral:\n${behavioralExamples.map(q => `  ✓ "${q}"`).join("\n")}` : ""}
${technicalExamples.length > 0 ? `Technical:\n${technicalExamples.map(q => `  ✓ "${q}"`).join("\n")}` : ""}

AVOID — these generic patterns will be REJECTED:
  ✗ "Describe a situation where you had to meet a tight deadline."
  ✗ "How do you handle disagreements with teammates?"
  ✗ "Tell me about a time you worked on a team."
  ✗ "What is your greatest strength or weakness?"
  Every question MUST be grounded in the role's specific work, tools, collaborators, or scenarios.
`;
  }

  return `You are an expert technical interviewer. Generate exactly ${totalCount} interview question${totalCount !== 1 ? "s" : ""} for the given role and level.
${roleBlock}
═══ HOW TO USE COMPANY CONTEXT ═══
Use company context ONLY to understand:
  • The general technology domain (web, mobile, data/ML, infrastructure, etc.)
  • Company culture, values, and engineering practices
  • The type of problems this role solves at the company

DO NOT reference specific internal projects, codebases, proprietary tools, or product names.
Questions must test transferable professional skills — not insider knowledge.

═══ LEVEL CALIBRATION ═══
  • Junior / Entry-level  → fundamentals, learning speed, basic debugging
  • Mid / Mid-level       → independent delivery, code quality, API integration, code reviews
  • Senior               → system design, trade-offs, reliability, mentoring
  • Staff / Lead / Principal → architectural decisions, cross-team impact, technical direction

═══ GENERATE THE FOLLOWING ═══
${sections.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}

Respond with ONLY valid JSON (no markdown, no code fences, no commentary):
{
  "companyName": "<company name from context, or omit if unclear>",
  "questionBank": [
${exampleItems.join(",\n")}
  ]
}`;
}


/** Batch-rewrite failing questions with a targeted role-specific LLM call. */
async function rewriteFailingQuestions(
  failing: Array<{ item: QuestionBankItem; reason: string }>,
  role: string | null,
  level: string | null,
  roleCtx: RoleContext,
): Promise<QuestionBankItem[]> {
  const roleLabel = [level, role].filter(Boolean).join(" ") || "the role";
  const keywordSample = roleCtx.requiredKeywords.slice(0, 8).join(", ");

  const systemPrompt =
    `You are an expert technical interviewer. Rewrite each generic question to be specific to the "${roleLabel}" role.\n` +
    `Each rewritten question MUST:\n` +
    `  - Reference the role's specific work, collaborators, tools, or scenarios\n` +
    `  - Include at least one of these role keywords: ${keywordSample}\n` +
    `  - Be 1-2 sentences, natural to speak aloud in an interview\n` +
    `  - NOT be a generic HR question\n\n` +
    `Return ONLY valid JSON:\n` +
    `{ "rewrites": [ { "id": "<original id>", "type": "<original type>", "text": "<rewritten question>" } ] }`;

  const userLines = [
    `Role: ${roleLabel}`,
    `Responsibilities: ${roleCtx.responsibilities.slice(0, 4).join("; ")}`,
    `Works with: ${roleCtx.collaborators.join(", ")}`,
    `Scenarios: ${roleCtx.behavioralScenarios.slice(0, 3).join("; ")}`,
    `Technical areas: ${roleCtx.technicalTopics.slice(0, 5).join(", ")}`,
    ``,
    `Questions to rewrite (${failing.length}):`,
    ...failing.map((f, i) =>
      `${i + 1}. [${f.item.type}] id="${f.item.id}" | original: "${f.item.text}" | problem: ${f.reason}`
    ),
    ``,
    `Rewrite each question. Return JSON only.`,
  ];

  try {
    const result = await chatCompletion(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userLines.join("\n") },
      ],
      { temperature: 0.7, maxTokens: 2000 }
    );

    let jsonStr = result.content.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/i, "");
    const parsed = JSON.parse(jsonStr) as {
      rewrites: Array<{ id: string; type: string; text: string }>;
    };

    const validTypes = new Set(["intro", "behavioral", "technical", "final_candidate_question"]);
    return parsed.rewrites.map((r, idx): QuestionBankItem => ({
      id: r.id || `rewrite-${idx}`,
      type: (validTypes.has(r.type) ? r.type : "behavioral") as QuestionBankItemType,
      text: r.text,
      status: "draft",
      approved: false,
      editedText: null,
      role: role ?? null,
      level: level ?? null,
    }));
  } catch (err) {
    console.error("[QuestionGen] Rewrite call failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

function shuffleArray<T>(arr: T[]): T[] {
  const result = [...arr];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function generateMockQuestionBank(
  context: string,
  companyId?: string,
  role?: string | null,
  level?: string | null,
  types: GeneratableQuestionType[] = ALL_GENERATABLE_TYPES
): QuestionBank {
  const company =
    extractField(context, "Company Name") ??
    extractField(context, "Company") ??
    "the company";

  const mkItem = (id: string, type: QuestionBankItemType, text: string): QuestionBankItem => ({
    id, type, text,
    status: "draft", approved: false, editedText: null,
    role: role ?? null, level: level ?? null,
  });

  const bank: QuestionBankItem[] = [
    mkItem("intro-1", "intro", `Tell me about yourself and why you are interested in working at ${company}.`),
    mkItem("b-1", "behavioral", "Tell me about a time you worked with a team under pressure."),
    mkItem("b-2", "behavioral", "Describe a situation where you had to meet a tight deadline."),
    mkItem("b-3", "behavioral", "Tell me about a time you had to learn a new technology quickly."),
    mkItem("b-4", "behavioral", "How do you handle disagreements with teammates?"),
    mkItem("b-5", "behavioral", "Describe a project you are particularly proud of and why."),
    mkItem("b-6", "behavioral", "Tell me about a time you received critical feedback and how you responded."),
    mkItem("b-7", "behavioral", "Describe a situation where you took ownership of a difficult problem."),
    mkItem("b-8", "behavioral", "Tell me about a time you had to balance multiple competing priorities."),
    mkItem("b-9", "behavioral", "How do you approach communicating technical concepts to non-technical stakeholders?"),
    mkItem("b-10", "behavioral", "Tell me about a time you improved an existing process or workflow."),
    mkItem("t-1", "technical", "Describe a project where you solved a difficult technical problem."),
    mkItem("t-2", "technical", "Tell me about a time you worked with an API or connected two systems together."),
    mkItem("t-3", "technical", "How do you approach debugging a production issue?"),
    mkItem("t-4", "technical", "Describe your experience with version control and code review practices."),
    mkItem("t-5", "technical", "How do you ensure the quality and reliability of the code you write?"),
    mkItem("t-6", "technical", "Tell me about a time you had to optimize the performance of a system."),
    mkItem("t-7", "technical", "How do you approach designing a new feature from scratch?"),
    mkItem("t-8", "technical", "Describe your experience with testing strategies and test coverage."),
    mkItem("t-9", "technical", "Tell me about a challenging technical decision you made and the trade-offs you considered."),
    mkItem("fcq-1", "final_candidate_question", FINAL_CANDIDATE_QUESTION),
  ];

  // Filter to only the requested types, always keep final_candidate_question
  const filtered = bank.filter(
    (q) => types.includes(q.type as GeneratableQuestionType) || q.type === "final_candidate_question"
  );

  return {
    companyId: companyId ?? company.toLowerCase().replace(/\s+/g, "-"),
    companyName: company !== "the company" ? company : undefined,
    role: role ?? INTERVIEW_ROLE,
    level: level ?? null,
    source: "mock",
    status: "draft",
    generatedAt: new Date().toISOString(),
    questionBank: filtered,
  };
}

export async function generateQuestionBank(
  context: string,
  companyId: string,
  role?: string | null,
  level?: string | null,
  types: GeneratableQuestionType[] = ALL_GENERATABLE_TYPES,
): Promise<QuestionBank> {
  const effectiveTypes = types.length > 0 ? types : ALL_GENERATABLE_TYPES;
  const roleLabel = [level, role].filter(Boolean).join(" ") || INTERVIEW_ROLE;
  const typeLabel = effectiveTypes.join(", ");

  // ── Role context ──────────────────────────────────────────────────────
  const roleCtx = getRoleContext(role ?? null);
  console.log(`[QuestionGen] role="${role ?? "none"}" level="${level ?? "none"}" sections=[${typeLabel}]`);
  if (role && !roleCtx) {
    const msg = `No role context found for "${role}". Add it to data/role-question-context.json to generate role-specific questions.`;
    console.error(`[QuestionGen] ✗ ${msg}`);
    throw new Error(msg);
  }
  if (roleCtx) {
    console.log(`[QuestionGen] ✓ Role context loaded — keywords: ${roleCtx.requiredKeywords.slice(0, 6).join(", ")}, ...`);
  } else {
    console.log(`[QuestionGen] No role specified — generating without role context`);
  }

  if (!LLM_ENABLED) {
    if (MOCK_QUESTIONS_ENABLED) {
      console.log("[QuestionGen] LLM disabled, MOCK_QUESTIONS=true — using mock question bank");
      return generateMockQuestionBank(context, companyId, role, level, effectiveTypes);
    }
    console.error("[QuestionGen] LLM disabled (LIGHTRAG_ENABLED != true)");
    console.error("[QuestionGen] Mock fallback disabled for real generation");
    console.error("[QuestionGen] No questions saved");
    throw new Error("LLM_DISABLED");
  }

  try {
    console.log(`[QuestionGen] Calling LLM for [${typeLabel}] questions — ${roleLabel}...`);

    const levelNote = level
      ? `Level: ${level} — calibrate question depth and expectations accordingly.`
      : "Level: not specified — use mid-level as the default baseline.";

    const messages: ChatMessage[] = [
      { role: "system", content: buildBankSystemPrompt(effectiveTypes, role ?? null, level ?? null, roleCtx) },
      {
        role: "user",
        content: [
          `Company context (use for culture/domain understanding only — do NOT reference specific internal projects or tools by name):`,
          `---`,
          context,
          `---`,
          ``,
          `Target role: ${roleLabel}`,
          levelNote,
          ``,
          `Generate ONLY the following question types: ${effectiveTypes.join(" + ")}.`,
          roleCtx
            ? `Every question MUST reference the role's specific work, collaborators, tools, or scenarios. Do NOT produce generic questions.`
            : `Questions must be scenario-based and level-appropriate.`,
          `Return ONLY valid JSON.`,
        ].filter(Boolean).join("\n"),
      },
    ];

    const result = await chatCompletion(messages, {
      temperature: 0.7,
      maxTokens: effectiveTypes.length === 1 && effectiveTypes[0] === "intro" ? 512 : 4096,
    });

    let jsonStr = result.content.trim();
    jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");

    const parsed = JSON.parse(jsonStr) as {
      companyName?: string;
      questionBank: Array<{ id?: string; type?: string; text: string }>;
    };

    const validTypes = new Set(["intro", "behavioral", "technical", "final_candidate_question"]);
    let bankItems: QuestionBankItem[] = parsed.questionBank
      .filter((q) => effectiveTypes.includes((q.type ?? "") as GeneratableQuestionType))
      .map((q, i) => ({
        id: q.id || `q-${i + 1}`,
        type: (validTypes.has(q.type ?? "") ? q.type : "behavioral") as QuestionBankItemType,
        text: q.text,
        status: "draft" as QuestionBankItemStatus,
        approved: false,
        editedText: null,
        role: role ?? null,
        level: level ?? null,
      }));

    // ── Validation + rewrite ──────────────────────────────────────────
    if (roleCtx) {
      const passed: QuestionBankItem[] = [];
      const toRewrite: Array<{ item: QuestionBankItem; reason: string }> = [];

      for (const item of bankItems) {
        const check = validateQuestion(item.text, item.type, roleCtx);
        if (check.valid) {
          console.log(`[QuestionGen] ✓ PASS [${item.type}] "${item.text.slice(0, 70)}..."`);
          passed.push(item);
        } else {
          console.log(`[QuestionGen] ✗ FAIL [${item.type}] "${item.text.slice(0, 70)}" — ${check.reason}`);
          toRewrite.push({ item, reason: check.reason ?? "failed validation" });
        }
      }

      if (toRewrite.length > 0) {
        console.log(`[QuestionGen] ✎ Rewriting ${toRewrite.length} questions via second LLM call...`);
        const rewrites = await rewriteFailingQuestions(toRewrite, role ?? null, level ?? null, roleCtx);

        let rewritePass = 0;
        let rewriteFail = 0;
        for (const rewrite of rewrites) {
          const check = validateQuestion(rewrite.text, rewrite.type, roleCtx);
          if (check.valid) {
            console.log(`[QuestionGen] ✓ REWRITE PASS [${rewrite.type}] "${rewrite.text.slice(0, 70)}..."`);
            passed.push(rewrite);
            rewritePass++;
          } else {
            console.log(`[QuestionGen] ✗ REWRITE FAIL [${rewrite.type}] "${rewrite.text.slice(0, 70)}" — discarded`);
            rewriteFail++;
          }
        }
        console.log(`[QuestionGen] Rewrite summary: ${rewritePass} saved, ${rewriteFail} discarded`);
      }

      bankItems = passed;
    }

    // Always add final_candidate_question programmatically
    bankItems.push({
      id: "fcq-1",
      type: "final_candidate_question",
      text: FINAL_CANDIDATE_QUESTION,
      status: "draft",
      approved: false,
      editedText: null,
      role: role ?? null,
      level: level ?? null,
    });

    const bank: QuestionBank = {
      companyId,
      companyName: parsed.companyName ?? undefined,
      role: role ?? INTERVIEW_ROLE,
      level: level ?? null,
      source: "rag-llm",
      status: "draft",
      generatedAt: new Date().toISOString(),
      questionBank: bankItems,
    };

    console.log(
      `[QuestionGen] ✓ Done — [${typeLabel}] ${bankItems.length} questions saved for ${companyId} (model: ${result.model})`
    );
    return bank;
  } catch (err) {
    // Always re-throw — role context errors and LLM_DISABLED are already specific
    if (err instanceof Error && (
      err.message.startsWith("No role context found") ||
      err.message === "LLM_DISABLED"
    )) throw err;

    console.error("[QuestionGen] OpenRouter generation failed:", err instanceof Error ? err.message : err);

    if (MOCK_QUESTIONS_ENABLED) {
      console.warn("[QuestionGen] MOCK_QUESTIONS=true — using mock question bank as fallback");
      return generateMockQuestionBank(context, companyId, role, level, effectiveTypes);
    }

    console.error("[QuestionGen] Mock fallback disabled for real generation");
    console.error("[QuestionGen] No questions saved");
    throw Object.assign(
      new Error("OPENROUTER_FAILED"),
      { cause: err }
    );
  }
}

export function buildOpeningText(role?: string | null, level?: string | null): string {
  const roleLabel = [level, role].filter(Boolean).join(" ") || INTERVIEW_ROLE;
  return (
    `Welcome to your AI interview for the ${roleLabel} role.` +
    " I'll start with a short introduction question, then ask a few behavioral questions," +
    " followed by some technical questions. When you're ready, let's begin."
  );
}

export function buildInterviewSequence(
  bank: QuestionBank,
  config: InterviewConfig = INTERVIEW_CONFIG,
  options?: { role?: string | null; level?: string | null; approvedOnly?: boolean }
): InterviewSequenceItem[] {
  const {
    introCount,
    behavioralCount,
    technicalCount,
    includeOpeningMessage,
    includeFinalCandidateQuestion,
    includeTransitionMessage,
    includeClosingMessage,
  } = config;

  // Normalize items to get approval fields.
  const allItems = bank.questionBank.map(normalizeItem);
  const approvedOnly = options?.approvedOnly ?? false;

  // Helper: get the display text for a question (editedText takes priority).
  const getText = (q: QuestionBankItem) => q.editedText?.trim() || q.text;

  // Filter by approval status.
  const filter = (items: QuestionBankItem[]) =>
    approvedOnly ? items.filter(q => q.approved) : items;

  const intros = filter(allItems.filter(q => q.type === "intro"));
  const behaviorals = shuffleArray(filter(allItems.filter(q => q.type === "behavioral")));
  const technicals = shuffleArray(filter(allItems.filter(q => q.type === "technical")));
  const finalQ = filter(allItems.filter(q => q.type === "final_candidate_question"))[0];

  // Strict mode: throw if not enough approved questions.
  if (approvedOnly) {
    const role  = options?.role  ?? bank.role  ?? "";
    const level = options?.level ?? bank.level ?? "";
    const label = [level, role].filter(Boolean).join(" ");
    if (intros.length      < introCount)      throw Object.assign(new Error(`Not enough approved intro questions`),      { code: "NOT_ENOUGH_QUESTIONS", type: "intro",      required: introCount,      available: intros.length,      role, level, label });
    if (behaviorals.length < behavioralCount) throw Object.assign(new Error(`Not enough approved behavioral questions`), { code: "NOT_ENOUGH_QUESTIONS", type: "behavioral", required: behavioralCount, available: behaviorals.length, role, level, label });
    if (technicals.length  < technicalCount)  throw Object.assign(new Error(`Not enough approved technical questions`),  { code: "NOT_ENOUGH_QUESTIONS", type: "technical",  required: technicalCount,  available: technicals.length,  role, level, label });
    if (includeFinalCandidateQuestion && !finalQ) throw Object.assign(new Error(`No approved final candidate question`), { code: "NOT_ENOUGH_QUESTIONS", type: "final_candidate_question", required: 1, available: 0, role, level, label });
  } else {
    if (intros.length < introCount)           console.warn(`[QuestionBank] Only ${intros.length} intro questions, need ${introCount}`);
    if (behaviorals.length < behavioralCount) console.warn(`[QuestionBank] Only ${behaviorals.length} behavioral questions, need ${behavioralCount}`);
    if (technicals.length < technicalCount)   console.warn(`[QuestionBank] Only ${technicals.length} technical questions, need ${technicalCount}`);
  }

  const sequence: InterviewSequenceItem[] = [];

  // Opening message — uses dynamic role + level when provided
  if (includeOpeningMessage) {
    sequence.push({
      kind: "message",
      section: "opening",
      type: "opening",
      text: buildOpeningText(options?.role ?? bank.role, options?.level ?? bank.level),
    });
  }

  // Intro
  for (let i = 0; i < Math.min(introCount, intros.length); i++) {
    sequence.push({ kind: "question", section: "intro", type: "intro", text: getText(intros[i]), id: intros[i].id });
  }

  // Behavioral
  for (let i = 0; i < Math.min(behavioralCount, behaviorals.length); i++) {
    sequence.push({ kind: "question", section: "behavioral", type: "behavioral", text: getText(behaviorals[i]), id: behaviorals[i].id });
  }

  // Transition message
  if (includeTransitionMessage) {
    sequence.push({
      kind: "message",
      section: "transition",
      type: "transition",
      text: "Thank you. Now we'll move on to some more technical questions.",
    });
  }

  // Technical
  for (let i = 0; i < Math.min(technicalCount, technicals.length); i++) {
    sequence.push({ kind: "question", section: "technical", type: "technical", text: getText(technicals[i]), id: technicals[i].id });
  }

  // Final candidate question
  if (includeFinalCandidateQuestion) {
    const text = finalQ ? getText(finalQ) : FINAL_CANDIDATE_QUESTION;
    const id = finalQ?.id ?? "fcq-1";
    sequence.push({ kind: "question", section: "final_candidate_question", type: "final_candidate_question", text, id });
  }

  // Closing message
  if (includeClosingMessage) {
    sequence.push({
      kind: "message",
      section: "closing",
      type: "closing",
      text: "Thank you for completing the interview. Your responses have been submitted.",
    });
  }

  return sequence;
}

// ─── Merge helpers ────────────────────────────────────────────────────

function normalizeText(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Merge freshly-generated items into an existing bank without destroying
 * approved questions.  New items are added only if their normalised text
 * doesn't already appear in the bank (skip duplicate questions).  Any ID
 * collision is resolved by appending a timestamp suffix.
 */
export function mergeNewQuestionsIntoBank(
  existing: QuestionBank,
  newItems: QuestionBankItem[],
): QuestionBank {
  const existingTexts = new Set(existing.questionBank.map(q => normalizeText(q.text)));
  const existingIds   = new Set(existing.questionBank.map(q => q.id));
  const ts = Date.now();

  const toAdd = newItems
    .filter(q => !existingTexts.has(normalizeText(q.text)))
    .map((q, i): QuestionBankItem => ({
      ...q,
      id:       existingIds.has(q.id) ? `${q.id}-${ts}-${i}` : q.id,
      status:   "draft",
      approved: false,
    }));

  console.log(`[QuestionBank] merge: ${existing.questionBank.length} existing + ${toAdd.length} new (${newItems.length - toAdd.length} duplicates skipped)`);

  return {
    ...existing,
    generatedAt: new Date().toISOString(), // bump timestamp
    questionBank: [...existing.questionBank, ...toAdd],
  };
}

/**
 * Replace draft questions for the given section types in an existing bank.
 * Approved questions are always preserved.
 * Used when regenerating a section so stale drafts are never kept.
 */
export function replaceSectionDraftsInBank(
  existing: QuestionBank,
  newItems: QuestionBankItem[],
  sectionTypes: GeneratableQuestionType[],
): QuestionBank {
  // Keep: questions whose type isn't being regenerated, OR approved questions of any type
  const kept = existing.questionBank.filter(
    q => !sectionTypes.includes(q.type as GeneratableQuestionType) || q.status === "approved"
  );
  const removedCount = existing.questionBank.length - kept.length;

  // Add newly generated items for the regenerated types (resolve ID collisions)
  const existingIds = new Set(kept.map(q => q.id));
  const ts = Date.now();
  const toAdd = newItems
    .filter(q => sectionTypes.includes(q.type as GeneratableQuestionType))
    .map((q, i): QuestionBankItem => ({
      ...q,
      id: existingIds.has(q.id) ? `${q.id}-${ts}-${i}` : q.id,
      status: "draft",
      approved: false,
    }));

  console.log(
    `[QuestionBank] cache-bust [${sectionTypes.join(", ")}]: removed ${removedCount} old draft${removedCount !== 1 ? "s" : ""}, added ${toAdd.length} new`
  );

  return {
    ...existing,
    generatedAt: new Date().toISOString(),
    questionBank: [...kept, ...toAdd],
  };
}

// ─── Rejected bank ────────────────────────────────────────────────────

export type RejectedBank = {
  companyId: string;
  role:  string | null;
  level: string | null;
  questions: QuestionBankItem[];
};

export function rejectedBankFilename(companyId: string, role?: string | null, level?: string | null): string {
  return `${bankSlug(companyId, role, level)}-rejected.json`;
}

export async function readRejectedBank(
  companyId: string,
  role?: string | null,
  level?: string | null,
): Promise<RejectedBank> {
  const filename = rejectedBankFilename(companyId, role, level);
  try {
    const raw = await fs.readFile(path.join(GENERATED_QUESTIONS_DIR, filename), "utf8");
    return JSON.parse(raw) as RejectedBank;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { companyId, role: role ?? null, level: level ?? null, questions: [] };
    }
    throw err;
  }
}

export async function saveRejectedBank(bank: RejectedBank): Promise<void> {
  await fs.mkdir(GENERATED_QUESTIONS_DIR, { recursive: true });
  const filename = rejectedBankFilename(bank.companyId, bank.role, bank.level);
  const file = path.join(GENERATED_QUESTIONS_DIR, filename);
  const tmp  = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(bank, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/** Stable slug used as part of the question-bank filename. */
export function bankSlug(companyId: string, role?: string | null, level?: string | null): string {
  const parts = [
    companyId.replace(/[^a-z0-9]/gi, "-").toLowerCase(),
    role  ? role.replace(/[^a-z0-9]/gi,  "-").toLowerCase() : "",
    level ? level.replace(/[^a-z0-9]/gi, "-").toLowerCase() : "",
  ].filter(Boolean);
  return parts.join("-");
}

export function bankFilename(companyId: string, role?: string | null, level?: string | null): string {
  return `${bankSlug(companyId, role, level)}-bank.json`;
}

export async function saveQuestionBank(bank: QuestionBank): Promise<string> {
  await fs.mkdir(GENERATED_QUESTIONS_DIR, { recursive: true });
  const filename = bankFilename(bank.companyId, bank.role, bank.level);
  const file = path.join(GENERATED_QUESTIONS_DIR, filename);
  const tmp  = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(bank, null, 2), "utf8");
  await fs.rename(tmp, file);
  return file;
}

export async function readQuestionBank(
  companyId: string,
  role?: string | null,
  level?: string | null
): Promise<QuestionBank | null> {
  const filename = bankFilename(companyId, role, level);
  try {
    const raw = await fs.readFile(path.join(GENERATED_QUESTIONS_DIR, filename), "utf8");
    return JSON.parse(raw) as QuestionBank;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export type QuestionBankSummary = {
  filename: string;
  companyId: string;
  companyName?: string;
  role: string | null;
  level: string | null;
  generatedAt: string;
  totalQuestions: number;
  approvedCount: number;
  readiness: ReadinessReport;
};

/** List all question banks for a company, newest first. */
export async function listQuestionBanks(companyId: string): Promise<QuestionBankSummary[]> {
  const slug = companyId.replace(/[^a-z0-9]/gi, "-").toLowerCase();
  let files: string[];
  try {
    const all = await fs.readdir(GENERATED_QUESTIONS_DIR);
    files = all.filter(f => f.startsWith(slug) && f.endsWith("-bank.json"));
  } catch {
    return [];
  }

  const summaries: QuestionBankSummary[] = [];
  for (const filename of files) {
    try {
      const raw = await fs.readFile(path.join(GENERATED_QUESTIONS_DIR, filename), "utf8");
      const bank = normalizeBank(JSON.parse(raw) as QuestionBank);
      const readiness = checkInterviewReadiness(bank);
      summaries.push({
        filename,
        companyId: bank.companyId,
        companyName: bank.companyName,
        role: bank.role ?? null,
        level: bank.level ?? null,
        generatedAt: bank.generatedAt,
        totalQuestions: bank.questionBank.length,
        approvedCount: bank.questionBank.filter(q => q.approved).length,
        readiness,
      });
    } catch {
      // skip corrupt files
    }
  }

  return summaries.sort((a, b) =>
    new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime()
  );
}
