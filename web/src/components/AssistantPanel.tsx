import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { streamApi } from "../api";
import { useToast } from "../toast";
import type { ChatEvent } from "../types";
import Icon from "./Icon";
import { Spinner } from "./ui";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  activity?: string | null;
}

const SUGGESTIONS = [
  "What's low on stock?",
  "How are we doing profit-wise this month?",
  "How many hours did the crew work this week?",
];

export default function AssistantPanel() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    if (open) {
      window.addEventListener("keydown", onKey);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      for await (const event of streamApi<ChatEvent>("/assistant/chat", { body: { message: question, history } })) {
        setMessages((m) => {
          const next = [...m];
          const last = next[next.length - 1];
          if (event.type === "text") {
            next[next.length - 1] = { ...last, content: last.content + event.text };
          } else if (event.type === "tool_start") {
            next[next.length - 1] = { ...last, activity: event.label };
          } else if (event.type === "tool_end") {
            next[next.length - 1] = { ...last, activity: null };
          } else if (event.type === "error") {
            next[next.length - 1] = { ...last, activity: null };
          }
          return next;
        });
        if (event.type === "error") {
          toast("error", event.message);
        }
      }
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Couldn't reach the assistant");
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { ...next[next.length - 1], activity: null };
        return next;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Ask ShopStock"
        title="Ask ShopStock"
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+76px)] right-4 z-[1050] flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-fab transition-transform active:scale-90 md:bottom-6 md:right-6"
      >
        <Icon name="chat" size={24} />
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-[1050] flex justify-end bg-slate-950/45 backdrop-blur-[2px] animate-fade-in"
            onClick={() => setOpen(false)}
          >
            <div
              className="flex h-full w-full flex-col bg-white shadow-sheet dark:bg-slate-900 md:w-[400px]"
              onClick={(e) => e.stopPropagation()}
              role="dialog"
              aria-label="Ask ShopStock"
            >
              <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
                <span className="flex items-center gap-2.5">
                  <span className="icon-disc h-9 w-9 bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400">
                    <Icon name="chat" size={18} />
                  </span>
                  <span>
                    <span className="block text-[15px] font-bold">Ask ShopStock</span>
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                      Looks up real shop data
                    </span>
                  </span>
                </span>
                <button onClick={() => setOpen(false)} className="icon-btn bg-slate-100 dark:bg-slate-800" aria-label="Close">
                  <Icon name="x" size={18} />
                </button>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
                {messages.length === 0 && (
                  <div className="space-y-2.5">
                    <p className="text-[13px] text-slate-400 dark:text-slate-500">
                      Ask about jobs, stock, hours, expenses, or estimates — I'll look up real numbers.
                    </p>
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="card-interactive block w-full p-3 text-left text-[13.5px]"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
                {messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[13.5px] ${
                        m.role === "user"
                          ? "bg-brand-600 text-white"
                          : "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                      }`}
                    >
                      {m.content}
                      {m.activity && (
                        <span className="mt-1.5 flex items-center gap-1.5 text-[12px] italic opacity-70">
                          <Spinner />
                          {m.activity}
                        </span>
                      )}
                      {m.role === "assistant" && !m.content && !m.activity && busy && <Spinner />}
                    </div>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                <form
                  className="flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(input);
                  }}
                >
                  <input
                    className="input flex-1"
                    placeholder="Ask a question..."
                    value={input}
                    disabled={busy}
                    onChange={(e) => setInput(e.target.value)}
                  />
                  <button type="submit" className="icon-btn bg-brand-600 text-white" disabled={busy || !input.trim()} aria-label="Send">
                    {busy ? <Spinner /> : <Icon name="arrow-right" size={18} />}
                  </button>
                </form>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
