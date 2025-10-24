import { describe, expect, it } from "vitest";
import { hasRootMarker, shouldFlatten } from "./index.js";

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

