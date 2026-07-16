import { useCallback, useEffect, useState } from "react";
import { Bell, Check, Clock, Loader2, RefreshCw } from "lucide-react";
import {
  dispatchApi,
  PickupTimeAdjustmentItem,
} from "../services/dispatch";
import { formatTime } from "./DayRoutesPanel";

interface PickupTimeAdjustmentsPanelProps {
  planDate: string;
  refreshKey?: number;
}

export function PickupTimeAdjustmentsPanel({
  planDate,
  refreshKey = 0,
}: PickupTimeAdjustmentsPanelProps) {
  const [items, setItems] = useState<PickupTimeAdjustmentItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [onlyUnnotified, setOnlyUnnotified] = useState(true);
  const [markingId, setMarkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await dispatchApi.getPickupTimeAdjustments(planDate, {
        notified: onlyUnnotified ? false : undefined,
      });
      setItems(data.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [planDate, onlyUnnotified]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const handleMarkNotified = async (id: number) => {
    setMarkingId(id);
    try {
      await dispatchApi.markPickupTimeNotified(id);
      setItems((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, passenger_notified: true } : item
        )
      );
      if (onlyUnnotified) {
        setItems((prev) => prev.filter((item) => item.id !== id));
      }
    } finally {
      setMarkingId(null);
    }
  };

  const formatOffset = (minutes: number) => {
    if (minutes === 0) return "0 мин";
    return minutes > 0 ? `+${minutes} мин` : `${minutes} мин`;
  };

  return (
    <div className="mt-4 border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-900/20">
        <h3 className="text-sm font-medium text-amber-900 dark:text-amber-100 flex items-center gap-1.5">
          <Bell className="w-4 h-4" />
          Изменённые времена подачи
          {items.length > 0 && (
            <span className="text-xs font-normal text-amber-700 dark:text-amber-300">
              ({items.length})
            </span>
          )}
        </h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] text-amber-800 dark:text-amber-200 cursor-pointer">
            <input
              type="checkbox"
              checked={onlyUnnotified}
              onChange={(e) => setOnlyUnnotified(e.target.checked)}
              className="rounded"
            />
            Только не уведомлённые
          </label>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="p-1 rounded hover:bg-amber-100 dark:hover:bg-amber-900/40"
            title="Обновить"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {loading && items.length === 0 ? (
        <div className="flex justify-center py-4">
          <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-400 px-3 py-3">
          Нет заказов со сдвинутым временем подачи
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-amber-100/50 dark:bg-amber-900/30 text-left">
              <tr>
                <th className="p-2 font-medium">Заказ</th>
                <th className="p-2 font-medium">Маршрут</th>
                <th className="p-2 font-medium">Было</th>
                <th className="p-2 font-medium">Стало</th>
                <th className="p-2 font-medium">Сдвиг</th>
                <th className="p-2 font-medium">Водитель</th>
                <th className="p-2 font-medium">Уведомление</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-t border-amber-100 dark:border-amber-900/50"
                >
                  <td className="p-2 align-top">
                    <div className="font-mono text-[10px] text-gray-500">{item.order_id}</div>
                    <div className="font-medium dark:text-white">
                      {item.passenger_name || "—"}
                    </div>
                  </td>
                  <td className="p-2 align-top max-w-[140px]">
                    <div className="truncate text-gray-700 dark:text-gray-300">
                      {item.pickup_title}
                    </div>
                    <div className="truncate text-gray-500">→ {item.dropoff_title}</div>
                  </td>
                  <td className="p-2 align-top whitespace-nowrap">
                    <Clock className="w-3 h-3 inline mr-0.5 text-gray-400" />
                    {formatTime(item.original_pickup_time)}
                  </td>
                  <td className="p-2 align-top whitespace-nowrap font-semibold text-amber-700 dark:text-amber-300">
                    {formatTime(item.adjusted_pickup_time)}
                  </td>
                  <td className="p-2 align-top whitespace-nowrap">
                    {formatOffset(item.offset_minutes)}
                  </td>
                  <td className="p-2 align-top">{item.driver_name || "—"}</td>
                  <td className="p-2 align-top">
                    {item.passenger_notified ? (
                      <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                        <Check className="w-3.5 h-3.5" />
                        Уведомлён
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleMarkNotified(item.id)}
                        disabled={markingId === item.id}
                        className="px-2 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50 text-[10px]"
                      >
                        {markingId === item.id ? "…" : "Отметить уведомлён"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
