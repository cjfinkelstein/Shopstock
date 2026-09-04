import "@fontsource-variable/inter";
import "@fontsource-variable/nunito";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./auth";
import { CartProvider } from "./cart";
import { ClockProvider } from "./clock";
import "./index.css";
import { ToastProvider } from "./toast";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <ClockProvider>
            <CartProvider>
              <App />
            </CartProvider>
          </ClockProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);

// PWA: app-shell caching only (no offline data sync in v1)
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // A tab left open across a deploy never re-registers on its own --
        // poll for a newer service worker so an already-open app notices a
        // new release within minutes instead of only on next manual reopen.
        setInterval(() => reg.update().catch(() => {}), 5 * 60 * 1000);
      })
      .catch(() => {});
  });

  // Once the new service worker takes over, the page it's controlling is
  // still running the old JS bundle from memory -- reload once so the tab
  // actually picks up the new code instead of silently staying stale.
  let reloadedForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadedForUpdate) return;
    reloadedForUpdate = true;
    window.location.reload();
  });
}
