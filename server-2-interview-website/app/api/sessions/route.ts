import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/lib/sessions";
import { INTERVIEW_QUESTIONS } from "@/lib/questions";
import { initSessionQueue } from "@/lib/questionQueue";
import { verifyInvite } from "@/lib/invites";
import { readDecision, type HiringDecision } from "@/lib/decisions";
import type { InterviewSequenceItem } from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

/** List all sessions, newest first. Enriches each session with invite CV info for display. */
export async function GET() {
  try {
    const sessions = await listSessions();
    // For sessions that have no session-level CV but have an invite token,
    // look up the invite's cvFilename so the UI can show the correct status.
    const enriched = await Promise.all(
      sessions.map(async (s) => {
        let result: typeof s & { inviteCvFilename?: string; hiringDecision?: HiringDecision | null } = s;
        if (!s.cvFilename && s.invite_token) {
          try {
            const { invite } = await verifyInvite(s.invite_token);
            if (invite?.cvFilename) {
              result = { ...result, inviteCvFilename: invite.cvFilename };
            }
          } catch { /* non-critical */ }
        }
        try {
          const decision = await readDecision(s.session_id);
          result = { ...result, hiringDecision: decision };
        } catch { /* non-critical */ }
        return result;
      })
    );
    return NextResponse.json({ sessions: enriched });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to list sessions", detail: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * Create a new interview session and initialize the per-session question
 * queue. Accepts an optional sequence (built by the front-end from
 * /api/questions) to ensure the queue pre-generates TTS for the exact same
 * questions the candidate sees.
 *
 * Body (optional):
 *   { "companyId": "novaforge", "sequence": InterviewSequenceItem[] }
 */
export async function POST(request: Request) {
  let companyId: string | undefined;
  let sequence: InterviewSequenceItem[] | null = null;
  let inviteToken: string | null = null;
  let interviewRole: string | null = null;
  let interviewLevel: string | null = null;

  try {
    const body = (await request.json()) as {
      companyId?: unknown;
      sequence?: unknown;
      inviteToken?: unknown;
      interviewRole?: unknown;
      interviewLevel?: unknown;
    };
    if (typeof body.companyId === "string" && body.companyId.trim()) {
      companyId = body.companyId.trim();
    }
    if (Array.isArray(body.sequence) && body.sequence.length > 0) {
      sequence = body.sequence as InterviewSequenceItem[];
    }
    if (typeof body.inviteToken === "string" && body.inviteToken.trim()) {
      inviteToken = body.inviteToken.trim();
    }
    if (typeof body.interviewRole === "string" && body.interviewRole.trim()) {
      interviewRole = body.interviewRole.trim();
    }
    if (typeof body.interviewLevel === "string" && body.interviewLevel.trim()) {
      interviewLevel = body.interviewLevel.trim();
    }
  } catch {
    // No body / not JSON — use defaults.
  }

  try {
    const answerableCount = sequence
      ? sequence.filter((i) => i.kind === "question").length
      : INTERVIEW_QUESTIONS.length;

    // Copy the invite's CV filename into the session so the evaluation can
    // find it directly without having to look up the invite every time.
    let cvFilenameFromInvite: string | null = null;
    if (inviteToken) {
      try {
        const { invite } = await verifyInvite(inviteToken);
        if (invite?.cvFilename) cvFilenameFromInvite = invite.cvFilename;
      } catch { /* non-critical */ }
    }

    const session = await createSession({
      questions_total: answerableCount,
      invite_token: inviteToken,
      interview_role: interviewRole,
      interview_level: interviewLevel,
      cvFilename: cvFilenameFromInvite,
    });

    const { questionsTotal } = await initSessionQueue(session.session_id, {
      companyId,
      sequence,
    });

    if (questionsTotal > 0 && questionsTotal !== session.questions_total) {
      session.questions_total = questionsTotal;
    }

    console.log(
      `[Session] created session=${session.session_id.slice(0, 8)} ` +
        `questions=${session.questions_total} queue=initialized ` +
        `company=${companyId ?? "default"} seq=${sequence?.length ?? "none"}`
    );

    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to create session",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
