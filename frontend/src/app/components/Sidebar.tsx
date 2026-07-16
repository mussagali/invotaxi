import {
  LayoutDashboard,
  ShoppingCart,
  Car,
  Users,
  Radio,
  MapPin,
  Map as MapIcon,
  BarChart3,
  LogOut,
  Moon,
  Sun,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";

type PageType =
  | "dashboard"
  | "orders"
  | "drivers"
  | "passengers"
  | "dispatch"
  | "regions"
  | "map"
  | "analytics"
  ;

interface MenuItem {
  id: PageType;
  label: string;
  icon: any;
  permission?: string;
}

const menuItems: MenuItem[] = [
  { id: "dashboard", label: "Главная", icon: LayoutDashboard, permission: "view_dashboard" },
  { id: "orders", label: "Заказы", icon: ShoppingCart, permission: "manage_orders" },
  { id: "drivers", label: "Водители", icon: Car, permission: "view_drivers" },
  { id: "passengers", label: "Пассажиры", icon: Users, permission: "view_passengers" },
  { id: "dispatch", label: "Диспетчеризация", icon: Radio, permission: "dispatch" },
  { id: "map", label: "Карта", icon: MapIcon, permission: "view_map" },
  { id: "regions", label: "Регионы", icon: MapPin, permission: "manage_regions" },
  { id: "analytics", label: "Аналитика", icon: BarChart3, permission: "view_analytics" },
];

interface SidebarProps {
  currentPage: PageType;
  setCurrentPage: (page: PageType) => void;
}

export function Sidebar({ currentPage, setCurrentPage }: SidebarProps) {
  const { user, hasPermission, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  // Filter menu items based on user permissions
  const visibleMenuItems = menuItems.filter((item) => {
    if (!item.permission || hasPermission(item.permission)) {
      // Скрыть Главную для оператора
      if (user?.role === "operator" && item.id === "dashboard") return false;
      return true;
    }
    return false;
  });

  const getRoleLabel = (role: string) => {
    switch (role) {
      case "admin":
        return "Администратор";
      case "dispatcher":
        return "Диспетчер";
      case "operator":
        return "Оператор";
      default:
        return role;
    }
  };

  return (
    <div className="w-64 bg-indigo-900 dark:bg-gray-800 text-white flex flex-col">
      <div className="p-6 border-b border-indigo-800 dark:border-gray-700">
        <h1 className="text-2xl">InvoTaxi</h1>
        <p className="text-indigo-300 dark:text-gray-400 text-sm">Админ-панель</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {visibleMenuItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentPage(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-indigo-700 dark:bg-indigo-600 text-white"
                  : "text-indigo-200 dark:text-gray-300 hover:bg-indigo-800 dark:hover:bg-gray-700 hover:text-white"
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-indigo-800 dark:border-gray-700 space-y-3">
        <button
          type="button"
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-4 py-2 rounded-lg text-indigo-200 dark:text-gray-300 hover:bg-indigo-800 dark:hover:bg-gray-700 hover:text-white transition-colors"
          title={theme === "dark" ? "Переключить на светлую тему" : "Переключить на тёмную тему"}
        >
          {theme === "dark" ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          <span>{theme === "dark" ? "Светлая тема" : "Тёмная тема"}</span>
        </button>

        {/* User Info */}
        {user && (
          <div className="flex items-center gap-3 px-4 py-3">
            <div className="w-10 h-10 rounded-full bg-indigo-700 dark:bg-indigo-600 flex items-center justify-center">
              {user.name[0]}
            </div>
            <div className="flex-1">
              <p className="text-sm">{user.name}</p>
              <p className="text-xs text-indigo-300 dark:text-gray-400">
                {getRoleLabel(user.role)}
              </p>
            </div>
            <button className="text-indigo-300 dark:text-gray-400 hover:text-white" onClick={() => logout()}>
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
