"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type ToastVariant = "success" | "error" | "warning" | "info";

type Toast = {
  id: number;
  variant: ToastVariant;
  message: string;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const VARIANT_STYLES: Record<ToastVariant, { container: string; icon: string }> = {
  success: { container: "border-green-200 bg-green-50 text-green-800", icon: "✓" },
  error: { container: "border-red-200 bg-red-50 text-red-800", icon: "✕" },
  warning: { container: "border-amber-200 bg-amber-50 text-amber-800", icon: "⚠" },
  info: { container: "border-blue-200 bg-blue-50 text-blue-800", icon: "ℹ" },
};

/*
  Ordinary notifications auto-dismiss quickly; errors stay up longer
  since they're more likely to need reading twice, but every toast can
  still be dismissed manually at any time regardless of variant.
*/
const AUTO_DISMISS_MS: Record<ToastVariant, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 8000,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (variant: ToastVariant, message: string) => {
      const id = nextId.current++;
      setToasts((current) => [{ id, variant, message }, ...current]);
      const timer = setTimeout(() => dismiss(id), AUTO_DISMISS_MS[variant]);
      timers.current.set(id, timer);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message: string) => push("success", message),
      error: (message: string) => push("error", message),
      warning: (message: string) => push("warning", message),
      info: (message: string) => push("info", message),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}

      <div
        className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-stretch gap-3 sm:inset-x-auto sm:right-4 sm:items-end"
        aria-label="Notifications"
      >
        {toasts.map((toast) => {
          const styles = VARIANT_STYLES[toast.variant];
          const isError = toast.variant === "error";
          return (
            <div
              key={toast.id}
              role={isError ? "alert" : "status"}
              aria-live={isError ? "assertive" : "polite"}
              className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl border p-4 shadow-lg sm:w-96 sm:max-w-[calc(100vw-2rem)] ${styles.container}`}
            >
              <span aria-hidden="true" className="mt-0.5 text-base font-bold">
                {styles.icon}
              </span>

              <p className="min-w-0 flex-1 whitespace-pre-line break-words text-sm font-medium">{toast.message}</p>

              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded-lg p-1 text-current opacity-60 transition hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
