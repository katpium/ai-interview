import { NextResponse } from "next/server";
import { completeSession } from "@/lib/sessions";
import { cleanupQueue, getEvaluations } from "@/lib/questionQueue";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await completeSession(id);
    // Read any background answer evaluations before tearing down the queue.
    const evaluations = getEvaluations(id);
    cleanupQueue(id);
    return NextResponse.json({ ...session, evaluations });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /not found/i.test(message) ? 404 : 500;
    return NextResponse.json(
      { error: "Failed to complete session", detail: message },
      { status }
    );
  }
}
