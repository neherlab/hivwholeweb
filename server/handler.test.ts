// The local page host and data host against small fixture folders.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { pageStoreKeys } from "../scripts/site-objects.ts";
import { createDataHandler } from "./data-handler.ts";
import { createPageHandler } from "./handler.ts";
import { securityHeaders } from "./security-headers.ts";

const DATA_ORIGIN = "https://data.example.org";

const IMMUTABLE = "public, max-age=31536000, immutable";

const REVALIDATE = "public, max-age=0, must-revalidate, s-maxage=31536000";

const PAGES = ["index.html", "404.html", "patient/p1/index.html", "static-0123456789ab/js/a.js", "robots.txt"];

let root = "";
let page: (request: Request) => Response;
let data: (request: Request) => Promise<Response>;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "handler-test-"));
  await Promise.all(PAGES.map((file) => put(`dist/${file}`, file === "404.html" ? "not found page" : file)));
  await put("web-data/api/data/snp/p1/genomewide.json", '{"full": true}');
  await put("web-data/api/data/snp/p1/genomewide/sparse.json", '{"sparse": true}');
  await put("web-data/static/eti/data/training-0123456789abcdef.bin", "training");
  await put("web-data/robots.txt", "User-agent: *\nDisallow: /\n");
  await put("data-files/static/data/tables/samples_p1.tsv", "table");
  page = createPageHandler({ dist: join(root, "dist"), keys: pageStoreKeys(PAGES), dataOrigin: DATA_ORIGIN, headers: securityHeaders({ dataOrigin: DATA_ORIGIN, analytics: false }) });
  data = createDataHandler({ webData: join(root, "web-data"), dataFiles: join(root, "data-files") });
});

afterAll(async () => {
  await rm(root, { recursive: true });
});

// Expected answers: the rules of the production page host, which the local server copies.
describe("page host", () => {
  test("serves a page of the key set", async () => {
    const response = get("/patient/p1/");
    expect([response.status, await response.text(), response.headers.get("Content-Type")]).toEqual([200, "patient/p1/index.html", "text/html; charset=utf-8"]);
  });

  test.each([
    ["/patient/p1", "/patient/p1/"],
    ["/patient/p1?x=1", "/patient/p1/?x=1"],
    ["/api/data/tree/p1/V3", `${DATA_ORIGIN}/api/data/tree/p1/V3`],
    ["/static/data/tables/samples_p1.tsv?download=1", `${DATA_ORIGIN}/static/data/tables/samples_p1.tsv?download=1`],
    ["/static/eti/data/training-0123456789abcdef.bin", `${DATA_ORIGIN}/static/eti/data/training-0123456789abcdef.bin`],
  ])("redirects %s to %s", (path, location) => {
    const response = get(path);
    expect([response.status, response.headers.get("Location")]).toEqual([301, location]);
  });

  test.each(["/no-such-page", "/patient/p%31/", "/404", "/404.html", "/static-0123456789ab/js/none.js", "/patient/p1/index.html"])("answers %s with the 404 page", async (path) => {
    const response = get(path);
    expect([response.status, await response.text()]).toEqual([404, "not found page"]);
  });

  test.each([
    ["/static-0123456789ab/js/a.js", IMMUTABLE],
    ["/patient/p1/", REVALIDATE],
    ["/", REVALIDATE],
    ["/robots.txt", REVALIDATE],
  ])("sends %s with %s", (path, cacheControl) => {
    const response = get(path);
    expect([response.status, response.headers.get("Cache-Control"), response.headers.get("ETag")]).toEqual([200, cacheControl, null]);
  });

  test.each(["/", "/patient/p1", "/no-such-page", "/api/data/x"])("sends Permissions-Policy and Cross-Origin-Opener-Policy with %s", (path) => {
    const response = get(path);
    expect([response.headers.get("Permissions-Policy"), response.headers.get("Cross-Origin-Opener-Policy")]).toEqual([
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "same-origin",
    ]);
  });

  test("refuses methods other than GET and HEAD", () => {
    expect(page(new Request("http://localhost/", { method: "POST" })).status).toBe(405);
  });
});

describe("security headers", () => {
  test("the CSP lets the data host serve images and API responses", () => {
    const policy = securityHeaders({ dataOrigin: DATA_ORIGIN, analytics: false })["Content-Security-Policy"];
    expect([policy?.includes(`img-src 'self' data: ${DATA_ORIGIN}`), policy?.includes(`connect-src 'self' ${DATA_ORIGIN}`)]).toEqual([true, true]);
  });

  test.each([
    [true, true],
    [false, false],
  ])("with analytics %p, the CSP names plausible.io: %p", (analytics, named) => {
    const policy = securityHeaders({ dataOrigin: DATA_ORIGIN, analytics })["Content-Security-Policy"] ?? "";
    expect([/script-src [^;]*https:\/\/plausible\.io/u.test(policy), /connect-src [^;]*https:\/\/plausible\.io/u.test(policy)]).toEqual([named, named]);
  });
});

describe("data host", () => {
  test("serves API paths that are prefixes of each other from their .json files", async () => {
    const full = await data(request("/api/data/snp/p1/genomewide"));
    const sparse = await data(request("/api/data/snp/p1/genomewide/sparse"));
    expect([await full.text(), full.headers.get("Content-Type"), await sparse.text()]).toEqual(['{"full": true}', "application/json", '{"sparse": true}']);
  });

  test("allows every origin and marks every answer as not to be indexed", async () => {
    const responses = await Promise.all(["/api/data/snp/p1/genomewide", "/static/data/tables/samples_p1.tsv", "/none"].map((path) => data(request(path))));
    expect(responses.map((response) => [response.status, response.headers.get("Access-Control-Allow-Origin"), response.headers.get("X-Robots-Tag")])).toEqual([
      [200, "*", "noindex, nofollow"],
      [200, "*", "noindex, nofollow"],
      [404, "*", "noindex, nofollow"],
    ]);
  });

  test("sends download files as attachments, and the other data inline", async () => {
    const responses = await Promise.all(["/static/data/tables/samples_p1.tsv", "/api/data/snp/p1/genomewide", "/static/eti/data/training-0123456789abcdef.bin"].map((path) => data(request(path))));
    expect(responses.map((response) => response.headers.get("Content-Disposition"))).toEqual(["attachment", null, null]);
  });

  test.each([
    ["/static/eti/data/training-0123456789abcdef.bin", IMMUTABLE],
    ["/robots.txt", "public, max-age=3600"],
  ])("sends %s with %s", async (path, cacheControl) => {
    expect((await data(request(path))).headers.get("Cache-Control")).toBe(cacheControl);
  });

  test.each(["/api/data/snp/p1/genomewide.json", "/api/data/snp/p1/", "/static/data/../../web-data/robots.txt", "/api/data/snp/p%31/genomewide", "/"])("answers %s with 404", async (path) => {
    expect((await data(request(path))).status).toBe(404);
  });
});

function get(path: string): Response {
  return page(request(path));
}

function request(path: string): Request {
  return new Request(`http://localhost${path}`);
}

async function put(path: string, content: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), content);
}
