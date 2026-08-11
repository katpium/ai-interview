"use client";

import { useEffect, useState } from "react";
import type { InviteToken } from "@/lib/invites";
import AdminNav from "@/components/AdminNav";
import Link from "next/link";

const INTERVIEW_LEVELS = [
  "Intern",
  "Junior",
  "Mid-level",
  "Senior",
  "Lead",
  "Principal / Staff",
  "Manager",
  "Director",
];

const INTERVIEW_ROLES = [
  "Software Engineer",
  "Backend Engineer",
  "Frontend Engineer",
  "Full Stack Engineer",
  "Web Developer",
  "Mobile Developer (iOS/Android)",
  "DevOps / Platform Engineer",
  "Machine Learning Engineer",
  "Data Scientist",
  "Data Analyst",
  "QA / Test Engineer",
  "Security Engineer",
  "Product Manager",
  "UX / UI Designer",
  "Business Analyst",
  "Project Manager",
];

type AuthUser = { username: string; role: string };

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

function statusBadge(invite: InviteToken) {
  if (invite.usedAt) return <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs text-neutral-400">Used</span>;
  if (new Date(invite.expiresAt) < new Date()) return <span className="rounded-full bg-red-900/40 px-2 py-0.5 text-xs text-red-400">Expired</span>;
  return <span className="rounded-full bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-400">Active</span>;
}

export default function AdminPanel() {
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [invites, setInvites] = useState<InviteToken[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(true);

  // Form state
  const [candidateNote, setCandidateNote] = useState("");
  const [interviewRole, setInterviewRole] = useState("");
  const [interviewLevel, setInterviewLevel] = useState("");
  const [expiryHours, setExpiryHours] = useState(72);
  const [cvFile, setCvFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);
  const [pendingDeleteToken, setPendingDeleteToken] = useState<string | null>(null);

  // Readiness check for selected role/level
  type Readiness = { ready: boolean; missing: string[]; approvedCounts: Record<string, number>; required: Record<string, number> };
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checkingReadiness, setCheckingReadiness] = useState(false);

  // Permissions derived from role
  const canGenerate = currentUser?.role === "admin" || currentUser?.role === "recruiter";

  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.json())
      .then((d: { user: AuthUser | null }) => setCurrentUser(d.user ?? null))
      .catch(() => {});
  }, []);

  // Re-check readiness whenever role or level changes.
  useEffect(() => {
    setReadiness(null);
    if (!interviewRole || !interviewLevel) { setCheckingReadiness(false); return; }
    setCheckingReadiness(true);
    const cid = "novaforge"; // TODO: make this dynamic when multi-company is needed
    fetch(`/api/question-bank?companyId=${encodeURIComponent(cid)}&role=${encodeURIComponent(interviewRole)}&level=${encodeURIComponent(interviewLevel)}`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { readiness?: Readiness } | null) => setReadiness(d?.readiness ?? null))
      .catch(() => setReadiness(null))
      .finally(() => setCheckingReadiness(false));
  }, [interviewRole, interviewLevel]);

  const loadInvites = () => {
    setLoadingInvites(true);
    fetch("/api/admin/invites")
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then((d: { invites: InviteToken[] }) => { setInvites(d.invites); setLoadingInvites(false); })
      .catch(() => setLoadingInvites(false));
  };

  useEffect(() => { loadInvites(); }, []);

  const generateLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interviewRole || !interviewLevel) {
      setGenError("Please choose a role and level first.");
      return;
    }
    setGenerating(true);
    setGenError(null);
    setGeneratedLink(null);
    try {
      const form = new FormData();
      form.append("candidateNote", candidateNote);
      form.append("interviewRole", interviewRole);
      form.append("interviewLevel", interviewLevel);
      form.append("expiryHours", String(expiryHours));
      if (cvFile) form.append("cv", cvFile);

      const res = await fetch("/api/admin/generate-link", { method: "POST", body: form });
      if (!res.ok) throw new Error(`${res.status}`);
      const d = (await res.json()) as { invite: InviteToken };
      const url = `${window.location.origin}/interview?token=${d.invite.token}`;
      setGeneratedLink(url);
      setCandidateNote("");
      setCvFile(null);
      loadInvites();
    } catch (err) {
      setGenError(`Failed: ${err instanceof Error ? err.message : "unknown"}`);
    } finally {
      setGenerating(false);
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const deleteInvite = async (token: string) => {
    await fetch("/api/admin/invites", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    setPendingDeleteToken(null);
    loadInvites();
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <AdminNav />
      <div className="mx-auto max-w-3xl p-6 space-y-8">

        <header>
          <h1 className="text-2xl font-semibold">Invite Links</h1>
          <p className="text-sm text-neutral-400 mt-0.5">Generate one-time interview links for candidates</p>
        </header>

        {/* Generate link form */}
        {canGenerate && (
          <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-6 space-y-4">
            <h2 className="text-base font-semibold">Generate Interview Link</h2>
            <p className="text-sm text-neutral-400">
              Creates a one-time link. Send it to the candidate — they click it to start the interview with no password.
            </p>

            <form onSubmit={(e) => void generateLink(e)} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1">
                    Candidate name / note
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Jane Smith — Backend role"
                    value={candidateNote}
                    onChange={e => setCandidateNote(e.target.value)}
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-600 focus:border-indigo-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1">
                    Interview role
                  </label>
                  <select
                    value={interviewRole}
                    onChange={e => setInterviewRole(e.target.value)}
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="" disabled>Choose a role</option>
                    {INTERVIEW_ROLES.map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1">
                    Level
                  </label>
                  <select
                    value={interviewLevel}
                    onChange={e => setInterviewLevel(e.target.value)}
                    className="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value="" disabled>Choose a level</option>
                    {INTERVIEW_LEVELS.map(l => (
                      <option key={l} value={l}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Question readiness indicator */}
              <div className={`rounded-xl border p-3 text-sm ${
                !interviewRole || !interviewLevel ? "border-neutral-700/40 bg-neutral-800/40 text-neutral-500"
                : checkingReadiness ? "border-neutral-700 text-neutral-500"
                : readiness?.ready ? "border-emerald-700/40 bg-emerald-900/10 text-emerald-300"
                : readiness ? "border-amber-700/40 bg-amber-900/10 text-amber-300"
                : "border-neutral-700/40 bg-neutral-800/40 text-neutral-500"
              }`}>
                {!interviewRole || !interviewLevel ? (
                  <span>Please choose a role and level first.</span>
                ) : checkingReadiness ? (
                  <span>Checking approved questions…</span>
                ) : readiness?.ready ? (
                  <span>✓ Enough approved questions for <strong>{interviewLevel} {interviewRole}</strong> — ready to generate link</span>
                ) : readiness ? (
                  <div className="space-y-1">
                    <p>⚠ Not enough approved questions for <strong>{interviewLevel} {interviewRole}</strong></p>
                    <ul className="text-xs text-amber-400 ml-2 space-y-0.5">
                      {readiness.missing.map((m, i) => <li key={i}>• Need {m}</li>)}
                    </ul>
                    <p className="text-xs text-amber-500 mt-1">
                      <Link href={`/admin/questions?role=${encodeURIComponent(interviewRole)}&level=${encodeURIComponent(interviewLevel)}`} className="underline hover:text-amber-300">Go to Question Review</Link> to generate and approve questions first.
                    </p>
                  </div>
                ) : (
                  <span>No question bank found for <strong>{interviewLevel} {interviewRole}</strong>. <Link href={`/admin/questions?role=${encodeURIComponent(interviewRole)}&level=${encodeURIComponent(interviewLevel)}`} className="underline hover:text-neutral-300">Generate questions first.</Link></span>
                )}
              </div>

              {/* CV upload */}
              <div>
                <label className="block text-xs font-medium text-neutral-400 mb-1">
                  Candidate CV <span className="text-neutral-600">(optional — PDF, DOCX, TXT)</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc,.txt,.md"
                    onChange={e => setCvFile(e.target.files?.[0] ?? null)}
                    className="block text-sm text-neutral-400 file:mr-3 file:rounded-full file:border-0 file:bg-neutral-800 file:px-3 file:py-1 file:text-xs file:text-neutral-300 file:cursor-pointer hover:file:bg-neutral-700"
                  />
                  {cvFile && (
                    <span className="text-xs text-emerald-400">
                      ✓ {cvFile.name} ({Math.round(cvFile.size / 1024)}KB)
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-neutral-600">
                  The CV will be used to personalise the AI evaluation after the interview.
                </p>
              </div>

              <div className="flex items-end gap-4">
                <div>
                  <label className="block text-xs font-medium text-neutral-400 mb-1">
                    Expires in (hours)
                  </label>
                  <select
                    value={expiryHours}
                    onChange={e => setExpiryHours(Number(e.target.value))}
                    className="rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 focus:border-indigo-500 focus:outline-none"
                  >
                    <option value={24}>24 hours</option>
                    <option value={48}>48 hours</option>
                    <option value={72}>72 hours (default)</option>
                    <option value={168}>7 days</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={generating || checkingReadiness || !readiness?.ready}
                  title={!readiness?.ready ? "Approve questions for this role/level first" : undefined}
                  className="rounded-full bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {generating ? "Generating…" : "Generate Link"}
                </button>
              </div>

              {genError && <p className="text-sm text-red-400">{genError}</p>}
            </form>

            {/* Generated link display */}
            {generatedLink && (
              <div className="rounded-xl border border-emerald-700/40 bg-emerald-900/10 p-4 space-y-2">
                <p className="text-xs font-medium text-emerald-400">✓ Link generated — send this to the candidate:</p>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 rounded-lg bg-neutral-800 px-3 py-2 text-xs text-emerald-300 break-all">
                    {generatedLink}
                  </code>
                  <button
                    type="button"
                    onClick={() => void copy(generatedLink)}
                    className="flex-shrink-0 rounded-full bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-neutral-500">One-time use · expires in {expiryHours}h</p>
              </div>
            )}
          </section>
        )}

        {/* Invite links list */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Invite Links</h2>
            <button type="button" onClick={loadInvites}
              className="text-xs text-neutral-500 hover:text-neutral-300">↻ Refresh</button>
          </div>

          {loadingInvites && <p className="text-sm text-neutral-500">Loading…</p>}

          {!loadingInvites && invites.length === 0 && (
            <p className="text-sm text-neutral-500">No invite links yet.</p>
          )}

          {invites.map(invite => (
            <div key={invite.token} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-neutral-100">
                      {invite.candidateNote || <span className="italic text-neutral-500">No note</span>}
                    </p>
                    {statusBadge(invite)}
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">
                    {[invite.interviewLevel, invite.interviewRole].filter(Boolean).join(" · ")} · {invite.createdBy} · {fmtDate(invite.createdAt)}
                    {invite.cvFilename ? <span className="ml-2 text-indigo-400">📄 CV</span> : null}
                  </p>
                  <p className="text-xs text-neutral-600">
                    Expires: {fmtDate(invite.expiresAt)}
                    {invite.usedAt ? ` · Used: ${fmtDate(invite.usedAt)}` : ""}
                  </p>
                </div>
                <div className="flex flex-shrink-0 gap-1">
                  {!invite.usedAt && new Date(invite.expiresAt) > new Date() && (
                    <button
                      type="button"
                      onClick={() => void copy(`${window.location.origin}/interview?token=${invite.token}`)}
                      className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                    >
                      Copy link
                    </button>
                  )}
                  {pendingDeleteToken === invite.token ? (
                    <>
                      <span className="text-xs text-red-400">Delete?</span>
                      <button
                        type="button"
                        onClick={() => void deleteInvite(invite.token)}
                        className="rounded-full border border-red-700 bg-red-900/20 px-2.5 py-1 text-xs text-red-400 hover:bg-red-900/40"
                      >
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteToken(null)}
                        className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:text-white"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPendingDeleteToken(invite.token)}
                      className="rounded-full border border-neutral-700 px-2.5 py-1 text-xs text-neutral-500 hover:border-red-700 hover:text-red-400"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </section>

      </div>
    </div>
  );
}
