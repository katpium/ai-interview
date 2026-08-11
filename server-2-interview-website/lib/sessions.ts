/**
 * Local JSON file storage for interview sessions.
 *
 * One file per session at `storage/sessions/<session_id>.json`.
 * This is intentionally simple — a real DB comes later.
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type SessionStatus = "in_progress" | "completed";

export type SessionAnswer = {
  question_id: number;
  question_number: number;
  question_text: string;
  question_kind: "interview" | "candidate_question";
  transcript: string;
  audio_filename: string | null;           // AI TTS question audio (on Server 1)
  candidate_audio_filename: string | null; // candidate's recorded answer (local)
  created_at: string;
  // Transcript edit audit fields
  editedTranscript?: string | null;
  transcriptEdited?: boolean;
  editedBy?: string | null;
  editedAt?: string | null;
};

export type InterviewSession = {
  session_id: string;
  status: SessionStatus;
  questions_total: number;
  started_at: string;
  completed_at: string | null;
  updated_at: string;
  answers: SessionAnswer[];
  invite_token?: string | null;
  interview_role?: string | null;
  interview_level?: string | null;
  cvFilename?: string | null;
};

const SESSIONS_DIR = path.join(process.cwd(), "storage", "sessions");

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function sessionFilePath(sessionId: string): string {
  // Defense against path traversal — only allow uuid-shaped ids.
  if (!/^[a-f0-9-]{8,}$/i.test(sessionId)) {
    throw new Error("Invalid session id");
  }
  return path.join(SESSIONS_DIR, `${sessionId}.json`);
}

async function writeSession(session: InterviewSession): Promise<void> {
  await ensureSessionsDir();
  session.updated_at = new Date().toISOString();
  const file = sessionFilePath(session.session_id);
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(session, null, 2), "utf8");
  await fs.rename(tmp, file);
}

export async function createSession(input: {
  questions_total: number;
  invite_token?: string | null;
  interview_role?: string | null;
  interview_level?: string | null;
  cvFilename?: string | null;
}): Promise<InterviewSession> {
  const now = new Date().toISOString();
  const session: InterviewSession = {
    session_id: randomUUID(),
    status: "in_progress",
    questions_total: input.questions_total,
    started_at: now,
    completed_at: null,
    updated_at: now,
    answers: [],
    invite_token: input.invite_token ?? null,
    interview_role: input.interview_role ?? null,
    interview_level: input.interview_level ?? null,
    cvFilename: input.cvFilename ?? null,
  };
  await writeSession(session);
  return session;
}

export async function readSession(
  sessionId: string
): Promise<InterviewSession | null> {
  try {
    const raw = await fs.readFile(sessionFilePath(sessionId), "utf8");
    return JSON.parse(raw) as InterviewSession;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function appendAnswer(
  sessionId: string,
  answer: Omit<SessionAnswer, "created_at"> & { created_at?: string }
): Promise<InterviewSession> {
  const session = await readSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status === "completed") {
    throw new Error("Session is already completed");
  }

  // Idempotency: if an answer for this question_number already exists, replace it.
  const fullAnswer: SessionAnswer = {
    ...answer,
    created_at: answer.created_at ?? new Date().toISOString(),
  };
  const existingIndex = session.answers.findIndex(
    (a) => a.question_number === fullAnswer.question_number
  );
  if (existingIndex >= 0) {
    session.answers[existingIndex] = fullAnswer;
  } else {
    session.answers.push(fullAnswer);
  }

  await writeSession(session);
  return session;
}

export async function listSessions(): Promise<InterviewSession[]> {
  await ensureSessionsDir();
  let files: string[];
  try {
    files = await fs.readdir(SESSIONS_DIR);
  } catch {
    return [];
  }
  const sessions: InterviewSession[] = [];
  for (const file of files) {
    if (!file.endsWith(".json") || file.endsWith(".tmp")) continue;
    try {
      const raw = await fs.readFile(path.join(SESSIONS_DIR, file), "utf8");
      sessions.push(JSON.parse(raw) as InterviewSession);
    } catch {
      // skip corrupt files
    }
  }
  return sessions.sort(
    (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime()
  );
}

export async function deleteSession(sessionId: string): Promise<void> {
  const filePath = sessionFilePath(sessionId);
  await fs.unlink(filePath);
}

export async function updateAnswerEdit(
  sessionId: string,
  questionNumber: number,
  editedTranscript: string,
  editedBy: string
): Promise<InterviewSession> {
  const session = await readSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  const idx = session.answers.findIndex((a) => a.question_number === questionNumber);
  if (idx < 0) throw new Error(`Answer Q${questionNumber} not found in session`);
  session.answers[idx] = {
    ...session.answers[idx],
    editedTranscript,
    transcriptEdited: true,
    editedBy,
    editedAt: new Date().toISOString(),
  };
  await writeSession(session);
  return session;
}

export async function completeSession(
  sessionId: string
): Promise<InterviewSession> {
  const session = await readSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  if (session.status !== "completed") {
    session.status = "completed";
    session.completed_at = new Date().toISOString();
    await writeSession(session);
  }
  return session;
}

export async function updateSessionCv(
  sessionId: string,
  cvFilename: string | null
): Promise<InterviewSession> {
  const session = await readSession(sessionId);
  if (!session) throw new Error(`Session not found: ${sessionId}`);
  session.cvFilename = cvFilename;
  await writeSession(session);
  return session;
}
