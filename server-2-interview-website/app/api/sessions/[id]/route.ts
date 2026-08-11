import { NextResponse } from "next/server";
import { readSession, deleteSession } from "@/lib/sessions";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const RECORDINGS_DIR = path.join(process.cwd(), "storage", "recordings");

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await readSession(id);
    if (!session) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json(session);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to read session",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Delete a session and its associated candidate recordings.
 * Server 1 TTS audio is NOT affected (lives on Server 1's filesystem).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await readSession(id);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Delete any candidate recordings linked to this session.
    let deletedRecordings = 0;
    for (const answer of session.answers) {
      if (answer.candidate_audio_filename) {
        try {
          await fs.unlink(path.join(RECORDINGS_DIR, answer.candidate_audio_filename));
          deletedRecordings++;
        } catch {
          // File may already be gone — continue.
        }
      }
    }

    await deleteSession(id);

    console.log(
      `[Session] deleted session=${id.slice(0, 8)} recordings_removed=${deletedRecordings}`
    );

    return NextResponse.json({ ok: true, deletedRecordings });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to delete session",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
