import { useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { api } from "../api";
import { useAuth } from "../auth";
import { useCart } from "../cart";
import { useToast } from "../toast";
import Icon from "./Icon";
import Sheet from "./Sheet";
import { Avatar } from "./ui";

const LEFT_TABS = [
  { to: "/home", label: "Home", icon: "home" },
  { to: "/truck", label: "Trucks", icon: "truck" },
  { to: "/calendar", label: "Calendar", icon: "calendar" },
];

function Tab({
  to,
  label,
  icon,
  badge,
}: {
  to: string;
  label: string;
  icon: string;
  badge?: number;
}) {
  return (
    <NavLink
      to={to}
      aria-label={label}
      title={label}
      className={({ isActive }) =>
        `relative flex min-h-[60px] flex-1 flex-col items-center justify-center transition-colors ${
          isActive ? "text-brand-600 dark:text-brand-400" : "text-slate-400 dark:text-slate-500"
        }`
      }
    >
      {({ isActive }) => (
        <>
          <span className="relative">
            <Icon name={icon} size={24} strokeWidth={isActive ? 2.5 : 2} />
            {badge != null && badge > 0 && (
              <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-gradient-to-b from-brand-500 to-brand-600 px-1 text-[10px] font-bold text-white shadow-fab">
                {badge}
              </span>
            )}
          </span>
          <span
            className={`absolute bottom-2 h-1 w-1 rounded-full bg-brand-500 transition-opacity ${isActive ? "opacity-100" : "opacity-0"}`}
          />
        </>
      )}
    </NavLink>
  );
}

export default function TechLayout() {
  const { user, myTruck, logout } = useAuth();
  const { lines } = useCart();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const [changePinOpen, setChangePinOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [savingPin, setSavingPin] = useState(false);
  const onFind = location.pathname === "/search";

  const closeChangePin = () => {
    setChangePinOpen(false);
    setCurrentPin("");
    setNewPin("");
  };

  const submitChangePin = async () => {
    setSavingPin(true);
    try {
      await api("/auth/change-pin", { method: "POST", body: { current_pin: currentPin, new_pin: newPin } });
      toast("success", "PIN updated");
      closeChangePin();
    } catch (e) {
      toast("error", e instanceof Error ? e.message : "Could not update PIN");
    } finally {
      setSavingPin(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-lg flex-col md:max-w-2xl lg:max-w-3xl">
      <header className="glass sticky top-0 z-40 flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="APEX Electrical Group" className="h-9 w-auto" />
        </div>
        <button
          onClick={() => setAccountOpen(true)}
          aria-label={`Account — ${user?.name}`}
          className="rounded-full transition-transform active:scale-90"
        >
          <Avatar name={user?.name ?? "?"} index={user?.id ?? 0} size={36} />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-4 pb-32 pt-4">
        <Outlet />
      </main>

      {/* icon-only bottom nav — raised Find action in the middle */}
      <nav className="glass fixed inset-x-0 bottom-0 z-40 border-t pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-lg items-stretch md:max-w-2xl lg:max-w-3xl">
          {LEFT_TABS.map((t) => (
            <Tab key={t.to} {...t} />
          ))}
          <div className="relative flex min-w-[76px] flex-1 items-center justify-center">
            <button
              onClick={() => navigate("/search")}
              aria-label="Find material"
              title="Find material"
              className={`absolute -top-7 flex h-[58px] w-[58px] items-center justify-center rounded-full text-white shadow-fab transition-all duration-200 active:scale-90 ${
                onFind
                  ? "bg-gradient-to-b from-brand-600 to-brand-700 ring-4 ring-brand-500/25"
                  : "bg-gradient-to-b from-brand-500 to-brand-600"
              }`}
            >
              <Icon name="search" size={25} strokeWidth={2.3} />
            </button>
          </div>
          <Tab to="/cart" label="Cart" icon="cart" badge={lines.length} />
          <Tab to="/my-hours" label="Timesheet" icon="clock" />
        </div>
      </nav>

      {accountOpen && (
        <Sheet title="Account" onClose={() => setAccountOpen(false)}>
          <div className="flex items-center gap-3.5 pb-5">
            <Avatar name={user?.name ?? "?"} index={user?.id ?? 0} size={52} />
            <div className="min-w-0">
              <p className="truncate font-display text-[18px] font-extrabold">{user?.name}</p>
              <p className="text-[13px] text-slate-400">
                {user?.role === "admin" ? "Administrator" : "Field tech"}
                {myTruck ? ` · ${myTruck.truck_name}` : ""}
              </p>
            </div>
          </div>
          <div className="space-y-2.5 pb-2">
            {user?.role === "admin" && (
              <button
                className="btn-secondary w-full"
                onClick={() => {
                  setAccountOpen(false);
                  navigate("/admin");
                }}
              >
                <Icon name="chart" size={18} />
                Admin console
              </button>
            )}
            {user?.role === "tech" && (
              <>
                <button
                  className="btn-secondary w-full"
                  onClick={() => {
                    setAccountOpen(false);
                    navigate("/my-hours");
                  }}
                >
                  <Icon name="clock" size={18} />
                  My Hours
                </button>
                <button
                  className="btn-secondary w-full"
                  onClick={() => {
                    setAccountOpen(false);
                    navigate("/calendar");
                  }}
                >
                  <Icon name="calendar" size={18} />
                  Team Calendar
                </button>
                <button
                  className="btn-secondary w-full"
                  onClick={() => {
                    setAccountOpen(false);
                    setChangePinOpen(true);
                  }}
                >
                  <Icon name="keypad" size={18} />
                  Change PIN
                </button>
              </>
            )}
            <button className="btn-secondary w-full" onClick={logout}>
              <Icon name="logout" size={18} />
              Sign out
            </button>
          </div>
        </Sheet>
      )}

      {changePinOpen && (
        <Sheet title="Change PIN" subtitle="4-digit code used to tap in" onClose={closeChangePin}>
          <div className="space-y-4">
            <label className="block">
              <span className="label">Current PIN</span>
              <input
                className="input text-center text-2xl font-bold tracking-[0.5em]"
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                autoFocus
                value={currentPin}
                onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
            <label className="block">
              <span className="label">New PIN</span>
              <input
                className="input text-center text-2xl font-bold tracking-[0.5em]"
                inputMode="numeric"
                maxLength={4}
                placeholder="0000"
                value={newPin}
                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
              />
            </label>
            <button
              className="btn-primary w-full"
              disabled={savingPin || !/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(newPin)}
              onClick={submitChangePin}
            >
              Save PIN
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
