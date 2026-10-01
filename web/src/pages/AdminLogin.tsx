import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { publicApi } from "../api";
import { useAuth } from "../auth";
import Icon from "../components/Icon";
import Illustration from "../components/Illustration";
import { Spinner } from "../components/ui";
import { useToast } from "../toast";

export default function AdminLogin() {
  const { adminLogin } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"login" | "forgot" | "sent">("login");
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotBusy, setForgotBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminLogin(email, password);
      navigate("/admin");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Login failed");
    } finally {
      setBusy(false);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setForgotBusy(true);
    try {
      await publicApi("/auth/forgot-password", { method: "POST", body: { email: forgotEmail } });
      setMode("sent");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setForgotBusy(false);
    }
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-sm flex-col justify-center overflow-y-auto px-5 py-8 animate-fade-up md:max-w-md lg:max-w-lg">
      <div className="glow-backdrop" />

      <Illustration className="relative mx-auto mb-5 w-full max-w-[220px]" />

      <div className="card relative p-6 shadow-card-hover">
        {mode === "login" && (
          <>
            <div className="mb-6 text-center">
              <p className="page-eyebrow">Admin</p>
              <h1 className="mt-1 font-display text-[13px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Sign in to
              </h1>
              <img src="/logo.png" alt="APEX Electrical Group" className="mx-auto mt-1.5 h-auto w-full max-w-[220px]" />
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="admin-email" className="label">
                  Email
                </label>
                <div className="relative">
                  <Icon
                    name="mail"
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  />
                  <input
                    id="admin-email"
                    className="input pl-11"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="username"
                    required
                  />
                </div>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <label htmlFor="admin-password" className="label">
                    Password
                  </label>
                  <button
                    type="button"
                    className="text-[12.5px] font-semibold text-brand-600 hover:underline dark:text-brand-400"
                    onClick={() => {
                      setForgotEmail(email);
                      setMode("forgot");
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
                <div className="relative">
                  <Icon
                    name="lock"
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  />
                  <input
                    id="admin-password"
                    className="input pl-11"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    required
                  />
                </div>
              </div>
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? <Spinner /> : null}
                Sign in
                <Icon name="arrow-right" size={18} />
              </button>
            </form>
          </>
        )}

        {mode === "forgot" && (
          <>
            <div className="mb-6 text-center">
              <p className="page-eyebrow">Admin</p>
              <h1 className="mt-1 font-display text-[18px] font-bold tracking-tight">Reset your password</h1>
              <p className="mt-1.5 text-[13.5px] text-slate-500 dark:text-slate-400">
                Enter your admin email and we'll send you a link to set a new password.
              </p>
            </div>

            <form onSubmit={submitForgot} className="space-y-4">
              <div>
                <label htmlFor="forgot-email" className="label">
                  Email
                </label>
                <div className="relative">
                  <Icon
                    name="mail"
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  />
                  <input
                    id="forgot-email"
                    className="input pl-11"
                    type="email"
                    placeholder="you@company.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    autoComplete="username"
                    autoFocus
                    required
                  />
                </div>
              </div>
              <button className="btn-primary w-full" disabled={forgotBusy}>
                {forgotBusy ? <Spinner /> : null}
                Send reset link
              </button>
              <button type="button" className="btn-ghost w-full" onClick={() => setMode("login")}>
                <Icon name="arrow-left" size={16} />
                Back to sign in
              </button>
            </form>
          </>
        )}

        {mode === "sent" && (
          <div className="space-y-5 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <Icon name="mail" size={26} />
            </div>
            <div>
              <h1 className="font-display text-[18px] font-bold tracking-tight">Check your email</h1>
              <p className="mt-1.5 text-[13.5px] text-slate-500 dark:text-slate-400">
                If <span className="font-semibold">{forgotEmail}</span> has an admin account, a reset link is on
                its way. The link works once and expires in an hour.
              </p>
            </div>
            <button type="button" className="btn-secondary w-full" onClick={() => setMode("login")}>
              <Icon name="arrow-left" size={16} />
              Back to sign in
            </button>
          </div>
        )}
      </div>

      <Link to="/" className="btn-ghost relative mx-auto mt-5 text-sm">
        <Icon name="arrow-left" size={16} />
        Back to tap-in
      </Link>
    </div>
  );
}
