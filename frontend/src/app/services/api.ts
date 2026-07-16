import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "/api/v1").replace(/\/$/, "");
let refreshPromise: Promise<string> | null = null;

export function resolveHttpOrigin(): string {
  if (API_BASE_URL.startsWith("/")) return typeof window === "undefined" ? "" : window.location.origin;
  return API_BASE_URL.replace(/\/api\/v1$/, "");
}

export function resolveWsOrigin(): string {
  const explicit = (import.meta.env.VITE_WS_BASE_URL as string | undefined)?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const origin = resolveHttpOrigin() || "http://localhost:8000";
  return origin.replace(/^http/, "ws");
}

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: { Accept: "application/json" },
  timeout: 20_000,
});

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem("accessToken");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (config.data instanceof FormData) delete config.headers["Content-Type"];
  return config;
});

async function rotateRefreshToken(): Promise<string> {
  if (refreshPromise) return refreshPromise;
  const refreshToken = localStorage.getItem("refreshToken");
  if (!refreshToken) throw new Error("Сессия завершена");
  refreshPromise = axios
    .post(`${API_BASE_URL}/auth/refresh`, { refresh_token: refreshToken })
    .then(({ data }) => {
      localStorage.setItem("accessToken", data.access_token);
      localStorage.setItem("refreshToken", data.refresh_token);
      return data.access_token as string;
    })
    .finally(() => { refreshPromise = null; });
  return refreshPromise;
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const request = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const isAuth = request?.url?.includes("/auth/login") ||
      request?.url?.includes("/auth/dev-login") ||
      request?.url?.includes("/auth/refresh");
    if (error.response?.status === 401 && request && !request._retry && !isAuth) {
      request._retry = true;
      try {
        request.headers.Authorization = `Bearer ${await rotateRefreshToken()}`;
        return api(request);
      } catch {
        localStorage.removeItem("accessToken");
        localStorage.removeItem("refreshToken");
        localStorage.removeItem("invotaxi_user");
        window.dispatchEvent(new Event("auth:logout"));
      }
    }
    const body = error.response?.data as any;
    const message = body?.error?.message || body?.detail || body?.message || error.message || "Ошибка сервера";
    return Promise.reject(new Error(typeof message === "string" ? message : JSON.stringify(message)));
  },
);

export default api;
