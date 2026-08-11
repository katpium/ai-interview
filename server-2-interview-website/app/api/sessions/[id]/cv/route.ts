/**
 * POST /api/sessions/[id]/cv   — upload or replace a CV for a session
 * DELETE /api/sessions/[id]/cv — remove the attached CV
 *
 * Requires admin / recruiter / hr role.
 * Saves the file to storage/cvs/ and links it to the session via cvFilename.
 */

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifyToken, COOKIE_NAME } from "@/lib/auth";
import { readSession, updateSessionCv } from "@/lib/sessions";
import { saveCv, deleteCv } from "@/lib/cvExtract";

export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["admin", "recruiter", "hr"]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || !ALLOWED_ROLES.has(payload.role as string)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const session = await readSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("cv");
  if (!file || !(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No CV file provided" }, { status: 400 });
  }

  // Only delete the old file if it was uploaded for this session specifically
  // (i.e. NOT the invite-level CV which is shared and shouldn't be deleted here).
  if (session.cvFilename && session.cvFilename.startsWith(`session-${sessionId}`)) {
    await deleteCv(session.cvFilename);
  }

  // Save new CV using the session id as the token so the filename is unique
  const filename = await saveCv(file, `session-${sessionId}`);
  const updated = await updateSessionCv(sessionId, filename);

  return NextResponse.json({ ok: true, cvFilename: updated.cvFilename });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  const payload = token ? await verifyToken(token) : null;
  if (!payload || !ALLOWED_ROLES.has(payload.role as string)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: sessionId } = await params;
  const session = await readSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  if (session.cvFilename) {
    // Only delete the physical file if it belongs to this session (not an invite CV)
    if (session.cvFilename.startsWith(`session-${sessionId}`)) {
      await deleteCv(session.cvFilename);
    }
    await updateSessionCv(sessionId, null);
  }

  return NextResponse.json({ ok: true });
}
