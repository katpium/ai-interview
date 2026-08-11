"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  INTERVIEW_QUESTIONS,
  CANDIDATE_QUESTION_PLACEHOLDER_RESPONSE,
} from "@/lib/questions";
import type { InterviewState } from "@/lib/interviewState";
import type { InterviewSequenceItem } from "@/lib/questionGenerator";
import CompletionSummary from "@/components/CompletionSummary";
import CandidateTile from "@/components/CandidateTile";
import AITile from "@/components/AITile";
import DialogBox from "@/components/DialogBox";
import TranscriptPanel from "@/components/TranscriptPanel";
import QuestionInfo from "@/components/QuestionInfo";
import InterviewStatusCard from "@/components/InterviewStatusCard";
import DebugTimingPanel from "@/components/DebugTimingPanel";

export type { InterviewState };

// ─── Internal sequence item ───────────────────────────────────────────
// Normalized representation used throughout the component.

type SeqItem = {
  pos: number;       // 1-indexed position (= queue position)
  text: string;
  kind: "interview" | "candidate_question" | "message";
  section: string;
};

function toSeqItems(raw: InterviewSequenceItem[]): SeqItem[] {
  return raw.map((item, idx) => ({
    pos: idx + 1,
    text: item.text,
    kind:
      item.kind === "message"
        ? "message"
        : item.type === "final_candidate_question"
          ? "candidate_question"
          : "interview",
    section: item.section,
  }));
}

function fallbackSeqItems(): SeqItem[] {
  const items: SeqItem[] = INTERVIEW_QUESTIONS.map((q, idx) => ({
    pos: idx + 1,
    text: q.text,
    kind: q.kind === "candidate_question" ? "candidate_question" : "interview",
    section:
      q.kind === "candidate_question"
        ? "final_candidate_question"
        : idx === 0
          ? "intro"
          : "behavioral",
  }));
  items.push({
    pos: items.length + 1,
    text: "Thank you for completing the interview. Your responses have been submitted.",
    kind: "message",
    section: "closing",
  });
  return items;
}

// Human-readable label for the current section in the room header.
function sectionLabel(section: string): string {
  switch (section) {
    case "opening":
      return "Welcome";
    case "intro":
      return "Introduction";
    case "behavioral":
      return "Behavioral Questions";
    case "transition":
      return "Behavioral Questions";
    case "technical":
      return "Technical Questions";
    case "final_candidate_question":
      return "Candidate Questions";
    case "closing":
      return "Complete";
    default:
      return "";
  }
}

// ─── Types ────────────────────────────────────────────────────────────

type PerQuestionResult = {
  transcript: string | null;
  // For the final candidate question: the AI's RAG-grounded answer text.
  // Falls back to placeholderResponse if the answer route fails.
  answerText: string | null;
  placeholderResponse: string | null;
};

export type QuestionTiming = {
  question_id: number;
  question_load_ms: number;
  tts_request_ms: number;
  tts_server_ms: number;
  audio_load_ms: number;
  audio_play_duration_ms: number;
  recording_duration_ms: number;
  stt_request_ms: number;
  stt_server_ms: number;
  total_question_time_ms: number;
  queue_source: string;
  queue_rag_ms: number;
  queue_llm_ms: number;
  queue_tts_ms: number;
  queue_prepare_ms: number;
  queue_wait_ms: number;
};

function emptyTiming(pos: number): QuestionTiming {
  return {
    question_id: pos,
    question_load_ms: 0,
    tts_request_ms: 0,
    tts_server_ms: 0,
    audio_load_ms: 0,
    audio_play_duration_ms: 0,
    recording_duration_ms: 0,
    stt_request_ms: 0,
    stt_server_ms: 0,
    total_question_time_ms: 0,
    queue_source: "",
    queue_rag_ms: 0,
    queue_llm_ms: 0,
    queue_tts_ms: 0,
    queue_prepare_ms: 0,
    queue_wait_ms: 0,
  };
}

type AudioEntry = {
  audio_url: string;
  filename: string;
  tts_server_ms: number;
  cached: boolean; // true if Server 1 reported a cache hit
};

type QueueTiming = {
  rag_ms: number;
  llm_ms: number;
  tts_ms: number;
  total_ms: number;
  source: string;
};

const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const PREFERRED_VIDEO_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function pickSupportedMimeType(candidates: string[]): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  for (const t of candidates) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function extensionForMimeType(mime: string | undefined): string {
  if (!mime) return "webm";
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("wav")) return "wav";
  return "webm";
}

const MAX_INTRO_WORDS = 35;

function limitWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(" ").replace(/[,;:.\s]+$/, "") + ".";
}

function buildIntroText(company: string | null, role: string | null): string {
  const greeting = company
    ? `Hi, I'm your AI interviewer for ${company}.`
    : "Hi, I'm your AI interviewer.";
  const roleLine = role ? ` We'll be discussing the ${role} role today.` : "";
  return limitWords(
    `${greeting}${roleLine} After each question, your recording starts automatically. Let's begin.`,
    MAX_INTRO_WORDS
  );
}

// ─── Component ────────────────────────────────────────────────────────

export default function InterviewRoom({
  inviteToken,
  interviewRole,
  interviewLevel,
}: {
  inviteToken?: string;
  interviewRole?: string;
  interviewLevel?: string;
}) {
  const [state, setState] = useState<InterviewState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Full interview sequence (questions + messages)
  const [items, setItems] = useState<SeqItem[]>(fallbackSeqItems());
  const [seqIndex, setSeqIndex] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  // Company/role for the spoken intro and the header label
  const [companyInfo, setCompanyInfo] = useState<{
    companyName: string | null;
    companyId: string | null;
    role: string | null;
  }>({ companyName: null, companyId: null, role: null });
  const [introText, setIntroText] = useState<string | null>(null);

  const [permissionRequested, setPermissionRequested] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  // Secure context detection (false on plain HTTP outside localhost)
  const [secureContext, setSecureContext] = useState(true);

  // Preload progress shown on the preparation screen.
  const [preloadProgress, setPreloadProgress] = useState<{
    ready: number;
    total: number;
  }>({ ready: 0, total: 0 });

  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedMimeType, setRecordedMimeType] = useState<string | null>(null);

  const [results, setResults] = useState<Record<number, PerQuestionResult>>({});
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const [timings, setTimings] = useState<Record<number, QuestionTiming>>({});
  const timingsRef = useRef<Record<number, QuestionTiming>>({});
  const questionLoadMsRef = useRef<number>(0);
  const audioUrlReceivedAtRef = useRef<number>(0);
  const audioPlayStartRef = useRef<number>(0);
  const recordingStartRef = useRef<number>(0);

  // Keyed by item.pos
  const audioCacheRef = useRef<Record<number, AudioEntry>>({});
  const prefetchInFlightRef = useRef<Map<number, Promise<AudioEntry | null>>>(new Map());

  // Raw sequence from the API — kept in a ref so session creation can pass it
  const rawSequenceRef = useRef<InterviewSequenceItem[] | null>(null);

  type ErrorPhase = "session" | "tts" | "audio" | "stt" | "save" | "complete";
  const [errorPhase, setErrorPhase] = useState<ErrorPhase | null>(null);

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const recordedBlobRef = useRef<Blob | null>(null);
  const recordedUrlRef = useRef<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  // Set to true the moment the interview completes — guards against background
  // tasks (AI answer generation) writing state after the user has moved on.
  const sessionDoneRef = useRef(false);
  const audioFilenameRef = useRef<string | null>(null);
  const candidateAudioFilenameRef = useRef<string | null>(null);
  const lastTranscriptRef = useRef<string | null>(null);

  const startingRef = useRef(false);
  const advancingRef = useRef(false);
  const transcribeInFlightRef = useRef(false);
  const stoppingRef = useRef(false);

  // Mirrors for async callbacks
  const seqIndexRef = useRef<number>(seqIndex);
  const itemsRef = useRef<SeqItem[]>(items);
  const currentItemRef = useRef<SeqItem>(items[0]);

  useEffect(() => {
    const item = items[seqIndex] ?? items[0];
    seqIndexRef.current = seqIndex;
    itemsRef.current = items;
    currentItemRef.current = item;
  }, [items, seqIndex]);

  const currentItem: SeqItem = items[seqIndex] ?? items[0];
  const isLastItem = seqIndex === items.length - 1;
  const isMessage = currentItem.kind === "message";
  const isCandidateQuestion = currentItem.kind === "candidate_question";

  // Count only answerable questions for display
  const answerableItems = items.filter((i) => i.kind !== "message");
  const totalQuestions = answerableItems.length;
  const questionNumber = items.slice(0, seqIndex + 1).filter((i) => i.kind !== "message").length;

  // "Last question" for the button label — true when there are no more
  // answerable items after the current position.
  const remainingAnswerable = items.slice(seqIndex + 1).filter((i) => i.kind !== "message").length;
  const isLastQuestion = remainingAnswerable === 0 && !isMessage;

  const currentResult: PerQuestionResult | undefined = results[currentItem.pos];

  // Invite role takes priority over the question-bank default role.
  const effectiveRole = interviewRole ?? companyInfo.role ?? "Software Engineer";

  /* ────────────────────────────────────────────────────────────────────
     Load questions from /api/questions on mount
  ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const startedAt = performance.now();
      try {
        const qParams = new URLSearchParams();
        if (interviewRole) qParams.set("role", interviewRole);
        if (interviewLevel) qParams.set("level", interviewLevel);
        const qStr = qParams.toString();
        const res = await fetch(`/api/questions${qStr ? `?${qStr}` : ""}`);
        if (res.status === 409) {
          // Not enough approved questions — surface a clean message.
          const err = await res.json().catch(() => ({})) as { missing?: string[]; role?: string; level?: string };
          const label = [err.level, err.role].filter(Boolean).join(" ");
          setErrorMessage(
            `This interview is not ready yet. ${label ? `Not enough approved questions for ${label}. ` : ""}Please contact the recruiter.`
          );
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as {
          interviewSequence?: InterviewSequenceItem[];
          companyId?: string | null;
          companyName?: string | null;
          role?: string | null;
          source?: string;
          status?: string | null;
        };
        if (cancelled) return;
        const loadMs = Math.round(performance.now() - startedAt);
        questionLoadMsRef.current = loadMs;
        console.log(`[Questions] load=${loadMs}ms source=${data.source ?? "unknown"}`);

        if (Array.isArray(data.interviewSequence) && data.interviewSequence.length > 0) {
          rawSequenceRef.current = data.interviewSequence;
          const seqItems = toSeqItems(data.interviewSequence);
          setItems(seqItems);
          recordTiming(seqItems[0].pos, { question_load_ms: loadMs });
          void prefetchItemAudio(seqItems[0]);
        }
        setCompanyInfo({
          companyName: data.companyName ?? null,
          companyId: data.companyId ?? null,
          role: data.role ?? null,
        });
      } catch {
        // Keep hardcoded fallback already in state.
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ────────────────────────────────────────────────────────────────────
     Secure-context detection
  ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const secure =
      typeof window !== "undefined"
        ? (window.isSecureContext ?? (window.location.protocol === "https:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"))
        : true;
    setSecureContext(secure);
    if (!secure) {
      console.warn(
        `[Permissions] Insecure context detected. Protocol: ${window.location.protocol}, ` +
          `Host: ${window.location.host}. navigator.mediaDevices = ${String(navigator.mediaDevices)}. ` +
          `getUserMedia requires HTTPS or localhost.`
      );
    } else {
      console.log(
        `[Permissions] Secure context OK. Protocol: ${window.location.protocol}, ` +
          `Host: ${window.location.host}. navigator.mediaDevices available: ${Boolean(navigator.mediaDevices)}`
      );
    }
  }, []);

  /* ────────────────────────────────────────────────────────────────────
     Cleanup on unmount
  ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      if (mediaStream) mediaStream.getTracks().forEach((t) => t.stop());
      if (recordedUrlRef.current) {
        URL.revokeObjectURL(recordedUrlRef.current);
        recordedUrlRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ────────────────────────────────────────────────────────────────────
     Helpers
  ──────────────────────────────────────────────────────────────────── */
  const setError = useCallback((phase: ErrorPhase, message: string) => {
    setErrorPhase(phase);
    setErrorMessage(message);
    setState("error");
  }, []);

  const clearRecordedPreview = useCallback(() => {
    if (recordedUrlRef.current) {
      URL.revokeObjectURL(recordedUrlRef.current);
      recordedUrlRef.current = null;
    }
    setRecordedUrl(null);
    setRecordedMimeType(null);
    recordedBlobRef.current = null;
    recordedChunksRef.current = [];
  }, []);

  const recordTiming = useCallback(
    (pos: number, patch: Partial<QuestionTiming>) => {
      const prev = timingsRef.current[pos] ?? emptyTiming(pos);
      const next: QuestionTiming = { ...prev, ...patch };
      next.total_question_time_ms =
        next.question_load_ms +
        next.tts_request_ms +
        next.audio_load_ms +
        next.audio_play_duration_ms +
        next.recording_duration_ms +
        next.stt_request_ms;
      timingsRef.current = { ...timingsRef.current, [pos]: next };
      setTimings(timingsRef.current);
    },
    []
  );

  /* ────────────────────────────────────────────────────────────────────
     TTS / audio helpers
  ──────────────────────────────────────────────────────────────────── */
  const fetchTtsDirect = useCallback(async (item: SeqItem): Promise<AudioEntry> => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.text, speed: 1.0, question_id: item.pos }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Server 2 /api/tts failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      audio_url: string;
      filename: string;
      cached?: boolean;
      timing?: { server2_to_server1_tts_ms?: number };
    };
    return {
      audio_url: data.audio_url,
      filename: data.filename,
      tts_server_ms: data.timing?.server2_to_server1_tts_ms ?? 0,
      cached: data.cached ?? false,
    };
  }, []);

  const fetchFromQueue = useCallback(
    async (
      item: SeqItem,
      waitForReady: boolean
    ): Promise<{ entry: AudioEntry; queueTiming: QueueTiming } | null> => {
      const sid = sessionIdRef.current;
      if (!sid) return null;
      try {
        const waitParam = waitForReady ? "&wait=1" : "";
        const res = await fetch(`/api/sessions/${sid}/queue?q=${item.pos}${waitParam}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data.status === "ready" && data.audioUrl) {
          return {
            entry: {
              audio_url: data.audioUrl,
              filename: data.audioFilename ?? "",
              tts_server_ms: data.timing?.tts_ms ?? 0,
              cached: Boolean(data.cached),
            },
            queueTiming: {
              rag_ms: data.timing?.rag_ms ?? 0,
              llm_ms: data.timing?.llm_ms ?? 0,
              tts_ms: data.timing?.tts_ms ?? 0,
              total_ms: data.timing?.total_ms ?? 0,
              source: data.source ?? "queue",
            },
          };
        }
        return null;
      } catch {
        return null;
      }
    },
    []
  );

  const pollQueueUntilReady = useCallback(
    async (item: SeqItem, timeoutMs = 15000): Promise<{ entry: AudioEntry; queueTiming: QueueTiming } | null> => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = await fetchFromQueue(item, false);
        if (result) return result;
        await new Promise((r) => setTimeout(r, 400));
      }
      return null;
    },
    [fetchFromQueue]
  );

  const prefetchItemAudio = useCallback(
    (item: SeqItem): Promise<AudioEntry | null> => {
      const cached = audioCacheRef.current[item.pos];
      if (cached) return Promise.resolve(cached);
      const existing = prefetchInFlightRef.current.get(item.pos);
      if (existing) return existing;

      const p = (async () => {
        const startedAt = performance.now();
        try {
          const queueResult = await fetchFromQueue(item, false);
          if (queueResult) {
            audioCacheRef.current[item.pos] = queueResult.entry;
            const waitMs = Math.round(performance.now() - startedAt);
            console.log(`[Preload] pos=${item.pos} from queue in ${waitMs}ms source=queue`);
            recordTiming(item.pos, {
              queue_source: "queue",
              queue_rag_ms: queueResult.queueTiming.rag_ms,
              queue_llm_ms: queueResult.queueTiming.llm_ms,
              queue_tts_ms: queueResult.queueTiming.tts_ms,
              queue_prepare_ms: queueResult.queueTiming.total_ms,
              queue_wait_ms: waitMs,
            });
            return queueResult.entry;
          }

          const entry = await fetchTtsDirect(item);
          audioCacheRef.current[item.pos] = entry;
          const totalMs = Math.round(performance.now() - startedAt);
          console.log(`[Preload] pos=${item.pos} direct TTS in ${totalMs}ms source=fresh`);
          recordTiming(item.pos, { queue_source: "fresh", queue_wait_ms: totalMs });
          return entry;
        } catch (err) {
          console.warn(
            `[Preload] pos=${item.pos} prefetch failed: ${err instanceof Error ? err.message : "error"}`
          );
          return null;
        } finally {
          prefetchInFlightRef.current.delete(item.pos);
        }
      })();

      prefetchInFlightRef.current.set(item.pos, p);
      return p;
    },
    [fetchTtsDirect, fetchFromQueue, recordTiming]
  );

  /* ────────────────────────────────────────────────────────────────────
     Permissions / media
  ──────────────────────────────────────────────────────────────────── */
  const requestPermissions = useCallback(async (withVideo: boolean) => {
    // ── Debug: log context on every click ──────────────────────────
    console.log(`[Permissions] Button clicked — withVideo=${withVideo}`);
    console.log(`[Permissions] Protocol: ${typeof window !== "undefined" ? window.location.protocol : "SSR"}`);
    console.log(`[Permissions] isSecureContext: ${typeof window !== "undefined" ? String(window.isSecureContext) : "SSR"}`);
    console.log(`[Permissions] mediaDevices available: ${typeof navigator !== "undefined" && !!navigator.mediaDevices}`);

    // ── Secure-context guard ───────────────────────────────────────
    // navigator.mediaDevices is undefined on plain HTTP (non-localhost).
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== "function"
    ) {
      const proto = typeof window !== "undefined" ? window.location.protocol : "unknown:";
      const host  = typeof window !== "undefined" ? window.location.host  : "unknown";
      console.error(
        `[Permissions] getUserMedia unavailable. ` +
          `Likely cause: non-secure origin (${proto}//${host}). ` +
          `navigator.mediaDevices = ${String(typeof navigator !== "undefined" ? navigator.mediaDevices : "undefined")}`
      );
      setErrorMessage(
        `Microphone access is blocked on ${proto}//${host}. ` +
          `Browsers require HTTPS (or localhost) for camera and microphone. ` +
          `Ask your host for an HTTPS URL, or use a reverse-proxy / tunnel that adds TLS.`
      );
      return;
    }

    // ── Request media ──────────────────────────────────────────────
    console.log(`[Permissions] Calling getUserMedia({ audio: true, video: ${withVideo} })`);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
      console.log(`[Permissions] getUserMedia success — tracks: ${stream.getTracks().map((t) => t.kind).join(", ")}`);
      setMediaStream(stream);
      setVideoEnabled(withVideo);
      setPermissionRequested(true);
      setErrorMessage(null);
    } catch (err) {
      const name    = err instanceof Error ? err.name    : "UnknownError";
      const message = err instanceof Error ? err.message : "Permission denied";
      console.error(`[Permissions] getUserMedia failed: ${name}: ${message}`);

      if (withVideo) {
        // Try audio-only fallback.
        console.log("[Permissions] Retrying with audio-only…");
        try {
          const audioOnly = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          console.log("[Permissions] Audio-only granted");
          setMediaStream(audioOnly);
          setVideoEnabled(false);
          setPermissionRequested(true);
          setErrorMessage("Camera unavailable — continuing with microphone only.");
          return;
        } catch (innerErr) {
          const innerName    = innerErr instanceof Error ? innerErr.name    : "UnknownError";
          const innerMessage = innerErr instanceof Error ? innerErr.message : "Permission denied";
          console.error(`[Permissions] getUserMedia failed: ${innerName}: ${innerMessage} (audio-only retry)`);
          setErrorMessage(
            "Camera or microphone access failed. Please check your browser permissions and try again."
          );
          return;
        }
      }
      setErrorMessage(
        "Camera or microphone access failed. Please check your browser permissions and try again."
      );
    }
  }, []);

  /* ────────────────────────────────────────────────────────────────────
     Recording
  ──────────────────────────────────────────────────────────────────── */
  const startRecording = useCallback(() => {
    if (!mediaStream) {
      setError("audio", "No microphone stream available.");
      return;
    }

    clearRecordedPreview();
    lastTranscriptRef.current = null;
    stoppingRef.current = false;

    const mimeType = videoEnabled
      ? pickSupportedMimeType(PREFERRED_VIDEO_MIME_TYPES)
      : pickSupportedMimeType(PREFERRED_AUDIO_MIME_TYPES);

    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(mediaStream, { mimeType })
        : new MediaRecorder(mediaStream);
    } catch (err) {
      setError("audio", `Unable to start recorder: ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }

    recordedChunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const recordingMs = Math.round(performance.now() - recordingStartRef.current);
      const pos = currentItemRef.current.pos;
      recordTiming(pos, { recording_duration_ms: recordingMs });
      console.log(`[Recording] pos=${pos} duration=${recordingMs}ms`);

      const effectiveMime =
        recorder.mimeType || mimeType || (videoEnabled ? "video/webm" : "audio/webm");
      const blob = new Blob(recordedChunksRef.current, { type: effectiveMime });
      recordedBlobRef.current = blob;
      setRecordedMimeType(effectiveMime);

      if (recordedUrlRef.current) URL.revokeObjectURL(recordedUrlRef.current);
      const url = URL.createObjectURL(blob);
      recordedUrlRef.current = url;
      setRecordedUrl(url);

      setState("recorded");
      void transcribeRecording(blob, effectiveMime);
    };

    recorder.onerror = (e) => {
      const ev = e as unknown as { error?: { message?: string } };
      setError("audio", `Recorder error: ${ev.error?.message ?? "unknown"}`);
    };

    mediaRecorderRef.current = recorder;
    recordingStartRef.current = performance.now();
    recorder.start();
    setState("recording");

    // Prefetch next item's audio while candidate answers.
    const nextItem = itemsRef.current[seqIndexRef.current + 1];
    if (nextItem) void prefetchItemAudio(nextItem);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaStream, videoEnabled, clearRecordedPreview, recordTiming, prefetchItemAudio, setError]);

  const stopRecording = useCallback(() => {
    if (stoppingRef.current) return;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    stoppingRef.current = true;
    try {
      recorder.stop();
    } catch (err) {
      stoppingRef.current = false;
      setError("audio", `Failed to stop recorder: ${err instanceof Error ? err.message : "Unknown error"}`);
    }
  }, [setError]);

  /* ────────────────────────────────────────────────────────────────────
     Save
  ──────────────────────────────────────────────────────────────────── */
  const saveAnswer = useCallback(async (transcript: string) => {
    const sid = sessionIdRef.current;
    if (!sid) throw new Error("No session id available");

    const item = currentItemRef.current;
    const idx = seqIndexRef.current;

    const res = await fetch(`/api/sessions/${sid}/answers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question_id: item.pos,
        question_number: item.pos,
        question_text: item.text,
        question_kind: item.kind === "candidate_question" ? "candidate_question" : "interview",
        transcript,
        audio_filename: audioFilenameRef.current,
        candidate_audio_filename: candidateAudioFilenameRef.current,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST /api/sessions/${sid}/answers ${res.status} ${text}`);
    }

    // Pre-cache next item's audio from the queue response.
    try {
      const data = await res.clone().json();
      if (data.nextQuestion?.status === "ready" && data.nextQuestion.audioUrl) {
        const nextItem = itemsRef.current[idx + 1];
        if (nextItem && !audioCacheRef.current[nextItem.pos]) {
          audioCacheRef.current[nextItem.pos] = {
            audio_url: data.nextQuestion.audioUrl,
            filename: data.nextQuestion.audioFilename ?? "",
            tts_server_ms: data.nextQuestion.timing?.tts_ms ?? 0,
            cached: Boolean(data.nextQuestion.cached),
          };
          recordTiming(nextItem.pos, {
            queue_source: "queue",
            queue_rag_ms: data.nextQuestion.timing?.rag_ms ?? 0,
            queue_llm_ms: data.nextQuestion.timing?.llm_ms ?? 0,
            queue_tts_ms: data.nextQuestion.timing?.tts_ms ?? 0,
            queue_prepare_ms: data.nextQuestion.timing?.total_ms ?? 0,
            queue_wait_ms: 0,
          });
          console.log(`[Preload] pos=${nextItem.pos} pre-cached from /answers response source=queue`);
        }
      }
    } catch {
      // Non-critical — best-effort.
    }
  }, [recordTiming]);

  const finalizeAfterSave = useCallback((transcript: string) => {
    const item = currentItemRef.current;
    // Do NOT set placeholderResponse here — only show it if the LLM call
    // fails. This prevents the "next version" placeholder from flashing
    // on screen before the real answer arrives.
    setResults((prev) => ({
      ...prev,
      [item.pos]: {
        transcript,
        answerText: null,
        placeholderResponse: null,
      },
    }));

    if (item.kind === "candidate_question") {
      setState("final_question_response");
      const itemPos = item.pos;
      const cid = companyInfo.companyId ?? undefined;
      const sid = sessionIdRef.current ?? undefined;

      // If STT returned nothing, use a generic fallback so the candidate
      // still gets a real spoken answer instead of silence.
      const questionToSend =
        transcript.trim() ||
        "Could you tell me more about the company culture and what a typical day looks like in this role?";

      if (!transcript.trim()) {
        console.warn(
          "[FinalAnswer] STT returned empty transcript — using fallback question. " +
            `companyId=${cid ?? "default"}`
        );
      } else {
        console.log(
          `[FinalAnswer] question="${questionToSend.slice(0, 120)}" ` +
            `companyId=${cid ?? "default"} sessionId=${sid?.slice(0, 8) ?? "none"}`
        );
      }

      void (async () => {
        try {
          const t0 = performance.now();
          console.log("[FinalAnswer] POST /api/answer-candidate-question …");
          // If the user already moved to the completion screen, drop the result.
          if (sessionDoneRef.current) { console.log("[FinalAnswer] session done — discarding result"); return; }
          const res = await fetch("/api/answer-candidate-question", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: cid,
              sessionId: sid,
              question: questionToSend,
            }),
          });
          if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`POST /api/answer-candidate-question ${res.status} ${text}`);
          }
          const data = (await res.json()) as {
            answer: string;
            audio_url: string;
            filename: string;
            cached?: boolean;
            timing?: { rag_ms?: number; llm_ms?: number; tts_ms?: number; total_ms?: number };
          };
          const totalMs = Math.round(performance.now() - t0);
          console.log(
            `[FinalAnswer] OK in ${totalMs}ms — rag=${data.timing?.rag_ms ?? 0}ms ` +
              `llm=${data.timing?.llm_ms ?? 0}ms tts=${data.timing?.tts_ms ?? 0}ms ` +
              `retrieval=${(data as { retrievalMethod?: string }).retrievalMethod ?? "?"} ` +
              `answer="${data.answer.slice(0, 80)}"`
          );
          // Don't update UI if the interview already completed while we were waiting.
          if (sessionDoneRef.current) { console.log("[FinalAnswer] session done — discarding late response"); return; }
          setResults((prev) => ({
            ...prev,
            [itemPos]: {
              ...(prev[itemPos] ?? { transcript: null, answerText: null, placeholderResponse: null }),
              answerText: data.answer,
            },
          }));
          audioUrlReceivedAtRef.current = performance.now();
          setAudioUrl(data.audio_url);
          setState("final_answer_speaking");
        } catch (err) {
          console.error(
            "[FinalAnswer] failed, falling back to placeholder:",
            err instanceof Error ? err.message : err
          );
          // Only show the placeholder when the real answer actually fails.
          setResults((prev) => ({
            ...prev,
            [itemPos]: {
              ...(prev[itemPos] ?? { transcript: null, answerText: null, placeholderResponse: null }),
              placeholderResponse: CANDIDATE_QUESTION_PLACEHOLDER_RESPONSE,
            },
          }));
          setState("saved");
        }
      })();
    } else {
      setState("saved");
    }
  }, [companyInfo.companyId]);

  /* ────────────────────────────────────────────────────────────────────
     Transcription
  ──────────────────────────────────────────────────────────────────── */
  const transcribeRecording = useCallback(
    async (blob: Blob, mimeType: string) => {
      if (transcribeInFlightRef.current) return;
      transcribeInFlightRef.current = true;

      setState("uploading");
      const sttPos = currentItemRef.current.pos;
      const sttStartedAt = performance.now();
      let transcript: string;
      try {
        const form = new FormData();
        const ext = extensionForMimeType(mimeType);
        const file = new File([blob], `answer-${Date.now()}.${ext}`, { type: mimeType });
        form.append("file", file);
        form.append("question_id", String(sttPos));
        if (sessionIdRef.current) form.append("session_id", sessionIdRef.current);

        const fetchPromise = fetch("/api/stt", { method: "POST", body: form });
        const transcribeTimer = setTimeout(() => {
          setState((s) => (s === "uploading" ? "transcribing" : s));
        }, 400);

        let res: Response;
        try {
          res = await fetchPromise;
        } finally {
          clearTimeout(transcribeTimer);
        }
        setState("transcribing");

        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Server 2 /api/stt ${res.status} ${text}`);
        }
        const data = (await res.json()) as {
          transcript: string;
          recording_filename?: string | null;
          timing?: { server2_to_server1_stt_ms?: number };
        };
        transcript = data.transcript;
        candidateAudioFilenameRef.current = data.recording_filename ?? null;
        lastTranscriptRef.current = transcript;

        const sttMs = Math.round(performance.now() - sttStartedAt);
        console.log(
          `[STT] pos=${sttPos} duration=${sttMs}ms ` +
            `transcript="${transcript.slice(0, 120)}" ` +
            `length=${transcript.length} empty=${transcript.trim().length === 0}`
        );
        recordTiming(sttPos, {
          stt_request_ms: sttMs,
          stt_server_ms: data.timing?.server2_to_server1_stt_ms ?? 0,
        });
      } catch (err) {
        transcribeInFlightRef.current = false;
        setError(
          "stt",
          `Could not transcribe your answer. ${err instanceof Error ? err.message : "Unknown error"}. You can retry without re-recording.`
        );
        return;
      }

      setState("saving");
      try {
        await saveAnswer(transcript);
      } catch (err) {
        transcribeInFlightRef.current = false;
        setError(
          "save",
          `Transcribed, but could not save the answer. ${err instanceof Error ? err.message : "Unknown error"}. You can retry the save without re-recording.`
        );
        return;
      }

      transcribeInFlightRef.current = false;
      finalizeAfterSave(transcript);
    },
    [saveAnswer, finalizeAfterSave, recordTiming, setError]
  );

  /* ────────────────────────────────────────────────────────────────────
     TTS + playback
  ──────────────────────────────────────────────────────────────────── */
  const generateAndPlayItemAudio = useCallback(
    async (item: SeqItem) => {
      // Choose the interview state based on item kind / section.
      const speakingState: InterviewState =
        item.kind === "message"
          ? item.section === "opening"
            ? "opening_speaking"
            : item.section === "transition"
              ? "transition_speaking"
              : "closing_speaking"
          : "ai_speaking";

      setState("generating_question_audio");
      setAudioUrl(null);

      try {
        const waitStart = performance.now();
        let entry: AudioEntry | null = audioCacheRef.current[item.pos] ?? null;
        let source = "cache";

        if (entry) {
          console.log(`[Preload] pos=${item.pos} using preloaded audio source=cache`);
        } else {
          console.log(`[Preload] pos=${item.pos} not cached — checking queue...`);
          const queueResult = await pollQueueUntilReady(item, 15000);

          if (queueResult) {
            entry = queueResult.entry;
            audioCacheRef.current[item.pos] = entry;
            source = "queue";
            recordTiming(item.pos, {
              queue_source: "queue",
              queue_rag_ms: queueResult.queueTiming.rag_ms,
              queue_llm_ms: queueResult.queueTiming.llm_ms,
              queue_tts_ms: queueResult.queueTiming.tts_ms,
              queue_prepare_ms: queueResult.queueTiming.total_ms,
            });
          } else {
            console.log(`[Preload] pos=${item.pos} queue unavailable — direct TTS`);
            entry = await prefetchItemAudio(item);
            source = "fresh";
          }
        }

        if (!entry) throw new Error("TTS generation returned no audio");

        const waitedMs = Math.round(performance.now() - waitStart);
        recordTiming(item.pos, {
          tts_request_ms: waitedMs,
          tts_server_ms: entry.tts_server_ms,
          queue_wait_ms: waitedMs,
          queue_source: source,
        });

        console.log(`[Audio] pos=${item.pos} waited=${waitedMs}ms server_tts=${entry.tts_server_ms}ms source=${source}`);

        audioFilenameRef.current = entry.filename ?? null;
        audioUrlReceivedAtRef.current = performance.now();
        setAudioUrl(entry.audio_url);
        setState(speakingState);
      } catch (err) {
        setError(
          "tts",
          `Could not reach Server 1 for question audio. ${err instanceof Error ? err.message : "Unknown error"}. Check MODEL_API_BASE_URL.`
        );
      }
    },
    [prefetchItemAudio, pollQueueUntilReady, recordTiming, setError]
  );

  const generateAndPlayIntro = useCallback(
    async (text: string) => {
      setIntroText(text);
      setState("generating_question_audio");
      setAudioUrl(null);

      try {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, speed: 1.0 }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Server 2 /api/tts failed: ${res.status} ${body}`);
        }

        const data = (await res.json()) as { audio_url: string };
        setAudioUrl(data.audio_url);
        setState("intro_speaking");
      } catch (err) {
        setError(
          "tts",
          `Could not reach Server 1 for the introduction audio. ${err instanceof Error ? err.message : "Unknown error"}. Check MODEL_API_BASE_URL.`
        );
      }
    },
    [setError]
  );

  /* ────────────────────────────────────────────────────────────────────
     Audio element: play question/intro/transition/closing TTS
  ──────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const isIntro = state === "intro_speaking";
    const isOpening = state === "opening_speaking";
    const isQuestion = state === "ai_speaking";
    const isTransition = state === "transition_speaking";
    const isClosing = state === "closing_speaking";
    const isFinalAnswer = state === "final_answer_speaking";
    const isAny =
      isIntro || isQuestion || isOpening || isTransition || isClosing || isFinalAnswer;
    if (!isAny || !audioUrl) return;
    const el = audioElRef.current;
    if (!el) return;

    el.src = audioUrl;

    const pos = currentItemRef.current.pos;

    const handleCanPlay = () => {
      if (!isQuestion || audioPlayStartRef.current !== 0) return;
      const loadMs = Math.round(performance.now() - audioUrlReceivedAtRef.current);
      recordTiming(pos, { audio_load_ms: loadMs });
    };
    const handlePlaying = () => {
      if (!isQuestion || audioPlayStartRef.current !== 0) return;
      audioPlayStartRef.current = performance.now();
    };
    const handleEnded = () => {
      if (isQuestion && audioPlayStartRef.current !== 0) {
        const playMs = Math.round(performance.now() - audioPlayStartRef.current);
        recordTiming(pos, { audio_play_duration_ms: playMs });
        console.log(`[Audio] pos=${pos} play_duration=${playMs}ms`);
      }
      audioPlayStartRef.current = 0;

      if (isIntro) {
        // Legacy: after the standalone spoken intro, play first sequence item.
        // The new opening message lives in the sequence itself; this branch
        // remains for safety in case generateAndPlayIntro is still invoked.
        void generateAndPlayItemAudio(itemsRef.current[0]);
      } else if (isFinalAnswer) {
        // After the AI speaks its RAG-grounded answer to the candidate's
        // final question, auto-advance to the closing message.
        void goToNextItem();
      } else if (isOpening || isTransition || isClosing) {
        // After any message: auto-advance (no recording needed)
        void goToNextItem();
      } else {
        // After question: start recording
        startRecording();
      }
    };
    const handleError = () => {
      audioPlayStartRef.current = 0;
      setError(
        "audio",
        isIntro
          ? "Failed to play the AI introduction."
          : isFinalAnswer
            ? "Failed to play the AI answer."
            : isTransition
              ? "Failed to play the transition message."
              : isClosing
                ? "Failed to play the closing message."
                : "Failed to play AI interviewer audio."
      );
    };

    audioPlayStartRef.current = 0;
    el.addEventListener("canplay", handleCanPlay);
    el.addEventListener("playing", handlePlaying);
    el.addEventListener("ended", handleEnded);
    el.addEventListener("error", handleError);

    el.play().catch((err) => {
      setError(
        "audio",
        `Autoplay was blocked: ${err instanceof Error ? err.message : "Unknown error"}. Please interact with the page and retry.`
      );
    });

    return () => {
      el.removeEventListener("canplay", handleCanPlay);
      el.removeEventListener("playing", handlePlaying);
      el.removeEventListener("ended", handleEnded);
      el.removeEventListener("error", handleError);
    };
  }, [
    state,
    audioUrl,
    startRecording,
    generateAndPlayItemAudio,
    recordTiming,
    setError,
  ]);

  /* ────────────────────────────────────────────────────────────────────
     Flow control
  ──────────────────────────────────────────────────────────────────── */

  // Advance to the next sequence item (questions and messages).
  // Called from the "Next Question" button AND automatically after message TTS ends.
  const goToNextItem = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;
    try {
      const currentIdx = seqIndexRef.current;
      const allItems = itemsRef.current;
      const isLast = currentIdx === allItems.length - 1;

      if (isLast) {
        // Finalize session
        const sid = sessionIdRef.current;
        if (sid) {
          try {
            const res = await fetch(`/api/sessions/${sid}/complete`, { method: "POST" });
            if (!res.ok) {
              const text = await res.text().catch(() => "");
              throw new Error(`POST /api/sessions/${sid}/complete ${res.status} ${text}`);
            }
          } catch (err) {
            setError("complete", `Could not finalize interview session. ${err instanceof Error ? err.message : "Unknown error"}`);
            return;
          }
        }
        sessionDoneRef.current = true;
        setState("complete");
        return;
      }

      const nextIdx = currentIdx + 1;
      setSeqIndex(nextIdx);
      clearRecordedPreview();
      lastTranscriptRef.current = null;
      audioFilenameRef.current = null;
      candidateAudioFilenameRef.current = null;
      setAudioUrl(null);
      await generateAndPlayItemAudio(allItems[nextIdx]);
    } finally {
      advancingRef.current = false;
    }
  }, [clearRecordedPreview, generateAndPlayItemAudio, setError]);

  // Legacy alias used in a few callback refs
  const goToNextQuestion = goToNextItem;

  const startInterview = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    sessionDoneRef.current = false;
    setState("starting");
    setErrorMessage(null);
    setErrorPhase(null);
    setSeqIndex(0);
    setResults({});
    clearRecordedPreview();
    audioFilenameRef.current = null;
    lastTranscriptRef.current = null;

    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId: companyInfo.companyId ?? undefined,
          sequence: rawSequenceRef.current ?? undefined,
          inviteToken: inviteToken ?? undefined,
          interviewRole: interviewRole ?? undefined,
          interviewLevel: interviewLevel ?? undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`POST /api/sessions ${res.status} ${text}`);
      }
      const session = (await res.json()) as { session_id: string };
      sessionIdRef.current = session.session_id;
      setSessionId(session.session_id);
    } catch (err) {
      startingRef.current = false;
      setError("session", `Could not start interview session. ${err instanceof Error ? err.message : "Unknown error"}`);
      return;
    }

    // Preload TTS for every spoken item before the active interview starts,
    // so the candidate never waits 4-5s between questions.
    const allItems = itemsRef.current;
    setPreloadProgress({ ready: 0, total: allItems.length });
    setState("preparing");

    const preloadStart = performance.now();
    await Promise.allSettled(
      allItems.map(async (item) => {
        const t0 = performance.now();
        const entry = await prefetchItemAudio(item);
        const ms = Math.round(performance.now() - t0);
        const cached = entry?.cached ?? false;
        console.log(
          `[Preload] item=${item.pos} section=${item.section} cached=${cached} duration=${ms}ms`
        );
        setPreloadProgress((p) => ({ ...p, ready: p.ready + 1 }));
      })
    );
    const preloadMs = Math.round(performance.now() - preloadStart);
    console.log(`[Preload] all audio ready total=${preloadMs}ms`);

    // The sequence's opening message acts as the spoken introduction now —
    // play it directly instead of the legacy standalone intro.
    await generateAndPlayItemAudio(itemsRef.current[0]);
    startingRef.current = false;
  }, [
    clearRecordedPreview,
    generateAndPlayItemAudio,
    prefetchItemAudio,
    companyInfo,
    setError,
  ]);

  const endInterview = useCallback(async () => {
    if (advancingRef.current) return;
    advancingRef.current = true;

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop(); } catch { /* ignore */ }
    }

    try {
      const sid = sessionIdRef.current;
      if (sid) {
        const res = await fetch(`/api/sessions/${sid}/complete`, { method: "POST" });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`POST /api/sessions/${sid}/complete ${res.status} ${text}`);
        }
      }
      sessionDoneRef.current = true;
      setState("complete");
    } catch (err) {
      setError("complete", `Could not finalize interview session. ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      advancingRef.current = false;
    }
  }, [setError]);

  const retryAfterError = useCallback(async () => {
    const phase = errorPhase;
    setErrorMessage(null);
    setErrorPhase(null);

    if (phase === "save" && lastTranscriptRef.current) {
      setState("saving");
      try {
        await saveAnswer(lastTranscriptRef.current);
      } catch (err) {
        setError("save", `Save failed again. ${err instanceof Error ? err.message : "Unknown error"}`);
        return;
      }
      finalizeAfterSave(lastTranscriptRef.current);
      return;
    }

    if (phase === "stt" && recordedBlobRef.current) {
      await transcribeRecording(recordedBlobRef.current, recordedMimeType ?? "audio/webm");
      return;
    }

    if (phase === "complete") {
      await goToNextQuestion();
      return;
    }

    await generateAndPlayItemAudio(currentItemRef.current);
  }, [
    errorPhase,
    saveAnswer,
    finalizeAfterSave,
    transcribeRecording,
    recordedMimeType,
    goToNextQuestion,
    generateAndPlayItemAudio,
    setError,
  ]);

  /* ────────────────────────────────────────────────────────────────────
     Render: lobby (idle)
  ──────────────────────────────────────────────────────────────────── */
  if (state === "idle") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-xl space-y-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-xl">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
              {effectiveRole} Interview
            </p>
            <h1 className="text-2xl font-semibold">Ready to join?</h1>
            <p className="text-sm text-neutral-300">
              You will be asked {totalQuestions} questions by an AI interviewer. The interviewer
              will speak each question aloud. After it finishes, your recording starts
              automatically. Click{" "}
              <span className="font-medium text-neutral-100">Stop Recording</span> when you are
              done answering, then move on to the next question.
            </p>
          </div>

          {/* HTTPS warning — shown immediately on insecure origins
              (e.g. opening over LAN IP). getUserMedia is unavailable here,
              so we surface a clear fallback message before the button click. */}
          {!secureContext ? (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
              <p className="font-semibold">Microphone blocked — secure context required</p>
              <p className="mt-2">
                Camera and microphone require HTTPS or localhost. Please use
                the HTTPS ngrok/cloudflared URL or run locally on localhost.
              </p>
              <p className="mt-2 text-amber-300/80">
                You are currently on{" "}
                <code className="rounded bg-amber-500/20 px-1 font-mono text-xs">
                  {typeof window !== "undefined"
                    ? `${window.location.protocol}//${window.location.host}`
                    : "http://"}
                </code>
                .
              </p>
            </div>
          ) : null}

          {errorMessage ? (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
              {errorMessage}
            </p>
          ) : null}

          {!permissionRequested ? (
            <div className="space-y-3">
              <p className="text-sm text-neutral-200">
                First, grant access to your microphone (and optionally camera).
              </p>
              <button
                type="button"
                onClick={() => requestPermissions(true)}
                className="rounded-full bg-indigo-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-400"
              >
                Enable Camera + Mic
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <PreCallPreview videoEnabled={videoEnabled} videoStream={mediaStream} />
              <p className="text-sm text-emerald-300">
                {videoEnabled ? "Camera and microphone ready." : "Microphone ready."}
              </p>
              <button
                type="button"
                onClick={startInterview}
                disabled={startingRef.current}
                className="w-full rounded-full bg-emerald-500 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
              >
                {startingRef.current ? "Joining..." : "Join interview"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────────────────
     Render: preparation screen
     Shown immediately on "Join interview" while we preload every TTS
     clip. Once preloadProgress.ready hits total, the active interview
     takes over (state flips out of "preparing").
  ──────────────────────────────────────────────────────────────────── */
  if (state === "preparing" || state === "starting") {
    const role = effectiveRole;
    const total = Math.max(preloadProgress.total, 1);
    const ready = Math.min(preloadProgress.ready, total);
    const pct = Math.round((ready / total) * 100);
    const progressText =
      preloadProgress.total === 0
        ? "Loading questions..."
        : ready >= total
          ? "Almost ready..."
          : `Preparing AI audio ${ready}/${total}...`;

    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-6 text-neutral-100">
        <div className="w-full max-w-xl space-y-6 rounded-2xl border border-neutral-800 bg-neutral-900/60 p-8 shadow-xl">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-indigo-300">
              {role} Interview
            </p>
            <h1 className="text-2xl font-semibold">
              Preparing your {role} interview…
            </h1>
            <p className="text-sm text-neutral-300">
              We're setting up your questions and AI interviewer audio.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-200">{progressText}</p>
              <p className="font-mono text-xs tabular-nums text-neutral-400">
                {pct}%
              </p>
            </div>
            <div
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="h-2 w-full overflow-hidden rounded-full bg-neutral-800"
            >
              <div
                className="h-full bg-indigo-500 transition-[width] duration-200 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-neutral-500">
              This may take a few seconds the first time. Future runs may be
              faster because audio is cached.
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────────────────
     Render: complete
  ──────────────────────────────────────────────────────────────────── */
  if (state === "complete") {
    // Pass a lightweight type-map so CompletionSummary can build the
    // evaluate-interview request without needing a full sequence re-fetch.
    const seqMeta = items.map((i) => ({
      pos: i.pos,
      type: i.kind === "message" ? i.section : i.section,
      section: i.section,
    }));
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100">
        <CompletionSummary
          sessionId={sessionId}
          companyId={companyInfo.companyId ?? undefined}
          seqMeta={seqMeta}
        />
        <DebugTimingPanel timings={timings} currentQuestionId={currentItem.pos} />
      </div>
    );
  }

  /* ────────────────────────────────────────────────────────────────────
     Render: interview in progress
  ──────────────────────────────────────────────────────────────────── */
  const retryLabel =
    errorPhase === "save"
      ? "Retry save"
      : errorPhase === "stt"
        ? "Retry transcription"
        : errorPhase === "complete"
          ? "Retry finish"
          : "Retry question";

  const isIntroSpeaking = state === "intro_speaking";
  const isQuestionSpeaking = state === "ai_speaking";
  const isOpeningSpeaking = state === "opening_speaking";
  const isTransitionSpeaking = state === "transition_speaking";
  const isClosingSpeaking = state === "closing_speaking";
  const isFinalAnswerSpeaking = state === "final_answer_speaking";
  const isAnySpeaking =
    isIntroSpeaking ||
    isQuestionSpeaking ||
    isOpeningSpeaking ||
    isTransitionSpeaking ||
    isClosingSpeaking ||
    isFinalAnswerSpeaking;
  const isRecording = state === "recording";
  const isPreparing = state === "generating_question_audio";
  const hasAnswers = Object.values(results).some((r) => r?.transcript && r.transcript.length > 0);

  const showDialog =
    isAnySpeaking ||
    isRecording ||
    state === "recorded" ||
    state === "uploading" ||
    state === "transcribing" ||
    state === "saving" ||
    state === "saved" ||
    state === "final_question_response" ||
    state === "error";

  const dialogText = isIntroSpeaking
    ? (introText ?? "")
    : currentItem.text;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-neutral-950 text-neutral-100">
      {/* Top bar */}
      <header className="flex flex-shrink-0 items-center justify-between gap-2 border-b border-neutral-800 px-4 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <p className="truncate text-sm font-semibold">
            {effectiveRole} Interview
          </p>
          <p className="text-xs text-neutral-500">
            {sectionLabel(currentItem.section)}
          </p>
          {!isMessage ? (
            <p className="text-xs text-neutral-500">
              · Q{questionNumber}/{totalQuestions}
            </p>
          ) : currentItem.section === "transition" ? (
            <p className="text-xs text-amber-400/80">
              · Moving to Technical
            </p>
          ) : null}
        </div>
        {hasAnswers ? (
          <button
            type="button"
            onClick={endInterview}
            className="flex-shrink-0 rounded-full border border-neutral-700 px-3 py-1 text-xs font-medium text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100"
          >
            End
          </button>
        ) : null}
      </header>

      {/* Main stage */}
      <main className="min-h-0 flex-1 px-3 pb-3 pt-2 lg:px-4 lg:pb-4 lg:pt-3">
        <div className="mx-auto flex h-full max-w-6xl flex-col gap-2 lg:gap-3">
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-2 lg:gap-3 lg:grid-cols-[1fr_260px] lg:grid-rows-[minmax(0,1fr)]">

            {/* CandidateTile — desktop only (hidden on mobile) */}
            <div className="hidden lg:contents">
              <CandidateTile
                videoEnabled={videoEnabled}
                videoStream={mediaStream}
                isRecording={isRecording}
                isMicLive={isRecording}
              />
            </div>

            {/* AI + controls column */}
            <div className="flex min-h-0 flex-col gap-2 overflow-hidden lg:gap-3">
              {/* AITile: compact (no box) on mobile, full card on desktop */}
              <div className="flex-shrink-0 lg:min-h-0 lg:flex-1">
                <AITile
                  isSpeaking={isAnySpeaking}
                  isPreparing={isPreparing}
                  preparingLabel={hasAnswers ? "Preparing next question..." : "Preparing..."}
                />
              </div>
              <div className="flex-shrink-0">
                <QuestionInfo
                  questionNumber={questionNumber}
                  totalQuestions={totalQuestions}
                  section={currentItem.section}
                  isFinalCandidateQuestion={isCandidateQuestion}
                  isMessage={isMessage}
                />
              </div>
              <div className="flex-shrink-0">
                <InterviewStatusCard
                  state={state}
                  errorMessage={errorMessage}
                  isLastQuestion={isLastQuestion}
                  transcriptOpen={transcriptOpen}
                  retryLabel={retryLabel}
                  onStopRecording={stopRecording}
                  onNextQuestion={goToNextItem}
                  onRetry={retryAfterError}
                  onToggleTranscript={() => setTranscriptOpen((v) => !v)}
                />
              </div>
            </div>
          </div>

          {showDialog ? (
            <div className="flex-shrink-0">
              <DialogBox
                question={dialogText}
                animate={isAnySpeaking}
                placeholderResponse={
                  !isIntroSpeaking && isCandidateQuestion
                    ? currentResult?.answerText ?? currentResult?.placeholderResponse ?? null
                    : null
                }
              />
            </div>
          ) : null}
        </div>
      </main>

      <audio ref={audioElRef} className="hidden" />

      <TranscriptPanel
        open={transcriptOpen}
        onClose={() => setTranscriptOpen(false)}
        questions={answerableItems.map((i) => ({ id: i.pos, text: i.text, kind: i.kind === "candidate_question" ? "candidate_question" : "interview" }))}
        results={results}
        activeQuestionId={currentItem.pos}
      />

      <DebugTimingPanel timings={timings} currentQuestionId={currentItem.pos} />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   Pre-call camera preview
──────────────────────────────────────────────────────────────────── */
function PreCallPreview({
  videoEnabled,
  videoStream,
}: {
  videoEnabled: boolean;
  videoStream: MediaStream | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = videoEnabled && videoStream ? videoStream : null;
  }, [videoEnabled, videoStream]);

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-neutral-950 ring-1 ring-neutral-800">
      {videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-sm text-neutral-400">
          Camera preview unavailable
        </div>
      )}
    </div>
  );
}
