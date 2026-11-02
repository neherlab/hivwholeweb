// @ts-check
// Time-since-infection estimate (ETI) of the old ETI page, as a JavaScript module.
//
// `estimate()` combines three parts of the old server and keeps their behavior
// (paths of the git tag `server-app-last-deployed-version`):
//
// - the form parsing of WTForms 2.1 under Python 2 (`FloatField`, `IntegerField`)
// - `ETIForm.validate()` (app/hiv/blueprints/method/forms.py) and the messages of
//   the ETI view (app/hiv/blueprints/ETI/__init__.py)
// - `ETIModel.estimate()` (app/hiv/models.py) with `TI_from_diversity()` of the
//   HIV_time_of_infection repository (TI_predictor.py, EDI_functions.py, MIT
//   license, LICENSE in this directory)
//
// The arithmetic follows numpy 2 step by step: the pairwise summation of
// `np.sum`, the order of each product and difference, `np.round` (half to even),
// `np.percentile` with linear interpolation, and `np.histogram`. The training
// data holds the per-site values that the conversion from the old server
// computed with numpy (README.md in this directory).
//
// The old server answered some inputs with HTTP 500: a missing cutoff, fewer than
// two training samples in the region, or training samples that all have the same
// diversity. The estimate answers them with the estimation error message.

/** Message of a rejected form. */
export const INVALID =
  "Values in form are inconsistent! Make sure start and end positions are between" +
  " HXB2 position 500 and 9500 and diversity between 0 and 0.3. If you selected a" +
  " specific codon position, your region has to be fully contained in a gene!";

/** Message of a failed estimate. */
export const FAILED = "An error occurred during the estimation";

const FORMAT = "eti-training-1";

// Defaults of TI_predictor.py: training samples between 0 and 9 years after
// infection, and windows with at least half of their sites covered.
const T_MIN = 0;
const T_MAX = 9;
const COVERAGE_MIN = 0.5;

// Range of np.ma.divide: a quotient is masked when |a| * tiny >= |b|.
const FLOAT64_TINY = 2.2250738585072014e-308;

/**
 * Parse the training data file of the estimator (README.md in this directory).
 *
 * @param {ArrayBuffer} buffer
 * @returns {Training}
 */
export function parseTraining(buffer) {
  const view = new DataView(buffer);
  const headerLength = view.getUint32(0, true);
  /** @type {TrainingHeader} */
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  if (header.format !== FORMAT) {
    throw new Error(`training data has format ${String(header.format)}, not ${FORMAT}`);
  }
  const base = Math.ceil((4 + headerLength) / 8) * 8;
  const { sites, sections } = header;
  const samples = header.patients.reduce((count, patient) => count + patient.times.length, 0);
  const cells = samples * sites;
  const bits = Math.ceil(cells / 8);
  const covered = section(buffer, base, sections.covered, bits);
  const polymorphic = section(buffer, base, sections.polymorphic, bits);
  const count = polymorphic.reduce((total, byte) => total + popcount(byte), 0);
  const maxFrequencies = dataView(section(buffer, base, sections.max_frequency, count * 8));
  const hammings = dataView(section(buffer, base, sections.hamming, count * 8));
  const hamming = new Float64Array(cells).fill(Number.NaN);
  const maxFrequency = new Float64Array(cells);
  let next = 0;
  for (let cell = 0; cell < cells; cell++) {
    if (bit(polymorphic, cell)) {
      hamming[cell] = hammings.getFloat64(next * 8, true);
      maxFrequency[cell] = maxFrequencies.getFloat64(next * 8, true);
      next++;
    } else if (bit(covered, cell)) {
      hamming[cell] = 0;
    }
  }
  let row = 0;
  const patients = header.patients.map(({ name, times }) => {
    const first = row;
    row += times.length;
    return { name, times, firstRow: first };
  });
  return { sites, patients, genes: header.genes, hamming, maxFrequency };
}

/**
 * Return the result page values for the raw form fields, or `{ message }` for a rejected input.
 *
 * @param {Training} training
 * @param {EtiForm} form
 * @returns {EtiResult | { message: string }}
 */
export function estimate(training, form) {
  const diversity = parsePythonFloat(form.diversity);
  const xc = parsePythonFloat(form.xc);
  const start = parsePythonInt(form.start);
  const end = parsePythonInt(form.end);
  if (diversity === undefined || start === undefined || end === undefined || !isValid(training, diversity, start, end, form.codon_pos)) {
    return { message: INVALID };
  }
  // The view passes 0-based inclusive start and exclusive end: (start - 1, end).
  const fit = xc === undefined ? undefined : fitRegion(training, Number(start) - 1, Number(end), xc, form.codon_pos);
  if (xc === undefined || fit === undefined) {
    return { message: FAILED };
  }
  const eti = fit.slope * diversity + fit.intercept;
  const residuals = fit.samples.map(({ time, diversity: x }) => polyval(fit.slope, fit.intercept, x) - time);
  const absolute = Float64Array.from(residuals, Math.abs);
  const hist = histogram(residuals.map((residual) => residual + eti).filter((value) => value >= 0));
  const etiRounded = round(eti, 2);
  return {
    display: {
      diversity: pythonStr(diversity),
      xc: pythonStr(xc),
      start: start.toString(),
      end: end.toString(),
      eti: pythonStr(etiRounded),
      iqr: pythonStr(round(percentile(residuals, 0.75) - percentile(residuals, 0.25), 2)),
      mae: pythonStr(round(pairwiseSum(absolute, 0, absolute.length) / absolute.length, 2)),
      intercept: pythonStr(round(fit.intercept, 2)),
      slope: pythonStr(rint(fit.slope)),
    },
    result: [
      { data: fit.samples.map(({ time, diversity: x }) => [time, x]), label: "training" },
      { data: [[etiRounded, diversity]], label: "estimate" },
    ],
    hist,
  };
}

/**
 * Parse a form field as Python 2 `float()` under WTForms did, or return `undefined` for an invalid number.
 *
 * Python converts Unicode whitespace to spaces and Unicode decimal digits to ASCII
 * digits, strips spaces, and accepts decimal numbers with an optional exponent,
 * `inf`, `infinity`, and `nan` in any case. Python 2 has no `_` separators.
 *
 * @param {string} text
 * @returns {number | undefined}
 */
export function parsePythonFloat(text) {
  const ascii = pythonAscii(text);
  const match = ascii === undefined ? null : /^([+-]?)(?:(inf(?:inity)?)|(nan)|((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?))$/iu.exec(ascii);
  if (match === null) {
    return undefined;
  }
  const [, sign, infinity, nan, decimal] = match;
  if (nan !== undefined) {
    return Number.NaN;
  }
  const magnitude = infinity === undefined ? Number(decimal) : Number.POSITIVE_INFINITY;
  return sign === "-" ? -magnitude : magnitude;
}

/**
 * Parse a form field as Python 2 `int()` under WTForms did, or return `undefined` for an invalid integer.
 *
 * @param {string} text
 * @returns {bigint | undefined}
 */
export function parsePythonInt(text) {
  const ascii = pythonAscii(text);
  const match = ascii === undefined ? null : /^([+-]?)(\d+)$/u.exec(ascii);
  if (match === null) {
    return undefined;
  }
  const magnitude = BigInt(match[2] ?? "");
  return match[1] === "-" ? -magnitude : magnitude;
}

/**
 * Format a number as Python 2 `str()` did: 12 significant digits with half-to-even
 * rounding, `%g` notation, and `.0` on integral values.
 *
 * @param {number} value
 * @returns {string}
 */
export function pythonStr(value) {
  if (Number.isNaN(value)) {
    return "nan";
  }
  if (!Number.isFinite(value)) {
    return value > 0 ? "inf" : "-inf";
  }
  const sign = value < 0 || Object.is(value, -0) ? "-" : "";
  const { digits, exponent } = roundSignificant(Math.abs(value), 12);
  const text = -4 <= exponent && exponent < 12 ? fixedNotation(digits, exponent) : exponentNotation(digits, exponent);
  return `${sign}${/[.e]/u.test(text) ? text : `${text}.0`}`;
}

/**
 * Round half to even, as `np.rint`.
 *
 * @param {number} value
 * @returns {number}
 */
export function rint(value) {
  const rounded = Math.round(value);
  return rounded - value === 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
}

/**
 * Round to `decimals` digits as `np.round`: scale, round half to even, and scale back.
 *
 * @param {number} value
 * @param {number} decimals
 * @returns {number}
 */
export function round(value, decimals) {
  const scale = 10 ** decimals;
  return rint(value * scale) / scale;
}

/**
 * Sum `length` values from `start` in the order of numpy's pairwise summation (`np.sum` of float64).
 *
 * @param {Float64Array} values
 * @param {number} start
 * @param {number} length
 * @returns {number}
 */
export function pairwiseSum(values, start, length) {
  if (length < 8) {
    let sum = -0;
    for (let i = 0; i < length; i++) {
      sum += at(values, start + i);
    }
    return sum;
  }
  if (length <= 128) {
    const r = values.slice(start, start + 8);
    let i = 8;
    for (; i < length - (length % 8); i += 8) {
      for (let j = 0; j < 8; j++) {
        r[j] = at(r, j) + at(values, start + i + j);
      }
    }
    let sum = at(r, 0) + at(r, 1) + (at(r, 2) + at(r, 3)) + (at(r, 4) + at(r, 5) + (at(r, 6) + at(r, 7)));
    for (; i < length; i++) {
      sum += at(values, start + i);
    }
    return sum;
  }
  const half = Math.floor(length / 2);
  const split = half - (half % 8);
  return pairwiseSum(values, start, split) + pairwiseSum(values, start + split, length - split);
}

/**
 * Return a quantile of the values as `np.percentile` with linear interpolation, NaN when a value is NaN.
 *
 * @param {readonly number[]} values
 * @param {number} quantile
 * @returns {number}
 */
export function percentile(values, quantile) {
  if (values.some(Number.isNaN)) {
    return Number.NaN;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const index = (sorted.length - 1) * quantile;
  if (index >= sorted.length - 1) {
    return at(sorted, sorted.length - 1);
  }
  const previous = Math.floor(index);
  const gamma = index - previous;
  const a = at(sorted, previous);
  const b = at(sorted, previous + 1);
  const difference = b - a;
  return gamma >= 0.5 ? b - difference * (1 - gamma) : a + difference * gamma;
}

/**
 * Return the 10-bin histogram of `np.histogram(values)`: bin edges and counts.
 *
 * @param {readonly number[]} values
 * @returns {{ x: number[], y: number[] }}
 */
export function histogram(values) {
  const bins = 10;
  let first = values.length === 0 ? 0 : Math.min(...values);
  let last = values.length === 0 ? 1 : Math.max(...values);
  if (first === last) {
    first -= 0.5;
    last += 0.5;
  }
  const edges = linspace(first, last, bins + 1);
  const counts = Array.from({ length: bins }, () => 0);
  const denominator = last - first;
  values.forEach((value) => {
    let index = Math.trunc(((value - first) / denominator) * bins);
    if (index === bins) {
      index -= 1;
    }
    if (value < at(edges, index)) {
      index -= 1;
    }
    if (value >= at(edges, index + 1) && index !== bins - 1) {
      index += 1;
    }
    counts[index] = at(counts, index) + 1;
  });
  return { x: edges, y: counts };
}

/**
 * @param {Training} training
 * @param {number} diversity
 * @param {bigint} start
 * @param {bigint} end
 * @param {string} codon
 */
function isValid(training, diversity, start, end, codon) {
  if (start < 500n || end < 500n || end < start) {
    return false;
  }
  if (start > 9800n || end > 9800n) {
    return false;
  }
  // NaN passes, as it did in Python.
  if (diversity < 0 || diversity > 0.3) {
    return false;
  }
  // The form checks (start, end), the estimate (start - 1, end).
  return codon === "all" || readingFrame(training.genes, Number(start), Number(end)) !== undefined;
}

/**
 * Return the reading frame of the first gene that holds the sites [first, end), as `get_reading_frame()`.
 *
 * @param {readonly Gene[]} genes
 * @param {number} first
 * @param {number} end
 */
function readingFrame(genes, first, end) {
  return genes.find((gene) => first >= gene.start && end - 1 < gene.end)?.frame;
}

/**
 * Fit time against diversity over the sites [first, end) as `TI_from_diversity()`, or return `undefined` where it failed.
 *
 * @param {Training} training
 * @param {number} first
 * @param {number} end
 * @param {number} xc
 * @param {string} codon
 * @returns {Fit | undefined}
 */
function fitRegion(training, first, end, xc, codon) {
  /** @type {number | undefined} */
  let shift;
  if (codon !== "all") {
    const frame = readingFrame(training.genes, first, end);
    if (frame !== undefined) {
      const position = parsePythonInt(codon);
      if (position === undefined) {
        return undefined;
      }
      shift = Number(modulo(position + 3n - BigInt(first % 3) + BigInt(frame) - 1n, 3n));
    }
  }
  // `window_cutoff()` divides the covered sites by the window size before slicing.
  const size = shift === undefined ? end - first : Math.floor((end - first - shift) / 3);
  const step = shift === undefined ? 1 : 3;
  const sites = [];
  for (let site = first + (shift ?? 0); site < Math.min(end, training.sites); site += step) {
    sites.push(site);
  }
  return fitLad(windowSamples(training, sites, size, 1 - xc));
}

/**
 * Return the training samples of a window: mean Hamming diversity above the cutoff, as `window_cutoff().realdata()`.
 *
 * @param {Training} training
 * @param {readonly number[]} sites
 * @param {number} size
 * @param {number} maxFrequency
 * @returns {Sample[]}
 */
function windowSamples(training, sites, size, maxFrequency) {
  const values = new Float64Array(sites.length);
  return training.patients.flatMap((patient) =>
    patient.times.flatMap((time, sample) => {
      const offset = (patient.firstRow + sample) * training.sites;
      let covered = 0;
      sites.forEach((site, index) => {
        const hamming = at(training.hamming, offset + site);
        if (Number.isNaN(hamming)) {
          values[index] = 0;
          return;
        }
        covered++;
        values[index] = at(training.maxFrequency, offset + site) <= maxFrequency ? hamming : 0;
      });
      if (covered === 0 || !(time > T_MIN && time < T_MAX && covered / size >= COVERAGE_MIN)) {
        return [];
      }
      return [{ time, diversity: pairwiseSum(values, 0, values.length) / covered }];
    }),
  );
}

/**
 * Fit the line with the least absolute deviation through a pair of samples, as `EDI_LAD()`.
 *
 * @param {readonly Sample[]} samples
 * @returns {Fit | undefined}
 */
function fitLad(samples) {
  const errors = new Float64Array(samples.length);
  /** @type {Fit | undefined} */
  let best;
  let bestError = Number.POSITIVE_INFINITY;
  samples.forEach((a, i) => {
    samples.slice(i + 1).forEach((b) => {
      const dx = a.diversity - b.diversity;
      const dt = a.time - b.time;
      const dxt = a.diversity * b.time - b.diversity * a.time;
      if (dx === 0 || Math.abs(dt) * FLOAT64_TINY >= Math.abs(dx) || Math.abs(dxt) * FLOAT64_TINY >= Math.abs(dx)) {
        return;
      }
      const slope = dt / dx;
      const intercept = dxt / dx;
      samples.forEach((sample, k) => {
        errors[k] = Math.abs(sample.time - slope * sample.diversity - intercept);
      });
      const error = pairwiseSum(errors, 0, errors.length);
      if (best === undefined || error < bestError) {
        best = { slope, intercept, samples };
        bestError = error;
      }
    });
  });
  return best;
}

/**
 * Evaluate `np.polyval([slope, intercept], x)` in its order of operations.
 *
 * @param {number} slope
 * @param {number} intercept
 * @param {number} x
 */
function polyval(slope, intercept, x) {
  // numpy starts Horner's scheme at 0, and 0 * x keeps its NaN for an infinite x.
  // oxlint-disable-next-line erasing-op
  return (0 * x + slope) * x + intercept;
}

/**
 * Return `num` evenly spaced values from `start` to `stop`, as `np.linspace`.
 *
 * @param {number} start
 * @param {number} stop
 * @param {number} num
 */
function linspace(start, stop, num) {
  const div = num - 1;
  const delta = stop - start;
  const step = delta / div;
  const values = Array.from({ length: num }, (_, i) => (step === 0 ? (i / div) * delta : i * step) + start);
  values[num - 1] = stop;
  return values;
}

/**
 * Return the decimal digits and exponent of `value` rounded to `precision` significant digits, half to even.
 *
 * The rounding works on the exact decimal expansion of the float64, as C `printf` does.
 *
 * @param {number} value  finite and not negative
 * @param {number} precision
 */
function roundSignificant(value, precision) {
  if (value === 0) {
    return { digits: "0".repeat(precision), exponent: 0 };
  }
  const { digits: exact, point } = exactDecimal(value);
  const head = exact.slice(0, precision).padEnd(precision, "0");
  const rest = exact.slice(precision);
  const half = rest === "" ? -1 : compareHalf(rest);
  const up = half > 0 || (half === 0 && Number(head.at(-1)) % 2 === 1);
  const rounded = up ? (BigInt(head) + 1n).toString() : head;
  // A carry adds a digit: 999... rounds to 1000...
  return rounded.length > precision ? { digits: rounded.slice(0, precision), exponent: point } : { digits: rounded, exponent: point - 1 };
}

/**
 * Return the exact decimal digits of a positive finite float64 and the position of the decimal point after the first digit.
 *
 * @param {number} value
 * @returns {{ digits: string, point: number }}
 */
function exactDecimal(value) {
  const bits = new BigUint64Array(new Float64Array([value]).buffer)[0] ?? 0n;
  const biased = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  const mantissa = biased === 0 ? fraction : fraction | (1n << 52n);
  const power = (biased === 0 ? 1 : biased) - 1075;
  if (power >= 0) {
    const digits = (mantissa << BigInt(power)).toString();
    return { digits, point: digits.length };
  }
  // mantissa / 2^k = mantissa * 5^k / 10^k
  const digits = (mantissa * 5n ** BigInt(-power)).toString();
  const trimmed = digits.replace(/^0+/u, "");
  return { digits: trimmed, point: digits.length + power };
}

/**
 * Compare a digit string, read as the fraction 0.<digits>, with one half.
 *
 * @param {string} digits
 */
function compareHalf(digits) {
  const first = Number(digits[0]);
  if (first !== 5) {
    return first > 5 ? 1 : -1;
  }
  return /[1-9]/u.test(digits.slice(1)) ? 1 : 0;
}

/**
 * Write `%g` fixed notation: digits d1 d2 ... with the decimal point after the digit at `exponent`, without trailing zeros.
 *
 * @param {string} digits
 * @param {number} exponent
 */
function fixedNotation(digits, exponent) {
  const text = exponent >= 0 ? `${digits.slice(0, exponent + 1)}.${digits.slice(exponent + 1)}` : `0.${"0".repeat(-exponent - 1)}${digits}`;
  return text.replace(/\.?0*$/u, "");
}

/**
 * Write `%g` exponent notation with at least two exponent digits, without trailing zeros.
 *
 * @param {string} digits
 * @param {number} exponent
 */
function exponentNotation(digits, exponent) {
  const mantissa = `${digits[0]}.${digits.slice(1)}`.replace(/\.?0*$/u, "");
  const sign = exponent < 0 ? "-" : "+";
  return `${mantissa}e${sign}${String(Math.abs(exponent)).padStart(2, "0")}`;
}

/**
 * Convert text as Python 2 `PyUnicode_EncodeDecimal()` and strip it, or return `undefined` for a character it rejects.
 *
 * @param {string} text
 */
function pythonAscii(text) {
  const characters = Array.from(text, (character) => {
    if (PYTHON_SPACE.test(character)) {
      return " ";
    }
    if (/\p{Nd}/u.test(character)) {
      return String(decimalValue(character));
    }
    return (character.codePointAt(0) ?? 0) < 256 ? character : undefined;
  });
  return characters.includes(undefined) ? undefined : characters.join("").replace(/^ +| +$/gu, "");
}

// Python 2 `unicode.isspace()` characters (Unicode 5.2): the bidirectional classes WS, B, and S, and the category Zs.
// The class B includes the control characters U+001C to U+001F.
// oxlint-disable-next-line no-control-regex
const PYTHON_SPACE = /^[\t-\r\x1c-\x20\x85\xa0\u1680\u180e\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;

/**
 * Return the value of a Unicode decimal digit: Unicode encodes each set of decimal digits 0 to 9 in consecutive code points.
 *
 * @param {string} digit
 */
function decimalValue(digit) {
  const codePoint = digit.codePointAt(0) ?? 0;
  let zero = codePoint;
  while (zero > 0 && /\p{Nd}/u.test(String.fromCodePoint(zero - 1))) {
    zero--;
  }
  return (codePoint - zero) % 10;
}

/**
 * Python's modulo, with the sign of the divisor.
 *
 * @param {bigint} a
 * @param {bigint} b
 */
function modulo(a, b) {
  return ((a % b) + b) % b;
}

/**
 * @param {ArrayBuffer} buffer
 * @param {number} base
 * @param {Section} entry
 * @param {number} length
 */
function section(buffer, base, entry, length) {
  if (entry.length !== length || base + entry.offset + length > buffer.byteLength) {
    throw new Error(`training data section of ${entry.length} bytes at ${entry.offset}, expected ${length} bytes`);
  }
  return new Uint8Array(buffer, base + entry.offset, length);
}

/** @param {Uint8Array} bytes */
function dataView(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * @param {Uint8Array} bytes
 * @param {number} index
 */
function bit(bytes, index) {
  return ((at(bytes, index >> 3) >> (index & 7)) & 1) === 1;
}

/** @param {number} byte */
function popcount(byte) {
  let count = 0;
  for (let rest = byte; rest !== 0; rest &= rest - 1) {
    count++;
  }
  return count;
}

/**
 * Return the element at `index`, which the caller keeps in bounds.
 *
 * @template T
 * @param {ArrayLike<T>} values
 * @param {number} index
 * @returns {T}
 */
function at(values, index) {
  return /** @type {T} */ (values[index]);
}

/**
 * Training data: per-cell values of every sample (patient time point) and site.
 *
 * @typedef {object} Training
 * @property {number} sites
 * @property {readonly Patient[]} patients
 * @property {readonly Gene[]} genes
 * @property {Float64Array} hamming  diversity 1 - sum(f^2) of a cell, NaN where the cell is not covered
 * @property {Float64Array} maxFrequency  largest normalized allele frequency of a polymorphic cell
 */

/**
 * @typedef {object} Patient
 * @property {string} name
 * @property {readonly number[]} times  years since infection of the samples
 * @property {number} firstRow  row of the first sample in the cell arrays
 */

/**
 * Gene of annotations.txt: sites [start, end), 0-based.
 *
 * @typedef {object} Gene
 * @property {string} name
 * @property {number} start
 * @property {number} end
 * @property {number} frame
 */

/**
 * @typedef {object} TrainingHeader
 * @property {string} format
 * @property {number} sites
 * @property {{ name: string, times: number[] }[]} patients
 * @property {Gene[]} genes
 * @property {{ covered: Section, polymorphic: Section, max_frequency: Section, hamming: Section }} sections
 */

/**
 * @typedef {object} Section
 * @property {number} offset
 * @property {number} length
 */

/**
 * Raw fields of the ETI form.
 *
 * @typedef {object} EtiForm
 * @property {string} diversity
 * @property {string} xc
 * @property {string} start
 * @property {string} end
 * @property {string} codon_pos
 */

/**
 * Values of the result page: its texts, the points of the training plot, and the histogram.
 *
 * @typedef {object} EtiResult
 * @property {Record<"diversity" | "xc" | "start" | "end" | "eti" | "iqr" | "mae" | "intercept" | "slope", string>} display
 * @property {{ data: number[][], label: string }[]} result
 * @property {{ x: number[], y: number[] }} hist
 */

/**
 * @typedef {object} Sample
 * @property {number} time
 * @property {number} diversity
 */

/**
 * @typedef {object} Fit
 * @property {number} slope
 * @property {number} intercept
 * @property {readonly Sample[]} samples
 */
