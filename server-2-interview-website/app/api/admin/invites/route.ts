import { NextResponse } from "next/server";
import { listInvites, deleteInvite } from "@/lib/invites";

export const dynamic = "force-dynamic";

export async function GET() {
  const invites = await listInvites();
  return NextResponse.json({ invites });
}

/** DELETE { token } — permanently remove an invite link. */
export async function DELETE(req: Request) {
  let body: { token?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const deleted = await deleteInvite(token);
  if (!deleted) return NextResponse.json({ error: "Token not found" }, { status: 404 });

  console.log(`[Invites] deleted token=${token.slice(0, 8)}…`);
  return NextResponse.json({ ok: true });
}
