import { useCallback, useEffect, useRef, useState } from "react";
import type { CabinRecordingSegmentInfo } from "../services/orders";
import { resolveHttpOrigin } from "../services/api";

type Props = {
  segments: CabinRecordingSegmentInfo[];
  mergedUrl?: string | null;
  mergeStatus?: string | null;
  isLive?: boolean;
  posterUrl?: string | null;
};

function withApiOrigin(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${resolveHttpOrigin()}${url.startsWith("/") ? url : `/${url}`}`;
}

export function SegmentedVideoPlayer({
  segments,
  mergedUrl,
  mergeStatus,
  isLive = false,
  posterUrl,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playIndex, setPlayIndex] = useState(0);
  const sorted = [...segments].sort((a, b) => a.index - b.index);

  const useMerged = Boolean(mergedUrl && mergeStatus === "ready");

  const advance = useCallback(() => {
    setPlayIndex((prev) => {
      const next = prev + 1;
      if (next < sorted.length) return next;
      return isLive ? prev : prev;
    });
  }, [sorted.length, isLive]);

  useEffect(() => {
    if (!isLive || useMerged) return;
    setPlayIndex((prev) => Math.min(prev, Math.max(0, sorted.length - 1)));
  }, [sorted.length, isLive, useMerged]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || useMerged) return;
    const seg = sorted[playIndex];
    if (!seg?.url) return;
    el.src = withApiOrigin(seg.url);
    el.load();
    void el.play().catch(() => undefined);
  }, [playIndex, sorted, useMerged]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !useMerged || !mergedUrl) return;
    el.src = withApiOrigin(mergedUrl);
    el.load();
  }, [useMerged, mergedUrl]);

  if (useMerged && mergedUrl) {
    return (
      <video
        ref={videoRef}
        src={withApiOrigin(mergedUrl)}
        controls
        playsInline
        poster={posterUrl ? withApiOrigin(posterUrl) : undefined}
        className="w-full h-full object-contain bg-black"
      />
    );
  }

  if (sorted.length === 0) {
    return null;
  }

  const current = sorted[Math.min(playIndex, sorted.length - 1)];

  return (
    <div className="relative w-full h-full">
      <video
        ref={videoRef}
        key={current?.url ?? playIndex}
        controls
        playsInline
        poster={posterUrl ? withApiOrigin(posterUrl) : undefined}
        onEnded={advance}
        className="w-full h-full object-contain bg-black"
      />
      {sorted.length > 1 && (
        <p className="absolute bottom-2 right-2 text-xs bg-black/60 text-white px-2 py-0.5 rounded">
          Фрагмент {Math.min(playIndex, sorted.length - 1) + 1} / {sorted.length}
          {isLive ? "+" : ""}
        </p>
      )}
    </div>
  );
}
