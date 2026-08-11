"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import InterviewRoom from "@/components/InterviewRoom";
import type { InviteToken } from "@/lib/invites";

type GateState = "checking" | "invalid" | "expired" | "used" | "ready" | "started";

export default function InterviewGate() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  const [gateState, setGateState] = useState<GateState>("checking");
  const [invite, setInvite] = useState<InviteToken | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setGateState("invalid"); return; }
    fetch(`/api/admin/verify-invite?token=${encodeURIComponent(token)}`)
      .then(r => r.json())
      .then((d: { status: string; invite: InviteToken | null }) => {
        if (d.status === "valid") { setInvite(d.invite); setGateState("ready"); }
        else if (d.status === "expired") setGateState("expired");
        else if (d.status === "used")    setGateState("used");
        else                             setGateState("invalid");
      })
      .catch(() => setGateState("invalid"));
  }, [token]);

  const start = async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin/verify-invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError((d as { status?: string }).status === "used"
          ? "This link has already been used."
          : "This link is no longer valid.");
        setGateState("used");
        return;
      }
      setGateState("started");
    } catch {
      setError("Network error. Please try again.");
    }
  };

  /* ── Checking ─────────────────────────────────────────────────── */
  if (gateState === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <div className="flex items-center gap-3 text-neutral-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>Verifying your interview link…</span>
        </div>
      </div>
    );
  }

  /* ── Invalid / expired / used ─────────────────────────────────── */
  if (gateState !== "ready" && gateState !== "started") {
    const messages: Record<string, { title: string; body: string }> = {
      invalid:  { title: "Invalid link",  body: "This interview link is not valid. Please ask your recruiter for a new one." },
      expired:  { title: "Link expired",  body: "This interview link has expired. Please ask your recruiter for a new link." },
      used:     { title: "Already used",  body: "This interview link has already been used. Each link can only be used once." },
    };
    const msg = messages[gateState] ?? messages.invalid;
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 text-center shadow-xl">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">AI Interview</p>
          <h1 className="text-xl font-semibold text-white">{msg.title}</h1>
          <p className="text-sm text-neutral-400">{msg.body}</p>
          {error && <p className="text-sm text-red-400">{error}</p>}
        </div>
      </div>
    );
  }

  /* ── Started — render the full interview room ─────────────────── */
  if (gateState === "started") {
    return (
      <InterviewRoom
        inviteToken={token}
        interviewRole={invite?.interviewRole ?? undefined}
        interviewLevel={invite?.interviewLevel ?? undefined}
      />
    );
  }

  /* ── Ready — show confirmation before consuming the token ──────── */
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
      <div className="w-full max-w-md space-y-5 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-xl">
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">AI Interview</p>
          <h1 className="text-2xl font-semibold text-white">You're invited</h1>
        </div>

        {invite && (
          <div className="rounded-xl border border-neutral-700 bg-neutral-800/60 p-4 space-y-1 text-sm">
            <p className="text-neutral-300">
              <span className="text-neutral-500">Role: </span>
              {invite.interviewRole}
            </p>
            {invite.candidateNote && (
              <p className="text-neutral-300">
                <span className="text-neutral-500">For: </span>
                {invite.candidateNote}
              </p>
            )}
            <p className="text-neutral-500 text-xs">
              Link expires: {new Date(invite.expiresAt).toLocaleString()} · one-time use
            </p>
          </div>
        )}

        <p className="text-sm text-neutral-400">
          This is a one-time link. Once you click <strong className="text-neutral-200">Begin Interview</strong> the link will be consumed and cannot be reused.
        </p>

        {error && <p className="text-sm text-red-400">{error}</p>}

        <button
          type="button"
          onClick={() => void start()}
          className="w-full rounded-full bg-emerald-600 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-500"
        >
          Begin Interview
        </button>
      </div>
    </div>
  );
}
