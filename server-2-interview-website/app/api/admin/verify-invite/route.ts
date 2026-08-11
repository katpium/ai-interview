import { NextResponse } from "next/server";
import { verifyInvite, consumeInvite } from "@/lib/invites";

export const dynamic = "force-dynamic";

/** GET ?token=xxx — check if a token is valid (does not consume it). */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });
  const result = await verifyInvite(token);
  return NextResponse.json(result);
}

/** POST { token } — validate AND consume a token (call once when interview starts). */
export async function POST(req: Request) {
  let body: { token?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  const { status, invite } = await verifyInvite(token);
  if (status !== "valid") {
    return NextResponse.json({ ok: false, status }, { status: 400 });
  }
  await consumeInvite(token);
  console.log(`[Invites] consumed token=${token.slice(0, 8)}… note="${invite?.candidateNote}"`);
  return NextResponse.json({ ok: true, status: "consumed", invite });
}
