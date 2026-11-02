import { describe, expect, test } from "bun:test";

import { siteName } from "../scripts/preview-sites.ts";

describe("siteName", () => {
  test.each([
    ["neherlab--hivwholeweb--branch-feat/Static_Site", "neherlab--hivwholeweb--branch-feat-static-site"],
    ["neherlab--hivwholeweb--commit-6f1f0e9", "neherlab--hivwholeweb--commit-6f1f0e9"],
    [`neherlab--hivwholeweb--branch-${"x".repeat(80)}`, `neherlab--hivwholeweb--branch-${"x".repeat(33)}`],
    ["neherlab--hivwholeweb--branch-ends-with-dash-", "neherlab--hivwholeweb--branch-ends-with-dash"],
  ])("names %s as %s", (name, site) => {
    expect(siteName(name)).toBe(site);
  });
});
