import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { MAX_SINGLE_PART, indexText, isCompressed, memberHash, needsMultipart, parseManifest, partRanges } from "../scripts/manifest.ts";

describe("needsMultipart", () => {
  // Boundary: S3 takes at most 5 GiB in one PUT.
  test.each([
    [0, false],
    [MAX_SINGLE_PART - 1, false],
    [MAX_SINGLE_PART, false],
    [MAX_SINGLE_PART + 1, true],
    [8.4 * 1024 ** 3, true],
  ])("for %p bytes is %p", (size, expected) => {
    expect(needsMultipart(size)).toBe(expected);
  });
});

describe("partRanges", () => {
  test.each([
    [0, 4, [{ number: 1, start: 0, end: 0 }]],
    [4, 4, [{ number: 1, start: 0, end: 4 }]],
    [5, 4, [{ number: 1, start: 0, end: 4 }, { number: 2, start: 4, end: 5 }]],
    [8, 4, [{ number: 1, start: 0, end: 4 }, { number: 2, start: 4, end: 8 }]],
  ])("splits %p bytes in parts of %p", (size, partSize, ranges) => {
    expect(partRanges(size, partSize)).toEqual(ranges);
  });

  test("covers every byte once, in order, with parts no larger than the part size", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10_000_000 }), fc.integer({ min: 1, max: 100_000 }), (size, partSize) => {
        const ranges = partRanges(size, partSize);
        expect([ranges[0]?.start, ranges.at(-1)?.end, ranges.every((range, index) => range.number === index + 1 && range.start === (ranges[index - 1]?.end ?? 0) && range.end - range.start <= partSize && range.end > range.start)]).toEqual([0, size, true]);
      }),
    );
  });
});

describe("memberHash", () => {
  test("does not depend on the order of the members", () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.record({ path: fc.string({ minLength: 1 }), sha256: fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: 64, maxLength: 64 }) }), { selector: (member) => member.path }), (members) => {
        expect(memberHash(members.toReversed())).toBe(memberHash(members));
      }),
    );
  });

  test("changes when a member's content changes", () => {
    const members = [{ path: "robots.txt", sha256: "0".repeat(64) }];
    expect(memberHash([{ path: "robots.txt", sha256: "1".repeat(64) }])).not.toBe(memberHash(members));
  });

  // Expected: the first 16 hex digits of `printf '%s  %s\n' <sha256> robots.txt | sha256sum`.
  test("hashes the sha256sum lines of the members", () => {
    expect(memberHash([{ path: "robots.txt", sha256: "0".repeat(64) }])).toBe(new Bun.CryptoHasher("sha256").update(`${"0".repeat(64)}  robots.txt\n`).digest("hex").slice(0, 16));
  });
});

describe("isCompressed", () => {
  // Expected: the content types that CloudFront compresses.
  test.each([
    ["application/json", true],
    ["text/plain; charset=utf-8", true],
    ["image/svg+xml", true],
    ["text/tab-separated-values; charset=utf-8", true],
    ["application/zip", false],
    ["application/octet-stream", false],
    ["text/markdown; charset=utf-8", false],
  ])("%s: %p", (type, expected) => {
    expect(isCompressed(type)).toBe(expected);
  });
});

describe("indexText", () => {
  test("lists the objects without their sources", () => {
    const manifest = parseManifest({
      objects: [{ key: "robots.txt", source: { kind: "web-data", path: "robots.txt" }, sha256: "0".repeat(64), size: 3, contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=3600" }],
      absent: [],
    });
    expect(JSON.parse(indexText(manifest))).toEqual({ objects: [{ key: "robots.txt", sha256: "0".repeat(64), size: 3, contentType: "text/plain; charset=utf-8", cacheControl: "public, max-age=3600" }] });
  });
});

describe("parseManifest", () => {
  test.each([
    ["an unknown source kind", { kind: "other", path: "x" }, "0".repeat(64)],
    ["a sha256 that is not 64 hex digits", { kind: "data", path: "x" }, "abc"],
  ])("rejects %s", (_case, source, sha256) => {
    expect(() => parseManifest({ objects: [{ key: "x", source, sha256, size: 1, contentType: "a", cacheControl: "b" }], absent: [] })).toThrow("invalid object in data-manifest.json");
  });
});
