import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import Illustration from "../components/Illustration";
import Sheet from "../components/Sheet";
import { Avatar, Empty } from "../components/ui";
import { useToast } from "../toast";
import type { TechName } from "../types";

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "Working late";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

export default function TapIn() {
  const { tapIn } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [techs, setTechs] = useState<TechName[]>([]);
  const [loading, setLoading] = useState(true);
  const [pinFor, setPinFor] = useState<TechName | null>(null);
  const [pin, setPin] = useState("");
  const [installEvt, setInstallEvt] = useState<Event | null>(null);

  useEffect(() => {
    api<TechName[]>("/users/techs")
      .then(setTechs)
      .catch(() => {})
      .finally(() => setLoading(false));
    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const tap = async (tech: TechName, pinValue?: string) => {
    try {
      await tapIn(tech.id, pinValue);
      navigate("/home");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not tap in");
      setPin("");
    }
  };

  return (
    <div className="relative mx-auto flex h-full max-w-lg flex-col overflow-y-auto px-5 py-8 animate-fade-up md:max-w-2xl lg:max-w-3xl">
      <div className="glow-backdrop" />

      <div className="relative mb-7 text-center">
        <Illustration className="mx-auto w-full max-w-[300px]" />
        <p className="page-eyebrow mt-3">{greeting()}</p>
        <h1 className="mt-1 font-display text-[15px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Welcome to
        </h1>
        <img src="/logo.png" alt="APEX Electrical Group" className="mx-auto mt-1.5 h-auto w-full max-w-[260px]" />
        <p className="mt-1.5 text-[15px] text-slate-500 dark:text-slate-400">Tap your name to clock in</p>
      </div>

      {loading ? (
        <div className="relative space-y-2.5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton" style={{ height: 80, animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      ) : (
        <div className="relative grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {techs.map((t, i) => (
            <button
              key={t.id}
              onClick={() => (t.has_pin ? setPinFor(t) : tap(t))}
              className="flex min-h-[80px] w-full cursor-pointer items-center gap-3.5 rounded-2xl bg-white p-4 text-left shadow-card transition-all duration-150 hover:shadow-card-hover active:scale-[0.99] dark:bg-slate-900 dark:ring-1 dark:ring-white/5 animate-fade-up"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <Avatar name={t.name} index={i} size={48} />
              <span className="min-w-0 flex-1 text-left">
                <span className="block truncate text-[17px] font-semibold">{t.name}</span>
                <span className="mt-0.5 block truncate text-[13px] text-slate-400 dark:text-slate-500">
                  Tap to clock in
                </span>
              </span>
              {t.has_pin && (
                <span className="flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <Icon name="lock" size={11} />
                  PIN
                </span>
              )}
              <Icon name="chevron-right" size={18} className="text-slate-300 dark:text-slate-600" />
            </button>
          ))}
          {techs.length === 0 && (
            <Empty icon="users" title="No techs yet" hint="Ask the office to add you." />
          )}
        </div>
      )}

      {installEvt && (
        <button className="btn-secondary relative mt-6" onClick={() => (installEvt as any).prompt?.()}>
          <Icon name="download" size={20} />
          Install APEX Electrical Stock on this phone
        </button>
      )}

      <div className="relative mt-auto flex justify-center pt-8">
        <Link to="/admin-login" className="btn-ghost text-sm">
          <Icon name="lock" size={16} />
          Admin login
        </Link>
      </div>

      {pinFor && (
        <Sheet
          title={`Hi ${pinFor.name}`}
          subtitle="Enter your 4-digit PIN"
          onClose={() => {
            setPinFor(null);
            setPin("");
          }}
        >
          <div className="pb-2 pt-1">
            <div className="mb-6 flex justify-center gap-3.5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full transition-all duration-200 ${
                    i < pin.length
                      ? "scale-110 bg-gradient-to-b from-brand-500 to-brand-600 shadow-[0_2px_8px_rgb(62_100_238/0.5)]"
                      : "bg-slate-200 dark:bg-slate-700"
                  }`}
                />
              ))}
            </div>
            <div className="mx-auto grid max-w-xs grid-cols-3 gap-2.5">
              {KEYS.map((k, i) =>
                k === "" ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    className="btn-secondary min-h-[60px] rounded-full text-[22px] font-semibold tabular-nums"
                    aria-label={k === "back" ? "Delete digit" : k}
                    onClick={() => {
                      if (k === "back") return setPin((p) => p.slice(0, -1));
                      const next = (pin + k).slice(0, 4);
                      setPin(next);
                      if (next.length === 4) {
                        tap(pinFor, next);
                      }
                    }}
                  >
                    {k === "back" ? <Icon name="backspace" size={24} /> : k}
                  </button>
                ),
              )}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
