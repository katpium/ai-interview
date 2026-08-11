import { NextResponse } from "next/server";
import {
  readQuestionBank,
  saveQuestionBank,
  normalizeBank,
  readRejectedBank,
  saveRejectedBank,
  type QuestionBankItemStatus,
} from "@/lib/questionGenerator";

export const dynamic = "force-dynamic";

type Body = {
  companyId?: unknown;
  questionId?: unknown;
  text?: unknown;
  status?: unknown;
  role?: unknown;
  level?: unknown;
};

/**
 * PATCH /api/question-bank/question
 * Update a question's text or status.
 *
 * When status → "rejected":  remove from main bank, add to rejected bank.
 * When status → "draft":     if in rejected bank, restore to main bank.
 * When status → "approved":  set approved=true in main bank.
 */
export async function PATCH(req: Request) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const companyId  = typeof body.companyId  === "string" ? body.companyId.trim()  : "";
  const questionId = typeof body.questionId === "string" ? body.questionId.trim() : "";
  const role       = typeof body.role  === "string" ? body.role.trim()  || null : null;
  const level      = typeof body.level === "string" ? body.level.trim() || null : null;
  const newText    = typeof body.text   === "string" ? body.text.trim() : null;
  const newStatus  = typeof body.status === "string" ? body.status      : null;

  if (!companyId || !questionId) {
    return NextResponse.json({ error: "companyId and questionId are required" }, { status: 400 });
  }

  const validStatuses: QuestionBankItemStatus[] = ["draft", "approved", "rejected"];
  if (newStatus && !validStatuses.includes(newStatus as QuestionBankItemStatus)) {
    return NextResponse.json({ error: `Invalid status` }, { status: 400 });
  }

  // ── Reject: move from main bank → rejected bank ───────────────────
  if (newStatus === "rejected") {
    const raw = await readQuestionBank(companyId, role, level);
    if (!raw) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
    const bank = normalizeBank(raw);
    const idx  = bank.questionBank.findIndex(q => q.id === questionId);
    if (idx === -1) return NextResponse.json({ error: "Question not found" }, { status: 404 });

    const q = { ...bank.questionBank[idx], status: "rejected" as const, approved: false };
    bank.questionBank.splice(idx, 1); // remove from main bank
    await saveQuestionBank(bank);

    const rejected = await readRejectedBank(companyId, role, level);
    if (!rejected.questions.find(r => r.id === q.id)) rejected.questions.push(q);
    await saveRejectedBank(rejected);

    console.log(`[QuestionBank] rejected q=${questionId} company=${companyId}`);
    return NextResponse.json({ ok: true, question: q, movedToRejected: true });
  }

  // ── Restore from rejected → main bank as draft ───────────────────
  if (newStatus === "draft") {
    // Check rejected bank first
    const rejected = await readRejectedBank(companyId, role, level);
    const rejIdx = rejected.questions.findIndex(q => q.id === questionId);
    if (rejIdx >= 0) {
      const q = { ...rejected.questions[rejIdx], status: "draft" as const, approved: false };
      rejected.questions.splice(rejIdx, 1);
      await saveRejectedBank(rejected);

      const raw = await readQuestionBank(companyId, role, level);
      const bank = raw ? normalizeBank(raw) : null;
      if (bank) {
        if (!bank.questionBank.find(x => x.id === q.id)) bank.questionBank.push(q);
        await saveQuestionBank(bank);
      }
      console.log(`[QuestionBank] restored q=${questionId} from rejected → draft`);
      return NextResponse.json({ ok: true, question: q, restoredFromRejected: true });
    }
  }

  // ── Normal update in main bank ─────────────────────────────────────
  const raw = await readQuestionBank(companyId, role, level);
  if (!raw) return NextResponse.json({ error: "Question bank not found" }, { status: 404 });
  const bank = normalizeBank(raw);
  const idx  = bank.questionBank.findIndex(q => q.id === questionId);
  if (idx === -1) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  const q = bank.questionBank[idx];
  if (newText !== null)   q.editedText = newText || null;
  if (newStatus !== null) {
    q.status   = newStatus as QuestionBankItemStatus;
    q.approved = newStatus === "approved";
  }

  bank.questionBank[idx] = q;
  await saveQuestionBank(bank);
  console.log(`[QuestionBank] updated q=${questionId} status=${q.status} company=${companyId}`);
  return NextResponse.json({ ok: true, question: q });
}

/**
 * DELETE /api/question-bank/question
 * Permanently delete a question from the rejected bank (admin only — enforced by RBAC).
 * Body: { companyId, questionId, role?, level? }
 */
export async function DELETE(req: Request) {
  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const companyId  = typeof body.companyId  === "string" ? body.companyId.trim()  : "";
  const questionId = typeof body.questionId === "string" ? body.questionId.trim() : "";
  const role       = typeof body.role  === "string" ? body.role.trim()  || null : null;
  const level      = typeof body.level === "string" ? body.level.trim() || null : null;

  if (!companyId || !questionId) {
    return NextResponse.json({ error: "companyId and questionId are required" }, { status: 400 });
  }

  const rejected = await readRejectedBank(companyId, role, level);
  const before   = rejected.questions.length;
  rejected.questions = rejected.questions.filter(q => q.id !== questionId);

  if (rejected.questions.length === before) {
    return NextResponse.json({ error: "Question not found in rejected bank" }, { status: 404 });
  }

  await saveRejectedBank(rejected);
  console.log(`[QuestionBank] permanently deleted q=${questionId} from rejected bank company=${companyId}`);
  return NextResponse.json({ ok: true, deleted: questionId });
}
