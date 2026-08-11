"use client";

import { useEffect, useState } from "react";

type Props = {
  isSpeaking: boolean;
  isPreparing: boolean;
  preparingLabel?: string;
};

export default function AITile({
  isSpeaking,
  isPreparing,
  preparingLabel = "Preparing...",
}: Props) {
  // While speaking, alternate between mouth-open and still so the AI
  // looks like it's talking. When not speaking, freeze on the still image.
  const [mouthOpen, setMouthOpen] = useState(false);
  useEffect(() => {
    if (!isSpeaking) {
      setMouthOpen(false);
      return;
    }
    const id = window.setInterval(() => {
      setMouthOpen((v) => !v);
    }, 180);
    return () => window.clearInterval(id);
  }, [isSpeaking]);

  const src = mouthOpen ? "/ai/ai-mouth-open.png" : "/ai/ai-still.png";

  return (
    <>
      {/* ── Mobile: compact face + status label, no box ── */}
      <div className="flex items-center gap-3 px-1 py-2 lg:hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="AI interviewer"
          className="h-16 w-16 flex-shrink-0 select-none object-contain"
          style={{ imageRendering: "pixelated" }}
          draggable={false}
        />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-neutral-100">AI Interviewer</p>
          <p className="mt-0.5 text-xs">
            {isSpeaking ? (
              <span className="inline-flex items-center gap-1 text-indigo-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300" />
                Speaking
              </span>
            ) : isPreparing ? (
              <span className="text-amber-300">{preparingLabel}</span>
            ) : (
              <span className="text-neutral-500">Waiting…</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Desktop: full card with background image ── */}
      <div
        className={`relative hidden h-full w-full overflow-hidden rounded-2xl ring-1 transition-colors lg:block ${
          isSpeaking ? "ring-indigo-400/60" : "ring-neutral-800"
        }`}
        style={{
          backgroundImage: "url(/ai/ai-bg.avif)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      >
        {/* Cat fills the tile and sits flush with the bottom. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt="AI interviewer"
          className="absolute inset-0 h-full w-full select-none object-contain object-bottom"
          style={{ imageRendering: "pixelated" }}
          draggable={false}
        />

        {/* Speaking indicator label — top-left chip overlay. */}
        <div className="absolute left-2 top-2 flex items-center gap-2 rounded-md bg-black/55 px-2 py-1 text-xs text-white backdrop-blur">
          <span className="font-semibold">AI Interviewer</span>
          {isSpeaking ? (
            <span className="inline-flex items-center gap-1 text-indigo-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-300" />
              Speaking
            </span>
          ) : isPreparing ? (
            <span className="text-amber-300">{preparingLabel}</span>
          ) : null}
        </div>
      </div>
    </>
  );
}
