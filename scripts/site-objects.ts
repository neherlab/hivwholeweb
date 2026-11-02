// Objects of the page hosts: the URL of each file of a build, its key on the
// preview host, its cache headers, and the page key set of the edge key store.

/** Versioned static folder of a build (scripts/static-version.ts). */
export const STATIC_FOLDER = /^static-[0-9a-f]{12}\//u;

/** Browsers and CloudFront keep a file of a versioned static folder forever. */
export const IMMUTABLE = "public, max-age=31536000, immutable";

/** Browsers check every other file on each visit; CloudFront keeps it until a deploy clears its cache. */
export const REVALIDATE = "public, max-age=0, must-revalidate, s-maxage=31536000";

// Characters of a key store key: an encoded or otherwise altered path never matches a key.
const STORE_KEY = /^\/[A-Za-z0-9._/~-]*$/u;

// Largest key of a CloudFront key store, in bytes.
const MAX_STORE_KEY = 512;

/**
 * Key of a file of a build on the shared preview host, which serves the object
 * `index` for `/` and every other path as the object of the same key:
 * `index.html` is stored as `index`, a page `<dir>/index.html` as `<dir>/`
 * (the URL `/<dir>/` of the site's links), `404.html` as `404`, and every other
 * file at its path. The production host stores each file under its path.
 */
export function objectKey(file: string): string {
  if (file === "index.html") {
    return "index";
  }
  return file.endsWith("/index.html") ? file.slice(0, -"index.html".length) : file.replace(/\.html$/u, "");
}

/** URL path of an object key: `/` for `index`, `/<key>` otherwise. */
export function keyUrl(key: string): string {
  return key === "index" ? "/" : `/${key}`;
}

/** Cache-Control of a file of a build. */
export function siteCacheControl(file: string): string {
  return STATIC_FOLDER.test(file) ? IMMUTABLE : REVALIDATE;
}

/** Page key set of a build: the URL of each file's object key, without the 404 page, which only error answers serve. */
export function pageStoreKeys(files: Iterable<string>): Set<string> {
  const keys = [...files].map((file) => keyUrl(objectKey(file))).filter((url) => url !== "/404");
  const invalid = keys.filter((key) => !isStoreKey(key));
  if (invalid.length > 0) {
    throw new Error(`paths that a key store cannot hold: ${invalid.join(", ")}`);
  }
  return new Set(keys);
}

/** Tell whether a URL path can be a key of a key store. */
export function isStoreKey(key: string): boolean {
  return STORE_KEY.test(key) && new TextEncoder().encode(key).length <= MAX_STORE_KEY;
}
