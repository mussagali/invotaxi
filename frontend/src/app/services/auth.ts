import api from "./api";

export interface LoginResponse {
  access: string;
  refresh: string;
  user: { id: string; username: string; email: string; phone: string; role: string };
  role: "admin" | "dispatcher" | "operator";
}

export interface EmailLoginRequest { email: string; password: string }

function adaptLogin(data: any): LoginResponse {
  const backendRole = data.user.role as string;
  const defaultName = backendRole === "admin" ? "Администратор" : "Диспетчер";
  return {
    access: data.tokens.access_token,
    refresh: data.tokens.refresh_token,
    user: {
      id: data.user.id,
      username: data.user.full_name || defaultName,
      email: "",
      phone: data.user.phone,
      role: backendRole,
    },
    role: backendRole === "admin" ? "admin" : "dispatcher",
  };
}

export const authApi = {
  async emailLogin(data: EmailLoginRequest): Promise<LoginResponse> {
    const phone = data.email.trim();
    try {
      return adaptLogin((await api.post("/auth/login", { phone, password: data.password })).data);
    } catch (error) {
      if (String(import.meta.env.VITE_ALLOW_DEV_LOGIN) !== "true") throw error;
      return adaptLogin((await api.post("/auth/dev-login", {
        phone,
        password: data.password,
        role: "dispatcher",
      })).data);
    }
  },

  async me(): Promise<LoginResponse["user"]> {
    const { data } = await api.get("/auth/me");
    return {
      id: data.user.id,
      username: data.user.full_name || (data.user.role === "admin" ? "Администратор" : "Диспетчер"),
      email: "",
      phone: data.user.phone,
      role: data.user.role,
    };
  },

  async logout(): Promise<void> { await api.post("/auth/logout"); },
};
