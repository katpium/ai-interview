/**
 * GET  /api/sessions/[id]/decision — read current hiring decision
 * PUT  /api/sessions/[id]/decision — set hiring decision
 *
 * Requires decisions:read (GET) / decisions:write (PUT).
 * Technician can GET but not PUT (enforced by middleware RBAC).
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { readDecision, saveDecision, type DecisionStatus } from "@/lib/decisions";

export const dynamic = "force-dynamic";

const VALID_DECISIONS: DecisionStatus[] = [
  "pending",
  "needs_review",
  "shortlisted",
  "hired",
  "rejected",
];

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: sessionId } = await params;
  try {
    const decision = await readDecision(sessionId);
    return NextResponse.json({ ok: true, decision: decision ?? null });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to read decision", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}

export async function PUT(
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

  let body: { decision?: unknown; decisionNote?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const decision =
    typeof body.decision === "string" && VALID_DECISIONS.includes(body.decision as DecisionStatus)
      ? (body.decision as DecisionStatus)
      : null;

  if (!decision) {
    return NextResponse.json(
      { error: `decision must be one of: ${VALID_DECISIONS.join(", ")}` },
      { status: 400 }
    );
  }

  const decisionNote =
    typeof body.decisionNote === "string" && body.decisionNote.trim()
      ? body.decisionNote.trim()
      : null;

  const saved = {
    sessionId,
    decision,
    decisionBy: payload.username as string,
    decisionAt: new Date().toISOString(),
    decisionNote,
  };

  try {
    await saveDecision(saved);
    console.log(
      `[Decision] session=${sessionId.slice(0, 8)} decision=${decision} by=${payload.username}`
    );
    return NextResponse.json({ ok: true, decision: saved });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to save decision", detail: err instanceof Error ? err.message : "Unknown" },
      { status: 500 }
    );
  }
}
