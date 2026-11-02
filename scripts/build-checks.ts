// Checks of a finished build: the build fails on any problem they report.

import { PLAUSIBLE_ORIGIN } from "./analytics.ts";
import { sameHostDataUrls } from "./data-urls.ts";
import { includeMarkers } from "./includes.ts";
import { isStoreKey, keyUrl, objectKey } from "./site-objects.ts";
import { pageUrl } from "./static-version.ts";

/** CloudFront compresses only files from 1 KB to 10 MB. */
export const MAX_TEXT_SIZE = 10_000_000;

const TEXT_EXTENSIONS = ["html", "js", "css", "json", "svg"];

const ATTRIBUTE = /\s(?:href|src)=(["'])(.*?)\1/gu;

const QUOTED_STATIC = /["']\/static\//gu;

const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/gu;

const EXTERNAL_LOAD = [
  /<script\b[^>]*\ssrc=["']((?:https?:)?\/\/[^"']+)["']/gu,
  /<link\b(?=[^>]*\srel=["'](?:stylesheet|preload|modulepreload)["'])[^>]*\shref=["']((?:https?:)?\/\/[^"']+)["']/gu,
  /@import\s+(?:url\()?\s*["']?((?:https?:)?\/\/[^"')\s]+)/gu,
  /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)/gu,
];

/**
 * Return the problems of a build: leftover include markers, same-host links
 * that name no file, unversioned static references, same-host data URLs,
 * stylesheets, fonts, or scripts from other hosts (except the analytics script
 * when analytics is on), text files over 10 MB, and file paths that no key
 * store key can hold.
 */
export function checkBuild(files: ReadonlyMap<string, Uint8Array>, options: { analytics: boolean }): string[] {
  const decoder = new TextDecoder();
  const texts = [...files]
    .filter(([name]) => TEXT_EXTENSIONS.includes(extension(name)))
    .map(([name, bytes]) => ({ name, size: bytes.length, text: decoder.decode(bytes) }))
    .toSorted((a, b) => (a.name < b.name ? -1 : 1));
  const pages = texts.filter(({ name }) => name.endsWith(".html"));
  const code = texts.filter(({ name }) => /\.(?:html|js|css)$/u.test(name));
  const allowed = options.analytics ? [PLAUSIBLE_ORIGIN] : [];
  return [
    ...pages.flatMap(({ name, text }) => includeMarkers(text).map((marker) => `${name}: include marker left: ${marker}`)),
    ...pages.flatMap(({ name, text }) => brokenLinks(text, pageUrl(name), files).map((url) => `${name}: link names no file of the build: ${url}`)),
    ...code.flatMap(({ name, text }) => unversionedStatic(name, text).map((ref) => `${name}: unversioned static reference: ${ref}`)),
    ...code.filter(({ name }) => !name.endsWith(".css")).flatMap(({ name, text }) => sameHostDataUrls(text).map((url) => `${name}: same-host data URL: ${url}`)),
    ...code.flatMap(({ name, text }) => externalLoads(text, allowed).map((url) => `${name}: loads from another host: ${url}`)),
    ...[...files.keys()].filter((name) => !isStoreKey(keyUrl(objectKey(name)))).map((name) => `${name}: path that no key store key can hold`),
    ...texts.filter(({ size }) => size > MAX_TEXT_SIZE).map(({ name, size }) => `${name}: ${size} bytes, over the ${MAX_TEXT_SIZE} bytes that CloudFront compresses`),
  ];
}

/** Return the same-host `href` and `src` values of a page that name no file of the build. */
function brokenLinks(html: string, url: string, files: ReadonlyMap<string, Uint8Array>): string[] {
  return attributeValues(html)
    .filter((value) => isSameHost(value))
    .filter((value) => {
      const file = buildFile(new URL(value, `https://host${url}`).pathname);
      return file === undefined || !files.has(file);
    });
}

/** Return the quoted `/static/` references of a file, and its relative links that resolve into `/static/`. */
function unversionedStatic(name: string, text: string): string[] {
  const quoted = [...text.matchAll(QUOTED_STATIC)].map((match) => match[0]);
  const fileUrl = pageUrl(name);
  const relative = (name.endsWith(".css") ? [...text.matchAll(CSS_URL)].map((match) => match[2] ?? "") : name.endsWith(".html") ? attributeValues(text) : [])
    .filter((value) => isSameHost(value))
    .filter((value) => new URL(value, `https://host${fileUrl}`).pathname.startsWith("/static/"));
  return [...quoted, ...relative];
}

/** Return the URLs of stylesheets, fonts, and scripts that a page, script, or stylesheet loads from another host than the allowed origins. */
function externalLoads(text: string, allowed: readonly string[]): string[] {
  return EXTERNAL_LOAD.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[1] ?? "")).filter(
    (url) => !allowed.includes(new URL(url, "https://host/").origin),
  );
}

/** Return the `href` and `src` values of a page, without the URLs that page scripts build from pieces. */
function attributeValues(html: string): string[] {
  return [...html.matchAll(ATTRIBUTE)].map((match) => match[2] ?? "").filter((value) => !/["'+{}\s]/u.test(value));
}

/** Tell whether a URL names a path of the same host: an absolute path or a relative URL. */
function isSameHost(value: string): boolean {
  return value !== "" && !value.startsWith("#") && !value.startsWith("//") && !/^[a-z][a-z0-9+.-]*:/iu.test(value);
}

/** Return the build file that the page host serves for a URL path, or `undefined` for an undecodable path. */
function buildFile(path: string): string | undefined {
  try {
    const decoded = decodeURIComponent(path).slice(1);
    return decoded === "" || decoded.endsWith("/") ? `${decoded}index.html` : decoded;
  } catch (error) {
    if (error instanceof URIError) {
      return undefined;
    }
    throw error;
  }
}

function extension(name: string): string {
  const base = name.slice(name.lastIndexOf("/") + 1);
  return base.includes(".") ? base.slice(base.lastIndexOf(".") + 1) : "";
}
