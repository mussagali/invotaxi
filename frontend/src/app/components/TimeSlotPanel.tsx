import { Loader2, Play, SkipForward } from "lucide-react";
import type { DayTimeSlot, ManualRequiredItem } from "../services/dispatch";

interface TimeSlotPanelProps {
  slots: DayTimeSlot[];
  loading?: boolean;
  distributing?: boolean;
  selectedSlotStart?: string | null;
  onSelectSlot?: (slotStart: string) => void;
  onDistributeFirst: () => void;
  onDistributeNext: () => void;
  manualRequired?: ManualRequiredItem[];
  lastSlotSummary?: string | null;
}

function slotStatusIcon(status: DayTimeSlot["status"]): string {
  if (status === "done") return "✓";
  if (status === "partial") return "◐";
  if (status === "pending") return "○";
  return "·";
}

function slotClassName(status: DayTimeSlot["status"], selected: boolean, distributing: boolean): string {
  const base =
    "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs border transition-colors cursor-pointer";
  if (selected) {
    return `${base} border-indigo-400 bg-indigo-50 text-indigo-900 dark:bg-indigo-900/40 dark:text-indigo-200 dark:border-indigo-600`;
  }
  if (status === "done") {
    return `${base} border-green-200 bg-green-50/80 text-green-800 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800`;
  }
  if (status === "partial") {
    return `${base} border-amber-200 bg-amber-50/80 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800`;
  }
  if (status === "pending") {
    return `${base} border-gray-200 bg-gray-50 text-gray-700 dark:bg-gray-700/50 dark:text-gray-300 dark:border-gray-600`;
  }
  return `${base} border-transparent text-gray-400 dark:text-gray-500 cursor-default`;
}

export function TimeSlotPanel({
  slots,
  loading = false,
  distributing = false,
  selectedSlotStart = null,
  onSelectSlot,
  onDistributeFirst,
  onDistributeNext,
  manualRequired = [],
  lastSlotSummary = null,
}: TimeSlotPanelProps) {
  const hasPending = slots.some((s) => s.status === "pending" || s.status === "partial");
  const allDone = slots.length > 0 && slots.every((s) => s.status === "done" || s.status === "empty");

  return (
    <div className="mb-4 rounded-lg border border-gray-200 dark:border-gray-600 bg-gray-50/50 dark:bg-gray-900/30 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-sm font-medium text-gray-900 dark:text-white">
          Тайм-слоты (1 час от первого заказа)
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={onDistributeFirst}
            disabled={distributing || loading || slots.length === 0}
            className="px-3 py-1.5 text-xs rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {distributing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Первый слот
          </button>
          <button
            type="button"
            onClick={onDistributeNext}
            disabled={distributing || loading || !hasPending || allDone}
            className="px-3 py-1.5 text-xs rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-1.5"
          >
            {distributing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <SkipForward className="w-3.5 h-3.5" />}
            Следующий слот
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Загрузка слотов…
        </div>
      ) : slots.length === 0 ? (
        <div className="text-xs text-gray-500 dark:text-gray-400">Нет заказов на выбранную дату</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {slots.map((slot) => {
            const selected = selectedSlotStart === slot.slot_start;
            const clickable = slot.status !== "empty" && Boolean(onSelectSlot);
            return (
              <button
                key={slot.slot_start}
                type="button"
                disabled={!clickable || distributing}
                onClick={() => onSelectSlot?.(slot.slot_start)}
                className={slotClassName(slot.status, selected, distributing)}
                title={
                  slot.orders_total > 0
                    ? `${slot.orders_assigned}/${slot.orders_total} распределено`
                    : "Нет заказов"
                }
              >
                <span>{slot.label}</span>
                <span>{slotStatusIcon(slot.status)}</span>
                {slot.orders_total > 0 && (
                  <span className="opacity-75">
                    {slot.orders_assigned}/{slot.orders_total}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {lastSlotSummary && (
        <div className="text-xs text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1.5 rounded">
          {lastSlotSummary}
        </div>
      )}

      {manualRequired.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs font-medium text-amber-800 dark:text-amber-300">
            Требуют ручного назначения ({manualRequired.length})
          </div>
          <ul className="text-xs text-amber-900/90 dark:text-amber-200/90 space-y-0.5 max-h-24 overflow-y-auto">
            {manualRequired.map((item) => (
              <li key={item.order_id}>
                <span className="font-mono">{item.order_id}</span>
                <span className="opacity-75"> — {item.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
