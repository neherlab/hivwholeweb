// Build of the page host files: src/ to dist/.
//
// Steps, in this order:
//   1. Read src/, without the shared page parts of src/_partials/.
//   2. Insert the shared page parts at the include markers (scripts/includes.ts).
//   3. Point the data URLs of pages and scripts to the data host (scripts/data-urls.ts).
//   4. Apply the analytics setting (scripts/analytics.ts).
//   5. Leave out the vendor files of static/components/ that no file of the build
//      loads (scripts/vendor-files.ts).
//   6. Move static/ to static-<hash>/ and rewrite the references to it (scripts/static-version.ts).
//   7. For previews, write a robots.txt that disallows all crawling.
//   8. Check the result (scripts/build-checks.ts), then write it to a new folder
//      that replaces dist/, so that a server of dist/ never sees half a build.

import { mkdir, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { applyAnalytics } from "./analytics.ts";
import { checkBuild } from "./build-checks.ts";
import { rewriteDataUrls } from "./data-urls.ts";
import { PARTIALS_DIR, insertPartials, partialText } from "./includes.ts";
import { pageUrl, rewriteQuotedStatic, rewriteRelativeStatic, staticFolder } from "./static-version.ts";
import { withoutUnusedVendorFiles } from "./vendor-files.ts";

const PREVIEW_ROBOTS = "User-agent: *\nDisallow: /\n";

/** Build `options.dist` from `options.src`, and return the build's files and static folder. */
export async function buildSite(options: BuildOptions): Promise<Build> {
  const source = await readTree(options.src);
  const build = transformSite(source, options);
  const problems = checkBuild(build.files, { analytics: options.plausibleDomain !== "" });
  if (problems.length > 0) {
    throw new Error(`the build has ${problems.length} problems:\n${problems.join("\n")}`);
  }
  await writeTree(options.dist, build.files);
  return build;
}

/** Apply build steps 2 to 7 to the files of src/ (paths relative to src/, with the parts under `_partials/`). */
export function transformSite(source: ReadonlyMap<string, Uint8Array>, settings: BuildSettings): Build {
  const dataUrl = checkedDataUrl(settings.dataUrl);
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const partialPrefix = `${PARTIALS_DIR}/`;
  const partials = new Map(
    [...source]
      .filter(([name]) => name.startsWith(partialPrefix) && name.endsWith(".html"))
      .map(([name, bytes]) => [name.slice(partialPrefix.length, -".html".length), partialText(decoder.decode(bytes))]),
  );
  const files = new Map([...source].filter(([name]) => !name.startsWith(partialPrefix)));
  const texts = new Map([...files].filter(([name]) => isRewritten(name)).map(([name, bytes]) => [name, decoder.decode(bytes)]));

  const included = mapPages(texts, (html) => insertPartials(html, partials));
  const withData = new Map([...included].map(([name, text]) => [name, /\.(?:html|js)$/u.test(name) ? rewriteDataUrls(text, dataUrl) : text]));
  const pages = applyAnalytics(new Map([...withData].filter(([name]) => name.endsWith(".html"))), settings.plausibleDomain);
  const transformed = new Map([...withData, ...pages]);

  const encoded = withoutUnusedVendorFiles(new Map([...files, ...[...transformed].map(([name, text]) => [name, encoder.encode(text)] as const)]));
  const folder = staticFolder(
    [...encoded].filter(([name]) => name.startsWith("static/")).map(([name, bytes]) => ({ path: name.slice("static/".length), bytes })),
  );
  const versioned = new Map(
    [...encoded].map(([name, bytes]) => {
      const target = name.startsWith("static/") ? `${folder}/${name.slice("static/".length)}` : name;
      const text = transformed.get(name);
      if (text === undefined) {
        return [target, bytes] as const;
      }
      const quoted = rewriteQuotedStatic(text, folder);
      return [target, encoder.encode(name.endsWith(".html") ? rewriteRelativeStatic(quoted, pageUrl(name), folder) : quoted)] as const;
    }),
  );
  if (settings.preview) {
    versioned.set("robots.txt", encoder.encode(PREVIEW_ROBOTS));
  }
  return { files: new Map([...versioned].toSorted(([a], [b]) => (a < b ? -1 : 1))), staticFolder: folder };
}

/** Settings of a build: the same for local, preview, and production builds except their values. */
export interface BuildSettings {
  /** Origin of the data host, without a trailing slash (HIVWHOLEWEB_DATA_URL). */
  dataUrl: string;
  /** Domain under which the pages report visits to Plausible, empty for no analytics (HIVWHOLEWEB_PLAUSIBLE_DOMAIN). */
  plausibleDomain: string;
  /** Write a robots.txt that disallows all crawling. */
  preview: boolean;
}

/** Directories and settings of a build. */
export interface BuildOptions extends BuildSettings {
  src: string;
  dist: string;
}

/** Files of a build, by path relative to dist/, and the name of its versioned static folder. */
export interface Build {
  files: ReadonlyMap<string, Uint8Array>;
  staticFolder: string;
}

/** Read every file of a directory, by path relative to it. */
export async function readTree(directory: string): Promise<Map<string, Uint8Array>> {
  const names = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: directory, dot: true }));
  return new Map(await Promise.all(names.map(async (name) => [name, await Bun.file(join(directory, name)).bytes()] as const)));
}

/** Write the files to a new folder next to `dist`, then replace `dist` with it. */
async function writeTree(dist: string, files: ReadonlyMap<string, Uint8Array>): Promise<void> {
  const partial = `${dist}.partial`;
  const previous = `${dist}.previous`;
  await Promise.all([rm(partial, { recursive: true, force: true }), rm(previous, { recursive: true, force: true })]);
  await Promise.all(
    [...files].map(async ([name, bytes]) => {
      await mkdir(dirname(join(partial, name)), { recursive: true });
      await Bun.write(join(partial, name), bytes);
    }),
  );
  await rename(dist, previous).catch((error: unknown) => {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  });
  await rename(partial, dist);
  await rm(previous, { recursive: true, force: true });
}

function checkedDataUrl(dataUrl: string): string {
  if (dataUrl === "") {
    throw new Error("Set HIVWHOLEWEB_DATA_URL to the origin of the data host: see .env.example");
  }
  const origin = URL.canParse(dataUrl) ? new URL(dataUrl).origin : undefined;
  if (origin !== dataUrl) {
    throw new Error(`HIVWHOLEWEB_DATA_URL must be an origin, such as https://data.example.org, without a trailing slash: ${dataUrl}`);
  }
  return dataUrl;
}

/** Tell whether the build rewrites a file: pages, scripts, and stylesheets. */
function isRewritten(name: string): boolean {
  return /\.(?:html|js|css)$/u.test(name);
}

function mapPages(texts: ReadonlyMap<string, string>, transform: (html: string) => string): Map<string, string> {
  return new Map([...texts].map(([name, text]) => [name, name.endsWith(".html") ? transform(text) : text]));
}
