import { NextResponse } from "next/server";
import { appendAnswer } from "@/lib/sessions";
import {
  advanceQueue,
  peekQueueItem,
  evaluateAnswerInBackground,
} from "@/lib/questionQueue";

export const dynamic = "force-dynamic";

type Body = {
  question_id?: unknown;
  question_number?: unknown;
  question_text?: unknown;
  question_kind?: unknown;
  transcript?: unknown;
  audio_filename?: unknown;
  candidate_audio_filename?: unknown;
};

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  if (
    typeof body.question_id !== "number" ||
    typeof body.question_number !== "number" ||
    typeof body.question_text !== "string" ||
    typeof body.transcript !== "string" ||
    (body.question_kind !== "interview" &&
      body.question_kind !== "candidate_question")
  ) {
    return NextResponse.json(
      {
        error:
          "question_id (number), question_number (number), question_text (string), question_kind ('interview' | 'candidate_question'), and transcript (string) are required",
      },
      { status: 400 }
    );
  }

  const audioFilename =
    typeof body.audio_filename === "string" ? body.audio_filename : null;
  const candidateAudioFilename =
    typeof body.candidate_audio_filename === "string" ? body.candidate_audio_filename : null;

  try {
    const session = await appendAnswer(id, {
      question_id: body.question_id,
      question_number: body.question_number,
      question_text: body.question_text,
      question_kind: body.question_kind,
      transcript: body.transcript,
      audio_filename: audioFilename,
      candidate_audio_filename: candidateAudioFilename,
    });

    // ── Background answer evaluation (non-blocking) ─────────────
    evaluateAnswerInBackground(
      id,
      body.question_number as number,
      body.question_text as string,
      body.transcript as string
    );

    // ── Advance queue: ensure next questions are being prepared ──
    const answeredNum = body.question_number as number;
    advanceQueue(id, answeredNum);

    // ── Return next question status from queue (non-blocking) ───
    const nextNum = answeredNum + 1;
    const nextItem = peekQueueItem(id, nextNum);

    console.log(
      `[Answer] session=${id.slice(0, 8)} q=${answeredNum} saved ` +
        `next_q=${nextNum} next_status=${nextItem?.status ?? "none"}`
    );

    return NextResponse.json(
      {
        ...session,
        nextQuestion: nextItem
          ? {
              questionNumber: nextItem.questionNumber,
              questionId: nextItem.questionId,
              status: nextItem.status,
              audioUrl: nextItem.status === "ready" ? nextItem.audioUrl : null,
              audioFilename:
                nextItem.status === "ready" ? nextItem.audioFilename : null,
              timing: nextItem.status === "ready" ? nextItem.timing : null,
              source: nextItem.source,
            }
          : null,
      },
      { status: 201 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const status = /not found/i.test(message)
      ? 404
      : /already completed/i.test(message)
        ? 409
        : 500;
    return NextResponse.json(
      { error: "Failed to append answer", detail: message },
      { status }
    );
  }
}
