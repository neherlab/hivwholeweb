// Request handler of the local page host: serves a build (dist/) with a local
// copy of the rules of the production page host, which the infrastructure
// project defines as a CloudFront Function over the page key store:
//
//   1. A path under /api/, /static/data/, or /static/eti/data/ answers 301 to the
//      same path and query string on the data host.
//   2. A path of the page key set (scripts/site-objects.ts) is served: the page
//      of a path that ends with `/`, the file of any other path.
//   3. A path whose form with `/` appended is in the key set answers 301 to that
//      form, with the query string.
//   4. Any other path answers 404 with the 404 page.
//
// Paths are compared as sent, without decoding, as the edge function compares
// them, so an encoded variant of a valid path answers 404. Every answer carries
// the security headers (server/security-headers.ts), and files carry the cache
// headers of the page host. ETags and 304 answers are left to CloudFront and S3.

import { join } from "node:path";

import { siteCacheControl } from "../scripts/site-objects.ts";
import { contentType } from "./content-types.ts";

const DATA_PREFIXES = ["/api/", "/static/data/", "/static/eti/data/"];

/** Return the request handler of the local page host for a build. */
export function createPageHandler(site: PageSite): (request: Request) => Response {
  return (request) => {
    const response = respond(request, site);
    Object.entries(site.headers).forEach(([name, value]) => response.headers.set(name, value));
    return response;
  };
}

/** Build of the page host: its folder, its page key set, the data host origin, and the security headers. */
export interface PageSite {
  dist: string;
  keys: ReadonlySet<string>;
  dataOrigin: string;
  headers: Readonly<Record<string, string>>;
}

function respond(request: Request, site: PageSite): Response {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  const url = new URL(request.url);
  const path = url.pathname;
  if (DATA_PREFIXES.some((prefix) => path.startsWith(prefix))) {
    return redirect(`${site.dataOrigin}${path}${url.search}`);
  }
  if (site.keys.has(path)) {
    const file = path.endsWith("/") ? `${path.slice(1)}index.html` : path.slice(1);
    return new Response(Bun.file(join(site.dist, file)), { headers: { "Content-Type": contentType(file), "Cache-Control": siteCacheControl(file) } });
  }
  if (site.keys.has(`${path}/`)) {
    return redirect(`${path}/${url.search}`);
  }
  return new Response(Bun.file(join(site.dist, "404.html")), { status: 404, headers: { "Content-Type": contentType("404.html"), "Cache-Control": siteCacheControl("404.html") } });
}

function redirect(location: string): Response {
  return new Response(undefined, { status: 301, headers: { Location: location } });
}
