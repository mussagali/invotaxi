import { Bell, Shield, Users, Settings as SettingsIcon, Save, Plus, Search, Edit, Trash2, Lock, Unlock, MoreVertical, Loader2, Database, AlertTriangle } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Modal } from "./Modal";
import { usersApi, AdminUser, PaginatedResponse } from "../services/users";
import { ordersApi } from "../services/orders";
import { driversApi } from "../services/drivers";
import { passengersApi } from "../services/passengers";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

export function Settings() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [totalCount, setTotalCount] = useState(0);
  const [isUserModalOpen, setIsUserModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [clearModal, setClearModal] = useState<"orders" | "drivers" | "passengers" | "all" | null>(null);
  const [clearing, setClearing] = useState(false);
  const [formData, setFormData] = useState({
    first_name: "",
    last_name: "",
    email: "",
    phone: "",
    role: "Operator" as "Admin" | "Dispatcher" | "Operator",
    password: "",
  });

  // Load users from API
  const loadUsers = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params: any = {
        page,
        page_size: pageSize,
      };
      
      if (roleFilter !== "all") {
        params.role = roleFilter;
      }
      
      if (statusFilter !== "all") {
        params.status = statusFilter === "Активен" ? "active" : "blocked";
      }
      
      if (searchQuery) {
        params.search = searchQuery;
      }
      
      const response: PaginatedResponse<AdminUser> = await usersApi.getUsers(params);
      setUsers(response.results);
      setTotalCount(response.count);
    } catch (err: any) {
      setError(err.message || "Ошибка при загрузке пользователей");
      console.error("Error loading users:", err);
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, roleFilter, statusFilter, searchQuery]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  // Format date helper
  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Никогда";
    const date = new Date(dateString);
    return date.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
  };

  const formatTime = (dateString: string | null) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  };

  // Get user display name
  const getUserName = (user: AdminUser) => {
    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`;
    }
    if (user.first_name) {
      return user.first_name;
    }
    return user.username || user.email;
  };

  // Handle add user
  const handleAddUser = () => {
    setEditingUser(null);
    setFormData({ first_name: "", last_name: "", email: "", phone: "", role: "Operator", password: "" });
    setIsUserModalOpen(true);
  };

  // Handle edit user
  const handleEditUser = (user: AdminUser) => {
    setEditingUser(user);
    setFormData({
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      phone: user.phone || "",
      role: user.role_display || "Operator",
      password: "",
    });
    setIsUserModalOpen(true);
  };

  // Handle save user
  const handleSaveUser = async () => {
    try {
      setSaving(true);
      setError(null);
      
      if (!formData.email || !formData.phone) {
        setError("Email и телефон обязательны");
        return;
      }

      if (editingUser) {
        // Update existing user
        await usersApi.updateUser(editingUser.id, {
          email: formData.email,
          phone: formData.phone,
          first_name: formData.first_name,
          last_name: formData.last_name,
          role: formData.role,
        });
      } else {
        // Create new user
        if (!formData.password) {
          setError("Пароль обязателен для нового пользователя");
          return;
        }
        await usersApi.createUser({
          email: formData.email,
          phone: formData.phone,
          password: formData.password,
          role: formData.role,
          first_name: formData.first_name,
          last_name: formData.last_name,
        });
      }
      
      setIsUserModalOpen(false);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || "Ошибка при сохранении пользователя");
    } finally {
      setSaving(false);
    }
  };

  // Handle toggle user status
  const handleToggleStatus = async (userId: number) => {
    try {
      await usersApi.toggleStatus(userId);
      await loadUsers();
    } catch (err: any) {
      setError(err.message || "Ошибка при изменении статуса пользователя");
    }
  };

  // Handle delete user
  const handleDeleteUser = (userId: number) => {
    setDeletingUserId(userId);
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteUser = async () => {
    if (deletingUserId) {
      try {
        setSaving(true);
        await usersApi.deleteUser(deletingUserId);
        setIsDeleteModalOpen(false);
        setDeletingUserId(null);
        await loadUsers();
      } catch (err: any) {
        setError(err.message || "Ошибка при удалении пользователя");
      } finally {
        setSaving(false);
      }
    }
  };

  // Get role color
  const getRoleColor = (role: string) => {
    switch (role) {
      case "Admin":
        return "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200";
      case "Dispatcher":
        return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
      case "Operator":
        return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
      default:
        return "bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200";
    }
  };

  // Get avatar color
  const getAvatarColor = (role: string) => {
    switch (role) {
      case "Admin":
        return "bg-purple-100 dark:bg-purple-900 text-purple-600 dark:text-purple-300";
      case "Dispatcher":
        return "bg-blue-100 dark:bg-blue-900 text-blue-600 dark:text-blue-300";
      case "Operator":
        return "bg-yellow-100 dark:bg-yellow-900 text-yellow-600 dark:text-yellow-300";
      default:
        return "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl text-gray-900 dark:text-white">Настройки системы</h1>
        <p className="text-gray-600 dark:text-gray-400">Конфигурация параметров работы системы</p>
      </div>

      {/* System Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
            <SettingsIcon className="w-5 h-5" />
          </div>
          <h2 className="text-xl text-gray-900 dark:text-white">Общие настройки</h2>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Название системы
              </label>
              <input
                type="text"
                defaultValue="InvoTaxi"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Email поддержки
              </label>
              <input
                type="email"
                defaultValue="support@invotaxi.kz"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Телефон диспетчерской
              </label>
              <input
                type="tel"
                defaultValue="+7 727 123 4567"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Часовой пояс
              </label>
              <select className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
                <option>Asia/Almaty (UTC+6)</option>
                <option>Asia/Aqtobe (UTC+5)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Dispatch Settings */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-purple-100 dark:bg-purple-900 flex items-center justify-center text-purple-600 dark:text-purple-400">
            <Users className="w-5 h-5" />
          </div>
          <h2 className="text-xl text-gray-900 dark:text-white">Параметры диспетчеризации</h2>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Максимальное расстояние поиска водителя (км)
              </label>
              <input
                type="number"
                defaultValue="10"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Время ожидания ответа водителя (сек)
              </label>
              <input
                type="number"
                defaultValue="30"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Максимальное количество попыток назначения
              </label>
              <input
                type="number"
                defaultValue="3"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Интервал автоматического назначения (сек)
              </label>
              <input
                type="number"
                defaultValue="15"
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <input
              type="checkbox"
              id="autoAssign"
              defaultChecked
              className="w-4 h-4 text-indigo-600 rounded"
            />
            <label htmlFor="autoAssign" className="text-sm text-gray-700 dark:text-gray-300">
              Автоматическое назначение водителей
            </label>
          </div>

          <div className="flex items-center gap-3 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <input
              type="checkbox"
              id="priorityQueue"
              defaultChecked
              className="w-4 h-4 text-indigo-600 rounded"
            />
            <label htmlFor="priorityQueue" className="text-sm text-gray-700 dark:text-gray-300">
              Учитывать приоритет заказов
            </label>
          </div>
        </div>
      </div>

      {/* Data cleanup — скрыто для оператора */}
      {user?.role !== "operator" && (
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-900 flex items-center justify-center text-red-600 dark:text-red-400">
            <Database className="w-5 h-5" />
          </div>
          <h2 className="text-xl text-gray-900 dark:text-white">Очистка данных</h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Удаление всех записей из таблиц. Действие необратимо. Используйте перед импортом новых данных.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setClearModal("orders")}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Очистить заказы
          </button>
          <button
            onClick={() => setClearModal("drivers")}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Очистить водителей
          </button>
          <button
            onClick={() => setClearModal("passengers")}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Очистить пассажиров
          </button>
          <button
            onClick={() => setClearModal("all")}
            className="px-4 py-2 bg-red-700 text-white rounded-lg hover:bg-red-800 flex items-center gap-2 border-2 border-red-500"
          >
            <AlertTriangle className="w-4 h-4" />
            Очистить всё
          </button>
        </div>
      </div>
      )}

      {/* Clear Data Modal */}
      <Modal
        isOpen={clearModal !== null}
        onClose={() => !clearing && setClearModal(null)}
        title={
          clearModal === "orders" ? "Очистить заказы" :
          clearModal === "drivers" ? "Очистить водителей" :
          clearModal === "passengers" ? "Очистить пассажиров" :
          "Очистить все данные"
        }
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-red-600 dark:text-red-400 font-medium">
            {clearModal === "orders" && "Будут удалены все заказы."}
            {clearModal === "drivers" && "Будут удалены все водители."}
            {clearModal === "passengers" && "Будут удалены все пассажиры и связанные заказы."}
            {clearModal === "all" && "Будут удалены все заказы, водители и пассажиры."}
            {" "}Действие необратимо.
          </p>
          <div className="flex gap-3 pt-4">
            <button
              onClick={async () => {
                try {
                  setClearing(true);
                  if (clearModal === "orders") {
                    const r = await ordersApi.clearAllOrders(true);
                    toast.success(`Удалено заказов: ${r.deleted_count}`);
                  } else if (clearModal === "drivers") {
                    const r = await driversApi.clearAllDrivers(true);
                    toast.success(`Удалено водителей: ${r.deleted_count}`);
                  } else if (clearModal === "passengers") {
                    const r = await passengersApi.clearAllPassengers(true);
                    toast.success(`Удалено заказов: ${r.deleted_orders}, пассажиров: ${r.deleted_passengers}`);
                  } else if (clearModal === "all") {
                    const r1 = await passengersApi.clearAllPassengers(true);
                    const r2 = await driversApi.clearAllDrivers(true);
                    toast.success(`Удалено заказов: ${r1.deleted_orders}, пассажиров: ${r1.deleted_passengers}, водителей: ${r2.deleted_count}`);
                  }
                  setClearModal(null);
                } catch (err: any) {
                  toast.error(err.response?.data?.error || "Ошибка очистки");
                } finally {
                  setClearing(false);
                }
              }}
              disabled={clearing}
              className="flex-1 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {clearing ? <Loader2 className="w-5 h-5 animate-spin" /> : null}
              Подтвердить
            </button>
            <button
              onClick={() => setClearModal(null)}
              disabled={clearing}
              className="flex-1 py-2 bg-gray-200 dark:bg-gray-600 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-500"
            >
              Отмена
            </button>
          </div>
        </div>
      </Modal>

      {/* Notifications */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900 flex items-center justify-center text-blue-600 dark:text-blue-400">
            <Bell className="w-5 h-5" />
          </div>
          <h2 className="text-xl text-gray-900 dark:text-white">Уведомления</h2>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <p className="text-gray-900 dark:text-white">Email уведомления</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Получать уведомления о важных событиях
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <p className="text-gray-900 dark:text-white">SMS уведомления</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Получать SMS о критических событиях
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" defaultChecked className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <div>
              <p className="text-gray-900 dark:text-white">Push уведомления</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Получать push-уведомления в браузере
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" className="sr-only peer" />
              <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>
        </div>
      </div>

      {/* User Management */}
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 shadow-sm border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-green-100 dark:bg-green-900 flex items-center justify-center text-green-600 dark:text-green-400">
              <Shield className="w-5 h-5" />
            </div>
            <h2 className="text-xl text-gray-900 dark:text-white">Управление пользователями</h2>
          </div>
          <button className="bg-indigo-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700" onClick={handleAddUser}>
            <Plus className="w-5 h-5" />
            Добавить пользователя
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
            <p className="text-red-800 dark:text-red-200">{error}</p>
          </div>
        )}

        {/* Search and Filters */}
        <div className="mb-6 flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Поиск по имени или email..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="all">Все роли</option>
            <option value="Admin">Admin</option>
            <option value="Dispatcher">Dispatcher</option>
            <option value="Operator">Operator</option>
          </select>
          <select className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">Все статусы</option>
            <option value="Активен">Активен</option>
            <option value="Заблокирован">Заблокирован</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
            <span className="ml-3 text-gray-600 dark:text-gray-400">Загрузка пользователей...</span>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50 dark:bg-gray-700 border-b border-gray-200 dark:border-gray-600">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Пользователь
                    </th>
                    <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Email / Телефон
                    </th>
                    <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Роль
                    </th>
                    <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Последний вход
                    </th>
                    <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Статус
                    </th>
                    <th className="px-6 py-3 text-left text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {users.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500 dark:text-gray-400">
                        Пользователи не найдены
                      </td>
                    </tr>
                  ) : (
                    users.map((user) => (
                      <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${getAvatarColor(user.role_display)}`}>
                              {user.initials}
                            </div>
                            <div>
                              <p className="text-gray-900 dark:text-gray-100">{getUserName(user)}</p>
                              <p className="text-xs text-gray-500 dark:text-gray-400">ID: {user.id}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-900 dark:text-gray-100">{user.email}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{user.phone}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-3 py-1 ${getRoleColor(user.role_display)} rounded-full text-xs`}>
                            {user.role_display}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <p className="text-gray-900 dark:text-gray-100">{formatDate(user.last_login)}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{formatTime(user.last_login)}</p>
                        </td>
                        <td className="px-6 py-4">
                          <span
                            className={`px-3 py-1 ${
                              user.is_active
                                ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"
                                : "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                            } rounded-full text-xs flex items-center gap-1 w-fit`}
                          >
                            <div
                              className={`w-2 h-2 rounded-full ${
                                user.is_active ? "bg-green-600" : "bg-red-600"
                              }`}
                            ></div>
                            {user.is_active ? "Активен" : "Заблокирован"}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              className="text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
                              title="Редактировать"
                              onClick={() => handleEditUser(user)}
                            >
                              <Edit className="w-5 h-5" />
                            </button>
                            <button
                              className="text-gray-600 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400"
                              title={user.is_active ? "Заблокировать" : "Разблокировать"}
                              onClick={() => handleToggleStatus(user.id)}
                            >
                              {user.is_active ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                            </button>
                            <button
                              className="text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400"
                              title="Удалить"
                              onClick={() => handleDeleteUser(user.id)}
                            >
                              <Trash2 className="w-5 h-5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Показано <span className="text-gray-900 dark:text-white">{users.length}</span> из <span className="text-gray-900 dark:text-white">{totalCount}</span> пользователей
              </p>
              <div className="flex gap-2">
                <button 
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50" 
                  disabled={page === 1}
                  onClick={() => setPage(page - 1)}
                >
                  Предыдущая
                </button>
                <button className="px-4 py-2 bg-indigo-600 text-white rounded-lg">
                  {page}
                </button>
                <button 
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50" 
                  disabled={page * pageSize >= totalCount}
                  onClick={() => setPage(page + 1)}
                >
                  Следующая
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button className="bg-indigo-600 text-white px-6 py-3 rounded-lg flex items-center gap-2 hover:bg-indigo-700">
          <Save className="w-5 h-5" />
          Сохранить изменения
        </button>
      </div>

      {/* User Modal */}
      <Modal 
        isOpen={isUserModalOpen} 
        onClose={() => setIsUserModalOpen(false)}
        title={editingUser ? "Редактировать пользователя" : "Добавить пользователя"}
        footer={
          <>
            <button
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg"
              onClick={() => setIsUserModalOpen(false)}
            >
              Отмена
            </button>
            <button
              className="bg-indigo-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-indigo-700 disabled:opacity-50"
              onClick={handleSaveUser}
              disabled={saving}
            >
              {saving ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Save className="w-5 h-5" />
                  Сохранить
                </>
              )}
            </button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Имя
              </label>
              <input
                type="text"
                value={formData.first_name}
                onChange={(e) => setFormData({ ...formData, first_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="Введите имя"
              />
            </div>
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Фамилия
              </label>
              <input
                type="text"
                value={formData.last_name}
                onChange={(e) => setFormData({ ...formData, last_name: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="Введите фамилию"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
              Email
            </label>
            <input
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="email@invotaxi.kz"
            />
          </div>
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
              Телефон
            </label>
            <input
              type="tel"
              value={formData.phone}
              onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="+7 7XX XXX XXXX"
            />
          </div>
          <div>
            <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
              Роль
            </label>
            <select
              value={formData.role}
              onChange={(e) => setFormData({ ...formData, role: e.target.value as "Admin" | "Dispatcher" | "Operator" })}
              className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            >
              <option value="Admin">Admin</option>
              <option value="Dispatcher">Dispatcher</option>
              <option value="Operator">Operator</option>
            </select>
          </div>
          {!editingUser && (
            <div>
              <label className="block text-sm mb-2 text-gray-700 dark:text-gray-300">
                Пароль
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                placeholder="Введите пароль"
              />
            </div>
          )}
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal 
        isOpen={isDeleteModalOpen} 
        onClose={() => setIsDeleteModalOpen(false)}
        title="Удалить пользователя"
        size="sm"
        footer={
          <>
            <button
              className="px-4 py-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-600 rounded-lg"
              onClick={() => setIsDeleteModalOpen(false)}
            >
              Отмена
            </button>
            <button
              className="bg-red-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-red-700"
              onClick={confirmDeleteUser}
            >
              <Trash2 className="w-5 h-5" />
              Удалить
            </button>
          </>
        }
      >
        <div className="text-center py-4">
          <div className="w-16 h-16 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto mb-4">
            <Trash2 className="w-8 h-8 text-red-600 dark:text-red-400" />
          </div>
          <p className="text-gray-900 dark:text-gray-100 mb-2">
            Вы уверены, что хотите удалить этого пользователя?
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Это действие нельзя отменить.
          </p>
        </div>
      </Modal>
    </div>
  );
}