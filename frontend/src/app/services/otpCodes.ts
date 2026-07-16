import api from "./api";

export interface OtpCodeRow {
  id: number;
  phone: string;
  code: string;
  created_at: string;
  expires_at: string;
  is_used: boolean;
}

export const otpCodesApi = {
  async list(limit = 200): Promise<OtpCodeRow[]> {
    const response = await api.get<OtpCodeRow[]>("/auth/otp-codes/", {
      params: { limit },
    });
    return response.data;
  },
};
