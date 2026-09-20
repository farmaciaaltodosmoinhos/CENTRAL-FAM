/**
 * sw.js — cache do "app shell" para carregamentos instantâneos em visitas
 * repetidas e alguma tolerância offline. Estratégia:
 *   - HTML: network-first (garante conteúdo atualizado quando há rede,
 *     cai para a cópia em cache quando offline).
 *   - CSS/JS/ícones: stale-while-revalidate (serve imediatamente do cache
 *     e atualiza em segundo plano para a próxima visita).
 *
 * Sobe a versão de CACHE_VERSION sempre que o conteúdo de assets/ ou src/
 * mudar substancialmente, para invalidar caches antigas.
 */
const CACHE_VERSION = "central-farmacia-v4.0.0";
const APP_SHELL = [
  "./",
  "./index.html",
  "./assets/styles.css",
  "./assets/dev-logo.png",
  "./src/app.js",
  "./src/store.js",
  "./src/db.js",
  "./src/actions.js",
  "./src/events.js",
  "./src/utils.js",
  "./src/icons.js",
  "./src/domain.js",
  "./src/vdom.js",
  "./src/ui/sidebar.js",
  "./src/ui/main-content.js",
  "./src/ui/toast.js",
  "./src/ui/palette.js",
  "./src/ui/modals.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || !req.url.startsWith(self.location.origin)) return;

  // A API do estado partilhado nunca passa pelo cache do service worker —
  // tem de ir sempre à rede, senão os computadores "veem" dados antigos.
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/.netlify/functions/")) return;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req).then((res) => {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((cache) => cache.put(req, clone));
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match("./index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
