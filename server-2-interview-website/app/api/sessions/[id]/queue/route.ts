import { NextResponse } from "next/server";
import {
  getQueueItem,
  peekQueueItem,
  getQueueSnapshot,
} from "@/lib/questionQueue";

export const dynamic = "force-dynamic";

/**
 * Query the per-session question queue.
 *
 *   GET /api/sessions/<id>/queue              → full queue snapshot
 *   GET /api/sessions/<id>/queue?q=2          → item for question 2 (non-blocking peek)
 *   GET /api/sessions/<id>/queue?q=2&wait=1   → item for question 2 (waits if preparing)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const qParam = url.searchParams.get("q");
  const wait = url.searchParams.get("wait") === "1";

  // Full snapshot
  if (!qParam) {
    const snapshot = getQueueSnapshot(id);
    if (!snapshot) {
      return NextResponse.json(
        { error: "Queue not found for session" },
        { status: 404 }
      );
    }
    return NextResponse.json(snapshot);
  }

  // Single question
  const questionNumber = parseInt(qParam, 10);
  if (isNaN(questionNumber) || questionNumber < 1) {
    return NextResponse.json(
      { error: "Invalid question number" },
      { status: 400 }
    );
  }

  if (wait) {
    // Blocking: waits for preparation to finish (with timeout).
    const item = await getQueueItem(id, questionNumber);
    if (!item) {
      return NextResponse.json(
        { error: "Question not found in queue" },
        { status: 404 }
      );
    }
    return NextResponse.json(item);
  }

  // Non-blocking peek.
  const item = peekQueueItem(id, questionNumber);
  if (!item) {
    return NextResponse.json(
      { error: "Question not found in queue" },
      { status: 404 }
    );
  }
  return NextResponse.json(item);
}
