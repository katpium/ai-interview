"use client";

import { useEffect, useState } from "react";

type Props = {
  question: string;
  animate: boolean;
  placeholderResponse?: string | null;
};

function useTypewriter(text: string, enabled: boolean, charsPerSecond = 50) {
  const [out, setOut] = useState(enabled ? "" : text);

  useEffect(() => {
    if (!enabled) {
      setOut(text);
      return;
    }
    setOut("");
    if (!text) return;
    const intervalMs = Math.max(8, Math.floor(1000 / charsPerSecond));
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setOut(text.slice(0, i));
      if (i >= text.length) {
        window.clearInterval(id);
      }
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [text, enabled, charsPerSecond]);

  return out;
}

export default function DialogBox({
  question,
  animate,
  placeholderResponse,
}: Props) {
  const typed = useTypewriter(question, animate);

  return (
    <div className="max-h-[28vh] space-y-2 overflow-y-auto">
      <div className="flex items-start gap-3 rounded-2xl bg-neutral-900 ring-1 ring-neutral-800 px-4 py-3">
        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-500/20 text-xs font-semibold text-indigo-200 ring-1 ring-indigo-400/40">
          AI
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            AI Interviewer
          </p>
          <p className="mt-1 whitespace-pre-wrap leading-relaxed text-neutral-100 text-base">
            {typed || " "}
          </p>
        </div>
      </div>

      {placeholderResponse ? (
        <div className="flex items-start gap-3 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-purple-500/30 text-xs font-semibold text-purple-100 ring-1 ring-purple-400/40">
            AI
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium uppercase tracking-wide text-purple-300">
              AI Response (placeholder)
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-purple-50">
              {placeholderResponse}
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
