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

    // Unzip and flatten folder
    const files = unzipSync(new Uint8Array(arrayBuffer));
    const first = Object.keys(files)[0];
    const prefix = first.split("/")[0] + "/";
    const newFiles = {};

    for (const [path, data] of Object.entries(files)) {
      if (!path.startsWith(prefix)) continue;
      const inner = path.slice(prefix.length);
      if (inner) newFiles[inner] = data;
    }

    const zipped = zipSync(newFiles);
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
