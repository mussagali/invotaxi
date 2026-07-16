import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { Modal } from "./Modal";
import {
  COMPLAINTS_PAGE_SIZE,
  getComplaints,
  type ComplaintRow,
} from "../services/complaints";

interface ComplaintsProps {
  onOpenOrder: (orderId: string) => void;
}

function formatWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function sourceLabel(s: ComplaintRow["source"]): string {
  return s === "passenger" ? "Пассажир" : "Водитель";
}

export function Complaints({ onOpenOrder }: ComplaintsProps) {
  const [page, setPage] = useState(1);
  const [sourceFilter, setSourceFilter] = useState<"all" | "passenger" | "driver">("all");
  const [rows, setRows] = useState<ComplaintRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<ComplaintRow | null>(null);

  useEffect(() => {
    setPage(1);
  }, [sourceFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getComplaints({
        page,
        page_size: COMPLAINTS_PAGE_SIZE,
        source: sourceFilter,
      });
      setRows(res.results);
      setTotalCount(res.count);
    } catch (e: unknown) {
      const realMsg =
        e && typeof e === "object" && "message" in e && typeof (e as { message: unknown }).message === "string"
          ? (e as { message: string }).message
          : "Не удалось загрузить жалобы";
      setError(realMsg);
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, sourceFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(totalCount / COMPLAINTS_PAGE_SIZE));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <AlertTriangle className="w-8 h-8 text-orange-500" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Жалобы</h1>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Жалобы пассажиров и водителей по заказам
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-gray-600 dark:text-gray-400 whitespace-nowrap">Источник:</label>
          <select
            value={sourceFilter}
            onChange={(e) =>
              setSourceFilter(e.target.value as "all" | "passenger" | "driver")
            }
            className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-white"
          >
            <option value="all">Все</option>
            <option value="passenger">Пассажир</option>
            <option value="driver">Водитель</option>
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-500">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-gray-500">Нет записей</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 dark:bg-gray-900/50 text-gray-600 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Дата</th>
                  <th className="px-4 py-3 font-medium">Источник</th>
                  <th className="px-4 py-3 font-medium">Заказ</th>
                  <th className="px-4 py-3 font-medium">Категория</th>
                  <th className="px-4 py-3 font-medium">Статус</th>
                  <th className="px-4 py-3 font-medium">Автор</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {rows.map((row) => (
                  <tr
                    key={`${row.source}-${row.id}`}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                    onClick={() => setDetail(row)}
                  >
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                      {formatWhen(row.created_at)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.source === "passenger"
                            ? "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200"
                            : "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
                        }`}
                      >
                        {sourceLabel(row.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-900 dark:text-gray-100 font-mono text-xs">
                      {row.order_id.slice(0, 8)}…
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[140px] truncate">
                      {row.category}
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{row.status}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 max-w-[180px] truncate">
                      {row.reporter.name || row.reporter.phone || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && totalCount > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/80 dark:bg-gray-900/30">
            <span className="text-sm text-gray-600 dark:text-gray-400">
              Всего: {totalCount} · Стр. {page} / {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-50 dark:text-white"
              >
                <ChevronLeft className="w-4 h-4" />
                Назад
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 text-sm disabled:opacity-50 dark:text-white"
              >
                Вперёд
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      <Modal
        isOpen={detail != null}
        onClose={() => setDetail(null)}
        title={detail ? `Жалоба · ${sourceLabel(detail.source)}` : ""}
        size="lg"
        footer={
          detail ? (
            <button
              type="button"
              onClick={() => {
                onOpenOrder(detail.order_id);
                setDetail(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
            >
              <ExternalLink className="w-4 h-4" />
              Открыть заказ
            </button>
          ) : null
        }
      >
        {detail && (
          <div className="space-y-4 text-sm text-gray-800 dark:text-gray-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <span className="text-gray-500 dark:text-gray-400">Заказ</span>
                <p className="font-mono text-xs break-all">{detail.order_id}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Создана</span>
                <p>{formatWhen(detail.created_at)}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Категория</span>
                <p>{detail.category}</p>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400">Статус</span>
                <p>{detail.status}</p>
              </div>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Маршрут</span>
              <p>
                {(detail.pickup_title || "—") + " → " + (detail.dropoff_title || "—")}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Заявитель</span>
              <p>
                {(detail.reporter.name || "—") +
                  (detail.reporter.phone ? ` · ${detail.reporter.phone}` : "")}
              </p>
            </div>
            <div>
              <span className="text-gray-500 dark:text-gray-400">Описание</span>
              <p className="mt-1 whitespace-pre-wrap rounded-lg bg-gray-50 dark:bg-gray-900/50 p-3">
                {detail.description}
              </p>
            </div>
            {detail.attachment_url && (
              <div>
                <a
                  href={detail.attachment_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
                >
                  <ExternalLink className="w-4 h-4" />
                  Вложение
                </a>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
