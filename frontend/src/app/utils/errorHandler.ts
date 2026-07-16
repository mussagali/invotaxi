import { toast } from "sonner";

export const handleApiError = (error: any, defaultMessage?: string) => {
  const message = error?.message || defaultMessage || "Произошла ошибка";
  toast.error(message);
  console.error("API Error:", error);
};

export const handleApiSuccess = (message: string) => {
  toast.success(message);
};

export const handleApiInfo = (message: string) => {
  toast.info(message);
};

