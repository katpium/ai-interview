import { NextResponse } from "next/server";
import {
  readQuestionBank,
  listQuestionBanks,
  normalizeBank,
  checkInterviewReadiness,
} from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

/**
 * GET /api/question-bank?companyId=novaforge           → list all banks for company
 * GET /api/question-bank?companyId=novaforge&role=X&level=Y → load specific bank
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyId = searchParams.get("companyId") ?? "novaforge";
  const role      = searchParams.get("role")  ?? null;
  const level     = searchParams.get("level") ?? null;

  // If role is provided, load the specific bank
  if (role || level) {
    const raw = await readQuestionBank(companyId, role, level);
    if (!raw) {
      return NextResponse.json(
        { error: `No question bank found for "${companyId}" ${[level, role].filter(Boolean).join(" ")}` },
        { status: 404 }
      );
    }
    const bank = normalizeBank(raw);
    const readiness = checkInterviewReadiness(bank);
    return NextResponse.json({ ok: true, bank, readiness });
  }

  // No role/level → list all banks for this company
  const banks = await listQuestionBanks(companyId);
  return NextResponse.json({ ok: true, banks });
}
