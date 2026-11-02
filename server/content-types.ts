// Content types of the served files, as the old server sent them. The static
// server and the data upload both use them.

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  css: "text/css; charset=utf-8",
  eot: "application/vnd.ms-fontobject",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  md: "text/markdown; charset=utf-8",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  tsv: "text/tab-separated-values; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  woff: "font/woff",
  woff2: "font/woff2",
  zip: "application/zip",
};

/** Return the content type of a file path by its extension, `application/octet-stream` when unknown. */
export function contentType(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const extension = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}
