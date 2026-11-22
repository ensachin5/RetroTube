const CACHE_VERSION = "retrotube-v1";

const PRECACHE_URLS = [
  "/",
  "/history",
  "/offline",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fonts/Satoshi-Bold.woff2",
  "/fonts/Satoshi-Black.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      await Promise.all(
        PRECACHE_URLS.map(async (url) => {
          try {
            const response = await fetch(url, {
              cache: "no-cache",
              redirect: "manual",
            });
            if (response.ok && response.type !== "opaqueredirect") {
              await cache.put(url, response.clone());
            }
          } catch {
            // Skip individual optional precache failure
          }
        }),
      );
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== CACHE_VERSION)
          .map((oldKey) => caches.delete(oldKey)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_next/static/") ||
    pathname.startsWith("/fonts/") ||
    pathname.startsWith("/icons/") ||
    pathname === "/apple-touch-icon.png" ||
    pathname === "/favicon.ico" ||
    pathname === "/manifest.webmanifest"
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API calls, SSE streams, or media downloads
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request));
    return;
  }

  // Navigation: network-first with /offline fallback
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          if (
            networkResponse.ok &&
            !networkResponse.redirected &&
            !url.pathname.startsWith("/unlock")
          ) {
            const cache = await caches.open(CACHE_VERSION);
            cache.put(request, networkResponse.clone()).catch(() => undefined);
          }
          return networkResponse;
        } catch {
          const cached = await caches.match(request);
          if (cached) return cached;
          const offlineFallback = await caches.match("/offline");
          return (
            offlineFallback ||
            new Response("Offline — Tape not found.", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
          );
        }
      })(),
    );
    return;
  }

  // Static assets: stale-while-revalidate
  if (isStaticAsset(url.pathname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_VERSION);
        const cached = await cache.match(request);

        const networkFetch = fetch(request)
          .then((response) => {
            if (response.ok) {
              cache.put(request, response.clone()).catch(() => undefined);
            }
            return response;
          })
          .catch(() => null);

        if (cached) {
          event.waitUntil(networkFetch);
          return cached;
        }

        const fresh = await networkFetch;
        return fresh || new Response("", { status: 504, statusText: "Offline" });
      })(),
    );
  }
});
