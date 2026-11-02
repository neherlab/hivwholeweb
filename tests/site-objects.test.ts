import { describe, expect, test } from "bun:test";

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
