import { unzipSync, zipSync } from "fflate";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const remoteUrl = url.searchParams.get("url");
    const name = url.searchParams.get("name") || "Package";

    if (!remoteUrl) {
      return new Response("Missing ?url", { status: 400 });
    }

    // Use Cloudflare edge cache
    const cacheKey = new Request(request.url, request);
    const cache = caches.default;
    let response = await cache.match(cacheKey);
    if (response) return response;

    // Fetch upstream ZIP
    const res = await fetch(remoteUrl);
    if (!res.ok) {
      return new Response(`Upstream error: ${res.status}`, { status: 502 });
    }
    const arrayBuffer = await res.arrayBuffer();

    const files = unzipSync(new Uint8Array(arrayBuffer));
    let zipped;

    if (shouldFlatten(files)) {
      // Flatten the single root folder
      const first = Object.keys(files)[0];
      const prefix = first.split("/")[0] + "/";
      const newFiles = {};

      for (const [path, data] of Object.entries(files)) {
        if (!path.startsWith(prefix)) continue;
        const inner = path.slice(prefix.length);
        if (inner) newFiles[inner] = data;
      }

      zipped = zipSync(newFiles);
    } else {
      zipped = new Uint8Array(arrayBuffer);
    }

    const filename = `${name}.sublime-package`;

    response = new Response(zipped, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "public, max-age=31536000, immutable"
      }
    });

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
};

/**
 * Determine if the ZIP archive consists of exactly one top-level folder
 * containing all files (no other root-level files), making it safe to flatten.
 *
 * @param {Record<string, Uint8Array>} files - Map of archive paths to file data.
 * @returns {boolean} True if flattening should be applied.
 */
function shouldFlatten(files) {
  const paths = Object.keys(files);
  if (!paths.length) return false;

  let root = null;
  let hasNested = false;

  for (const rawPath of paths) {
    const path = rawPath.replace(/^\.\/+/g, "");
    if (!path) continue;

    const isDirectory = path.endsWith("/");
    const clean = path.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!clean) continue;

    const segments = clean.split("/");
    const top = segments[0];

    if (root === null) root = top;
    if (top !== root) return false;

    if (segments.length === 1 && !isDirectory) {
      return false;
    }

    if (segments.length > 1) hasNested = true;
  }

  return hasNested;
}
