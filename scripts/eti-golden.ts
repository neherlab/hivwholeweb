// Golden master of the ETI estimator: read the pages of the old Flask app in
// tests/golden/eti/, and compare the estimator with them. The pages are result
// pages of the old Flask app at the git tag `server-app-last-deployed-version`,
// captured during the conversion, which applied the same rules to a wider grid
// of inputs.

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { FAILED, parseTraining, type Training, estimate } from "../src/static/eti/estimator.js";

/**
 * Largest distance of the plotted training and estimate points from the old page, in units in the last place.
 *
 * The old server ran numpy 1.12, which sums the diversity of whole-genome
 * windows (about 9000 sites) in another order than numpy 2, the reference of
 * the estimator: the window means differ in their last bits (at most 4 ULP over
 * the wider grid of the conversion).
 */
export const MAX_ULP = 8n;

/**
 * Largest distance of the histogram edges from the old page, in years.
 *
 * The edges are sums of residuals and the estimate, values of up to 16 years, so
 * the last bits of the window means move them by an absolute amount: at most
 * 2.8e-14 years over the wider grid of the conversion. Near zero, that amount is
 * hundreds of ULP of the edge.
 */
export const EDGE_TOLERANCE = 1e-13;

/** Return the training data of src/static/eti/manifest.json. */
export async function loadTraining(root: string): Promise<Training> {
  const manifest: { training: { file: string } } = await Bun.file(join(root, "src", "static", "eti", "manifest.json")).json();
  const training = Bun.file(join(root, "web-data", "static", "eti", "data", manifest.training.file));
  if (!(await training.exists())) {
    throw new Error(`the ETI training data ${manifest.training.file} is missing from web-data/: run just data-pull`);
  }
  return parseTraining(await training.arrayBuffer());
}

/** Read every case of a golden master directory, sorted by name. */
export async function readGolden(directory: string): Promise<GoldenCase[]> {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).toSorted();
  return Promise.all(names.map(async (name) => ({ name: name.slice(0, -".json".length), ...parseGolden(await Bun.file(join(directory, name)).text()) })));
}

/** Compare the estimate of a case with the old page and return the differences. */
export function compareCase(training: Training, golden: GoldenCase): Comparison {
  const actual = estimate(training, golden.input);
  if (golden.output === null) {
    // The old server answered with HTTP 500.
    return { kind: "failed", ulp: 0n, edgeError: 0, differences: "message" in actual && actual.message === FAILED ? [] : [`expected the estimation error, got ${describe(actual)}`] };
  }
  if ("message" in golden.output) {
    const message = "message" in actual ? actual.message : undefined;
    return { kind: "rejected", ulp: 0n, edgeError: 0, differences: message === golden.output.message ? [] : [`expected "${golden.output.message}", got ${describe(actual)}`] };
  }
  if ("message" in actual) {
    return { kind: "estimated", ulp: 0n, edgeError: 0, differences: [`expected an estimate, got "${actual.message}"`] };
  }
  const expected = golden.output;
  const shown = new Map(Object.entries(actual.display));
  const differences = [
    ...Object.entries(expected.display)
      .filter(([key, value]) => shown.get(key) !== value)
      .map(([key, value]) => `${key}: expected ${value}, got ${shown.get(key)}`),
    ...(Bun.deepEquals(actual.hist.y, expected.hist.y) ? [] : [`histogram counts: expected ${expected.hist.y.join(" ")}, got ${actual.hist.y.join(" ")}`]),
    ...(Bun.deepEquals(
      actual.result.map((series) => series.label),
      expected.result.map((series) => series.label),
    )
      ? []
      : ["series labels differ"]),
  ];
  const actualPoints = actual.result.flatMap((series) => series.data.flat());
  const expectedPoints = expected.result.flatMap((series) => series.data.flat());
  if (actualPoints.length !== expectedPoints.length || actual.hist.x.length !== expected.hist.x.length) {
    return { kind: "estimated", ulp: 0n, edgeError: 0, differences: [...differences, "the number of plotted points or histogram edges differs"] };
  }
  const ulp = actualPoints.reduce((max, value, index) => {
    const distance = ulpDistance(value, expectedPoints[index] ?? Number.NaN);
    return distance > max ? distance : max;
  }, 0n);
  const edgeError = Math.max(0, ...actual.hist.x.map((value, index) => Math.abs(value - (expected.hist.x[index] ?? Number.NaN))));
  return {
    kind: "estimated",
    ulp,
    edgeError,
    differences: [
      ...differences,
      ...(ulp > MAX_ULP ? [`plotted points differ by up to ${ulp} ULP`] : []),
      ...(edgeError <= EDGE_TOLERANCE ? [] : [`histogram edges differ by up to ${edgeError} years`]),
    ],
  };
}

/** Return the distance of two float64 values in units in the last place: 0 for equal values and for two NaN. */
export function ulpDistance(a: number, b: number): bigint {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.isNaN(a) && Number.isNaN(b) ? 0n : 1n << 64n;
  }
  const distance = orderedBits(a) - orderedBits(b);
  return distance < 0n ? -distance : distance;
}

/** Case of a golden master directory: the form input and the old page's output, `null` for HTTP 500. */
export interface GoldenCase {
  name: string;
  input: { diversity: string; xc: string; start: string; end: string; codon_pos: string };
  output: GoldenOutput | null;
}

type GoldenOutput =
  | { message: string }
  | { display: Record<string, string>; result: { data: number[][]; label: string }[]; hist: { x: number[]; y: number[] } };

/** Kind of a case, the distances of the plotted numbers, and the differences of the estimate from the old page. */
export interface Comparison {
  kind: "estimated" | "rejected" | "failed";
  /** Largest distance of the training and estimate points, in ULP. */
  ulp: bigint;
  /** Largest distance of the histogram edges, in years; NaN when an edge is NaN on one side only. */
  edgeError: number;
  differences: string[];
}

/** Parse a golden file, whose numbers include the NaN of Python's json module. */
function parseGolden(text: string): Omit<GoldenCase, "name"> {
  return JSON.parse(text.replaceAll(/(?<=[[,]\s*)NaN(?=\s*[\],])/gu, '"NaN"'), function revive(this: unknown, _key, value: unknown) {
    return Array.isArray(this) && value === "NaN" ? Number.NaN : value;
  });
}

/** Map a float64 to an integer whose order is the order of the values, so that the difference counts the floats between them. */
function orderedBits(value: number): bigint {
  const bits = new BigInt64Array(new Float64Array([value]).buffer)[0] ?? 0n;
  return bits < 0n ? -(bits & 0x7fff_ffff_ffff_ffffn) : bits;
}

function describe(output: ReturnType<typeof estimate>): string {
  return "message" in output ? `"${output.message}"` : `an estimate of ${output.display.eti}`;
}
