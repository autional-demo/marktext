/* MarkText Web service worker
 *
 * 缓存策略矩阵：
 *   应用壳（/、/login、图标、清单）  install 预缓存，离线可直接打开
 *   /_next/static/*                 cache-first（内容哈希，天然不可变）
 *   /icons/*、/icon.svg、字体等静态  stale-while-revalidate（先给旧的，后台更新）
 *   页面导航（HTML）                 network-first + 4s 超时回退缓存
 *   页面内 RSC 数据（? _rsc）        network-first，离线回退缓存
 *   /api、/bff、/oauth              完全不拦截：用户数据不进缓存、不卡旧版本
 *
 * 版本：以 Next 构建 ID 为准（静态页面 HTML 里的 <!--buildId--> 注释）。
 * 发现新构建就刷新壳预缓存；带哈希的静态资源跨版本继续复用，只有变了的
 * chunk 才会重新下载。VERSION 只在需要「强制清空所有缓存」时手动加一。
 *
 * 更新：新 worker 不自动 skipWaiting，等页面 postMessage 后再激活，
 * 避免「页面跑旧 JS、缓存是新版本」的错配。
 */

const VERSION = "v3";
const CACHE_PREFIX = "marktext";
const PRECACHE = `${CACHE_PREFIX}-precache-${VERSION}`;
const STATIC_CACHE = `${CACHE_PREFIX}-static-${VERSION}`;
const PAGE_CACHE = `${CACHE_PREFIX}-pages-${VERSION}`;
const META_CACHE = `${CACHE_PREFIX}-meta-${VERSION}`;

/** 应用壳：装完即可离线打开。单个失败不影响整体安装。 */
const SHELL = [
  "/",
  "/login",
  "/offline.html",
  "/manifest.webmanifest",
  "/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

/** 网络优先的等待上限；超时就用缓存，别让弱网白屏。 */
const NAV_TIMEOUT = 4000;

/** 静态缓存条目软上限，跨版本复用后清理过老的 chunk。 */
const STATIC_MAX_ENTRIES = 500;

/** Next 会把构建 ID 写在静态页面 HTML 开头的注释里。 */
const BUILD_ID_PATTERN = /<!--([A-Za-z0-9_-]{8,})-->/;
const BUILD_KEY = "/__marktext-build";

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE, STATIC_CACHE, PAGE_CACHE, META_CACHE]);
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith(CACHE_PREFIX) && !keep.has(key))
          .map((key) => caches.delete(key)),
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

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 用户数据与身份相关：一律走网络，不缓存、不回退缓存
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/bff/") ||
    url.pathname.startsWith("/oauth/") ||
    url.pathname === "/sw.js"
  ) {
    return;
  }

  // 构建产物：带内容哈希，命中即用
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // 图标 / 清单 / 字体等：先给缓存，后台悄悄更新
  if (
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/_next/image") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".woff2") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(staleWhileRevalidate(req, STATIC_CACHE, event));
    return;
  }

  if (req.mode === "navigate") {
    event.respondWith(navigateNetworkFirst(req, event));
    return;
  }

  // App Router 客户端导航（RSC 载荷）：离线时回退缓存过的同路径页面
  if (req.headers.get("RSC") === "1" || url.searchParams.has("_rsc")) {
    event.respondWith(rscNetworkFirst(req));
  }
});

/* ---------------- 应用壳与版本 ---------------- */

async function precacheShell() {
  // 先取首页：它带着当前构建 ID，顺手记下来
  let build = null;
  try {
    const home = await fetch(new Request("/", { cache: "reload" }));
    if (home.ok) {
      build = extractBuildId(await home.clone().text());
      const cache = await caches.open(PRECACHE);
      await cache.put("/", home);
    }
  } catch {
    /* 离线安装：壳会缺首页，但离线页仍可用 */
  }

  if (build) await writeBuildId(build);

  const cache = await caches.open(PRECACHE);
  await Promise.all(
    SHELL.filter((url) => url !== "/").map(async (url) => {
      try {
        const res = await fetch(new Request(url, { cache: "reload" }));
        if (res.ok) await cache.put(url, res);
      } catch {
        /* 单个资源失败不影响其余预缓存 */
      }
    }),
  );
}

function extractBuildId(text) {
  const match = text.match(BUILD_ID_PATTERN);
  return match ? match[1] : null;
}

/** 导航拿到新 HTML 时调用：构建变了就重建壳预缓存。 */
async function detectBuild(res) {
  try {
    const build = extractBuildId(await res.clone().text());
    if (!build) return;
    if ((await readBuildId()) === build) return;

    await writeBuildId(build);
    // 壳变了：重建预缓存；静态 chunk 按内容哈希保留，避免整站重下
    await caches.delete(PRECACHE);
    await precacheShell();
    await pruneCache(STATIC_CACHE, STATIC_MAX_ENTRIES);
  } catch {
    /* 检测失败不影响正常响应 */
  }
}

async function readBuildId() {
  const cache = await caches.open(META_CACHE);
  const res = await cache.match(BUILD_KEY);
  return res ? await res.text() : null;
}

async function writeBuildId(build) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    BUILD_KEY,
    new Response(build, { headers: { "content-type": "text/plain" } }),
  );
}

async function pruneCache(cacheName, maxEntries) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    for (const key of keys.slice(0, keys.length - maxEntries)) {
      await cache.delete(key);
    }
  } catch {
    /* 清理失败不影响使用 */
  }
}

/* ---------------- 策略实现 ---------------- */

function isCacheable(res) {
  return res && res.ok && !res.redirected && res.type === "basic";
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;

  const res = await fetch(req);
  if (isCacheable(res)) await cache.put(req, res.clone());
  return res;
}

async function staleWhileRevalidate(req, cacheName, event) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req, { ignoreSearch: true });

  const network = fetch(req)
    .then(async (res) => {
      if (isCacheable(res)) await cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);

  // 命中缓存时后台更新不能随响应返回而中断
  if (event && typeof event.waitUntil === "function") {
    event.waitUntil(network.then(() => undefined));
  }

  if (hit) return hit;

  const res = await network;
  if (res) return res;
  throw new Error("网络不可用且无缓存");
}

function fetchWithTimeout(req, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(req, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** 导航：网络优先（带超时），失败依次回退「本页缓存 → 壳 → 离线页」。 */
async function navigateNetworkFirst(req, event) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const res = await fetchWithTimeout(req, NAV_TIMEOUT);
    if (isCacheable(res)) {
      await cache.put(req, res.clone());
      // 顺手检查部署版本（静态页 HTML 里带构建 ID）
      const detect = detectBuild(res);
      if (event && typeof event.waitUntil === "function") event.waitUntil(detect);
      else void detect;
    }
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;

    const precache = await caches.open(PRECACHE);
    const shell = await precache.match("/");
    if (shell) return shell;

    const offline = await precache.match("/offline.html");
    if (offline) return offline;

    return new Response("离线且没有可用缓存", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
}

/** RSC：离线时返回缓存过的页面 HTML 会污染渲染树，所以只回退同路径缓存，否则明确失败。 */
async function rscNetworkFirst(req) {
  const cache = await caches.open(PAGE_CACHE);

  try {
    const res = await fetchWithTimeout(req, NAV_TIMEOUT);
    if (isCacheable(res)) await cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    return new Response(JSON.stringify({ error: "offline" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }
}
