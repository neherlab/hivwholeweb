// Numeric helpers of the ETI estimator (src/static/eti/estimator.js) against numpy
// and Python. tests/test_gm_eti.ts compares the estimator with the old ETI page.

import { expect, test } from "bun:test";
import fc from "fast-check";

import { histogram, pairwiseSum, parsePythonFloat, parsePythonInt, percentile, pythonStr, round } from "../src/static/eti/estimator.js";

// Expected values: Python 3.14 format(x, ".12g"), which Python 2 str() used, plus ".0" on integral values.
test.each([
  [0.1, "0.1"],
  [1 / 3, "0.333333333333"],
  [2 / 3, "0.666666666667"],
  [98.88, "98.88"],
  [123456789012.5, "123456789012.0"],
  [123456789013.5, "123456789014.0"],
  [1234567890125, "1.23456789012e+12"],
  [1e16, "1e+16"],
  [1e-5, "1e-05"],
  [0.0001, "0.0001"],
  [0.00012345678901234, "0.000123456789012"],
  [1e11, "100000000000.0"],
  [999999999999.5, "1e+12"],
  [5e-324, "4.94065645841e-324"],
  [1.7976931348623157e308, "1.79769313486e+308"],
  [-0, "-0.0"],
  [326, "326.0"],
  [-54, "-54.0"],
  [0.30000000000000004, "0.3"],
  [Number.NaN, "nan"],
  [Number.NEGATIVE_INFINITY, "-inf"],
])("pythonStr(%p) is %p as Python 2 str()", (value, text) => {
  expect(pythonStr(value)).toBe(text);
});

test("pythonStr keeps the value of 12 significant digits", () => {
  fc.assert(
    fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (value) => {
      const text = pythonStr(value);
      expect(text).toMatch(/^-?\d(?:\d*\.\d+|\.\d+e[+-]\d{2,3}|e[+-]\d{2,3})$/u);
      // At a tie, Python rounds half to even and toPrecision rounds up; a tie has the 13th significant digit 5.
      fc.pre(!/5e/u.test(value.toExponential(12)));
      // Adding 0 turns -0 into 0, which toPrecision also writes without a sign.
      expect(Number(text) + 0).toBe(Number(value.toPrecision(12)));
    }),
  );
});

// Expected values: numpy 2.4 np.round and np.rint.
test.each([
  [2.675, 2, 2.68],
  [0.125, 2, 0.12],
  [0.375, 2, 0.38],
  [-0.005, 2, -0],
  [1.005, 2, 1],
  [2.5, 0, 2],
  [3.5, 0, 4],
  [-2.5, 0, -2],
  [-0.4, 0, -0],
  [326.5, 0, 326],
])("round(%p, %p) is %p as np.round", (value, decimals, expected) => {
  expect(Object.is(round(value, decimals), expected)).toBe(true);
});

// Expected values: numpy 2.4 np.sum of x[i] = 10^((7i mod 17) - 8) * (1 + i/3), whose
// terms span 16 orders of magnitude, so that each summation order rounds differently.
test.each([
  [1, 1e-8],
  [7, 1669003.1335336096],
  [8, 35002336.46686695],
  [9, 35002336.47053362],
  [15, 535609049.8572047],
  [16, 535609049.8572646],
  [17, 535609683.1905979],
  [127, 17442865384.66058],
  [128, 17442865384.70391],
  [129, 17443302051.37058],
  [300, 95830763019.7464],
  [1000, 1108863800771.205],
])("pairwiseSum of %p terms is %p as np.sum", (length, expected) => {
  const values = Float64Array.from({ length }, (_, i) => 10 ** (((i * 7) % 17) - 8) * (1 + i / 3));
  expect(pairwiseSum(values, 0, length)).toBe(expected);
});

// Expected values: numpy 2.4 np.percentile(values, 25) and np.percentile(values, 75).
test.each([
  [[3], 3, 3],
  [[1, 2], 1.25, 1.75],
  [[5, 1, 4], 2.5, 4.5],
  [[0.1, 0.7, 0.2, 0.9, 0.3], 0.2, 0.7],
  [[-1.5, 2.25, 0.125, 7, -3, 1], -1.09375, 1.9375],
])("percentile of %p is %p and %p as np.percentile", (values, q25, q75) => {
  expect([percentile(values, 0.25), percentile(values, 0.75)]).toEqual([q25, q75]);
});

// Expected values: numpy 2.4 np.histogram(values).
test.each([
  [[], [0, 0.1, 0.2, 0.30000000000000004, 0.4, 0.5, 0.6000000000000001, 0.7000000000000001, 0.8, 0.9, 1], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
  [[2], [1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5], [0, 0, 0, 0, 0, 1, 0, 0, 0, 0]],
  [[2, 2], [1.5, 1.6, 1.7, 1.8, 1.9, 2, 2.1, 2.2, 2.3, 2.4, 2.5], [0, 0, 0, 0, 0, 2, 0, 0, 0, 0]],
  [[0, 1, 2, 3, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], [1, 1, 1, 1, 0, 0, 0, 0, 0, 1]],
  [
    [0.1, 0.2, 0.30000000000000004, 0.7, 0.9, 1.3],
    [0.1, 0.22, 0.33999999999999997, 0.45999999999999996, 0.58, 0.7, 0.82, 0.94, 1.06, 1.1800000000000002, 1.3],
    [2, 1, 0, 0, 0, 1, 1, 0, 0, 1],
  ],
])("histogram of %p as np.histogram", (values, edges, counts) => {
  expect(histogram(values)).toEqual({ x: edges, y: counts });
});

// Expected values: Python 2.7 float() and int() of unicode strings.
test.each([
  [" 0.5\t", 0.5],
  ["\u{a0}1e-2\u{3000}", 0.01],
  ["\u{661}.\u{665}", 1.5],
  ["+.5", 0.5],
  ["5.", 5],
  ["-Infinity", Number.NEGATIVE_INFINITY],
  ["NaN", Number.NaN],
  ["1_0", undefined],
  ["0x1", undefined],
  ["1e", undefined],
  [".", undefined],
  ["", undefined],
  ["1.5\u{ff}", undefined],
])("parsePythonFloat(%p) is %p as Python 2 float()", (text, expected) => {
  expect(parsePythonFloat(text)).toBe(expected);
});

test.each([
  [" 0790 ", 790n],
  ["+12", 12n],
  ["-3", -3n],
  ["\u{667}\u{669}\u{660}", 790n],
  ["\u{1d7d8}", 0n],
  ["\u{1d7ea}\u{1d7eb}", 89n],
  ["99999999999999999999", 99999999999999999999n],
  ["12.0", undefined],
  ["1e3", undefined],
  ["", undefined],
])("parsePythonInt(%p) is %p as Python 2 int()", (text, expected) => {
  expect(parsePythonInt(text)).toBe(expected);
});

test("parsePythonFloat reads every shortest decimal of a float64 back, with surrounding spaces", () => {
  fc.assert(
    fc.property(fc.double({ noNaN: true }), fc.constantFrom("", " ", "\t", "\u{a0}", "\n "), (value, space) => {
      expect(parsePythonFloat(`${space}${String(value)}${space}`)).toBe(Object.is(value, -0) ? 0 : value);
    }),
  );
});

test("parsePythonInt reads every decimal integer back", () => {
  fc.assert(
    fc.property(fc.bigInt(), (value) => {
      expect(parsePythonInt(value.toString())).toBe(value);
    }),
  );
});
