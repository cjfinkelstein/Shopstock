import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api, fmtWhen } from "../api";
import { useAuth } from "../auth";
import { ASSIGNEES } from "../calendarAssignees";
import Icon from "../components/Icon";
import Sheet from "../components/Sheet";
import { Empty, ListSkeleton, Spinner } from "../components/ui";
import { useToast } from "../toast";
import type { CalendarEvent } from "../types";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// A paste or multi-line typed entry becomes one task per non-blank line.
function linesOf(text: string | null | undefined): string[] {
  return (text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const FIELD_LABELS: Record<string, string> = {
  title: "title",
  event_date: "date",
  notes: "notes",
};

function editLine(e: CalendarEvent["edits"][number]): string {
  const who = e.edited_by_name ?? "Someone";
  if (e.field === "done") {
    return `${who} marked this ${e.new_value === "True" ? "done" : "not done"}`;
  }
  const label = FIELD_LABELS[e.field] ?? e.field;
  const from = e.old_value || "(blank)";
  const to = e.new_value || "(blank)";
  return `${who} changed the ${label} from "${from}" to "${to}"`;
}

export default function TeamCalendar({ embedded = false }: { embedded?: boolean } = {}) {
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();
  // Everyone can see the shared calendar; editing it is admin + Ray only
  // (owner request) -- mirrors require_calendar_editor on the backend, so
  // this is just hiding affordances a non-editor's requests would 403 on
  // anyway, not the actual enforcement. Matched on first name since Ray's
  // account is actually stored as the full "Raymond Bailey".
  const firstName = user?.name.trim().split(" ")[0]?.toLowerCase();
  const canEdit = user?.role === "admin" || firstName === "ray" || firstName === "raymond";
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [events, setEvents] = useState<CalendarEvent[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ title: string; event_date: string; notes: string } | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newNotes, setNewNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [assigneeDrafts, setAssigneeDrafts] = useState<Record<string, string>>({});
  const [savingAssignee, setSavingAssignee] = useState<string | null>(null);

  const load = useCallback(() => {
    setEvents(null);
    const from = toISODate(month);
    const to = toISODate(new Date(month.getFullYear(), month.getMonth() + 1, 0));
    api<CalendarEvent[]>(`/calendar?date_from=${from}&date_to=${to}`)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [month]);

  useEffect(load, [load]);

  const byDate: Record<string, CalendarEvent[]> = {};
  (events ?? []).forEach((e) => {
    (byDate[e.event_date] ??= []).push(e);
  });

  const today = toISODate(new Date());
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadingBlanks = firstOfMonth.getDay();
  const cells: (number | null)[] = [
    ...Array(leadingBlanks).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const monthLabel = month.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const shiftMonth = (delta: number) => setMonth((m) => new Date(m.getFullYear(), m.getMonth() + delta, 1));

  const selectedItems = selected ? (byDate[selected] ?? []) : [];
  const generalItems = selectedItems.filter((it) => !it.assignee);
  const showAssignments = canEdit || ASSIGNEES.some((name) => selectedItems.some((it) => it.assignee === name));
  // Anyone with an editor role can toggle any task; a tech who isn't an
  // editor can only toggle their own name's tasks (mirrors the backend's
  // require_calendar_editor self-complete exception).
  const canToggleAssignee = (name: string) => canEdit || firstName === name.toLowerCase();

  const openDay = (iso: string) => {
    setSelected(iso);
    setAssigneeDrafts({});
  };

  const closeDay = () => {
    setSelected(null);
    setExpandedId(null);
    setEditDraft(null);
    setNewTitle("");
    setNewNotes("");
    setAssigneeDrafts({});
  };

  // Each non-blank line typed becomes its own task row (so it can be
  // checked off individually later) -- never merged into one blob, and
  // never replacing what's already there.
  const saveAssignee = async (name: string) => {
    if (!selected) return;
    const lines = linesOf(assigneeDrafts[name]);
    if (lines.length === 0) return;
    setSavingAssignee(name);
    try {
      const created: CalendarEvent[] = [];
      for (const line of lines) {
        created.push(
          await api<CalendarEvent>("/calendar", {
            method: "POST",
            body: { event_date: selected, title: line, assignee: name },
          }),
        );
      }
      setEvents((prev) => [...(prev ?? []), ...created]);
      setAssigneeDrafts((d) => ({ ...d, [name]: "" }));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add");
    } finally {
      setSavingAssignee(null);
    }
  };

  const addItem = async () => {
    if (!selected || !newTitle.trim()) return;
    setSaving(true);
    try {
      const created = await api<CalendarEvent>("/calendar", {
        method: "POST",
        body: { event_date: selected, title: newTitle.trim(), notes: newNotes.trim() || null },
      });
      setEvents((prev) => [...(prev ?? []), created]);
      setNewTitle("");
      setNewNotes("");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not add");
    } finally {
      setSaving(false);
    }
  };

  const toggleDone = async (item: CalendarEvent) => {
    try {
      const updated = await api<CalendarEvent>(`/calendar/${item.id}`, {
        method: "PATCH",
        body: { done: !item.done },
      });
      setEvents((prev) => (prev ?? []).map((e) => (e.id === updated.id ? updated : e)));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update");
    }
  };

  const startEdit = (item: CalendarEvent) => {
    setExpandedId(item.id);
    setEditDraft({ title: item.title, event_date: item.event_date, notes: item.notes ?? "" });
  };

  const saveEdit = async (item: CalendarEvent) => {
    if (!editDraft) return;
    setSaving(true);
    try {
      const updated = await api<CalendarEvent>(`/calendar/${item.id}`, {
        method: "PATCH",
        body: {
          title: editDraft.title.trim(),
          event_date: editDraft.event_date,
          notes: editDraft.notes.trim() || null,
        },
      });
      setEvents((prev) => (prev ?? []).map((e) => (e.id === updated.id ? updated : e)));
      setExpandedId(null);
      setEditDraft(null);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={embedded ? "space-y-6" : "mx-auto max-w-3xl space-y-6 animate-fade-up"}>
      {!embedded && (
        <header className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="-ml-1.5 rounded-full p-1.5 text-slate-400 transition-colors hover:text-slate-600 dark:hover:text-slate-200"
          >
            <Icon name="arrow-left" size={20} />
          </button>
          <div>
            <p className="page-eyebrow">{canEdit ? "Everyone can see & edit" : "Everyone can see here"}</p>
            <h1 className="page-title mt-1">Team Calendar</h1>
          </div>
        </header>
      )}

      <div>
        <div className="mb-2.5 flex flex-wrap items-end justify-between gap-3">
          <p className="section-title flex items-center gap-1.5">
            <Icon name="calendar" size={14} />
            To-dos
          </p>
          <div className="flex items-center gap-2">
            <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
              <Icon name="arrow-left" size={18} />
            </button>
            <span className="min-w-[150px] text-center text-[15px] font-bold">{monthLabel}</span>
            <button className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
              <Icon name="arrow-right" size={18} />
            </button>
          </div>
        </div>

        {!events ? (
          <ListSkeleton rows={5} height={90} />
        ) : (
          <div className="card overflow-hidden p-0">
            <div className="grid grid-cols-7 border-b border-slate-100 dark:border-slate-800">
              {WEEKDAYS.map((w) => (
                <div
                  key={w}
                  className="px-2 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500"
                >
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {cells.map((day, i) => {
                if (day === null) {
                  return (
                    <div
                      key={i}
                      className="min-h-[92px] border-b border-r border-slate-100 last:border-r-0 dark:border-slate-800"
                    />
                  );
                }
                const iso = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                const items = byDate[iso] ?? [];
                const isToday = iso === today;
                const openCount = items.filter((it) => !it.done).length;
                // Who has an assigned task this day -- shown as small chips at
                // every screen size (unlike the to-do title preview below,
                // which is desktop-only), since "who has tasks today" is the
                // thing worth seeing at a glance, even on a phone.
                const assigneesToday = ASSIGNEES.filter((name) => items.some((it) => it.assignee === name));
                const generalForDay = items.filter((it) => !it.assignee);
                const shown = generalForDay.slice(0, 3);
                const hiddenCount = generalForDay.length - shown.length;
                return (
                  <button
                    key={i}
                    onClick={() => openDay(iso)}
                    className={`flex min-h-[92px] cursor-pointer flex-col items-start gap-1 border-b border-r p-2 text-left transition-colors last:border-r-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40 md:min-h-[132px] ${
                      (i + 1) % 7 === 0 ? "border-r-0" : "border-slate-100"
                    }`}
                  >
                    <span className="flex w-full items-center justify-between">
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-[13px] font-semibold ${
                          isToday ? "bg-brand-600 text-white" : "text-slate-600 dark:text-slate-300"
                        }`}
                      >
                        {day}
                      </span>
                      {items.length > 0 && (
                        <span
                          className={`badge ${
                            openCount > 0
                              ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                              : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                          }`}
                        >
                          {items.length}
                        </span>
                      )}
                    </span>
                    {assigneesToday.length > 0 && (
                      <span className="flex w-full flex-wrap gap-1">
                        {assigneesToday.map((name) => (
                          <span
                            key={name}
                            className="rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                          >
                            {name}
                          </span>
                        ))}
                      </span>
                    )}
                    {shown.length > 0 && (
                      <span className="hidden w-full min-w-0 flex-col gap-0.5 md:flex">
                        {shown.map((it) => (
                          <span
                            key={it.id}
                            className="flex min-w-0 items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"
                          >
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${it.done ? "bg-emerald-500" : "bg-amber-500"}`} />
                            <span className={`truncate ${it.done ? "line-through opacity-60" : ""}`}>{it.title}</span>
                          </span>
                        ))}
                        {hiddenCount > 0 && (
                          <span className="pl-3 text-[11px] font-semibold text-slate-400 dark:text-slate-500">
                            +{hiddenCount} more
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <Sheet
          title={new Date(selected + "T00:00:00").toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}
          onClose={closeDay}
        >
          <div className="space-y-4">
            {showAssignments && (
              <div className="space-y-2.5">
                <p className="section-title">Assignments</p>
                {ASSIGNEES.map((name) => {
                  const tasks = selectedItems.filter((it) => it.assignee === name);
                  const canToggle = canToggleAssignee(name);
                  if (!canEdit && tasks.length === 0) return null;
                  return (
                    <div key={name} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                      <p className="text-[13px] font-bold">{name}</p>
                      {tasks.length > 0 ? (
                        <ul className="mt-1.5 space-y-1.5">
                          {tasks.map((t) => (
                            <li key={t.id} className="flex items-start gap-2">
                              <button
                                type="button"
                                aria-label={t.done ? "Mark not done" : "Mark done"}
                                disabled={!canToggle}
                                onClick={() => toggleDone(t)}
                                className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                                  t.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"
                                } ${!canToggle ? "cursor-default opacity-70" : ""}`}
                              >
                                {t.done && <Icon name="check" size={10} strokeWidth={3} />}
                              </button>
                              <span className={`text-[13px] ${t.done ? "text-slate-400 line-through" : "text-slate-600 dark:text-slate-300"}`}>
                                {t.title}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        !canEdit && <p className="mt-1 text-[12px] text-slate-400">Nothing yet</p>
                      )}
                      {canEdit && (
                        <div className="mt-2 space-y-2">
                          <textarea
                            className="input min-h-[44px] text-[13px]"
                            placeholder={`Add a task for ${name} (one per line is fine too)`}
                            value={assigneeDrafts[name] ?? ""}
                            onChange={(e) => setAssigneeDrafts((d) => ({ ...d, [name]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="btn-secondary !min-h-0 px-3 py-1.5 text-[12px]"
                            disabled={savingAssignee === name || linesOf(assigneeDrafts[name]).length === 0}
                            onClick={() => saveAssignee(name)}
                          >
                            {savingAssignee === name ? (
                              <Spinner />
                            ) : (
                              <>
                                <Icon name="plus" size={14} />
                                Add
                              </>
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {generalItems.length === 0 ? (
              <Empty
                icon="calendar"
                title={showAssignments ? "Nothing else on this day" : "Nothing on this day"}
                hint={canEdit ? "Add a to-do below." : "Nothing scheduled."}
              />
            ) : (
              <div className="space-y-2">
                {generalItems.map((item) => {
                  const isOpen = expandedId === item.id;
                  return (
                    <div key={item.id} className="rounded-xl bg-slate-50 dark:bg-slate-800/60">
                      <div className="flex items-start gap-3 p-3">
                        <button
                          type="button"
                          aria-label={item.done ? "Mark not done" : "Mark done"}
                          disabled={!canEdit}
                          onClick={() => toggleDone(item)}
                          className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                            item.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-slate-300 dark:border-slate-600"
                          } ${!canEdit ? "cursor-default opacity-70" : ""}`}
                        >
                          {item.done && <Icon name="check" size={12} strokeWidth={3} />}
                        </button>
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => canEdit && (isOpen ? setExpandedId(null) : startEdit(item))}
                        >
                          <span className="flex items-center gap-1.5">
                            <span className={`truncate text-[14px] font-semibold ${item.done ? "text-slate-400 line-through" : ""}`}>
                              {item.title}
                            </span>
                            {item.edits.length > 0 && (
                              <span className="badge shrink-0 bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                                edited
                              </span>
                            )}
                          </span>
                          {item.notes && !isOpen && (
                            <span className="mt-0.5 block truncate text-[12px] text-slate-500 dark:text-slate-400">
                              {item.notes}
                            </span>
                          )}
                          <span className="mt-0.5 block text-[11px] text-slate-400 dark:text-slate-500">
                            Added by {item.created_by_name ?? "someone"} · {fmtWhen(item.created_at)}
                          </span>
                        </button>
                        {canEdit && (
                          <Icon
                            name={isOpen ? "chevron-down" : "chevron-right"}
                            size={16}
                            className="mt-1 shrink-0 text-slate-300"
                          />
                        )}
                      </div>

                      {isOpen && editDraft && (
                        <div className="space-y-3 border-t border-slate-200/70 p-3 dark:border-slate-700">
                          <label className="block">
                            <span className="label">Title</span>
                            <input
                              className="input"
                              value={editDraft.title}
                              onChange={(e) => setEditDraft({ ...editDraft, title: e.target.value })}
                            />
                          </label>
                          <label className="block">
                            <span className="label">Date</span>
                            <input
                              type="date"
                              className="input"
                              value={editDraft.event_date}
                              onChange={(e) => setEditDraft({ ...editDraft, event_date: e.target.value })}
                            />
                          </label>
                          <label className="block">
                            <span className="label">Notes</span>
                            <textarea
                              className="input min-h-[70px]"
                              value={editDraft.notes}
                              onChange={(e) => setEditDraft({ ...editDraft, notes: e.target.value })}
                            />
                          </label>
                          <div className="flex justify-end gap-2">
                            <button
                              className="btn-ghost"
                              onClick={() => {
                                setExpandedId(null);
                                setEditDraft(null);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              className="btn-primary"
                              disabled={saving || !editDraft.title.trim()}
                              onClick={() => saveEdit(item)}
                            >
                              {saving ? <Spinner /> : "Save"}
                            </button>
                          </div>

                          {item.edits.length > 0 && (
                            <div className="space-y-1.5 border-t border-slate-200/70 pt-3 dark:border-slate-700">
                              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">History</p>
                              {item.edits.map((e) => (
                                <p key={e.id} className="text-[12px] text-slate-500 dark:text-slate-400">
                                  {editLine(e)} · {fmtWhen(e.created_at)}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {canEdit && (
            <div className="space-y-2.5 border-t border-slate-100 pt-4 dark:border-slate-800">
              <p className="text-[13px] font-bold uppercase tracking-wider text-slate-400">Add a to-do</p>
              <input
                className="input"
                placeholder="What needs to get done?"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
              <textarea
                className="input min-h-[60px]"
                placeholder="Notes (optional)"
                value={newNotes}
                onChange={(e) => setNewNotes(e.target.value)}
              />
              <button className="btn-primary w-full" disabled={saving || !newTitle.trim()} onClick={addItem}>
                {saving ? (
                  <Spinner />
                ) : (
                  <>
                    <Icon name="plus" size={18} />
                    Add
                  </>
                )}
              </button>
            </div>
            )}
          </div>
        </Sheet>
      )}
    </div>
  );
}
