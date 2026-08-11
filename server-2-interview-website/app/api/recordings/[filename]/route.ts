import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

const RECORDINGS_DIR = path.join(process.cwd(), "storage", "recordings");

function safeFilename(filename: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(filename);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!safeFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const file = path.join(RECORDINGS_DIR, filename);
  let buf: Buffer;
  try {
    buf = await fs.readFile(file);
  } catch {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  const ext = filename.split(".").pop() ?? "webm";
  const mime =
    ext === "mp4" ? "video/mp4" :
    ext === "ogg" ? "video/ogg" :
    ext === "wav" ? "audio/wav" :
    "video/webm";

  return new Response(buf, {
    headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" },
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  if (!safeFilename(filename)) {
    return NextResponse.json({ error: "Invalid filename" }, { status: 400 });
  }

  const file = path.join(RECORDINGS_DIR, filename);
  try {
    await fs.unlink(file);
    console.log(`[Recordings] deleted ${filename}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json({ error: "Recording not found" }, { status: 404 });
    }
    throw err;
  }
}
