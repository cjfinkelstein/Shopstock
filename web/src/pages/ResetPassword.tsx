import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { useAuth } from "../auth";
import Icon from "../components/Icon";
import Illustration from "../components/Illustration";
import { Spinner } from "../components/ui";
import { useToast } from "../toast";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const { resetPassword } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast("error", "Passwords don't match");
      return;
    }
    if (newPassword.length < 8) {
      toast("error", "Password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await resetPassword(token, newPassword);
      toast("success", "Password updated");
      navigate("/admin");
    } catch (err) {
      toast("error", err instanceof Error ? err.message : "Couldn't reset password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-sm flex-col justify-center overflow-y-auto px-5 py-8 animate-fade-up md:max-w-md lg:max-w-lg">
      <div className="glow-backdrop" />

      <Illustration className="relative mx-auto mb-5 w-full max-w-[220px]" />

      <div className="card relative p-6 shadow-card-hover">
        {!token ? (
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-400">
              <Icon name="alert-triangle" size={26} />
            </div>
            <h1 className="font-display text-[18px] font-bold tracking-tight">Missing reset link</h1>
            <p className="text-[13.5px] text-slate-500 dark:text-slate-400">
              This page needs the link from your password-reset email. Request a new one from the admin sign-in
              page.
            </p>
          </div>
        ) : (
          <>
            <div className="mb-6 text-center">
              <p className="page-eyebrow">Admin</p>
              <h1 className="mt-1 font-display text-[18px] font-bold tracking-tight">Set a new password</h1>
              <img src="/logo.png" alt="APEX Electrical Group" className="mx-auto mt-2 h-auto w-full max-w-[180px]" />
            </div>

            <form onSubmit={submit} className="space-y-4">
              <div>
                <label htmlFor="new-password" className="label">
                  New password
                </label>
                <div className="relative">
                  <Icon
                    name="lock"
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  />
                  <input
                    id="new-password"
                    className="input pl-11"
                    type="password"
                    placeholder="At least 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    autoComplete="new-password"
                    autoFocus
                    required
                  />
                </div>
              </div>
              <div>
                <label htmlFor="confirm-password" className="label">
                  Confirm password
                </label>
                <div className="relative">
                  <Icon
                    name="lock"
                    size={18}
                    className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 dark:text-slate-500"
                  />
                  <input
                    id="confirm-password"
                    className="input pl-11"
                    type="password"
                    placeholder="Type it again"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                </div>
              </div>
              <button className="btn-primary w-full" disabled={busy}>
                {busy ? <Spinner /> : null}
                Set new password
                <Icon name="arrow-right" size={18} />
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
