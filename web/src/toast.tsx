import { createContext, useCallback, useContext, useRef, useState } from "react";

import Icon from "./components/Icon";

interface Toast {
  id: number;
  kind: "error" | "success" | "info";
  text: string;
}

const META: Record<Toast["kind"], { icon: string; ring: string }> = {
  error: { icon: "alert-triangle", ring: "bg-red-500" },
  success: { icon: "check", ring: "bg-emerald-500" },
  info: { icon: "layers", ring: "bg-brand-500" },
};

const ToastContext = createContext<(kind: Toast["kind"], text: string) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 2800);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+16px)] z-[1200] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => {
          const m = META[t.kind];
          return (
            <div
              key={t.id}
              role="alert"
              className="pointer-events-auto flex w-full max-w-md animate-toast-in items-center gap-3 rounded-2xl border border-slate-700/50 bg-slate-900/95 py-3 pl-3 pr-4 text-white shadow-2xl backdrop-blur-xl dark:border-slate-600/40 dark:bg-slate-800/95"
            >
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${m.ring}`}>
                <Icon name={m.icon} size={16} strokeWidth={2.5} />
              </span>
              <span className="text-[13.5px] font-medium leading-snug">{t.text}</span>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
