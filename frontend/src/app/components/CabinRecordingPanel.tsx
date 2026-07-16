import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { CabinRecordingInfo, ordersApi } from "../services/orders";
import { resolveHttpOrigin } from "../services/api";
import { SegmentedVideoPlayer } from "./SegmentedVideoPlayer";

type Props = {
  orderId: string;
  orderStatus: string;
  initial?: CabinRecordingInfo | null;
  videoRecording?: boolean;
};

function isImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /\.(jpe?g|png|webp)(\?|$)/i.test(url);
}

export function CabinRecordingPanel({ orderId, orderStatus, initial, videoRecording }: Props) {
  const [info, setInfo] = useState<CabinRecordingInfo | null>(initial ?? null);
  const isActiveRide = orderStatus === "ride_ongoing";
  const segments = info?.segments ?? [];
  const shouldShow =
    isActiveRide ||
    videoRecording ||
    info?.is_live ||
    info?.live_frame_url ||
    info?.video_url ||
    info?.playable_url ||
    segments.length > 0;

  useEffect(() => {
    setInfo(initial ?? null);
  }, [initial, orderId]);

  useEffect(() => {
    if (!shouldShow) return;

    let cancelled = false;
    const load = async () => {
      try {
        const data = await ordersApi.getCabinRecording(orderId);
        if (!cancelled) setInfo(data);
      } catch {
        /* ignore polling errors */
      }
    };

    load();
    if (!isActiveRide && info?.merge_status === "ready") {
      return () => { cancelled = true; };
    }

    const pollMs = isActiveRide ? 4000 : 8000;
    const id = window.setInterval(load, pollMs);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [orderId, isActiveRide, shouldShow, info?.merge_status, info?.segment_count]);

  if (!shouldShow) return null;

  const mergedReady = info?.merge_status === "ready" && info?.video_url;
  const hasSegments = segments.length > 0;
  const legacyFrameUrl = info?.live_frame_url || info?.poster_url;
  const legacyVideo =
    info?.video_url && !mergedReady && !hasSegments
      ? info.video_url
      : info?.playable_url && !isImageUrl(info.playable_url) && !hasSegments
        ? info.playable_url
        : null;

  const hasRecordingMeta = Boolean(
    videoRecording ||
      info?.recording_started_at ||
      (info?.duration_seconds != null && info.duration_seconds > 0),
  );

  const rideEnded = !isActiveRide && orderStatus !== "ride_ongoing";
  const emptyMessage = (() => {
    if (isActiveRide) {
      if (info?.recording_started_at && !info?.upload_started) {
        return "Ожидание данных с устройства водителя…";
      }
      return "Ожидание первого фрагмента видео…";
    }
    if (rideEnded && info?.upload_started && !hasSegments) {
      return "Загрузка прервана — сегменты не получены";
    }
    if (hasRecordingMeta) {
      return "Видео не загружено с устройства водителя.";
    }
    return "Запись пока недоступна";
  })();

  return (
    <div>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-2">
        <Video className="w-4 h-4" />
        Запись салона
        {info?.is_recording && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 text-xs font-medium">
            <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            LIVE
          </span>
        )}
        {info?.merge_status === "processing" && (
          <span className="text-xs text-gray-400">Склейка видео…</span>
        )}
        {info?.merge_status === "failed" && hasSegments && (
          <span className="text-xs text-amber-600 dark:text-amber-400">
            Сегменты есть, склейка не удалась
          </span>
        )}
      </p>
      <div className="rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 bg-gray-900 aspect-video flex items-center justify-center">
        {mergedReady || hasSegments ? (
          <SegmentedVideoPlayer
            segments={segments}
            mergedUrl={mergedReady ? info?.video_url : null}
            mergeStatus={info?.merge_status}
            isLive={isActiveRide}
            posterUrl={legacyFrameUrl}
          />
        ) : legacyVideo ? (
          <video
            src={legacyVideo.startsWith("http") ? legacyVideo : `${resolveHttpOrigin()}${legacyVideo}`}
            controls
            playsInline
            className="w-full h-full object-contain bg-black"
          />
        ) : legacyFrameUrl && isImageUrl(legacyFrameUrl) ? (
          <img
            src={legacyFrameUrl.startsWith("http") ? legacyFrameUrl : `${resolveHttpOrigin()}${legacyFrameUrl}`}
            alt="Последний кадр салона"
            className="w-full h-full object-cover"
          />
        ) : (
          <p className="text-sm text-gray-400 px-4 text-center">
            {emptyMessage}
          </p>
        )}
      </div>
      {info?.segment_count != null && info.segment_count > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Фрагментов: {info.segment_count}
        </p>
      )}
      {info?.duration_seconds != null && info.duration_seconds > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          Длительность записи: {Math.floor(info.duration_seconds / 60)}:
          {(info.duration_seconds % 60).toString().padStart(2, "0")}
        </p>
      )}
    </div>
  );
}
