"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import AdminNav from "@/components/AdminNav";
import type {
  QuestionBankItem,
  QuestionBank,
  ReadinessReport,
  QuestionBankItemStatus,
  QuestionBankItemType,
  QuestionBankSummary,
  RejectedBank,
  GeneratableQuestionType,
} from "@/lib/questionGenerator";

// ─── Constants ────────────────────────────────────────────────────────

const INTERVIEW_LEVELS = ["Intern","Junior","Mid-level","Senior","Lead","Principal / Staff","Manager","Director"];
const INTERVIEW_ROLES  = [
  "Software Engineer","Backend Engineer","Frontend Engineer","Full Stack Engineer",
  "Web Developer","Mobile Developer (iOS/Android)","DevOps / Platform Engineer",
  "Machine Learning Engineer","Data Scientist","Data Analyst","QA / Test Engineer",
  "Security Engineer","Product Manager","UX / UI Designer","Business Analyst","Project Manager",
];

const SECTION_ORDER: QuestionBankItemType[] = ["intro","behavioral","technical","final_candidate_question"];
const SECTION_LABELS: Record<QuestionBankItemType, string> = {
  intro: "Introduction", behavioral: "Behavioral",
  technical: "Technical", final_candidate_question: "Final Candidate Question",
};
const STATUS_STYLES: Record<QuestionBankItemStatus, string> = {
  draft: "bg-neutral-700/50 text-neutral-300",
  approved: "bg-emerald-900/40 text-emerald-300",
  rejected: "bg-red-900/40 text-red-400",
};

// ─── Types ────────────────────────────────────────────────────────────

type AuthUser = { username: string; role: string };
type BankResponse = { bank: QuestionBank; readiness: ReadinessReport };

// ─── Readiness banner ─────────────────────────────────────────────────

function ReadinessBanner({ readiness, role, level }: { readiness: ReadinessReport; role?: string | null; level?: string | null }) {
  const label = [level, role].filter(Boolean).join(" ") || "this role";
  return (
    <div className={`rounded-xl border p-4 ${readiness.ready ? "border-emerald-700/40 bg-emerald-900/10" : "border-amber-700/40 bg-amber-900/10"}`}>
      <p className={`text-sm font-semibold ${readiness.ready ? "text-emerald-300" : "text-amber-300"}`}>
        {readiness.ready ? `✓ Ready for interview — ${label}` : `⚠ Not ready — ${label}`}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
        {(["intro","behavioral","technical","final_candidate_question"] as const).map(t => {
          const key = t === "final_candidate_question" ? "final" : t;
          const got  = readiness.approvedCounts[key as keyof typeof readiness.approvedCounts];
          const need = readiness.required[key as keyof typeof readiness.required];
          const ok   = (got as number) >= (need as number);
          return (
            <div key={t} className={ok ? "text-neutral-400" : "text-amber-400"}>
              {ok ? "✓" : "✗"} {SECTION_LABELS[t]}: {got}/{need}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-4 text-xs text-neutral-500">
        <span className="text-emerald-500">Approved: {readiness.approvedCounts.total}</span>
        <span>Draft: {readiness.draftCounts.total}</span>
        <span className="text-red-500">Rejected: {readiness.rejectedCounts.total}</span>
      </div>
    </div>
  );
}

// ─── Question card ─────────────────────────────────────────────────────

function QuestionCard({
  q, canApprove, onUpdate,
}: {
  q: QuestionBankItem;
  canApprove: boolean;
  onUpdate: (id: string, patch: { text?: string; status?: QuestionBankItemStatus }) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(q.editedText ?? q.text);
  const [saving, setSaving] = useState(false);

  const doUpdate = async (patch: { text?: string; status?: QuestionBankItemStatus }) => {
    setSaving(true);
    try { await onUpdate(q.id, patch); } finally { setSaving(false); }
  };

  const displayText = q.editedText ?? q.text;

  return (
    <div className={`rounded-lg border p-4 space-y-3 transition ${
      q.status === "approved" ? "border-emerald-800/40 bg-emerald-900/5"
      : q.status === "rejected" ? "border-red-900/40 bg-red-900/5 opacity-60"
      : "border-neutral-800 bg-neutral-900/40"
    }`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {editing ? (
            <textarea value={editText} onChange={e => setEditText(e.target.value)} rows={3}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none resize-y" />
          ) : (
            <p className="text-sm text-neutral-200 leading-relaxed">{displayText}</p>
          )}
          {q.editedText && !editing && (
            <p className="mt-1 text-xs text-neutral-600 italic line-clamp-1">Original: {q.text}</p>
          )}
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[q.status]}`}>
          {q.status}
        </span>
      </div>

      {canApprove && (
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <>
              <button type="button" disabled={saving} onClick={() => void doUpdate({ text: editText }).then(() => setEditing(false))}
                className="rounded-full bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
                {saving ? "Saving…" : "Save Edit"}
              </button>
              <button type="button" onClick={() => { setEditing(false); setEditText(q.editedText ?? q.text); }}
                className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:text-white">Cancel</button>
            </>
          ) : (
            <>
              {q.status !== "approved" && (
                <button type="button" disabled={saving} onClick={() => void doUpdate({ status: "approved" })}
                  className="rounded-full bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600 disabled:opacity-50">Approve</button>
              )}
              {q.status !== "rejected" && (
                <button type="button" disabled={saving} onClick={() => void doUpdate({ status: "rejected" })}
                  className="rounded-full bg-red-800 px-3 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">Reject</button>
              )}
              {q.status !== "draft" && (
                <button type="button" disabled={saving} onClick={() => void doUpdate({ status: "draft" })}
                  className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:text-white disabled:opacity-50">Reset</button>
              )}
              <button type="button" onClick={() => setEditing(true)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:text-white">Edit</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Section group ─────────────────────────────────────────────────────

function SectionGroup({ type, questions, canApprove, onUpdate, onApproveAll, onGenerate, generating }: {
  type: QuestionBankItemType;
  questions: QuestionBankItem[];
  canApprove: boolean;
  onUpdate: (id: string, patch: { text?: string; status?: QuestionBankItemStatus }) => Promise<void>;
  onApproveAll: (type: QuestionBankItemType) => Promise<void>;
  onGenerate?: () => Promise<void>;
  generating?: boolean;
}) {
  const [approving, setApproving] = useState(false);
  const approved  = questions.filter(q => q.status === "approved").length;
  const unapproved = questions.filter(q => q.status !== "approved").length;
  const hasQuestions = questions.length > 0;

  if (!hasQuestions && !onGenerate) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-400 shrink-0">
          {SECTION_LABELS[type]}
          {hasQuestions && (
            <span className="ml-2 font-normal normal-case text-neutral-600">
              {approved}/{questions.length} approved
            </span>
          )}
        </h3>
        <div className="flex items-center gap-3 ml-auto">
          {canApprove && unapproved > 0 && (
            <button type="button" disabled={approving}
              onClick={async () => { setApproving(true); try { await onApproveAll(type); } finally { setApproving(false); } }}
              className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50 whitespace-nowrap">
              {approving ? "Approving…" : "Approve all"}
            </button>
          )}
          {onGenerate && (
            <button type="button" disabled={generating}
              onClick={() => void onGenerate()}
              className="rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300 hover:border-indigo-500 hover:text-indigo-300 disabled:opacity-40 whitespace-nowrap transition">
              {generating ? "Generating…" : hasQuestions ? "Regenerate" : "Generate"}
            </button>
          )}
        </div>
      </div>
      {hasQuestions && (
        <div className="space-y-2">
          {questions.map(q => <QuestionCard key={q.id} q={q} canApprove={canApprove} onUpdate={onUpdate} />)}
        </div>
      )}
      {!hasQuestions && onGenerate && (
        <p className="text-xs text-neutral-600 italic">No questions yet — click Generate to create them.</p>
      )}
    </section>
  );
}

// ─── Bank list card ────────────────────────────────────────────────────

function BankCard({ summary, onSelect }: { summary: QuestionBankSummary; onSelect: () => void }) {
  const { ready } = summary.readiness;
  return (
    <button type="button" onClick={onSelect}
      className="w-full rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-left transition hover:border-neutral-600">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-neutral-100">
            {[summary.level, summary.role].filter(Boolean).join(" · ") || "Unknown role"}
          </p>
          <p className="text-xs text-neutral-500 mt-0.5">
            Generated {new Date(summary.generatedAt).toLocaleDateString()} · {summary.totalQuestions} questions · {summary.approvedCount} approved
          </p>
        </div>
        <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${ready ? "bg-emerald-900/40 text-emerald-300" : "bg-amber-900/30 text-amber-400"}`}>
          {ready ? "Ready" : "Needs review"}
        </span>
      </div>
    </button>
  );
}

// ─── Rejected section ─────────────────────────────────────────────────

function RejectedSection({
  questions, canDelete, onRestore, onDelete, onDeleteAll,
}: {
  questions: QuestionBankItem[];
  canDelete: boolean;
  onRestore: (id: string, patch: { status: QuestionBankItemStatus }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onDeleteAll: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setOpen(v => !v)}
          className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-red-400 hover:text-red-300">
          <span>{open ? "▼" : "▶"}</span>
          Rejected Questions
          <span className="rounded-full bg-red-900/30 px-2 py-0.5 text-xs font-normal text-red-400">{questions.length}</span>
        </button>
        {canDelete && questions.length > 0 && (
          confirmDeleteAll ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-400">Delete all {questions.length}?</span>
              <button type="button" disabled={deletingAll}
                onClick={async () => { setDeletingAll(true); try { await onDeleteAll(); setConfirmDeleteAll(false); } finally { setDeletingAll(false); } }}
                className="rounded-full bg-red-700 px-3 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-40">
                {deletingAll ? "Deleting…" : "Yes, delete all"}
              </button>
              <button type="button" onClick={() => setConfirmDeleteAll(false)}
                className="rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-400 hover:text-white">
                Cancel
              </button>
            </div>
          ) : (
            <button type="button"
              onClick={() => setConfirmDeleteAll(true)}
              className="rounded-full border border-red-900/50 px-3 py-1 text-xs text-red-500 hover:border-red-600 hover:text-red-400">
              Delete All ({questions.length})
            </button>
          )
        )}
      </div>
      {open && (
        <div className="space-y-2">
          <p className="text-xs text-neutral-500">
            {canDelete
              ? "Admin: permanently delete individual questions or use Delete All above."
              : "Restore a question to draft if it should be reconsidered."}
          </p>
          {questions.map(q => (
            <div key={q.id} className="flex items-start justify-between gap-3 rounded-lg border border-red-900/30 bg-red-900/5 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 mb-1">{SECTION_LABELS[q.type]}</p>
                <p className="text-sm text-neutral-400 line-through">{q.editedText ?? q.text}</p>
              </div>
              <div className="flex flex-shrink-0 gap-2 items-center">
                <button type="button" disabled={busy === q.id}
                  onClick={async () => { setPendingDeleteId(null); setBusy(q.id); try { await onRestore(q.id, { status: "draft" }); } finally { setBusy(null); } }}
                  className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white disabled:opacity-40">
                  Restore to Draft
                </button>
                {canDelete && (
                  pendingDeleteId === q.id ? (
                    <>
                      <span className="text-xs text-red-400">Sure?</span>
                      <button type="button" disabled={busy === q.id}
                        onClick={async () => { setBusy(q.id); try { await onDelete(q.id); setPendingDeleteId(null); } finally { setBusy(null); } }}
                        className="rounded-full bg-red-700 px-2.5 py-1 text-xs text-white hover:bg-red-600 disabled:opacity-40">
                        {busy === q.id ? "Deleting…" : "Delete"}
                      </button>
                      <button type="button" onClick={() => setPendingDeleteId(null)}
                        className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white">
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button type="button" disabled={busy === q.id}
                      onClick={() => setPendingDeleteId(q.id)}
                      className="rounded-full border border-red-800/50 px-2.5 py-1 text-xs text-red-500 hover:border-red-600 hover:text-red-400 disabled:opacity-40">
                      Delete
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ─── Main component ────────────────────────────────────────────────────

export default function QuestionReview() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [companyId, setCompanyId] = useState("novaforge");

  // Bank list state
  const [banks, setBanks] = useState<QuestionBankSummary[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Selected bank state
  const [selectedRole, setSelectedRole]     = useState<string | null>(null);
  const [selectedLevel, setSelectedLevel]   = useState<string | null>(null);
  const [bankData, setBankData]             = useState<BankResponse | null>(null);
  const [rejectedBank, setRejectedBank]     = useState<RejectedBank | null>(null);
  const [loadingBank, setLoadingBank]       = useState(false);
  const [bankError, setBankError]           = useState<string | null>(null);

  // Generate state — for new-bank creation (not in bank view)
  const searchParams = useSearchParams();
  const [genRole,    setGenRole]    = useState(searchParams.get("role") ?? "");
  const [genLevel,   setGenLevel]   = useState(searchParams.get("level") ?? "");
  // Per-section generation (used inside bank view)
  const [generatingSection, setGeneratingSection] = useState<GeneratableQuestionType | null>(null);
  const [generatingAll, setGeneratingAll]         = useState(false);
  const [genMsg,            setGenMsg]            = useState<string | null>(null);

  // Misc
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const canApprove = currentUser ? ["admin","recruiter","hr"].includes(currentUser.role) : false;
  const canDelete  = currentUser?.role === "admin";

  useEffect(() => {
    fetch("/api/auth/me").then(r => r.json())
      .then((d: { user: AuthUser | null }) => setCurrentUser(d.user ?? null))
      .catch(() => {});
  }, []);

  const loadList = useCallback(async (cid: string) => {
    setLoadingList(true);
    try {
      const res = await fetch(`/api/question-bank?companyId=${encodeURIComponent(cid)}`);
      const d = await res.json() as { banks?: QuestionBankSummary[] };
      setBanks(d.banks ?? []);
    } catch { setBanks([]); }
    finally { setLoadingList(false); }
  }, []);

  useEffect(() => { void loadList(companyId); }, [companyId, loadList]);

  const loadBank = useCallback(async (cid: string, role: string | null, level: string | null) => {
    setLoadingBank(true);
    setBankError(null);
    setBankData(null);
    setRejectedBank(null);
    try {
      const p = new URLSearchParams({ companyId: cid });
      if (role)  p.set("role",  role);
      if (level) p.set("level", level);
      const [mainRes, rejRes] = await Promise.all([
        fetch(`/api/question-bank?${p}`),
        fetch(`/api/question-bank/rejected?${p}`),
      ]);
      if (!mainRes.ok) {
        const d = await mainRes.json().catch(() => ({}));
        setBankError((d as { error?: string }).error ?? `HTTP ${mainRes.status}`);
      } else {
        setBankData(await mainRes.json() as BankResponse);
      }
      if (rejRes.ok) setRejectedBank(await rejRes.json() as RejectedBank);
    } catch (e) { setBankError(String(e)); }
    finally { setLoadingBank(false); }
  }, []);

  const handleSelectBank = (summary: QuestionBankSummary) => {
    setSelectedRole(summary.role);
    setSelectedLevel(summary.level);
    void loadBank(companyId, summary.role, summary.level);
  };

  // Refresh only the readiness banner in the background — no scroll reset.
  const refreshReadiness = useCallback(async () => {
    const p = new URLSearchParams({ companyId });
    if (selectedRole)  p.set("role",  selectedRole);
    if (selectedLevel) p.set("level", selectedLevel);
    const res = await fetch(`/api/question-bank?${p.toString()}`);
    if (res.ok) {
      const d = await res.json() as BankResponse;
      setBankData(prev => prev ? { ...prev, readiness: d.readiness } : prev);
    }
  }, [companyId, selectedRole, selectedLevel]);

  const handleUpdate = useCallback(async (id: string, patch: { text?: string; status?: QuestionBankItemStatus }) => {
    const res = await fetch("/api/question-bank/question", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, questionId: id, role: selectedRole, level: selectedLevel, ...patch }),
    });
    if (!res.ok) throw new Error("Failed to update question");
    const updated = (await res.json() as { question: QuestionBankItem }).question;

    if (patch.status === "rejected") {
      // Remove from main bank, add to rejected list — no scroll jump.
      setBankData(prev => prev ? {
        ...prev,
        bank: { ...prev.bank, questionBank: prev.bank.questionBank.filter(q => q.id !== id) },
      } : prev);
      setRejectedBank(prev => {
        const q = (prev?.questions ?? []);
        if (q.find(x => x.id === id)) return prev;
        return { ...(prev ?? { companyId, role: selectedRole, level: selectedLevel, questions: [] }), questions: [...q, updated] };
      });
    } else if ((updated as { restoredFromRejected?: boolean }).restoredFromRejected) {
      // Restored from rejected → add back to main bank, remove from rejected.
      setBankData(prev => prev ? {
        ...prev,
        bank: { ...prev.bank, questionBank: [...prev.bank.questionBank, updated] },
      } : prev);
      setRejectedBank(prev => prev ? { ...prev, questions: prev.questions.filter(q => q.id !== id) } : prev);
    } else {
      // Normal in-place update.
      setBankData(prev => prev ? {
        ...prev,
        bank: { ...prev.bank, questionBank: prev.bank.questionBank.map(q => q.id === id ? updated : q) },
      } : prev);
    }

    // Refresh the readiness banner + bank list card in the background.
    void refreshReadiness();
    void loadList(companyId);
    setSaveMsg("Saved");
    setTimeout(() => setSaveMsg(null), 2000);
  }, [companyId, selectedRole, selectedLevel, refreshReadiness, loadList]);

  const handleApproveAll = useCallback(async (type: QuestionBankItemType) => {
    await fetch("/api/question-bank/approve-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, role: selectedRole, level: selectedLevel, type }),
    });

    // Update all matching questions in place — no scroll jump.
    setBankData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        bank: {
          ...prev.bank,
          questionBank: prev.bank.questionBank.map(q =>
            q.type === type && q.status !== "approved"
              ? { ...q, status: "approved" as const, approved: true }
              : q
          ),
        },
      };
    });

    void refreshReadiness();
    void loadList(companyId);
  }, [companyId, selectedRole, selectedLevel, refreshReadiness, loadList]);

  const handlePermanentDelete = useCallback(async (id: string) => {
    const res = await fetch("/api/question-bank/question", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, questionId: id, role: selectedRole, level: selectedLevel }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string };
      setSaveMsg(`Error: ${body.error ?? "Failed to delete question"}`);
      setTimeout(() => setSaveMsg(null), 3000);
      return;
    }
    setRejectedBank(prev => prev ? { ...prev, questions: prev.questions.filter(q => q.id !== id) } : prev);
    setSaveMsg("Deleted permanently"); setTimeout(() => setSaveMsg(null), 2000);
  }, [companyId, selectedRole, selectedLevel]);

  const handleDeleteAllRejected = useCallback(async () => {
    const count = rejectedBank?.questions.length ?? 0;
    if (count === 0) return;
    const p = new URLSearchParams({ companyId });
    if (selectedRole)  p.set("role",  selectedRole);
    if (selectedLevel) p.set("level", selectedLevel);
    const res = await fetch(`/api/question-bank/rejected?${p}`, { method: "DELETE" });
    if (!res.ok) {
      setSaveMsg("Error: Failed to delete all rejected questions");
      setTimeout(() => setSaveMsg(null), 3000);
      return;
    }
    setRejectedBank(prev => prev ? { ...prev, questions: [] } : prev);
    setSaveMsg(`Deleted all ${count} rejected questions`); setTimeout(() => setSaveMsg(null), 3000);
  }, [companyId, selectedRole, selectedLevel, rejectedBank]);

  // Generate a single section within the currently viewed bank.
  const handleGenerateSection = useCallback(async (type: GeneratableQuestionType) => {
    setGeneratingSection(type);
    setGenMsg(null);
    try {
      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          role: selectedRole,
          level: selectedLevel,
          questionTypes: [type],
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const label = type === "intro" ? "Introduction" : type === "behavioral" ? "Behavioral" : "Technical";
      setGenMsg(`✓ ${label} questions generated`);
      setTimeout(() => setGenMsg(null), 4000);
      void loadBank(companyId, selectedRole, selectedLevel);
    } catch (e) {
      setGenMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGeneratingSection(null);
    }
  }, [companyId, selectedRole, selectedLevel, loadBank]);

  // Generate all sections at once within the currently viewed bank.
  const handleGenerateAll = useCallback(async () => {
    setGeneratingAll(true);
    setGenMsg(null);
    try {
      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, role: selectedRole, level: selectedLevel }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setGenMsg("✓ All sections generated");
      setTimeout(() => setGenMsg(null), 4000);
      void loadBank(companyId, selectedRole, selectedLevel);
    } catch (e) {
      setGenMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGeneratingAll(false);
    }
  }, [companyId, selectedRole, selectedLevel, loadBank]);

  // Create a brand-new bank (used from the bank-list view).
  const handleCreateBank = async () => {
    if (!genRole || !genLevel) {
      setGenMsg("Please choose a role and level first.");
      return;
    }
    setGeneratingSection("intro"); // borrow state as "busy" indicator
    setGenMsg(null);
    try {
      const res = await fetch("/api/generate-questions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId, role: genRole, level: genLevel }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setGenMsg(`✓ Bank created for ${genLevel} ${genRole}`);
      void loadList(companyId);
      setSelectedRole(genRole);
      setSelectedLevel(genLevel);
      void loadBank(companyId, genRole, genLevel);
    } catch (e) {
      setGenMsg(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setGeneratingSection(null);
    }
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  };

  if (currentUser && !canApprove) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6">
        <div className="max-w-md text-center space-y-3">
          <p className="text-lg font-semibold text-neutral-100">Access Denied</p>
          <p className="text-sm text-neutral-400">You do not have permission to review or approve interview questions.</p>
          <p className="text-xs text-neutral-600">Your role: {currentUser.role}</p>
        </div>
      </div>
    );
  }

  const bank = bankData?.bank;
  const readiness = bankData?.readiness;
  const isViewingBank = selectedRole !== null || selectedLevel !== null;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AdminNav />
      <div className="mx-auto max-w-4xl p-6 space-y-6">

        <header>
          <h1 className="text-2xl font-semibold">Question Review</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Review and approve questions before they go live in candidate interviews</p>
        </header>

        {/* Company selector */}
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs font-medium text-neutral-400">Company:</label>
          <input type="text" value={companyId}
            onChange={e => setCompanyId(e.target.value)}
            onBlur={() => { void loadList(companyId); setBankData(null); setSelectedRole(null); setSelectedLevel(null); }}
            className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none w-40" />
          {saveMsg && <span className="text-xs text-emerald-400">{saveMsg}</span>}
        </div>

        {/* ── Bank list or selected bank ───────────────────────────── */}
        {!isViewingBank ? (
          <section className="space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wide">
                Available Question Banks {loadingList && <span className="text-neutral-600 normal-case font-normal">— loading…</span>}
              </h2>
              {/* Compact new-bank creation row */}
              <div className="flex items-center gap-2 flex-wrap">
                <select value={genRole} onChange={e => setGenRole(e.target.value)}
                  className="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 focus:border-indigo-500 focus:outline-none">
                  <option value="" disabled>Choose a role</option>
                  {INTERVIEW_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <select value={genLevel} onChange={e => setGenLevel(e.target.value)}
                  className="rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs text-neutral-100 focus:border-indigo-500 focus:outline-none">
                  <option value="" disabled>Choose a level</option>
                  {INTERVIEW_LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
                <button type="button" disabled={generatingSection !== null || !genRole || !genLevel} onClick={() => void handleCreateBank()}
                  className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 whitespace-nowrap">
                  {generatingSection !== null ? "Generating…" : "+ New Bank"}
                </button>
              </div>
            </div>
            {genMsg && <p className={`text-xs ${genMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{genMsg}</p>}
            {banks.length === 0 && !loadingList && (
              <p className="text-sm text-neutral-500">No question banks yet. Select a role and level above to generate one.</p>
            )}
            {banks.map(s => <BankCard key={s.filename} summary={s} onSelect={() => handleSelectBank(s)} />)}
          </section>
        ) : (
          <section className="space-y-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <button type="button" onClick={() => { setBankData(null); setSelectedRole(null); setSelectedLevel(null); setGenMsg(null); }}
                  className="text-xs text-neutral-500 hover:text-neutral-300">← All banks</button>
                <h2 className="text-base font-semibold text-neutral-100 mt-0.5">
                  {[selectedLevel, selectedRole].filter(Boolean).join(" · ") || "Unknown"}
                </h2>
              </div>
            </div>

            {loadingBank && <p className="text-sm text-neutral-400">Loading…</p>}
            {bankError && <p className="text-sm text-red-400">{bankError}</p>}

            {readiness && bank && (
              <ReadinessBanner readiness={readiness} role={bank.role} level={bank.level} />
            )}

            {/* Generate all sections button */}
            <div className="flex items-center justify-between gap-3">
              <button type="button"
                disabled={generatingAll || generatingSection !== null}
                onClick={() => void handleGenerateAll()}
                className="rounded-full bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 whitespace-nowrap transition">
                {generatingAll ? "Generating All…" : "Generate All Sections"}
              </button>
              {genMsg && (
                <span className={`text-xs ${genMsg.startsWith("Error") ? "text-red-400" : "text-emerald-400"}`}>{genMsg}</span>
              )}
            </div>

            {bank && (
              <div className="space-y-8">
                {SECTION_ORDER.map(type => {
                  const isGeneratable = (type as string) !== "final_candidate_question";
                  return (
                    <SectionGroup
                      key={type}
                      type={type}
                      questions={bank.questionBank.filter(q => q.type === type)}
                      canApprove={canApprove}
                      onUpdate={handleUpdate}
                      onApproveAll={handleApproveAll}
                      onGenerate={isGeneratable ? () => handleGenerateSection(type as GeneratableQuestionType) : undefined}
                      generating={generatingSection === type || generatingAll}
                    />
                  );
                })}
              </div>
            )}

            {/* ── Rejected questions ──────────────────────────────── */}
            {rejectedBank && rejectedBank.questions.length > 0 && (
              <RejectedSection
                questions={rejectedBank.questions}
                canDelete={canDelete}
                onRestore={handleUpdate}
                onDelete={handlePermanentDelete}
                onDeleteAll={handleDeleteAllRejected}
              />
            )}
          </section>
        )}

      </div>
    </div>
  );
}
