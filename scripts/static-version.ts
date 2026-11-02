// Versioned static folder: the build moves static/ to static-<hash>/, where
// <hash> follows the content of the folder, so that browsers may keep every
// static file forever and a page always loads the static files it was built with.

import { createHash } from "node:crypto";

const QUOTED_STATIC = /(["'])\/static\//gu;

const RELATIVE_LINK = /(\s(?:href|src)=)(["'])(\.{1,2}\/[^"']*)\2/gu;

/** Name of the versioned folder: `static-` and the first 12 hex digits of the sha256 over the sorted paths and contents. */
export function staticFolder(files: readonly StaticFile[]): string {
  const hash = createHash("sha256");
  files
    .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .forEach(({ path, bytes }) => {
      hash.update(`${path}\0${bytes.length}\0`);
      hash.update(bytes);
    });
  return `static-${hash.digest("hex").slice(0, 12)}`;
}

/** File of the static folder: its path relative to the folder and its content. */
export interface StaticFile {
  path: string;
  bytes: Uint8Array;
}

/** Point every quoted `/static/` prefix of a page, script, or stylesheet to the versioned folder. */
export function rewriteQuotedStatic(text: string, folder: string): string {
  return text.replace(QUOTED_STATIC, (_match, quote: string) => `${quote}/${folder}/`);
}

/** Point every relative `href` and `src` of a page that resolves into `/static/` to the absolute path in the versioned folder. */
export function rewriteRelativeStatic(html: string, pageUrl: string, folder: string): string {
  return html.replace(RELATIVE_LINK, (match, attribute: string, quote: string, link: string) => {
    const path = new URL(link, `https://host${pageUrl}`).pathname;
    return path.startsWith("/static/") ? `${attribute}${quote}/${folder}/${path.slice("/static/".length)}${quote}` : match;
  });
}

/** URL path of a page of the build: `/` for `index.html`, `/<dir>/` for `<dir>/index.html`, `/<name>` otherwise. */
export function pageUrl(file: string): string {
  if (file === "index.html") {
    return "/";
  }
  return file.endsWith("/index.html") ? `/${file.slice(0, -"index.html".length)}` : `/${file}`;
}
