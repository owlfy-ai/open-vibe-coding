const ROUTE_PREFIX = "published/routes";
const DEFAULT_APP_HOST = "app.qidea.ai";
const ROOT_APP_NAME = "__root__";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = normalizeHost(url.hostname);

    if (isMainSiteHost(host)) {
      return env.ASSETS.fetch(request);
    }

    return handlePublishedApp(request, env, host, url);
  },
};

async function handlePublishedApp(request, env, host, url) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return textResponse("Method not allowed", 405);
  }

  const candidates = routeCandidates(host, url.pathname, request.headers.get("referer"));
  if (candidates.length === 0) {
    return textResponse("Not found", 404);
  }

  for (const candidate of candidates) {
    const manifest = await readManifest(env.PUBLISHED_ASSETS, host, candidate.appName);
    if (!manifest || !manifest.rootPrefix) continue;

    const response = await readAsset(env.PUBLISHED_ASSETS, manifest, candidate, request.method);
    if (response) return response;
  }

  return textResponse("Not found", 404);
}

async function readManifest(bucket, host, appName) {
  const key = `${ROUTE_PREFIX}/${host}/${appName}/manifest.json`;
  const object = await bucket.get(key);
  if (!object) return null;

  try {
    return await object.json();
  } catch {
    return null;
  }
}

async function readAsset(bucket, manifest, candidate, method) {
  const assetPath = normalizeAssetPath(candidate.assetPath);
  const object = await bucket.get(`${manifest.rootPrefix}/${assetPath}`);
  if (object) return responseForAsset(object, assetPath, method, candidate.mountPrefix);

  if (!shouldFallbackToIndex(assetPath)) {
    return null;
  }

  const fallback = await bucket.get(`${manifest.rootPrefix}/index.html`);
  if (!fallback) return null;
  return responseForAsset(fallback, "index.html", method, candidate.mountPrefix);
}

function routeCandidates(host, pathname, referer) {
  const segments = pathSegments(pathname);
  const refererAppName = appNameFromReferer(host, referer);

  if (host === DEFAULT_APP_HOST) {
    if (segments.length === 0) {
      return refererAppName ? [routeCandidate(refererAppName, "index.html")] : [];
    }
    const candidates = [
      routeCandidate(segments[0], segments.slice(1).join("/") || "index.html"),
    ];
    if (refererAppName && refererAppName !== segments[0]) {
      candidates.push(routeCandidate(refererAppName, segments.join("/")));
    }
    return candidates;
  }

  if (!isQideaSubdomain(host)) return [];

  if (segments.length === 0) {
    return [
      {
        appName: ROOT_APP_NAME,
        assetPath: "index.html",
        mountPrefix: "",
      },
    ];
  }

  const candidates = [];
  if (refererAppName && refererAppName !== segments[0]) {
    candidates.push(routeCandidate(refererAppName, segments.join("/")));
  }
  candidates.push(routeCandidate(segments[0], segments.slice(1).join("/") || "index.html"));
  candidates.push({ appName: ROOT_APP_NAME, assetPath: segments.join("/"), mountPrefix: "" });
  return candidates;
}

function routeCandidate(appName, assetPath) {
  return {
    appName,
    assetPath,
    mountPrefix: appName === ROOT_APP_NAME ? "" : `/${encodePathSegment(appName)}`,
  };
}

function pathSegments(pathname) {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => safeDecode(segment))
    .filter((segment) => segment && segment !== "." && segment !== ".." && !segment.includes("\\"));
}

function normalizeAssetPath(assetPath) {
  const clean = String(assetPath || "")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== ".." && !segment.includes("\\"))
    .join("/");

  if (!clean || clean.endsWith("/")) return `${clean}index.html`;
  return clean;
}

function shouldFallbackToIndex(assetPath) {
  const lastSegment = assetPath.split("/").pop() || "";
  if (assetPath.endsWith("index.html")) return true;
  return !lastSegment.includes(".");
}

async function responseForAsset(object, assetPath, method, mountPrefix = "") {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("x-qidea-worker", "publish");
  headers.set("access-control-allow-origin", "*");

  if (!headers.has("content-type")) {
    headers.set("content-type", contentType(assetPath));
  }

  if (assetPath.endsWith(".html")) {
    headers.set("cache-control", "no-cache");
  } else {
    headers.set("cache-control", "public, max-age=31536000, immutable");
  }

  if (assetPath.endsWith(".html") && mountPrefix) {
    const html = method === "HEAD" ? null : rewriteHtmlAssetPaths(await object.text(), mountPrefix);
    headers.delete("content-length");
    return new Response(html, { headers });
  }

  return new Response(method === "HEAD" ? null : object.body, { headers });
}

function textResponse(message, status) {
  return new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-qidea-worker": "publish",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

function isMainSiteHost(host) {
  return host === "qidea.ai" || host === "www.qidea.ai";
}

function normalizeHost(hostname) {
  return String(hostname || "").toLowerCase().replace(/:\d+$/, "");
}

function appNameFromReferer(host, referer) {
  if (!referer) return "";
  try {
    const url = new URL(referer);
    if (normalizeHost(url.hostname) !== host) return "";
    const segments = pathSegments(url.pathname);
    if (segments.length === 0) return "";
    if (host === DEFAULT_APP_HOST) return segments[0];
    return segments[0] === "assets" ? "" : segments[0];
  } catch {
    return "";
  }
}

function isQideaSubdomain(host) {
  return host.endsWith(".qidea.ai") && host !== "qidea.ai" && host !== "www.qidea.ai";
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodePathSegment(value) {
  return encodeURIComponent(value).replace(/%2F/gi, "");
}

function rewriteHtmlAssetPaths(html, mountPrefix) {
  return html
    .replaceAll('="/assets/', `="${mountPrefix}/assets/`)
    .replaceAll("='/assets/", `='${mountPrefix}/assets/`)
    .replaceAll('="/favicon', `="${mountPrefix}/favicon`)
    .replaceAll("='/favicon", `='${mountPrefix}/favicon`);
}

function contentType(assetPath) {
  const lower = assetPath.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".ico")) return "image/x-icon";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".woff")) return "font/woff";
  if (lower.endsWith(".woff2")) return "font/woff2";
  if (lower.endsWith(".ttf")) return "font/ttf";
  if (lower.endsWith(".wasm")) return "application/wasm";
  return "application/octet-stream";
}
