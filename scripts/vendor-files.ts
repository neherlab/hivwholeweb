// Vendor files of a build: the third-party packages under static/components/
// ship with their sources, docs, and unminified copies, which no page loads.
// The build keeps a vendor file only when a file of the build loads it: a
// page by `href` or `src`, a stylesheet by `url()` or `@import`, or any page,
// script, or stylesheet by a quoted `/static/components/` path; and so on
// through the vendor files that are kept.

const VENDOR_DIR = "static/components/";

const LOADING_FILE = /\.(?:html|js|css)$/u;

const REFERENCES = [
  /\s(?:href|src)=(["'])(.*?)\1/gu,
  /url\(\s*(["']?)([^"')]+)\1\s*\)/gu,
  /@import\s+(["'])(.*?)\1/gu,
  /(["'])(\/static\/components\/[^"']+)\1/gu,
];

/** Return the files of a build without the vendor files that no file of the build loads. */
export function withoutUnusedVendorFiles(files: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const used = new Set<string>();
  const pending = [...files.keys()].filter((name) => !name.startsWith(VENDOR_DIR) && LOADING_FILE.test(name));
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    const bytes = files.get(name);
    if (bytes === undefined || !LOADING_FILE.test(name)) {
      continue;
    }
    const found = vendorReferences(name, decoder.decode(bytes)).filter((file) => files.has(file) && !used.has(file));
    found.forEach((file) => used.add(file));
    pending.push(...found);
  }
  return new Map([...files].filter(([name]) => !name.startsWith(VENDOR_DIR) || used.has(name)));
}

/** Return the vendor files that a file of the build names, as paths relative to the build. */
function vendorReferences(name: string, text: string): string[] {
  const base = `https://host/${name}`;
  return REFERENCES.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[2] ?? ""))
    .filter((value) => value !== "" && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu.test(value))
    .map((value) => new URL(value, base).pathname.slice(1))
    .filter((path) => path.startsWith(VENDOR_DIR));
}
