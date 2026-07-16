import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { authApi } from "../services/auth";

export type UserRole = "admin" | "dispatcher" | "operator";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  phone: string;
}

interface AuthContextType {
  user: User | null;
  setUser: (user: User | null) => void;
  login: (phone: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Права доступа для разных ролей
const rolePermissions: Record<UserRole, string[]> = {
  admin: [
    "view_dashboard",
    "manage_orders",
    "view_drivers",
    "view_passengers",
    "manage_regions",
    "view_analytics",
    "manage_settings",
    "manage_users",
    "dispatch",
    "make_calls",
    "view_logs",
    "view_map",
    "simulate_ride",
    "view_otp_codes",
    "view_complaints",
  ],
  dispatcher: [
    "view_dashboard",
    "manage_orders",
    "view_drivers",
    "view_passengers",
    "view_complaints",
    "dispatch",
    "view_map",
    "view_analytics",
    "manage_regions",
  ],
  operator: [
    "view_dashboard",
    "manage_orders",
    "view_drivers",
    "view_passengers",
    "make_calls",
    "view_call_history",
    "view_map",
    "view_complaints",
  ],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const login = async (phone: string, password: string): Promise<void> => {
    try {
      const response = await authApi.emailLogin({ email: phone, password });
      
      // Сохраняем токены
      localStorage.setItem("accessToken", response.access);
      localStorage.setItem("refreshToken", response.refresh);
      
      // Преобразуем ответ API в формат User
      const newUser: User = {
        id: String(response.user.id),
        name: response.user.username || response.user.email,
        email: response.user.email,
        role: (response.role as UserRole) || "admin",
        phone: response.user.phone || "",
      };
      
      setUser(newUser);
      localStorage.setItem("invotaxi.phone", phone.trim());
      localStorage.setItem("invotaxi_user", JSON.stringify(newUser));
    } catch (error: any) {
      throw new Error(error.message || "Ошибка входа. Проверьте email и пароль.");
    }
  };

  const logout = async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch (error) {
      // Игнорируем ошибки при выходе
      console.error("Ошибка при выходе:", error);
    } finally {
      // Очищаем все данные в любом случае
    setUser(null);
      localStorage.removeItem("accessToken");
      localStorage.removeItem("refreshToken");
    localStorage.removeItem("invotaxi_user");
    }
  };

  const hasPermission = (permission: string): boolean => {
    if (!user) return false;
    return rolePermissions[user.role].includes(permission);
  };

  // Проверка токена и загрузка пользователя при монтировании
  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
    const savedUser = localStorage.getItem("invotaxi_user");
      const accessToken = localStorage.getItem("accessToken");
      
      if (savedUser && accessToken) {
        try {
          // Просто загружаем пользователя из localStorage
          // Валидность токена будет проверяться при первом API запросе
          const remote = await authApi.me();
          const userData = JSON.parse(savedUser) as User;
          const refreshedUser = {
            ...userData,
            id: String(remote.id),
            name: remote.username,
            phone: remote.phone,
            role: remote.role as UserRole,
          };
          setUser(refreshedUser);
          localStorage.setItem("invotaxi_user", JSON.stringify(refreshedUser));
        } catch (error) {
          // Если данные повреждены, очищаем
          localStorage.removeItem("accessToken");
          localStorage.removeItem("refreshToken");
          localStorage.removeItem("invotaxi_user");
          setUser(null);
        }
      } else {
        // Нет сохраненных данных
        setUser(null);
      }
      setIsLoading(false);
    };

    checkAuth();

    // Слушаем событие очистки токенов из API interceptor
    const handleAuthLogout = () => {
      setUser(null);
      setIsLoading(false);
    };

    window.addEventListener('auth:logout', handleAuthLogout);

    return () => {
      window.removeEventListener('auth:logout', handleAuthLogout);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, login, logout, hasPermission, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
