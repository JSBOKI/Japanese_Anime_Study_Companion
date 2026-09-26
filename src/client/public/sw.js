const SHELL = "yomu-shell-v1";
const OFFLINE = "yomu-offline-v1";
const SHELL_FILES = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-maskable.png",
  "/icons/apple-touch-icon.png",
  "/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== SHELL && key !== OFFLINE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

function isLesson(pathname) {
  return /^\/api\/episodes\/\d+$/.test(pathname);
}

function isDrill(pathname) {
  return /^\/api\/episodes\/\d+\/audio\/(dialogue|vocab)$/.test(pathname);
}

async function ranged(response, request) {
  const header = request.headers.get("range");
  if (!header || response.status !== 200) return response;
  const buf = await response.arrayBuffer();
  const match = /bytes=(\d+)-(\d*)/.exec(header);
  if (!match) return response;
  let start = Number(match[1]);
  let end = match[2] ? Number(match[2]) : buf.byteLength - 1;
  if (!Number.isFinite(start) || start >= buf.byteLength || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${buf.byteLength}` },
    });
  }
  end = Math.min(end, buf.byteLength - 1);
  const slice = buf.slice(start, end + 1);
  const headers = new Headers(response.headers);
  headers.set("Content-Type", headers.get("Content-Type") || "audio/mpeg");
  headers.set("Content-Range", `bytes ${start}-${end}/${buf.byteLength}`);
  headers.set("Content-Length", String(slice.byteLength));
  headers.set("Accept-Ranges", "bytes");
  return new Response(slice, { status: 206, statusText: "Partial Content", headers });
}

async function serveDrill(request) {
  const cache = await caches.open(OFFLINE);
  try {
    const response = await fetch(request);
    if (response.status === 200) await cache.put(request.url, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request.url);
    if (!cached) throw new Error("offline");
    return ranged(cached, request);
  }
}

async function networkFirst(request) {
  const cache = await caches.open(OFFLINE);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: "You are offline, and this lesson is not saved on this phone." }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function serveShell(request) {
  const cache = await caches.open(SHELL);
  const url = new URL(request.url);
  const asset =
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.endsWith(".webmanifest") ||
    url.pathname.endsWith(".png");
  if (asset) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  }
  try {
    const response = await fetch(request);
    if (response.ok && (request.mode === "navigate" || url.pathname === "/")) {
      cache.put("/", response.clone());
    }
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match("/"));
    if (cached) return cached;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isDrill(url.pathname)) {
    event.respondWith(serveDrill(request));
    return;
  }
  if (isLesson(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(serveShell(request));
});
