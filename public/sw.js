/*
 * TownMart service worker: keeps the shop usable on slow or dropped networks.
 *
 * What it keeps on the phone:
 *  - App files (scripts, styles, fonts, icons): cache first. Their names change
 *    with every release, so a saved copy is never out of date.
 *  - Product and shop images: shown from the phone, refreshed in the background.
 *  - Public shop pages (home, search, categories, products, shops, deals, help,
 *    legal) and the cart: the network first; if it fails, or is slower than
 *    PAGE_TIMEOUT_MS, the copy saved on the last visit, with a banner saying so.
 *
 * What it never keeps or answers from the phone:
 *  - Checkout, payment, orders, account, seller dashboard, admin, sign-in,
 *    and every /api call except public images. Those always go to TownMart, so
 *    payments, stock and prices are only ever decided by the server.
 *  - Anything that is not a GET.
 *
 * Saved pages are wiped when someone visits sign-in or sign-up, or signs out
 * (the page asks with a "clear-pages" message), so one person's cart is not
 * shown to the next person on a shared phone.
 */
const VERSION = "v1";
const STATIC_CACHE = `tm-static-${VERSION}`;
const IMAGE_CACHE = `tm-images-${VERSION}`;
const PAGE_CACHE = `tm-pages-${VERSION}`;
const PAGE_TIMEOUT_MS = 6000;
const MAX_PAGES = 60;
const MAX_IMAGES = 200;
const MAX_STATIC = 400; // Old releases' files drop off as new ones arrive.
const PAGE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const SAVED_AT = "x-tm-saved-at";

/** Public pages a shopper may want to see again without a connection. */
const SAVEABLE_PAGE = /^\/($|search|c\/|p\/|s\/|store\/|deals|about|help|legal|contact|cart$)/;
/** Never answered from the phone, whatever else matches. */
const NEVER = /^\/(checkout|orders|account|dashboard|admin|auth|api\/(?!storage\/public\/)|print|invite|test-access|test-inbox|unsubscribe|rate\/)/;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC_CACHE, IMAGE_CACHE, PAGE_CACHE];
      for (const name of await caches.keys()) if (name.startsWith("tm-") && !keep.includes(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

/** Pages served from the phone, by the window they opened in: answers the page's "page-status" question. */
const savedCopies = new Map();

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "clear-pages") {
    event.waitUntil(caches.delete(PAGE_CACHE));
  } else if (data.type === "page-status" && event.source) {
    const savedAt = savedCopies.get(event.source.id) || null;
    savedCopies.delete(event.source.id);
    event.source.postMessage({ type: "page-status", savedAt });
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith("/_next/static/") || path.startsWith("/brand/") || path === "/icon.svg" || path === "/favicon.ico" || path === "/apple-icon.png") {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }
  if (path === "/_next/image" || path.startsWith("/api/storage/public/")) {
    event.respondWith(staleWhileRevalidate(event, IMAGE_CACHE, MAX_IMAGES));
    return;
  }
  if (req.mode !== "navigate") return; // Page data for in-app navigation goes straight to the network.

  if (path.startsWith("/auth/")) {
    // Signing in or up as someone else: forget the last person's saved pages.
    event.waitUntil(caches.delete(PAGE_CACHE));
    return;
  }
  if (NEVER.test(path)) {
    event.respondWith(fetch(req).catch(() => offlinePage()));
    return;
  }
  if (SAVEABLE_PAGE.test(path)) {
    event.respondWith(networkFirstPage(event));
    return;
  }
  event.respondWith(fetch(req).catch(() => offlinePage()));
});

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === "basic") cache.put(req, res.clone()).then(() => trim(cacheName, MAX_STATIC));
  return res;
}

async function staleWhileRevalidate(event, cacheName, max) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request);
  const refresh = fetch(event.request)
    .then(async (res) => {
      if (res.ok && res.type === "basic") {
        await cache.put(event.request, res.clone());
        await trim(cacheName, max);
      }
      return res;
    })
    .catch(() => null);
  if (hit) {
    event.waitUntil(refresh);
    return hit;
  }
  return (await refresh) || new Response("", { status: 504, statusText: "Offline" });
}

/**
 * The network first, for fresh prices and stock. On a slow line, a saved copy
 * is shown after PAGE_TIMEOUT_MS while the network answer still updates the
 * saved copy for next time.
 */
async function networkFirstPage(event) {
  const req = event.request;
  const cache = await caches.open(PAGE_CACHE);
  const key = pageKey(req);
  const network = fetch(req).then(async (res) => {
    // Only whole, successful pages; a redirect (for example to sign in) is never saved.
    if (res.ok && res.type === "basic" && !res.redirected) await cache.put(key, await stamp(res.clone()));
    trim(PAGE_CACHE, MAX_PAGES);
    return res;
  });
  network.catch(() => {});

  const saved = async () => {
    const hit = await cache.match(key);
    if (!hit) return null;
    const savedAt = Number(hit.headers.get(SAVED_AT)) || 0;
    if (Date.now() - savedAt > PAGE_MAX_AGE_MS) return null;
    if (event.resultingClientId) savedCopies.set(event.resultingClientId, savedAt);
    return hit;
  };

  let timer;
  const slow = new Promise((resolve) => {
    timer = setTimeout(() => resolve("slow"), PAGE_TIMEOUT_MS);
  });
  try {
    const first = await Promise.race([network, slow]);
    if (first !== "slow") return first;
    const hit = await saved();
    if (hit) {
      event.waitUntil(network.catch(() => {}));
      return hit;
    }
    return await network;
  } catch {
    return (await saved()) || offlinePage();
  } finally {
    clearTimeout(timer);
  }
}

/** One saved copy per page: tracking parameters don't make a new copy. */
function pageKey(req) {
  const url = new URL(req.url);
  for (const p of [...url.searchParams.keys()]) if (p.startsWith("utm_") || p === "fbclid" || p === "gclid") url.searchParams.delete(p);
  return url.toString();
}

/**
 * Shown when a page isn't saved and there is no connection. Plain HTML with
 * no scripts: a Next.js page here would try to start up under the wrong
 * address and fail.
 */
function offlinePage() {
  const html = `<!doctype html><html lang="en-NG"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#0F6B3E"><title>You're offline · TownMart</title>
<style>body{margin:0;font-family:system-ui,-apple-system,Roboto,"Segoe UI",Arial,sans-serif;color:#0f172a;background:#f8faf8;display:grid;min-height:100dvh;place-items:center;text-align:center}main{max-width:26rem;padding:2rem 1.5rem}img{height:36px;width:auto}h1{font-size:1.5rem;margin:1.5rem 0 .5rem}p{color:#475569;line-height:1.5;margin:0 0 1.5rem}a{display:inline-block;margin:.25rem;padding:.7rem 1.2rem;border-radius:.8rem;border:1px solid #cbd5e1;color:#0f172a;font-weight:600;text-decoration:none}a.go{background:#0F6B3E;border-color:#0F6B3E;color:#fff}@media(prefers-color-scheme:dark){body{background:#0b1210;color:#e2e8f0}p{color:#94a3b8}a{color:#e2e8f0;border-color:#334155}}</style></head>
<body><main><img src="/brand/townmart-logo.svg" alt="TownMart"><h1>You're offline</h1><p>This page isn't saved on your phone yet. Pages you've opened before, and your cart, still work without a connection.</p><a class="go" href="">Try again</a><a href="/">Home</a><a href="/cart">Your cart</a></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/** A copy of the response with the time it was saved, so old copies can be labelled and dropped. */
async function stamp(res) {
  const headers = new Headers(res.headers);
  headers.set(SAVED_AT, String(Date.now()));
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers });
}

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
