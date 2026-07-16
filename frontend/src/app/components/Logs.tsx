import { useCallback, useEffect, useState } from "react";
import {
  Search,
  FileText,
  User,
  Clock,
  Activity,
  Shield,
  Phone,
  ShoppingCart,
  Car,
  Users,
} from "lucide-react";
import { Modal } from "./Modal";
import {
  getAuditLogs,
  type AuditLogEntry,
  PAGE_SIZE,
} from "../services/audit";

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function Logs() {
  const [searchTerm, setSearchTerm] = useState("");
  const debouncedSearch = useDebounced(searchTerm, 400);
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [viewModal, setViewModal] = useState<number | null>(null);
  const [rows, setRows] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [categoryFilter, debouncedSearch]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getAuditLogs({
        page,
        page_size: PAGE_SIZE,
        category: categoryFilter === "all" ? undefined : categoryFilter,
        search: debouncedSearch.trim() || undefined,
      });
      setRows(res.results);
      setTotalCount(res.count);
    } catch (e: unknown) {
      const msg =
        e && typeof e === "object" && "message" in e
          ? String((e as { message?: string }).message)
          : "Не удалось загрузить журнал";
      setError(msg);
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [page, categoryFilter, debouncedSearch]);

  useEffect(() => {
    void load();
  }, [load]);

  const selectedLog =
    viewModal != null ? rows.find((l) => l.id === viewModal) : undefined;

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "order":
        return ShoppingCart;
      case "driver":
        return Car;
      case "passenger":
        return Users;
      case "user":
        return User;
      case "call":
        return Phone;
      case "system":
        return Shield;
      case "auth":
        return Shield;
      default:
        return Activity;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "order":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "driver":
        return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
      case "passenger":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "user":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      case "call":
        return "bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200";
      case "system":
        return "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200";
      case "auth":
        return "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "order":
        return "Заказ";
      case "driver":
        return "Водитель";
      case "passenger":
        return "Пассажир";
      case "user":
        return "Пользователь";
      case "call":
        return "Звонок";
      case "system":
        return "Система";
      case "auth":
        return "Аутентификация";
      default:
        return category;
    }
  };

  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("ru-RU");
    } catch {
      return iso;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl dark:text-white">Логи и аудит</h1>
          <p className="text-gray-600 dark:text-gray-400">
            История действий и системных событий
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
              <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              Записей по текущим фильтрам
            </p>
          </div>
          <p className="text-3xl dark:text-white">{loading ? "…" : totalCount}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
              <Clock className="w-5 h-5 text-gray-600 dark:text-gray-300" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">Страница</p>
          </div>
          <p className="text-3xl dark:text-white">
            {loading ? "…" : `${page} / ${totalPages}`}
          </p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Поиск по описанию..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
            >
              <option value="all">Все категории</option>
              <option value="order">Заказы</option>
              <option value="driver">Водители</option>
              <option value="passenger">Пассажиры</option>
              <option value="user">Пользователи</option>
              <option value="auth">Аутентификация</option>
              <option value="call">Звонки</option>
              <option value="system">Система</option>
            </select>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 px-4 py-3 text-red-800 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
              <tr>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  ID
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Время
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Кто
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Категория
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Описание
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  IP адрес
                </th>
                <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  Действия
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {loading ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                  >
                    Загрузка…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-6 py-8 text-center text-gray-500 dark:text-gray-400"
                  >
                    Нет записей
                  </td>
                </tr>
              ) : (
                rows.map((log) => {
                  const Icon = getCategoryIcon(log.category);
                  return (
                    <tr
                      key={log.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-700"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm dark:text-white">
                        {log.id}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                          <Clock className="w-4 h-4" />
                          {formatTime(log.created_at)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div>
                          <p className="dark:text-white">
                            {log.actor.display_name || log.actor.username}
                          </p>
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            {log.actor.role}
                          </p>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${getCategoryColor(
                            log.category
                          )}`}
                        >
                          <Icon className="w-3 h-3" />
                          {getCategoryLabel(log.category)}
                        </span>
                      </td>
                      <td className="px-6 py-4 dark:text-white max-w-md">
                        {log.description}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {log.ip_address || "—"}
                      </td>
                      <td className="px-6 py-4">
                        <button
                          type="button"
                          onClick={() => setViewModal(log.id)}
                          className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                          title="Подробнее"
                        >
                          <FileText className="w-5 h-5" />
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        isOpen={viewModal !== null}
        onClose={() => setViewModal(null)}
        title="Детали лога"
        size="lg"
      >
        {selectedLog && (
          <div className="space-y-6">
            <div className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
              {(() => {
                const Icon = getCategoryIcon(selectedLog.category);
                return <Icon className="w-12 h-12 text-gray-400" />;
              })()}
              <div className="flex-1">
                <h3 className="text-xl dark:text-white">
                  {selectedLog.description}
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {formatTime(selectedLog.created_at)}
                </p>
              </div>
              <span
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs ${getCategoryColor(
                  selectedLog.category
                )}`}
              >
                {getCategoryLabel(selectedLog.category)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  ID лога
                </p>
                <p className="dark:text-white">{selectedLog.id}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Действие
                </p>
                <p className="dark:text-white">{selectedLog.action}</p>
              </div>
            </div>

            <div>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                Кто выполнил
              </p>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <User className="w-10 h-10 text-gray-400" />
                <div>
                  <p className="dark:text-white">
                    {selectedLog.actor.display_name || selectedLog.actor.username}
                  </p>
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {selectedLog.actor.role} • ID: {selectedLog.actor.id}
                  </p>
                </div>
              </div>
            </div>

            {selectedLog.subject_user && (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                  Объект (пользователь)
                </p>
                <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
                  <User className="w-10 h-10 text-gray-400" />
                  <div>
                    <p className="dark:text-white">
                      {selectedLog.subject_user.display_name ||
                        selectedLog.subject_user.username}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      {selectedLog.subject_user.role} • ID:{" "}
                      {selectedLog.subject_user.id}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {selectedLog.ip_address && (
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  IP адрес
                </p>
                <p className="dark:text-white">{selectedLog.ip_address}</p>
              </div>
            )}

            {selectedLog.metadata &&
              Object.keys(selectedLog.metadata).length > 0 && (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
                    Дополнительные детали
                  </p>
                  <pre className="p-4 bg-gray-50 dark:bg-gray-700 rounded-lg text-sm overflow-x-auto dark:text-white">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}

            <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                type="button"
                onClick={() => setViewModal(null)}
                className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 py-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600"
              >
                Закрыть
              </button>
            </div>
          </div>
        )}
      </Modal>

      <div className="flex items-center justify-between bg-white dark:bg-gray-800 rounded-lg p-4 shadow-sm border border-gray-200 dark:border-gray-700">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Показано {rows.length} из {totalCount} записей
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white disabled:opacity-50"
          >
            Назад
          </button>
          <button
            type="button"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
            className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-white disabled:opacity-50"
          >
            Далее
          </button>
        </div>
      </div>
    </div>
  );
}
