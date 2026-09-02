import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";

import { api } from "../../api";
import { catTint } from "../../catcolor";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Avatar, Empty } from "../../components/ui";
import { useToast } from "../../toast";
import type { Truck, User, Vendor } from "../../types";

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
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [addKind, setAddKind] = useState<AddKind | null>(null);
  const [addName, setAddName] = useState("");

  const load = useCallback(() => {
    api<User[]>("/users?include_inactive=true").then(setUsers).catch(() => {});
    api<Truck[]>("/trucks?include_inactive=true").then(setTrucks).catch(() => {});
    api<Vendor[]>("/vendors?include_inactive=true").then(setVendors).catch(() => {});
    api<string[]>("/items/categories").then(setCategories).catch(() => {});
  }, []);

  useEffect(load, [load]);

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
