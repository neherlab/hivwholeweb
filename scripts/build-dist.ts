// Write dist/, the files of the page host, from src/ (steps in scripts/build.ts).
//
// Usage: bun scripts/build-dist.ts [--preview]
//
// Environment:
//   HIVWHOLEWEB_DATA_URL           Origin of the data host, without a trailing slash
//   HIVWHOLEWEB_PLAUSIBLE_DOMAIN   Domain under which the pages report visits; empty for no analytics

import { join, resolve } from "node:path";

import { buildSite } from "./build.ts";

const ROOT = resolve(import.meta.dir, "..");

const DIST = join(ROOT, "dist");

const settings = {
  dataUrl: Bun.env["HIVWHOLEWEB_DATA_URL"] ?? "",
  plausibleDomain: Bun.env["HIVWHOLEWEB_PLAUSIBLE_DOMAIN"] ?? "",
  preview: Bun.argv.includes("--preview"),
};

const build = await buildSite({ src: join(ROOT, "src"), dist: DIST, ...settings });

console.error(
  `wrote ${build.files.size} files to ${DIST}, static files in ${build.staticFolder}/, data from ${settings.dataUrl}, ${settings.plausibleDomain === "" ? "no analytics" : `analytics for ${settings.plausibleDomain}`}${settings.preview ? ", for previews" : ""}`,
);
