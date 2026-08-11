"use client";

import { useEffect, useRef } from "react";

type Props = {
  videoEnabled: boolean;
  videoStream: MediaStream | null;
  isRecording: boolean;
  isMicLive: boolean;
};

export default function CandidateTile({
  videoEnabled,
  videoStream,
  isRecording,
  isMicLive,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = videoEnabled && videoStream ? videoStream : null;
  }, [videoEnabled, videoStream]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl bg-neutral-900 ring-1 ring-neutral-800">
      {videoEnabled ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full -scale-x-100 object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-neutral-800 text-xl font-semibold text-neutral-300">
            You
          </div>
          <p className="text-sm text-neutral-400">
            Camera preview unavailable
          </p>
        </div>
      )}

      {isRecording ? (
        <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full bg-red-600/95 px-3 py-1 text-xs font-semibold tracking-wide text-white shadow-lg">
          <span className="h-2 w-2 animate-pulse rounded-full bg-white" />
          REC
        </div>
      ) : null}

      <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-md bg-black/55 px-2.5 py-1 text-xs text-white backdrop-blur">
        <span>You</span>
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            isMicLive ? "bg-emerald-400" : "bg-neutral-500"
          }`}
          aria-label={isMicLive ? "Microphone live" : "Microphone muted"}
        />
      </div>
    </div>
  );
}
