import { NextResponse } from "next/server";
import { readRejectedBank, saveRejectedBank } from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

/** GET /api/question-bank/rejected?companyId=novaforge&role=X&level=Y */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId") ?? "novaforge";
  const role      = searchParams.get("role")  ?? null;
  const level     = searchParams.get("level") ?? null;

  const bank = await readRejectedBank(companyId, role, level);
  return NextResponse.json({ ok: true, ...bank });
}

/**
 * DELETE /api/question-bank/rejected?companyId=X&role=Y&level=Z
 * Permanently delete ALL rejected questions for a company/role/level (admin only).
 */
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId") ?? "novaforge";
  const role      = searchParams.get("role")  ?? null;
  const level     = searchParams.get("level") ?? null;

  const bank  = await readRejectedBank(companyId, role, level);
  const count = bank.questions.length;

  bank.questions = [];
  await saveRejectedBank(bank);

  console.log(`[QuestionBank] cleared all ${count} rejected questions for ${companyId} ${[level, role].filter(Boolean).join(" ")}`);
  return NextResponse.json({ ok: true, deletedCount: count });
}
