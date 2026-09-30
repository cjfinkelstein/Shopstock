/* APEX Electrical Stock service worker.
 * App shell: cache-first / cache-on-navigate-fallback (unchanged from v1).
 * Data: a safelist of tech browse GETs (items, stock, jobs, etc.) is cached
 * stale-while-revalidate so Find / Trucks / an item's detail sheet still
 * work with no signal. Everything else under /api/ -- every write, and
 * admin GETs, which carry cost data -- always goes straight to the network
 * and is never cached. */
const SHELL_CACHE = "shopstock-shell-v2";
const DATA_CACHE = "shopstock-data-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

// Tech-only browse GETs it's safe to keep offline. Gated by role below --
// these same paths return cost-bearing schemas for an admin token.
const DATA_ALLOW_PATHS = [
  /^\/api\/v1\/items(\/.*)?$/, // /items, /items/:id, /items/:id/stock, /items/categories
  /^\/api\/v1\/locations$/,
  /^\/api\/v1\/stock$/, // exact -- excludes /stock/valuation (admin cost data)
  /^\/api\/v1\/dashboard\/tech$/,
  /^\/api\/v1\/jobs(\/recent)?$/,
  /^\/api\/v1\/transactions$/,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== DATA_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Sent on logout (and available for a shared-phone account switch) so the
// next person doesn't briefly see a previous tech's cached recently-used
// items or truck stock before the network response lands.
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_DATA_CACHE") {
    event.waitUntil(caches.delete(DATA_CACHE));
  }
});

/** Reads the `role` claim off the request's bearer JWT, unverified -- this
 * only gates what we're willing to cache client-side, not a security
 * boundary (the API already strips costs for techs server-side). */
function roleOf(request) {
  const auth = request.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  try {
    const payload = auth.slice(7).split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

function isOfflineBrowsable(request, url) {
  if (roleOf(request) !== "tech") return false;
  return DATA_ALLOW_PATHS.some((re) => re.test(url.pathname));
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone());
      return res;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  const res = await network;
  if (res) return res;
  return new Response(
    JSON.stringify({ detail: "You're offline and this hasn't been loaded yet." }),
    { status: 503, headers: { "Content-Type": "application/json" } },
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) {
    if (isOfflineBrowsable(event.request, url)) {
      event.respondWith(staleWhileRevalidate(event.request, event));
    }
    return; // everything else under /api/ always goes straight to the network
  }

  // SPA navigations: network first, fall back to cached shell
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }

  // Static assets: cache first (Vite hashes filenames, so stale entries are impossible)
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ||
        fetch(event.request).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});
