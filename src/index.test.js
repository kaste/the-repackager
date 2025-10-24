import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import worker, { hasRootMarker, shouldFlatten } from "./index.js";

const fixturePath = (name) => path.resolve("test/fixtures", name);
const readFixture = (name) => fs.readFileSync(fixturePath(name));
const unzipFixture = (name) => unzipSync(new Uint8Array(readFixture(name)));
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;

describe("shouldFlatten", () => {
  const empty = new Uint8Array();

  it("returns true when archive has a single root folder", () => {
    const result = shouldFlatten({
      "plugin/": empty,
      "plugin/main.py": empty,
      "plugin/assets/icon.png": empty
    });

    expect(result).toBe(true);
  });

  it("returns false when root contains files", () => {
    const result = shouldFlatten({
      "main.py": empty,
      "readme.txt": empty
    });

    expect(result).toBe(false);
  });

  it("returns false when multiple root folders exist", () => {
    const result = shouldFlatten({
      "plugin/main.py": empty,
      "other/file.txt": empty
    });

    expect(result).toBe(false);
  });
});

describe("hasRootMarker", () => {
  const empty = new Uint8Array();

  it("detects marker at root", () => {
    expect(hasRootMarker({ ".no-sublime-package": empty })).toBe(true);
  });

  it("detects marker with leading dot slash", () => {
    expect(hasRootMarker({ "./.no-sublime-package": empty })).toBe(true);
  });

  it("ignores marker nested in subdirectory", () => {
    expect(hasRootMarker({ "nested/.no-sublime-package": empty })).toBe(false);
  });
});

describe("real package fixtures", () => {
  it("MaxPane: flattens and uses .sublime-package", () => {
    const files = unzipFixture("MaxPane-master.zip");

    expect(shouldFlatten(files)).toBe(true);

    const flattened = flattenFiles(files);
    expect(hasRootMarker(flattened)).toBe(false);
  });

  it("TreeSitter: flattens and uses .zip", () => {
    const files = unzipFixture("TreeSitter-1.8.1.zip");

    expect(shouldFlatten(files)).toBe(true);

    const flattened = flattenFiles(files);
    expect(hasRootMarker(flattened)).toBe(true);
  });
});

describe("fetch handler", () => {
  let cacheMatch;
  let cachePut;

  beforeEach(() => {
    cacheMatch = vi.fn().mockResolvedValue(undefined);
    cachePut = vi.fn().mockResolvedValue(undefined);

    globalThis.caches = {
      default: {
        match: cacheMatch,
        put: cachePut
      }
    };
  });

  afterEach(() => {
    if (originalFetch === undefined) {
      delete globalThis.fetch;
    } else {
      globalThis.fetch = originalFetch;
    }

    if (originalCaches === undefined) {
      delete globalThis.caches;
    } else {
      globalThis.caches = originalCaches;
    }

    vi.restoreAllMocks();
  });

  it("returns a flattened .sublime-package archive when marker absent", async () => {
    const remoteUrl = "https://codeload.github.com/jisaacks/MaxPane/zip/master";
    globalThis.fetch = createFetchMock(
      remoteUrl,
      readFixture("MaxPane-master.zip")
    );

    const request = new Request(
      `https://worker.example/?url=${encodeURIComponent(remoteUrl)}&name=MaxPane`
    );
    const waitUntil = vi.fn();

    const response = await worker.fetch(request, {}, { waitUntil });

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(remoteUrl);
    expect(cacheMatch).toHaveBeenCalled();
    expect(cachePut).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalled();

    const contentDisposition = response.headers.get("Content-Disposition");
    expect(contentDisposition).toContain('filename="MaxPane.sublime-package"');

    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(archive).toHaveProperty("max_pane.py");
    expect(hasRootMarker(archive)).toBe(false);
  });

  it("returns a flattened .zip archive when marker present", async () => {
    const remoteUrl = "https://codeload.github.com/sublime-treesitter/TreeSitter/zip/1.8.1";
    globalThis.fetch = createFetchMock(
      remoteUrl,
      readFixture("TreeSitter-1.8.1.zip")
    );

    const request = new Request(
      `https://worker.example/?url=${encodeURIComponent(remoteUrl)}&name=TreeSitter`
    );
    const waitUntil = vi.fn();

    const response = await worker.fetch(request, {}, { waitUntil });

    expect(response.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledWith(remoteUrl);
    expect(cacheMatch).toHaveBeenCalled();
    expect(cachePut).toHaveBeenCalled();
    expect(waitUntil).toHaveBeenCalled();

    const contentDisposition = response.headers.get("Content-Disposition");
    expect(contentDisposition).toContain('filename="TreeSitter.zip"');

    const archive = unzipSync(new Uint8Array(await response.arrayBuffer()));
    expect(archive).toHaveProperty("load.py");
    expect(archive).toHaveProperty("src/build.py");
    expect(hasRootMarker(archive)).toBe(true);
  });
});

function flattenFiles(files) {
  const first = Object.keys(files)[0];
  const prefix = first.split("/")[0] + "/";
  const flattened = {};

  for (const [path, data] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    const inner = path.slice(prefix.length);
    if (inner) {
      flattened[inner] = data;
    }
  }

  return flattened;
}

function createFetchMock(url, file) {
  return vi.fn(async (input) => {
    if (input === url) {
      return new Response(file, { status: 200 });
    }
    return new Response(null, { status: 404 });
  });
}
