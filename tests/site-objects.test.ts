import { describe, expect, test } from "bun:test";

import { planStoreSync } from "../scripts/key-store.ts";
import { IMMUTABLE, REVALIDATE, objectKey, pageStoreKeys, siteCacheControl } from "../scripts/site-objects.ts";

describe("objectKey", () => {
  // The page host serves `index` for `/` and every other path as the object of the same key.
  test.each([
    ["index.html", "index"],
    ["patient/p1/index.html", "patient/p1/"],
    ["method/haplotypes/index.html", "method/haplotypes/"],
    ["404.html", "404"],
    ["static-0123456789ab/js/eti.js", "static-0123456789ab/js/eti.js"],
    ["favicon.ico", "favicon.ico"],
  ])("stores %s as %s", (file, key) => {
    expect(objectKey(file)).toBe(key);
  });
});

describe("siteCacheControl", () => {
  test.each([
    ["static-0123456789ab/js/eti.js", IMMUTABLE],
    ["index.html", REVALIDATE],
    ["patient/static/css/patient.css", REVALIDATE],
    ["static-0123/js/eti.js", REVALIDATE],
    ["robots.txt", REVALIDATE],
  ])("sends %s with %s", (file, cacheControl) => {
    expect(siteCacheControl(file)).toBe(cacheControl);
  });
});

describe("pageStoreKeys", () => {
  test("holds the URL of every object key except the 404 page", () => {
    expect([...pageStoreKeys(["index.html", "404.html", "patient/p1/index.html", "static-0123456789ab/js/a.js"])].toSorted()).toEqual([
      "/",
      "/patient/p1/",
      "/static-0123456789ab/js/a.js",
    ]);
  });

  test.each(["data/a b.html", "static/ä.png", "x/%31.js"])("rejects the path %s, which no key store key can hold", (file) => {
    expect(() => pageStoreKeys([file])).toThrow("paths that a key store cannot hold");
  });
});

describe("planStoreSync", () => {
  const keepStatic = (key: string): boolean => key.startsWith("/static-");

  test.each([
    ["an empty store", [], ["/", "/a/"], { puts: ["/", "/a/"], deletes: [], final: ["/", "/a/"] }],
    ["a store that matches", ["/", "/a/"], ["/", "/a/"], { puts: [], deletes: [], final: ["/", "/a/"] }],
    ["a removed page", ["/", "/a/"], ["/"], { puts: [], deletes: ["/a/"], final: ["/"] }],
    ["an earlier static folder", ["/", "/static-aaaaaaaaaaaa/a.js"], ["/", "/static-bbbbbbbbbbbb/a.js"], { puts: ["/static-bbbbbbbbbbbb/a.js"], deletes: [], final: ["/", "/static-aaaaaaaaaaaa/a.js", "/static-bbbbbbbbbbbb/a.js"] }],
  ])("plans %s", (_case, current, expected, plan) => {
    const result = planStoreSync(new Set(current), new Set(expected), keepStatic);
    expect({ ...result, final: [...result.final].toSorted() }).toEqual(plan);
  });
});
