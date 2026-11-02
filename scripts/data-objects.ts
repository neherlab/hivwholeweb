// Objects of the derived data (web-data/) and of the download files (the files
// of the data directory that the site links), as data-manifest.json records them.

import type { Stats } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import { contentType } from "../server/content-types.ts";
import { mapLimited } from "./concurrency.ts";
import { linkedDataFiles } from "./links.ts";
import { ATTACHMENT, IMMUTABLE, ROBOTS_CACHE, type ManifestObject, fileDigests } from "./manifest.ts";

const JOBS = 8;

/** Return the objects of web-data/, sorted by path. Fails when web-data/ holds download files, which are not derived data. */
export async function webDataObjects(webData: string): Promise<ManifestObject[]> {
  if (await exists(join(webData, "static", "data"))) {
    throw new Error(`${join(webData, "static", "data")} exists: download files are not derived data, and come from the data directory`);
  }
  const paths = (await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: webData, dot: true }))).toSorted();
  return mapLimited(paths, JOBS, async (path) => ({
    key: publicKey(path),
    source: { kind: "web-data", path },
    ...(await fileDigests(join(webData, path))),
    contentType: contentType(path),
    cacheControl: path === "robots.txt" ? ROBOTS_CACHE : IMMUTABLE,
  }));
}

/** Return the objects of the download files that the site links and the data directory holds, and the linked files that it lacks. */
export async function downloadObjects(options: { src: string; webData: string; data: string }): Promise<{ objects: ManifestObject[]; absent: string[] }> {
  const linked = await linkedDataFiles(options.src, options.webData);
  const present = await Promise.all(linked.map((path) => isFile(join(options.data, path))));
  const paths = linked.filter((_, index) => present[index]);
  const objects = await mapLimited(paths, JOBS, async (path): Promise<ManifestObject> => ({
    key: `static/data/${path}`,
    source: { kind: "data", path },
    ...(await fileDigests(join(options.data, path))),
    contentType: contentType(path),
    cacheControl: IMMUTABLE,
    contentDisposition: ATTACHMENT,
  }));
  return { objects, absent: linked.filter((_, index) => !present[index]) };
}

/** Bucket key of a web-data file: its path, without the `.json` suffix of API responses. */
function publicKey(path: string): string {
  return path.startsWith("api/") ? path.slice(0, -".json".length) : path;
}

async function exists(path: string): Promise<boolean> {
  return (await statOrUndefined(path)) !== undefined;
}

async function isFile(path: string): Promise<boolean> {
  return (await statOrUndefined(path))?.isFile() ?? false;
}

async function statOrUndefined(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR")) {
      return undefined;
    }
    throw error;
  }
}
