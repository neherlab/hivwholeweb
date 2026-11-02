import { describe, expect, test } from "bun:test";

import { copySource } from "../scripts/aws.ts";

describe("copySource", () => {
  // S3 CopyObject takes the source as `<bucket>/<key>` with the key URL-encoded; each
  // expected value is Python's urllib.parse.quote(key, safe="/") (RFC 3986, UTF-8).
  test.each([
    ["static/data/p1.tar.gz", "src/static/data/p1.tar.gz"],
    ["static/data/a b+c ä.txt", "src/static/data/a%20b%2Bc%20%C3%A4.txt"],
    ["a/%31?x#y", "src/a/%2531%3Fx%23y"],
  ])("encodes the key %s", (key, source) => {
    expect(copySource("src", key)).toBe(source);
  });
});
