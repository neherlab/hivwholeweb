// Data URLs of the pages and scripts: the paths that the data host serves.

// Each prefix starts a quoted URL in the pages or in src/static/js:
// d3.json("/api/data/..."), href="/static/data/...", src='/static/data/...',
// data-download="/static/data/...", and the training data base of eti.js.
const DATA_PREFIXES = ["/api/data/", "/static/data/", "/static/eti/data/"];

const QUOTED_PREFIX = new RegExp(`(["'])(${DATA_PREFIXES.map((p) => p.replaceAll("/", "\\/")).join("|")})`, "gu");

/** Point every quoted data URL of a page or script to the data host `origin`. */
export function rewriteDataUrls(text: string, origin: string): string {
  return text.replace(QUOTED_PREFIX, (_match, quote: string, prefix: string) => `${quote}${origin}${prefix}`);
}

/** Return the quoted data URLs that still point to the page host. */
export function sameHostDataUrls(text: string): string[] {
  return [...text.matchAll(QUOTED_PREFIX)].map((match) => match[0]);
}
