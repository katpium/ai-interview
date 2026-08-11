/**
 * PATCH /api/sessions/[id]/transcript
 *
 * Saves an edited transcript for one answer, preserving the original STT transcript.
 * Requires transcript:edit permission (admin, recruiter, hr).
 *
 * Body: { questionNumber: number, editedTranscript: string }
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { updateAnswerEdit } from "@/lib/sessions";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;

  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  let body: { questionNumber?: unknown; editedTranscript?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const questionNumber =
    typeof body.questionNumber === "number" && Number.isInteger(body.questionNumber)
      ? body.questionNumber
      : null;
  const editedTranscript =
    typeof body.editedTranscript === "string" ? body.editedTranscript : null;

  if (questionNumber === null || editedTranscript === null) {
    return NextResponse.json(
      { error: "questionNumber (integer) and editedTranscript (string) are required" },
      { status: 400 }
    );
  }

  try {
    const session = await updateAnswerEdit(
      sessionId,
      questionNumber,
      editedTranscript,
      payload.username as string
    );
    console.log(
      `[Transcript] edited session=${sessionId.slice(0, 8)} Q${questionNumber} by=${payload.username}`
    );
    return NextResponse.json({ ok: true, session });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: "Failed to update transcript", detail: msg }, { status });
  }
}
