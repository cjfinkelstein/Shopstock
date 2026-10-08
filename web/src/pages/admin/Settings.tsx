import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { api, fmtMoney } from "../../api";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Avatar, Empty, Spinner } from "../../components/ui";
import { PTO_ENABLED } from "../../featureFlags";
import { useToast } from "../../toast";
import type { PtoBalance, PtoEntry, SmtpSettings, Truck, User, Vendor } from "../../types";

type AddKind = "tech" | "truck" | "vendor";

const ADD_META: Record<AddKind, { title: string; label: string }> = {
  tech: { title: "Add tech", label: "Tech name" },
  truck: { title: "Add truck", label: "Truck name" },
  vendor: { title: "Add vendor", label: "Vendor name" },
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function Section({
  icon,
  tint,
  title,
  caption,
  action,
  children,
}: {
  icon: string;
  tint: string;
  title: string;
  caption?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card p-0">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3.5 dark:border-slate-800">
        <span className={`icon-disc ${tint}`}>
          <Icon name={icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold">{title}</h2>
          {caption && (
            <p className="truncate text-[12px] text-slate-400 dark:text-slate-500">{caption}</p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function Settings() {
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [pinFor, setPinFor] = useState<User | null>(null);
  const [pin, setPin] = useState("");
  const [rateFor, setRateFor] = useState<User | null>(null);
  const [rate, setRate] = useState("");
  const [ptoFor, setPtoFor] = useState<User | null>(null);
  const [ptoBalance, setPtoBalance] = useState<PtoBalance | null>(null);
  const [newPtoDate, setNewPtoDate] = useState("");
  const [newPtoCategory, setNewPtoCategory] = useState<"vacation" | "personal">("vacation");
  const [newPtoDays, setNewPtoDays] = useState("1");
  const [newPtoNotes, setNewPtoNotes] = useState("");
  const [ptoSaving, setPtoSaving] = useState(false);
  const [pendingPto, setPendingPto] = useState<PtoEntry[] | null>(null);
  const [decidingPto, setDecidingPto] = useState<number | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [addName, setAddName] = useState("");

  const [smtp, setSmtp] = useState<SmtpSettings | null>(null);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpFromAddress, setSmtpFromAddress] = useState("");
  const [smtpFromName, setSmtpFromName] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpSaving, setSmtpSaving] = useState(false);

  const load = useCallback(() => {
    api<User[]>("/users?include_inactive=true").then(setUsers).catch(() => {});
    api<Truck[]>("/trucks?include_inactive=true").then(setTrucks).catch(() => {});
    api<Vendor[]>("/vendors?include_inactive=true").then(setVendors).catch(() => {});
    api<string[]>("/items/categories").then(setCategories).catch(() => {});
    api<SmtpSettings>("/settings/smtp").then((s) => {
      setSmtp(s);
      setSmtpHost(s.host);
      setSmtpPort(String(s.port));
      setSmtpUseTls(s.use_tls);
      setSmtpUsername(s.username);
      setSmtpFromAddress(s.from_address);
      setSmtpFromName(s.from_name);
    }).catch(() => {});
    if (PTO_ENABLED) api<PtoEntry[]>("/pto/pending").then(setPendingPto).catch(() => setPendingPto([]));
  }, []);

  const decidePto = async (entryId: number, decision: "approve" | "deny") => {
    setDecidingPto(entryId);
    try {
      await api(`/pto/${entryId}/${decision}`, { method: "POST" });
      setPendingPto((prev) => (prev ?? []).filter((e) => e.id !== entryId));
      toast("success", decision === "approve" ? "Request approved" : "Request denied");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update request");
    } finally {
      setDecidingPto(null);
    }
  };

  useEffect(load, [load]);

  const saveSmtp = async () => {
    setSmtpSaving(true);
    try {
      const s = await api<SmtpSettings>("/settings/smtp", {
        method: "PUT",
        body: {
          host: smtpHost,
          port: Number(smtpPort) || 587,
          use_tls: smtpUseTls,
          username: smtpUsername,
          from_address: smtpFromAddress,
          from_name: smtpFromName,
          password: smtpPassword || null,
        },
      });
      setSmtp(s);
      setSmtpPassword("");
      toast("success", "Email settings saved");
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not save email settings");
    } finally {
      setSmtpSaving(false);
    }
  };

  const techs = users.filter((u) => u.role === "tech");

  const openAdd = (kind: AddKind) => {
    setAddName(kind === "truck" ? `Truck ${trucks.length + 1}` : "");
    setAddKind(kind);
  };

  const closeAdd = () => {
    setAddKind(null);
    setAddName("");
  };

  const submitAdd = async () => {
    const name = addName.trim();
    if (!name || !addKind) return;
    if (addKind === "tech") {
      await api("/users", { method: "POST", body: { name, role: "tech" } });
      toast("success", `${name} added`);
    } else if (addKind === "truck") {
      await api("/trucks", { method: "POST", body: { name } });
      toast("success", `${name} created (with its own stock location)`);
    } else {
      await api("/vendors", { method: "POST", body: { name } });
    }
    closeAdd();
    load();
  };

  const savePin = async () => {
    if (!pinFor || !/^\d{4}$/.test(pin)) return;
    await api(`/users/${pinFor.id}`, { method: "PATCH", body: { pin } });
    toast("success", `PIN set for ${pinFor.name}`);
    setPinFor(null);
    setPin("");
    load();
  };

  const saveRate = async () => {
    if (!rateFor || !rate || Number(rate) < 0) return;
    await api(`/users/${rateFor.id}`, { method: "PATCH", body: { hourly_rate: rate } });
    toast("success", `Pay rate set for ${rateFor.name}`);
    setRateFor(null);
    setRate("");
    load();
  };

  const openPto = (u: User) => {
    setPtoFor(u);
    setPtoBalance(null);
    setNewPtoDate("");
    setNewPtoCategory("vacation");
    setNewPtoDays("1");
    setNewPtoNotes("");
    api<PtoBalance[]>(`/pto?year=${new Date().getFullYear()}`)
      .then((rows) => {
        const mine = rows.find((b) => b.user_id === u.id);
        if (mine) setPtoBalance(mine);
      })
      .catch(() => {});
  };

  const closePto = () => {
    setPtoFor(null);
    setPtoBalance(null);
  };

  const addPto = async () => {
    if (!ptoFor || !newPtoDate || !newPtoDays || Number(newPtoDays) <= 0) return;
    setPtoSaving(true);
    try {
      const updated = await api<PtoBalance>("/pto", {
        method: "POST",
        body: {
          user_id: ptoFor.id,
          entry_date: newPtoDate,
          category: newPtoCategory,
          days: newPtoDays,
          notes: newPtoNotes.trim() || null,
        },
      });
      setPtoBalance(updated);
      setNewPtoDate("");
      setNewPtoDays("1");
      setNewPtoNotes("");
      toast("success", `Logged ${newPtoDays} ${newPtoCategory} day(s) for ${ptoFor.name}`);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not log PTO");
    } finally {
      setPtoSaving(false);
    }
  };

  const deletePto = async (entryId: number) => {
    if (!ptoFor) return;
    try {
      await api(`/pto/${entryId}`, { method: "DELETE" });
      openPto(ptoFor);
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not remove entry");
    }
  };

  const decidePtoInSheet = async (entryId: number, decision: "approve" | "deny") => {
    if (!ptoFor) return;
    try {
      await api(`/pto/${entryId}/${decision}`, { method: "POST" });
      openPto(ptoFor);
      setPendingPto((prev) => (prev ?? []).filter((e) => e.id !== entryId));
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update request");
    }
  };

  const clearPin = async (u: User) => {
    await api(`/users/${u.id}`, { method: "PATCH", body: { clear_pin: true } });
    toast("success", `PIN removed for ${u.name}`);
    load();
  };

  const toggleUser = async (u: User) => {
    await api(`/users/${u.id}`, { method: "PATCH", body: { active: !u.active } });
    load();
  };

  const assignTruck = async (t: Truck, userId: string) => {
    await api(`/trucks/${t.id}`, {
      method: "PATCH",
      body: userId === "" ? { clear_assignment: true } : { assigned_user_id: Number(userId) },
    });
    load();
  };

  const toggleTruck = async (t: Truck) => {
    await api(`/trucks/${t.id}`, { method: "PATCH", body: { active: !t.active } });
    load();
  };

  const toggleVendor = async (v: Vendor) => {
    await api(`/vendors/${v.id}`, { method: "PATCH", body: { active: !v.active } });
    load();
  };

  const activeTechs = techs.filter((u) => u.active).length;

  return (
    <div className="max-w-3xl space-y-6 animate-fade-up">
      <div className="min-w-0">
        <p className="page-eyebrow">Workspace</p>
        <h1 className="page-title">Settings</h1>
      </div>

      {/* PTO requests */}
      {PTO_ENABLED && pendingPto && pendingPto.length > 0 && (
        <Section
          icon="calendar"
          tint="bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
          title="PTO Requests"
          caption={`${plural(pendingPto.length, "request")} waiting on you`}
        >
          <div className="divide-list">
            {pendingPto.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center gap-2.5 px-4 py-3">
                <Avatar name={e.user_name} index={e.user_id} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold">{e.user_name}</p>
                  <p className="truncate text-[12.5px] text-slate-500 dark:text-slate-400">
                    {e.entry_date}
                    {e.end_date && e.end_date !== e.entry_date ? ` – ${e.end_date}` : ""} · {e.days}d{" "}
                    <span className="capitalize">{e.category}</span>
                    {e.notes ? ` · ${e.notes}` : ""}
                  </p>
                </div>
                <button
                  className="btn-secondary !min-h-[40px] px-3.5 text-[13px] text-emerald-700 dark:text-emerald-300"
                  disabled={decidingPto === e.id}
                  onClick={() => decidePto(e.id, "approve")}
                >
                  {decidingPto === e.id ? <Spinner /> : <Icon name="check" size={15} />}
                  Approve
                </button>
                <button
                  className="btn-ghost !min-h-[40px] px-3.5 text-[13px]"
                  disabled={decidingPto === e.id}
                  onClick={() => decidePto(e.id, "deny")}
                >
                  <Icon name="x" size={15} />
                  Deny
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Techs */}
      <Section
        icon="users"
        tint="bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
        title="Techs"
        caption={`${plural(techs.length, "tech")} · ${activeTechs} active`}
        action={
          <button className="btn-secondary !min-h-[44px] px-4 text-sm" onClick={() => openAdd("tech")}>
            <Icon name="plus" size={16} />
            Add tech
          </button>
        }
      >
        <div className="divide-list">
          {techs.length === 0 && (
            <Empty icon="users" title="No techs yet" hint="Add a tech so they can tap in and sign out material." />
          )}
          {techs.map((u) => (
            <div
              key={u.id}
              className={`flex flex-wrap items-center gap-2.5 px-4 py-3 ${!u.active ? "opacity-50" : ""}`}
            >
              <Avatar name={u.name} index={u.id} size={36} />
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{u.name}</span>
              <button
                className="chip !min-h-[40px] px-3.5"
                onClick={() => {
                  setRateFor(u);
                  setRate(u.hourly_rate ?? "");
                }}
                title="Tap to change pay rate"
              >
                <Icon name="dollar-sign" size={15} />
                {u.hourly_rate ? `${fmtMoney(u.hourly_rate)}/hr` : "Set rate"}
              </button>
              {PTO_ENABLED && (
                <button className="chip !min-h-[40px] px-3.5" onClick={() => openPto(u)} title="View/log PTO">
                  <Icon name="calendar" size={15} />
                  PTO
                </button>
              )}
              {u.has_pin ? (
                <span className="flex items-center gap-1.5">
                  <button
                    className="chip !min-h-[40px] px-3.5 font-mono tracking-[0.2em] text-emerald-700 dark:text-emerald-300"
                    onClick={() => setPinFor(u)}
                    title="Tap to change PIN"
                  >
                    <Icon name="lock" size={15} />
                    {u.pin ?? "••••"}
                  </button>
                  <button
                    className="icon-btn !min-h-[40px]"
                    onClick={() => clearPin(u)}
                    title="Remove PIN"
                    aria-label={`Remove PIN for ${u.name}`}
                  >
                    <Icon name="x" size={15} />
                  </button>
                </span>
              ) : (
                <button className="chip !min-h-[40px] px-3.5" onClick={() => setPinFor(u)}>
                  <Icon name="keypad" size={16} />
                  Set PIN
                </button>
              )}
              <button className="btn-ghost !min-h-[40px] px-3 text-[13px]" onClick={() => toggleUser(u)}>
                {u.active ? "Deactivate" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Trucks */}
      <Section
        icon="truck"
        tint="bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400"
        title="Trucks"
        caption={`${plural(trucks.length, "truck")} · each has its own stock location`}
        action={
          <button className="btn-secondary !min-h-[44px] px-4 text-sm" onClick={() => openAdd("truck")}>
            <Icon name="plus" size={16} />
            Add truck
          </button>
        }
      >
        <div className="divide-list">
          {trucks.length === 0 && (
            <Empty icon="truck" title="No trucks yet" hint="Each truck gets its own stock location." />
          )}
          {trucks.map((t) => (
            <div
              key={t.id}
              className={`flex flex-wrap items-center gap-2.5 px-4 py-3 ${!t.active ? "opacity-50" : ""}`}
            >
              <span className="icon-disc h-9 w-9 bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-400">
                <Icon name="truck" size={18} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{t.name}</span>
              <select
                className="input !min-h-[40px] max-w-[180px]"
                aria-label={`Assigned tech for ${t.name}`}
                value={t.assigned_user_id ?? ""}
                onChange={(e) => assignTruck(t, e.target.value)}
              >
                <option value="">Unassigned</option>
                {techs.filter((u) => u.active).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
              <button className="btn-ghost !min-h-[40px] px-3 text-[13px]" onClick={() => toggleTruck(t)}>
                {t.active ? "Deactivate" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Vendors */}
      <Section
        icon="store"
        tint="bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400"
        title="Vendors"
        caption={plural(vendors.length, "vendor")}
        action={
          <button className="btn-secondary !min-h-[44px] px-4 text-sm" onClick={() => openAdd("vendor")}>
            <Icon name="plus" size={16} />
            Add vendor
          </button>
        }
      >
        <div className="divide-list">
          {vendors.length === 0 && (
            <Empty icon="store" title="No vendors yet" hint="Vendors show up when receiving stock." />
          )}
          {vendors.map((v) => (
            <div key={v.id} className={`flex items-center gap-2.5 px-4 py-3 ${!v.active ? "opacity-50" : ""}`}>
              <span className="min-w-0 flex-1 truncate text-[15px] font-semibold">{v.name}</span>
              <button className="btn-ghost !min-h-[40px] px-3 text-[13px]" onClick={() => toggleVendor(v)}>
                {v.active ? "Deactivate" : "Restore"}
              </button>
            </div>
          ))}
        </div>
      </Section>

      {/* Categories */}
      <Section
        icon="tag"
        tint="bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
        title="Categories"
        caption={`${categories.length} ${categories.length === 1 ? "category" : "categories"}`}
      >
        <div className="px-4 py-4">
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => {
              const t = catTint(c);
              return (
                <span
                  key={c}
                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ${t.badge}`}
                >
                  <Icon name={t.icon} size={14} />
                  {c}
                </span>
              );
            })}
          </div>
          <p className="mt-3 text-[13px] text-slate-400 dark:text-slate-500">
            Categories are free text on items — edit an item to move it to a new or existing
            category.
          </p>
        </div>
      </Section>

      {/* Stock adjustment */}
      <Section
        icon="wrench"
        tint="bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400"
        title="Stock adjustment"
        caption="Logged with reason and note"
        action={
          <button className="btn-secondary !min-h-[44px] px-4 text-sm" onClick={() => setAdjustOpen(true)}>
            <Icon name="arrow-swap" size={16} />
            Adjust stock
          </button>
        }
      >
        <p className="px-4 py-4 text-sm text-slate-400 dark:text-slate-500">
          Count corrections, damaged or lost material. Every adjustment is logged with reason and
          note on the Adjustments report.
        </p>
      </Section>

      {/* Email (SMTP) */}
      <Section
        icon="mail"
        tint="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-400"
        title="Email"
        caption={smtp?.configured ? `Sending as ${smtp.from_address}` : "Not connected yet"}
      >
        <div className="space-y-4 p-4">
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Connects a mailbox for estimate-ready emails and admin password resets. For Gmail or
            Outlook, use an <span className="font-semibold">app password</span> here, not your
            regular sign-in password — your provider's account settings can generate one.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">SMTP host</span>
              <input
                className="input"
                placeholder="smtp.gmail.com"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">Port</span>
              <input
                className="input"
                inputMode="numeric"
                placeholder="587"
                value={smtpPort}
                onChange={(e) => setSmtpPort(e.target.value.replace(/\D/g, ""))}
              />
            </label>
            <label className="block">
              <span className="label">Mailbox username</span>
              <input
                className="input"
                placeholder="you@company.com"
                value={smtpUsername}
                onChange={(e) => setSmtpUsername(e.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block">
              <span className="label">Password / app password</span>
              <input
                className="input"
                type="password"
                placeholder={smtp?.has_password ? "•••••••• (saved — leave blank to keep)" : "App password"}
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="block">
              <span className="label">From address</span>
              <input
                className="input"
                placeholder="you@company.com"
                value={smtpFromAddress}
                onChange={(e) => setSmtpFromAddress(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="label">From name</span>
              <input
                className="input"
                placeholder="APEX Electrical Group"
                value={smtpFromName}
                onChange={(e) => setSmtpFromName(e.target.value)}
              />
            </label>
          </div>

          <label className="flex items-center gap-2.5 text-[14px] font-medium">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-slate-300"
              checked={smtpUseTls}
              onChange={(e) => setSmtpUseTls(e.target.checked)}
            />
            Use TLS (leave on unless your provider says otherwise)
          </label>

          <button
            className="btn-primary"
            disabled={smtpSaving || !smtpHost.trim() || !smtpFromAddress.trim()}
            onClick={saveSmtp}
          >
            {smtpSaving ? <Spinner /> : <Icon name="check" size={16} />}
            Save email settings
          </button>
        </div>
      </Section>

      {addKind && (
        <Sheet title={ADD_META[addKind].title} onClose={closeAdd}>
          <div className="space-y-4">
            <label className="block">
              <span className="label">{ADD_META[addKind].label}</span>
              <input
                className="input"
                value={addName}
                autoFocus
                onChange={(e) => setAddName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAdd()}
              />
            </label>
            <button className="btn-primary w-full" disabled={!addName.trim()} onClick={submitAdd}>
              Save
            </button>
          </div>
        </Sheet>
      )}

      {pinFor && (
        <Sheet
          title={`Set PIN for ${pinFor.name}`}
          subtitle="4-digit code used to tap in"
          onClose={() => {
            setPinFor(null);
            setPin("");
          }}
        >
          <div className="space-y-4">
            <label className="block">
              <span className="label">PIN</span>
              <input
                className="input text-center text-2xl font-bold tracking-[0.5em]"
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
            <button className="btn-primary w-full" disabled={!/^\d{4}$/.test(pin)} onClick={savePin}>
              Save PIN
            </button>
          </div>
        </Sheet>
      )}

      {rateFor && (
        <Sheet
          title={`Pay rate for ${rateFor.name}`}
          subtitle="Used to calculate labor cost on job costing reports"
          onClose={() => {
            setRateFor(null);
            setRate("");
          }}
        >
          <div className="space-y-4">
            <label className="block">
              <span className="label">$ / hour</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                placeholder="0.00"
                autoFocus
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            </label>
            <button className="btn-primary w-full" disabled={!rate || Number(rate) < 0} onClick={saveRate}>
              Save rate
            </button>
          </div>
        </Sheet>
      )}

      {ptoFor && (
        <Sheet
          title={`PTO for ${ptoFor.name}`}
          subtitle={`${ptoBalance?.year ?? new Date().getFullYear()} · resets every January 1st, no carryover`}
          onClose={closePto}
        >
          {!ptoBalance ? (
            <p className="py-6 text-center text-[13px] text-slate-400">Loading...</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-emerald-50 p-3.5 text-center dark:bg-emerald-500/10">
                  <p className="text-[24px] font-extrabold text-emerald-700 dark:text-emerald-300">
                    {ptoBalance.vacation_remaining}
                  </p>
                  <p className="text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                    of {ptoBalance.vacation_allotted} vacation days left
                  </p>
                </div>
                <div className="rounded-2xl bg-brand-50 p-3.5 text-center dark:bg-brand-500/10">
                  <p className="text-[24px] font-extrabold text-brand-700 dark:text-brand-300">
                    {ptoBalance.personal_remaining}
                  </p>
                  <p className="text-[11.5px] font-semibold text-brand-600 dark:text-brand-400">
                    of {ptoBalance.personal_allotted} personal days left
                  </p>
                </div>
              </div>

              <div className="space-y-2.5 rounded-2xl bg-slate-50 p-3.5 dark:bg-slate-800/60">
                <p className="text-[13px] font-bold uppercase tracking-wider text-slate-400">Log a day</p>
                <div className="grid grid-cols-2 gap-2.5">
                  <label className="block">
                    <span className="label">Date</span>
                    <input
                      type="date"
                      className="input"
                      value={newPtoDate}
                      onChange={(e) => setNewPtoDate(e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="label">Days</span>
                    <input
                      type="number"
                      className="input"
                      min="0.5"
                      step="0.5"
                      value={newPtoDays}
                      onChange={(e) => setNewPtoDays(e.target.value)}
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="label">Type</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`chip flex-1 !justify-center ${newPtoCategory === "vacation" ? "chip-active" : ""}`}
                      onClick={() => setNewPtoCategory("vacation")}
                    >
                      Vacation
                    </button>
                    <button
                      type="button"
                      className={`chip flex-1 !justify-center ${newPtoCategory === "personal" ? "chip-active" : ""}`}
                      onClick={() => setNewPtoCategory("personal")}
                    >
                      Personal
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="label">Notes (optional)</span>
                  <input
                    className="input"
                    placeholder="e.g. Family trip"
                    value={newPtoNotes}
                    onChange={(e) => setNewPtoNotes(e.target.value)}
                  />
                </label>
                <button
                  className="btn-primary w-full"
                  disabled={ptoSaving || !newPtoDate || !newPtoDays || Number(newPtoDays) <= 0}
                  onClick={addPto}
                >
                  {ptoSaving ? <Spinner /> : <Icon name="plus" size={16} />}
                  Log PTO
                </button>
              </div>

              <div>
                <p className="mb-2 text-[13px] font-bold uppercase tracking-wider text-slate-400">
                  This year's entries ({ptoBalance.entries.length})
                </p>
                {ptoBalance.entries.length === 0 ? (
                  <p className="text-[12.5px] text-slate-400">Nothing logged yet.</p>
                ) : (
                  <div className="space-y-2">
                    {ptoBalance.entries.map((e) => (
                      <div
                        key={e.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-800/60"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className={`text-[13px] font-semibold ${e.status === "denied" ? "text-slate-400 line-through" : ""}`}>
                              {e.entry_date}
                              {e.end_date && e.end_date !== e.entry_date ? ` – ${e.end_date}` : ""} · {e.days}{" "}
                              {e.category} day{Number(e.days) === 1 ? "" : "s"}
                            </p>
                            {e.status !== "approved" && (
                              <span
                                className={`badge shrink-0 capitalize ${
                                  e.status === "pending"
                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                                    : "bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400"
                                }`}
                              >
                                {e.status}
                              </span>
                            )}
                          </div>
                          {e.notes && (
                            <p className="truncate text-[12px] text-slate-400 dark:text-slate-500">{e.notes}</p>
                          )}
                        </div>
                        {e.status === "pending" && (
                          <div className="flex shrink-0 gap-1.5">
                            <button
                              className="btn-secondary !min-h-[36px] px-2.5 text-[12px] text-emerald-700 dark:text-emerald-300"
                              onClick={() => decidePtoInSheet(e.id, "approve")}
                            >
                              <Icon name="check" size={14} />
                            </button>
                            <button
                              className="btn-ghost !min-h-[36px] px-2.5 text-[12px]"
                              onClick={() => decidePtoInSheet(e.id, "deny")}
                            >
                              <Icon name="x" size={14} />
                            </button>
                          </div>
                        )}
                        <button
                          className="icon-btn shrink-0"
                          aria-label="Remove entry"
                          onClick={() => deletePto(e.id)}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Sheet>
      )}

      {adjustOpen && <AdjustSheet onClose={() => setAdjustOpen(false)} />}
    </div>
  );
}

interface AdjustItem {
  id: number;
  name: string;
  sku: string;
  unit: string;
  category?: string;
}

function AdjustSheet({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<AdjustItem[]>([]);
  const [item, setItem] = useState<AdjustItem | null>(null);
  const [locations, setLocations] = useState<{ id: number; name: string }[]>([]);
  const [locationId, setLocationId] = useState<number | "">("");
  const [direction, setDirection] = useState<"increase" | "decrease">("decrease");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("count_correction");
  const [note, setNote] = useState("");

  useEffect(() => {
    api<{ id: number; name: string }[]>("/locations").then(setLocations).catch(() => {});
  }, []);

  useEffect(() => {
    if (!search.trim()) return setResults([]);
    const t = setTimeout(() => {
      api<any[]>(`/items?search=${encodeURIComponent(search)}`)
        .then((r) => setResults(r.slice(0, 6)))
        .catch(() => {});
    }, 200);
    return () => clearTimeout(t);
  }, [search]);

  const submit = async () => {
    try {
      await api("/transactions/adjust", {
        method: "POST",
        body: { item_id: item!.id, qty, location_id: locationId, direction, reason, note },
      });
      toast("success", "Adjustment recorded");
      onClose();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Adjustment failed");
    }
  };

  const valid = item && locationId !== "" && parseFloat(qty) > 0 && note.trim().length > 0;
  const itemTint = item?.category ? catTint(item.category) : null;

  return (
    <Sheet title="Adjust stock" subtitle="Logged with reason and note" onClose={onClose}>
      <div className="space-y-4">
        {!item ? (
          <div>
            <label className="block">
              <span className="label">Item</span>
              <div className="relative">
                <Icon
                  name="search"
                  size={18}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                />
                <input
                  className="input pl-10"
                  placeholder="Search item…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </label>
            <div className="mt-2.5 space-y-2">
              {results.map((r) => {
                const t = r.category
                  ? catTint(r.category)
                  : { tile: "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400", icon: "package" };
                return (
                  <button
                    key={r.id}
                    className="card-interactive flex w-full items-center gap-3 p-3 text-left"
                    onClick={() => setItem(r)}
                  >
                    <span className={`icon-disc h-9 w-9 ${t.tile}`}>
                      <Icon name={t.icon} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{r.name}</span>
                      <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">{r.sku}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            <div className="card flex items-center gap-3 p-3.5">
              <span
                className={`icon-disc ${
                  itemTint ? itemTint.tile : "bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-400"
                }`}
              >
                <Icon name={itemTint ? itemTint.icon : "package"} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-semibold">{item.name}</span>
                <span className="block truncate text-[13px] text-slate-400 dark:text-slate-500">{item.sku}</span>
              </span>
              <button className="btn-ghost !min-h-[36px] px-2.5 text-[13px]" onClick={() => setItem(null)}>
                Change
              </button>
            </div>

            <div>
              <span className="label">Direction</span>
              <div className="seg">
                <button
                  className={`seg-item ${direction === "increase" ? "seg-item-active" : ""}`}
                  aria-pressed={direction === "increase"}
                  onClick={() => setDirection("increase")}
                >
                  <Icon name="plus" size={16} />
                  Increase
                </button>
                <button
                  className={`seg-item ${direction === "decrease" ? "seg-item-active" : ""}`}
                  aria-pressed={direction === "decrease"}
                  onClick={() => setDirection("decrease")}
                >
                  <Icon name="minus" size={16} />
                  Decrease
                </button>
              </div>
            </div>

            <label className="block">
              <span className="label">Location</span>
              <select
                className="input"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">Location…</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">Quantity ({item.unit})</span>
              <input
                className="input"
                type="number"
                inputMode="decimal"
                placeholder={`Qty (${item.unit})`}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </label>

            <label className="block">
              <span className="label">Reason</span>
              <select className="input" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="count_correction">Count correction</option>
                <option value="damaged">Damaged</option>
                <option value="lost">Lost</option>
                <option value="other">Other</option>
              </select>
            </label>

            <label className="block">
              <span className="label">Note (required)</span>
              <textarea
                className="input min-h-[80px] py-3"
                placeholder="What happened?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>

            <button className="btn-primary w-full" disabled={!valid} onClick={submit}>
              Record adjustment
            </button>
          </>
        )}
      </div>
    </Sheet>
  );
}
