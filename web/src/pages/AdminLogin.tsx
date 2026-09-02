import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

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

  return (
    <div className="relative mx-auto flex h-full w-full max-w-sm flex-col justify-center overflow-y-auto px-5 py-8 animate-fade-up md:max-w-md lg:max-w-lg">
      <div className="glow-backdrop" />

      <Illustration className="relative mx-auto mb-5 w-full max-w-[220px]" />

      <div className="card relative p-6 shadow-card-hover">
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
            <label htmlFor="admin-password" className="label">
              Password
            </label>
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
      </div>

      <Link to="/" className="btn-ghost relative mx-auto mt-5 text-sm">
        <Icon name="arrow-left" size={16} />
        Back to tap-in
      </Link>
    </div>
  );
}
