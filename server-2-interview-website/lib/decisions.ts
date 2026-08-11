import { promises as fs } from "node:fs";
import path from "node:path";

export type DecisionStatus =
  | "pending"
  | "needs_review"
  | "shortlisted"
  | "hired"
  | "rejected";

export type HiringDecision = {
  sessionId: string;
  decision: DecisionStatus;
  decisionBy: string;
  decisionAt: string;
  decisionNote: string | null;
};

const DECISIONS_DIR = path.join(process.cwd(), "storage", "decisions");

function decisionFilePath(sessionId: string): string {
  if (!/^[a-f0-9-]{8,}$/i.test(sessionId)) throw new Error("Invalid session id");
  return path.join(DECISIONS_DIR, `${sessionId}-decision.json`);
}

export async function readDecision(sessionId: string): Promise<HiringDecision | null> {
  try {
    const raw = await fs.readFile(decisionFilePath(sessionId), "utf8");
    return JSON.parse(raw) as HiringDecision;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function saveDecision(decision: HiringDecision): Promise<void> {
  await fs.mkdir(DECISIONS_DIR, { recursive: true });
  const file = decisionFilePath(decision.sessionId);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(decision, null, 2), "utf8");
  await fs.rename(tmp, file);
}
