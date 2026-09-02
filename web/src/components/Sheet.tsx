import { useEffect } from "react";
import { createPortal } from "react-dom";

import Icon from "./Icon";

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Bottom sheet with backdrop fade, slide-up spring, and a drag handle. */
export default function Sheet({ title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
      onClick={onClose}
    >
      <div
        className="mx-auto w-full max-w-lg animate-sheet-up rounded-t-[28px] bg-white shadow-sheet dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="flex justify-center pb-1 pt-3">
          <div className="h-1.5 w-10 rounded-full bg-slate-200 dark:bg-slate-700" />
        </div>
        <div className="flex items-start justify-between px-5 pb-3 pt-1">
          <div className="min-w-0 pr-3">
            <h2 className="truncate text-[17px] font-bold tracking-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-slate-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="icon-btn -mr-2 -mt-1 bg-slate-100 dark:bg-slate-800" aria-label="Close">
            <Icon name="x" size={18} />
          </button>
        </div>
        <div className="max-h-[76vh] overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
