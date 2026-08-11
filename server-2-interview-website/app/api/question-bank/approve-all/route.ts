import { NextResponse } from "next/server";
import { readQuestionBank, saveQuestionBank, normalizeBank, type QuestionBankItemType } from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

/**
 * POST /api/question-bank/approve-all
 * Body: { companyId, type? }  — approves all (or all of a type) questions.
 */
export async function POST(req: Request) {
  let body: { companyId?: unknown; type?: unknown; role?: unknown; level?: unknown };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const companyId  = typeof body.companyId === "string" ? body.companyId.trim() : "";
  const role       = typeof (body as { role?: unknown }).role  === "string" ? (body as { role: string }).role.trim()  || null : null;
  const level      = typeof (body as { level?: unknown }).level === "string" ? (body as { level: string }).level.trim() || null : null;
  const typeFilter = typeof body.type === "string" ? body.type.trim() : null;

  if (!companyId) return NextResponse.json({ error: "companyId required" }, { status: 400 });

  const raw = await readQuestionBank(companyId, role, level);
  if (!raw) return NextResponse.json({ error: `No question bank for "${companyId}"` }, { status: 404 });

  const bank = normalizeBank(raw);
  let count = 0;

  bank.questionBank = bank.questionBank.map(q => {
    if (typeFilter && q.type !== typeFilter) return q;
    if (q.status === "approved") return q;
    count++;
    return { ...q, status: "approved" as const, approved: true };
  });

  await saveQuestionBank(bank);
  console.log(`[QuestionBank] approve-all company=${companyId} type=${typeFilter ?? "all"} count=${count}`);
  return NextResponse.json({ ok: true, approvedCount: count });
}
