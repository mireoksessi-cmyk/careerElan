"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useModalFocusTrap } from "@/lib/hooks/useModalFocusTrap";

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (value: boolean) => void };

type ConfirmApi = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmApi | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback((result: boolean) => {
    setPending((current) => {
      current?.resolve(result);
      return null;
    });
  }, []);

  useModalFocusTrap(!!pending, panelRef, cancelRef, () => close(false));

  const confirm = useCallback<ConfirmApi>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}

      {pending && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
          onClick={() => close(false)}
        >
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby={pending.description ? "confirm-dialog-description" : undefined}
            onClick={(event) => event.stopPropagation()}
            className="w-full max-w-md rounded-3xl bg-white p-8 shadow-xl"
          >
            <h2 id="confirm-dialog-title" className="text-xl font-bold text-gray-900">
              {pending.title}
            </h2>

            {pending.description && (
              <p id="confirm-dialog-description" className="mt-3 text-sm text-gray-600">
                {pending.description}
              </p>
            )}

            <div className="mt-8 flex flex-wrap justify-end gap-3">
              <button
                ref={cancelRef}
                type="button"
                onClick={() => close(false)}
                className="rounded-xl border px-5 py-2 font-semibold text-gray-700 hover:bg-gray-50"
              >
                {pending.cancelLabel || "Cancel"}
              </button>

              <button
                type="button"
                onClick={() => close(true)}
                className={
                  pending.destructive
                    ? "rounded-xl bg-red-600 px-5 py-2 font-bold text-white hover:bg-red-700"
                    : "rounded-xl bg-blue-600 px-5 py-2 font-bold text-white hover:bg-blue-700"
                }
              >
                {pending.confirmLabel || "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmApi {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within a ConfirmDialogProvider");
  }
  return context;
}
