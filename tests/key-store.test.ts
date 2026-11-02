import { describe, expect, test } from "bun:test";
import fc from "fast-check";

import { UPDATE_BATCH, planStoreSync, updateBatches } from "../scripts/key-store.ts";

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

describe("updateBatches", () => {
  // Boundary: UpdateKeys changes at most 50 keys per request (CloudFront quotas on key value stores).
  test.each([
    [0, []],
    [1, [1]],
    [50, [50]],
    [51, [50, 1]],
    [120, [50, 50, 20]],
  ])("splits %p keys into batches of %p keys", (count, sizes) => {
    const keys = Array.from({ length: count }, (_, index) => `/k${index}`);
    expect(updateBatches(keys).map((batch) => batch.length)).toEqual(sizes);
  });

  test("keeps every key once, in order, in batches of at most UPDATE_BATCH keys", () => {
    fc.assert(
      fc.property(fc.array(fc.string(), { maxLength: 300 }), (keys) => {
        const batches = updateBatches(keys);
        expect([batches.flat(), batches.every((batch) => batch.length > 0 && batch.length <= UPDATE_BATCH)]).toEqual([keys, true]);
      }),
    );
  });
});
