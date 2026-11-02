// The build of src/ (scripts/build.ts) into temporary folders: its checks, the
// analytics setting, and the versioned static folder.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type Build, type BuildSettings, buildSite } from "../scripts/build.ts";

const SRC = resolve(import.meta.dir, "..", "src");

const DATA_URL = "https://data.example.org";

const SETTINGS: BuildSettings = { dataUrl: DATA_URL, plausibleDomain: "", preview: false };

const decoder = new TextDecoder();

let root = "";
let plain: Build;
let withAnalytics: Build;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "build-test-"));
  plain = await buildSite({ src: SRC, dist: join(root, "plain"), ...SETTINGS });
  withAnalytics = await buildSite({ src: SRC, dist: join(root, "analytics"), ...SETTINGS, plausibleDomain: "hiv.example.org" });
});

afterAll(async () => {
  await rm(root, { recursive: true });
});

describe("build of src/", () => {
  test("passes every build check and leaves out the shared page parts", () => {
    expect([...plain.files.keys()].filter((name) => name.startsWith("_partials/"))).toEqual([]);
  });

  test("keeps the site's own robots.txt, and writes one that disallows all crawling for previews", async () => {
    const preview = await buildSite({ src: SRC, dist: join(root, "preview"), ...SETTINGS, preview: true });
    expect([text(plain, "robots.txt") === (await Bun.file(join(SRC, "robots.txt")).text()), text(preview, "robots.txt")]).toEqual([true, "User-agent: *\nDisallow: /\n"]);
  });

  test("rejects a data host origin with a path or a trailing slash", async () => {
    const results = await Promise.allSettled(["", `${DATA_URL}/`, `${DATA_URL}/data`].map((dataUrl) => buildSite({ src: SRC, dist: join(root, "bad"), ...SETTINGS, dataUrl })));
    expect(results.map((result) => result.status)).toEqual(["rejected", "rejected", "rejected"]);
  });
});

describe("analytics", () => {
  test("a build with a domain writes it into the Plausible tag of every page that has one", () => {
    const domains = pages(withAnalytics).map((name) => [name, /data-domain="([^"]*)"/u.exec(text(withAnalytics, name))?.[1]]);
    // Every page of the site carries the Plausible tag through its head; 404.html has its own head without it.
    const expected = pages(withAnalytics).map((name) => [name, name === "404.html" ? undefined : "hiv.example.org"]);
    expect(domains).toEqual(expected);
  });

  test("a build without a domain leaves no Plausible tag and no reference to plausible.io", () => {
    const mentions = textFiles(plain).filter((name) => text(plain, name).includes("plausible"));
    expect(mentions).toEqual([]);
  });

  test.each([
    ["a page with two Plausible tags", "index.html", (html: string) => html.replace("<!-- include head -->", "<!-- include head -->\n<script id=\"plausible\" defer data-domain=\"x\" src=\"https://plausible.io/js/script.js\"></script>"), "more than one Plausible tag"],
    ["no page with a Plausible tag", "_partials/head.html", (html: string) => html.replace(/<script id="plausible"[^>]*><\/script>/u, ""), "no page holds a Plausible tag"],
  ])("fails for %s", async (_case, file, edit, message) => {
    expect(await buildError(file, edit)).toContain(message);
  });
});

describe("versioned static folder", () => {
  test("two builds of the same source give the same folder name", () => {
    expect(withAnalytics.staticFolder).toBe(plain.staticFolder);
  });

  test("a changed static file changes the folder name", async () => {
    const changed = await buildEdited("static/css/hivevo_style.css", (css) => `${css}\n/* changed */\n`);
    expect(changed.staticFolder).not.toBe(plain.staticFolder);
  });

  test("a changed page keeps the folder name", async () => {
    const changed = await buildEdited("people/index.html", (html) => html.replace("</body>", "<p>changed</p></body>"));
    expect(changed.staticFolder).toBe(plain.staticFolder);
  });

  test("moves every static file into the folder, and keeps the page stylesheets in place", () => {
    const names = [...plain.files.keys()];
    expect([names.filter((name) => name.startsWith("static/")), names.includes(`${plain.staticFolder}/js/eti.js`), names.includes("patient/static/css/patient.css")]).toEqual([[], true, true]);
  });

  test("eti.js imports the estimator and fetches the manifest through the folder, and the training data from the data host", () => {
    const eti = text(plain, `${plain.staticFolder}/js/eti.js`);
    const folder = plain.staticFolder;
    expect([
      eti.includes(`from "/${folder}/eti/estimator.js"`),
      eti.includes(`fetchChecked("/${folder}/eti/manifest.json"`),
      eti.includes(`"${DATA_URL}/static/eti/data/"`),
    ]).toEqual([true, true, true]);
  });

  test("rewrites relative links into /static/ to absolute paths in the folder, and keeps the other relative links", () => {
    const page = text(plain, "patient/p1/index.html");
    expect([page.includes(`src="/${plain.staticFolder}/images/icons/tree.svg"`), page.includes('href="../static/css/patient.css"'), page.includes("../../static/")]).toEqual([true, true, false]);
  });
});

describe("build checks", () => {
  test.each([
    ["a broken link", "people/index.html", (html: string) => html.replace("</body>", '<a href="/no-such-page/">x</a></body>'), "link names no file of the build: /no-such-page/"],
    ["a page link without its trailing slash", "people/index.html", (html: string) => html.replace("</body>", '<a href="/patient/p1">x</a></body>'), "link names no file of the build: /patient/p1"],
    ["a broken relative image", "people/index.html", (html: string) => html.replace("</body>", '<img src="../static/images/none.png"></body>'), "/images/none.png"],
    ["a stylesheet that climbs into /static/", "method/static/css/method.css", (css: string) => `${css}\nbody { background: url(../../../static/images/unibas_logo.png); }\n`, "unversioned static reference: ../../../static/images/unibas_logo.png"],
    ["an unquoted /static/ URL in a stylesheet", "static/css/hivevo_style.css", (css: string) => `${css}\nbody { background: url(/static/images/unibas_logo.png); }\n`, "unversioned static reference: /static/images/unibas_logo.png"],
    ["a script from another host", "people/index.html", (html: string) => html.replace("</body>", '<script src="https://cdn.example.org/x.js"></script></body>'), "loads from another host: https://cdn.example.org/x.js"],
    ["a stylesheet from another host", "people/index.html", (html: string) => html.replace("</head>", '<link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Raleway"></head>'), "loads from another host: https://fonts.googleapis.com/css?family=Raleway"],
    ["a font from another host", "static/css/fonts.css", (css: string) => `${css}\n@font-face { font-family: x; src: url(https://fonts.gstatic.com/x.woff2); }\n`, "loads from another host: https://fonts.gstatic.com/x.woff2"],
    ["a file name that no key store key can hold", "static/images/a b.png", () => "x", "a b.png: path that no key store key can hold"],
    ["an unknown shared part", "people/index.html", (html: string) => html.replace("<!-- include nav -->", "<!-- include none -->"), "no part _partials/none.html"],
  ])("fail the build for %s", async (_case, file, edit, message) => {
    expect(await buildError(file, edit)).toContain(message);
  });

  test("fail the build for a text file over 10 MB, which CloudFront would not compress", async () => {
    const message = await buildError("static/big.json", () => `"${"x".repeat(10_000_000)}"`);
    expect(message).toMatch(/static-[0-9a-f]{12}\/big\.json: 10000002 bytes/u);
  });

  test("allow the Plausible script only with analytics on", async () => {
    const edit = (html: string): string => html.replace("</body>", '<script src="https://plausible.io/js/x.js"></script></body>');
    const off = await buildError("people/index.html", edit);
    const on = await buildEdited("people/index.html", edit, { plausibleDomain: "hiv.example.org" });
    expect([off.includes("loads from another host: https://plausible.io/js/x.js"), on.files.has("people/index.html")]).toEqual([true, true]);
  });
});

/** Build a copy of src/ with one file replaced by `edit` of its content (empty for a new file). */
async function buildEdited(file: string, edit: (text: string) => string, settings: Partial<BuildSettings> = {}): Promise<Build> {
  const dir = await mkdtemp(join(root, "edited-"));
  await cp(SRC, join(dir, "src"), { recursive: true });
  const path = join(dir, "src", file);
  const original = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  await writeFile(path, edit(original));
  return buildSite({ src: join(dir, "src"), dist: join(dir, "dist"), ...SETTINGS, ...settings });
}

/** Return the error message of a build of an edited copy of src/, or "" when the build succeeds. */
async function buildError(file: string, edit: (text: string) => string): Promise<string> {
  try {
    await buildEdited(file, edit);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

function pages(build: Build): string[] {
  return [...build.files.keys()].filter((name) => name.endsWith(".html"));
}

function textFiles(build: Build): string[] {
  return [...build.files.keys()].filter((name) => /\.(?:html|js|css|json|svg|txt)$/u.test(name));
}

function text(build: Build, name: string): string {
  return decoder.decode(build.files.get(name));
}
