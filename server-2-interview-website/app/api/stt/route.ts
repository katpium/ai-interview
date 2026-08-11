import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { requestStt } from "@/lib/modelApi";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RECORDINGS_DIR = path.join(process.cwd(), "storage", "recordings");

async function saveRecording(file: File | Blob, sessionId: string, questionId: string): Promise<string> {
  await fs.mkdir(RECORDINGS_DIR, { recursive: true });
  const ext = (file as File).name?.split(".").pop() ?? "webm";
  const safeSid = sessionId.replace(/[^a-z0-9-]/gi, "").slice(0, 36);
  const filename = `${safeSid}-q${questionId}-${randomUUID().slice(0, 8)}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(path.join(RECORDINGS_DIR, filename), buf);
  return filename;
}

export async function POST(req: Request) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    return NextResponse.json({ error: "Expected multipart/form-data with field `file`" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to parse multipart body", detail: err instanceof Error ? err.message : "Unknown error" },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "`file` field is required" }, { status: 400 });
  }

  const questionId = typeof form.get("question_id") === "string" ? (form.get("question_id") as string) : "?";
  const sessionId  = typeof form.get("session_id")  === "string" ? (form.get("session_id")  as string) : "";

  // Save candidate recording to disk before sending to STT.
  let recording_filename: string | null = null;
  if (sessionId) {
    try {
      recording_filename = await saveRecording(file as File, sessionId, questionId);
    } catch (err) {
      console.warn(`[STT] Failed to save recording: ${err instanceof Error ? err.message : err}`);
    }
  }

  try {
    const result = await requestStt(file as File);
    console.log(
      `[Server2 STT] question_id=${questionId} session=${sessionId.slice(0, 8) || "?"} ` +
        `duration=${result.timing.server2_to_server1_stt_ms}ms ` +
        `saved=${recording_filename ?? "no"}`
    );
    return NextResponse.json({ ...result, recording_filename });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to transcribe with Server 1", detail: err instanceof Error ? err.message : "Unknown error" },
      { status: 502 }
    );
  }
}
