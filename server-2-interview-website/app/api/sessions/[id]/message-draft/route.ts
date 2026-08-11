/**
 * POST /api/sessions/[id]/message-draft
 *
 * Generates a candidate message draft based on the hiring decision.
 * Does NOT send automatically — returns draft text for recruiter review.
 *
 * Body: { decision: DecisionStatus, decisionNote?: string, candidateRole?: string, companyId?: string }
 */

import { NextResponse } from "next/server";
import { chatCompletion } from "@/lib/openRouterClient";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM_PROMPT = `You are an HR communications assistant. Write professional, warm, and genuine candidate messages.

Rules:
- Write in first person as if from the hiring team
- Keep it concise (3-5 sentences)
- Do not include subject line, greeting ("Dear [Name]"), or sign-off
- For positive outcomes (shortlisted/hired): be enthusiastic, explain next steps
- For rejection: be kind, encouraging, and clear without giving false hope
- Do not mention specific scores or AI evaluation
- Return only the message body text`;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  let body: {
    decision?: unknown;
    decisionNote?: unknown;
    candidateRole?: unknown;
    companyId?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const decision = typeof body.decision === "string" ? body.decision : "pending";
  const decisionNote =
    typeof body.decisionNote === "string" ? body.decisionNote.trim() : null;
  const candidateRole =
    typeof body.candidateRole === "string" ? body.candidateRole.trim() : "the position";
  const companyId =
    typeof body.companyId === "string" ? body.companyId.trim() : "our company";

  if (!["shortlisted", "hired", "rejected", "needs_review"].includes(decision)) {
    return NextResponse.json(
      { error: "Message drafts are only generated for shortlisted, hired, needs_review, or rejected decisions." },
      { status: 400 }
    );
  }

  let tone: string;
  let instruction: string;
  if (decision === "hired") {
    tone = "congratulatory and warm";
    instruction =
      `Write a message congratulating the candidate on being selected for the ${candidateRole} role at ${companyId}. ` +
      `Mention that the team will be in touch with next steps (offer letter / onboarding details).`;
  } else if (decision === "shortlisted") {
    tone = "positive and encouraging";
    instruction =
      `Write a message informing the candidate that they have been shortlisted for the ${candidateRole} role at ${companyId}. ` +
      `Explain that the team is very interested and will be in touch to schedule the next step.`;
  } else if (decision === "needs_review") {
    tone = "professional and transparent";
    instruction =
      `Write a message informing the candidate that their application for the ${candidateRole} role at ${companyId} is still under review. ` +
      `Thank them for their patience and say the team will be in touch soon with a final update.`;
  } else {
    tone = "respectful and kind";
    instruction =
      `Write a polite rejection message for the ${candidateRole} role at ${companyId}. ` +
      `Thank them sincerely for their time and interest. Be honest but encouraging — wish them well in their search.`;
  }

  const userPrompt = [
    `Decision: ${decision}`,
    decisionNote ? `Internal note (context only, do not repeat verbatim): ${decisionNote}` : null,
    ``,
    `Tone: ${tone}`,
    `Task: ${instruction}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await chatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { temperature: 0.7, maxTokens: 400 }
    );

    const draft = result.content.trim();
    console.log(
      `[MessageDraft] session=${sessionId.slice(0, 8)} decision=${decision} chars=${draft.length}`
    );
    return NextResponse.json({ ok: true, draft });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to generate draft",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
