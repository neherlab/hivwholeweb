// ETI estimator (src/static/eti/estimator.js) against the golden master of the old
// ETI page. The cases read the training data from web-data/, which only
// just data-pull downloads, so this file runs in just test-eti, not in just test;
// its name has no .test suffix, so that bun test finds it only by its path.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { compareCase, loadTraining, readGolden } from "../scripts/eti-golden.ts";
import { FAILED, estimate } from "../src/static/eti/estimator.js";

const root = join(import.meta.dir, "..");

const training = await loadTraining(root);

// Expected values: tests/golden/eti, result pages of the old Flask app at the git tag `server-app-last-deployed-version`, captured during the conversion.
const golden = await readGolden(join(root, "tests", "golden", "eti"));

describe("golden master of the old ETI page", () => {
  test.each(golden.map((g) => [g.name, g]))("%s", (_name, g) => {
    expect(compareCase(training, g).differences).toEqual([]);
  });
});

test("shows the estimation error for a missing cutoff, which the old server answered with HTTP 500", () => {
  expect(estimate(training, { diversity: "0.01", xc: "", start: "790", end: "1185", codon_pos: "all" })).toEqual({ message: FAILED });
});
