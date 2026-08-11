import { NextResponse } from "next/server";
import { requestTts } from "@/lib/modelApi";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: {
    text?: unknown;
    voice?: unknown;
    speed?: unknown;
    question_id?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON" },
      { status: 400 }
    );
  }

  if (typeof body.text !== "string" || body.text.trim().length === 0) {
    return NextResponse.json(
      { error: "`text` is required and must be a non-empty string" },
      { status: 400 }
    );
  }

  const voice = typeof body.voice === "string" ? body.voice : undefined;
  const speed = typeof body.speed === "number" ? body.speed : undefined;
  const questionId =
    typeof body.question_id === "number" ? body.question_id : undefined;

  try {
    const result = await requestTts({ text: body.text, voice, speed });
    console.log(
      `[Server2 TTS] question_id=${questionId ?? "?"} duration=${result.timing.server2_to_server1_tts_ms}ms`
    );
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to generate speech from Server 1",
        detail: err instanceof Error ? err.message : "Unknown error",
      },
      { status: 502 }
    );
  }
}
