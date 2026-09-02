import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { useAuth } from "../../auth";
import Icon from "../../components/Icon";
import Sheet from "../../components/Sheet";
import { Avatar } from "../../components/ui";

const links = [
  { to: "/admin", label: "Dashboard", icon: "chart", end: true },
  { to: "/admin/items", label: "Items", icon: "package" },
  { to: "/admin/receive", label: "Receive", icon: "inbox" },
  { to: "/admin/jobs", label: "Jobs", icon: "briefcase" },
  { to: "/admin/estimates", label: "Estimates", icon: "clipboard-list" },
  { to: "/admin/trucks", label: "Trucks", icon: "truck" },
  { to: "/admin/calendar", label: "Login Hours", icon: "map-pin" },
  { to: "/admin/reports", label: "Reports", icon: "file-text" },
  { to: "/admin/settings", label: "Settings", icon: "settings" },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [accountOpen, setAccountOpen] = useState(false);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-slate-200/70 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900 md:flex">
        <div className="mb-8 px-2 pt-1">
          <img src="/logo.png" alt="APEX Electrical Group" className="h-10 w-auto" />
          <span className="mt-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 dark:text-slate-500">
            Admin console
          </span>
        </div>
        <nav className="space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) =>
                `relative flex min-h-[44px] items-center gap-3 rounded-xl px-3.5 text-[14px] font-semibold transition-colors ${
                  isActive
                    ? "font-display bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                    : "text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/60 dark:hover:text-slate-200"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-full bg-brand-500" />
                  )}
                  <Icon name={l.icon} size={19} strokeWidth={isActive ? 2.2 : 2} />
                  {l.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto pt-4">
          <button
            onClick={() => setAccountOpen(true)}
            aria-label={`Account — ${user?.name ?? "Admin"}`}
            className="flex w-full items-center gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 p-3 text-left transition-all duration-150 hover:bg-slate-100/80 active:scale-[0.98] dark:border-slate-800 dark:bg-slate-800/50 dark:hover:bg-slate-800/80"
          >
            <Avatar name={user?.name ?? "Admin"} index={user?.id ?? 0} size={38} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-bold text-slate-900 dark:text-slate-100">
                {user?.name ?? "Admin"}
              </span>
              <span className="block text-[12px] font-medium text-slate-400 dark:text-slate-500">
                Administrator
              </span>
            </span>
            <Icon name="chevron-right" size={16} className="shrink-0 text-slate-300 dark:text-slate-600" />
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="glass flex items-center justify-between border-b px-4 py-2.5 md:hidden">
        <div className="flex min-w-0 items-center gap-2">
          <img src="/logo.png" alt="APEX Electrical Group" className="h-8 w-auto" />
          <span className="truncate text-[13px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Admin
          </span>
        </div>
        <button
          onClick={() => setAccountOpen(true)}
          aria-label={`Account — ${user?.name ?? "Admin"}`}
          className="shrink-0 rounded-full transition-transform active:scale-90"
        >
          <Avatar name={user?.name ?? "Admin"} index={user?.id ?? 0} size={36} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <main className="mx-auto max-w-6xl p-4 pb-24 md:p-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile bottom nav — icon-only */}
      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="flex items-stretch">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              aria-label={l.label}
              className={({ isActive }) =>
                `relative flex min-h-[60px] min-w-[48px] flex-1 flex-col items-center justify-center transition-colors ${
                  isActive
                    ? "text-brand-600 dark:text-brand-400"
                    : "text-slate-400 dark:text-slate-500"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon name={l.icon} size={24} strokeWidth={isActive ? 2.5 : 2} />
                  <span
                    className={`absolute bottom-2 h-1 w-1 rounded-full bg-brand-500 transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>

      {accountOpen && (
        <Sheet title="Account" onClose={() => setAccountOpen(false)}>
          <div className="flex items-center gap-3.5 pb-5">
            <Avatar name={user?.name ?? "Admin"} index={user?.id ?? 0} size={52} />
            <div className="min-w-0">
              <p className="truncate font-display text-[18px] font-extrabold">{user?.name}</p>
              <p className="text-[13px] text-slate-400">Administrator</p>
            </div>
          </div>
          <div className="space-y-2.5 pb-2">
            <button
              className="btn-secondary w-full"
              onClick={() => {
                setAccountOpen(false);
                navigate("/home");
              }}
            >
              <Icon name="search" size={18} />
              Tech view
            </button>
            <button className="btn-secondary w-full" onClick={logout}>
              <Icon name="logout" size={18} />
              Sign out
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
