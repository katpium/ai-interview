/**
 * Invite-link management.
 *
 * Tokens are stored in storage/invite-tokens.json — no database needed.
 * Each token is a UUID that maps to metadata: who created it, expiry,
 * and whether it has been used.
 *
 * Flow:
 *   1. Recruiter POSTs /api/admin/generate-link  → get back a URL
 *   2. Recruiter sends URL to candidate
 *   3. Candidate opens /interview?token=<uuid>
 *   4. Front-end calls GET /api/admin/verify-invite?token=<uuid>
 *   5. If valid → interview starts and token is marked used
 */

import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";

const TOKENS_FILE = path.join(process.cwd(), "storage", "invite-tokens.json");

export type InviteToken = {
  token: string;
  companyId: string;
  interviewRole: string;   // e.g. "Software Engineer"
  candidateNote: string;   // recruiter's label, e.g. candidate name
  interviewLevel: string | null; // e.g. "Junior", "Senior"
  cvFilename: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  createdBy: string;
};

// ─── Persistence ─────────────────────────────────────────────────────

async function readAll(): Promise<InviteToken[]> {
  try {
    const raw = await fs.readFile(TOKENS_FILE, "utf8");
    return JSON.parse(raw) as InviteToken[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll(tokens: InviteToken[]): Promise<void> {
  await fs.mkdir(path.dirname(TOKENS_FILE), { recursive: true });
  const tmp = `${TOKENS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(tokens, null, 2), "utf8");
  await fs.rename(tmp, TOKENS_FILE);
}

// ─── Public API ───────────────────────────────────────────────────────

export async function createInvite(input: {
  companyId: string;
  interviewRole: string;
  candidateNote: string;
  createdBy: string;
  expiryHours?: number;
  interviewLevel?: string | null;
  cvFilename?: string | null;
}): Promise<InviteToken> {
  const now = new Date();
  const expires = new Date(now.getTime() + (input.expiryHours ?? 72) * 60 * 60 * 1000);

  const invite: InviteToken = {
    token: randomUUID(),
    companyId: input.companyId,
    interviewRole: input.interviewRole,
    candidateNote: input.candidateNote,
    interviewLevel: input.interviewLevel ?? null,
    cvFilename: input.cvFilename ?? null,
    createdAt: now.toISOString(),
    expiresAt: expires.toISOString(),
    usedAt: null,
    createdBy: input.createdBy,
  };

  const all = await readAll();
  all.unshift(invite);
  await writeAll(all);
  return invite;
}

export type InviteStatus = "valid" | "expired" | "used" | "not_found";

export async function verifyInvite(token: string): Promise<{ status: InviteStatus; invite: InviteToken | null }> {
  const all = await readAll();
  const invite = all.find((t) => t.token === token) ?? null;
  if (!invite) return { status: "not_found", invite: null };
  if (invite.usedAt) return { status: "used", invite };
  if (new Date(invite.expiresAt) < new Date()) return { status: "expired", invite };
  return { status: "valid", invite };
}

export async function consumeInvite(token: string): Promise<boolean> {
  const all = await readAll();
  const idx = all.findIndex((t) => t.token === token);
  if (idx === -1) return false;
  if (all[idx].usedAt) return false;
  all[idx].usedAt = new Date().toISOString();
  await writeAll(all);
  return true;
}

export async function listInvites(): Promise<InviteToken[]> {
  return readAll();
}

export async function updateInvite(token: string, patch: Partial<Pick<InviteToken, "cvFilename">>): Promise<void> {
  const all = await readAll();
  const idx = all.findIndex((t) => t.token === token);
  if (idx === -1) return;
  all[idx] = { ...all[idx], ...patch };
  await writeAll(all);
}

export async function deleteInvite(token: string): Promise<boolean> {
  const all = await readAll();
  const next = all.filter((t) => t.token !== token);
  if (next.length === all.length) return false; // not found
  await writeAll(next);
  return true;
}
