/**
 * Per-session question queue with server-side TTS pre-generation.
 *
 * When a session starts, the queue loads the interview sequence (passed from
 * the front-end via the session creation request) and begins preparing TTS
 * audio for the first LOOKAHEAD items ahead of the candidate's current
 * position.
 *
 * Sequence items come in two kinds:
 *   - "question"  (interview | candidate_question): TTS + candidate records
 *   - "message"   (transition | closing): TTS only — no recording
 *
 * The queue prepares TTS for ALL items. The front-end decides whether to
 * start recording after playback based on `kind`.
 */

import { requestTts } from "@/lib/modelApi";
import {
  readGeneratedQuestions,
  readQuestionBank,
  buildInterviewSequence,
  generateFollowUpQuestion,
  evaluateAnswer,
  type InterviewSequenceItem,
  type AnsweredTurn,
} from "@/lib/questionGenerator";
import { retrieveCompanyContext } from "@/lib/lightRagService";
import { readSession } from "@/lib/sessions";

// ─── Internal sequence item ───────────────────────────────────────────

type SeqKind = "interview" | "candidate_question" | "message";

type SeqEntry = {
  pos: number;    // 1-indexed position in the full sequence
  text: string;
  kind: SeqKind;
  section: string;
};

// ─── Public types ─────────────────────────────────────────────────────

export type QueueItemStatus = "preparing" | "ready" | "failed";

export type QueueItemTiming = {
  rag_ms: number;
  llm_ms: number;
  tts_ms: number;
  total_ms: number;
};

export type QueueItemSource = "cache" | "fresh";

export type QueuedQuestion = {
  questionNumber: number;
  questionId: number;
  text: string;
  kind: SeqKind;
  section: string;
  audioUrl: string | null;
  audioFilename: string | null;
  status: QueueItemStatus;
  error?: string;
  timing: QueueItemTiming;
  source: QueueItemSource;
};

export type QueueSnapshot = {
  sessionId: string;
  totalItems: number;
  items: QueuedQuestion[];
  cachedContextLength: number;
  evaluationsCount: number;
};

type SessionQueue = {
  sessionId: string;
  companyId: string;
  entries: SeqEntry[];
  items: Map<number, QueuedQuestion>;
  preparing: Map<number, Promise<QueuedQuestion>>;
  cachedRagContext: string | null;
  ragContextPromise: Promise<{ context: string; rag_ms: number }> | null;
  evaluations: Map<number, AnswerEvaluationRecord>;
};

type AnswerEvaluationRecord = {
  questionNumber: number;
  score: number;
  feedback: string;
  model: string;
  timing: { rag_ms: number; llm_ms: number; total_ms: number };
};

// ─── In-memory store (survives HMR) ──────────────────────────────────

const _g = globalThis as unknown as {
  __questionQueues?: Map<string, SessionQueue>;
};
if (!_g.__questionQueues) {
  _g.__questionQueues = new Map<string, SessionQueue>();
}
const queues: Map<string, SessionQueue> = _g.__questionQueues;

const LOOKAHEAD = 3;
const DEFAULT_COMPANY_ID = "novaforge";
const SESSION_RETRIEVAL_QUERY =
  "company values role requirements responsibilities skills interview";

// ─── Sequence loading ─────────────────────────────────────────────────

function seqItemToEntry(item: InterviewSequenceItem, pos: number): SeqEntry {
  if (item.kind === "message") {
    return { pos, text: item.text, kind: "message", section: item.section };
  }
  return {
    pos,
    text: item.text,
    kind: item.type === "final_candidate_question" ? "candidate_question" : "interview",
    section: item.section,
  };
}

async function loadEntries(options?: {
  companyId?: string;
  sequence?: InterviewSequenceItem[] | null;
}): Promise<SeqEntry[]> {
  // Prefer the sequence passed directly from the front-end (ensures sync).
  if (options?.sequence && options.sequence.length > 0) {
    return options.sequence.map(seqItemToEntry);
  }

  // Fallback: try to load question bank and build a sequence.
  const cid = options?.companyId ?? DEFAULT_COMPANY_ID;
  try {
    const bank = await readQuestionBank(cid);
    if (bank && bank.questionBank.length > 0) {
      return buildInterviewSequence(bank).map(seqItemToEntry);
    }
  } catch {
    // ignore
  }

  // Last resort: old demo-questions.json
  try {
    const set = await readGeneratedQuestions();
    if (set && set.questions.length > 0) {
      return set.questions.map((q, i) => ({
        pos: i + 1,
        text: q.text,
        kind: (q.type === "final_candidate_question" ? "candidate_question" : "interview") as SeqKind,
        section: q.type === "intro" ? "intro" : q.type === "final_candidate_question" ? "final_candidate_question" : "behavioral",
      }));
    }
  } catch {
    // ignore
  }

  return [];
}

// ─── Public API ───────────────────────────────────────────────────────

export async function initSessionQueue(
  sessionId: string,
  options?: {
    companyId?: string;
    ragContext?: string | null;
    sequence?: InterviewSequenceItem[] | null;
  }
): Promise<{ questionsTotal: number }> {
  const entries = await loadEntries(options);

  const queue: SessionQueue = {
    sessionId,
    companyId: options?.companyId?.trim() || DEFAULT_COMPANY_ID,
    entries,
    items: new Map(),
    preparing: new Map(),
    cachedRagContext: options?.ragContext ?? null,
    ragContextPromise: null,
    evaluations: new Map(),
  };
  queues.set(sessionId, queue);

  const answerableCount = entries.filter((e) => e.kind !== "message").length;
  console.log(
    `[Queue] session=${sid(sessionId)} initialized total=${entries.length} ` +
      `answerable=${answerableCount} company=${queue.companyId} lookahead=${LOOKAHEAD}`
  );

  for (let i = 1; i <= Math.min(LOOKAHEAD, entries.length); i++) {
    prepareItem(queue, i);
  }

  return { questionsTotal: answerableCount };
}

export async function getQueueItem(
  sessionId: string,
  questionNumber: number
): Promise<QueuedQuestion | null> {
  const queue = queues.get(sessionId);
  if (!queue) return null;

  const done = queue.items.get(questionNumber);
  if (done) return done;

  const inflight = queue.preparing.get(questionNumber);
  if (inflight) return inflight;

  prepareItem(queue, questionNumber);
  const promise = queue.preparing.get(questionNumber);
  if (promise) return promise;

  return null;
}

export function peekQueueItem(
  sessionId: string,
  questionNumber: number
): QueuedQuestion | null {
  const queue = queues.get(sessionId);
  if (!queue) return null;

  const done = queue.items.get(questionNumber);
  if (done) return done;

  if (queue.preparing.has(questionNumber)) {
    return preparingStub(queue, questionNumber);
  }

  return null;
}

export function advanceQueue(
  sessionId: string,
  answeredQuestionNumber: number
): void {
  const queue = queues.get(sessionId);
  if (!queue) return;

  for (let i = 1; i <= LOOKAHEAD; i++) {
    const num = answeredQuestionNumber + i;
    if (num <= queue.entries.length) {
      prepareItem(queue, num);
    }
  }

  console.log(
    `[Queue] session=${sid(sessionId)} advanced after q=${answeredQuestionNumber} ` +
      `preparing=[${Array.from(queue.preparing.keys()).join(",")}] ` +
      `ready=[${Array.from(queue.items.keys())
        .filter((n) => queue.items.get(n)?.status === "ready")
        .join(",")}]`
  );
}

export function getQueueSnapshot(sessionId: string): QueueSnapshot | null {
  const queue = queues.get(sessionId);
  if (!queue) return null;

  const all = new Map<number, QueuedQuestion>();
  for (const [num, item] of queue.items) all.set(num, item);
  for (const num of queue.preparing.keys()) {
    if (!all.has(num)) all.set(num, preparingStub(queue, num));
  }

  return {
    sessionId,
    totalItems: queue.entries.length,
    items: Array.from(all.values()).sort((a, b) => a.questionNumber - b.questionNumber),
    cachedContextLength: queue.cachedRagContext?.length ?? 0,
    evaluationsCount: queue.evaluations.size,
  };
}

export function cleanupQueue(sessionId: string): void {
  queues.delete(sessionId);
  console.log(`[Queue] session=${sid(sessionId)} cleaned up`);
}

/**
 * Return the cached RAG company context for a session, if it has already
 * been retrieved. Returns null if the session is unknown or RAG hasn't run yet.
 * Used by answer-candidate-question to skip a redundant retrieval.
 */
export function getSessionCachedRagContext(sessionId: string): string | null {
  return queues.get(sessionId)?.cachedRagContext ?? null;
}

export function evaluateAnswerInBackground(
  sessionId: string,
  questionNumber: number,
  questionText: string,
  transcript: string
): void {
  const queue = queues.get(sessionId);
  if (!queue) {
    console.log(`[Queue] session=${sid(sessionId)} q=${questionNumber} eval skipped (no queue)`);
    return;
  }

  void (async () => {
    const startedAt = Date.now();
    try {
      const rag = await getSessionRagContext(queue);
      const llmStart = Date.now();
      const evaluation = await evaluateAnswer(rag.context, questionText, transcript);
      const llm_ms = Date.now() - llmStart;
      const total_ms = Date.now() - startedAt;

      queue.evaluations.set(questionNumber, {
        questionNumber,
        score: evaluation.score,
        feedback: evaluation.feedback,
        model: evaluation.model,
        timing: { rag_ms: rag.rag_ms, llm_ms, total_ms },
      });

      console.log(
        `[Queue] session=${sid(sessionId)} q=${questionNumber} eval=done ` +
          `score=${evaluation.score} rag=${rag.rag_ms}ms llm=${llm_ms}ms total=${total_ms}ms`
      );
    } catch (err) {
      console.error(
        `[Queue] session=${sid(sessionId)} q=${questionNumber} eval=failed ` +
          `error="${err instanceof Error ? err.message : "Unknown error"}" ` +
          `total=${Date.now() - startedAt}ms`
      );
    }
  })();
}

export function getEvaluations(sessionId: string): AnswerEvaluationRecord[] {
  const queue = queues.get(sessionId);
  if (!queue) return [];
  return Array.from(queue.evaluations.values()).sort(
    (a, b) => a.questionNumber - b.questionNumber
  );
}

// ─── Internals ────────────────────────────────────────────────────────

function sid(sessionId: string): string {
  return sessionId.slice(0, 8);
}

function preparingStub(queue: SessionQueue, questionNumber: number): QueuedQuestion {
  const entry = queue.entries[questionNumber - 1];
  return {
    questionNumber,
    questionId: questionNumber,
    text: entry?.text ?? "",
    kind: entry?.kind ?? "interview",
    section: entry?.section ?? "",
    audioUrl: null,
    audioFilename: null,
    status: "preparing",
    timing: { rag_ms: 0, llm_ms: 0, tts_ms: 0, total_ms: 0 },
    source: entry ? "cache" : "fresh",
  };
}

async function getSessionRagContext(
  queue: SessionQueue
): Promise<{ context: string; rag_ms: number; fromCache: boolean }> {
  if (queue.cachedRagContext !== null) {
    return { context: queue.cachedRagContext, rag_ms: 0, fromCache: true };
  }

  let initiated = false;
  if (!queue.ragContextPromise) {
    initiated = true;
    queue.ragContextPromise = (async () => {
      const start = Date.now();
      const retrieval = await retrieveCompanyContext(
        queue.companyId,
        SESSION_RETRIEVAL_QUERY
      );
      const rag_ms = Date.now() - start;
      queue.cachedRagContext = retrieval.context;
      console.log(
        `[Queue] session=${sid(queue.sessionId)} rag=retrieved ` +
          `method=${retrieval.method} chunks=${retrieval.chunks.length} rag=${rag_ms}ms`
      );
      return { context: retrieval.context, rag_ms };
    })();
  }

  const { context, rag_ms } = await queue.ragContextPromise;
  return { context, rag_ms: initiated ? rag_ms : 0, fromCache: !initiated };
}

async function loadHistory(sessionId: string): Promise<AnsweredTurn[]> {
  try {
    const session = await readSession(sessionId);
    if (!session) return [];
    return session.answers
      .slice()
      .sort((a, b) => a.question_number - b.question_number)
      .map((a) => ({ question: a.question_text, transcript: a.transcript }));
  } catch {
    return [];
  }
}

function prepareItem(queue: SessionQueue, questionNumber: number): void {
  if (questionNumber < 1) return;
  if (queue.items.has(questionNumber)) return;
  if (queue.preparing.has(questionNumber)) return;

  const promise = doPrepare(queue, questionNumber);
  queue.preparing.set(questionNumber, promise);
}

async function doPrepare(
  queue: SessionQueue,
  questionNumber: number
): Promise<QueuedQuestion> {
  const startedAt = Date.now();
  const entry = queue.entries[questionNumber - 1];
  const source: QueueItemSource = entry ? "cache" : "fresh";

  const item: QueuedQuestion = {
    questionNumber,
    questionId: questionNumber,
    text: entry?.text ?? "",
    kind: entry?.kind ?? "interview",
    section: entry?.section ?? "",
    audioUrl: null,
    audioFilename: null,
    status: "preparing",
    timing: { rag_ms: 0, llm_ms: 0, tts_ms: 0, total_ms: 0 },
    source,
  };

  try {
    // Adaptive follow-up path: only for questions past the pre-generated set.
    if (!entry) {
      const rag = await getSessionRagContext(queue);
      item.timing.rag_ms = rag.rag_ms;

      const history = await loadHistory(queue.sessionId);
      const llmStart = Date.now();
      const gen = await generateFollowUpQuestion(rag.context, history);
      item.timing.llm_ms = Date.now() - llmStart;

      item.text = gen.text;
      item.kind = "interview";
      item.section = "behavioral";
    }

    // TTS for all items (questions and messages).
    const ttsStart = Date.now();
    const ttsResult = await requestTts({ text: item.text });
    item.timing.tts_ms = Date.now() - ttsStart;

    item.audioUrl = ttsResult.audio_url;
    item.audioFilename = ttsResult.filename;
    item.status = "ready";
    item.timing.total_ms = Date.now() - startedAt;

    console.log(
      `[Queue] session=${sid(queue.sessionId)} q=${questionNumber} ` +
        `status=ready kind=${item.kind} section=${item.section} ` +
        `rag=${item.timing.rag_ms}ms llm=${item.timing.llm_ms}ms ` +
        `tts=${item.timing.tts_ms}ms total=${item.timing.total_ms}ms source=${source}`
    );
  } catch (err) {
    item.status = "failed";
    item.error = err instanceof Error ? err.message : "Unknown error";
    item.timing.total_ms = Date.now() - startedAt;

    console.error(
      `[Queue] session=${sid(queue.sessionId)} q=${questionNumber} ` +
        `status=failed error="${item.error}" total=${item.timing.total_ms}ms source=${source}`
    );
  }

  queue.items.set(questionNumber, item);
  queue.preparing.delete(questionNumber);
  return item;
}
